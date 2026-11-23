/**
 * 浏览器半体用的 Host 远程服务 `codegraphAdmin`。
 *
 * 界面与会话挂载读同一份存储域、走同一套开启流程；界面上看到的状态就是挂载用的
 * 状态。这里只做参数归一与错误包装，业务在 lifecycle 与 sessions 里。
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { CodegraphStore } from './state.ts';
import type { WorkspaceOps } from './lifecycle.ts';
import type { SessionMounts } from './sessions.ts';
/** 界面拿到的单条记录。 */
export interface AdminRow {
    path: string;
    enabled: boolean;
    state: string;
    reason?: string;
}
/** 界面拿到的整体快照。 */
export interface AdminView {
    workspaces: AdminRow[];
    durable: boolean;
    cliMissing: boolean;
    globalInstall?: string;
    /** 当前挂着连接的会话数；界面与验收都靠它判断"工具在这个会话里在不在"。 */
    mountedSessions: number;
    /** 每个已挂载会话的项目根，键是会话 id。 */
    mounted: Record<string, string>;
    /** 每个已挂载会话上实际可见的 CodeGraph 工具名。 */
    tools: Record<string, string[]>;
    /** 当前宿主里活着的 Agent 数，用来分清"没会话"与"没挂上"。 */
    liveAgents: number;
}
export interface AdminResult<T> {
    ok: boolean;
    value?: T;
    error?: {
        code?: string;
        message?: string;
    };
}
/**
 * 服务本体。方法签名是位置参数且顺序固定：client 侧描述符按同样顺序装配。
 *
 * 暴露给浏览器的只读方法是 `describe`；`setEnabled` 与 `retry` 会写存储与索引，
 * 所以只经 UI 设置面调用（它们仍登记为 Remote，便于后续接配置页的写入口）。
 */
export declare class CodegraphAdminService extends TypertRemoteService {
    private readonly store;
    private readonly ops;
    private readonly mounts;
    private readonly command;
    private readonly globalInstall;
    constructor(ctx: Context, store: CodegraphStore, ops: WorkspaceOps, mounts: SessionMounts, command: () => string | undefined, globalInstall: () => Promise<string | undefined>);
    describe(): Promise<AdminResult<AdminView>>;
    setEnabled(path: string, enabled: boolean): Promise<AdminResult<AdminRow>>;
    retry(path: string): Promise<AdminResult<AdminRow>>;
}
