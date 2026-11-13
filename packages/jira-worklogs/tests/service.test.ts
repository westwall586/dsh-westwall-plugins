// 判定用例：jiraWorklogs 服务层纯映射（弹窗改版五映射 + 凭据错误结构化，2026-09-24 Wave）。
// 20261015 Wave：暂存/素材契约扩展映射（outboxOverviewFrom/notesViewFrom/outboxEntryFrom/outboxToDraft）。
// 旧动线映射（overviewFromPlan/materialForDays/draftPromptText）已随会话式生成移除；
// 服务类接线（TypertRemoteService）经真实运行时验证，不在 node --test 覆盖范围。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  credentialsIssue, monthOverviewFrom, dayDetailFrom, draftDocumentFrom, submitRequestToPlanDoc, submitReportFrom,
  outboxOverviewFrom, notesViewFrom, outboxEntryFrom, outboxToDraft,
} from '../src/service.ts'
import { validate } from '../src/engine/validate.ts'

test('credentialsIssue：凭据错误结构化（SPEC 场景 11）', () => {
  const issue = credentialsIssue(new Error('缺少 Jira 配置：插件设置不可用，请在插件页 Jira 工时记录 详情页完成配置'))
  assert.equal(issue.error, 'jira-credentials')
  assert.ok(issue.message.includes('插件页'))
  assert.equal(credentialsIssue(new Error('network down')).error, 'network')
  // 网关空体凭据异常也走结构化
  const empty = credentialsIssue(new Error('Jira 未返回当前用户（凭据无效或网关异常）'))
  assert.equal(empty.error, 'jira-credentials')
})

// ---- T04 判定用例：弹窗改版五映射（月视图/日详情/草稿文档/提交重组/回报映射）----

const statusRows = [
  { date: '2026-09-18', hours: 2, gap_hours: 6, status: 'gap' },
  { date: '2026-09-21', hours: 8, gap_hours: 0, status: 'full' },
]

test('monthOverviewFrom：行映射与缺口计数', () => {
  const view = monthOverviewFrom(statusRows as never, '2026-09-24')
  assert.equal(view.today, '2026-09-24')
  assert.equal(view.month, '2026-09')
  assert.equal(view.gapCount, 1)
  assert.deepEqual(view.rows[0], { date: '2026-09-18', loggedHours: 2, gapHours: 6, status: 'gap' })
  assert.deepEqual(view.rows[1], { date: '2026-09-21', loggedHours: 8, gapHours: 0, status: 'full' })
})

test('monthOverviewFrom：有登记的周末/调休行（exempt）映射 full——月历 ✓ 口径（20261029）', () => {
  const view = monthOverviewFrom([
    { date: '2026-09-19', hours: 8, gap_hours: 0, status: 'exempt' },
  ] as never, '2026-09-24')
  assert.deepEqual(view.rows[0], { date: '2026-09-19', loggedHours: 8, gapHours: 0, status: 'full' })
  assert.equal(view.gapCount, 0, '调休周末不计缺口')
})

const regs = {
  date: '2026-09-21',
  workday: true,
  hours: 2,
  tasks: [
    { issue_key: 'DEMO-745', task_name: '', entries: [{ time_range: '09:00-11:00', hours: 2, comment: '联调' }] },
  ],
  git: [
    { project: 'grp/one', push_count: 2, commits: [{ title: 'fix: A', time: '10:00' }, { title: 'fix: B', time: '11:00' }] },
  ],
}

test('dayDetailFrom：缺口计算、名称回退、Git 汇总', () => {
  const view = dayDetailFrom(regs as never)
  assert.equal(view.workday, true)
  assert.equal(view.loggedHours, 2)
  assert.equal(view.gapHours!, 6)
  assert.equal(view.tasks[0]!.name, '未解析任务')
  assert.deepEqual(view.tasks[0]!.entries, [{ timeRange: '09:00-11:00', hours: 2, comment: '联调' }])
  assert.deepEqual(view.git, {
    pushes: 2, commits: 2,
    byProject: [{ project: 'grp/one', commits: [{ title: 'fix: A', time: '10:00' }, { title: 'fix: B', time: '11:00' }] }],
  })
})

