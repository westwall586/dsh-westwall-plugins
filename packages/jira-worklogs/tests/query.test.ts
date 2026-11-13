// T02–T05 判定用例：查同事日志（20261023 Wave）——引擎采集与解析（engine/query）、
// service 映射族、flows 编排（queryFlow）、index 接线源断言。
// 口径：只读（transport 仅 GET）、窗口右界卡今天、started 严格过滤（findings F4/F5）。
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as engine from '../src/engine/index.ts'
import { fakeJira } from './engine/helpers.ts'

beforeEach(() => {
  engine.clientConfig.GET_RETRY_DELAY = 0
})

const jiraWith = (users: unknown[], logs: Record<string, unknown[]> = {}) =>
  fakeJira({ userSearch: users, logs })

// ---- resolveUser：登录 ID 精确 → 显示名全等池 → 模糊池回落 ----

test('resolveUser 登录 ID 精确命中（同名堆里直选）', async () => {
  const users = [
    { name: 'bob', displayName: '王帅', active: true },
    { name: 'bob01', displayName: '王帅', active: true },
    { name: 'bob_hz', displayName: '王帅', active: true },
  ]
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith(users))
  assert.deepEqual(await engine.resolveUser(client, 'bob'), {
    status: 'unique', name: 'bob', displayName: '王帅',
  })
})

test('resolveUser 显示名全等池唯一命中', async () => {
  const users = [
    { name: 'carol', displayName: '何慧敏', active: true },
    { name: 'alice', displayName: 'Alice', active: true },
  ]
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith(users))
  assert.deepEqual(await engine.resolveUser(client, '何慧敏'), {
    status: 'unique', name: 'carol', displayName: '何慧敏',
  })
})

test('resolveUser 显示名全等池多个 → 歧义候选', async () => {
  const users = [
    { name: 'bob', displayName: '王帅', active: true },
    { name: 'bob01', displayName: '王帅', active: true },
    { name: 'bob_hz', displayName: '王帅', active: true },
  ]
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith(users))
  const resolved = await engine.resolveUser(client, '王帅')
  assert.equal(resolved.status, 'ambiguous')
  assert.equal(resolved.status === 'ambiguous' ? resolved.candidates.length : 0, 3)
})

test('resolveUser 全等池为空回落模糊池：唯一即用', async () => {
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith([
    { name: 'carol', displayName: '何慧敏', active: true },
  ]))
  assert.deepEqual(await engine.resolveUser(client, '何慧'), {
    status: 'unique', name: 'carol', displayName: '何慧敏',
  })
})

test('resolveUser 全等池为空回落模糊池：多个即歧义', async () => {
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith([
    { name: 'a', displayName: '王一', active: true },
    { name: 'b', displayName: '王二', active: true },
  ]))
  assert.equal((await engine.resolveUser(client, '王')).status, 'ambiguous')
})

test('resolveUser 无命中 → not-found', async () => {
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith([]))
  assert.deepEqual(await engine.resolveUser(client, '不存在的人'), { status: 'not-found' })
})

// ---- collectWorklogs：右界卡今天＋started 严格过滤＋作者过滤 ----

const WL = (day: string, seconds: number, comment: string, author = 'carol', startedTime = '09:30') => ({
  id: `${day}-${seconds}-${author}`, started: `${day}T${startedTime}:00.000+0800`,
  timeSpent: 'x', timeSpentSeconds: seconds, comment, author: { name: author, displayName: author },
})

test('collectWorklogs 右界卡今天：JQL 与条目双重截断未来预填', async () => {
  const transport = jiraWith([], {
    'A-1': [WL('2026-10-22', 3600, '在窗内'), WL('2026-10-26', 3600, '未来预填')],
  })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const entries = await engine.collectWorklogs(client, 'carol', '2026-10-17', '2099-01-01', '2026-10-23')
  const jql = decodeURIComponent(transport.calls[0]!.url.replaceAll('+', ' '))
  assert.ok(jql.includes('worklogDate <= "2026-10-23"'), '结束日期晚于今天按今天截断')
  assert.deepEqual(entries.map(entry => entry.startedDate), ['2026-10-22'])
})

