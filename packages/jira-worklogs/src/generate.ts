// 生成模块（PLAN 生成模块单元，D1/D2）：素材映射、纪律指令、一次性流式调用与 fail-closed 解析。
// stream 依赖注入——可离线测试；调用参数沿平台约束（temperature 0、不设 purpose，F2）。
// 执行注记：buildMaterial 以 dayRegistrations 输出替代独立 resolveTaskNames 调用（同一底层
// 构建器，existing 时段与补名一次到位，少一次重复查询）——PLAN 签名的实现期收敛，语义不变。
// 20261015 Wave：素材扩展——Material.notes 进模型输入、素材任务强制并入候选集（SPEC 方向决定）、
// 原话宿主逐字/紧前缀比对标记 noteConfirmed（不信模型自报）、不可解析素材任务降级剔除。
// 20261028 二次调整：说明长度全链路不再硬校验（用户裁决——生成内容仅供参考、有编辑入口），
// 改提示词约束「尽量二十字以内」；noteConfirmed 保留 comment_source 口径语义。
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ReasoningEffortId, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DayRegistrationsOut } from './engine/plan.ts'
import type { NoteEntry } from './store/domain.ts'

export const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/

export interface DraftTask {
  id: number
  name: string
}

export interface DraftEntry {
  taskId: number
  start: string
  end: string
  comment: string
  /** 说明逐字取自素材原话（或其紧前缀）——客户端初始 userEdited（comment_source 口径）。 */
  noteConfirmed?: boolean
  /** 暂存回显条目的上次失败形态（outboxToDraft 组装，生成路径不携带）。 */
  lastStatus?: 'failed' | 'uncertain'
  /** 暂存回显 uncertain 条目的核对链接（outboxToDraft 组装）。 */
  issueUrl?: string
  /** 暂存回显条目的用户口径快照（生成路径不携带——客户端初始 false）。 */
  userEdited?: boolean
}

export interface MaterialTask extends DraftTask {
  todayHours?: number
  recentComments?: string[]
}

export interface MaterialExisting {
  task: string
  start: string
  end: string
}

export interface MaterialNote {
  taskName: string
  text: string
}

export interface Material {
  date: string
  loggedHours: number
  gapHours: number
  existing: MaterialExisting[]
  tasks: MaterialTask[]
  gitByProject: { project: string; commits: string[] }[]
  suggested: { taskId: number; start: string; end: string; hours: number }[]
  /** 手动素材（脱敏视图：任务名快照＋文本，无 issue key）。 */
  notes: MaterialNote[]
  /** 素材↔issue key 平行绑定（与 notes 同序，宿主私有——runGeneration 白名单序列化
   * 不携带，与 taskKeys 同构；dropUnresolvableNoteTasks 按 key 剔除防同名误伤，T03 review F2）。 */
  noteKeys: string[]
  /** id → issue key：draftStore 消费，绝不进模型输入与客户端载荷（脱敏基线）。 */
  taskKeys: Map<number, string>
}

type Mirror = Record<string, unknown>

/** 纪律移植（D2）＋ 输出 JSON 形状逐字段枚举（auto-review 先例）。
 * 20261028 调整：说明改日报汇报口径——笼统概括在做什么（不写实现细节、不照搬提交标题、
 * 参照 recentComments 既往口径且允许与既往相同），同一任务当天合并一条 entry（素材对该任务
 * 多条陈述除外），附用户实例 few-shot；素材原话逐字纪律不变（用户陈述效力仍最高）。
 * 同轮二次：说明尽量简短、控制在二十字以内（软约束——长度不再代码硬校验）。 */
