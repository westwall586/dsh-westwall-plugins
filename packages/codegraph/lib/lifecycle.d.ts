/**
 * 工作区的开启与关闭。开启是一次三关验证（索引、连接、首调），每关的结论都落成
 * 状态；关闭只改开关，CodeGraph 自己的 `.codegraph/` 留给用户。
 *
 * 开与关都按 realpath 串行：同一工作区同时跑两次 init 会互相踩索引。
 */
import type { CodegraphStore, WorkspaceRecord, WorkspaceState } from './state.ts';
import type { CliResult } from './cli.ts';
import type { CodegraphDeps } from './deps.ts';
/** 三关验证里可替换的外部动作，单测不必真的起进程。 */
export interface LifecycleIo {
    init(command: string, root: string, timeoutMs: number): Promise<CliResult>;
    probe(root: string, command: string, symbol: string): ReturnType<CodegraphDeps['probe']>;
    hasIndex(root: string): boolean;
    pickProbeSymbol(root: string): string | undefined;
}
/** 一个工作区的开关动作面。`enable` 不抛错，失败会体现在返回的状态里。 */
export interface WorkspaceOps {
    enable(record: WorkspaceRecord, command: string): Promise<WorkspaceState>;
    disable(record: WorkspaceRecord): Promise<void>;
}
export declare function createWorkspaceOps(store: CodegraphStore, deps: CodegraphDeps, io?: LifecycleIo): WorkspaceOps;
