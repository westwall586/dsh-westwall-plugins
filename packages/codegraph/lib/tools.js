import { defineTool } from '@deepseek-ai/dsh-tools';
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
};
/** 一条工作区记录压成模型可见的一行。 */
function describeRecord(record) {
    const reason = 'reason' in record.state ? ` (${record.state.reason})` : '';
    return `${record.path} — ${record.enabled ? 'enabled' : 'disabled'}, ${record.state.kind}${reason}`;
}
export function registerTools(ctx, store, mounts) {
    ctx.tools.register(defineTool({
        name: 'codegraph_status',
        description: 'Report CodeGraph state for this session. CodeGraph is opened and closed by the user in the workspace menu, not by a tool; this reads the current state only.',
        parameters: {},
        output: {
            schema: STATUS_SCHEMA,
            render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        async execute(_args, exec) {
            const agent = exec.agent;
            const currentRoot = agent === undefined ? undefined : ctx.workingDirectory.get(agent.session);
            const records = store.list();
            const mounted = mounts.size;
            const text = records.length === 0
                ? 'No workspace has CodeGraph recorded yet. The user can open it from a workspace\'s "..." menu.'
                : [
                    `CodeGraph sessions mounted in this host: ${mounted}.`,
                    `Switches are ${store.durable ? 'persisted' : 'in memory only for this run'}.`,
                    ...(currentRoot === undefined ? [] : [`This session's directory: ${currentRoot}.`]),
                    ...records.map(describeRecord),
                ].join('\n');
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
            };
        },
    }));
}
//# sourceMappingURL=tools.js.map