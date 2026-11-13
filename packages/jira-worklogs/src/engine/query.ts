// 查同事日志（20261023 Wave）：按人只读查询的引擎层——名字解析、窗口采集、
// 最后活跃周推导。正确性核心：窗口右界恒卡今天（用户预填未来日志的实证，
// findings F4）；逐条按 started 严格过滤（长周期任务携带数月历史，F5）。
// 注入安全：JQL 只使用端点返回的登录 ID（username 形参），原始输入永不拼接进 JQL。
import type { JiraClient } from './jira.ts'

export interface WorklogEntry {
  startedDate: string
  hours: number
  issueKey: string
  summary: string
  comment: string
}

export type ResolvedUser =
  | { status: 'unique'; name: string; displayName: string }
  | { status: 'ambiguous'; candidates: { name: string; displayName: string; active: boolean }[] }
  | { status: 'not-found' }

/** 名字解析：登录 ID 精确命中优先 → 显示名全等池 → 全部模糊结果池（全等池为空时落入）；
 * 池唯一即用、多个即歧义、空即 not-found。 */
export async function resolveUser(client: JiraClient, input: string): Promise<ResolvedUser> {
  // 脏数据守卫：无登录 ID 的候选不可作为查询主体（拼出空 worklogAuthor）
  const users = (await client.searchUsers(input)).filter(user => user.name !== '')
  if (users.length === 0) return { status: 'not-found' }
  const byLogin = users.filter(user => user.name === input)
  if (byLogin.length === 1) return { status: 'unique', name: byLogin[0]!.name, displayName: byLogin[0]!.displayName }
  const exact = users.filter(user => user.displayName === input)
  const pool = exact.length > 0 ? exact : users
  if (pool.length === 1) return { status: 'unique', name: pool[0]!.name, displayName: pool[0]!.displayName }
  return { status: 'ambiguous', candidates: pool }
}

/** 窗口采集：JQL worklogAuthor＋worklogDate（右界恒卡 today，含 to 缺省）；
 * 逐任务拉工时后按作者与 started 严格过滤——JQL 命中任务的工时列表含窗外条目。 */
export async function collectWorklogs(
  client: JiraClient,
  username: string,
  from: string | undefined,
  to: string | undefined,
  today: string,
): Promise<WorklogEntry[]> {
  const cappedTo = to === undefined || to > today ? today : to
  const conditions = [`worklogAuthor = "${username}"`, `worklogDate <= "${cappedTo}"`]
  if (from !== undefined) conditions.push(`worklogDate >= "${from}"`)
  const entries: WorklogEntry[] = []
  for (const rawIssue of await client.searchAll(conditions.join(' AND '), 'key,summary')) {
    const issue = rawIssue as { key?: unknown; fields?: { summary?: unknown } }
    const issueKey = String(issue.key ?? '')
    const summary = String(issue.fields?.summary ?? '')
    for (const rawLog of await client.worklogs(issueKey)) {
      const log = rawLog as { started?: unknown; timeSpentSeconds?: unknown; comment?: unknown; author?: { name?: unknown } }
      if (String(log.author?.name ?? '').toLowerCase() !== username.toLowerCase()) continue
      const startedDate = String(log.started ?? '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startedDate)) continue // 畸形/缺失 started：两路径一致丢弃
      if (from !== undefined && startedDate < from) continue
      if (startedDate > cappedTo) continue
      entries.push({
        startedDate,
        hours: Math.round(Number(log.timeSpentSeconds ?? 0) / 3600 * 100) / 100,
        issueKey,
        summary,
        comment: String(log.comment ?? '').replace(/\s+/g, ' ').trim(),
      })
    }
  }
  return entries
}

/** 最后活跃周：全部条目中最晚 startedDate 所在自然周（周一～周日）。 */
export function lastActiveWeek(entries: WorklogEntry[]): { monday: string; sunday: string } | undefined {
  let latest = ''
  for (const item of entries) if (item.startedDate > latest) latest = item.startedDate
  if (!latest) return undefined
  const t = new Date(`${latest}T00:00:00Z`)
  const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { monday: fmt(monday), sunday: fmt(new Date(monday.getTime() + 6 * 86400000)) }
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** 中文星期标签（取正午 UTC 避开夏令时偏移）。 */
export function weekdayCN(day: string): string {
  return `周${WEEKDAY_CN[new Date(`${day}T12:00:00Z`).getUTCDay()]!}`
}