test('dayDetailFrom：周末无缺口字段；无素材 git 为 null', () => {
  const view = dayDetailFrom({ ...regs, workday: false, git: [] } as never)
  assert.equal('gapHours' in view, false)
  assert.equal(view.git, null)
})

const material = {
  date: '2026-09-21', loggedHours: 2, gapHours: 6, existing: [],
  tasks: [{ id: 1, name: '插件设置迁移' }, { id: 2, name: '工时插件引擎联调' }],
  gitByProject: [], suggested: [], taskKeys: new Map(),
}

test('draftDocumentFrom：草稿文档投影', () => {
  const doc = draftDocumentFrom(material as never, {
    draftId: 'd-1',
    entries: [{ taskId: 1, start: '11:00', end: '13:00', comment: '完成迁移与验证' }],
  }, 4200)
  assert.equal(doc.draftId, 'd-1')
  assert.equal(doc.date, '2026-09-21')
  assert.equal(doc.elapsedMs, 4200)
  assert.deepEqual(doc.tasks, [{ id: 1, name: '插件设置迁移' }, { id: 2, name: '工时插件引擎联调' }])
  assert.deepEqual(doc.entries[0], { taskId: 1, start: '11:00', end: '13:00', comment: '完成迁移与验证' })
})

const context = { date: '2026-09-21', taskKeys: new Map([[1, { key: 'DEMO-745', name: '插件设置迁移' }]]) }

test('submitRequestToPlanDoc：重组引擎计划文档并通过引擎校验', () => {
  const request = {
    draftId: 'd-1',
    entries: [
      { taskId: 1, start: '11:00', end: '13:00', comment: '完成设置迁移与热生效验证', userEdited: false },
      { taskId: 1, start: '14:00', end: '18:00', comment: '修复写路径双头并回归', userEdited: false },
    ],
  }
  const doc = submitRequestToPlanDoc(request as never, context as never, 2)
  assert.equal(doc.schema, 'jira-worklog-plan.v1')
  assert.equal(doc.today_existing_hours, 2)
  assert.equal(doc.minimum_hours, 8)
  assert.equal((doc.entries as { issue_key: string }[])[0]!.issue_key, 'DEMO-745')
  assert.equal((doc.entries as { started: string }[])[0]!.started, '2026-09-21T11:00:00.000+0800')
  assert.equal((doc.entries as { time_spent: string }[])[0]!.time_spent, '2h')
  assert.equal((doc.entries as { comment_source: string }[])[0]!.comment_source, 'model_draft')
  assert.deepEqual(validate(doc), [])
})

test('submitRequestToPlanDoc：userEdited 标记 user_confirmed；超长说明不再拦截', () => {
  const long = '用'.repeat(50)
  const edited = submitRequestToPlanDoc({
    draftId: 'd', entries: [{ taskId: 1, start: '11:00', end: '13:00', comment: long, userEdited: true }],
  } as never, context as never, 6)
  assert.equal((edited.entries as { comment_source: string }[])[0]!.comment_source, 'user_confirmed')
  assert.deepEqual(validate(edited), [])
  const unedited = submitRequestToPlanDoc({
    draftId: 'd', entries: [{ taskId: 1, start: '11:00', end: '13:00', comment: long, userEdited: false }],
  } as never, context as never, 6)
  assert.equal((unedited.entries as { comment_source: string }[])[0]!.comment_source, 'model_draft')
  assert.deepEqual(validate(unedited), [], '说明长度不再校验（20261028 用户裁决）')
})

test('submitRequestToPlanDoc：未知 taskId 抛可读错误', () => {
  assert.throws(
    () => submitRequestToPlanDoc({
      draftId: 'd', entries: [{ taskId: 9, start: '11:00', end: '12:00', comment: 'x', userEdited: false }],
    } as never, context as never, 7),
    /候选/,
  )
})

