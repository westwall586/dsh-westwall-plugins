// 试验对照脚本共用的最小 settings 读取器：只认本插件节（jira-worklogs）的
// 规整缩进形态（2/4/6 空格 + 列表项），不做通用 YAML 解析。
// 迭代二一次性切换后凭据唯一来源是 ~/.dsh/settings.yaml（值只进脚本内存）。
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function split2(line) {
  const i = line.indexOf(':')
  return [line.slice(0, i), coerce(line.slice(i + 1).trim())]
}

/** schema 布尔字段不收字符串（schemastery 校验拒绝）， YAML 标量按需矫正。 */
function coerce(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

export function readPluginSettings() {
  const text = readFileSync(join(homedir(), '.dsh/settings.yaml'), 'utf8')
  const lines = text.split('\n')
  const start = lines.findIndex(l => l.startsWith('jira-worklogs:'))
  if (start < 0) throw new Error('~/.dsh/settings.yaml 无 jira-worklogs 节：先在设置页「Jira 工时」卡片保存配置')
  const out = { jira: {}, gitInstances: {}, repoFilter: [], project: {} }
  let ctx = out
  let inList = false
  for (const raw of lines.slice(start + 1)) {
    if (raw && !raw.startsWith(' ')) break
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    if (indent === 2) {
      const [k] = split2(line)
      inList = false
      if (k === 'jira') ctx = out.jira
      else if (k === 'gitInstances') ctx = out.gitInstances
      else if (k === 'repoFilter') { ctx = null; inList = true }
      else if (k === 'project') ctx = out.project
      else { const [k2, v] = split2(line); out[k2] = v }
    } else if (indent === 4) {
      if (inList) {
        if (line.startsWith('- ')) out.repoFilter.push(line.slice(2).trim())
      } else if (ctx === out.gitInstances) {
        const name = split2(line)[0]
        ctx = out.gitInstances[name] = {}
      } else {
        const [k, v] = split2(line)
        ctx[k] = v
      }
    } else if (indent === 6) {
      const [k, v] = split2(line)
      ctx[k] = v
    }
  }
  return out
}