test('collectWorklogs 不设范围仍带今天上界', async () => {
  const transport = jiraWith([], { 'A-1': [WL('2026-10-22', 3600, 'x'), WL('2026-10-30', 3600, '预填')] })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const entries = await engine.collectWorklogs(client, 'carol', undefined, undefined, '2026-10-23')
  const jql = decodeURIComponent(transport.calls[0]!.url.replaceAll('+', ' '))
  assert.ok(jql.includes('worklogDate <= "2026-10-23"'))
  assert.ok(!jql.includes('worklogDate >='))
  assert.deepEqual(entries.map(entry => entry.startedDate), ['2026-10-22'])
})

test('collectWorklogs started 严格过滤＋作者过滤＋小时与备注规整', async () => {
  const transport = jiraWith([], {
    'A-1': [
      WL('2026-10-18', 3600, '窗外（早于 from）'),
      WL('2026-10-19', 5400, '  多 空白\n备注  '),
      WL('2026-10-19', 7200, '别人的日志', 'alice'),
    ],
  })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const entries = await engine.collectWorklogs(client, 'carol', '2026-10-19', '2026-10-23', '2026-10-23')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.hours, 1.5)
  assert.equal(entries[0]!.comment, '多 空白 备注')
  assert.equal(entries[0]!.issueKey, 'A-1')
})

test('collectWorklogs 全程仅 GET', async () => {
  const transport = jiraWith([], { 'A-1': [WL('2026-10-19', 3600, 'x')] })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  await engine.collectWorklogs(client, 'carol', undefined, undefined, '2026-10-23')
  assert.ok(transport.calls.length > 0)
  assert.ok(transport.calls.every(call => call.method === 'GET'))
})

// ---- lastActiveWeek / weekdayCN ----

const entry = (day: string) => ({ startedDate: day, hours: 1, issueKey: 'A-1', summary: 's', comment: 'c' })

test('lastActiveWeek 周中日 → 所在自然周周一~周日', async () => {
  assert.deepEqual(
    engine.lastActiveWeek([entry('2026-10-12'), entry('2026-10-16'), entry('2026-10-09')]),
    { monday: '2026-10-12', sunday: '2026-10-18' },
  )
})

test('lastActiveWeek 最晚落在周一/周日 边界', async () => {
  assert.deepEqual(engine.lastActiveWeek([entry('2026-10-19')]), { monday: '2026-10-19', sunday: '2026-10-25' })
  assert.deepEqual(engine.lastActiveWeek([entry('2026-10-18')]), { monday: '2026-10-12', sunday: '2026-10-18' })
})

test('lastActiveWeek 空集 → undefined', async () => {
  assert.equal(engine.lastActiveWeek([]), undefined)
})

test('weekdayCN 中文星期', async () => {
  assert.equal(engine.weekdayCN('2026-10-23'), '周五')
  assert.equal(engine.weekdayCN('2026-10-18'), '周日')
  assert.equal(engine.weekdayCN('2026-10-19'), '周一')
})

// ---- T03：service 查询映射族 ----
const svc = await import('../src/service.ts')
const E = (day: string, hours: number, key = 'A-1', summary = '任务一', comment = '备注') =>
  ({ startedDate: day, hours, issueKey: key, summary, comment })

test('aggregateToDays 日倒序、组内耗时升序、链接与合计', () => {
  const days = svc.aggregateToDays([
    E('2026-10-19', 6, 'DEMO-880', 'Q4日常事务', '周会'),
    E('2026-10-23', 1, 'DEMO-3927', 'SKA', '跟进'),
    E('2026-10-23', 6.5, 'DEMO-880', 'Q4日常事务', '方案'),
    E('2026-10-19', 2, 'A-2', '任务二', 'x'),
  ], 'https://jira.example/')
  assert.deepEqual(days.map(d => d.date), ['2026-10-23', '2026-10-19'])
  assert.equal(days[0]!.weekday, '周五')
  assert.equal(days[0]!.totalHours, 7.5)
  assert.deepEqual(days[0]!.entries.map(e => e.hours), [1, 6.5])
  assert.equal(days[0]!.entries[0]!.issueUrl, 'https://jira.example/browse/DEMO-3927')
  assert.equal(days[1]!.totalHours, 8)
})