test('submitReportFrom：按序对回与状态映射（success→ok）', () => {
  const dayReport = {
    schema: 'jira-worklog-submit.v1', status: 'partial', target_date: '2026-09-21', errors: [],
    results: [
      { issue_key: 'DEMO-745', task_name: '插件设置迁移', time_spent: '2h', started: 'x', time_range: '', comment: 'c1', status: 'written' },
      { issue_key: 'DEMO-745', task_name: '插件设置迁移', time_spent: '4h', started: 'y', time_range: '', comment: 'c2', status: 'uncertain', error: '回读未确认' },
    ],
  }
  const request = {
    draftId: 'd',
    entries: [
      { taskId: 1, start: '11:00', end: '13:00', comment: 'c1', userEdited: false },
      { taskId: 1, start: '14:00', end: '18:00', comment: 'c2', userEdited: false },
    ],
  }
  const report = submitReportFrom(dayReport as never, request as never, [
    'https://jira.example.com/browse/DEMO-745', 'https://jira.example.com/browse/DEMO-745',
  ])
  assert.equal(report.status, 'partial')
  assert.deepEqual(report.results, [
    { taskId: 1, start: '11:00', end: '13:00', status: 'written', issueUrl: 'https://jira.example.com/browse/DEMO-745' },
    {
      taskId: 1, start: '14:00', end: '18:00', status: 'uncertain',
      reason: '回读未确认（写入结果未确认——请点「到 Jira 核对」人工查证；确认未写入后可再次提交，提交前查重不会写重）',
      issueUrl: 'https://jira.example.com/browse/DEMO-745',
    },
  ])
  const ok = submitReportFrom({ status: 'success', errors: [], results: [] } as never, request as never)
  assert.equal(ok.status, 'ok')
})

test('submitReportFrom：uncertain 无原始原因也给默认核对语义（D-unclear）', () => {
  const dayReport = {
    schema: 'jira-worklog-submit.v1', status: 'failed', target_date: '2026-10-08', errors: [],
    results: [
      { issue_key: 'DEMO-772', task_name: 't', time_spent: '8h', started: 'x', time_range: '', comment: 'c', status: 'uncertain' },
    ],
  }
  const request = { draftId: 'd', entries: [{ taskId: 1, start: '09:00', end: '17:00', comment: 'c', userEdited: false }] }
  const report = submitReportFrom(dayReport as never, request as never)
  assert.equal(report.results[0].status, 'uncertain')
  assert.ok(report.results[0].reason!.startsWith('写入请求已发出，但回读未确认是否落库'))
  assert.ok(report.results[0].reason!.includes('到 Jira 核对'))
})

test('submitReportFrom：blocked 透传日级原因', () => {
  const report = submitReportFrom({ status: 'blocked', errors: ['当天总工时为 6h，不足 8h'], results: [] } as never, { draftId: 'd', entries: [] } as never)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(report.errors, ['当天总工时为 6h，不足 8h'])
})

// ---- 20261015 Wave：暂存/素材契约扩展映射 ----

const NOW = '2026-10-15T09:00:00+08:00'

test('outboxOverviewFrom：概要映射与总数聚合', () => {
  const view = outboxOverviewFrom([{ date: '2026-10-13', count: 1 }, { date: '2026-10-15', count: 3 }])
  assert.deepEqual(view, { days: [{ date: '2026-10-13', count: 1 }, { date: '2026-10-15', count: 3 }], total: 4 })
})

test('notesViewFrom：素材视图（无 issue key）与缺席 undefined', () => {
  const view = notesViewFrom({
    date: '2026-10-14', createdAt: NOW, updatedAt: NOW,
    items: [{ id: 'n-1', issueKey: 'DEMO-745', taskName: '插件设置迁移', text: '继续迁移收尾', createdAt: NOW, updatedAt: NOW }],
  })
  assert.deepEqual(view, [{ id: 'n-1', taskName: '插件设置迁移', text: '继续迁移收尾' }])
  assert.ok(!JSON.stringify(view).includes('DEMO-745'), '键不进客户端视图')
  assert.equal(notesViewFrom(undefined), undefined)
})

