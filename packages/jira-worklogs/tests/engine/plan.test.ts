// T03 判定用例：排班草案与素材组装（plan）。
// 断言口径移植自参考实现 PlanTest / AllocationTest / CalendarOverrideTest 与
// GitActivityTest 的 extract_issue_evidence / split_hours / build_git_day_entries 部分。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../../src/engine/index.ts'
import { fakeJira, issueData, myselfData, worklogItem } from './helpers.ts'

const MONDAY = '2026-09-21'

function log(day: string, hours: number, comment: string, key = 'DEMO-772', author = 'alice') {
  return worklogItem(`${key}-${day}-${hours}`, day, engine.hoursToJira(hours), Math.round(hours * 3600), comment, author)
}

test('plan 按当前用户与窗口过滤（他人/周末/未来不计）', async () => {
  const fake = fakeJira({
    logs: {
      'DEMO-745': [
        worklogItem('1', '2026-09-14', '2h', 7200, '方案梳理'),
        worklogItem('2', '2026-09-13', '1d', 28800, '周末记录'),
        worklogItem('3', '2026-09-15', '4h', 14400, '他人记录', 'other'),
        worklogItem('4', '2026-09-21', '1h', 3600, '今日已有'),
      ],
    },
  })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const candidate = result.candidates[0]!
  assert.deepEqual(candidate.history_worklogs.map((item: { id: string }) => item.id), ['1'])
  assert.equal(candidate.today_hours, 1)
  assert.equal(result.today_existing_hours, 1)
})

test('scheduleEntries 从 09:00 连续排班；已有工时从最晚结束时刻续排', () => {
  const entries = [
    { issue_key: 'A-1', task_name: '任务 A', time_spent: '2h', hours: 2, comment: '待用户确认：A' },
    { issue_key: 'B-2', task_name: '任务 B', time_spent: '3h', hours: 3, comment: '待用户确认：B' },
  ]
  const scheduled = engine.scheduleEntries(entries, MONDAY)
  assert.equal(scheduled[0]!.started, '2026-09-21T09:00:00.000+0800')
  assert.equal(scheduled[0]!.time_range, '09:00-11:00')
  assert.equal(scheduled[1]!.started, '2026-09-21T11:00:00.000+0800')
  assert.equal(scheduled[1]!.time_range, '11:00-14:00')

  // scheduleEntries 消费归一化后的 daily 条目（hours 为折算字段，参考 plan() 调用形态）
  const existing = [{ hours: 2, started: '2026-09-21T09:00:00.000+0800' }]
  const continued = engine.scheduleEntries(entries.slice(0, 1), MONDAY, existing)
  assert.equal(continued[0]!.started, '2026-09-21T11:00:00.000+0800')
})

test('userProposal 隐藏 issue key，任务名取 summary', () => {
  const proposal = engine.userProposal([{
    issue_key: 'DEMO-745',
    task_name: '示例任务甲',
    date: '2026-09-21',
    time_range: '09:00-11:00',
    time_spent: '2h',
    comment: '待用户确认：整理需求',
  }])
  assert.equal(proposal[0]!.task_name, '示例任务甲')
  assert.ok(!('issue_key' in proposal[0]!))
})

test('plan 输出单副本与总量（冷启动集中单问题 8h）', async () => {
  const fake = fakeJira()
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake, false), MONDAY, { includeGit: false })) as any
  assert.equal(result.schema, 'jira-worklog-plan.v1')
  assert.ok(!('submission_entries' in result))
  assert.ok(Array.isArray(result.user_proposal))

  const two = fakeJira({ issues: [issueData('示例任务甲', 'DEMO-745'), issueData('示例任务乙', 'DEMO-772')] })
  const result2 = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', two), MONDAY, { includeGit: false })) as any
  assert.equal(result2.suggested_entries.reduce((sum: number, item: { hours: number }) => sum + item.hours, 0), 8)
  assert.equal(result2.planned_total_hours, 8)
})

