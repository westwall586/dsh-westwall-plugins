/**
 * 首调验证：用一次真实查询确认这条索引能回答这个项目。
 *
 * 判定不能只看"有正文"。CodeGraph 在查不到某个符号时不报错，它返回本项目里
 * 最接近的结果，所以"有正文"永远成立。要证明的是"这个项目确实被索引了"，
 * 就得拿预先选定的真实符号去问，并检查答案里出现它的定义文件。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { CodegraphDeps, ProbeRunner } from './deps.ts'
import { answerProvesProject } from './probe-judge.ts'
import { mcpConfigFor } from './thread.ts'

/**
 * 工具名由 mcp-client 的 `serverName` 决定，探针用的是同一个命名空间。
 */
export const PROBE_TOOL = 'mcp__codegraph__codegraph_explore'

/** 一次查询的等待上限。首调是安装流程的一部分，慢一点可以接受，不能没有上限。 */
const PROBE_CALL_TIMEOUT_MS = 60_000

/**
 * 写一个会走真实连接的探针。
 *
 * `McpClient.probeServer` 只握手与列工具，证明不了项目被索引；所以这里在临时
 * 作用域里挂一个真的 mcp-client、等它启动、发一次查询，再拆掉。失败一律折成
 * 原因字符串，调用方写进状态机。
 */
export function createProbeRunner(
  ctx: Context,
  deps: Pick<CodegraphDeps, 'config' | 'openMcpClient'>,
): ProbeRunner {
  return async (root, command, symbol) => {
    const scope = createScope(ctx, { probe: root })
    try {
      const handle = deps.openMcpClient(scope.ctx, mcpConfigFor(deps as never, root, command) as McpClient.Config)
      await handle.await()
      const tool = scope.ctx.tools.executable(PROBE_TOOL)
      if (tool === undefined) return { ok: false, reason: `连接建立后没有 ${PROBE_TOOL} 工具` }
      const output = tool.output as { render: (args: unknown, value: unknown) => Array<{ type: string; text?: string }> }
      const text = await withTimeout(
        executeTool(tool, scope.ctx, symbol).then(value => output.render({ query: symbol }, value)),
        PROBE_CALL_TIMEOUT_MS,
      )
      const body = text.map(block => block.text ?? '').join('\n')
      const verdict = answerProvesProject(body, symbol)
      return verdict.ok
        ? { ok: true, file: verdict.files[0]! }
        : { ok: false, reason: `查询「${symbol}」没有返回它的定义` }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    } finally {
      await scope.dispose().catch(() => {})
    }
  }
}

async function executeTool(
  tool: { execute: unknown },
  ctx: Context,
  query: string,
): Promise<unknown> {
  const run = tool.execute as (args: unknown, exec: unknown) => Promise<unknown>
  return run({ query }, { ctx, signal: new AbortController().signal })
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`首调验证超时（${timeoutMs}ms）`)), timeoutMs)
    work.then(
      value => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}
