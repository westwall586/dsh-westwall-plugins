/**
 * 一次文档读取该不该被当成“外部改写”。body 把判断全部交给这里，因为它依赖三样
 * 只在 body 里存在的东西：上一次**成功读到**的正文、上一次成功读到的版本、以及
 * 屏幕上的状态。
 *
 * 关键是上一次正文要独立于屏幕状态保存：刷新恢复的页签第一次读取前屏幕是
 * `loading`，而屏幕上并没有任何正文可比较；拿屏幕内容当基准会把同一份正文的普通
 * 重读误判成外部改写，进而把正在跑的翻译 abort 掉。
 */
export interface PreviousLoad {
  readonly text: string
  readonly version: string
}

export type LoadDecision =
  /** 换文档，或从来没有成功读到过：按第一次打开处理。 */
  | 'first'
  /** 同一版本重读：正文不可能变，只需要把状态写回 ready。 */
  | 'same'
  /** 版本变了但正文一致：宿主刷新或改回原样的保存，不是外部改写。 */
  | 'reload'
  /** 同一版本但正文不同：只有测试与异常路径会走到这里，按外部改写处理。 */
  | 'rewrite'
  /** 版本与正文都变了：文件被外部改写。 */
  | 'external-change'

export interface LoadInput {
  /** 这次读取属于一个新的文档（标签换了文档）。 */
  readonly changedDocument: boolean
  /** 上一次成功读到的结果；从未成功读到过时为 null。 */
  readonly previous: PreviousLoad | null
  readonly version: string
  readonly text: string
  sameText(a: string, b: string): boolean
}

export function decideLoad(input: LoadInput): LoadDecision {
  if (input.changedDocument || input.previous === null) return 'first'
  if (input.previous.version === input.version) {
    return input.sameText(input.previous.text, input.text) ? 'same' : 'rewrite'
  }
  return input.sameText(input.previous.text, input.text) ? 'reload' : 'external-change'
}
