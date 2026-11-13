// 数据契约类型：T01 起步（日期/env 基础），随任务推进补全。
// 内部引擎结构镜像参考实现 plan()/submit() 的 JSON 形态（snake_case），
// 窗口视图与素材等插件自有消费契约（camelCase）在服务边界映射。

/** Jira 凭据与连接配置（迭代二来源插件 settings 命名空间；JIRA_* 环境变量可覆盖）。 */
export interface JiraConfig {
  server: string
  username: string
  password: string
  /** 自建自签默认关闭校验；JIRA_VERIFY_SSL 显式开启。 */
  verifySsl: boolean
}

/** GitLab 实例配置（迭代二来源 settings 命名空间的 dict 实例映射，url+token 成对生效）。 */
export interface GitlabInstance {
  url: string
  token: string
  verifySsl: boolean
}

/** 引擎运行配置：凭据来自插件 settings 命名空间（迭代二一次性切换，不再读 ~/.sdlc env），只进 host 侧，不进任何输出。 */
export interface EngineConfig {
  jira: JiraConfig
  gitlab: GitlabInstance[]
  /** 仓库子串排除名单（迭代二参数化）；默认值由配置层给定。 */
  repoFilter: string[]
}

/** 请求初始化：写请求带 JSON body；认证头由客户端层注入。 */
export interface TransportInit {
  body?: unknown
  headers?: Record<string, string>
}

// 窗口视图与素材契约（旧动线 WorklogOverview/DraftMaterial 等）已随会话式生成
// 移除（2026-09-24 Wave）；弹窗改版的客户端契约在 src/service.ts（camelCase 五映射）。

/** 可注入 transport：测试替身入口（fake transport 契约见 tests/engine/）。 */
export type Transport = (
  method: string,
  url: string,
  init?: TransportInit,
) => Promise<unknown>

/** HTTP 4xx/5xx 的归一错误——客户端层据此区分「确定性失败」与网络抖动。 */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, reason: string) {
    super(`HTTP ${status}: ${reason}`)
    this.name = 'HttpError'
    this.status = status
  }
}
