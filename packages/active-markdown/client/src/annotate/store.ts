/**
 * 插件级批注 store：按 session + 文档路径隔离，内存快照立即更新、Host 落盘
 * 串行执行。每个键一条写链，同一文档的两个 tab 不会后写覆盖先写；加载时若
 * 已有本地写入，晚到的磁盘结果不覆盖它。
 *
 * `pending` 是反馈附件的待发送记录。批注写入默认保留快照里已有的 pending，
 * 只有 attach/regenerate/detach/commit 显式替换或清空它，避免改一条意见就把
 * 附件记录丢掉。pending 写方法要求调用方已持有该键的锁，它们不再自己排队。
 */
import type { HostBridge } from '../context.ts'
import type { Annotation, AnnotationDraft, AnnotationSaveView, PendingReview } from './model.ts'
import { nextSeq } from './model.ts'

/** 草稿身份：会话加规范绝对文档路径。 */
export interface DraftKey {
  sessionId: string
  path: string
}

export type AnnotationPersistence = 'unknown' | 'durable' | 'memory' | 'too-large'

export interface AnnotationSnapshot {
  status: 'idle' | 'loading' | 'ready'
  annotations: readonly Annotation[]
  pending: PendingReview | null
  /** 下一个可用编号的高水位。 */
  nextSeq: number
  persistence: AnnotationPersistence
}

export type AnnotationWrite =
  | { status: 'saved', durable: boolean }
  | { status: 'too-large', bytes: number, limit: number }
  | { status: 'failed', message: string }

export type PendingRefusal = 'already-pending' | 'no-pending' | 'round-mismatch' | 'not-ready'

export type PendingWrite = AnnotationWrite | { status: 'refused', reason: PendingRefusal }

export type AnnotationCommit =
  | { status: 'committed', snapshotMissing: boolean }
  | { status: 'refused', reason: PendingRefusal }
  | { status: 'failed', message: string }

export interface AnnotationWriteOptions {
  /** 省略表示沿用当前 pending；`null` 明确清空。 */
  pending?: PendingReview | null
}

export interface AnnotationStore {
  subscribe(key: DraftKey, listener: () => void): () => void
  getSnapshot(key: DraftKey): AnnotationSnapshot
  load(key: DraftKey): void
  /**
   * Serialize work per draft key. Pending methods below assume this lock is
   * already held, so an attach cannot race a body edit into a stale rewrite.
   */
  withLock<T>(key: DraftKey, job: () => Promise<T>): Promise<T>
  write(key: DraftKey, annotations: readonly Annotation[], options?: AnnotationWriteOptions): Promise<AnnotationWrite>
  attach(key: DraftKey, pending: PendingReview): Promise<PendingWrite>
  regenerate(key: DraftKey, roundId: string, pending: PendingReview): Promise<PendingWrite>
  detach(key: DraftKey, roundId: string): Promise<PendingWrite>
  commit(key: DraftKey, roundId: string, sentText: string): Promise<AnnotationCommit>
  clear(key: DraftKey): Promise<AnnotationWrite>
}

export interface AnnotationStoreDeps {
  host(): Promise<HostBridge>
}

export const EMPTY_SNAPSHOT: AnnotationSnapshot = Object.freeze({
  status: 'idle',
  annotations: [],
  pending: null,
  nextSeq: 1,
  persistence: 'unknown',
})

interface Entry {
  snapshot: AnnotationSnapshot
  generation: number
  loadPromise: Promise<void> | null
  listeners: Set<() => void>
}

