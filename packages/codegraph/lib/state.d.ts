import { z } from 'zod';
declare const stateSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"disabled">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"indexing">;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"verifying">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"ready">;
    verifiedAt: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"degraded">;
    reason: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"failed">;
    reason: z.ZodString;
}, z.core.$strict>], "kind">;
/**
 * 一个工作区的开启状态。
 *
 * 用判别联合而不是若干布尔量：`indexing` 与 `verifying` 都会话可用只是暂时没有
 * 工具，`failed` 才需要用户动手，这两种"没就绪"的后续动作完全不同，散落的
 * 布尔量会让调用方自己拼状态。
 */
export type WorkspaceState = z.infer<typeof stateSchema>;
export interface WorkspaceRecord {
    /** 目录的 realpath，同时是表键。 */
    path: string;
    /** 用户是否在该工作区打开了 CodeGraph。关闭不影响 CodeGraph 自己的 `.codegraph/`。 */
    enabled: boolean;
    state: WorkspaceState;
    /** 第一次开启时选定的扫描符号，用于"首调命中"判定；换符号前先退回 `disabled`。 */
    probeSymbol?: string;
    /** 最近一次迁移时间。 */
    updatedAt: number;
}
export declare const codegraphDomain: {
    name: string;
    version: number;
    layout: "per-record";
    invalidRecords: "backup-and-skip";
    tables: {
        workspaces: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, WorkspaceRecord>;
    };
};
interface WorkspaceTable {
    get(key: string): WorkspaceRecord | undefined;
    put(key: string, value: WorkspaceRecord): Promise<void>;
    delete(key: string): Promise<boolean>;
    entries(): IterableIterator<[string, WorkspaceRecord]>;
}
interface CodegraphDomain {
    table(name: 'workspaces'): WorkspaceTable;
    close(): Promise<void>;
}
/** facility 只用到 `open`；拿它做参数类型，替身不必冒充整个平台服务。 */
export interface StorageDomainFacility {
    open(spec: typeof codegraphDomain): Promise<CodegraphDomain>;
}
/** 工作区开关的读写面。失持久化时退化为进程内 Map，本次运行照常可用。 */
export interface CodegraphStore {
    get(path: string): WorkspaceRecord | undefined;
    list(): readonly WorkspaceRecord[];
    put(record: WorkspaceRecord): Promise<void>;
    remove(path: string): Promise<void>;
    /** 持久化是否可用；写盘失败会把它翻成 false，读它的地方据此如实报告。 */
    readonly durable: boolean;
    close(): Promise<void>;
}
/**
 * 存储键：per-record 模式的键必须是路径安全的 `^[a-zA-Z0-9_-]+$`，所以用路径的
 * sha256 前缀。真实路径仍存在记录体里，读出来就是它。
 */
export declare function storageKey(path: string): string;
/** 进程内降级存储，供没有 storageDomain 的极简组合与单测使用。 */
export declare function createMemoryStore(): CodegraphStore;
/** 打开 `codegraph` 存储域；没有 storageDomain 或打不开时退化为内存，不抛错。 */
export declare function openCodegraphStore(facility: StorageDomainFacility | null | undefined): Promise<CodegraphStore>;
export {};
