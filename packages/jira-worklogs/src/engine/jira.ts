// Jira REST 客户端——逐段对照参考实现 JiraClient 移植。
// 网络语义：无 body 请求网络抖动重试一次、HttpError 不重试、带 body 永不重试。
import { clientConfig, makeHttpTransport } from './http.ts'
import { HttpError, type Transport } from './types.ts'

const SEARCH_FIELDS = 'summary,status,assignee,issuetype,project,timespent,timeoriginalestimate'

export interface JiraWorklogPayload {
  started: string
  timeSpent: string
  comment: string
}

export class JiraClient {
  private readonly server: string
  private readonly headers: Record<string, string>
  private readonly transport: Transport

  constructor(server: string, username: string, password: string, transport?: Transport, verifySsl = false) {
    this.server = server.replace(/\/+$/, '')
    // 凭据可能含非 Latin1 字符，用 UTF-8 Buffer 编码（btoa 会直接抛 DOMException）。
    const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')
    // content-type 不在此常驻：由 transport 在有 body 时统一补（http.ts mergedHeaders），
    // 避免与 transport 侧小写 content-type 大小写并存成两个头发给 undici。
    this.headers = { Authorization: `Basic ${token}`, Accept: 'application/json' }
    this.transport = transport ?? makeHttpTransport({ verifySsl })
  }

  private async request<T>(method: string, path: string, params?: Record<string, string>, payload?: unknown): Promise<T> {
    const url = `${this.server}/${path.replace(/^\/+/, '')}${params ? `?${new URLSearchParams(params)}` : ''}`
    const call = () => this.transport(method, url, payload === undefined ? { headers: this.headers } : { headers: this.headers, body: payload })
    if (payload === undefined) {
      try {
        return await call() as T
      } catch (error) {
        if (error instanceof HttpError) throw error
        await new Promise(resolve => setTimeout(resolve, clientConfig.GET_RETRY_DELAY))
        return await call() as T
      }
    }
    return await call() as T
  }

  async myself(): Promise<Record<string, unknown>> {
    const me = await this.request<Record<string, unknown>>('GET', '/rest/api/2/myself')
    // 验收 E-1：本自建网关对无效凭据返回 200 空体——空 myself 视为凭据/网关异常，
    // 防止坏凭据静默呈现「全 0 缺口」的误导性成功外观。
    if (!me || typeof me !== 'object' || Object.keys(me).length === 0) {
      throw new Error('Jira 未返回当前用户（凭据无效或网关异常）')
    }
    return me
  }

  async searchAll(jql: string, fields?: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = []
    let start = 0
    for (;;) {
      const page = await this.request<{ issues?: unknown[]; total?: number }>('GET', '/rest/api/2/search', {
        jql,
        startAt: String(start),
        maxResults: '100',
        fields: fields ?? SEARCH_FIELDS,
      })
      const batch = page.issues ?? []
      result.push(...batch as Record<string, unknown>[])
      start += batch.length
      if (batch.length === 0 || start >= (page.total ?? 0)) return result
    }
  }

  async worklogs(issueKey: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = []
    let start = 0
    for (;;) {
      const page = await this.request<{ worklogs?: unknown[]; total?: number }>('GET', `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`, {
        startAt: String(start),
        maxResults: '100',
      })
      const batch = page.worklogs ?? []
      result.push(...batch as Record<string, unknown>[])
      start += batch.length
      if (batch.length === 0 || start >= (page.total ?? 0)) return result
    }
  }

  /** adjustEstimate 是 query 参数不是 body 字段——放 body 会被真实 Jira 以 400 拒绝。 */
  addWorklog(issueKey: string, payload: JiraWorklogPayload, adjustEstimate = 'auto'): Promise<Record<string, unknown>> {
    return this.request('POST', `/rest/api/2/issue/${encodeURIComponent(issueKey)}/worklog`, { adjustEstimate }, payload)
  }

  issue(issueKey: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { fields: SEARCH_FIELDS })
  }

  /** user/search 只读端点（登录 ID/姓名/邮箱模糊匹配，maxResults 20）。
   * 网关异常形态（非数组体）对齐网络错误路径——不静默吞成空候选。 */
  async searchUsers(query: string): Promise<{ name: string; displayName: string; active: boolean }[]> {
    const users = await this.request<unknown>('GET', '/rest/api/2/user/search', { username: query, maxResults: '20' })
    if (!Array.isArray(users)) throw new Error('Jira user/search 返回异常（网关或凭据问题）')
    return users
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
      .map(item => ({
        name: String(item.name ?? ''),
        displayName: String(item.displayName ?? ''),
        active: item.active !== false,
      }))
  }
}
