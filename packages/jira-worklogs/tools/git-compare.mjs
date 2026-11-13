// 只读对照（Git 侧，同口径）：直连 events + 过滤名单 + 全实例
// vs 引擎 collectGitActivity 的 by_date push_count（含过滤名单语义）。
// 迭代二适配：实例与名单唯一来源改为插件 settings 节（~/.dsh/settings.yaml）。
import { request, Agent } from 'undici'
import { readPluginSettings } from './lib-settings.mjs'

const settings = readPluginSettings()
const instances = Object.values(settings.gitInstances)
  .filter(row => row.url && row.token)
  .map(row => ({ url: row.url, token: row.token }))
const repoFilter = settings.repoFilter

const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const days = [today]
for (let i = 1; days.length < 5;) {
  const d = new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10)
  const dow = new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay()
  if (dow !== 0 && dow !== 6) days.unshift(d)
  i++
}
const windowDays = new Set(days)

const direct = Object.fromEntries(days.map(d => [d, 0]))
for (const inst of instances) {
  const agent = new Agent({ connect: { rejectUnauthorized: false } })
  const gl = async path => {
    const res = await request(inst.url.replace(/\/+$/, '') + path, { headers: { 'PRIVATE-TOKEN': inst.token, Accept: 'application/json' }, dispatcher: agent })
    if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode} ${path}`)
    return JSON.parse(await res.body.text())
  }
  const me = await gl('/api/v4/user')
  const after = `${days[0]}T00:00:00Z`
  const pidDay = new Map()
  for (let page = 1; ; page++) {
    const batch = await gl(`/api/v4/users/${me.id}/events?action=pushed&after=${after}&per_page=100&page=${page}&sort=desc`)
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const e of batch) {
      const day = new Date(Date.parse(e.created_at) + 8 * 3600000).toISOString().slice(0, 10)
      if (!windowDays.has(day) || !e.project_id) continue
      const key = `${e.project_id}|${day}`
      pidDay.set(key, (pidDay.get(key) ?? 0) + 1)
    }
    if (batch.length < 100) break
  }
  for (const [key, count] of pidDay) {
    const [pid, day] = key.split('|')
    let name = ''
    try { name = String((await gl(`/api/v4/projects/${pid}`)).path_with_namespace ?? '') } catch { continue }
    if (repoFilter.some(pattern => name.includes(pattern))) continue // 与引擎同口径：过滤名单
    direct[day] += count
  }
}
console.log('直连（同口径）推送数:', JSON.stringify(direct))

const engine = await import('../src/engine/index.ts')
const activity = await engine.collectGitActivity(instances, days, repoFilter)
const engineCounts = Object.fromEntries(Object.entries(activity.by_date).map(([d, items]) => [d, items.reduce((s, i) => s + i.push_count, 0)]))
console.log('引擎推送数:', JSON.stringify(engineCounts))
const mismatch = days.filter(d => (direct[d] ?? 0) !== (engineCounts[d] ?? 0))
console.log(mismatch.length === 0 ? 'Git 对照一致 ✓（口径：全实例、context-repo 过滤）' : `不一致: ${mismatch.map(d => `${d} 直连${direct[d]} 引擎${engineCounts[d] ?? 0}`).join('; ')}`)
