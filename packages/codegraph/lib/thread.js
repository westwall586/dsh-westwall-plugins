import * as McpClient from '@deepseek-ai/dsh-mcp-client';
/** 模型看到的工具名前缀，由 mcp-client 的 `serverName` 决定。 */
export const SERVER_NAME = 'codegraph';
/**
 * 组装 mcp-client 的启动配置。
 *
 * `cwd` 与 `--path` 同值：CodeGraph 的项目绑定优先看显式 `--path`，两个入口指向
 * 同一个 realpath 才能排除"参数与工作目录各指一个项目"的分歧。
 * `failOnStartupError: false` 让连不上只表现为状态，而不是把 fiber 打挂。
 */
export function mcpConfigFor(deps, root, command) {
    return McpClient.Config({
        transport: 'stdio',
        serverName: SERVER_NAME,
        command,
        args: ['serve', '--mcp', '--path', root],
        cwd: root,
        env: { CODEGRAPH_TELEMETRY: '0' },
        startupTimeoutMs: deps.config.startupTimeoutMs,
        closeTimeoutMs: deps.config.closeTimeoutMs,
        failOnStartupError: false,
    });
}
/**
 * 在会话作用域里挂一个 mcp-client 实例，并**等待**它完成首连与工具同步。
 *
 * 必须 await：mcp-client 的 `apply()` 自己就等首连，不存在"不 await 也能同步"的
 * 路径；不 await 时首轮工具列表可能是空的。等待上限由 `startupTimeoutMs` 兜住。
 */
export async function mountThread(deps, scopeCtx, root, command) {
    const handle = deps.openMcpClient(scopeCtx, mcpConfigFor(deps, root, command));
    await handle.await();
    return handle;
}
//# sourceMappingURL=thread.js.map