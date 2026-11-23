/** 索引就绪的标志：CodeGraph 自己的数据目录里有数据库文件。 */
export declare function databasePath(root: string): string;
export declare function hasIndex(root: string): boolean;
/**
 * 项目的 CodeGraph 数据目录名。与 CodeGraph 的 `codeGraphDirNameFor` 同规则：
 * `CODEGRAPH_DIR` 优先；WSL 下 Windows 盘的项目优先 `.codegraph-wsl`，但已有
 * `.codegraph/codegraph.db` 的项目继续用 `.codegraph`。规则不同会让开关读到的
 * 索引和 MCP 线程实际用的索引不是同一份。
 */
export declare function codeGraphDirName(root: string): string;
export type CliResult = {
    readonly ok: true;
    readonly stdout: string;
} | {
    readonly ok: false;
    readonly reason: string;
};
/**
 * 探测 CodeGraph 可执行文件。顺序与文档一致：配置项、`PATH`、`~/.local/bin`。
 * 找不到返回 undefined，由调用方把它表达成状态而不是异常。
 */
export declare function resolveCommand(configured: string | undefined, pathEnv?: string): string | undefined;
/**
 * 跑一次 `codegraph init`。非零退出、超时、被信号结束都折成一条可展示的原因；
 * 调用方把它写进状态机，不会往外抛。
 */
export declare function runInit(command: string, root: string, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<CliResult>;
/**
 * 挑一个足够独特的符号来验证索引。优先源码里的导出名，其次最多的标识符；
 * 全空仓库返回 undefined，交给调用方给出"这个工作区没有可索引的代码"。
 */
export declare function pickProbeSymbol(root: string): string | undefined;
