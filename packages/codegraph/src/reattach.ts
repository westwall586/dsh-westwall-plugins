/**
 * 会话激活后的补齐。
 *
 * `agent/created` 只在 Agent 创建时发一次：重启宿主后恢复的会话、以及在别处
 * 已经创建过的 Agent 都不会再触发它。所以除了创建事件，还要在会话被激活
 * （开始一轮、被打开）时补一次挂载尝试。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionMounts } from './sessions.ts'

/**
 * 监听会话激活，对尚未挂载的会话补一次 `attach`。
 * @param ctx - 插件上下文。
 * @param mounts - 会话挂载面；已挂载的会话会被跳过。
 * @returns 注销函数。
 */
export function registerReattach(ctx: Context, mounts: SessionMounts): () => void {
  const attempt = (sessionId: string): void => {
    if (mounts.rootFor(sessionId) !== undefined) return
    const agent = ctx.agents.get(sessionId as never)
    if (agent === undefined) return
    void mounts.attach(agent)
  }
  const offOpened = ctx.on('session/event', (session) => { attempt(session.id) })
  return offOpened
}