test('plan 报告逐日缺口与历史归属建议', async () => {
  const fake = fakeJira({
    issues: [issueData('示例任务乙', 'DEMO-772')],
    logs: {
      'DEMO-772': [
        log('2026-09-14', 8, '满'),
        log('2026-09-15', 8, '满'),
        log('2026-09-16', 8, '满'),
        log('2026-09-17', 2, '部分'),
      ],
    },
  })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const daily = Object.fromEntries(result.worklog_check.daily.map((row: { date: string }) => [row.date, row]))
  assert.equal(daily['2026-09-14']!.status, 'full')
  assert.equal(daily['2026-09-17']!.status, 'gap')
  assert.equal(daily['2026-09-17']!.gap_hours, 6)
  assert.equal(daily['2026-09-18']!.status, 'gap')
  assert.equal(daily['2026-09-18']!.gap_hours, 8)
  assert.equal(result.worklog_check.history_gap_hours, 14)
  const suggestions = Object.fromEntries(result.gap_suggestions.map((item: { date: string }) => [item.date, item]))
  assert.equal(suggestions['2026-09-17']!.issue_key, 'DEMO-772')
  assert.equal(suggestions['2026-09-17']!.time_spent, '6h')
  assert.equal(suggestions['2026-09-18']!.issue_key, 'DEMO-772')
  assert.ok(suggestions['2026-09-18']!.basis.includes('最近有记录'))
})

test('周末目标日豁免', async () => {
  const fake = fakeJira()
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), '2026-09-20', { includeGit: false })) as any
  const targetRow = result.worklog_check.daily.find((row: { is_target: boolean }) => row.is_target)!
  assert.equal(targetRow.status, 'exempt')
  assert.equal(result.minimum_hours, 0)
  assert.deepEqual(result.suggested_entries, [])
})

test('目标日已填计数含非关注问题，other_logged_issues 记录', async () => {
  const fake = fakeJira({ logs: { 'OTHER-1': [log('2026-09-21', 8, '非关注问题上的工时', 'OTHER-1')] }, worklogIssues: [{ key: 'OTHER-1' }] })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  assert.equal(result.today_existing_hours, 8)
  assert.deepEqual(result.suggested_entries, [])
  assert.deepEqual(result.other_logged_issues, ['OTHER-1'])
})

test('当日已满且历史有记录时返回空建议不报错（remaining=0）', async () => {
  const fake = fakeJira({
    issues: [issueData('示例任务乙', 'DEMO-772')],
    logs: {
      'DEMO-772': [
        log('2026-09-18', 8, '示例任务乙推进'),
        log('2026-09-21', 8, '今日已满'),
      ],
    },
  })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  assert.deepEqual(result.suggested_entries, [])
  assert.equal(result.planned_total_hours, 8)
})

test('目标日集中于单一活跃问题（延续历史）', async () => {
  const fake = fakeJira({
    issues: [issueData('示例任务乙', 'DEMO-772'), issueData('示例任务甲', 'DEMO-745')],
    logs: { 'DEMO-772': Array.from({ length: 5 }, (_, i) => log(`2026-09-${14 + i}`, 8, '示例任务乙推进')) },
  })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const suggested = result.suggested_entries
  assert.deepEqual(suggested.map((item: { issue_key: string }) => item.issue_key), ['DEMO-772'])
  assert.equal(suggested[0]!.hours, 8)
  assert.equal(suggested[0]!.comment_source, 'recent_history')
  assert.ok(suggested[0]!.comment.startsWith('待用户确认：延续「'))
})

test('顺延草案集中最近工作日的问题，不回头均摊', async () => {
  const fake = fakeJira({
    issues: [issueData('早期任务', 'AAA-1'), issueData('近期任务', 'BBB-2')],
    logs: {
      'AAA-1': [log('2026-09-14', 8, '早期任务', 'AAA-1')],
      'BBB-2': [log('2026-09-18', 8, '近期任务', 'BBB-2')],
    },
  })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const suggested = result.suggested_entries
  assert.deepEqual(suggested.map((item: { issue_key: string }) => item.issue_key), ['BBB-2'])
  assert.equal(suggested[0]!.hours, 8)
  assert.ok(suggested[0]!.basis.includes('顺延'))
})

test('同日多问题按该日小时比例顺延（2h/6h → 6h/2h）', async () => {
  const fake = fakeJira({
    issues: [issueData('示例任务甲', 'DEMO-745'), issueData('示例任务乙', 'DEMO-772')],
    logs: {
      'DEMO-772': [log('2026-09-18', 2, '联调', 'DEMO-772')],
      'DEMO-745': [log('2026-09-18', 6, '部署', 'DEMO-745')],
    },
  })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const hours = Object.fromEntries(result.suggested_entries.map((item: { issue_key: string; hours: number }) => [item.issue_key, item.hours]))
  assert.deepEqual(Object.keys(hours).sort(), ['DEMO-745', 'DEMO-772'])
  assert.equal(Object.values(hours).reduce((a: number, b: number) => a + b, 0), 8)
  assert.equal(hours['DEMO-745'], 6)
  assert.equal(hours['DEMO-772'], 2)
})

