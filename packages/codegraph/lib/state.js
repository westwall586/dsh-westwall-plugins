/**
 * 工作区开关的持久化与状态机：`codegraph` 存储域，键是工作区目录的 realpath。
 *
 * 用路径做键而不是 workspace id：DSH 删除工作区再重新添加同一个目录会得到
 * 新的 id，但用户对"这个项目要不要 CodeGraph"的意图没变。
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
const stateSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('disabled') }).strict(),
    /** init 在后台跑，`reason` 给人看的进度说明。 */
    z.object({ kind: z.literal('indexing'), reason: z.string().max(4_000).optional() }).strict(),
    /** 索引就绪，正在等连接与首调验证。 */
    z.object({ kind: z.literal('verifying') }).strict(),
    z.object({ kind: z.literal('ready'), verifiedAt: z.number().int().nonnegative() }).strict(),
    /** 曾经 ready 过但连接断了；重连后回 ready。 */
    z.object({ kind: z.literal('degraded'), reason: z.string().max(4_000) }).strict(),
    /** 本次开启失败，`reason` 是唯一外显的失败原因。 */
    z.object({ kind: z.literal('failed'), reason: z.string().max(4_000) }).strict(),
]);
const workspaceSchema = z.object({
    path: z.string().min(1),
    enabled: z.boolean(),
    state: stateSchema,
    probeSymbol: z.string().min(1).max(200).optional(),
    updatedAt: z.number().int().nonnegative(),
}).strict();
export const codegraphDomain = defineDomain({
    name: 'codegraph',
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: {
        workspaces: domainTable(workspaceSchema),
    },
});
/**
 * 存储键：per-record 模式的键必须是路径安全的 `^[a-zA-Z0-9_-]+$`，所以用路径的
 * sha256 前缀。真实路径仍存在记录体里，读出来就是它。
 */
export function storageKey(path) {
    return createHash('sha256').update(path).digest('hex').slice(0, 32);
}
function warn(message, error) {
    if (error === undefined)
        console.warn(`[dsh-codegraph] ${message}`);
    else
        console.warn(`[dsh-codegraph] ${message}`, error);
}
class MapStore {
    records = new Map();
    isDurable;
    domain;
    constructor(durable, domain) {
        this.isDurable = durable;
        this.domain = domain;
        if (domain === undefined)
            return;
        // 表键是路径的 hash，内存里按真实路径索引，读出来就是记录体里的 path。
        for (const [, record] of domain.table('workspaces').entries())
            this.records.set(record.path, record);
    }
    get durable() {
        return this.isDurable;
    }
    get(path) {
        return this.records.get(path);
    }
    list() {
        return [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async put(record) {
        this.records.set(record.path, record);
        if (this.domain === undefined)
            return;
        try {
            await this.domain.table('workspaces').put(storageKey(record.path), record);
        }
        catch (error) {
            this.isDurable = false;
            warn(`failed to persist the switch for ${record.path}`, error);
        }
    }
    async remove(path) {
        if (this.domain !== undefined)
            await this.domain.table('workspaces').delete(storageKey(path));
        this.records.delete(path);
    }
    async close() {
        this.records.clear();
        await this.domain?.close();
    }
}
/** 进程内降级存储，供没有 storageDomain 的极简组合与单测使用。 */
export function createMemoryStore() {
    return new MapStore(false);
}
/** 打开 `codegraph` 存储域；没有 storageDomain 或打不开时退化为内存，不抛错。 */
export async function openCodegraphStore(facility) {
    if (facility === null || facility === undefined) {
        warn('storageDomain unavailable; workspace switches last only for this run');
        return createMemoryStore();
    }
    try {
        return new MapStore(true, await facility.open(codegraphDomain));
    }
    catch (error) {
        warn('failed to open the codegraph domain; workspace switches last only for this run', error);
        return createMemoryStore();
    }
}
//# sourceMappingURL=state.js.map