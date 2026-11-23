/**
 * `codegraph_status`：模型唯一能碰的 CodeGraph 入口，且只读。
 *
 * 开启与关闭会写 `.codegraph/`、改工作区开关，所以只给用户界面。模型能问
 * "当前工作区的 CodeGraph 是什么状态"，但改不了它。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { WorkspaceRecord } from './state.ts'
import type { CodegraphStore } from './state.ts'
import type { SessionMounts } from './sessions.ts'

const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', required: true },
    workspaces: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          enabled: { type: 'boolean', required: true },
          state: { type: 'string', required: true },
          reason: { type: 'string' },
        },
      },
    },
    currentRoot: { type: 'string' },
    mountedSessions: { type: 'number', required: true },
    durable: { type: 'boolean', required: true },
  },
} as const

/** 一条工作区记录压成模型可见的一行。 */
function describeRecord(record: WorkspaceRecord): string {
  const reason = 'reason' in record.state ? ` (${record.state.reason})` : ''
  return `${record.path} — ${record.enabled ? 'enabled' : 'disabled'}, ${record.state.kind}${reason}`
}

export function registerTools(
  ctx: Context,
  store: CodegraphStore,
  mounts: SessionMounts,
): void {
  ctx.tools.register(defineTool({
    name: 'codegraph_status',
    description: 'Report CodeGraph state for this session. CodeGraph is opened and closed by the user in the workspace menu, not by a tool; this reads the current state only.',
    parameters: {},
    output: {
      schema: STATUS_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      const currentRoot = agent === undefined ? undefined : ctx.workingDirectory.get(agent.session)
      const records = store.list()
      const mounted = mounts.size
      const text = records.length === 0
        ? 'No workspace has CodeGraph recorded yet. The user can open it from a workspace\'s "..." menu.'
        : [
          `CodeGraph sessions mounted in this host: ${mounted}.`,
          `Switches are ${store.durable ? 'persisted' : 'in memory only for this run'}.`,
          ...(currentRoot === undefined ? [] : [`This session's directory: ${currentRoot}.`]),
          ...records.map(describeRecord),
        ].join('\n')
      return {
        text,
        workspaces: records.map(record => ({
          path: record.path,
          enabled: record.enabled,
          state: record.state.kind,
          ...'reason' in record.state ? { reason: record.state.reason } : {},
        })),
        ...currentRoot === undefined ? {} : { currentRoot },
        mountedSessions: mounted,
        durable: store.durable,
      }
    },
  }))
}
