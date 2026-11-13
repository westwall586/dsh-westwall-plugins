// 只读诊断：查 10/08 该任务的 worklog 实况（不写 Jira）。
// 用法：JIRA_PASSWORD=... node tools/diag-uncertain.mjs
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { JiraClient } from '../src/engine/jira.ts'

const patch = readFileSync(`${homedir()}/.dsh/profiles/web/cordis.patch.yml`, 'utf8')
const pick = (key) => {
  const m = new RegExp(`${key}:\\s*(.+)`).exec(patch)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}
const server = process.env.JIRA_SERVER || pick('server')
const username = pick('username')
const password = process.env.JIRA_PASSWORD
if (!password) { console.error('need JIRA_PASSWORD env'); process.exit(1) }

const client = new JiraClient(server, username, password, undefined, false)

const me = await client.myself()
console.log('myself ok:', me.name ?? me.key ?? me.accountId, '| timeZone:', me.timeZone)

const search = await client.searchAll(
  `assignee = currentUser() AND worklogDate = "2026-10-08" AND worklogAuthor = currentUser()`,
  'summary,worklog,timespent',
)
console.log('worklogDate=2026-10-8 issues:', search.length)
for (const issue of search) console.log(' -', issue.key, issue.fields?.summary)

// 也直接按 summary 找该任务，拉全量 worklog 看最近写入
const issues = await client.searchAll(`summary ~ "云端Agent方案与落地"`, 'summary,worklog')
console.log('summary match issues:', issues.map(i => i.key))
for (const issue of issues) {
  const wls = await client.worklogs(issue.key)
  const recent = wls.slice(-5)
  console.log(`issue ${issue.key} worklogs(${wls.length}) recent:`)
  for (const w of recent) {
    console.log('  id=', w.id, 'started=', w.started, 'secs=', w.timeSpentSeconds,
      'author=', w.author?.name ?? w.author?.key, 'comment=', JSON.stringify(w.comment)?.slice(0, 80),
      'updated=', w.updated)
  }
}
