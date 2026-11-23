import { createScope } from '@deepseek-ai/dsh-scope';
import { answerProvesProject } from "./probe-judge.js";
import { mcpConfigFor } from "./thread.js";
/**
 * 工具名由 mcp-client 的 `serverName` 决定，探针用的是同一个命名空间。
 */
export const PROBE_TOOL = 'mcp__codegraph__codegraph_explore';
/** 一次查询的等待上限。首调是安装流程的一部分，慢一点可以接受，不能没有上限。 */
const PROBE_CALL_TIMEOUT_MS = 60_000;
/**
 * 写一个会走真实连接的探针。
 *
 * `McpClient.probeServer` 只握手与列工具，证明不了项目被索引；所以这里在临时
 * 作用域里挂一个真的 mcp-client、等它启动、发一次查询，再拆掉。失败一律折成
 * 原因字符串，调用方写进状态机。
 */
export function createProbeRunner(ctx, deps) {
    return async (root, command, symbol) => {
        const scope = createScope(ctx, { probe: root });
        try {
            const handle = deps.openMcpClient(scope.ctx, mcpConfigFor(deps, root, command));
            await handle.await();
            const tool = scope.ctx.tools.executable(PROBE_TOOL);
            if (tool === undefined)
                return { ok: false, reason: `连接建立后没有 ${PROBE_TOOL} 工具` };
            const output = tool.output;
            const text = await withTimeout(executeTool(tool, scope.ctx, symbol).then(value => output.render({ query: symbol }, value)), PROBE_CALL_TIMEOUT_MS);
            const body = text.map(block => block.text ?? '').join('\n');
            const verdict = answerProvesProject(body, symbol);
            return verdict.ok
                ? { ok: true, file: verdict.files[0] }
                : { ok: false, reason: `查询「${symbol}」没有返回它的定义` };
        }
        catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
        finally {
            await scope.dispose().catch(() => { });
        }
    };
}
async function executeTool(tool, ctx, query) {
    const run = tool.execute;
    return run({ query }, { ctx, signal: new AbortController().signal });
}
function withTimeout(work, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`首调验证超时（${timeoutMs}ms）`)), timeoutMs);
        work.then(value => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}
//# sourceMappingURL=probe.js.map