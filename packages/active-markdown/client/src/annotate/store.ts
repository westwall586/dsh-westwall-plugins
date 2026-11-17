/**
 * 插件级批注 store：按 session + 文档路径隔离，内存快照立即更新、Host 落盘
 * 串行执行。每个键一条写链，同一文档的两个 tab 不会后写覆盖先写；加载时若
 * 已有本地写入，晚到的磁盘结果不覆盖它。
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
  /** 下一个可用编号的高水位。 */
  nextSeq: number
  persistence: AnnotationPersistence
}

export type AnnotationWrite =
  | { status: 'saved', durable: boolean }
  | { status: 'too-large', bytes: number, limit: number }
  | { status: 'failed', message: string }

export interface AnnotationStore {
  subscribe(key: DraftKey, listener: () => void): () => void
  getSnapshot(key: DraftKey): AnnotationSnapshot
  load(key: DraftKey): void
  write(key: DraftKey, annotations: readonly Annotation[], pending?: PendingReview): Promise<AnnotationWrite>
  clear(key: DraftKey): Promise<AnnotationWrite>
}

export interface AnnotationStoreDeps {
  host(): Promise<HostBridge>
}

export const EMPTY_SNAPSHOT: AnnotationSnapshot = Object.freeze({
  status: 'idle',
  annotations: [],
  nextSeq: 1,
  persistence: 'unknown',
})

interface Entry {
  snapshot: AnnotationSnapshot
  generation: number
  loading: boolean
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
      entry = { snapshot: { ...EMPTY_SNAPSHOT }, generation: 0, loading: false, listeners: new Set() }
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

  /** Serialize writes per draft key; the second write starts after the first settles. */
  const withLock = <T>(id: string, job: () => Promise<T>): Promise<T> => {
    const previous = chains.get(id) ?? Promise.resolve()
    const next = previous.then(job, job)
    const tail = next.then(() => undefined, () => undefined)
    chains.set(id, tail)
    void tail.then(() => {
      if (chains.get(id) === tail) chains.delete(id)
    })
    return next
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

    load(key) {
      const entry = ensure(key)
      if (entry.loading || entry.snapshot.status === 'ready') return
      entry.loading = true
      const generation = entry.generation
      setSnapshot(entry, { ...entry.snapshot, status: 'loading' })
      void (async () => {
        let draft: AnnotationDraft | null = null
        let persistence: AnnotationPersistence = 'durable'
        try {
          const host = await deps.host()
          draft = await host.annotationLoad({ sessionId: key.sessionId, path: key.path })
        } catch {
          persistence = 'memory'
        }
        entry.loading = false
        if (entry.generation !== generation) {
          // A local write landed while the read was in flight; keep it.
          setSnapshot(entry, { ...entry.snapshot, status: 'ready' })
          return
        }
        const annotations = draft?.annotations ?? []
        setSnapshot(entry, {
          status: 'ready',
          annotations,
          nextSeq: draft?.nextSeq ?? nextSeq(annotations),
          persistence,
        })
      })()
    },

    write(key, annotations, pending) {
      const entry = ensure(key)
      entry.generation += 1
      setSnapshot(entry, {
        status: 'ready',
        annotations: [...annotations],
        nextSeq: nextSeq(annotations, entry.snapshot.nextSeq),
        persistence: entry.snapshot.persistence,
      })
      return withLock(keyId(key), async () => {
        try {
          const host = await deps.host()
          const result = await host.annotationSave({
            sessionId: key.sessionId,
            path: key.path,
            annotations: [...annotations],
            pending: pending ?? null,
          })
          setSnapshot(entry, { ...entry.snapshot, persistence: persistenceAfter(result) })
          if (result.status === 'too-large') {
            return { status: 'too-large', bytes: result.bytes, limit: result.limit }
          }
          return { status: 'saved', durable: result.durable }
        } catch (error) {
          setSnapshot(entry, { ...entry.snapshot, persistence: 'memory' })
          return { status: 'failed', message: messageOf(error) }
        }
      })
    },

    clear(key) {
      const entry = ensure(key)
      entry.generation += 1
      setSnapshot(entry, { status: 'ready', annotations: [], nextSeq: 1, persistence: entry.snapshot.persistence })
      return withLock(keyId(key), async () => {
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
