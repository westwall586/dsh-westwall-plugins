/**
 * 插件级的文档 store，只做三件事：按键找 crate、跨文档扇出、接收常驻观察者的
 * 信号。文档的全部状态归各自的 crate，这里不持有任何按字段的方法。
 *
 * 挂载与卸载不是生命周期事件：切页签会让 body 卸载，而状态必须留下。所以
 * mount/unmount 只记挂载计数，销毁的唯一入口是 `dispose(..., 'close')`，由第 6 步
 * 的常驻观察者在页签记录真的消失时调用。
 */
import type { HostBridge } from '../context.ts'
import type { Edit } from './kernel/edit.ts'
import type { Notes } from './kernel/notes.ts'
import type { ViewPreferences } from './kernel/preferences.ts'
import type { Reading } from './kernel/reading.ts'
import type { TranslationRun } from './kernel/translation.ts'
import { createCrate, type Crate, type Disposal } from './crate.ts'
import { crateId, type DocumentRef } from './ref.ts'

export interface DocumentStoreDeps {
  host(): Promise<HostBridge>
  /** 阅读位置的节流窗口；省略用默认值。 */
  readingDelayMs?: number
}

/** 调用方按 (文档, composer) 取批注面；`withLock` 与 `notes` 必须走同一个实例。 */
export interface NotesWriter {
  readonly slot: { readonly session: string, readonly path: string, readonly compose: string }
  notes: Notes
  withLock<T>(job: () => Promise<T>): Promise<T>
}

export interface DocumentStore {
  /** 取该文档在输入框会话里的批注面；每次调用累加一个引用，用 release 归还。 */
  notesFor(compose: string, path: string, session: string): NotesWriter
  /** 归还一次 notesFor 的引用；不销毁状态。 */
  release(compose: string, path: string, session: string): void
  /**
   * 取该文件的翻译运行。同一文件被两个 compose 会话打开时拿到的是同一个对象，
   * 所以谁都不需要引用计数：结束运行只走 crate 的 abort 或 dispose。
   */
  runFor(session: string, path: string): TranslationRun
  /** 取该文档的阅读位置；文档不存在时为 null。 */
  readingFor(session: string, path: string): Reading | null
  /** 取该文档的编辑草稿；文档不存在时为 null。 */
  editFor(session: string, path: string): Edit | null
  /** 取该文档的视图偏好；文档不存在时为 null。 */
  viewFor(session: string, path: string): ViewPreferences | null
  /** 登记一次 body 挂载。 */
  mount(ref: DocumentRef): void
  /** 撤销一次挂载；crate 与快照都保留。 */
  unmount(ref: DocumentRef): void
  /** 常驻观察者用它判断某文档是否还有存活状态。 */
  has(session: string, path: string): boolean
  /**
   * 为当前存活的 crate 各发一次信号。观察者拿它判断某个已不在任何登记里的 crate
   * 有没有人还开着（比如来自已不存在的会话）；标记为 closed 的 crate 被跳过。
   */
  touch(live: (session: string, path: string) => void): void
  /** 标记已发现页签消失；之后 `touch` 不再把它交给观察者。 */
  closed(session: string, path: string): void
  /** close 与 external-change 返回的承诺在磁盘清理完成时结束。 */
  dispose(session: string, path: string, reason: Disposal): void | Promise<void>
  disposeAll(reason: Disposal): void
}

interface Entry {
  readonly crate: Crate
  mounts: number
  /** 观察者已确认页签消失；它之后可能还在等 `dispose` 完成落盘。 */
  closed: boolean
}

export function createDocumentStore(deps: DocumentStoreDeps): DocumentStore {
  const entries = new Map<string, Entry>()
  /** 页签关掉又马上开回同一文件时，上一次关闭的磁盘清理可能还没跑完。 */
  const pendingCleanup = new Map<string, Promise<void>>()

  /**
   * 取或建一个 crate。上一次关闭的磁盘清理如果还没跑完，新 crate 会先等它，
   * 否则它立刻读到的是还没清掉的旧批注。
   */
  const find = (path: string, session: string): Entry => {
    const id = crateId({ session, path })
    const existing = entries.get(id)
    if (existing !== undefined) return existing
    const entry: Entry = {
      crate: createCrate({
        key: { session, path },
        host: deps.host,
        ...(deps.readingDelayMs === undefined ? {} : { readingDelayMs: deps.readingDelayMs }),
      }),
      mounts: 0,
      closed: false,
    }
    entry.crate.awaitCleanup(pendingCleanup.get(id) ?? Promise.resolve())
    entries.set(id, entry)
    return entry
  }

  const clear = (id: string, reason: Disposal): void | Promise<void> => {
    const entry = entries.get(id)
    if (entry === undefined) return
    entries.delete(id)
    return entry.crate.dispose(reason)
  }

  return {
    notesFor(compose, path, session) {
      const { notes, withLock } = find(path, session).crate.notesFor(compose)
      return { slot: { session, path, compose }, notes, withLock }
    },

    release(compose, path, session) {
      entries.get(crateId({ session, path }))?.crate.releaseCompose(compose)
    },

    runFor(session, path) {
      return find(path, session).crate.run
    },

    readingFor(session, path) {
      return entries.get(crateId({ session, path }))?.crate.reading ?? null
    },

    editFor(session, path) {
      return entries.get(crateId({ session, path }))?.crate.edit ?? null
    },

    viewFor(session, path) {
      return entries.get(crateId({ session, path }))?.crate.view ?? null
    },

    mount(ref) {
      find(ref.path, ref.session).mounts += 1
    },

    unmount(ref) {
      // 计数只降不删：销毁留给 dispose，普通卸载不跑 switch。
      const entry = entries.get(crateId({ session: ref.session, path: ref.path }))
      if (entry === undefined) return
      entry.mounts = Math.max(0, entry.mounts - 1)
    },

    has(session, path) {
      return entries.has(crateId({ session, path }))
    },

    touch(live) {
      for (const entry of entries.values()) {
        if (entry.closed) continue
        live(entry.crate.key.session, entry.crate.key.path)
      }
    },

    closed(session, path) {
      const entry = entries.get(crateId({ session, path }))
      if (entry !== undefined) entry.closed = true
    },

    dispose(session, path, reason) {
      const id = crateId({ session, path })
      const result = clear(id, reason)
      if (reason !== 'close' && reason !== 'external-change') return
      const pending = Promise.resolve(result).then(() => undefined).finally(() => {
        if (pendingCleanup.get(id) === pending) pendingCleanup.delete(id)
      })
      pendingCleanup.set(id, pending)
      return pending
    },

    disposeAll(reason) {
      for (const id of [...entries.keys()]) clear(id, reason)
    },
  }
}
