import { hasIndex, pickProbeSymbol, runInit } from "./cli.js";
/** 生产路径的外部动作；首调探针由插件入口注入真实的连接探针。 */
function defaultIo(deps) {
    return { init: runInit, probe: deps.probe, hasIndex, pickProbeSymbol };
}
export function createWorkspaceOps(store, deps, io = defaultIo(deps)) {
    const queues = new Map();
    /** 同一 realpath 上的动作排队；不同工作区互不阻塞。 */
    const serialize = (path, action) => {
        const previous = queues.get(path) ?? Promise.resolve();
        const next = previous.then(action, action);
        queues.set(path, next.catch(() => { }));
        return next;
    };
    const save = async (record, enabled, state, probeSymbol) => {
        const next = {
            path: record.path,
            enabled,
            state,
            ...probeSymbol === undefined ? {} : { probeSymbol },
            updatedAt: Date.now(),
        };
        await store.put(next);
        return next;
    };
    return {
        enable(record, command) {
            return serialize(record.path, async () => {
                if (!io.hasIndex(record.path)) {
                    const indexing = await save(record, true, { kind: 'indexing' });
                    void indexing;
                    const init = await io.init(command, record.path, deps.config.initTimeoutMs);
                    if (!init.ok) {
                        const failed = await save(record, true, { kind: 'failed', reason: init.reason });
                        return failed.state;
                    }
                }
                const probeSymbol = record.probeSymbol ?? io.pickProbeSymbol(record.path);
                if (probeSymbol === undefined) {
                    const failed = await save(record, true, { kind: 'failed', reason: '这个工作区没有找到可索引的源码' });
                    return failed.state;
                }
                await save(record, true, { kind: 'verifying' }, probeSymbol);
                const verdict = await io.probe(record.path, command, probeSymbol);
                const failed = verdict.ok
                    ? undefined
                    : await save(record, true, { kind: 'failed', reason: verdict.reason }, probeSymbol);
                if (failed !== undefined)
                    return failed.state;
                const ready = await save(record, true, { kind: 'ready', verifiedAt: Date.now() }, probeSymbol);
                return ready.state;
            });
        },
        disable(record) {
            return serialize(record.path, async () => {
                await save(record, false, { kind: 'disabled' });
            });
        },
    };
}
//# sourceMappingURL=lifecycle.js.map