// ctx.jiraWorklogs 服务层的纯映射：引擎原始输出（snake_case 镜像）→ 客户端契约
// （camelCase）。流程编排在 src/flows.ts；远程服务接线在 src/index.ts——本文件
// 只含纯函数，进 node --test。旧动线的 overviewFromPlan / materialForDays /
// draftPromptText 已随会话式生成移除（2026-09-24 Wave，SPEC D1/D15）。
// 20261015 Wave：暂存/素材契约扩展——outbox 概要与错误态、notes/candidates、
// 暂存条目互转与回显文档（outboxToDraft）、degradedNotes 载体。
import type { DayRegistrationsOut } from './engine/plan.ts'
import type { DraftContext, DraftTaskRef } from './draft-store.ts'
import type { DraftEntry, DraftTask, Material } from './generate.ts'
import type { NotesDayRecord, OutboxDayRecord, OutboxEntry } from './store/domain.ts'
import { hoursToJira } from './engine/dates.ts'
import { weekdayCN, type WorklogEntry } from './engine/query.ts'

/** 凭据缺失错误的结构化识别（SPEC 场景 11：缺什么、如何补）。 */
export function credentialsIssue(error: Error): { error: 'jira-credentials' | 'network'; message: string } {
  const text = error.message
  if (text.includes('缺少 Jira 配置') || text.includes('jira.env') || text.includes('未返回当前用户')) {
    return { error: 'jira-credentials', message: `${text}。补齐后点「刷新」重新检测，无需重启 DSH。` }
  }
  return { error: 'network', message: text }
}

// ---- 弹窗改版五映射（PLAN 服务映射层）----

/** 月视图契约（overview 返回）。outbox＝暂存概要（存储缺席省略）；outboxError＝存储在场但读取失败；
 * outboxUnavailable＝存储域缺席（提示条降级提示，终审 F-1）。 */
export interface MonthOverview {
  today: string
  month: string
  rows: { date: string; loggedHours: number; gapHours: number; status: 'full' | 'gap' }[]
  gapCount: number
  error?: 'jira-credentials'
  message?: string
  outbox?: { days: { date: string; count: number }[]; total: number }
  outboxError?: true
  outboxUnavailable?: true
}

/** 日详情契约（dayDetail 返回）。notes/candidates 同为存储与候选映射的扩展（缺席省略）。 */
export interface DayDetail {
  date: string
  workday: boolean
  loggedHours: number
  gapHours?: number
  tasks: { name: string; entries: { timeRange: string; hours: number; comment: string }[] }[]
  git: { pushes: number; commits: number; byProject: { project: string; commits: { title: string; time: string }[] }[] } | null
  notes?: { id: string; taskName: string; text: string }[]
  notesError?: true
  candidates?: { id: number; name: string }[]
}

/** 生成结果契约（generate 返回）。degradedNotes＝不可解析素材任务的降级提示行。 */
export interface DraftDocument {
  draftId: string
  date: string
  loggedHours: number
  gapHours: number
  elapsedMs: number
  tasks: DraftTask[]
  entries: DraftEntry[]
  degradedNotes?: string[]
}

/** 提交互载契约。 */
export interface SubmitRequest {
  draftId: string
  entries: { taskId: number; start: string; end: string; comment: string; userEdited: boolean }[]
}

/** 提交回报契约（results 与请求 entries 等长同序，客户端按序对回）。
 * issueUrl 为该条任务在 Jira 的浏览页地址（结构化字段，不经脱敏文本）；
 * outboxSaved=false 表示暂存写入失败（客户端显式提示「暂存未生效」）。 */
export interface SubmitReport {
  status: 'ok' | 'partial' | 'failed' | 'blocked'
  errors: string[]
  results: { taskId: number; start: string; end: string; status: 'written' | 'skipped' | 'failed' | 'uncertain'; reason?: string; error?: string; issueUrl?: string }[]
  outboxSaved?: boolean
}

/** uncertain 必附人工核对指引（D-unclear：裸「不确定」不可判断成败，禁止再出现）。 */
export const UNCERTAIN_GUIDANCE = '（写入结果未确认——请点「到 Jira 核对」人工查证；确认未写入后可再次提交，提交前查重不会写重）'

