/**
 * 首调验证的判定，与传输无关，可单测。
 *
 * 判定不能只看"有正文"。CodeGraph 在查不到某个符号时不报错，它返回本项目里
 * 最接近的结果，所以"有正文"永远成立。要证明这个项目确实被索引了，就得拿
 * 预先选定的真实符号去问，并检查答案里出现它的定义文件。
 */
/**
 * 从工具输出里读命中的文件。
 * @param text - `codegraph_explore` 返回的正文。
 * @returns 带定义分节的文件列表，按出现顺序。
 */
export declare function filesInAnswer(text: string): string[];
/**
 * 列出符号的定义分节。
 * @param text - 工具输出。
 * @param symbol - 期望命中的符号。
 * @returns 标题里点名了这个符号的文件。
 */
export declare function filesDefining(text: string, symbol: string): string[];
/**
 * 判定一次查询是否证明索引对这个项目成立。
 * @param text - 工具输出。
 * @param symbol - 期望命中的符号。
 * @returns 是否命中，以及命中的文件（未命中时为空）。
 */
export declare function answerProvesProject(text: string, symbol: string): {
    ok: boolean;
    files: string[];
};
