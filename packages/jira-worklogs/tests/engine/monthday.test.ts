// T01 判定用例：月历状态与日详情的轻查询编排（monthStatus / dayRegistrations）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../../src/engine/index.ts'
import { fakeGitlab, fakeJira, issueData, worklogItem } from './helpers.ts'

test('monthStatus 输出当月（至今天）逐日行：工作日全量＋有登记周末，未登记周末不出行', async () => {
  const fake = fakeJira({ logs: { 'DEMO-745': [
    worklogItem('1', '2026-09-21', '2h', 7200, '联调'),
    worklogItem('2', '2026-09-19', '8h', 28800, '调休补班'),
  ] } })
  const rows = (await engine.monthStatus(new engine.JiraClient('https://jira', 'u', 'p', fake), '2026-09-24')) as any[]
  const dates = rows.map(row => row.date)
  // 9/1-9/24 工作日 18 天＋有登记的周六 9/19（调休）＝19；未登记周末（9/5、9/20）不出行
  assert.equal(dates.length, 19)
  assert.ok(!dates.includes('2026-09-05') && !dates.includes('2026-09-20'), '未登记周末不出行')
  const sat19 = rows.find(row => row.date === '2026-09-19')!
  assert.equal(sat19.status, 'exempt', '调休周末按豁免口径（不计缺口）')
  assert.equal(sat19.hours, 8)
  assert.equal(sat19.gap_hours, 0)
  const day21 = rows.find(row => row.date === '2026-09-21')!
  assert.equal(day21.hours, 2)
  assert.equal(day21.gap_hours, 6)
  assert.equal(day21.status, 'gap')
  const day22 = rows.find(row => row.date === '2026-09-22')!
  assert.equal(day22.hours, 0)
  assert.equal(day22.gap_hours, 8)
  assert.equal(day22.status, 'gap')
})

test('monthStatus 不拉关注问题（watched JQL）与 Git', async () => {
  const fake = fakeJira({})
  await engine.monthStatus(new engine.JiraClient('https://jira', 'u', 'p', fake), '2026-09-24')
  assert.ok(fake.calls.length > 0)
  assert.ok(fake.calls.every(call => !call.url.includes('watchedIssues')))
})

test('monthStatus 月首即周末（1 日为周六）：无登记周末被过滤，返回空行不抛错（终审 F1 语义保留）', async () => {
  const fake = fakeJira({})
  const rows = (await engine.monthStatus(new engine.JiraClient('https://jira', 'u', 'p', fake), '2026-08-01')) as any[]
  assert.deepEqual(rows, [], '唯一窗口日为无登记周六——exempt 空行被过滤（20261029 逐日全量后不再有零查询空窗）')
})

test('dayRegistrations 返回全量登记（含非候选任务）与名称解析', async () => {
  const fake = fakeJira({
    logs: {
      'DEMO-745': [worklogItem('1', '2026-09-21', '3h', 10800, '方案梳理')],
      'OTHER-9': [worklogItem('2', '2026-09-21', '5h', 18000, '支援处理')],
    },
    issueGet: { 'OTHER-9': issueData('临时支援任务', 'OTHER-9') },
  })
  const regs = (await engine.dayRegistrations(new engine.JiraClient('https://jira', 'u', 'p', fake), [], [], '2026-09-21')) as any
  assert.equal(regs.date, '2026-09-21')
  assert.equal(regs.workday, true)
  assert.equal(regs.hours, 8)
  const other = regs.tasks.find((task: any) => task.issue_key === 'OTHER-9')!
  assert.equal(other.task_name, '临时支援任务')
  assert.equal(other.entries.length, 1)
  assert.equal(other.entries[0].hours, 5)
  assert.equal(other.entries[0].comment, '支援处理')
  assert.match(other.entries[0].time_range, /^\d{2}:\d{2}-\d{2}:\d{2}$/)
})

test('dayRegistrations 未解析名回退空串；周末 workday=false 且无缺口概念', async () => {
  const fake = fakeJira({ logs: { 'GHOST-1': [worklogItem('1', '2026-09-19', '2h', 7200, '周末加班')] } })
  const regs = (await engine.dayRegistrations(new engine.JiraClient('https://jira', 'u', 'p', fake), [], [], '2026-09-19')) as any
  assert.equal(regs.workday, false)
  assert.equal(regs.hours, 2)
  assert.equal(regs.tasks.length, 1)
  assert.equal(regs.tasks[0].task_name, '')
  assert.equal(regs.tasks[0].entries[0].hours, 2)
})

test('dayRegistrations 采集单日 Git 素材', async () => {
  const fake = fakeJira({})
  const git = fakeGitlab(
    { id: 387, username: 'alice' },
    [{ project_id: 42, created_at: '2026-09-21T03:00:00Z', push_data: { commit_count: 1 } }],
    { 42: { path_with_namespace: 'grp/dsh-jira-worklogs' } },
    { 42: [{ short_id: 'a1', title: 'fix: 修复写路径', author_name: 'alice', committed_date: '2026-09-21T01:00:00Z' }] },
  )
  const regs = (await engine.dayRegistrations(
    new engine.JiraClient('https://jira', 'u', 'p', fake),
    [{ url: 'https://git', token: 't', verifySsl: false }],
    [],
    '2026-09-21',
    () => new engine.GitlabClient('https://git', 't', git),
  )) as any
  assert.equal(regs.git.length, 1)
  assert.equal(regs.git[0].project, 'grp/dsh-jira-worklogs')
  assert.equal(regs.git[0].commits[0].title, 'fix: 修复写路径')
})
