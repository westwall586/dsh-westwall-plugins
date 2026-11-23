import { resolveCommand } from "./cli.js";
import { mountThread } from "./thread.js";
function warn(message, error) {
    if (error === undefined)
        console.warn(`[dsh-codegraph] ${message}`);
    else
        console.warn(`[dsh-codegraph] ${message}`, error);
}
/**
 * 从会话目录向上找最近的已开启工作区根。
 *
 * 会话目录可能位于项目子目录（用户在子目录里开会话），开关却记在项目根上，所以
 * 逐级上溯比对已开启记录，而不是只认完全相等的路径。
 */
function resolveRoot(store, directory) {
    let cursor = directory;
    while (true) {
        const record = store.get(cursor);
        if (record?.enabled === true)
            return { root: cursor, record };
        const parent = cursor.slice(0, Math.max(cursor.lastIndexOf('/'), 1));
        if (parent === cursor)
            return undefined;
        cursor = parent;
    }
}
/** 记录一次状态迁移；写盘失败只记日志，状态机本身仍在内存里推进。 */
async function transition(store, path, enabled, state, probeSymbol) {
    try {
        await store.put({ path, enabled, state, ...probeSymbol === undefined ? {} : { probeSymbol }, updatedAt: Date.now() });
    }
    catch (error) {
        warn(`failed to record state ${state.kind} for ${path}`, error);
    }
}
/** 把目录读成项目根，读出失败时返回 `skip` 而不是抛错。 */
function planFor(ctx, store, agent) {
    const found = resolveRoot(store, ctx.workingDirectory.get(agent.session));
    if (found === undefined || found.record.state.kind === 'disabled')
        return { kind: 'skip' };
    return { kind: 'mount', root: found.root, record: found.record };
}
/** CLI 路径：显式配置优先，其次 `PATH`，最后 `~/.local/bin`。 */
function commandFor(deps) {
    return resolveCommand(deps.config.command);
}
/**
 * 建立会话挂载面。
 *
 * 连接按会话持有：同一会话重复 attach 直接复用，不让第二个 mcp-client 抢同一个
 * `serverName` 命名空间（重复注册会让 fiber 加载失败）。
 */
export function createSessionMounts(ctx, deps, store, ops) {
    const threads = new Map();
    const roots = new Map();
    const known = new Map();
    /** 正在挂载中的会话：`agent/created` 与 `session/event` 可能同时触发同一次挂载。 */
    const pending = new Set();
    async function attach(agent) {
        known.set(agent.session.id, agent);
        const key = agent.session;
        // 两条触发路径（创建事件与活动事件）会并发到达；mcp-client 的 serverName
        // 占用键是作用域，重复挂载会直接报 "already in use"。
        if (threads.has(key) || pending.has(key))
            return;
        pending.add(key);
        try {
            await attachOnce(agent, key);
        }
        finally {
            pending.delete(key);
        }
    }
    async function attachOnce(agent, key) {
        const plan = planFor(ctx, store, agent);
        if (plan.kind === 'skip')
            return;
        const command = commandFor(deps);
        if (command === undefined) {
            await transition(store, plan.root, plan.record.enabled, { kind: 'failed', reason: '未找到 codegraph CLI' });
            return;
        }
        // 会话可能先于开启动作到达：那时记录还不是 ready，这里补一次三关验证。
        // 失败会被上层 try 收成状态，不影响会话本身。
        if (plan.record.state.kind !== 'ready') {
            const state = await ops.enable(plan.record, command);
            if (state.kind !== 'ready')
                return;
        }
        // 挂进 Agent 自己的作用域：`agent.ctx` 就是 DSH 为该 Agent 建的那层。
        // mcp-client 以 `scopeOf(ctx)` 作 serverName 占用键，同一作用域第二次挂载会
        // 直接报 "already in use"；每个 Agent 一层的结构正好保证每个会话一份连接。
        try {
            const mounted = await mountThread(deps, agent.ctx, plan.root, command);
            threads.set(key, { dispose: () => mounted.dispose() });
            roots.set(agent.session.id, plan.root);
            const current = store.get(plan.root) ?? plan.record;
            await transition(store, plan.root, current.enabled, current.state, current.probeSymbol);
        }
        catch (error) {
            threads.delete(key);
            roots.delete(agent.session.id);
            await transition(store, plan.root, plan.record.enabled, { kind: 'failed', reason: describe(error) });
        }
    }
    return {
        get size() {
            return threads.size;
        },
        rootFor(sessionId) {
            return roots.get(sessionId);
        },
        roots() {
            return Object.fromEntries(roots);
        },
        async refresh(path) {
            // 已挂载的会话按挂载根匹配即可；`known` 里没记下的会话不会有连接。
            const affected = [...known.values()].filter(agent => roots.get(agent.session.id) === path);
            for (const agent of affected) {
                await this.detach(agent);
                await attach(agent);
            }
        },
        agents() {
            return [...known.values()];
        },
        liveAgentCount() {
            return ctx.agents.list().length;
        },
        async attach(agent) {
            try {
                await attach(agent);
            }
            catch (error) {
                warn('attaching CodeGraph to a session failed', error);
            }
        },
        async detach(agent) {
            const key = agent.session;
            const entry = threads.get(key);
            roots.delete(agent.session.id);
            if (entry === undefined)
                return;
            threads.delete(key);
            await entry.dispose().catch((error) => {
                warn('releasing a CodeGraph session failed', error);
            });
        },
        async close() {
            const pending = [...threads.values()];
            threads.clear();
            await Promise.all(pending.map(entry => entry.dispose().catch((error) => {
                warn('releasing a CodeGraph session failed', error);
            })));
        },
    };
}
function describe(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 注册 `agent/created` 监听。返回的挂载面由插件的 effect 负责 close。 */
export function registerSessionMounts(ctx, deps, store, ops) {
    const mounts = createSessionMounts(ctx, deps, store, ops);
    ctx.on('agent/created', async ({ agent }) => {
        await mounts.attach(agent);
    });
    return mounts;
}
//# sourceMappingURL=sessions.js.map