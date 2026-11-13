// 只读对照：直连 REST（不经引擎客户端）vs 引擎 plan 输出
// 迭代二适配：凭据唯一来源改为插件 settings 节（~/.dsh/settings.yaml）。
import { request } from 'undici'
import { readPluginSettings } from './lib-settings.mjs'

const settings = readPluginSettings()
const env = { JIRA_USERNAME: settings.jira.username, JIRA_PASSWORD: settings.jira.password, JIRA_SERVER: settings.jira.server }
const auth = 'Basic ' + Buffer.from(`${env.JIRA_USERNAME}:${env.JIRA_PASSWORD}`).toString('base64')
const server = env.JIRA_SERVER.replace(/\/+$/, '')

async function jiraGet(path) {
  const res = await request(server + path, { headers: { Authorization: auth, Accept: 'application/json' }, dispatcher: new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } }) })
  if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode} ${path}`)
  return JSON.parse(await res.body.text())
}

// 直连：worklogAuthor JQL 找 issue，逐 issue 拉 worklog，按日汇总本人秒数
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const days = []
for (let i = 1; days.length < 5;) {
  const d = new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10)
  const dow = new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay()
  if (dow !== 0 && dow !== 6) days.push(d)
  i++
}
days.push(today)
const start = days[0], end = today
const search = await jiraGet(`/rest/api/2/search?jql=${encodeURIComponent(`worklogAuthor = currentUser() AND worklogDate >= "${start}" AND worklogDate <= "${end}"`)}&fields=key&maxResults=100`)
const direct = {}
for (const d of days) direct[d] = 0
for (const issue of search.issues ?? []) {
  const logs = await jiraGet(`/rest/api/2/issue/${issue.key}/worklog?maxResults=100`)
  for (const log of logs.worklogs ?? []) {
    const day = log.started.slice(0, 10)
    if (day in direct && String(log.author?.name ?? '').toLowerCase() === String(env.JIRA_USERNAME).toLowerCase()) {
      direct[day] += (log.timeSpentSeconds ?? 0) / 3600
    }
  }
}
console.log('直连 Jira 每日小时:', JSON.stringify(Object.fromEntries(Object.entries(direct).map(([k, v]) => [k, Math.round(v * 100) / 100])), null, 0))

// 引擎：同一窗口的 plan 输出
const engine = await import('../src/engine/index.ts')
const { engineConfigFrom } = await import('../src/settings.ts')
const cfg = engineConfigFrom(settings)
const client = new engine.JiraClient(cfg.jira.server, cfg.jira.username, cfg.jira.password, undefined, cfg.jira.verifySsl)
const plan = await engine.plan(client, today, { checkDays: 5, gitInstances: [], repoFilter: cfg.repoFilter })
const engineDaily = Object.fromEntries(plan.worklog_check.daily.map(r => [r.date, Math.round(r.hours * 100) / 100]))
console.log('引擎 plan 每日小时:', JSON.stringify(engineDaily, null, 0))

const mismatch = Object.entries(direct).filter(([d, v]) => Math.abs((engineDaily[d] ?? -1) - v) > 0.01)
console.log(mismatch.length === 0 ? '对照一致 ✓' : `不一致: ${JSON.stringify(mismatch)}`)
