// T03 判定用例：生成模块（素材映射 / fail-closed 解析 / 收流 / 纪律指令）＋素材扩展（20261015 Wave）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SYSTEM_PROMPT, buildMaterial, parseDraft, runGeneration, dropUnresolvableNoteTasks,
  type DraftTask, type Material,
} from '../src/generate.ts'
import type { DayRegistrationsOut } from '../src/engine/plan.ts'
import type { NoteEntry } from '../src/store/domain.ts'

const planOut = {
  schema: 'jira-worklog-plan.v1',
  target_date: '2026-09-21',
  today_existing_hours: 2,
  minimum_hours: 8,
  worklog_check: { daily: [{ date: '2026-09-21', hours: 2, gap_hours: 6, status: 'gap', is_target: true }] },
  candidates: [
    { issue_key: 'DEMO-745', task_name: '插件设置迁移', today_hours: 0, today_worklogs: [], history_worklogs: [{ comment: '完成配置读写', hours: 2 }] },
    { issue_key: 'DEMO-772', task_name: '工时插件引擎联调', today_hours: 2, today_worklogs: [{ started: '2026-09-21T09:00:00.000+0800', hours: 2, comment: '联调' }], history_worklogs: [] },
  ],
  other_logged_issues: ['OTHER-9'],
  git_activity: { by_date: { '2026-09-21': [{ project: 'grp/one', push_count: 1, commits: [{ title: 'fix: 修复 X', time: '10:00' }] }] } },
  suggested_entries: [{ issue_key: 'DEMO-745', time_range: '11:00-13:00', hours: 2, comment: '完成设置迁移' }],
}

const dayRegs: DayRegistrationsOut = {
  date: '2026-09-21',
  workday: true,
  hours: 2,
  tasks: [
    { issue_key: 'DEMO-772', task_name: '工时插件引擎联调', entries: [{ time_range: '09:00-11:00', hours: 2, comment: '联调' }] },
    { issue_key: 'OTHER-9', task_name: '临时支援任务', entries: [{ time_range: '13:00-14:00', hours: 1, comment: '支援' }] },
  ],
  git: [],
}

test('buildMaterial：id 映射、existing 时段、候选并集与脱敏（键不进素材）', () => {
  const material = buildMaterial(planOut as never, dayRegs)
  assert.equal(material.date, '2026-09-21')
  assert.equal(material.loggedHours, 2)
  assert.equal(material.gapHours, 6)
  // tasks = watched candidates 在前 + 当日已登记非 watched（OTHER-9）在后
  assert.deepEqual(material.tasks.map(task => task.name), ['插件设置迁移', '工时插件引擎联调', '临时支援任务'])
  assert.equal(material.tasks[0]!.id, 1)
  assert.equal(material.tasks[2]!.todayHours, 1)
  assert.deepEqual(material.tasks[0]!.recentComments, ['完成配置读写'])
  assert.deepEqual(material.existing, [
    { task: '工时插件引擎联调', start: '09:00', end: '11:00' },
    { task: '临时支援任务', start: '13:00', end: '14:00' },
  ])
  assert.deepEqual(material.gitByProject, [{ project: 'grp/one', commits: ['fix: 修复 X'] }])
  assert.deepEqual(material.suggested, [{ taskId: 1, start: '11:00', end: '13:00', hours: 2 }])
  assert.equal(material.taskKeys.get(1), 'DEMO-745')
  assert.equal(material.taskKeys.get(3), 'OTHER-9')
})

test('buildMaterial：未解析的非 watched 任务不进候选', () => {
  const regs: DayRegistrationsOut = {
    ...dayRegs,
    tasks: [{ issue_key: 'GHOST-1', task_name: '', entries: [] }, dayRegs.tasks[0]!],
  }
  const material = buildMaterial(planOut as never, regs)
  assert.ok(!material.tasks.some(task => task.name === ''))
  assert.ok(![...material.taskKeys.values()].includes('GHOST-1'))
})

const tasks: DraftTask[] = [
  { id: 1, name: '插件设置迁移' },
  { id: 2, name: '工时插件引擎联调' },
]

test('parseDraft：合法输出解析为条目', () => {
  const { entries } = parseDraft('{"entries":[{"task_id":1,"start":"11:00","end":"13:00","comment":"完成设置迁移与热生效验证"}]}', tasks)
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0], { taskId: 1, start: '11:00', end: '13:00', comment: '完成设置迁移与热生效验证' })
})

