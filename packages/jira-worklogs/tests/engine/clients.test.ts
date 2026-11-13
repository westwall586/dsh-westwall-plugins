// T02 判定用例：http/jira/gitlab 客户端与网络语义。
// 断言口径移植自参考实现 NetworkSemanticsTest 与 GitActivityTest 的
// collect_git_activity 三例；认证头/分页/adjustEstimate 为移植行为补充用例。
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../../src/engine/index.ts'
import { fakeJira, fakeGitlab, flaky, myselfData } from './helpers.ts'

beforeEach(() => {
  engine.clientConfig.GET_RETRY_DELAY = 0
})

const MYSELF_PATH = (url: string) => url.endsWith('/rest/api/2/myself')

test('GET 网络抖动重试一次', async () => {
  const inner = fakeJira()
  const transport = flaky(inner, 'GET', MYSELF_PATH, new Error('connection reset by peer'))
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const me = (await client.myself()) as { name: string }
  assert.equal(me.name, 'alice')
  assert.equal(transport.calls.filter(call => MYSELF_PATH(call.url)).length, 2)
})

test('GET HTTP 错误不重试', async () => {
  const transport = flaky(fakeJira(), 'GET', MYSELF_PATH, new engine.HttpError(403, 'Forbidden'))
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await assert.rejects(() => client.myself(), engine.HttpError)
  assert.equal(transport.calls.filter(call => MYSELF_PATH(call.url)).length, 1)
})

test('POST 网络错误永不重试', async () => {
  const transport = flaky(fakeJira(), 'POST', url => url.includes('/worklog'), new Error('connection reset'))
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await assert.rejects(() => client.addWorklog('DEMO-745', { started: '2026-09-21T09:00:00.000+0800', timeSpent: '8h', comment: 'x' }))
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 1)
})

test('Jira Basic 认证头与 JSON 头', async () => {
  const transport = fakeJira()
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await client.myself()
  const headers = transport.calls[0]!.headers!
  assert.equal(headers.Authorization, `Basic ${btoa('u:p')}`)
  assert.equal(headers.Accept, 'application/json')
})

test('adjustEstimate 是 query 参数而非 body 字段', async () => {
  const transport = fakeJira()
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await client.addWorklog('DEMO-745', { started: '2026-09-21T09:00:00.000+0800', timeSpent: '8h', comment: 'x' })
  const post = transport.calls.find(call => call.method === 'POST')!
  assert.ok(post.url.includes('adjustEstimate=auto'))
  assert.deepEqual(Object.keys(post.body as object).sort(), ['comment', 'started', 'timeSpent'])
})

test('searchAll 分页遍历到 total 尽头', async () => {
  const all = Array.from({ length: 150 }, (_, i) => ({ key: `K-${i}` }))
  const calls: string[] = []
  const transport: engine.Transport = (method, url) => {
    calls.push(url)
    if (!url.includes('/rest/api/2/search')) return Promise.resolve(myselfData())
    const start = Number(new URL(url).searchParams.get('startAt'))
    return Promise.resolve({ startAt: start, maxResults: 100, total: all.length, issues: all.slice(start, start + 100) })
  }
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const issues = await client.searchAll('worklogAuthor = x')
  assert.equal(issues.length, 150)
  assert.equal(calls.length, 2)
})

test('GitLab PRIVATE-TOKEN 头与推送事件参数', async () => {
  const transport = fakeGitlab({ id: 387, username: 'alice' }, [], {}, {})
  const client = new engine.GitlabClient('http://git', 't', transport)
  await client.pushEvents(387, '2026-09-15T00:00:00Z')
  const call = transport.calls[0]!
  assert.equal(call.headers!['PRIVATE-TOKEN'], 't')
  assert.ok(call.url.includes('action=pushed'))
  assert.ok(call.url.includes('after=2026-09-15T00%3A00%3A00Z'))
})