test('冷启动默认单一关注问题并显式标记待确认', async () => {
  const fake = fakeJira({ issues: [issueData('示例任务甲', 'DEMO-745'), issueData('示例任务乙', 'DEMO-772')] })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const suggested = result.suggested_entries
  assert.deepEqual(suggested.map((item: { issue_key: string }) => item.issue_key), ['DEMO-745'])
  assert.equal(suggested[0]!.hours, 8)
  assert.equal(suggested[0]!.comment_source, 'cold_start')
  assert.ok(result.pending_confirmations.some((item: string) => item.includes('请确认或改指')))
})

test('缺口建议携带历史说明草案', async () => {
  const fake = fakeJira({ issues: [issueData('示例任务乙', 'DEMO-772')], logs: { 'DEMO-772': [log('2026-09-17', 2, '部分推进')] } })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const byDate = Object.fromEntries(result.gap_suggestions.map((item: { date: string }) => [item.date, item]))
  assert.equal(byDate['2026-09-17']!.comment, '待用户确认：延续「部分推进」')
  assert.equal(byDate['2026-09-17']!.comment_source, 'recent_history')
})

test('调休上班日进入窗口并要求 8h', async () => {
  const fake = fakeJira()
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false, workdays: ['2026-09-20'] })) as any
  const rows = Object.fromEntries(result.worklog_check.daily.map((row: { date: string }) => [row.date, row]))
  assert.ok('2026-09-20' in rows)
  assert.equal(rows['2026-09-20']!.required, true)
  assert.equal(rows['2026-09-20']!.status, 'gap')
  assert.equal(rows['2026-09-20']!.gap_hours, 8)
  assert.ok(!('2026-09-14' in rows))
  assert.deepEqual(result.calendar_overrides.workdays, ['2026-09-20'])
})

test('调休日作为目标日生成建议', async () => {
  const fake = fakeJira({ issues: [issueData('示例任务乙', 'DEMO-772')], logs: { 'DEMO-772': [log('2026-09-18', 8, '示例任务乙推进')] } })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), '2026-09-20', { includeGit: false, workdays: ['2026-09-20'] })) as any
  assert.equal(result.minimum_hours, 8)
  const suggested = result.suggested_entries
  assert.deepEqual(suggested.map((item: { issue_key: string }) => item.issue_key), ['DEMO-772'])
  assert.equal(suggested[0]!.hours, 8)
  assert.ok(suggested[0]!.started.startsWith('2026-09-20T'))
})

test('声明节假日豁免该工作日', async () => {
  const fake = fakeJira()
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false, holidays: ['2026-09-17'] })) as any
  const rows = Object.fromEntries(result.worklog_check.daily.map((row: { date: string }) => [row.date, row]))
  assert.ok(!('2026-09-17' in rows))
  assert.ok('2026-09-11' in rows)
  assert.deepEqual(result.calendar_overrides.holidays, ['2026-09-17'])
})

test('extractIssueEvidence 忽略 Merge 与日期式编号', () => {
  const commits = [
    { title: 'feat(DEMO-8228): 完成需求' },
    { title: 'fix: DEMO-8228 补充校验' },
    { title: "Merge branch 'feature/DEMO-8228' into main" },
    { title: '[PRD-20260915-v1.0] 需求文档' },
  ]
  assert.deepEqual(engine.extractIssueEvidence(commits), {
    'DEMO-8228': ['feat(DEMO-8228): 完成需求', 'fix: DEMO-8228 补充校验'],
  })
})

test('splitHours 按权重分摊且保总量（0.5h 粒度）', () => {
  assert.deepEqual(engine.splitHours(8, [3, 1]), [6, 2])
  assert.deepEqual(engine.splitHours(2, [5, 1, 1, 1]), [0.5, 0.5, 0.5, 0.5])
})

