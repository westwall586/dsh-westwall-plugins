// T04 判定用例：提交校验全集（validate）。
// 断言口径移植自参考实现 validate_plan 与相关测试（占位前缀、
// 日期=目标日、总工时下限、hours 一致性、重复条目、裸 key、adjust 枚举、
// load_entries 确认收敛）；说明长度 40/60 分档已移除（20261028 用户裁决）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../../src/engine/index.ts'

const LONG_40 = '控制台非安全上下文复制修复，飞书登录迭代验收上线，llms.txt文档梳理整理归档评审' // 43 字：>40 ≤60
const OK_COMMENT = '需求拆解与方案设计'

function planEntry(overrides: Record<string, unknown> = {}) {
  return {
    issue_key: 'DEMO-745',
    task_name: '示例任务甲',
    time_spent: '8h',
    hours: 8,
    started: '2026-09-21T09:00:00.000+0800',
    comment: OK_COMMENT,
    adjust_estimate: 'auto',
    ...overrides,
  }
}

function validPlan(entriesOverrides: Record<string, unknown>[] = [planEntry()], planOverrides: Record<string, unknown> = {}) {
  return {
    schema: 'jira-worklog-plan.v1',
    target_date: '2026-09-21',
    today_existing_hours: 0,
    entries: entriesOverrides,
    ...planOverrides,
  }
}

test('合法计划零错误', () => {
  assert.deepEqual(engine.validate(validPlan()), [])
})

test('空条目与坏 schema 拒绝', () => {
  assert.ok(engine.validate({ ...validPlan(), entries: [] }).some(e => e.includes('没有可提交条目')))
  assert.ok(engine.validate({ ...validPlan(), schema: 'other' }).some(e => e.includes('schema 不受支持')))
})

test('占位前缀或空说明拒绝', () => {
  assert.ok(engine.validate(validPlan([planEntry({ comment: '待用户补充真实工作说明' })])).some(e => e.includes('缺少已确认的真实工作说明')))
  assert.ok(engine.validate(validPlan([planEntry({ comment: '待用户确认：feat(X-1): 业务开发' })])).some(e => e.includes('缺少已确认的真实工作说明')))
})

test('说明长度不再校验（20261028）——超长说明无论口径均通过', () => {
  assert.deepEqual(engine.validate(validPlan([planEntry({ comment: LONG_40 })])), [])
  assert.deepEqual(engine.validate(validPlan([planEntry({ comment: LONG_40, comment_source: 'user_confirmed' })])), [])
  const over60 = LONG_40 + '整理与归档评审补充材料清单完整核对一遍' // 43+19=62
  assert.ok(over60.length > 60)
  assert.deepEqual(engine.validate(validPlan([planEntry({ comment: over60, comment_source: 'user_confirmed' })])), [])
  assert.deepEqual(engine.validate(validPlan([planEntry({ comment: over60 })])), [])
})

test('条目开始日期必须等于目标日，错误提示按日重跑', () => {
  const errors = engine.validate(validPlan([planEntry({ started: '2026-09-20T09:00:00.000+0800' })]))
  assert.ok(errors.some(e => e.includes('开始日期不是目标日')))
  assert.ok(errors.some(e => e.includes('重跑')))
})

test('hours 与 time_spent 不一致拒绝', () => {
  assert.ok(engine.validate(validPlan([planEntry({ hours: 7 })])).some(e => e.includes('hours 与 time_spent 不一致')))
})

test('重复条目拒绝', () => {
  assert.ok(engine.validate(validPlan([planEntry(), planEntry()])).some(e => e.includes('与前面条目重复')))
})

test('任务名不得为裸 Jira key、key 形态校验、adjust 枚举', () => {
  assert.ok(engine.validate(validPlan([planEntry({ task_name: 'DEMO-745' })])).some(e => e.includes('任务名不能只显示 Jira key')))
  assert.ok(engine.validate(validPlan([planEntry({ issue_key: 'bad' })])).some(e => e.includes('Jira key 无效')))
  assert.ok(engine.validate(validPlan([planEntry({ adjust_estimate: 'new' })])).some(e => e.includes('剩余估算策略不支持')))
})

test('当天总工时不足下限拒绝；minimum_hours 由计划携带（周末豁免 0）', () => {
  assert.ok(engine.validate(validPlan([planEntry({ time_spent: '7h', hours: 7 })])).some(e => e.includes('不足 8h')))
  assert.deepEqual(engine.validate(validPlan([planEntry({ time_spent: '7h', hours: 7 })], { minimum_hours: 0 })), [])
  // 已有工时计入总量
  assert.deepEqual(engine.validate(validPlan([planEntry({ time_spent: '2h', hours: 2, started: '2026-09-21T11:00:00.000+0800' })], { today_existing_hours: 6 })), [])
})

test('loadEntries 确认收敛：旧副本草稿采纳已确认说明', () => {
  const confirmed = planEntry({ comment: '控制台复制修复', comment_source: 'user_confirmed' })
  const stale = planEntry({ comment: '待用户确认：延续「旧说明」', comment_source: 'recent_history' })
  const data = {
    schema: 'jira-worklog-plan.v1',
    target_date: '2026-09-21',
    today_existing_hours: 0,
    submission_entries: [stale],
    suggested_entries: [confirmed],
  }
  const entries = engine.loadEntries(data)
  assert.equal(entries[0]!.comment, '控制台复制修复')
  assert.equal(entries[0]!.comment_source, 'user_confirmed')
})

test('validate 消费 loadEntries 收敛结果（submission + suggested 双份形态通过）', () => {
  const confirmed = planEntry({ comment: '控制台复制修复', comment_source: 'user_confirmed' })
  const stale = planEntry({ comment: '待用户确认：延续「旧说明」', comment_source: 'recent_history' })
  const data = {
    schema: 'jira-worklog-plan.v1',
    target_date: '2026-09-21',
    today_existing_hours: 0,
    submission_entries: [stale],
    suggested_entries: [confirmed],
  }
  assert.deepEqual(engine.validate(data), [])
})