test('aggregateToDays 空集 → 空数组', () => {
  assert.deepEqual(svc.aggregateToDays([], 'https://jira'), [])
})

test('fallbackNotice 含原窗口（三态）与回溯周', () => {
  const week = { monday: '2026-10-12', sunday: '2026-10-18' }
  const both = svc.fallbackNotice('王帅', 'bob', '2026-10-17', '2026-10-23', week)
  assert.ok(both.includes('王帅（bob）'), both)
  assert.ok(both.includes('2026-10-17 至 2026-10-23'), both)
  assert.ok(both.includes('2026-10-12 至 2026-10-18'), both)
  assert.ok(svc.fallbackNotice('王', 'w', '2026-10-17', undefined, week).includes('2026-10-17 起'))
  assert.ok(svc.fallbackNotice('王', 'w', undefined, '2026-10-23', week).includes('至 2026-10-23'))
  assert.ok(svc.fallbackNotice('王', 'w', undefined, undefined, week).includes('不限日期'))
})

test('noLogsNotice 含姓名与无任何日志口径', () => {
  const text = svc.noLogsNotice('王帅', 'bob01')
  assert.ok(text.includes('王帅（bob01）') && text.includes('无任何'), text)
})

test('notFoundNotice 含禁用/离职说明', () => {
  const text = svc.notFoundNotice('不存在的人')
  assert.ok(text.includes('不存在的人') && text.includes('禁用') && text.includes('离职'), text)
})

test('ambiguousNotice 列候选与登录 ID 指引；满 20 注明截断', () => {
  const three = svc.ambiguousNotice('王帅', [
    { name: 'bob', displayName: '王帅' },
    { name: 'bob01', displayName: '王帅' },
    { name: 'bob_hz', displayName: '王帅' },
  ])
  assert.ok(three.includes('bob（王帅）') && three.includes('登录 ID'), three)
  assert.ok(!three.includes('仅显示前 20'))
  const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `u${i}`, displayName: '同' }))
  assert.ok(svc.ambiguousNotice('同', twenty).includes('仅显示前 20'))
})

test('PERMISSION_NOTE 携带可浏览项目口径', () => {
  assert.ok(svc.PERMISSION_NOTE.includes('可浏览'), svc.PERMISSION_NOTE)
})

// ---- T04：flows queryFlow 编排 ----
const flows = await import('../src/flows.ts')
const { HttpError } = await import('../src/engine/types.ts')

function queryDeps(over: {
  fake?: ReturnType<typeof fakeJira>
  configured?: boolean
  makeClientError?: Error
} = {}) {
  const transport = over.fake ?? fakeJira()
  return {
    deps: {
      engineConfig: () => ({ jira: { server: 'https://jira', username: 'u', password: 'p', verifySsl: false }, gitlab: [], repoFilter: [] }),
      jiraConfigured: () => over.configured ?? true,
      makeClient: (jira: { server: string; username: string; password: string; verifySsl: boolean }) =>
        new engine.JiraClient(jira.server, jira.username, jira.password, transport, jira.verifySsl),
    } as never,
    transport,
  }
}

const HE_HUIMIN = [{ name: 'carol', displayName: '何慧敏', active: true }]
const WLH = (day: string, seconds: number, comment = '日常') => ({
  id: day + seconds, started: `${day}T09:30:00.000+0800`, timeSpent: 'x', timeSpentSeconds: seconds,
  comment, author: { name: 'carol', displayName: '何慧敏' },
})

test('queryFlow 凭据未配置 → 配置引导（零网络）', async () => {
  const { deps, transport } = queryDeps({ configured: false })
  await assert.rejects(() => flows.queryFlow(deps, { name: '何慧敏' }), /插件页/)
  assert.equal(transport.calls.length, 0)
})