/** monthStatus 原始行 → 月视图（未登记周末已被 monthStatus 过滤；有登记的周末/调休
 * exempt 行映射 full——月历 ✓ 口径，20261029；gap 计数不受影响）。 */
export function monthOverviewFrom(statusRows: unknown, today: string): MonthOverview {
  const rows = (Array.isArray(statusRows) ? statusRows : []) as Record<string, unknown>[]
  const mapped = rows.map(row => ({
    date: String(row.date),
    loggedHours: Number(row.hours ?? 0),
    gapHours: Number(row.gap_hours ?? 0),
    status: row.status === 'gap' ? 'gap' as const : 'full' as const,
  }))
  return {
    today,
    month: today.slice(0, 7),
    rows: mapped,
    gapCount: mapped.filter(row => row.status === 'gap').length,
  }
}

/** dayRegistrations 原始输出 → 日详情视图（未解析名回退「未解析任务」；无素材 git 为 null）。 */
export function dayDetailFrom(regs: DayRegistrationsOut): DayDetail {
  const gitItems = regs.git ?? []
  const git = gitItems.length === 0 ? null : {
    pushes: gitItems.reduce((sum, item) => sum + Number(item.push_count ?? 0), 0),
    commits: gitItems.reduce((sum, item) => sum + (item.commits?.length ?? 0), 0),
    byProject: gitItems.map(item => ({
      project: String(item.project ?? ''),
      commits: (item.commits ?? []).map(commit => ({ title: String(commit.title ?? ''), time: String(commit.time ?? '') })),
    })),
  }
  return {
    date: regs.date,
    workday: regs.workday,
    loggedHours: regs.hours,
    ...(regs.workday ? { gapHours: Math.max(0, Math.round((8 - regs.hours) * 100) / 100) } : {}),
    tasks: (regs.tasks ?? []).map(task => ({
      name: task.task_name || '未解析任务',
      entries: (task.entries ?? []).map(entry => ({
        timeRange: entry.time_range, hours: entry.hours, comment: entry.comment,
      })),
    })),
    git,
  }
}

/** 素材 + 解析结果 → 草稿文档（客户端表单数据源）；degradedNotes＝不可解析素材降级提示。 */
export function draftDocumentFrom(
  material: Material,
  draft: { draftId: string; entries: DraftEntry[] },
  elapsedMs: number,
  degradedNotes?: string[],
): DraftDocument {
  return {
    draftId: draft.draftId,
    date: material.date,
    loggedHours: material.loggedHours,
    gapHours: material.gapHours,
    elapsedMs,
    tasks: material.tasks.map(task => ({ id: task.id, name: task.name })),
    entries: draft.entries,
    ...(degradedNotes !== undefined && degradedNotes.length > 0 ? { degradedNotes } : {}),
  }
}

// ---- 20261015 Wave：暂存/素材扩展映射 ----

/** 暂存概要 → overview.outbox 载荷（存储缺席由调用方省略字段）。 */
export function outboxOverviewFrom(summary: { date: string; count: number }[]): MonthOverview['outbox'] {
  return {
    days: summary.map(row => ({ date: row.date, count: row.count })),
    total: summary.reduce((sum, row) => sum + row.count, 0),
  }
}

/** 素材记录 → 客户端视图（任务名＋文本；issue key 不出宿主）。记录缺席返回 undefined。 */
export function notesViewFrom(record: NotesDayRecord | undefined): DayDetail['notes'] {
  if (record === undefined) return undefined
  return record.items.map(item => ({ id: item.id, taskName: item.taskName, text: item.text }))
}

/** 请求条目＋任务引用＋失败形态 → 暂存条目（submitFlow 记账用）。 */
export function outboxEntryFrom(
  entry: { start: string; end: string; comment: string; userEdited: boolean },
  ref: DraftTaskRef,
  lastStatus: 'failed' | 'uncertain',
  lastError?: string,
): OutboxEntry {
  return {
    issueKey: ref.key,
    taskName: ref.name,
    start: entry.start,
    end: entry.end,
    comment: entry.comment,
    userEdited: entry.userEdited,
    lastStatus,
    ...(lastError !== undefined ? { lastError } : {}),
  }
}