function keyId(key: DraftKey): string {
  return `${key.sessionId}\u0000${key.path}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function persistenceAfter(result: AnnotationSaveView): AnnotationPersistence {
  if (result.status === 'too-large') return 'too-large'
  return result.durable ? 'durable' : 'memory'
}

export function createAnnotationStore(deps: AnnotationStoreDeps): AnnotationStore {
  const entries = new Map<string, Entry>()
  const chains = new Map<string, Promise<void>>()

  const ensure = (key: DraftKey): Entry => {
    const id = keyId(key)
    let entry = entries.get(id)
    if (entry === undefined) {
      entry = { snapshot: { ...EMPTY_SNAPSHOT }, generation: 0, loadPromise: null, listeners: new Set() }
      entries.set(id, entry)
    }
    return entry
  }

  const notify = (entry: Entry): void => {
    for (const listener of [...entry.listeners]) listener()
  }

  const setSnapshot = (entry: Entry, next: AnnotationSnapshot): void => {
    entry.snapshot = next
    notify(entry)
  }

  const withLock = <T>(key: DraftKey, job: () => Promise<T>): Promise<T> => {
    const id = keyId(key)
    const previous = chains.get(id) ?? Promise.resolve()
    const next = previous.then(job, job)
    const tail = next.then(() => undefined, () => undefined)
    chains.set(id, tail)
    void tail.then(() => {
      if (chains.get(id) === tail) chains.delete(id)
    })
    return next
  }

  /** Persist one draft as it stands now, with the caller-chosen pending slot. */
  const persist = async (
    key: DraftKey,
    entry: Entry,
    annotations: readonly Annotation[],
    pending: PendingReview | null,
  ): Promise<AnnotationWrite> => {
    try {
      const host = await deps.host()
      const result = await host.annotationSave({
        sessionId: key.sessionId,
        path: key.path,
        annotations: [...annotations],
        pending,
      })
      if (result.status === 'too-large') {
        setSnapshot(entry, { ...entry.snapshot, persistence: 'too-large' })
        return { status: 'too-large', bytes: result.bytes, limit: result.limit }
      }
      setSnapshot(entry, { ...entry.snapshot, persistence: persistenceAfter(result) })
      return { status: 'saved', durable: result.durable }
    } catch (error) {
      setSnapshot(entry, { ...entry.snapshot, persistence: 'memory' })
      return { status: 'failed', message: messageOf(error) }
    }
  }

  const refuse = (reason: PendingRefusal): PendingWrite => ({ status: 'refused', reason })

  const startLoad = (key: DraftKey, entry: Entry): Promise<void> => {
    if (entry.loadPromise !== null) return entry.loadPromise
    const generation = entry.generation
    setSnapshot(entry, { ...entry.snapshot, status: 'loading' })
    const promise = (async () => {
      let draft: AnnotationDraft | null = null
      let persistence: AnnotationPersistence = 'durable'
      try {
        const host = await deps.host()
        draft = await host.annotationLoad({ sessionId: key.sessionId, path: key.path })
      } catch {
        persistence = 'memory'
      }
      if (entry.generation !== generation) {
        // A local write landed while the read was in flight; keep it.
        setSnapshot(entry, { ...entry.snapshot, status: 'ready' })
        return
      }
      const annotations = draft?.annotations ?? []
      setSnapshot(entry, {
        status: 'ready',
        annotations,
        pending: draft?.pending ?? null,
        nextSeq: draft?.nextSeq ?? nextSeq(annotations),
        persistence,
      })
    })()
    entry.loadPromise = promise
    void promise.finally(() => {
      if (entry.loadPromise === promise) entry.loadPromise = null
    })
    return promise
  }

  /** Pending writes may arrive from the committer before this tab loaded the draft. */
  const ensureLoaded = async (key: DraftKey, entry: Entry): Promise<boolean> => {
    if (entry.snapshot.status === 'ready') return true
    await startLoad(key, entry)
    return (entry.snapshot as AnnotationSnapshot).status === 'ready'
  }

  return {
    subscribe(key, listener) {
      const entry = ensure(key)
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
      }
    },

    getSnapshot(key) {
      return ensure(key).snapshot
    },

    withLock,

    load(key) {
      const entry = ensure(key)
      if (entry.loadPromise !== null || entry.snapshot.status === 'ready') return
      void startLoad(key, entry)
    },

    async write(key, annotations, options = {}) {
      const entry = ensure(key)
      entry.generation += 1
      setSnapshot(entry, {
        status: 'ready',
        annotations: [...annotations],
        pending: entry.snapshot.pending,
        nextSeq: nextSeq(annotations, entry.snapshot.nextSeq),
        persistence: entry.snapshot.persistence,
      })
      // Resolve the pending slot under the lock: an attach may have completed
      // while this edit waited, and the edit must keep that attachment.
      return withLock(key, () => {
        const pending = options.pending === undefined ? entry.snapshot.pending : options.pending
        if (pending !== entry.snapshot.pending) setSnapshot(entry, { ...entry.snapshot, pending })
        return persist(key, entry, annotations, pending)
      })
    },

    async attach(key, pending) {
      const entry = ensure(key)
      if (entry.snapshot.status !== 'ready') return refuse('not-ready')
      if (entry.snapshot.pending !== null) return refuse('already-pending')
      entry.generation += 1
      const written = await persist(key, entry, entry.snapshot.annotations, pending)
      if (written.status !== 'saved') return written
      entry.snapshot = {
        ...entry.snapshot,
        annotations: [...entry.snapshot.annotations],
        pending,
      }
      notify(entry)
      return written
    },

    async regenerate(key, roundId, pending) {
      const entry = ensure(key)
      const current = entry.snapshot.pending
      if (current === null) return refuse('no-pending')
      if (current.roundId !== roundId || pending.roundId !== roundId) return refuse('round-mismatch')
      entry.generation += 1
      const written = await persist(key, entry, entry.snapshot.annotations, pending)
      if (written.status !== 'saved') return written
      entry.snapshot = { ...entry.snapshot, pending }
      notify(entry)
      return written
    },

    async detach(key, roundId) {
      const entry = ensure(key)
      if (!(await ensureLoaded(key, entry))) {
        return { status: 'failed', message: 'annotation draft could not be loaded' }
      }
      const current = entry.snapshot.pending
      if (current === null) return refuse('no-pending')
      if (current.roundId !== roundId) return refuse('round-mismatch')
      try {
        const host = await deps.host()
        await host.reviewDetach({ sessionId: key.sessionId, path: key.path, roundId })
      } catch (error) {
        return { status: 'failed', message: messageOf(error) }
      }
      entry.generation += 1
      entry.snapshot = { ...entry.snapshot, pending: null }
      notify(entry)
      return { status: 'saved', durable: entry.snapshot.persistence === 'durable' }
    },

    async commit(key, roundId, sentText) {
      const entry = ensure(key)
      if (!(await ensureLoaded(key, entry))) {
        return { status: 'failed', message: 'annotation draft could not be loaded' }
      }
      const current = entry.snapshot.pending
      if (current === null) return { status: 'refused', reason: 'no-pending' }
      if (current.roundId !== roundId) return { status: 'refused', reason: 'round-mismatch' }
      let snapshotMissing: boolean
      try {
        const host = await deps.host()
        const result = await host.reviewCommit({ sessionId: key.sessionId, path: key.path, roundId, sentText })
        if (!result.committed) {
          return { status: 'failed', message: `review commit was not accepted: ${roundId}` }
        }
        snapshotMissing = result.snapshotMissing
      } catch (error) {
        return { status: 'failed', message: messageOf(error) }
      }
      entry.generation += 1
      setSnapshot(entry, { status: 'ready', annotations: [], pending: null, nextSeq: 1, persistence: entry.snapshot.persistence })
      return { status: 'committed', snapshotMissing }
    },

    clear(key) {
      const entry = ensure(key)
      entry.generation += 1
      setSnapshot(entry, { status: 'ready', annotations: [], pending: null, nextSeq: 1, persistence: entry.snapshot.persistence })
      return withLock(key, async () => {
        try {
          const host = await deps.host()
          await host.annotationClear({ sessionId: key.sessionId, path: key.path })
          setSnapshot(entry, { ...entry.snapshot, persistence: 'durable' })
          return { status: 'saved', durable: true }
        } catch (error) {
          setSnapshot(entry, { ...entry.snapshot, persistence: 'memory' })
          return { status: 'failed', message: messageOf(error) }
        }
      })
    },
  }
}
