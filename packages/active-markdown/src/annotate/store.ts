/**
 * 批注草稿 domain：一次打开、同步读、durable 写。记录按文档键隔离，清理只在
 * 打开与写入时顺手做，不挂定时器：30 天 TTL 先删，再按 `updatedAt` 保留最近
 * 20 份；正在写的这份永不淘汰。单份超过 512 KiB 拒绝落盘，返回 too-large 让
 * 客户端把草稿留在内存里，而不是抛错。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  annotationDraftSchema,
  annotationSchema,
  pendingReviewSchema,
  type Annotation,
  type AnnotationDraft,
  type PendingReview,
} from './schema.ts'
import {
  AnnotationError,
  canonicalDocumentPath,
  draftKeyOf,
  DRAFT_TTL_MS,
  MAX_DRAFT_BYTES,
  MAX_DRAFTS,
  requireSessionId,
} from './paths.ts'

export const annotationDraftDomain = defineDomain({
  name: 'active_markdown_annotations',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    drafts: domainTable<string, AnnotationDraft>(annotationDraftSchema),
  },
})

/** 草稿表的最小接口；domain table 与测试内存表都满足它。 */
export interface AnnotationTable {
  get(key: string): AnnotationDraft | undefined
  entries(): IterableIterator<[string, AnnotationDraft]>
  put(key: string, value: AnnotationDraft): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface AnnotationLoadInput {
  readonly sessionId: string
  readonly path: string
}

export interface AnnotationSaveInput {
  readonly sessionId: string
  readonly path: string
  readonly annotations: readonly Annotation[]
  readonly pending: PendingReview | null
}

export type AnnotationSaveView =
  | { readonly status: 'saved', readonly durable: boolean }
  | { readonly status: 'too-large', readonly bytes: number, readonly limit: number }

export interface AnnotationStore {
  load(input: AnnotationLoadInput): Promise<AnnotationDraft | null>
  save(input: AnnotationSaveInput): Promise<AnnotationSaveView>
  clear(input: AnnotationLoadInput): Promise<Record<string, never>>
  pending(sessionId: string): Promise<AnnotationDraft[]>
  /** 打开 domain 后先跑一次 30 天/20 份清理。 */
  prune(keepKey?: string): Promise<void>
}

export interface AnnotationDomain {
  table(name: 'drafts'): AnnotationTable
}

export interface AnnotationDomainFacility {
  open(spec: typeof annotationDraftDomain): Promise<AnnotationDomain>
}

export interface AnnotationStoreDeps {
  readonly table: AnnotationTable
  readonly durable: boolean
  readonly now?: () => Date
  /** `open` 把 domain 打不开的警告压在这里，测试可注入。 */
  readonly warn?: (message: string, error: unknown) => void
}

/** 插件存储缺失或 domain 打不开时的进程内回落。 */
export function createMemoryAnnotationTable(): AnnotationTable {
  const records = new Map<string, AnnotationDraft>()
  return {
    get: key => records.get(key),
    entries: () => new Map(records).entries(),
    async put(key, value) {
      records.set(key, value)
    },
    async delete(key) {
      return records.delete(key)
    },
  }
}

function timeOf(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function maxSeq(annotations: readonly Annotation[]): number {
  let max = 0
  for (const annotation of annotations) {
    if (annotation.seq > max) max = annotation.seq
  }
  return max
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** 过期与超量记录的清理；失败由调用方决定是否影响本次写入。 */
async function pruneRecords(table: AnnotationTable, now: Date, keepKey?: string): Promise<void> {
  const snapshot = [...table.entries()]
  const cutoff = now.getTime() - DRAFT_TTL_MS
  const keepPresent = keepKey !== undefined && snapshot.some(([key]) => key === keepKey)
  const doomed = new Set<string>()
  for (const [key, record] of snapshot) {
    if (key === keepKey) continue
    if (timeOf(record.updatedAt) < cutoff) doomed.add(key)
  }
  const live = snapshot
    .filter(([key]) => key !== keepKey && !doomed.has(key))
    .sort((left, right) => timeOf(right[1].updatedAt) - timeOf(left[1].updatedAt))
  const allowedOthers = keepPresent ? MAX_DRAFTS - 1 : MAX_DRAFTS
  for (const [key] of live.slice(allowedOthers)) doomed.add(key)
  for (const key of doomed) await table.delete(key)
}

export function createAnnotationStore(deps: AnnotationStoreDeps): AnnotationStore {
  const now = deps.now ?? (() => new Date())

  const prune = async (keepKey?: string): Promise<void> => {
    try {
      await pruneRecords(deps.table, now(), keepKey)
    } catch (error) {
      deps.warn?.('清理批注草稿失败', error)
    }
  }

  return {
    prune,

    async load(input) {
      const key = draftKeyOf(input.sessionId, input.path)
      try {
        return deps.table.get(key) ?? null
      } catch (error) {
        throw new AnnotationError('read-failed', `读取批注草稿失败：${String(error)}`)
      }
    },

    async save(input) {
      const sessionId = requireSessionId(input.sessionId)
      const path = canonicalDocumentPath(input.path)
      const annotations = annotationSchema.array().safeParse(input.annotations)
      if (!annotations.success) {
        throw new AnnotationError('invalid-request', `批注结构不正确：${annotations.error.message}`)
      }
      let pending: PendingReview | undefined
      if (input.pending !== null) {
        const parsed = pendingReviewSchema.safeParse(input.pending)
        if (!parsed.success) {
          throw new AnnotationError('invalid-request', `待发送记录结构不正确：${parsed.error.message}`)
        }
        pending = parsed.data
      }

      const key = draftKeyOf(sessionId, path)
      let existing: AnnotationDraft | undefined
      try {
        existing = deps.table.get(key)
      } catch (error) {
        throw new AnnotationError('read-failed', `读取批注草稿失败：${String(error)}`)
      }
      const updatedAt = now().toISOString()
      const candidate: AnnotationDraft = {
        sessionId,
        path,
        annotations: annotations.data,
        nextSeq: Math.max(existing?.nextSeq ?? 1, maxSeq(annotations.data) + 1),
        ...(pending === undefined ? {} : { pending }),
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
      }
      const parsed = annotationDraftSchema.safeParse(candidate)
      if (!parsed.success) {
        throw new AnnotationError('invalid-request', `批注草稿结构不正确：${parsed.error.message}`)
      }
      const bytes = byteLength(JSON.stringify(parsed.data))
      if (bytes > MAX_DRAFT_BYTES) {
        return { status: 'too-large', bytes, limit: MAX_DRAFT_BYTES }
      }
      try {
        await deps.table.put(key, parsed.data)
      } catch (error) {
        throw new AnnotationError('write-failed', `保存批注草稿失败：${String(error)}`)
      }
      await prune(key)
      return { status: 'saved', durable: deps.durable }
    },

    async clear(input) {
      const key = draftKeyOf(input.sessionId, input.path)
      try {
        await deps.table.delete(key)
      } catch (error) {
        throw new AnnotationError('write-failed', `清空批注草稿失败：${String(error)}`)
      }
      return {}
    },

    async pending(sessionId) {
      const id = requireSessionId(sessionId)
      try {
        const drafts: AnnotationDraft[] = []
        for (const [, record] of deps.table.entries()) {
          if (record.sessionId === id && record.pending !== undefined) drafts.push(record)
        }
        return drafts
      } catch (error) {
        throw new AnnotationError('read-failed', `读取待发送批注失败：${String(error)}`)
      }
    },
  }
}

/**
 * 打开批注 domain；facility 缺失或 open 失败时退回内存，并保留一次警告。
 * 生命周期由 storageDomain facility 收尾，与翻译缓存一致。
 */
export async function openAnnotationStore(
  facility: AnnotationDomainFacility | null,
  options: {
    readonly now?: () => Date
    readonly warn?: (message: string, error: unknown) => void
  } = {},
): Promise<AnnotationStore> {
  const warn = options.warn ?? ((message: string, error: unknown): void => console.warn(message, error))
  const deps = {
    durable: true,
    warn,
    ...(options.now === undefined ? {} : { now: options.now }),
  }
  if (facility !== null) {
    try {
      const domain = await facility.open(annotationDraftDomain)
      const store = createAnnotationStore({ ...deps, table: domain.table('drafts') })
      await store.prune()
      return store
    } catch (error) {
      warn('[dsh-active-markdown] 批注草稿 domain 打不开，本次运行改用内存存储', error)
    }
  }
  return createAnnotationStore({ ...deps, durable: false, table: createMemoryAnnotationTable() })
}