/** 暂存记录 → 回显草稿文档（openOutboxFlow 用）。idOf＝候选集内按 issueKey 定位 id
 * （调用方保证暂存任务已并入候选集）；elapsedMs 置 0（暂存回显无生成耗时）；
 * uncertain 条目附核对链接（issueUrl 既有例外口径）。 */
export function outboxToDraft(
  record: OutboxDayRecord,
  candidates: { id: number; name: string }[],
  idOf: (key: string) => number | undefined,
  draftId: string,
  hours: { loggedHours: number; gapHours: number },
  server: string,
): DraftDocument {
  const entries = record.entries.map(entry => {
    const id = idOf(entry.issueKey)
    if (id === undefined) throw new Error('任务不在草稿候选集，请重新打开暂存')
    return {
      taskId: id,
      start: entry.start,
      end: entry.end,
      comment: entry.comment,
      userEdited: entry.userEdited,
      ...(entry.lastStatus !== undefined ? { lastStatus: entry.lastStatus } : {}),
      ...(entry.lastStatus === 'uncertain' ? { issueUrl: `${server.replace(/\/+$/, '')}/browse/${entry.issueKey}` } : {}),
    }
  })
  return {
    draftId,
    date: record.date,
    loggedHours: hours.loggedHours,
    gapHours: hours.gapHours,
    elapsedMs: 0,
    tasks: candidates,
    entries,
  }
}

function rangeHours(start: string, end: string): number {
  const toMinutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
    return match ? Number(match[1]) * 60 + Number(match[2]) : null
  }
  const a = toMinutes(start)
  const b = toMinutes(end)
  if (a === null || b === null || b <= a) throw new Error(`时间段非法（${start}–${end}），请修正后再提交`)
  return Math.round(((b - a) / 60) * 100) / 100
}

/** 表单条目 → 引擎 jira-worklog-plan.v1 文档（today_existing_hours＝提交时现查值）。 */
export function submitRequestToPlanDoc(request: SubmitRequest, context: DraftContext, todayHours: number): Record<string, unknown> {
  const entries = request.entries.map(entry => {
    const ref = context.taskKeys.get(entry.taskId)
    if (!ref) throw new Error('任务不在草稿候选集，请重新生成')
    const hours = rangeHours(entry.start, entry.end)
    return {
      issue_key: ref.key,
      task_name: ref.name,
      time_spent: hoursToJira(hours),
      hours,
      started: `${context.date}T${entry.start}:00.000+0800`,
      comment: entry.comment,
      comment_source: entry.userEdited ? 'user_confirmed' : 'model_draft',
      adjust_estimate: 'auto',
    }
  })
  return {
    schema: 'jira-worklog-plan.v1',
    target_date: context.date,
    today_existing_hours: todayHours,
    minimum_hours: 8,
    entries,
  }
}

/** 引擎日级回报 → 客户端回报（按请求序对回；uncertain 的 error 并入 reason 供展示，
 * 错误文本中的 issue key 形态串抹除——键不进客户端可见文本，T05 审读 F4）。 */
const ISSUE_KEY_TEXT_RE = /\b[A-Z][A-Z0-9]+-\d{1,6}\b/g

function sanitizeDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  // 已知误伤族（UTF-8/ISO-8601 等与键同形的技术词会被抹除）——仅 reason 展示退化，
  // 无泄漏无功能损害，按脱敏优先接受（T05 复审 R2 口径）
  return String(value).replace(ISSUE_KEY_TEXT_RE, '该任务')
}

export { sanitizeDetail }