export const SYSTEM_PROMPT = [
  '你是 Jira 工时草稿生成器，只输出一个 JSON 对象，不输出任何解释或多余文本。',
  '根据给定素材（JSON）为目标日生成工时草稿建议，遵守纪律：',
  '- 禁止把缺口工时平均分摊到各任务；按证据强弱分配——Git 提交标题、当日已有登记、近期登记说明优先',
  '- 说明是日报汇报口径而非实现记录：一句话笼统概括这项工作在做什么、推进到哪，尽量简短，控制在二十字以内，适当润色即可；不写实现细节（具体文件、函数、报错、参数等），不出现任何来源或依据说明（如「据近期登记」「根据提交」）',
  '- Git 提交标题只用于判断做了哪些任务、时长如何分配；说明措辞不照搬提交标题、不逐条罗列提交',
  '- 措辞风格参照素材 tasks[].recentComments 的既往登记说明；说明与既往登记相同完全可接受，不必刻意每天变化',
  '- 说明示例（期望的概括口径）：「沙箱AIO模板推进，编译验证与codex规则收口」「CFS预热脚本与读写方案」',
  '- 同一任务当天只输出一条 entry：当天该任务全部工作合并为一条说明、一个连续时段（素材对该任务有多条陈述时除外，逐条对应）',
  '- 素材 notes 是用户对当日工作的陈述：素材任务的排班与说明优先依据素材（时长线索如「两小时」在时长中体现）；有素材的任务其说明必须逐字采用素材原话或其紧前缀（不受概括口径、字数与示例影响；不得改写或缩写）；素材任务的说明不得以「待用户确认」开头',
  '- 没有依据的归属，说明以「待用户确认」开头',
  '- 时间段用 HH:MM，避开素材 existing 已登记时段，从其后连续排布；合计尽量贴近 gapHours',
  '- task_id 只能取素材 tasks[].id 中的值',
  '输出形状（逐字段）：',
  '{"entries":[{"task_id":数字,"start":"HH:MM","end":"HH:MM","comment":"概括性说明"}]}',
].join('\n')

function splitRange(range: string): [string, string] {
  const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(range ?? '').trim())
  return match ? [match[1]!, match[2]!] : ['', '']
}