test('queryFlow myself 空体 → 凭据口径（非查无此人）', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ myself: {}, userSearch: HE_HUIMIN }) })
  await assert.rejects(() => flows.queryFlow(deps, { name: '何慧敏' }), /未返回当前用户|凭据/)
})

test('queryFlow myself 401 → 认证失败凭据文案', async () => {
  const rejectMyself: engine.Transport = (method, url) => {
    if (url.endsWith('/rest/api/2/myself')) return Promise.reject(new HttpError(401, 'Unauthorized'))
    return Promise.resolve({})
  }
  const deps = {
    engineConfig: () => ({ jira: { server: 'https://jira', username: 'u', password: 'p', verifySsl: false }, gitlab: [], repoFilter: [] }),
    jiraConfigured: () => true,
    makeClient: (jira: { server: string; username: string; password: string; verifySsl: boolean }) =>
      new engine.JiraClient(jira.server, jira.username, jira.password, rejectMyself, jira.verifySsl),
  } as never
  await assert.rejects(() => flows.queryFlow(deps, { name: '何慧敏' }), /Jira 认证失败（401\/403/)
})

test('queryFlow 窗口命中 → ok 视图（days＋permissionNote）', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ userSearch: HE_HUIMIN, logs: {
    'A-1': [WLH('2026-10-22', 3600), WLH('2026-10-23', 7200, '方案')],
  } }) })
  const view = await flows.queryFlow(deps, { name: '何慧敏', from: '2026-10-17', to: '2026-10-23' }, '2026-10-23')
  assert.equal(view.status, 'ok')
  assert.equal(view.displayName, '何慧敏')
  assert.deepEqual(view.days!.map(d => d.date), ['2026-10-23', '2026-10-22'])
  assert.equal(view.permissionNote, svc.PERMISSION_NOTE)
  assert.equal(view.notice, undefined)
})

test('queryFlow 窗口空 → 回溯最后活跃周（notice 含原窗口与周）', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ userSearch: HE_HUIMIN, logs: {
    'A-1': [WLH('2026-10-13', 3600), WLH('2026-10-15', 3600)],
  } }) })
  const view = await flows.queryFlow(deps, { name: '何慧敏', from: '2026-10-17', to: '2026-10-23' }, '2026-10-23')
  assert.equal(view.status, 'ok')
  assert.ok(view.notice!.includes('2026-10-17 至 2026-10-23'), view.notice ?? '')
  assert.ok(view.notice!.includes('2026-10-12 至 2026-10-18'), view.notice ?? '')
  assert.deepEqual(view.days!.map(d => d.date), ['2026-10-15', '2026-10-13'])
})

test('queryFlow 不限窗口且无历史 → no-logs', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ userSearch: HE_HUIMIN, logs: {} }) })
  const view = await flows.queryFlow(deps, { name: '何慧敏' }, '2026-10-23')
  assert.equal(view.status, 'no-logs')
  assert.ok(view.notice!.includes('无任何可见日志'))
})

test('queryFlow 窗口空且历史也无 → no-logs（经回溯扫描）', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ userSearch: HE_HUIMIN, logs: {} }) })
  const view = await flows.queryFlow(deps, { name: '何慧敏', from: '2026-10-17', to: '2026-10-23' }, '2026-10-23')
  assert.equal(view.status, 'no-logs')
})

test('queryFlow 同名 → ambiguous（候选剥离 active 字段）', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ userSearch: [
    { name: 'bob', displayName: '王帅', active: true },
    { name: 'bob01', displayName: '王帅', active: false },
  ] }) })
  const view = await flows.queryFlow(deps, { name: '王帅' }, '2026-10-23')
  assert.equal(view.status, 'ambiguous')
  assert.deepEqual(view.candidates, [{ name: 'bob', displayName: '王帅' }, { name: 'bob01', displayName: '王帅' }])
  assert.ok(view.notice!.includes('登录 ID'))
})

