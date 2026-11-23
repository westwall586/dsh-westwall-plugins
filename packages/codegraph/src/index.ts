/**
 * @westwall/dsh-codegraph — 按 DSH 工作区托管 CodeGraph 的 MCP 线程。
 *
 * 一个工作区（realpath）一个状态；打开后，该工作区里的每个会话各自在会话作用域
 * 下挂一个 mcp-client 实例，因此 CodeGraph 的工具与它自带的 MCP instructions 都按
 * 会话作用域出现，会话结束即销毁。关闭不写用户的 AGENTS.md，也不删 CodeGraph
 * 自己的 `.codegraph/`。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-working-directory'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { detectGlobalInstall } from './global-install.ts'
import { createProbeRunner } from './probe.ts'
import { createWorkspaceOps } from './lifecycle.ts'
import { registerProjectGuard } from './guard.ts'
import { registerDirectoryChanges } from './reconnect.ts'
import { registerReattach } from './reattach.ts'
import { registerReminder } from './reminder.ts'
import { CodegraphAdminService } from './admin.ts'
import { resolveCommand } from './cli.ts'
import { registerSessionMounts } from './sessions.ts'
import { openCodegraphStore } from './state.ts'
import type { StorageDomainFacility } from './state.ts'
import { registerTools } from './tools.ts'
import type { CodegraphDeps, ResolvedConfig } from './deps.ts'

export const name = 'codegraph'

export const inject = ['tools', 'agents', 'workingDirectory']

export const SERVER_NAME = 'codegraph'

export const Config = z.object({
  /** CodeGraph CLI 绝对路径；省略时自动探测。 */
  command: z.string(),
  /** 打开工作区时是否自动执行 `codegraph init`。 */
  initOnEnable: z.boolean().default(true),
  /** `codegraph init` 的超时（毫秒）。后台执行，不阻塞会话。 */
  initTimeoutMs: z.number().min(1_000).default(600_000),
  /** 连接 + 首次工具同步上限（毫秒）。 */
  startupTimeoutMs: z.number().min(1).default(8_000),
  /** 断开上限（毫秒），给 DSH 的 5 秒退出预算留余量。 */
  closeTimeoutMs: z.number().min(1).default(1_500),
  /** 是否注入 <system-reminder>；量化 token 成本前默认关。 */
  reminder: z.boolean().default(false),
  /** 检测同名全局安装并提示。 */
  warnGlobalInstall: z.boolean().default(true),
})

export type CodegraphConfig = ResolvedConfig

/** Cordis 传入的是归一化之前的输入，默认值由 schema 补齐。 */
type ConfigInput = Partial<Omit<ResolvedConfig, 'startupTimeoutMs' | 'closeTimeoutMs'>>
  & Pick<ResolvedConfig, 'startupTimeoutMs' | 'closeTimeoutMs'>

function resolveConfig(raw: ConfigInput): ResolvedConfig {
  return {
    ...raw.command === undefined || raw.command === '' ? {} : { command: raw.command },
    initOnEnable: raw.initOnEnable ?? true,
    initTimeoutMs: raw.initTimeoutMs ?? 600_000,
    reminder: raw.reminder ?? false,
    warnGlobalInstall: raw.warnGlobalInstall ?? true,
    startupTimeoutMs: raw.startupTimeoutMs,
    closeTimeoutMs: raw.closeTimeoutMs,
  }
}

/** 把 mcp-client 的 fiber 收成依赖面要求的形状，调用方不必认识 Cordis fiber。 */
const openMcpClient: CodegraphDeps['openMcpClient'] = (scopeCtx, config) => {
  const fiber = scopeCtx.plugin(McpClient, config)
  return {
    await: () => fiber.await().then(() => {}),
    dispose: () => fiber.dispose(),
  }
}

export function createDeps(ctx: Context, config: ResolvedConfig): CodegraphDeps {
  const deps: CodegraphDeps = {
    ctx,
    config,
    openMcpClient,
    globalInstall: () => detectGlobalInstall(ctx),
    probe: () => Promise.resolve({ ok: false, reason: '首调验证尚未接线' }),
  }
  return { ...deps, probe: createProbeRunner(ctx, deps) }
}

export async function apply(ctx: Context, rawConfig: ConfigInput): Promise<void> {
  const config = resolveConfig(rawConfig)
  const deps = createDeps(ctx, config)

  // 存储域晚于本插件出现是正常组合，所以整段挂载都在注入回调里建，
  // 服务缺席时本插件只是没有开关可读，不该连带它的依赖一起挂不上。
  ctx.inject(['storageDomain'], (storageCtx) => {
    // 注入回调的返回值是它自己作用域的 disposer；存储与连接都要在这里回收，
    // 而且不能提前调 close（早先那版把 close 交给了外层 async，作用域一结束域就关了）。
    let store: Awaited<ReturnType<typeof openCodegraphStore>> | undefined
    let sessions: ReturnType<typeof registerSessionMounts> | undefined
    void (async () => {
      const opened = await openCodegraphStore(storageCtx.storageDomain as StorageDomainFacility)
      store = opened
      const ops = createWorkspaceOps(opened, deps)
      const mounts = registerSessionMounts(storageCtx, deps, opened, ops)
      sessions = mounts
      registerProjectGuard(storageCtx, {
        serverName: SERVER_NAME,
        rootFor: sessionId => mounts.rootFor(sessionId),
        currentRootFor: sessionId => {
          const agent = storageCtx.agents.get(sessionId as never)
          return agent === undefined ? undefined : storageCtx.workingDirectory.get(agent.session)
        },
      })
      registerDirectoryChanges(storageCtx, mounts)
      registerReattach(storageCtx, mounts)
      registerTools(storageCtx, opened, mounts)
      registerReminder(storageCtx, deps, opened)
      new CodegraphAdminService(
        storageCtx,
        opened,
        ops,
        mounts,
        () => resolveCommand(deps.config.command),
        () => deps.globalInstall().then(found => found?.file),
      )


    })().catch((error: unknown) => {
      console.warn('[dsh-codegraph] storage domain setup failed:', error)
    })
    // 作用域被回收时才关存储与连接，顺序是先拆连接再关域。
    return () => {
      void (async () => {
        await sessions?.close()
        await store?.close()
      })().catch((error: unknown) => {
        console.warn('[dsh-codegraph] releasing storage failed:', error)
      })
    }
  })
}
