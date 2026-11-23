/**
 * 使用说明注入：在 `system-prompt/assemble` 里给当前会话加一段 `<system-reminder>`。
 *
 * 为什么不用 `agent/pre-step`：pre-step 每个 step 都跑，而这段说明按会话只该出现
 * 一次；assemble 的产物就是系统提示本身，按 Agent 去重也在这里做。
 *
 * 为什么默认关：CodeGraph 的连接会把自己的 `initialize.instructions`（约 6.9 KB）
 * 无条件放进系统提示，再照抄一段同样的用法说明就是两次。token 成本量化前先关。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'
import type { CodegraphDeps } from './deps.ts'
import type { CodegraphStore } from './state.ts'

/** 与 CodeGraph 安装器写进 CLAUDE.md / AGENTS.md 的那段一致（CodeGraph #704）。 */
export const REMINDER_BLOCK = `<system-reminder>
## CodeGraph

In repositories indexed by CodeGraph (a \`.codegraph/\` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): \`codegraph_explore\` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): \`codegraph explore "<symbol names or question>"\` prints the same output.

If there is no \`.codegraph/\` directory, skip CodeGraph entirely — indexing is the user's decision.
</system-reminder>`

/** 本插件在系统提示里的段落名，便于别的插件或测试定位它。 */
export const SECTION_NAME = 'codegraph:reminder'

export function registerReminder(ctx: Context, deps: CodegraphDeps, store: CodegraphStore): void {
  if (!deps.config.reminder) return
  ctx.on('system-prompt/assemble', async (assembly, { agent }, next) => {
    const result = await next()
    if (agent === undefined) return result
    const directory = ctx.workingDirectory.get(agent.session)
    if (entryFor(store, directory) === undefined) return result
    if (result.sections.some(section => section.name === SECTION_NAME)) return result
    return { ...result, sections: [...result.sections, { name: SECTION_NAME, text: REMINDER_BLOCK }] }
  })
}

/** 从会话目录向上找最近的已开启工作区；说明只在真正打开过的项目里出现。 */
function entryFor(store: CodegraphStore, directory: string): object | undefined {
  let cursor = directory
  while (true) {
    const record = store.get(cursor)
    if (record !== undefined && record.enabled) return record
    const parent = cursor.slice(0, Math.max(cursor.lastIndexOf('/'), 1))
    if (parent === cursor) return undefined
    cursor = parent
  }
}
