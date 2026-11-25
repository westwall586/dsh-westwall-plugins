/**
 * 一篇文档的全部状态。规则是对字段集合的整体判断，不是对单个字段的判断，
 * 所以生命周期收敛到一处 `dispose(reason)` 的 switch 里，而不是散在调用方。
 */
import type { HostBridge } from '../context.ts'
import { createNotes, createWriteChains, createNotesSlot, type NotesHandle } from './kernel/notes.ts'
import { createReading, createReadingSlot, type Reading, type ReadingSlot } from './kernel/reading.ts'
import type { DocumentKey } from './ref.ts'

/**
 * `leave` 不跑 switch，crate 原样保留（切页签、切会话、收起侧栏、退出全屏）。
 * `close` 与 `external-change` 共享 drop()，只差阅读位置是否保留。`unload` 只清内存，
 * 不动磁盘，否则插件一重载就会清空全部批注。
 */
export type Disposal = 'leave' | 'close' | 'external-change' | 'unload'

export interface CrateDeps {
  key: DocumentKey
  host(): Promise<HostBridge>
  /** 阅读位置的节流窗口；省略用默认值。 */
  readingDelayMs?: number
}

export interface Crate {
  readonly key: DocumentKey
  /**
   * 某 composer 维度的批注面。槽归 crate，所以 body 卸载再挂回拿到的是同一个快照；
   * 每次调用累加引用计数，与 releaseCompose 配对。
   */
  notesFor(compose: string): NotesHandle
  /** 引用计数减一；减到零只摘句柄，槽仍留在 crate 里。 */
  releaseCompose(compose: string): void
  /** 阅读位置：按视图分开，body 的滚动容器写入它。 */
  readonly reading: Reading
  /** 没有任何 composer 维度被持有。 */
  readonly empty: boolean
  dispose(reason: Disposal): void
}

interface ComposeEntry {
  handle: NotesHandle
  refs: number
}

export function createCrate(deps: CrateDeps): Crate {
  let disposed = false
  // 槽与写链都归 crate：这两样比句柄活得久，否则切走再切回会连快照一起丢。
  const chains = createWriteChains()
  const entries = new Map<string, ComposeEntry>()
  const readingSlot: ReadingSlot = createReadingSlot()
  const reading = createReading({ slot: readingSlot, ...(deps.readingDelayMs === undefined ? {} : { delayMs: deps.readingDelayMs }) })

  const notesFor = (compose: string): NotesHandle => {
    if (disposed) throw new Error('crate is disposed')
    const existing = entries.get(compose)
    if (existing !== undefined) {
      existing.refs += 1
      return existing.handle
    }
    const handle = createNotes({ key: deps.key, compose, host: deps.host }, createNotesSlot(), chains)
    entries.set(compose, { handle, refs: 1 })
    return handle
  }

  const releaseCompose = (compose: string): void => {
    const entry = entries.get(compose)
    if (entry === undefined) return
    entry.refs -= 1
    if (entry.refs > 0) return
    // 摘订阅但不碰槽：释放的瞬间旧 body 还在树上，读它也只是读到同一份快照。
    entry.handle.slot.listeners.clear()
    entries.delete(compose)
  }

  const drop = (): void => {
    for (const entry of entries.values()) entry.handle.slot.listeners.clear()
    entries.clear()
    chains.clear()
    disposed = true
  }

  return {
    key: deps.key,
    notesFor,
    releaseCompose,
    reading,
    get empty() {
      return entries.size === 0
    },
    dispose(reason) {
      switch (reason) {
        case 'leave':
          return
        case 'unload':
          // 只清内存：位置在帧内，磁盘批注不动，否则插件一重载就清空批注。
          reading.clear()
          reading.dispose()
          drop()
          return
        case 'close':
        case 'external-change':
          // TODO: 两者的处置是同一个 drop()（close 额外清空阅读位置），见
          // docs/designs/active-markdown/STATE-STORE-SYNTHESIS.md 第 4 节；触发点在第 6 步
          // 的常驻观察者里。
          throw new Error(`crate dispose reason '${reason}' is not implemented`)
      }
    },
  }
}