/** plan 输出 + 单日全量登记 +（可选）手动素材 → 脱敏素材（纯映射）。 */
export function buildMaterial(planOut: Mirror, dayRegs: DayRegistrationsOut, notes?: NoteEntry[]): Material {
  const candidates = (planOut.candidates ?? []) as Mirror[]
  const daily = (((planOut.worklog_check ?? {}) as Mirror).daily ?? []) as Mirror[]
  const targetRow = daily.find(row => row.is_target === true)
  const taskKeys = new Map<number, string>()
  const tasks: MaterialTask[] = []
  const watchedKeys = new Set<string>()
  let nextId = 1
  for (const candidate of candidates) {
    const key = String(candidate.issue_key ?? '')
    watchedKeys.add(key)
    const rawName = String(candidate.task_name ?? '')
    // 引擎对空 summary 回退 key（plan.ts）；键形名不进模型输入——回退「未解析任务」（审读 minor-3）
    const name = rawName && !ISSUE_KEY_RE.test(rawName) ? rawName : '未解析任务'
    const history = ((candidate.history_worklogs ?? []) as Mirror[])
      .map(log => String(log.comment ?? ''))
      .filter(Boolean)
      .slice(-5)
    const todayHours = Number(candidate.today_hours ?? 0)
    taskKeys.set(nextId, key)
    tasks.push({ id: nextId, name, ...(todayHours > 0 ? { todayHours } : {}), recentComments: history })
    nextId += 1
  }
  const existing: MaterialExisting[] = []
  for (const task of dayRegs.tasks) {
    const name = task.task_name || '未解析任务'
    if (!watchedKeys.has(task.issue_key)) {
      if (!task.task_name) continue // 未解析名的非 watched 任务不进候选集（PLAN 生成模块）
      const hours = Math.round(task.entries.reduce((sum, entry) => sum + entry.hours, 0) * 100) / 100
      taskKeys.set(nextId, task.issue_key)
      tasks.push({ id: nextId, name, ...(hours > 0 ? { todayHours: hours } : {}) })
      nextId += 1
    }
    for (const entry of task.entries) {
      const [start, end] = splitRange(entry.time_range)
      if (start && end) existing.push({ task: name, start, end })
    }
  }
  // 素材并入：空文本剔除；任务不在候选集时强制追加（快照名——SPEC 方向决定，用户显式声明
  // 效力优先于 JQL 推断池）；已建候选不重复。键映射进 taskKeys（留宿主），键不进素材视图；
  // 空名/键形名回退「未解析任务」（与 watched/已登记两路同构，T03 review F1）。
  const materialNotes: MaterialNote[] = []
  const materialNoteKeys: string[] = []
  for (const entry of notes ?? []) {
    const text = String(entry.text ?? '').trim()
    if (!text) continue
    const rawName = String(entry.taskName ?? '')
    const name = rawName && !ISSUE_KEY_RE.test(rawName) ? rawName : '未解析任务'
    materialNotes.push({ taskName: name, text })
    materialNoteKeys.push(String(entry.issueKey ?? ''))
    const key = String(entry.issueKey ?? '')
    if (key && ![...taskKeys.values()].includes(key)) {
      taskKeys.set(nextId, key)
      tasks.push({ id: nextId, name })
      nextId += 1
    }
  }
  const byDate = ((planOut.git_activity as Mirror | undefined)?.by_date ?? {}) as Record<string, Mirror[]>
  const gitByProject = (byDate[String(planOut.target_date ?? '')] ?? []).map(item => ({
    project: String(item.project ?? ''),
    commits: ((item.commits ?? []) as Mirror[]).map(commit => String(commit.title ?? '')).filter(Boolean),
  }))
  const suggested = ((planOut.suggested_entries ?? []) as Mirror[]).flatMap(entry => {
    const key = String(entry.issue_key ?? '')
    const id = [...taskKeys.entries()].find(([, issueKey]) => issueKey === key)?.[0]
    const [start, end] = splitRange(String(entry.time_range ?? ''))
    if (id === undefined || !start) return []
    return [{ taskId: id, start, end, hours: Number(entry.hours ?? 0) }]
  })
  return {
    date: String(planOut.target_date ?? dayRegs.date),
    loggedHours: Number(planOut.today_existing_hours ?? dayRegs.hours),
    gapHours: Number(targetRow?.gap_hours ?? 0),
    existing,
    tasks,
    gitByProject,
    suggested,
    notes: materialNotes,
    noteKeys: materialNoteKeys,
    taskKeys,
  }
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/

function minutesOf(value: string): number | null {
  const match = TIME_RE.exec(value.trim())
  if (!match) return null
  if (Number(match[2]) >= 60) return null // 分钟域 0-59（审读 minor-1）
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes < 1440 ? minutes : null
}

function padTime(value: string): string {
  const match = TIME_RE.exec(value.trim())!
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

/** 模型输出窄校验 fail-closed：任一分支命中整体抛错，绝不部分回显（R2）。
 * notes（可选，缺省空）用于原话逐字比对——comment 与某素材 text 完全相等或为其
 * 紧前缀（截取原话同享用户口径，S09 判定对齐）→ noteConfirmed（客户端初始
 * userEdited、提交按 user_confirmed 口径）；说明长度不校验（20261028 用户裁决，
 * 简短约束交提示词，编辑入口在客户端）。 */
export function parseDraft(text: string, tasks: DraftTask[], notes: MaterialNote[] = []): { entries: DraftEntry[] } {
  let data: unknown
  try {
    data = JSON.parse(String(text))
  } catch {
    throw new Error('模型输出不是合法 JSON，无法解析为工时草稿')
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('模型输出结构不符（应为 {"entries": [...]}）')
  }
  const list = (data as Mirror).entries
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('模型输出缺少非空 entries 数组，无法解析为工时草稿')
  }
  const noteTexts = notes.map(note => note.text.trim()).filter(Boolean)
  const validIds = new Set(tasks.map(task => task.id))
  const entries = list.map((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`第 ${index + 1} 条不是对象，草稿解析失败`)
    }
    const item = raw as Mirror
    // 类型前置判定（审读 minor-2）：窄校验不做宽收强转，形态不对即拒
    if (typeof item.task_id !== 'number') throw new Error(`第 ${index + 1} 条 task_id 不是数字，草稿解析失败`)
    const taskId = item.task_id
    if (!Number.isInteger(taskId) || !validIds.has(taskId)) {
      throw new Error(`第 ${index + 1} 条 task_id 不在候选任务集，草稿解析失败`)
    }
    const start = String(item.start ?? '')
    const end = String(item.end ?? '')
    const startMinutes = minutesOf(start)
    const endMinutes = minutesOf(end)
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      throw new Error(`第 ${index + 1} 条时刻非法（需 HH:MM 且结束晚于开始），草稿解析失败`)
    }
    if (typeof item.comment !== 'string') throw new Error(`第 ${index + 1} 条说明不是字符串，草稿解析失败`)
    const comment = item.comment.trim()
    if (!comment) throw new Error(`第 ${index + 1} 条说明为空，草稿解析失败`)
    const noteConfirmed = noteTexts.some(noteText => noteText.startsWith(comment))
    return {
      taskId, start: padTime(start), end: padTime(end), comment,
      ...(noteConfirmed ? { noteConfirmed: true } : {}),
    }
  })
  return { entries }
}

