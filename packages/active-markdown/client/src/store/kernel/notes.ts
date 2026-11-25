/**
 * 一个 crate 里的批注状态，按 composer 隔离：内存快照立即更新、Host 落盘串行
 * 执行。每个 composer 一条写链，同一文档的两个 tab 不会后写覆盖先写；加载时
 * 若已有本地写入，晚到的磁盘结果不覆盖它。
 *
 * `pending` 是反馈附件的待发送记录。批注写入默认保留快照里已有的 pending，
 * 只有 attach/regenerate/detach/commit 显式替换或清空它，避免改一条意见就把
 * 附件记录丢掉。pending 写方法要求调用方已持有该 composer 的锁，它们不再自己排队。
 */
import type { HostBridge } from '../../context.ts'
import type { Annotation, AnnotationDraft, AnnotationSaveView, PendingReview } from '../../annotate/model.ts'
import { nextSeq } from '../../annotate/model.ts'
import type { DocumentKey } from '../ref.ts'
import { composeId } from '../ref.ts'

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

/** 一个 composer 对一份文档的批注面；方法名与语义与原 AnnotationStore 一致。 */
export interface Notes {
  subscribe(listener: () => void): () => void
  getSnapshot(): AnnotationSnapshot
  load(): void
  /**
   * Serialize work per composer. Pending methods below assume this lock is
   * already held, so an attach cannot race a body edit into a stale rewrite.
   */
  withLock<T>(job: () => Promise<T>): Promise<T>
  write(annotations: readonly Annotation[], options?: AnnotationWriteOptions): Promise<AnnotationWrite>
  attach(pending: PendingReview): Promise<PendingWrite>
  regenerate(roundId: string, pending: PendingReview): Promise<PendingWrite>
  detach(roundId: string): Promise<PendingWrite>
  commit(roundId: string, sentText: string): Promise<AnnotationCommit>
  clear(): Promise<AnnotationWrite>
}

/** 调用方按 (文档, composer) 取 notes；`withLock` 挂在这里，不依赖时点实例身份。 */
export interface NotesPort {
  withLock<T>(compose: string, path: string, job: () => Promise<T>): Promise<T>
}

/** 一个 composer 维度上的内存状态。 */
export interface NotesSlot {
  snapshot: AnnotationSnapshot
  generation: number
  loadPromise: Promise<void> | null
  listeners: Set<() => void>
}

export interface NotesDeps {
  key: DocumentKey
  compose: string
  host(): Promise<HostBridge>
}

export interface NotesHandle {
  readonly slot: NotesSlot
  readonly notes: Notes
  /** 与 `notes.withLock` 同一个函数；调用方不必再从 notes 里取。 */
  readonly withLock: Notes['withLock']
}

export const EMPTY_SNAPSHOT: AnnotationSnapshot = Object.freeze({
  status: 'idle',
  annotations: [],
  pending: null,
  nextSeq: 1,
  persistence: 'unknown',
})

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function persistenceAfter(result: AnnotationSaveView): AnnotationPersistence {
  if (result.status === 'too-large') return 'too-large'
  return result.durable ? 'durable' : 'memory'
}

export function createNotesSlot(): NotesSlot {
  return { snapshot: { ...EMPTY_SNAPSHOT }, generation: 0, loadPromise: null, listeners: new Set() }
}

/** 一个 composer 维度上的串行写链。链按 composer 键控，所以它归 crate 持有。 */
export function createWriteChains(): Map<string, Promise<void>> {
  return new Map()
}

