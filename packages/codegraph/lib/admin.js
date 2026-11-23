/**
 * 浏览器半体用的 Host 远程服务 `codegraphAdmin`。
 *
 * 界面与会话挂载读同一份存储域、走同一套开启流程；界面上看到的状态就是挂载用的
 * 状态。这里只做参数归一与错误包装，业务在 lifecycle 与 sessions 里。
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
function row(record) {
    return {
        path: record.path,
        enabled: record.enabled,
        state: record.state.kind,
        ...'reason' in record.state ? { reason: record.state.reason } : {},
    };
}
/** 会话当前所在的目录，用来判断它是否属于刚开启的工作区。 */
function directoryOf(ctx, agent) {
    try {
        return ctx.workingDirectory.get(agent.session);
    }
    catch {
        return undefined;
    }
}
function failure(message) {
    return { ok: false, error: { code: 'CODEGRAPH_ADMIN_FAILED', message } };
}
/**
 * 服务本体。方法签名是位置参数且顺序固定：client 侧描述符按同样顺序装配。
 *
 * 暴露给浏览器的只读方法是 `describe`；`setEnabled` 与 `retry` 会写存储与索引，
 * 所以只经 UI 设置面调用（它们仍登记为 Remote，便于后续接配置页的写入口）。
 */
export class CodegraphAdminService extends TypertRemoteService {
    store;
    ops;
    mounts;
    command;
    globalInstall;
    constructor(ctx, store, ops, mounts, command, globalInstall) {
        super(ctx, 'codegraphAdmin');
        this.store = store;
        this.ops = ops;
        this.mounts = mounts;
        this.command = command;
        this.globalInstall = globalInstall;
    }
    describe() {
        return Promise.all([this.globalInstall()]).then(([globalInstall]) => ({
            ok: true,
            value: {
                workspaces: this.store.list().map(row),
                durable: this.store.durable,
                cliMissing: this.command() === undefined,
                mountedSessions: this.mounts.size,
                liveAgents: this.mounts.liveAgentCount(),
                mounted: this.mounts.roots(),
                tools: Object.fromEntries(Object.keys(this.mounts.roots()).map((sessionId) => {
                    const agent = this.ctx.agents.get(sessionId);
                    if (agent === undefined)
                        return [sessionId, []];
                    // 工具注册在 Agent 自己的作用域里，查询也要用 Agent 的作用域 key。
                    const names = this.ctx.tools.schemas(agent)
                        .map(schema => schema.name)
                        .filter(name => name.startsWith('mcp__codegraph__'));
                    return [sessionId, names];
                })),
                ...globalInstall === undefined ? {} : { globalInstall },
            },
        }));
    }
    async setEnabled(path, enabled) {
        const record = this.store.get(path);
        if (record === undefined) {
            // 第一次开启：先在存储里落一条记录，之后的迁移都在它上面做。
            const created = { path, enabled: false, state: { kind: 'disabled' }, updatedAt: Date.now() };
            await this.store.put(created);
            return this.setEnabled(path, enabled);
        }
        if (!enabled) {
            await this.ops.disable(record);
            // 先拆掉该工作区上所有已挂的连接：关掉开关后工具必须立刻消失。
            await this.mounts.refresh(path);
            return { ok: true, value: row(this.store.get(path) ?? record) };
        }
        const command = this.command();
        if (command === undefined)
            return { ok: false, error: { code: 'CODEGRAPH_CLI_MISSING', message: '未找到 codegraph 命令行工具' } };
        const state = await this.ops.enable(record, command);
        const updated = this.store.get(path) ?? record;
        void state;
        // 开启后要真的挂到当前在册的会话上：Agent 已经创建过的不会再发 `agent/created`。
        await this.mounts.refresh(path);
        for (const agent of this.mounts.agents()) {
            if (this.mounts.rootFor(agent.session.id) !== undefined)
                continue;
            if (directoryOf(this.ctx, agent) !== path)
                continue;
            await this.mounts.attach(agent);
        }
        return { ok: true, value: row(updated) };
    }
    async retry(path) {
        return this.setEnabled(path, true);
    }
}
Object.defineProperty(CodegraphAdminService.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
    configurable: true,
    value: Object.freeze({
        version: 1,
        methods: [
            { method: 'describe', invocation: { kind: 'direct' } },
            { method: 'setEnabled', invocation: { kind: 'direct' } },
            { method: 'retry', invocation: { kind: 'direct' } },
        ],
    }),
});
//# sourceMappingURL=admin.js.map