test('collectGitActivity 按日分组、窗口过滤、未推送不计', async () => {
  const transport = fakeGitlab(
    { id: 387, username: 'alice' },
    [
      { project_id: 10, created_at: '2026-09-15T03:00:00Z', push_data: { commit_count: 2 } },
      { project_id: 20, created_at: '2026-09-16T05:00:00Z', push_data: { commit_count: 1 } },
    ],
    { 10: { path_with_namespace: 'grp/one' }, 20: { path_with_namespace: 'grp/two' } },
    {
      10: [
        { short_id: 'aaa111', title: 'feat: 完成 FSD', author_name: 'jumproot', committed_date: '2026-09-15T01:00:00Z' },
        { short_id: 'bbb222', title: '窗口外提交', author_name: 'jumproot', committed_date: '2026-09-17T01:00:00Z' },
      ],
      20: [
        { short_id: 'ccc333', title: 'chore: 同步', author_name: 'alice', committed_date: '2026-09-16T02:00:00Z' },
        // 09-15 本人未推送过 proj 20，他人合入 main 的提交不进素材
        { short_id: 'oth444', title: '他人合入 main', author_name: '邓磊', committed_date: '2026-09-15T23:00:00Z' },
      ],
    },
  )
  const activity = await engine.collectGitActivity(
    [{ url: 'http://git', token: 't', verifySsl: false }],
    ['2026-09-15', '2026-09-16'],
    [],
    () => new engine.GitlabClient('http://git', 't', transport),
  )
  assert.equal(activity.enabled, true)
  assert.equal(activity.instances[0]!.status, 'ok')
  assert.deepEqual(activity.by_date['2026-09-15']!.map(item => item.project), ['grp/one'])
  assert.equal(activity.by_date['2026-09-15']![0]!.push_count, 1)
  assert.deepEqual(activity.by_date['2026-09-15']![0]!.commits.map(c => c.title), ['feat: 完成 FSD'])
  assert.equal(activity.by_date['2026-09-16']![0]!.project, 'grp/two')
})

test('collectGitActivity after 前放一天（GitLab 13.8 按天严格大于，传首日会漏当日事件）', async () => {
  const transport = fakeGitlab(
    { id: 387, username: 'alice' },
    [{ project_id: 10, created_at: '2026-09-15T03:00:00Z', push_data: {} }],
    { 10: { path_with_namespace: 'grp/one' } },
    { 10: [{ short_id: 'a1', title: 'feat: 开发', author_name: 'alice', committed_date: '2026-09-15T01:00:00Z' }] },
  )
  await engine.collectGitActivity(
    [{ url: 'http://git', token: 't', verifySsl: false }],
    ['2026-09-15'],
    [],
    () => new engine.GitlabClient('http://git', 't', transport),
  )
  const eventsCall = transport.calls.find(call => call.url.includes('/events'))!
  assert.ok(eventsCall.url.includes('after=2026-09-14T00%3A00%3A00Z'), eventsCall.url)
})

test('collectGitActivity 过滤 context-repo 状态库并记入名单', async () => {
  const transport = fakeGitlab(
    { id: 387, username: 'alice' },
    [
      { project_id: 10, created_at: '2026-09-15T03:00:00Z', push_data: {} },
      { project_id: 30, created_at: '2026-09-15T04:00:00Z', push_data: {} },
    ],
    { 10: { path_with_namespace: 'grp/one' }, 30: { path_with_namespace: 'zhenyoutms/zhqy-context-repo' } },
    {
      10: [{ short_id: 'a1', title: 'feat: 开发', author_name: 'alice', committed_date: '2026-09-15T01:00:00Z' }],
      30: [{ short_id: 'b1', title: 'chore: 状态库同步', author_name: 'jumproot', committed_date: '2026-09-15T01:00:00Z' }],
    },
  )
  const activity = await engine.collectGitActivity(
    [{ url: 'http://git', token: 't', verifySsl: false }],
    ['2026-09-15'],
    ['context-repo'],
    () => new engine.GitlabClient('http://git', 't', transport),
  )
  assert.deepEqual(activity.by_date['2026-09-15']!.map(item => item.project), ['grp/one'])
  assert.deepEqual(activity.instances[0]!.filtered_context_repos, ['zhenyoutms/zhqy-context-repo'])
})

