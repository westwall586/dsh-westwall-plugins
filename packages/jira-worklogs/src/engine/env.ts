// 迭代二一次性切换：~/.sdlc/jira.env 与 gitlab.env 的装载路径整体删除
// （SPEC 拍板「一次性切换」，不读取、不导入）。本文件仅保留 JIRA_* 进程
// 环境变量覆盖 helper（调试后门，优先级最高；编号形 GITLAB_* 随数组结构
// 废止——findings D13）。凭据只在本层与客户端层出现，绝不进入任何输出。

const truthy = (value: string | undefined) =>
  ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())

export interface JiraEnvOverrides {
  server?: string
  username?: string
  password?: string
  verifySsl?: boolean
}

/** JIRA_* 进程环境变量覆盖（设置值之后应用）。 */
export function envJiraOverrides(): JiraEnvOverrides {
  const env = process.env
  return {
    ...(env.JIRA_SERVER !== undefined ? { server: env.JIRA_SERVER } : {}),
    ...(env.JIRA_USERNAME !== undefined ? { username: env.JIRA_USERNAME } : {}),
    ...(env.JIRA_PASSWORD !== undefined ? { password: env.JIRA_PASSWORD } : {}),
    ...(env.JIRA_VERIFY_SSL !== undefined ? { verifySsl: truthy(env.JIRA_VERIFY_SSL) } : {}),
  }
}