test('parseDraft：fail-closed——非 JSON/结构/空数组/task_id/时刻/说明各分支整体抛错', () => {
  const bad = [
    '这不是 JSON',
    '{"foo":1}',
    '{"entries":[]}',
    '{"entries":[{"task_id":99,"start":"11:00","end":"12:00","comment":"x"}]}',
    '{"entries":[{"task_id":"1","start":"11:00","end":"12:00","comment":"x"}]}',
    '{"entries":[{"task_id":1,"start":"25:00","end":"26:00","comment":"x"}]}',
    '{"entries":[{"task_id":1,"start":"11:99","end":"12:00","comment":"x"}]}',
    '{"entries":[{"task_id":1,"start":"13:00","end":"12:00","comment":"x"}]}',
    '{"entries":[{"task_id":1,"start":"11:00","end":"12:00","comment":"   "}]}',
    '{"entries":[{"task_id":1,"start":"11:00","end":"12:00","comment":123}]}',
  ]
  for (const text of bad) {
    assert.throws(() => parseDraft(text, tasks), /草稿|说明|时刻|任务|JSON|结构|entries/, `应拒绝：${text.slice(0, 40)}`)
  }
})
// 说明超长不再抛错（20261028 用户裁决）——放行断言见「说明长度不再校验」用例

test('buildMaterial：候选名回退为键形时改用「未解析任务」（键不进模型输入）', () => {
  const keyed = { ...planOut, candidates: [{ ...planOut.candidates[0]!, task_name: 'DEMO-999' }] }
  const material = buildMaterial(keyed as never, dayRegs)
  assert.equal(material.tasks[0]!.name, '未解析任务')
})

function streamOf(chunks: unknown[]) {
  return (options: unknown) => {
    streamOf.lastOptions = options
    return (async function* () {
      for (const chunk of chunks) yield chunk as never
    })()
  }
}
streamOf.lastOptions = undefined as unknown

test('runGeneration：收流组装文本，调用参数符合平台约束', async () => {
  const material = buildMaterial(planOut as never, dayRegs)
  const stream = streamOf([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '{"entries":' },
    { type: 'text-delta', index: 0, text: ']}' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '{"entries":]}' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const { text, elapsedMs } = await runGeneration(
    stream as never, { provider: 'deepseek', model: 'm1' }, material,
  )
  assert.equal(text, '{"entries":]}')
  assert.ok(elapsedMs >= 0)
  const options = streamOf.lastOptions as Record<string, unknown>
  assert.equal(options.temperature, 0)
  assert.equal(options.purpose, undefined)
  assert.equal(options.provider, 'deepseek')
  assert.equal(options.model, 'm1')
  assert.equal(options.system, SYSTEM_PROMPT)
  const serialized = JSON.stringify(options.messages)
  assert.ok(!serialized.includes('DEMO-745'), '素材不得携带 issue key')
  const user = (options.messages as { role: string; content: { type: string; text: string }[] }[])[0]!
  assert.equal(user.role, 'user')
  assert.equal(user.content[0]!.type, 'text')
  assert.ok(user.content[0]!.text.includes('"tasks"'))
})

test('runGeneration：aborted/error finish 与流自身异常均抛出', async () => {
  const material: Material = buildMaterial(planOut as never, dayRegs)
  const selection = { provider: 'deepseek', model: 'm1' }
  await assert.rejects(
    () => runGeneration(streamOf([{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'X', message: '已中止' } } }]) as never, selection, material),
    /中止/,
  )
  await assert.rejects(
    () => runGeneration(streamOf([{ type: 'finish', reason: { kind: 'error', failure: { code: 'NET', message: '网络超时' } } }]) as never, selection, material),
    /网络超时/,
  )
  const throwingStream = (() => { throw new Error('中间件失败') }) as never
  await assert.rejects(
    () => runGeneration(throwingStream, selection, material),
    /中间件失败/,
  )
})