test('collectGitActivity 自定义名单按子串排除并记入（迭代二 repoFilter 参数化）', async () => {
  const transport = fakeGitlab(
    { id: 387, username: 'alice' },
    [
      { project_id: 10, created_at: '2026-09-15T03:00:00Z', push_data: {} },
      { project_id: 40, created_at: '2026-09-15T04:00:00Z', push_data: {} },
    ],
    { 10: { path_with_namespace: 'grp/one' }, 40: { path_with_namespace: 'mirror/private-infra' } },
    {
      10: [{ short_id: 'a1', title: 'feat: 开发', author_name: 'alice', committed_date: '2026-09-15T01:00:00Z' }],
      40: [{ short_id: 'c1', title: 'chore: 镜像', author_name: 'alice', committed_date: '2026-09-15T01:00:00Z' }],
    },
  )
  const activity = await engine.collectGitActivity(
    [{ url: 'http://git', token: 't', verifySsl: false }],
    ['2026-09-15'],
    ['private-', 'mirror'],
    () => new engine.GitlabClient('http://git', 't', transport),
  )
  assert.deepEqual(activity.by_date['2026-09-15']!.map(item => item.project), ['grp/one'])
  assert.deepEqual(activity.instances[0]!.filtered_context_repos, ['mirror/private-infra'])
})

test('collectGitActivity 空名单不过滤（context-repo 照常收录）', async () => {
  const transport = fakeGitlab(
    { id: 387, username: 'alice' },
    [
      { project_id: 10, created_at: '2026-09-15T03:00:00Z', push_data: {} },
      { project_id: 30, created_at: '2026-09-15T04:00:00Z', push_data: {} },
    ],
    { 10: { path_with_namespace: 'grp/one' }, 30: { path_with_namespace: 'zhenyoutms/zhqy-context-repo' } },
    {
      10: [{ short_id: 'a1', title: 'feat: 开发', author_name: 'alice', committed_date: '2026-09-15T01:00:00Z' }],
      30: [{ short_id: 'b1', title: 'chore: 状态库同步', author_name: 'jumproot', committed_date: '2026-09-15T01:00:00Z' }],
    },
  )
  const activity = await engine.collectGitActivity(
    [{ url: 'http://git', token: 't', verifySsl: false }],
    ['2026-09-15'],
    [],
    () => new engine.GitlabClient('http://git', 't', transport),
  )
  assert.deepEqual(activity.by_date['2026-09-15']!.map(item => item.project), ['grp/one', 'zhenyoutms/zhqy-context-repo'])
  assert.equal(activity.instances[0]!.filtered_context_repos, undefined)
})

test('collectGitActivity 单实例失败不阻断', async () => {
  const broken: engine.Transport = () => Promise.reject(new Error('connection refused'))
  const activity = await engine.collectGitActivity(
    [{ url: 'http://git', token: 't', verifySsl: false }],
    ['2026-09-15'],
    [],
    () => new engine.GitlabClient('http://git', 't', broken),
  )
  assert.equal(activity.instances[0]!.status, 'error')
  assert.deepEqual(activity.by_date, { '2026-09-15': [] })
})

// —— makeHttpTransport 真实回环（评审补充：该层此前零覆盖，重试语义依赖其归一）——

import { createServer, type Server } from 'node:http'

