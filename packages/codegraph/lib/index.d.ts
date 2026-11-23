/**
 * @westwall/dsh-codegraph — 按 DSH 工作区托管 CodeGraph 的 MCP 线程。
 *
 * 一个工作区（realpath）一个状态；打开后，该工作区里的每个会话各自在会话作用域
 * 下挂一个 mcp-client 实例，因此 CodeGraph 的工具与它自带的 MCP instructions 都按
 * 会话作用域出现，会话结束即销毁。关闭不写用户的 AGENTS.md，也不删 CodeGraph
 * 自己的 `.codegraph/`。
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { CodegraphDeps, ResolvedConfig } from './deps.ts';
export declare const name = "codegraph";
export declare const inject: string[];
export declare const SERVER_NAME = "codegraph";
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** CodeGraph CLI 绝对路径；省略时自动探测。 */
    command: z<string, string, "plain">;
    /** 打开工作区时是否自动执行 `codegraph init`。 */
    initOnEnable: z<boolean, boolean, "defined">;
    /** `codegraph init` 的超时（毫秒）。后台执行，不阻塞会话。 */
    initTimeoutMs: z<number, number, "defined">;
    /** 连接 + 首次工具同步上限（毫秒）。 */
    startupTimeoutMs: z<number, number, "defined">;
    /** 断开上限（毫秒），给 DSH 的 5 秒退出预算留余量。 */
    closeTimeoutMs: z<number, number, "defined">;
    /** 是否注入 <system-reminder>；量化 token 成本前默认关。 */
    reminder: z<boolean, boolean, "defined">;
    /** 检测同名全局安装并提示。 */
    warnGlobalInstall: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** CodeGraph CLI 绝对路径；省略时自动探测。 */
    command: z<string, string, "plain">;
    /** 打开工作区时是否自动执行 `codegraph init`。 */
    initOnEnable: z<boolean, boolean, "defined">;
    /** `codegraph init` 的超时（毫秒）。后台执行，不阻塞会话。 */
    initTimeoutMs: z<number, number, "defined">;
    /** 连接 + 首次工具同步上限（毫秒）。 */
    startupTimeoutMs: z<number, number, "defined">;
    /** 断开上限（毫秒），给 DSH 的 5 秒退出预算留余量。 */
    closeTimeoutMs: z<number, number, "defined">;
    /** 是否注入 <system-reminder>；量化 token 成本前默认关。 */
    reminder: z<boolean, boolean, "defined">;
    /** 检测同名全局安装并提示。 */
    warnGlobalInstall: z<boolean, boolean, "defined">;
}>>, "plain">;
export type CodegraphConfig = ResolvedConfig;
/** Cordis 传入的是归一化之前的输入，默认值由 schema 补齐。 */
type ConfigInput = Partial<Omit<ResolvedConfig, 'startupTimeoutMs' | 'closeTimeoutMs'>> & Pick<ResolvedConfig, 'startupTimeoutMs' | 'closeTimeoutMs'>;
export declare function createDeps(ctx: Context, config: ResolvedConfig): CodegraphDeps;
export declare function apply(ctx: Context, rawConfig: ConfigInput): Promise<void>;
export {};