test('buildGitDayEntries 生成可确认说明（按 key 分配、含证据上限）', () => {
  const entries = engine.buildGitDayEntries('2026-09-17', 8, [{
    project: 'sdlc/agents',
    commits: [
      { title: 'feat(DEMO-8228): 业务开发' } as never,
      { title: 'fix(DEMO-8228): 补校验' } as never,
      { title: 'docs(DEMO-8192): 更新方案' } as never,
    ],
  }] as never) as { issue_key: string; hours: number; comment: string; comment_source: string }[]
  assert.deepEqual(entries.map((item: { issue_key: string }) => item.issue_key), ['DEMO-8192', 'DEMO-8228'])
  assert.equal(entries.reduce((sum: number, item: { hours: number }) => sum + item.hours, 0), 8)
  assert.ok(entries.every((item: { comment: string }) => item.comment.startsWith('待用户确认：')))
  assert.ok(entries.every((item: { comment_source: string }) => item.comment_source === 'git_commits'))
})

test('缺口建议优先采用 Git 提交证据的 key', () => {
  const rows = [{ date: '2026-09-17', is_target: false, status: 'gap', gap_hours: 8 }]
  const gitByDate = {
    '2026-09-17': [{
      commits: [
        { title: 'feat(DEMO-8228): 业务开发' } as never,
        { title: 'fix(DEMO-8228): 补校验' } as never,
        { title: 'docs(DEMO-8192): 更新方案' } as never,
      ],
    }],
  }
  const suggestions = engine.suggestGapFills(rows as never, {} as never, ['DEMO-745'], gitByDate as never) as { issue_key: string; hours: number; comment: string; comment_source: string }[]
  assert.deepEqual(suggestions.map((item: { issue_key: string }) => item.issue_key), ['DEMO-8192', 'DEMO-8228'])
  assert.equal(suggestions.reduce((sum: number, item: { hours: number }) => sum + item.hours, 0), 8)
  assert.ok(suggestions.every((item: { comment_source: string }) => item.comment_source === 'git_commits'))
  assert.ok(suggestions.every((item: { comment: string }) => item.comment.startsWith('待用户确认：')))
})

test('plan 端到端经 validate 校验通过（round-trip）', async () => {
  const fake = fakeJira()
  const data = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  // 冷启动草案带「待用户」前缀——round-trip 校验应报告待确认说明（非结构性错误）
  const errors = engine.validate({ ...data, entries: data.suggested_entries })
  assert.ok(errors.every(error => !error.includes('schema') && !error.includes('可提交条目') && !error.includes('开始日期')))
  assert.ok(errors.some(error => error.includes('缺少已确认的真实工作说明')))
})

test('myself 视图脱敏：只保留身份四字段', async () => {
  const fake = fakeJira({ myself: { ...myselfData(), password: 'should-not-leak', extra: 'x' } })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, { includeGit: false })) as any
  const mine = result.myself as Record<string, unknown>
  assert.deepEqual(Object.keys(mine).sort(), ['displayName', 'emailAddress', 'key', 'name'])
})

test('plan 透传 repoFilter：命中名单的仓库不进素材（迭代二 T01）', async () => {
  const { fakeGitlab } = await import('./helpers.ts')
  const transport = fakeGitlab(
    { id: 387, username: 'alice' },
    [
      { project_id: 10, created_at: '2026-09-21T03:00:00Z', push_data: {} },
      { project_id: 30, created_at: '2026-09-21T04:00:00Z', push_data: {} },
    ],
    { 10: { path_with_namespace: 'grp/one' }, 30: { path_with_namespace: 'ops/context-repo-9' } },
    {
      10: [{ short_id: 'a1', title: 'feat: 开发', author_name: 'alice', committed_date: '2026-09-21T01:00:00Z' }],
      30: [{ short_id: 'b1', title: 'chore: 同步', author_name: 'alice', committed_date: '2026-09-21T01:00:00Z' }],
    },
  )
  const fake = fakeJira({ logs: {} })
  const result = ( await engine.plan(new engine.JiraClient('https://jira', 'u', 'p', fake), MONDAY, {
    includeGit: true,
    gitInstances: [{ url: 'http://git', token: 't', verifySsl: false }],
    repoFilter: ['context-repo'],
    gitClientFactory: () => new engine.GitlabClient('http://git', 't', transport),
  })) as any
  const git = result.git_activity as { by_date: Record<string, { project: string }[]>, instances: { filtered_context_repos?: string[] }[] }
  assert.deepEqual(git.by_date[MONDAY]!.map(item => item.project), ['grp/one'])
  assert.deepEqual(git.instances[0]!.filtered_context_repos, ['ops/context-repo-9'])
})
