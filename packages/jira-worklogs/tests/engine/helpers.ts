// fake transport 助手——移植自参考实现 tests/test_jira_worklog.py 的
// FakeTransport / FakeGitlabTransport / FlakyTransport（闭包工厂形态）。
import type { Transport } from '../../src/engine/types.ts'

export interface CallRecord {
  method: string
  url: string
  body?: unknown
  headers?: Record<string, string>
}

export function myselfData() {
  return { name: 'alice', key: 'alice', emailAddress: 'a@example.com', displayName: 'Alice' }
}

export function issueData(summary = '示例任务甲', key = 'DEMO-745') {
  return {
    id: '351314',
    key,
    fields: {
      summary,
      status: { name: 'Todo' },
      assignee: { displayName: 'Alice' },
      issuetype: { name: '子任务' },
      project: { key: 'DEMO' },
      timespent: 3600,
      timeoriginalestimate: 28800,
    },
  }
}

export function worklogItem(id: string, day: string, timeSpent: string, seconds: number, comment: string, author = 'alice') {
  return {
    id,
    started: `${day}T09:00:00.000+0800`,
    timeSpent,
    timeSpentSeconds: seconds,
    comment,
    author: { name: author, displayName: author === 'alice' ? 'Alice' : author },
  }
}

type Init = { body?: unknown; headers?: Record<string, string> }

/** Jira 假后端：myself / search / issue worklog 读写 / user search，记录全部调用。 */
export function fakeJira(options: {
  myself?: unknown
  issues?: unknown[]
  logs?: Record<string, unknown[]>
  worklogIssues?: { key: string }[]
  /** GET /issue/:key 的逐键返回（resolveTaskNames 名称解析用）；未命中回退 issueData()。 */
  issueGet?: Record<string, unknown>
  /** issuekey in (…) 核查 JQL 的返回（generateFlow 存在性核查用），默认空＝不命中。 */
  issueKeySearch?: unknown[]
  /** /rest/api/2/user/search 的原始响应（searchUsers 用）；非数组照原样返回。 */
  userSearch?: unknown
} = {}): Transport & { calls: CallRecord[]; logs: Record<string, unknown[]>; nextId: () => number } {
  const state = {
    calls: [] as CallRecord[],
    logs: options.logs ?? {},
    next: 900,
  }
  const fn: Transport = (method, url, init?: Init) => {
    state.calls.push({ method, url, body: init?.body, headers: init?.headers })
    if (url.endsWith('/rest/api/2/myself')) return Promise.resolve(options.myself ?? myselfData())
    if (url.includes('/rest/api/2/user/search')) return Promise.resolve(options.userSearch ?? [])
    if (url.includes('/rest/api/2/search')) {
      // JQL 经 URLSearchParams 编码进查询串（空格→+、括号/逗号→%28%29…），先解码再分派
      const jql = decodeURIComponent(url.replaceAll('+', ' '))
      const batch = jql.includes('issuekey in')
        ? (options.issueKeySearch ?? [])
        : jql.includes('worklogAuthor')
          ? (options.worklogIssues ?? Object.keys(state.logs).map(key => ({ key })))
          : (options.issues ?? [issueData()])
      return Promise.resolve({ startAt: 0, maxResults: 100, total: batch.length, issues: batch })
    }
    const issue = url.match(/\/rest\/api\/2\/issue\/([^/?]+)(?:\?|$)/)
    if (issue && method === 'GET') {
      const hit = options.issueGet?.[issue[1]!]
      if (hit) return Promise.resolve(hit)
      return Promise.reject(new Error(`unexpected issue ${issue[1]}（issueGet 未提供，模拟解析失败）`))
    }
    const worklog = url.match(/\/rest\/api\/2\/issue\/([^/]+)\/worklog/)
    if (worklog) {
      const key = worklog[1]!
      if (method === 'POST') {
        const payload = init?.body as { started: string; timeSpent: string; comment: string }
        const item = {
          id: String(state.next++),
          started: payload.started,
          timeSpent: payload.timeSpent,
          timeSpentSeconds: Math.round(Number.parseFloat(payload.timeSpent) * 3600),
          comment: payload.comment,
          author: { name: 'alice', displayName: 'Alice' },
        }
        ;(state.logs[key] ??= []).push(item)
        return Promise.resolve({ id: item.id })
      }
      const logs = (state.logs[key] ??= [])
      return Promise.resolve({ startAt: 0, maxResults: 100, total: logs.length, worklogs: logs })
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`))
  }
  return Object.assign(fn, {
    get calls() { return state.calls },
    get logs() { return state.logs },
    nextId: () => state.next,
  })
}

/** GitLab 假后端：user / push events / project / commits。 */
export function fakeGitlab(user: { id: number; username: string }, events: Record<string, unknown>[], projects: Record<number, Record<string, unknown>>, commits: Record<number, Record<string, unknown>[]>): Transport & { calls: CallRecord[] } {
  const calls: CallRecord[] = []
  const fn: Transport = (method, url, init?: Init) => {
    calls.push({ method, url, body: init?.body, headers: init?.headers })
    if (url.endsWith('/api/v4/user')) return Promise.resolve(user)
    if (/\/api\/v4\/users\/\d+\/events/.test(url)) return Promise.resolve(events)
    const project = url.match(/\/api\/v4\/projects\/(\d+)/)
    if (project) {
      const pid = Number(project[1])
      if (url.includes('/repository/commits')) return Promise.resolve(commits[pid] ?? [])
      return Promise.resolve(projects[pid] ?? {})
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`))
  }
  return Object.assign(fn, { calls })
}

/** 首次命中目标 method+url 时抛给定错误，其后放行内层；记录全部调用。 */
export function flaky(inner: Transport, method: string, match: (url: string) => boolean, error: Error): Transport & { calls: { method: string; url: string }[] } {
  const calls: { method: string; url: string }[] = []
  let raised = 0
  const fn: Transport = (m, url, init?: Init) => {
    calls.push({ method: m, url })
    if (raised === 0 && m === method && match(url)) {
      raised += 1
      return Promise.reject(error)
    }
    return Promise.resolve(inner(m, url, init))
  }
  return Object.assign(fn, { calls })
}