test('SYSTEM_PROMPT：纪律要素与输出形状枚举在位', () => {
  assert.ok(SYSTEM_PROMPT.includes('平均'))
  assert.ok(SYSTEM_PROMPT.includes('待用户确认'))
  assert.ok(SYSTEM_PROMPT.includes('task_id'))
  assert.ok(SYSTEM_PROMPT.includes('JSON'))
  // 回流（round-01 裁决②）：说明只写工作本身，禁止「据近期登记」类来源尾缀
  assert.ok(SYSTEM_PROMPT.includes('不出现任何来源或依据'))
  assert.ok(!SYSTEM_PROMPT.includes('注明来源'))
  // round-01 S09：真实模型两轮稳定把素材原话缩写（架构评审会），软纪律「尽量逐字」不敌
  // 长度纪律（长度硬校验已于 20261028 移除）——收紧为必须逐字/紧前缀
  assert.ok(SYSTEM_PROMPT.includes('必须逐字采用素材原话或其紧前缀'))
  assert.ok(!SYSTEM_PROMPT.includes('尽量逐字'))
  // 20261028：说明改日报汇报口径（概括、不照搬提交标题、参照 recentComments 且允许与既往
  // 相同）、同任务当天合并一条、用户实例 few-shot 在位
  assert.ok(SYSTEM_PROMPT.includes('汇报口径'))
  assert.ok(SYSTEM_PROMPT.includes('不照搬提交标题'))
  assert.ok(SYSTEM_PROMPT.includes('recentComments'))
  assert.ok(SYSTEM_PROMPT.includes('同一任务当天只输出一条'))
  assert.ok(SYSTEM_PROMPT.includes('沙箱AIO模板推进'))
  assert.ok(SYSTEM_PROMPT.includes('CFS预热脚本与读写方案'))
  // 20261028 二次：长度改提示词软约束（尽量二十字以内），代码不再硬校验
  assert.ok(SYSTEM_PROMPT.includes('二十字'))
})

// —— 20261015 Wave：素材扩展 ——

const NOW = '2026-10-15T09:00:00+08:00'

function note(key: string, name: string, text: string, i = 1): NoteEntry {
  return { id: `n-2026-09-21-${i}`, issueKey: key, taskName: name, text, createdAt: NOW, updatedAt: NOW }
}

test('buildMaterial：素材并入——候选集强制并入（快照名）、notes 进素材、键映射可提交', () => {
  const notes = [note('NOTE-9', '架构评审', '上午开了两小时架构评审会并同步结论')]
  const material = buildMaterial(planOut as never, dayRegs, notes)
  const forced = material.tasks.find(task => task.name === '架构评审')
  assert.ok(forced, '素材任务强制进候选集（SPEC 方向决定）')
  assert.equal(material.taskKeys.get(forced!.id), 'NOTE-9', '键映射留在宿主（taskKeys）')
  assert.deepEqual(material.notes, [{ taskName: '架构评审', text: '上午开了两小时架构评审会并同步结论' }])
  assert.ok(!JSON.stringify(material.tasks).includes('NOTE-9'), '键不进模型输入（tasks 无键）')
})

test('buildMaterial：素材任务已在候选集不重复追加；空文本素材不进素材', () => {
  const notes = [
    note('DEMO-745', '插件设置迁移', '继续迁移收尾', 1),
    note('EMPTY-1', '空素材', '   ', 2),
  ]
  const material = buildMaterial(planOut as never, dayRegs, notes)
  assert.equal(material.tasks.filter(task => task.name === '插件设置迁移').length, 1, '已有候选不重复')
  assert.deepEqual(material.notes, [{ taskName: '插件设置迁移', text: '继续迁移收尾' }], '空文本素材剔除')
  assert.ok(![...material.taskKeys.values()].includes('EMPTY-1'))
})

const quoteNotes = [{ taskName: '架构评审', text: '上午开了两小时架构评审会并同步结论' }]

test('parseDraft：说明为素材原话（完全相等）→ noteConfirmed', () => {
  const comment = '上午开了两小时架构评审会并同步结论'
  const { entries } = parseDraft(`{"entries":[{"task_id":1,"start":"14:00","end":"16:00","comment":"${comment}"}]}`, tasks, quoteNotes)
  assert.equal(entries[0]!.noteConfirmed, true)
})

test('parseDraft：说明为素材原话紧前缀（截取）→ noteConfirmed', () => {
  const { entries } = parseDraft('{"entries":[{"task_id":1,"start":"14:00","end":"15:00","comment":"上午开了两小时架构评审会"}]}', tasks, quoteNotes)
  assert.equal(entries[0]!.noteConfirmed, true)
})