test('queryFlow 查无此人 → not-found（含禁用/离职说明）', async () => {
  const { deps } = queryDeps({ fake: fakeJira({ userSearch: [] }) })
  const view = await flows.queryFlow(deps, { name: '不存在的人' }, '2026-10-23')
  assert.equal(view.status, 'not-found')
  assert.ok(view.notice!.includes('禁用') && view.notice!.includes('离职'))
})

test('queryFlow 网络错误原样传播（不吞消息不伪装）', async () => {
  const boom: engine.Transport = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1'))
  const deps = {
    engineConfig: () => ({ jira: { server: 'https://jira', username: 'u', password: 'p', verifySsl: false }, gitlab: [], repoFilter: [] }),
    jiraConfigured: () => true,
    makeClient: (jira: { server: string; username: string; password: string; verifySsl: boolean }) =>
      new engine.JiraClient(jira.server, jira.username, jira.password, boom, jira.verifySsl),
  } as never
  await assert.rejects(() => flows.queryFlow(deps, { name: '何慧敏' }), /ECONNREFUSED/)
})

test('queryFlow 全程仅 GET', async () => {
  const { deps, transport } = queryDeps({ fake: fakeJira({ userSearch: HE_HUIMIN, logs: { 'A-1': [WLH('2026-10-22', 3600)] } }) })
  await flows.queryFlow(deps, { name: '何慧敏', from: '2026-10-17', to: '2026-10-23' }, '2026-10-23')
  assert.ok(transport.calls.length > 0)
  assert.ok(transport.calls.every(call => call.method === 'GET'))
})

// ---- T05：index 接线源断言（index.ts 为运行时胶水，不进 node --test 行为级）----
const indexSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')

test('index：query 远程方法与描述符行在位', () => {
  assert.ok(/async query\(/.test(indexSource), 'query 方法在位')
  assert.ok(indexSource.includes("{ method: 'query', invocation: { kind: 'direct' } }"), '描述符行在位')
})

test('index：query 参数校验在位（空名/日期形/from≤to）', () => {
  assert.ok(indexSource.includes("name 不能为空"), '空名校验')
  assert.ok(/from 必须/.test(indexSource) && /to 必须/.test(indexSource), '日期形态校验')
  assert.ok(/开始日期/.test(indexSource) && /晚于/.test(indexSource), 'from≤to 校验')
})

// ---- T02 review 加固回填（PASS 后 minor 处置） ----

test('collectWorklogs 畸形/缺失 started 一致丢弃（from 有无两路径）', async () => {
  const broken = { id: 'b1', started: 'not-a-date', timeSpentSeconds: 3600, comment: 'x', author: { name: 'carol' } }
  const missing = { id: 'b2', timeSpentSeconds: 3600, comment: 'x', author: { name: 'carol' } }
  const transport = jiraWith([], { 'A-1': [broken, missing, WL('2026-10-20', 3600, '日常')] })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const withFrom = await engine.collectWorklogs(client, 'carol', '2026-10-17', '2026-10-23', '2026-10-23')
  const noFrom = await engine.collectWorklogs(client, 'carol', undefined, undefined, '2026-10-23')
  assert.deepEqual(withFrom.map(e => e.startedDate), ['2026-10-20'])
  assert.deepEqual(noFrom.map(e => e.startedDate), ['2026-10-20'])
})

test('resolveUser 空 name 脏候选不入池', async () => {
  const client = new engine.JiraClient('https://jira', 'u', 'p', jiraWith([
    { name: '', displayName: '何慧敏', active: true },
  ]))
  assert.deepEqual(await engine.resolveUser(client, '何慧敏'), { status: 'not-found' })
})

test('lastActiveWeek/weekdayCN 跨月跨年闰日边界', () => {
  assert.deepEqual(engine.lastActiveWeek([entry('2026-12-31')]), { monday: '2026-12-28', sunday: '2027-01-03' })
  assert.deepEqual(engine.lastActiveWeek([entry('2026-11-01')]), { monday: '2026-10-26', sunday: '2026-11-01' })
  assert.equal(engine.weekdayCN('2028-02-29'), '周二')
})
