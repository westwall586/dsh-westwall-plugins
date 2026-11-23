/**
 * 首调验证的判定，与传输无关，可单测。
 *
 * 判定不能只看"有正文"。CodeGraph 在查不到某个符号时不报错，它返回本项目里
 * 最接近的结果，所以"有正文"永远成立。要证明这个项目确实被索引了，就得拿
 * 预先选定的真实符号去问，并检查答案里出现它的定义文件。
 */

/**
 * 答案里出现定义文件的分节标题形如 ``**`src/a.js`** — alphaOnlySymbol(function)``。
 * 只认列出符号名的标题：CodeGraph 在查不到时也会给出一个分节，标题里只有本项目
 * 自己的符号，那正是要判失败的情况。
 */
const DEFINITION_HEADING = /^\*\*`([^`]+)`\*\* — ([^\n]*)$/gm

/**
 * 从工具输出里读命中的文件。
 * @param text - `codegraph_explore` 返回的正文。
 * @returns 带定义分节的文件列表，按出现顺序。
 */
export function filesInAnswer(text: string): string[] {
  return [...text.matchAll(DEFINITION_HEADING)].map(match => match[1]!)
}

/**
 * 列出符号的定义分节。
 * @param text - 工具输出。
 * @param symbol - 期望命中的符号。
 * @returns 标题里点名了这个符号的文件。
 */
export function filesDefining(text: string, symbol: string): string[] {
  return [...text.matchAll(DEFINITION_HEADING)]
    .filter(match => (match[2] ?? '').includes(symbol))
    .map(match => match[1]!)
}

/**
 * 判定一次查询是否证明索引对这个项目成立。
 * @param text - 工具输出。
 * @param symbol - 期望命中的符号。
 * @returns 是否命中，以及命中的文件（未命中时为空）。
 */
export function answerProvesProject(text: string, symbol: string): { ok: boolean; files: string[] } {
  const files = filesDefining(text, symbol)
  return { ok: files.length > 0, files }
}
