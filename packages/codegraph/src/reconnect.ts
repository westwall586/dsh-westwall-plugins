/**
 * 会话目录变化后的重挂。
 *
 * 会话中途 `cd` 是合法操作，但连接是建立时按当时目录选的。目录一换，旧连接就在
 * 回答另一个项目的问题，所以这里把"目录变了"翻译成"拆掉重建"：新目录所属的
 * 工作区若已开启，就重挂；否则只拆不建。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { SessionMounts } from './sessions.ts'

/**
 * 监听 `session/event` 里的目录变化，并让对应会话重新挂载。
 * @param ctx - 插件上下文。
 * @param mounts - 会话挂载面；`detach` 之后 `attach` 会按新目录重新选择项目。
 * @returns 注销函数。
 */
export function registerDirectoryChanges(ctx: Context, mounts: SessionMounts): () => void {
  return ctx.on('session/event', (session, event) => {
    if (event.type !== 'working-directory/change') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    void mounts.detach(agent).then(() => mounts.attach(agent))
  })
}
