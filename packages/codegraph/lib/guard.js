export class MismatchedProjectError extends Error {
    constructor(expected, actual) {
        super(`codegraph: this session moved to ${actual}, but its CodeGraph connection still answers for ${expected}. Reopen CodeGraph for the new directory before using its tools.`);
        this.name = 'MismatchedProjectError';
    }
}
/**
 * 注册守卫。只检查本插件自己的工具，别的 MCP server 同名不算。
 * @param ctx - 插件上下文。
 * @param options - 命名空间与会话根查询。
 * @returns 注销函数，随插件卸载。
 */
export function registerProjectGuard(ctx, options) {
    const prefix = `mcp__${options.serverName}__`;
    return ctx.on('tools/execute', async (exec, next) => {
        if (!exec.name.startsWith(prefix))
            return next();
        const sessionId = exec.agent?.session.id;
        if (sessionId === undefined)
            return next();
        const mounted = options.rootFor(sessionId);
        const current = options.currentRootFor(sessionId);
        if (mounted !== undefined && current !== undefined && mounted !== current) {
            throw new MismatchedProjectError(mounted, current);
        }
        return next();
    });
}
//# sourceMappingURL=guard.js.map