export function createNotes(deps: NotesDeps, slot: NotesSlot, chains: Map<string, Promise<void>>): NotesHandle {
  const { key, compose } = deps
  // 写链跨 handle 共享：同一个 composer 换一个句柄调用，写入仍然排队。
  const id = composeId(key, compose)

  const notify = (): void => {
    for (const listener of [...slot.listeners]) listener()
  }

  const setSnapshot = (next: AnnotationSnapshot): void => {
    slot.snapshot = next
    notify()
  }

  const withLock = <T>(job: () => Promise<T>): Promise<T> => {
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
    annotations: readonly Annotation[],
    pending: PendingReview | null,
  ): Promise<AnnotationWrite> => {
    try {
      const host = await deps.host()
      const result = await host.annotationSave({
        sessionId: key.session,
        path: key.path,
        annotations: [...annotations],
        pending,
      })
      if (result.status === 'too-large') {
        setSnapshot({ ...slot.snapshot, persistence: 'too-large' })
        return { status: 'too-large', bytes: result.bytes, limit: result.limit }
      }
      setSnapshot({ ...slot.snapshot, persistence: persistenceAfter(result) })
      return { status: 'saved', durable: result.durable }
    } catch (error) {
      setSnapshot({ ...slot.snapshot, persistence: 'memory' })
      return { status: 'failed', message: messageOf(error) }
    }
  }

  const refuse = (reason: PendingRefusal): PendingWrite => ({ status: 'refused', reason })

  const startLoad = (): Promise<void> => {
    if (slot.loadPromise !== null) return slot.loadPromise
    const generation = slot.generation
    setSnapshot({ ...slot.snapshot, status: 'loading' })
    const promise = (async () => {
      let draft: AnnotationDraft | null = null
      let persistence: AnnotationPersistence = 'durable'
      try {
        const host = await deps.host()
        draft = await host.annotationLoad({ sessionId: key.session, path: key.path })
      } catch {
        persistence = 'memory'
      }
      if (slot.generation !== generation) {
        // A local write landed while the read was in flight; keep it.
        setSnapshot({ ...slot.snapshot, status: 'ready' })
        return
      }
      const annotations = draft?.annotations ?? []
      setSnapshot({
        status: 'ready',
        annotations,
        pending: draft?.pending ?? null,
        nextSeq: draft?.nextSeq ?? nextSeq(annotations),
        persistence,
      })
    })()
    slot.loadPromise = promise
    void promise.finally(() => {
      if (slot.loadPromise === promise) slot.loadPromise = null
    })
    return promise
  }

  /** Pending writes may arrive from the committer before this tab loaded the draft. */
  const ensureLoaded = async (): Promise<boolean> => {
    if (slot.snapshot.status === 'ready') return true
    await startLoad()
    return (slot.snapshot as AnnotationSnapshot).status === 'ready'
  }

  const notes: Notes = {
    subscribe(listener) {
      slot.listeners.add(listener)
      return () => {
        slot.listeners.delete(listener)
      }
    },

    getSnapshot() {
      return slot.snapshot
    },

    withLock,

    load() {
      if (slot.loadPromise !== null || slot.snapshot.status === 'ready') return
      void startLoad()
    },

    async write(annotations, options = {}) {
      slot.generation += 1
      setSnapshot({
        status: 'ready',
        annotations: [...annotations],
        pending: slot.snapshot.pending,
        nextSeq: nextSeq(annotations, slot.snapshot.nextSeq),
        persistence: slot.snapshot.persistence,
      })
      // Resolve the pending slot under the lock: an attach may have completed
      // while this edit waited, and the edit must keep that attachment.
      return withLock(() => {
        const pending = options.pending === undefined ? slot.snapshot.pending : options.pending
        if (pending !== slot.snapshot.pending) setSnapshot({ ...slot.snapshot, pending })
        return persist(annotations, pending)
      })
    },

    async attach(pending) {
      if (slot.snapshot.status !== 'ready') return refuse('not-ready')
      if (slot.snapshot.pending !== null) return refuse('already-pending')
      slot.generation += 1
      const written = await persist(slot.snapshot.annotations, pending)
      if (written.status !== 'saved') return written
      slot.snapshot = {
        ...slot.snapshot,
        annotations: [...slot.snapshot.annotations],
        pending,
      }
      notify()
      return written
    },

    async regenerate(roundId, pending) {
      const current = slot.snapshot.pending
      if (current === null) return refuse('no-pending')
      if (current.roundId !== roundId || pending.roundId !== roundId) return refuse('round-mismatch')
      slot.generation += 1
      const written = await persist(slot.snapshot.annotations, pending)
      if (written.status !== 'saved') return written
      slot.snapshot = { ...slot.snapshot, pending }
      notify()
      return written
    },

    async detach(roundId) {
      if (!(await ensureLoaded())) {
        return { status: 'failed', message: 'annotation draft could not be loaded' }
      }
      const current = slot.snapshot.pending
      if (current === null) return refuse('no-pending')
      if (current.roundId !== roundId) return refuse('round-mismatch')
      try {
        const host = await deps.host()
        await host.reviewDetach({ sessionId: key.session, path: key.path, roundId })
      } catch (error) {
        return { status: 'failed', message: messageOf(error) }
      }
      slot.generation += 1
      slot.snapshot = { ...slot.snapshot, pending: null }
      notify()
      return { status: 'saved', durable: slot.snapshot.persistence === 'durable' }
    },

    async commit(roundId, sentText) {
      if (!(await ensureLoaded())) {
        return { status: 'failed', message: 'annotation draft could not be loaded' }
      }
      const current = slot.snapshot.pending
      if (current === null) return { status: 'refused', reason: 'no-pending' }
      if (current.roundId !== roundId) return { status: 'refused', reason: 'round-mismatch' }
      let snapshotMissing: boolean
      try {
        const host = await deps.host()
        const result = await host.reviewCommit({ sessionId: key.session, path: key.path, roundId, sentText })
        if (!result.committed) {
          return { status: 'failed', message: `review commit was not accepted: ${roundId}` }
        }
        snapshotMissing = result.snapshotMissing
      } catch (error) {
        return { status: 'failed', message: messageOf(error) }
      }
      const sent = new Map(current.annotations.map(annotation => [annotation.id, JSON.stringify(annotation)]))
      const remaining = slot.snapshot.annotations.filter(annotation => sent.get(annotation.id) !== JSON.stringify(annotation))
      slot.generation += 1
      setSnapshot({
        status: 'ready',
        annotations: remaining,
        pending: null,
        nextSeq: remaining.length === 0 ? 1 : nextSeq(remaining, slot.snapshot.nextSeq),
        persistence: slot.snapshot.persistence,
      })
      return { status: 'committed', snapshotMissing }
    },

    clear() {
      slot.generation += 1
      setSnapshot({ status: 'ready', annotations: [], pending: null, nextSeq: 1, persistence: slot.snapshot.persistence })
      return withLock(async () => {
        try {
          const host = await deps.host()
          await host.annotationClear({ sessionId: key.session, path: key.path })
          setSnapshot({ ...slot.snapshot, persistence: 'durable' })
          return { status: 'saved', durable: true }
        } catch (error) {
          setSnapshot({ ...slot.snapshot, persistence: 'memory' })
          return { status: 'failed', message: messageOf(error) }
        }
      })
    },
  }

  return { slot, notes, withLock }
}
