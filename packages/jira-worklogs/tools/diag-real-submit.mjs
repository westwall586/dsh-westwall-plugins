// 真实提交 10/08 工时（用户已授权），并记录 POST / 回读的原始返回。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { JiraClient } from '../src/engine/jira.ts'
import { makeHttpTransport } from '../src/engine/http.ts'
import { HttpError } from '../src/engine/types.ts'

const patch = readFileSync(`${homedir()}/.dsh/profiles/web/cordis.patch.yml`, 'utf8')
const pick = (key) => {
  const m = new RegExp(`${key}:\\s*(.+)`).exec(patch)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}
const password = process.env.JIRA_PASSWORD
if (!password) { console.error('need JIRA_PASSWORD env'); process.exit(1) }

// 包一层记录日志的 transport：打印每个请求的 method/status
const inner = makeHttpTransport({ verifySsl: false })
const logging = async (method, url, init) => {
  const short = String(url).replace(/^https:\/\/[^/]+/, '')
  try {
    const res = await inner(method, url, init)
    console.log(`[HTTP] ${method} ${short} -> 2xx OK`)
    return res
  } catch (error) {
    if (error instanceof HttpError) console.log(`[HTTP] ${method} ${short} -> ${error.message.slice(0, 200)}`)
    else console.log(`[HTTP] ${method} ${short} -> 网络异常: ${String(error).slice(0, 200)}`)
    throw error
  }
}

const client = new JiraClient(pick('server'), pick('username'), password, logging, false)
const KEY = 'DEMO-772'
const payload = {
  timeSpent: '8h',
  started: '2026-10-08T09:00:00.000+0800',
  comment: 'AIO 沙箱镜像构建与 CI 源修复；沙箱 Node 版本参数与双版本安装；浏览器能力验证',
}

// 前置查重
const me = await client.myself()
const before = await client.worklogs(KEY)
const dup = before.some(w => String(w.started).startsWith('2026-10-08') && w.author?.name === me.name)
console.log('前置查重：该 issue 上 2026-10-08 已有本人 worklog？', dup)
if (dup) { console.log('已存在，不重复写入'); process.exit(0) }

// 真实 POST
try {
  const res = await client.addWorklog(KEY, payload, 'auto')
  console.log('POST 成功，响应 JSON =', JSON.stringify(res))
  const after = await client.worklogs(KEY)
  const hit = after.find(w => String(w.id) === String(res.id))
  console.log('回读：按响应 id 找到记录？', hit != null, hit ? `started=${hit.started} secs=${hit.timeSpentSeconds}` : '')
  const five = after.filter(w => String(w.started).startsWith('2026-10-08'))
  console.log('回读：2026-10-08 当日记录数 =', five.length, five.map(w => w.id).join(','))
} catch (error) {
  console.log('POST 失败：', error.constructor.name, String(error.message).slice(0, 300))
}
