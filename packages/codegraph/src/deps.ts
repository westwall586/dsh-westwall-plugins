/** 本插件跨模块共享的依赖面：只暴露真实用到的宿主能力，便于单测注入替身。 */
import type { Context } from '@deepseek-ai/cordis'
import type * as McpClient from '@deepseek-ai/dsh-mcp-client'

/**
 * `McpClient.Config` 的输入型。
 *
 * 不能用 `McpClient.StdioConfig`：那个接口除 `startupTimeoutMs` 等少数几项外全是
 * 必填，它是 schema 归一化之后的形状；`ctx.plugin()` 收到的是归一化之前、允许省略
 * 默认值的输入形状。
 */
export type McpClientConfigInput = Parameters<typeof McpClient.Config>[0]

/** 扫描到的同名全局 CodeGraph 安装。 */
export interface GlobalInstall {
  /** 命中的 patch 文件。 */
  file: string
}

/** 插件配置。 */
export interface ResolvedConfig {
  /** CodeGraph CLI 绝对路径；省略时自动探测。 */
  command?: string
  /** 打开工作区时是否自动 `codegraph init`。 */
  initOnEnable: boolean
  /** `codegraph init` 超时。 */
  initTimeoutMs: number
  /** 是否注入 <system-reminder>。 */
  reminder: boolean
  /** 是否提示同名全局安装。 */
  warnGlobalInstall: boolean
  /** 连接 + 首次工具同步上限。 */
  startupTimeoutMs: number
  /** 断开上限，给 DSH 的 5 秒退出预算留余量。 */
  closeTimeoutMs: number
}

/** 首调验证：连上之后真的问一次，返回是否命中预期符号。 */
export interface ProbeRunner {
  /**
   * 用一个一次性连接问一个问题。
   * @param root - 项目 realpath，同时是 `--path` 与 cwd。
   * @param command - CodeGraph 可执行文件。
   * @param symbol - 期望命中的符号名。
   * @returns 命中的文件路径；未命中或调用失败返回失败原因。
   */
  (root: string, command: string, symbol: string): Promise<{ ok: true; file: string } | { ok: false; reason: string }>
}

/** 一个已挂载的 mcp-client 实例。 */
export interface ThreadHandle {
  /** 启动完成（连接 + 首次工具同步）。 */
  await(): Promise<void>
  /** 断开并等待清理。 */
  dispose(): Promise<void>
}

/**
 * 在给定作用域上下文里挂一个 mcp-client 实例。
 *
 * 返回值统一成 `ThreadHandle` 而不是 Cordis 的 fiber：调用方只关心"等待就绪"和
 * "回收"，fiber 的形状不进依赖面，单测替身才好写。
 */
export type OpenMcpClient = (
  scopeCtx: Context,
  config: McpClientConfigInput,
) => ThreadHandle

/** 插件依赖面。所有宿主服务的取用都经过这里，单测替换它即可。 */
export interface CodegraphDeps {
  ctx: Context
  config: ResolvedConfig
  openMcpClient: OpenMcpClient
  /** 扫描 $DSH_HOME 与各 profile 的 patch，找同名全局安装。 */
  globalInstall(): Promise<GlobalInstall | undefined>
  /** 首调验证用的真实查询；单测可换成永远失败的替身。 */
  probe: ProbeRunner
}
