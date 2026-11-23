import z from '@deepseek-ai/schemastery';
import * as McpClient from '@deepseek-ai/dsh-mcp-client';
import { detectGlobalInstall } from "./global-install.js";
import { createProbeRunner } from "./probe.js";
import { createWorkspaceOps } from "./lifecycle.js";
import { registerProjectGuard } from "./guard.js";
import { registerDirectoryChanges } from "./reconnect.js";
import { registerReattach } from "./reattach.js";
import { registerReminder } from "./reminder.js";
import { CodegraphAdminService } from "./admin.js";
import { resolveCommand } from "./cli.js";
import { registerSessionMounts } from "./sessions.js";
import { openCodegraphStore } from "./state.js";
import { registerTools } from "./tools.js";
export const name = 'codegraph';
export const inject = ['tools', 'agents', 'workingDirectory'];
export const SERVER_NAME = 'codegraph';
export const Config = z.object({
    /** CodeGraph CLI 绝对路径；省略时自动探测。 */
    command: z.string(),
    /** 打开工作区时是否自动执行 `codegraph init`。 */
    initOnEnable: z.boolean().default(true),
    /** `codegraph init` 的超时（毫秒）。后台执行，不阻塞会话。 */
    initTimeoutMs: z.number().min(1_000).default(600_000),
    /** 连接 + 首次工具同步上限（毫秒）。 */
    startupTimeoutMs: z.number().min(1).default(8_000),
    /** 断开上限（毫秒），给 DSH 的 5 秒退出预算留余量。 */
    closeTimeoutMs: z.number().min(1).default(1_500),
    /** 是否注入 <system-reminder>；量化 token 成本前默认关。 */
    reminder: z.boolean().default(false),
    /** 检测同名全局安装并提示。 */
    warnGlobalInstall: z.boolean().default(true),
});
function resolveConfig(raw) {
    return {
        ...raw.command === undefined || raw.command === '' ? {} : { command: raw.command },
        initOnEnable: raw.initOnEnable ?? true,
        initTimeoutMs: raw.initTimeoutMs ?? 600_000,
        reminder: raw.reminder ?? false,
        warnGlobalInstall: raw.warnGlobalInstall ?? true,
        startupTimeoutMs: raw.startupTimeoutMs,
        closeTimeoutMs: raw.closeTimeoutMs,
    };
}
/** 把 mcp-client 的 fiber 收成依赖面要求的形状，调用方不必认识 Cordis fiber。 */
const openMcpClient = (scopeCtx, config) => {
    const fiber = scopeCtx.plugin(McpClient, config);
    return {
        await: () => fiber.await().then(() => { }),
        dispose: () => fiber.dispose(),
    };
};
export function createDeps(ctx, config) {
    const deps = {
        ctx,
        config,
        openMcpClient,
        globalInstall: () => detectGlobalInstall(ctx),
        probe: () => Promise.resolve({ ok: false, reason: '首调验证尚未接线' }),
    };
    return { ...deps, probe: createProbeRunner(ctx, deps) };
}
export async function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const deps = createDeps(ctx, config);
    // 存储域晚于本插件出现是正常组合，所以整段挂载都在注入回调里建，
    // 服务缺席时本插件只是没有开关可读，不该连带它的依赖一起挂不上。
    ctx.inject(['storageDomain'], (storageCtx) => {
        // 注入回调的返回值是它自己作用域的 disposer；存储与连接都要在这里回收，
        // 而且不能提前调 close（早先那版把 close 交给了外层 async，作用域一结束域就关了）。
        let store;
        let sessions;
        void (async () => {
            const opened = await openCodegraphStore(storageCtx.storageDomain);
            store = opened;
            const ops = createWorkspaceOps(opened, deps);
            const mounts = registerSessionMounts(storageCtx, deps, opened, ops);
            sessions = mounts;
            registerProjectGuard(storageCtx, {
                serverName: SERVER_NAME,
                rootFor: sessionId => mounts.rootFor(sessionId),
                currentRootFor: sessionId => {
                    const agent = storageCtx.agents.get(sessionId);
                    return agent === undefined ? undefined : storageCtx.workingDirectory.get(agent.session);
                },
            });
            registerDirectoryChanges(storageCtx, mounts);
            registerReattach(storageCtx, mounts);
            registerTools(storageCtx, opened, mounts);
            registerReminder(storageCtx, deps, opened);
            new CodegraphAdminService(storageCtx, opened, ops, mounts, () => resolveCommand(deps.config.command), () => deps.globalInstall().then(found => found?.file));
        })().catch((error) => {
            console.warn('[dsh-codegraph] storage domain setup failed:', error);
        });
        // 作用域被回收时才关存储与连接，顺序是先拆连接再关域。
        return () => {
            void (async () => {
                await sessions?.close();
                await store?.close();
            })().catch((error) => {
                console.warn('[dsh-codegraph] releasing storage failed:', error);
            });
        };
    });
}
//# sourceMappingURL=index.js.map