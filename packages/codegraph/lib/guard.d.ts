/**
 * 项目一致性守卫：工具每次执行前核对"线程连的项目"和"会话现在所在的项目"。
 *
 * 会话中途 `cd` 到别的项目后，旧连接仍会回答旧仓库的问题，而且不报错。静默错答
 * 比崩溃更贵，所以这里把它变成一次可见的失败：拒绝这次调用并说要重建。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 一次工具执行对项目的要求：工具必须属于 `serverName` 且当前会话挂在 `root` 上。 */
export interface GuardOptions {
    /** mcp-client 的 serverName，决定工具名前缀。 */
    serverName: string;
    /** 会话当前生效的项目根，由会话挂载维护。 */
    rootFor(sessionId: string): string | undefined;
    /** 会话现在所在的项目根；不一致时拒绝。 */
    currentRootFor(sessionId: string): string | undefined;
}
export declare class MismatchedProjectError extends Error {
    constructor(expected: string, actual: string);
}
/**
 * 注册守卫。只检查本插件自己的工具，别的 MCP server 同名不算。
 * @param ctx - 插件上下文。
 * @param options - 命名空间与会话根查询。
 * @returns 注销函数，随插件卸载。
 */
export declare function registerProjectGuard(ctx: Context, options: GuardOptions): () => void;
