// T01 判定用例：引擎基础（types/dates/env）。
// 断言口径移植自参考实现 tests/test_jira_worklog.py（DateAndParsingTest、
// CalendarOverrideTest 的窗口语义、GitActivityTest 的 env/commit_local_date 部分），
// 并按 SPEC 场景 11 补 Jira 凭据缺失错误用例。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as engine from '../../src/engine/index.ts'

const MONDAY = '2026-09-21' // 周一

test('workdaysBefore 近 5 个工作日排除周末', () => {
  assert.deepEqual(engine.workdaysBefore(MONDAY), [
    '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18',
  ])
})

test('workdaysBefore 调休上班日进入窗口并挤最早一日', () => {
  const days = engine.workdaysBefore(MONDAY, 5, ['2026-09-20'], [])
  assert.ok(days.includes('2026-09-20'))
  assert.ok(!days.includes('2026-09-14'))
})

test('workdaysBefore 声明节假日排除该工作日', () => {
  const days = engine.workdaysBefore(MONDAY, 5, [], ['2026-09-17'])
  assert.ok(!days.includes('2026-09-17'))
  assert.ok(days.includes('2026-09-11'))
})

test('isWorkday 默认周一至五', () => {
  assert.equal(engine.isWorkday('2026-09-19'), false) // 周六
  assert.equal(engine.isWorkday('2026-09-20'), false) // 周日
  assert.equal(engine.isWorkday(MONDAY), true)
  assert.equal(engine.isWorkday('2026-09-20', ['2026-09-20'], []), true)
  assert.equal(engine.isWorkday(MONDAY, [], [MONDAY]), false)
})

test('parseTimeSpent 按 Jira 八小时日制折算', () => {
  assert.equal(engine.parseTimeSpent('1d 2h'), 10)
  assert.equal(engine.parseTimeSpent('30m'), 0.5)
  assert.equal(engine.parseTimeSpent('1w'), 40)
})

test('parseTimeSpent 非法输入报可读错误', () => {
  assert.throws(() => engine.parseTimeSpent(''), /不能为空/)
  assert.throws(() => engine.parseTimeSpent('abc'), /不支持的 Jira 工时格式/)
  assert.throws(() => engine.parseTimeSpent('0h'), /必须大于 0/)
})

test('hoursToJira 整点带 h、带分拆 h+m', () => {
  assert.equal(engine.hoursToJira(2.5), '2h 30m')
  assert.equal(engine.hoursToJira(8), '8h')
  assert.equal(engine.hoursToJira(0.5), '30m')
})

test('commitLocalDate UTC 折算东八区、无时区按 UTC、空返回 null', () => {
  assert.equal(engine.commitLocalDate('2026-09-15T16:30:00.000Z'), '2026-09-16')
  assert.equal(engine.commitLocalDate('2026-09-15T01:00:00.000+08:00'), '2026-09-15')
  assert.equal(engine.commitLocalDate('2026-09-15T01:00:00.000'), '2026-09-15') // 无时区按 UTC → 09:00+08 同日
  assert.equal(engine.commitLocalDate(''), null)
})

test('parseStarted 无时区按东八区、formatStarted 输出 +0800 形态', () => {
  const started = engine.parseStarted('2026-09-21T09:00:00.000+0800')
  assert.ok(started)
  assert.equal(engine.formatStarted(started), '2026-09-21T09:00:00.000+0800')
  const naive = engine.parseStarted('2026-09-21T09:00:00.000')
  assert.ok(naive)
  assert.equal(engine.formatStarted(naive), '2026-09-21T09:00:00.000+0800')
  const utc = engine.parseStarted('2026-09-21T01:00:00.000Z')
  assert.ok(utc)
  assert.equal(engine.formatStarted(utc), '2026-09-21T09:00:00.000+0800')
  assert.equal(engine.formatTimeRange(utc, 2), '09:00-11:00')
  assert.equal(engine.parseStarted(''), null)
})

test('parseDate 非法日期报可读错误', () => {
  assert.equal(engine.parseDate('2026-09-21'), '2026-09-21')
  assert.throws(() => engine.parseDate('2026/9/21'), /日期必须是 YYYY-MM-DD/)
})

// 迭代二一次性切换：~/.sdlc env 装载（loadJiraConfig/loadGitlabInstances/parseEnvFile）
// 已删除，原用例随之移除；覆盖语义迁移至 tests/settings.test.ts（engineConfigFrom）。
// 此处保留 JIRA_* 环境变量覆盖 helper 的最小行为锚点。
test('envJiraOverrides：仅返回已设置的 JIRA_* 键（调试后门，D13）', () => {
  const prev = { ...process.env }
  try {
    delete process.env.JIRA_SERVER
    delete process.env.JIRA_VERIFY_SSL
    process.env.JIRA_USERNAME = 'env-user'
    const overrides = engine.envJiraOverrides()
    assert.deepEqual(Object.keys(overrides).sort(), ['username'])
    assert.equal(overrides.username, 'env-user')
    process.env.JIRA_VERIFY_SSL = 'true'
    assert.equal(engine.envJiraOverrides().verifySsl, true)
  } finally {
    for (const key of ['JIRA_SERVER', 'JIRA_USERNAME', 'JIRA_PASSWORD', 'JIRA_VERIFY_SSL']) {
      if (prev[key] === undefined) delete process.env[key]
      else process.env[key] = prev[key]
    }
  }
})
