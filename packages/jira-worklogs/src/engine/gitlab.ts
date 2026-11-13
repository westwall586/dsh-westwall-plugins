// GitLab 客户端与按日素材聚合——逐段对照参考实现 GitlabClient / collect_git_activity 移植。
// 归因以推送事件为准（agent 落盘的机器人提交也算本人工作）；
// context-repo 状态库过滤并显式记录；当日未推送过的项目提交不进素材。
import { commitLocalDate } from './dates.ts'
import { clientConfig, makeHttpTransport } from './http.ts'
import { HttpError, type GitlabInstance, type Transport } from './types.ts'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export class GitlabClient {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly transport: Transport

  constructor(baseUrl: string, token: string, transport?: Transport, verifySsl = false) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.headers = { 'PRIVATE-TOKEN': token, Accept: 'application/json' }
    this.transport = transport ?? makeHttpTransport({ verifySsl })
  }

  /** 只读查询：网络抖动重试一次；HTTP 确定性失败不重试；写入（带 body）永不重试。 */
  private async request<T>(method: string, path: string, params?: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}${params ? `?${new URLSearchParams(params)}` : ''}`
    const call = () => this.transport(method, url, { headers: this.headers })
    try {
      return await call() as T
    } catch (error) {
      if (error instanceof HttpError || method !== 'GET') throw error
      await sleep(clientConfig.GET_RETRY_DELAY)
      return await call() as T
    }
  }

  myself(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/v4/user')
  }

  async pushEvents(userId: number, afterIso: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = []
    let page = 1
    for (;;) {
      const batch = await this.request<Record<string, unknown>[]>('GET', `/api/v4/users/${userId}/events`, {
        action: 'pushed',
        after: afterIso,
        per_page: '100',
        page: String(page),
        sort: 'desc',
      })
      if (!Array.isArray(batch) || batch.length === 0) return result
      result.push(...batch)
      if (batch.length < 100) return result
      page += 1
    }
  }

  project(projectId: number): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/v4/projects/${projectId}`)
  }

  async commits(projectId: number, sinceIso: string, untilIso: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = []
    let page = 1
    for (;;) {
      const batch = await this.request<Record<string, unknown>[]>('GET', `/api/v4/projects/${projectId}/repository/commits`, {
        all: 'true',
        since: sinceIso,
        until: untilIso,
        per_page: '100',
        page: String(page),
      })
      if (!Array.isArray(batch) || batch.length === 0) return result
      result.push(...batch)
      if (batch.length < 100) return result
      page += 1
    }
  }
}

export interface CommitEvidence {
  time: string
  id: string
  title: string
  author: string
}

export interface DayProjectActivity {
  project: string
  project_id: number
  push_count: number
  commits: CommitEvidence[]
}

export interface GitActivityRow {
  url: string
  status: 'ok' | 'error'
  user?: string
  error?: string
  projects?: number
  filtered_context_repos?: string[]
}

export interface GitActivity {
  enabled: boolean
  instances: GitActivityRow[]
  by_date: Record<string, DayProjectActivity[]>
}

/** 轮询实例，按日期聚合本人推送过的项目及其提交素材（参考 collect_git_activity）。
 * repoFilter＝子串排除名单（迭代二参数化：命中即排除并计入 filtered_context_repos，
 * 空名单不过滤）；名单语义与产品默认值由配置层给定，引擎不内置。 */
export async function collectGitActivity(
  instances: GitlabInstance[],
  dates: string[],
  repoFilter: string[],
  clientFactory: (instance: GitlabInstance) => GitlabClient = instance =>
    new GitlabClient(instance.url, instance.token, undefined, instance.verifySsl),
): Promise<GitActivity> {
  const by_date: Record<string, DayProjectActivity[]> = {}
  for (const day of dates) by_date[day] = []
  if (instances.length === 0) return { enabled: false, instances: [], by_date }
  const start = dates.reduce((min, day) => (day < min ? day : min))
  const end = dates.reduce((max, day) => (day > max ? day : max))
  const shift = (day: string, delta: number) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
  const sinceIso = `${start}T00:00:00+08:00`
  const untilIso = `${shift(end, 1)}T00:00:00+08:00`
  // GitLab 13.8 的 events after 按天粒度严格大于：传「窗口首日 00:00Z」会把首日事件全部排除
  // （日详情单日查询恒空）。往前放宽一天；窗口外事件由本地按日归因过滤兜底，不会多算素材。
  const afterIso = `${shift(start, -1)}T00:00:00Z`
  const window = new Set(dates)
  const instanceRows: GitActivityRow[] = []
  for (const instance of instances) {
    const row: GitActivityRow = { url: instance.url, status: 'error' }
    const client = clientFactory(instance)
    try {
      const me = await client.myself()
      row.user = String((me as { username?: unknown }).username ?? '')
      const userId = Number((me as { id?: unknown }).id ?? 0)
      if (!userId) throw new Error('GitLab 未返回用户 id')
      const events = await client.pushEvents(userId, afterIso)
      const pushCounts = new Map<string, number>()
      const projectIds = new Set<number>()
      for (const event of events) {
        const pid = (event as { project_id?: unknown }).project_id
        const day = commitLocalDate((event as { created_at?: unknown }).created_at)
        if (!pid || day === null) continue
        projectIds.add(Number(pid))
        const key = `${pid}|${day}`
        pushCounts.set(key, (pushCounts.get(key) ?? 0) + 1)
      }
      const names = new Map<number, string>()
      const filtered: string[] = []
      for (const pid of [...projectIds].sort((a, b) => a - b)) {
        const project = await client.project(pid)
        const rawName = String((project as { path_with_namespace?: unknown }).path_with_namespace ?? pid)
        if (repoFilter.some(pattern => rawName.includes(pattern))) {
          // 命中排除名单的工作区库（如 agent 自动落盘的状态库），不代表需要记工时的开发工作。
          filtered.push(rawName)
          continue
        }
        names.set(pid, rawName)
        const buckets = new Map<string, CommitEvidence[]>()
        for (const commit of await client.commits(pid, sinceIso, untilIso)) {
          const day = commitLocalDate((commit as { committed_date?: unknown }).committed_date)
          if (day === null || !window.has(day)) continue
          const bucket = buckets.get(day) ?? []
          bucket.push({
            time: String((commit as { committed_date?: unknown }).committed_date ?? ''),
            id: String((commit as { short_id?: unknown; id?: unknown }).short_id ?? (commit as { id?: unknown }).id ?? ''),
            title: String((commit as { title?: unknown }).title ?? ''),
            author: String((commit as { author_name?: unknown }).author_name ?? ''),
          })
          buckets.set(day, bucket)
        }
        for (const [day, commits] of buckets) {
          if ((pushCounts.get(`${pid}|${day}`) ?? 0) === 0) {
            // 当日本人未推送该项目的提交（多为他人合入 main）不进素材，防止把别人的工作当证据
            continue
          }
          by_date[day]!.push({
            project: names.get(pid)!,
            project_id: pid,
            push_count: pushCounts.get(`${pid}|${day}`) ?? 0,
            commits,
          })
        }
      }
      row.status = 'ok'
      row.projects = names.size
      if (filtered.length > 0) row.filtered_context_repos = filtered
    } catch (error) {
      // 单实例失败不阻断其他实例与 Jira 部分
      row.status = 'error'
      row.error = error instanceof Error ? error.message : String(error)
    }
    instanceRows.push(row)
  }
  return { enabled: true, instances: instanceRows, by_date }
}
