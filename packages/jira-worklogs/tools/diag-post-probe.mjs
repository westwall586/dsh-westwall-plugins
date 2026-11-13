// 只读诊断（不产生写入）：用引擎真实 transport POST 无效 payload（真实 Jira 必 400），
// 观察引擎侧拿到的是 HttpError 还是「伪成功」。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { JiraClient } from '../src/engine/jira.ts'
import { makeHttpTransport } from '../src/engine/http.ts'

const patch = readFileSync(`${homedir()}/.dsh/profiles/web/cordis.patch.yml`, 'utf8')
const pick = (key) => {
  const m = new RegExp(`${key}:\\s*(.+)`).exec(patch)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}
const password = process.env.JIRA_PASSWORD
if (!password) { console.error('need JIRA_PASSWORD env'); process.exit(1) }

const transport = makeHttpTransport({ verifySsl: false })
const client = new JiraClient(pick('server'), pick('username'), password, transport, false)

try {
  const res = await client.addWorklog('DEMO-772', {
    timeSpent: 'abc', // 无效：Jira 必回 400，绝不会创建
    started: '2026-10-08T09:00:00.000+0800',
    comment: 'diag probe (invalid timeSpent, nothing can be created)',
  }, 'auto')
  console.log('!!! 伪成功：POST 返回：', JSON.stringify(res))
} catch (error) {
  console.log('引擎侧异常类：', error.constructor.name)
  console.log('message：', String(error.message).slice(0, 300))
}