export function submitReportFrom(
  dayReport: { status?: unknown; errors?: unknown; results?: unknown },
  request: SubmitRequest,
  issueUrls?: (string | undefined)[],
): SubmitReport {
  const statusMap: Record<string, SubmitReport['status']> = {
    success: 'ok', partial: 'partial', failed: 'failed', blocked: 'blocked',
  }
  const status = statusMap[String(dayReport.status)] ?? 'failed'
  const results = ((Array.isArray(dayReport.results) ? dayReport.results : []) as Record<string, unknown>[])
    .map((item, index) => {
      const req = request.entries[index]
      if (!req) return undefined
      const isUncertain = item.status === 'uncertain'
      const detail = sanitizeDetail(item.reason ?? item.error)
      // uncertain 必附核对指引：有原始原因（网络错误等）则接在其后，无则给默认语义。
      const reason = isUncertain
        ? `${detail ?? '写入请求已发出，但回读未确认是否落库'}${UNCERTAIN_GUIDANCE}`
        : detail
      const issueUrl = issueUrls?.[index]
      return {
        taskId: req.taskId,
        start: req.start,
        end: req.end,
        status: item.status as 'written' | 'skipped' | 'failed' | 'uncertain',
        ...(reason !== undefined ? { reason } : {}),
        ...(issueUrl !== undefined ? { issueUrl } : {}),
      }
    })
    .filter((item): item is SubmitReport['results'][number] => item !== undefined)
  return {
    status,
    errors: (Array.isArray(dayReport.errors) ? dayReport.errors : []).map(error => String(error)),
    results,
  }
}

// ---- 查同事日志（20261023 Wave）：查询视图映射族 ----

/** 查询视图契约（query 返回）。notice 按 status 恰一在场（ok 普通态省略）；
 * permissionNote 随 ok 结果展示。 */
export interface QueryViewDayEntry {
  hours: number
  issueKey: string
  issueUrl: string
  summary: string
  comment: string
}

export interface QueryViewDay {
  date: string
  weekday: string
  totalHours: number
  entries: QueryViewDayEntry[]
}

export interface QueryView {
  status: 'ok' | 'ambiguous' | 'not-found' | 'no-logs'
  displayName?: string
  name?: string
  days?: QueryViewDay[]
  notice?: string
  permissionNote?: string
  candidates?: { name: string; displayName: string }[]
}

/** 可见性口径说明（随 ok 结果固定展示）。 */
export const PERMISSION_NOTE = '结果限于当前账号可浏览项目内的工时，受限记录不会出现。'

/** 工时条目 → 按日聚合（日期倒序、组内耗时升序、两位小数合计；issueUrl 为该任务浏览页）。 */
export function aggregateToDays(entries: WorklogEntry[], server: string): QueryViewDay[] {
  const base = server.replace(/\/+$/, '')
  const byDay = new Map<string, WorklogEntry[]>()
  for (const entry of entries) {
    if (!byDay.has(entry.startedDate)) byDay.set(entry.startedDate, [])
    byDay.get(entry.startedDate)!.push(entry)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      weekday: weekdayCN(date),
      totalHours: Math.round(list.reduce((sum, item) => sum + item.hours, 0) * 100) / 100,
      entries: [...list]
        .sort((a, b) => a.hours - b.hours)
        .map(item => ({
          hours: item.hours,
          issueKey: item.issueKey,
          issueUrl: `${base}/browse/${item.issueKey}`,
          summary: item.summary,
          comment: item.comment,
        })),
    }))
}

/** 回溯说明：含原查询窗口（三态表述）与回溯到的自然周。 */
export function fallbackNotice(
  displayName: string,
  name: string,
  from: string | undefined,
  to: string | undefined,
  week: { monday: string; sunday: string },
): string {
  const window = from !== undefined && to !== undefined
    ? `${from} 至 ${to}`
    : from !== undefined
      ? `${from} 起`
      : to !== undefined
        ? `至 ${to}`
        : '不限日期'
  return `${displayName}（${name}）在${window}无日志，已回溯其最后活跃周 ${week.monday} 至 ${week.sunday}：`
}

export function noLogsNotice(displayName: string, name: string): string {
  return `${displayName}（${name}）无任何可见日志。`
}

export function notFoundNotice(input: string): string {
  return `查无此人：${input}（账号可能不存在、已禁用或离职）。`
}

/** 同名歧义提示：列候选（登录 ID＋显示名）并引导登录 ID 重查；满 20 注明截断。 */
export function ambiguousNotice(input: string, candidates: { name: string; displayName: string }[]): string {
  const list = candidates.map(item => `${item.name}（${item.displayName}）`).join('、')
  const cap = candidates.length >= 20 ? '（仅显示前 20）' : ''
  return `「${input}」匹配到多个账号${cap}：${list}。请用登录 ID 重查。`
}
