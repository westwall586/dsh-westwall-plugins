// T05 判定用例：写入链路（submit）。
// 断言口径移植自参考实现 SubmitTest 与 NetworkSemanticsTest 的 submit 部分；
// 多日封装与 confirm 收紧（dry-run 亦须确认）为插件契约用例（PLAN/F20）。
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../../src/engine/index.ts'
import { fakeJira, flaky } from './helpers.ts'

beforeEach(() => {
  engine.clientConfig.GET_RETRY_DELAY = 0
})

function confirmedPlan(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'jira-worklog-plan.v1',
    target_date: '2026-09-21',
    today_existing_hours: 0,
    entries: [{
      issue_key: 'DEMO-745',
      task_name: '需求交付agent优化',
      time_spent: '8h',
      hours: 8,
      started: '2026-09-21T09:00:00.000+0800',
      comment: '需求拆解与方案设计',
      adjust_estimate: 'auto',
    }],
    ...overrides,
  }
}

async function submitPlan(plan: unknown, options: { confirm?: boolean; dryRun?: boolean } = {}) {
  const transport = fakeJira()
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const report = await engine.submitDay(client, plan as never, { confirm: options.confirm ?? true, dryRun: options.dryRun ?? false })
  return { report, transport }
}

test('未确认直接拒绝且零 POST', async () => {
  const { report, transport } = await submitPlan(confirmedPlan(), { confirm: false })
  assert.equal(report.status, 'blocked')
  assert.ok(report.errors[0]!.includes('缺少确认'))
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 0)
})

test('dry-run 仍须确认（有意收紧），确认后 would_write 零 POST', async () => {
  const { report, transport } = await submitPlan(confirmedPlan(), { confirm: false, dryRun: true })
  assert.equal(report.status, 'blocked')
  const dry = await submitPlan(confirmedPlan(), { confirm: true, dryRun: true })
  assert.equal(dry.report.status, 'success')
  assert.equal(dry.report.results[0]!.status, 'would_write')
  assert.equal(dry.transport.calls.filter(call => call.method === 'POST').length, 0)
})

test('确认后写入并回读，adjustEstimate 走 query 参数', async () => {
  const { report, transport } = await submitPlan(confirmedPlan())
  assert.equal(report.status, 'success')
  assert.equal(report.results[0]!.status, 'written')
  const post = transport.calls.find(call => call.method === 'POST')!
  assert.ok(post.url.includes('adjustEstimate=auto'))
  assert.ok(!('adjustEstimate' in (post.body as Record<string, unknown>)))
})

test('结果条目保留任务字段（任务名与时间段）', async () => {
  const { report } = await submitPlan(confirmedPlan())
  const item = report.results[0]!
  assert.equal(item.task_name, '需求交付agent优化')
  assert.equal(item.time_range, '09:00-17:00')
})

test('总工时不足 8h 阻塞且零 POST', async () => {
  const plan = confirmedPlan()
  ;(plan.entries as Record<string, unknown>[])[0]!.time_spent = '7h 59m'
  const { report, transport } = await submitPlan(plan)
  assert.equal(report.status, 'blocked')
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 0)
})

test('完全匹配条目查重跳过', async () => {
  const transport = fakeJira({ logs: { 'DEMO-745': [{
    id: 'x',
    started: '2026-09-21T09:00:00.000+0800',
    timeSpent: '8h',
    timeSpentSeconds: 28800,
    comment: '需求拆解与方案设计',
    author: { name: 'alice' },
  }] } })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const report = await engine.submitDay(client, confirmedPlan() as never, { confirm: true })
  assert.equal(report.results[0]!.status, 'skipped')
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 0)
})

test('同任务范围五维查重：跨任务同人同时长同说明不误判', async () => {
  const transport = fakeJira({ logs: { 'OTHER-9': [{
    id: 'y',
    started: '2026-09-21T09:00:00.000+0800',
    timeSpent: '8h',
    timeSpentSeconds: 28800,
    comment: '需求拆解与方案设计',
    author: { name: 'alice' },
  }] } })
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const report = await engine.submitDay(client, confirmedPlan() as never, { confirm: true })
  // DEMO-745 名下无匹配 → 正常写入（skipped 误判会把漏写伪装成已写）
  assert.equal(report.results[0]!.status, 'written')
})

test('占位说明阻塞；超长说明放行（20261028 用户裁决——长度不再校验）', async () => {
  const placeholder = confirmedPlan()
  ;(placeholder.entries as Record<string, unknown>[])[0]!.comment = '待用户补充真实工作说明'
  assert.equal((await submitPlan(placeholder)).report.status, 'blocked')
  const draft = confirmedPlan()
  ;(draft.entries as Record<string, unknown>[])[0]!.comment = '待用户确认：feat(DEMO-8228): 业务开发'
  assert.equal((await submitPlan(draft)).report.status, 'blocked')
  const overlong = confirmedPlan()
  ;(overlong.entries as Record<string, unknown>[])[0]!.comment = 'Docker 发布形态落地：重写部署文档，新增部署脚本并修复校验；关闭隐式构建去除依赖；沙箱控制台上线'
  const { report } = await submitPlan(overlong)
  assert.equal(report.status, 'success')
  assert.equal(report.results[0]!.status, 'written')
})

