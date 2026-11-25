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
import { trace } from './trace.ts'

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
  /**
   * 取该文档的阅读位置；文档还没被打开过时先建 crate。body 在渲染期就要拿到它，
   * 而这时挂载 effect 还没跑：返回 null 会让恢复环节永远跳过，新挂上的元素停在 0。
   */
  readingFor(session: string, path: string): Reading
  /** 取该文档的编辑草稿；文档还没被打开过时先建 crate。 */
  editFor(session: string, path: string): Edit
  /** 取该文档的视图偏好；文档还没被打开过时先建 crate。 */
  viewFor(session: string, path: string): ViewPreferences
  /**
   * “本 body 现在看的是哪个 crate”。body 每次渲染都会读位置与视图偏好，那两个读取
   * 会登记当前 crate；这里只按地址找回来，找不到返回 null，不新建。调用方用它区分
   * “同一份文档重建出来的页面”与“换到另一份文档”。
   */
  crateIdentity(session: string, path: string): object | null
  /** crate 记住读到的那条绝对路径；之后的批注与翻译都按它找文件。 */
  rememberPath(session: string, path: string, absolutePath: string): void
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
  touch(live: (session: string, path: string, absolutePath: string | undefined) => void): void
  /** 标记已发现页签消失；之后 `touch` 不再把它交给观察者。 */
  closed(session: string, path: string): void
  /** close 与 external-change 返回的承诺在磁盘清理完成时结束。 */
  dispose(session: string, path: string, reason: Disposal): void | Promise<void>
  disposeAll(reason: Disposal): void
}

interface Entry {
  readonly crate: Crate
  mounts: number
  /** 曾经有 body 挂载过它；只有这样的 crate 才对应一个页签。 */
  everMounted: boolean
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
      everMounted: false,
      closed: false,
    }
    entry.crate.awaitCleanup(pendingCleanup.get(id) ?? Promise.resolve())
    entries.set(id, entry)
    return entry
  }

  /**
   * 当前 body 的 crate。它不能靠身份查询自己建：一个查询不该为某个地址凭空造出状态。
   * 登记发生在端口读取上（body 每次渲染都会读位置与视图偏好），查询只按地址找回来。
   */
  const live = new Map<string, Crate>()

  const remember = (id: string, crate: Crate): Crate => {
    live.set(id, crate)
    return crate
  }

  const clear = (id: string, reason: Disposal): void | Promise<void> => {
    const entry = entries.get(id)
    trace('store.clear', { id, reason, found: entry !== undefined })
    if (entry === undefined) return
    live.delete(id)
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
      return remember(crateId({ session, path }), find(path, session).crate).reading
    },

    editFor(session, path) {
      return find(path, session).crate.edit
    },

    viewFor(session, path) {
      return remember(crateId({ session, path }), find(path, session).crate).view
    },

    rememberPath(session, path, absolutePath) {
      trace('store.rememberPath', { session, path, absolutePath })
      find(path, session).crate.rememberPath(absolutePath)
    },

    crateIdentity(session, path) {
      return live.get(crateId({ session, path })) ?? null
    },

    mount(ref) {
      const entry = find(ref.path, ref.session)
      entry.mounts += 1
      entry.everMounted = true
      trace('store.mount', { session: ref.session, path: ref.path, compose: ref.compose })
    },

    unmount(ref) {
      trace('store.unmount', { session: ref.session, path: ref.path })
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
        // A crate that a body never mounted was never a tab: the session-level
        // annotation committer reaches notes through a crate keyed by the session
        // itself, and there is no address that could ever match it. Handing it to
        // the close observer makes it look like a document whose tab vanished, so
        // it is cleared on every publish and drags every check down with it.
        if (entry.everMounted !== true) continue
        live(entry.crate.key.session, entry.crate.key.path, entry.crate.absolutePath())
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
