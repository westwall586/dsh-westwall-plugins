/**
 * 会话挂载编排：`agent/created` → 解析项目根 → 建会话作用域 → 挂 mcp-client。
 *
 * 这个监听体是插件的故障边界：它绝不允许向外抛。`agent/created` 是 serial 派发，
 * 任一监听器 reject 都会让**整个 Agent 创建失败**，于是插件自己坏掉会连累用户
 * 打不开会话。所以这里所有失败都收敛成状态。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CodegraphDeps } from './deps.ts';
import type { CodegraphStore } from './state.ts';
import type { WorkspaceOps } from './lifecycle.ts';
/** 一套已挂起的会话连接及其状态迁移入口。 */
export interface SessionMounts {
    /** 当前持有连接的会话数，供状态工具与测试观察。 */
    readonly size: number;
    /** 为单个 Agent 完成一次挂载尝试；从不 reject。 */
    attach(agent: Agent): Promise<void>;
    /** 拆掉该会话的连接（目录变了要先拆再按新目录挂）；从不 reject。 */
    detach(agent: Agent): Promise<void>;
    /** 回收全部连接。 */
    close(): Promise<void>;
    /** 该会话当前连着的项目根；没挂返回 undefined。 */
    rootFor(sessionId: string): string | undefined;
    /** 所有已挂载会话及其项目根，供界面与验收读。 */
    roots(): Record<string, string>;
    /** 按某个工作区重新挂载/卸下所有相关会话；界面开关后用。 */
    refresh(path: string): Promise<void>;
    /** 所有在册会话；界面开关后重新挂载用。 */
    agents(): Agent[];
    /** 宿主里当前活着的 Agent 数。 */
    liveAgentCount(): number;
}
/**
 * 建立会话挂载面。
 *
 * 连接按会话持有：同一会话重复 attach 直接复用，不让第二个 mcp-client 抢同一个
 * `serverName` 命名空间（重复注册会让 fiber 加载失败）。
 */
export declare function createSessionMounts(ctx: Context, deps: CodegraphDeps, store: CodegraphStore, ops: WorkspaceOps): SessionMounts;
/** 注册 `agent/created` 监听。返回的挂载面由插件的 effect 负责 close。 */
export declare function registerSessionMounts(ctx: Context, deps: CodegraphDeps, store: CodegraphStore, ops: WorkspaceOps): SessionMounts;