/** 剔除不可解析素材任务（SPEC 方向决定·降级载体）：existingKeys＝watched ∪ 当日已登记 ∪
 * 核查命中的全部已知存在键（审计 F-4 钉死）——不在集内即「素材强制并入且核查未命中」，
 * 不误杀 watched/已登记候选；素材按 noteKeys 平行绑定按 key 剔除（同名不同键不误伤，
 * T03 review F2），产出 degradedNotes（快照名，脱敏文本）。 */
export function dropUnresolvableNoteTasks(
  material: Material,
  existingKeys: Set<string>,
): { material: Material; degradedNotes: string[] } {
  const droppedTasks = material.tasks.filter(task => {
    const key = material.taskKeys.get(task.id)
    return key !== undefined && !existingKeys.has(key)
  })
  if (droppedTasks.length === 0) return { material, degradedNotes: [] }
  const droppedIds = new Set(droppedTasks.map(task => task.id))
  const droppedKeys = new Set(droppedTasks.map(task => material.taskKeys.get(task.id)!))
  const keptNotes: MaterialNote[] = []
  const keptNoteKeys: string[] = []
  material.notes.forEach((note, index) => {
    if (!droppedKeys.has(material.noteKeys[index] ?? '')) {
      keptNotes.push(note)
      keptNoteKeys.push(material.noteKeys[index] ?? '')
    }
  })
  return {
    material: {
      ...material,
      tasks: material.tasks.filter(task => !droppedIds.has(task.id)),
      taskKeys: new Map([...material.taskKeys.entries()].filter(([id]) => !droppedIds.has(id))),
      suggested: material.suggested.filter(entry => !droppedIds.has(entry.taskId)),
      notes: keptNotes,
      noteKeys: keptNoteKeys,
    },
    degradedNotes: droppedTasks.map(task => `素材任务『${task.name}』在 Jira 已不可解析，对应素材未纳入本次生成`),
  }
}

export interface GenerationSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 收流 → finish 终止判定 → 纯文本（F1/F6/F7；middleware/消费方类失败由调用方 try/catch）。 */
export async function runGeneration(
  stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  selection: GenerationSelection,
  material: Material,
  signal?: AbortSignal,
): Promise<{ text: string; elapsedMs: number }> {
  const startedAt = Date.now()
  const input = {
    date: material.date,
    loggedHours: material.loggedHours,
    gapHours: material.gapHours,
    existing: material.existing,
    tasks: material.tasks,
    gitByProject: material.gitByProject,
    suggested: material.suggested,
    notes: material.notes,
  }
  const options: GenerateOptions = {
    provider: selection.provider,
    model: selection.model,
    // 平台选择透传（currentSelection 的 reasoningEffort 即该 brand 类型）
    ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort as ReasoningEffortId } : {}),
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(input) }] }],
    system: SYSTEM_PROMPT,
    temperature: 0,
    ...(signal ? { signal } : {}),
  }
  const assembler = new BlockAssembler()
  for await (const chunk of stream(options)) assembler.push(chunk)
  const finish = assembler.finish as unknown as { kind: string; failure?: { message?: string; code?: string } }
  if (finish.kind !== 'stop') {
    const detail = finish.failure?.message ?? finish.failure?.code ?? finish.kind
    const error = new Error(finish.kind === 'aborted' ? `生成已中止：${detail}` : `生成失败：${detail}`)
    // 平台错误分类学（code）随错误携带——消费方按 code 分类，不解析文案（T05 审读 F1）
    if (finish.failure?.code) (error as { code?: string }).code = finish.failure.code
    throw error
  }
  const text = assembler.blocks()
    .filter(block => (block as { type?: string }).type === 'text')
    .map(block => (block as { text?: string }).text ?? '')
    .join('')
  return { text, elapsedMs: Date.now() - startedAt }
}
