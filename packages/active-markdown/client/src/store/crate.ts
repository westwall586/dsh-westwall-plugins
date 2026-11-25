/**
 * 一篇文档的全部状态。规则是对字段集合的整体判断，不是对单个字段的判断，
 * 所以生命周期收敛到一处 `dispose(reason)` 的 switch 里，而不是散在调用方。
 */
import type { HostBridge } from '../context.ts'
import { createEdit, createEditSlot, type Edit, type EditSlot } from './kernel/edit.ts'
import {
  clearStored,
  createNotes,
  createNotesSlot,
  createWriteChains,
  EMPTY_SNAPSHOT,
  type NotesHandle,
} from './kernel/notes.ts'
import { createPreferences, createPreferencesSlot, type ViewPreferences, type ViewPreferencesSlot } from './kernel/preferences.ts'
import { createReading, createReadingSlot, type Reading, type ReadingSlot } from './kernel/reading.ts'
import { createTranslationRun, type TranslationRun } from './kernel/translation.ts'
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
   * 宿主读文件时给出的绝对路径。crate 的键在读到正文之前就定下了，而文档地址里的
   * 路径是相对工作区的；批注与清理由 Host 按绝对路径存，所以这里记住第一条绝对
   * 路径，之后的访问都用它。
   */
  rememberPath(path: string): void
  /**
   * 某 composer 维度的批注面。槽归 crate，所以 body 卸载再挂回拿到的是同一个快照；
   * 每次调用累加引用计数，与 releaseCompose 配对。
   */
  notesFor(compose: string): NotesHandle
  /** 引用计数减一；减到零只摘句柄，槽仍留在 crate 里。 */
  releaseCompose(compose: string): void
  /** 阅读位置：按视图分开，body 的滚动容器写入它。 */
  readonly reading: Reading
  /** 本文件的翻译运行；同一文件被两个 compose 会话打开时共用这一个。 */
  readonly run: TranslationRun
  /** 编辑草稿：切走再切回要完整保留，关闭页签或文件被外部改写时丢弃。 */
  readonly edit: Edit
  /** 视图偏好：目录折叠与更新游标。 */
  readonly view: ViewPreferences
  /**
   * 登记一个要先等完的清理（上一个同键 crate 的关闭）。所有 Host 调用都排在它
   * 后面：页签关掉又马上开回同一文件时，不能读到还没清掉的旧批注。
   */
  awaitCleanup(pending: Promise<void>): void
  /** 没有任何 composer 维度被持有。 */
  readonly empty: boolean
  /** close 与 external-change 返回的承诺在磁盘清理完成时结束；其余规则立即返回。 */
  dispose(reason: Disposal): void | Promise<void>
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
  /** crate 已知的绝对路径；没有时退回键里的那条。 */
  let resolvedPath: string | undefined
  const documentPath = (): string | undefined => resolvedPath
  const storedPath = (): string => resolvedPath ?? deps.key.path
  /** 先前的关闭清理；Host 调用等它。 */
  let gate: Promise<void> = Promise.resolve()
  /** 已经在等门的那一份调用，复用它，免得每次调用多一层出队。 */
  let gated: Promise<void> | undefined
  /**
   * 清理跑完前 `disposed` 对 Host 调用就是“还没建好”，抛错会被各内核当成一次读到
   * 内存态而继续；所以先等，等过的那份承诺不会再来。
   */
  const hostCall = (): Promise<HostBridge> => (gated ??= gate).then(() => {
    // 门已经放行，之后的调用直接走，不再排队。
    if (gated !== undefined && gate === gated) gated = undefined
    return deps.host()
  })
  // 翻译运行按文件键控，涉及文件的 Host 调用同样要走文档的绝对路径。
  const run = createTranslationRun({ key: deps.key, path: storedPath, host: hostCall })
  const editSlot: EditSlot = createEditSlot()
  const edit = createEdit(editSlot)
  const viewSlot: ViewPreferencesSlot = createPreferencesSlot()
  const view = createPreferences(viewSlot)

  /**
   * close 与 external-change 共用的丢弃：每个 composer 维度的内存快照立刻换成空的
   * 并通知仍在树上的帧，磁盘上的批注与 pending 记录在后台清掉。
   *
   * 读磁盘那一步可能还在飞：它的结果晚到时会按 generation 判定作废，不会把刚清空
   * 的快照写回来。
   */
  const dropAnnotations = (): Promise<void> => {
    for (const entry of entries.values()) {
      entry.handle.slot.generation += 1
      entry.handle.slot.loadPromise = null
      entry.handle.slot.snapshot = EMPTY_SNAPSHOT
      for (const listener of [...entry.handle.slot.listeners]) listener()
    }
    return clearStored(deps.key, storedPath(), deps.host).catch((error: unknown) => {
      console.warn('[active-markdown] annotation clear failed', error)
    })
  }

  const notesFor = (compose: string): NotesHandle => {
    if (disposed) throw new Error('crate is disposed')
    const existing = entries.get(compose)
    if (existing !== undefined) {
      existing.refs += 1
      return existing.handle
    }
    const handle = createNotes({ key: deps.key, compose, host: hostCall, documentPath }, createNotesSlot(), chains)
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

  // 只有 edit 的监听者归 crate 直接清：它在 drop 里仍然能被读到。
  const dropEdit = (): void => {
    editSlot.state = { status: 'reading' }
    editSlot.restoreLine = 0
    editSlot.listeners.clear()
  }

  return {
    key: deps.key,
    rememberPath(path) {
      if (resolvedPath === undefined) resolvedPath = path
    },
    awaitCleanup(pending) {
      gate = Promise.all([gate, pending]).then(() => undefined, () => undefined)
      gated = undefined
    },
    notesFor,
    releaseCompose,
    reading,
    run,
    edit,
    view,
    get empty() {
      return entries.size === 0
    },
    /**
     * 三条规则的唯一实现。close 与 external-change 的处置相同，只差阅读位置：
     * 页签关掉后重开同一文件是全新的一次打开，位置也不该留；文件被外部改写时
     * 读者仍在这份文档上，位置要留着。
     *
     * 返回值在 close 与 external-change 下是一条“磁盘已清”的承诺，页签关掉又
     * 马上开回同一文件时，新的挂载可以等它再读磁盘。
     */
    dispose(reason) {
      switch (reason) {
        case 'leave':
          return
        case 'unload':
          // 只清内存：位置在帧内，磁盘批注不动，否则插件一重载就清空批注。
          run.dispose()
          reading.clear()
          drop()
          dropEdit()
          return
        case 'close':
        case 'external-change': {
          const cleared = dropAnnotations()
          // 先压住挂起的滚动写入，再丢弃槽：否则节流定时器会把位置写回一个已死的 crate。
          run.dispose()
          if (reason === 'close') reading.clear()
          drop()
          dropEdit()
          viewSlot.collapsed = null
          viewSlot.updateCursor = 0
          viewSlot.listeners.clear()
          return cleared
        }
      }
    },
  }
}
