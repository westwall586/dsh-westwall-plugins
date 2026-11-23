/**
 * 首调验证：用一次真实查询确认这条索引能回答这个项目。
 *
 * 判定不能只看"有正文"。CodeGraph 在查不到某个符号时不报错，它返回本项目里
 * 最接近的结果，所以"有正文"永远成立。要证明的是"这个项目确实被索引了"，
 * 就得拿预先选定的真实符号去问，并检查答案里出现它的定义文件。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CodegraphDeps, ProbeRunner } from './deps.ts';
/**
 * 工具名由 mcp-client 的 `serverName` 决定，探针用的是同一个命名空间。
 */
export declare const PROBE_TOOL = "mcp__codegraph__codegraph_explore";
/**
 * 写一个会走真实连接的探针。
 *
 * `McpClient.probeServer` 只握手与列工具，证明不了项目被索引；所以这里在临时
 * 作用域里挂一个真的 mcp-client、等它启动、发一次查询，再拆掉。失败一律折成
 * 原因字符串，调用方写进状态机。
 */
export declare function createProbeRunner(ctx: Context, deps: Pick<CodegraphDeps, 'config' | 'openMcpClient'>): ProbeRunner;