test('旧格式双副本确认收敛后正常写入', async () => {
  const confirmed = {
    issue_key: 'DEMO-745',
    task_name: '需求交付agent优化',
    time_spent: '8h',
    hours: 8,
    started: '2026-09-21T09:00:00.000+0800',
    comment: '控制台复制修复',
    comment_source: 'user_confirmed',
    adjust_estimate: 'auto',
  }
  const stale = { ...confirmed, comment: '待用户确认：延续「旧说明」', comment_source: 'recent_history' }
  const plan = { ...confirmedPlan(), entries: undefined, submission_entries: [stale], suggested_entries: [confirmed] }
  const { report, transport } = await submitPlan(plan)
  assert.equal(report.results[0]!.status, 'written')
  const post = transport.calls.find(call => call.method === 'POST')!
  assert.equal((post.body as { comment: string }).comment, '控制台复制修复')
})

test('POST HTTP 错误报 failed 带 HTTP 状态，且仅一次 POST', async () => {
  const inner = fakeJira()
  const transport = flaky(inner, 'POST', url => url.includes('/worklog'), new engine.HttpError(403, 'Forbidden'))
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const report = await engine.submitDay(client, confirmedPlan() as never, { confirm: true })
  assert.equal(report.status, 'failed')
  assert.equal(report.results[0]!.status, 'failed')
  assert.ok(String(report.results[0]!.error).includes('HTTP 403'))
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 1)
})

test('POST 网络错误记 uncertain，本批次不二次 POST', async () => {
  const transport = flaky(fakeJira(), 'POST', url => url.includes('/worklog'), new Error('connection reset'))
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const report = await engine.submitDay(client, confirmedPlan() as never, { confirm: true })
  assert.equal(report.results[0]!.status, 'uncertain')
  assert.equal(transport.calls.filter(call => call.method === 'POST').length, 1)
})

test('条目开始日期不符提示按日重跑（校验集成）', async () => {
  const plan = confirmedPlan()
  ;(plan.entries as Record<string, unknown>[])[0]!.started = '2026-09-20T09:00:00.000+0800'
  const { report } = await submitPlan(plan)
  assert.equal(report.status, 'blocked')
  assert.ok(report.errors.some(error => error.includes('重跑')))
})

test('多日提交：某日校验失败按日隔离，整体 partial', async () => {
  const transport = fakeJira()
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const bad = confirmedPlan()
  ;(bad.entries as Record<string, unknown>[])[0]!.comment = '待用户补充真实工作说明'
  const other = confirmedPlan({ target_date: '2026-09-18', entries: [{
    issue_key: 'DEMO-745',
    task_name: '需求交付agent优化',
    time_spent: '8h',
    hours: 8,
    started: '2026-09-18T09:00:00.000+0800',
    comment: '引擎移植与联调',
    adjust_estimate: 'auto',
  }] })
  const report = await engine.submit(client, [other, bad] as never[], { confirm: true })
  assert.equal(report.overall, 'partial')
  const byDate = Object.fromEntries(report.per_day.map(day => [day.target_date, day]))
  assert.equal(byDate['2026-09-21']!.status, 'blocked')
  assert.ok((byDate['2026-09-21']!.errors ?? []).length > 0)
  assert.equal(byDate['2026-09-18']!.status, 'success')
  assert.equal(byDate['2026-09-18']!.results[0]!.status, 'written')
})

test('多日提交：次 myself 网络事故不吞掉已写日的回报（review F1）', async () => {
  let myselfCalls = 0
  const inner = fakeJira()
  const transport: engine.Transport = (method, url, init) => {
    if (url.endsWith('/rest/api/2/myself')) {
      myselfCalls += 1
      if (myselfCalls > 1) return Promise.reject(new Error('connection reset'))
      return Promise.resolve(inner(method, url, init))
    }
    return Promise.resolve(inner(method, url, init))
  }
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const day2 = confirmedPlan({ target_date: '2026-09-18', entries: [{
    issue_key: 'DEMO-745',
    task_name: '需求交付agent优化',
    time_spent: '8h',
    hours: 8,
    started: '2026-09-18T09:00:00.000+0800',
    comment: '引擎移植与联调',
    adjust_estimate: 'auto',
  }] })
  const report = await engine.submit(client, [confirmedPlan() as never, day2 as never], { confirm: true })
  assert.equal(report.overall, 'partial')
  const written = report.per_day.find(day => day.target_date === '2026-09-21')!
  assert.equal(written.results[0]!.status, 'written')
  const failedDay = report.per_day.find(day => day.target_date === '2026-09-18')!
  assert.equal(failedDay.status, 'failed')
})

test('空计划数组 overall 为 failed（review F3）', async () => {
  const client = new engine.JiraClient('https://jira', 'u', 'p', fakeJira())
  const report = await engine.submit(client, [], { confirm: true })
  assert.equal(report.overall, 'failed')
  assert.deepEqual(report.per_day, [])
})

test('校验失败零网络副作用：连 myself 都不查（review F4）', async () => {
  const transport = fakeJira()
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const bad = confirmedPlan()
  ;(bad.entries as Record<string, unknown>[])[0]!.comment = '待用户补充真实工作说明'
  await engine.submitDay(client, bad as never, { confirm: true })
  assert.equal(transport.calls.length, 0)
})

test('POST 成功但查证读连续失败 → uncertain 且仅一次 POST（review F4）', async () => {
  let postDone = false
  const calls: string[] = []
  const inner = fakeJira()
  const transport: engine.Transport = (method, url, init) => {
    calls.push(method)
    if (method === 'POST') {
      postDone = true
      return Promise.resolve(inner(method, url, init))
    }
    if (postDone && url.includes('/worklog')) {
      return Promise.reject(new Error('connection reset'))
    }
    return Promise.resolve(inner(method, url, init))
  }
  const client = new engine.JiraClient('https://jira', 'u', 'p', transport)
  const report = await engine.submitDay(client, confirmedPlan() as never, { confirm: true })
  assert.equal(report.results[0]!.status, 'uncertain')
  assert.equal(calls.filter(method => method === 'POST').length, 1)
})