test('outboxEntryFrom：请求条目＋任务引用＋失败形态 → 暂存条目', () => {
  const entry = outboxEntryFrom(
    { start: '11:00', end: '13:00', comment: '完成迁移', userEdited: true },
    { key: 'DEMO-745', name: '插件设置迁移' },
    'uncertain', '回读未确认',
  )
  assert.deepEqual(entry, {
    issueKey: 'DEMO-745', taskName: '插件设置迁移', start: '11:00', end: '13:00',
    comment: '完成迁移', userEdited: true, lastStatus: 'uncertain', lastError: '回读未确认',
  })
})

const outboxRecord = {
  date: '2026-10-14', createdAt: NOW, updatedAt: NOW,
  entries: [
    { issueKey: 'DEMO-745', taskName: '插件设置迁移', start: '11:00', end: '13:00', comment: '完成迁移', userEdited: true, lastStatus: 'failed' },
    { issueKey: 'DEMO-900', taskName: '暂存专属任务', start: '14:00', end: '16:00', comment: '评审会', userEdited: false, lastStatus: 'uncertain' },
  ],
}

test('outboxToDraft：回显文档——elapsedMs 0、lastStatus/userEdited 携带、uncertain 附核对链接、键不进文档', () => {
  const keyToId = new Map([['DEMO-745', 1], ['DEMO-900', 2]])
  const doc = outboxToDraft(
    outboxRecord as never,
    [{ id: 1, name: '插件设置迁移' }, { id: 2, name: '暂存专属任务' }],
    key => keyToId.get(key)!,
    'd-outbox-1',
    { loggedHours: 2, gapHours: 6 },
    'https://jira.example.com',
  )
  assert.equal(doc.draftId, 'd-outbox-1')
  assert.equal(doc.date, '2026-10-14')
  assert.equal(doc.elapsedMs, 0, '暂存回显无生成耗时')
  assert.deepEqual(doc.tasks, [{ id: 1, name: '插件设置迁移' }, { id: 2, name: '暂存专属任务' }])
  assert.deepEqual(doc.entries[0], { taskId: 1, start: '11:00', end: '13:00', comment: '完成迁移', userEdited: true, lastStatus: 'failed' })
  assert.equal(doc.entries[1]!.lastStatus, 'uncertain')
  assert.equal(doc.entries[1]!.issueUrl, 'https://jira.example.com/browse/DEMO-900', 'uncertain 条目核对链接')
  assert.equal(doc.entries[0]!.issueUrl, undefined, 'failed 条目不带链接')
  assert.ok(!JSON.stringify(doc).includes('DEMO-745'), '键不进客户端文档')
})

test('outboxToDraft：idOf 解析不到抛可读错误（候选集须先并入暂存任务）', () => {
  assert.throws(
    () => outboxToDraft(outboxRecord as never, [{ id: 1, name: '插件设置迁移' }], () => undefined as never, 'd', { loggedHours: 0, gapHours: 8 }, 'https://x'),
    /候选/,
  )
})

test('draftDocumentFrom：可选 degradedNotes 透传（降级提示载体）', () => {
  const doc = draftDocumentFrom(material as never, {
    draftId: 'd-1',
    entries: [{ taskId: 1, start: '11:00', end: '13:00', comment: '完成迁移与验证' }],
  }, 4200, ['素材任务『X』在 Jira 已不可解析，对应素材未纳入本次生成'])
  assert.deepEqual(doc.degradedNotes, ['素材任务『X』在 Jira 已不可解析，对应素材未纳入本次生成'])
  const plain = draftDocumentFrom(material as never, { draftId: 'd-1', entries: [] }, 1)
  assert.equal(plain.degradedNotes, undefined, '无降级不带字段')
})