test('makeHttpTransport 回环：200 JSON / 403 / 302 / 坏 JSON 归一与拒连形态', async () => {
  const transport = engine.makeHttpTransport()
  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/ok') {
      res.setHeader('content-type', 'application/json')
      res.end('{"value": 7}')
    } else if (url === '/forbidden') {
      res.statusCode = 403
      res.setHeader('content-type', 'text/plain')
      res.end('nope')
    } else if (url === '/moved') {
      res.statusCode = 302
      res.setHeader('location', '/login')
      res.end()
    } else {
      res.setHeader('content-type', 'application/json')
      res.end('<html>not json</html>')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no listen address')
  try {
    const base = `http://127.0.0.1:${address.port}`
    assert.deepEqual(await transport('GET', `${base}/ok`), { value: 7 })
    await assert.rejects(() => transport('GET', `${base}/forbidden`), (error: unknown) => {
      assert.ok(error instanceof engine.HttpError)
      assert.equal(error.status, 403)
      return true
    })
    await assert.rejects(() => transport('GET', `${base}/moved`), engine.HttpError)
    await assert.rejects(() => transport('GET', `${base}/bad-json`), engine.HttpError)
    // 拒连是网络错误形态（非 HttpError），供客户端层重试判定。
    await assert.rejects(() => transport('GET', 'http://127.0.0.1:1/x'), (error: unknown) => {
      assert.ok(!(error instanceof engine.HttpError))
      return true
    })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('JiraClient myself 对 200 空响应体抛凭据异常（验收 E-1：网关吞认证失败为空体）', async () => {
  // Transport 契约＝resolve 已解码业务数据；网关 200 空体解码后即空对象
  const emptyBody: engine.Transport = () => Promise.resolve({}) as never
  const client = new engine.JiraClient('https://jira', 'u', 'wrong', emptyBody)
  await assert.rejects(() => client.myself(), /未返回当前用户/)
})

// S4 首次真实提交回归（2026-09-24）：jira.ts 常驻 Content-Type 与 transport 侧
// 小写 content-type 大小写并存，undici 写请求拒绝（"must only have a single value"）。
test('mergedHeaders 同名头大小写去重（写路径双 content-type 回归）', () => {
  const merged = engine.mergedHeaders(
    { Authorization: 'Basic x', Accept: 'application/json', 'Content-Type': 'application/json' },
    true,
  )
  assert.equal(Object.keys(merged).filter(k => k.toLowerCase() === 'content-type').length, 1)
  assert.equal(merged['content-type'], 'application/json')
  assert.equal(merged.accept, 'application/json')
  assert.equal(merged.authorization, 'Basic x')
})

test('mergedHeaders 无 body 不补 content-type', () => {
  const merged = engine.mergedHeaders({ Accept: 'application/json' }, false)
  assert.equal(Object.keys(merged).filter(k => k.toLowerCase() === 'content-type').length, 0)
})

test('JiraClient 常驻头不再携带 Content-Type（由 transport 有 body 时统一补）', async () => {
  const transport = fakeJira()
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await client.addWorklog('DEMO-745', { started: '2026-09-21T09:00:00.000+0800', timeSpent: '8h', comment: 'x' })
  const post = transport.calls.find(call => call.method === 'POST')!
  assert.equal(Object.keys(post.headers!).filter(k => k.toLowerCase() === 'content-type').length, 0)
})

// ---- 查同事日志（20261023 Wave）：searchUsers 只读端点 ----

test('searchUsers 命中 user/search 端点、查询参数编码、三字段映射', async () => {
  const transport = fakeJira({
    userSearch: [
      { name: 'bob', displayName: '王帅', active: true },
      { name: 'bob01', displayName: '王帅' },
      { name: 'x', displayName: 'Y', active: false },
      null,
    ],
  })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const users = await client.searchUsers('王帅')
  const call = transport.calls.find(c => c.url.includes('/rest/api/2/user/search'))!
  assert.equal(call.method, 'GET')
  assert.ok(call.url.includes('username=%E7%8E%8B%E5%B8%85'), '中文名经 URLSearchParams 编码')
  assert.ok(call.url.includes('maxResults=20'))
  assert.deepEqual(users, [
    { name: 'bob', displayName: '王帅', active: true },
    { name: 'bob01', displayName: '王帅', active: true },
    { name: 'x', displayName: 'Y', active: false },
  ])
})

test('searchUsers 非数组响应走网络错误路径', async () => {
  const transport = fakeJira({ userSearch: { unexpected: true } })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await assert.rejects(() => client.searchUsers('谁'), /user\/search 返回异常/)
})