test('parseDraft：说明长度不再校验——超长说明通过，noteConfirmed 仅按原话比对', () => {
  const long = '今'.repeat(45)
  const matched = parseDraft(`{"entries":[{"task_id":1,"start":"09:00","end":"10:00","comment":"${long}"}]}`, tasks, [{ taskName: 'x', text: long }])
  assert.equal(matched.entries[0]!.noteConfirmed, true, '逐字命中仍标记 noteConfirmed')
  const other = [{ taskName: 'x', text: '完全不同的素材' }]
  const unmatched = parseDraft(`{"entries":[{"task_id":1,"start":"09:00","end":"10:00","comment":"${long}"}]}`, tasks, other)
  assert.equal(unmatched.entries[0]!.noteConfirmed, undefined, '未命中素材不标记')
  assert.equal(unmatched.entries[0]!.comment, long, '超长说明原样通过（20261028 用户裁决）')
})

test('parseDraft：普通条目不携带 noteConfirmed（无素材路径不回归）', () => {
  const { entries } = parseDraft('{"entries":[{"task_id":1,"start":"11:00","end":"13:00","comment":"完成设置迁移与热生效验证"}]}', tasks)
  assert.equal(entries[0]!.noteConfirmed, undefined)
})

test('dropUnresolvableNoteTasks：仅剔除不在存在键集的任务（不误杀 watched），素材与建议同步剔除', () => {
  const notes = [note('NOTE-9', '架构评审', '上午评审')]
  const material = buildMaterial(planOut as never, dayRegs, notes)
  const existing = new Set(['DEMO-745', 'DEMO-772', 'OTHER-9']) // watched ∪ 已登记（核查命中集为其一）
  const { material: kept, degradedNotes } = dropUnresolvableNoteTasks(material, existing)
  assert.ok(!kept.tasks.some(task => task.name === '架构评审'), '不可解析素材任务剔除')
  assert.ok(![...kept.taskKeys.values()].includes('NOTE-9'))
  assert.deepEqual(kept.notes, [], '对应素材不进模型输入')
  assert.equal(kept.tasks.length, 3, 'watched/已登记候选不误杀')
  assert.equal(degradedNotes.length, 1)
  assert.ok(degradedNotes[0]!.includes('架构评审') && degradedNotes[0]!.includes('不可解析'), '降级提示按快照名')
})

test('SYSTEM_PROMPT：素材纪律在位（原话优先、素材任务不标待确认）', () => {
  assert.ok(SYSTEM_PROMPT.includes('素材'))
  assert.ok(SYSTEM_PROMPT.includes('逐字'))
})

test('buildMaterial：素材空名/键形名回退「未解析任务」（与 watched/已登记两路同构，T03 review F1）', () => {
  const notes = [note('NOTE-8', '', '做了一些事'), note('NOTE-9', 'NOTE-9', '做了另一些事')]
  const material = buildMaterial(planOut as never, dayRegs, notes)
  const names = material.tasks.map(task => task.name)
  assert.ok(names.includes('未解析任务'), '空名与键形名均回退')
  assert.ok(!names.includes('NOTE-9'), '键形名不进模型输入')
  assert.equal(material.notes.filter(n => n.taskName === '未解析任务').length, 2)
})

test('dropUnresolvableNoteTasks：同名不同键素材按 key 剔除不误伤存活素材（T03 review F2）', () => {
  const notes = [note('GONE-1', '同名任务', '这条该被剔'), note('KEEP-2', '同名任务', '这条该留下')]
  const material = buildMaterial(planOut as never, dayRegs, notes)
  const { material: kept } = dropUnresolvableNoteTasks(material, new Set(['DEMO-745', 'DEMO-772', 'OTHER-9', 'KEEP-2']))
  assert.deepEqual(kept.notes, [{ taskName: '同名任务', text: '这条该留下' }], '存活素材保留')
  assert.deepEqual(kept.noteKeys, ['KEEP-2'], '平行绑定同步剔除')
  assert.ok(![...kept.taskKeys.values()].includes('GONE-1'), '不可解析任务剔除')
  assert.ok([...kept.taskKeys.values()].includes('KEEP-2'), '存活任务不误伤')
})
