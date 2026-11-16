/**
 * 自动缓存：一次成功翻译的整篇译文按内容身份存进插件存储，读者看不到它。
 * 键含源 hash、语言、实际用到的 provider/model、提示词版本与补充要求 hash；
 * 任何一项不同都是一次新翻译，绝不拿旧结果冒充。缓存在一次会话结束后仍可
 * 复用，删掉它最多是重翻一次，所以落盘失败只警告、不打断翻译。
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { cacheKeyOf, extraInstructionHash, normalizeSource, sha256Hex } from './digest.ts'
import { errorText, requireLanguage, requireText } from './boundary.ts'
import { resolveModel, type ModelSelection } from './request.ts'

/** 单条缓存记录的上限；更大的译文不缓存，避免插件存储无界增长。 */
export const CACHE_VALUE_MAX_BYTES = 64 * 1024

const cachedMetaSchema = z.object({
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceLines: z.number().int().nonnegative(),
  translatedLines: z.number().int().nonnegative(),
  lang: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string(),
  extraInstructionHash: z.string(),
  aligned: z.boolean(),
  cachedAt: z.string(),
}).strict()

const cachedTranslationSchema = z.object({
  text: z.string(),
  meta: cachedMetaSchema,
}).strict()

export interface CachedMeta {
  readonly sourceHash: string
  readonly sourceLines: number
  readonly translatedLines: number
  readonly lang: string
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  readonly extraInstructionHash: string
  readonly aligned: boolean
  readonly cachedAt: string
}

export interface CachedTranslation {
  readonly text: string
  readonly meta: CachedMeta
}

export interface CacheGetInput {
  readonly text: string
  readonly lang: string
  readonly provider?: string
  readonly model?: string
  readonly promptVersion: string
  readonly extraInstruction?: string
}

export interface CachePutInput extends CacheGetInput {
  readonly translated: string
  readonly aligned: boolean
  readonly sourceLines: number
  readonly translatedLines: number
}

/** 空对象是 wire 上的成功回执；超限与写失败都返回它，不打断翻译。 */
export type CachePutView = Record<string, never>

/** 一块同步读、异步写的键值表；插件存储的 domain table 就是这个形状。 */
export interface CacheTable {
  get(key: string): CachedTranslation | undefined
  put(key: string, value: CachedTranslation): Promise<void>
}

export interface CacheDomain {
  table(name: 'translations'): CacheTable
}

export interface StorageDomainFacility {
  open(spec: typeof translationCacheDomain): Promise<CacheDomain>
}

export const translationCacheDomain = defineDomain({
  name: 'active_markdown',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    translations: domainTable<string, CachedTranslation>(cachedTranslationSchema),
  },
})

export interface CacheStore {
  get(key: string): CachedTranslation | undefined
  put(key: string, value: CachedTranslation): Promise<void>
}

export interface CacheDeps {
  readonly store: CacheStore
  readonly readDefault: () => ModelSelection | null
  readonly now?: () => Date
}

export interface TranslationCache {
  cacheGet(input: CacheGetInput): Promise<CachedTranslation | null>
  cachePut(input: CachePutInput): Promise<CachePutView>
}

/** 进程内回落；没有插件存储时，本次运行内仍可命中。 */
export function createMemoryCacheStore(): CacheStore {
  const records = new Map<string, CachedTranslation>()
  return {
    get: (key) => records.get(key),
    async put(key, value) {
      records.set(key, value)
    },
  }
}

/**
 * 打开插件存储里的缓存 domain。`storageDomain` 不在（或 domain 打不开）时退回
 * 内存，翻译本身不受影响；domain 的生命周期由 facility 在插件卸载时收尾。
 */
export async function openCacheStore(facility: StorageDomainFacility | null): Promise<CacheStore> {
  if (facility === null) return createMemoryCacheStore()
  try {
    const domain = await facility.open(translationCacheDomain)
    const table = domain.table('translations')
    return {
      get: (key) => table.get(key),
      put: (key, value) => table.put(key, value),
    }
  } catch (error) {
    console.warn('[dsh-active-markdown] 翻译缓存 domain 打不开，本次运行改用内存缓存', error)
    return createMemoryCacheStore()
  }
}

interface CacheRequest {
  readonly text: string
  readonly lang: string
  readonly provider?: string
  readonly model?: string
  readonly promptVersion: string
  readonly extraInstruction?: string
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function encodedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function parseInput(input: CacheGetInput): CacheRequest {
  const provider = textField(input.provider).trim()
  const model = textField(input.model).trim()
  const extraInstruction = textField(input.extraInstruction).trim()
  return {
    text: requireText(input.text, '原文'),
    lang: requireLanguage(input.lang),
    ...(provider === '' ? {} : { provider }),
    ...(model === '' ? {} : { model }),
    promptVersion: textField(input.promptVersion),
    ...(extraInstruction === '' ? {} : { extraInstruction }),
  }
}

function resolveSelection(request: CacheRequest, readDefault: () => ModelSelection | null): ModelSelection {
  return resolveModel({
    ...(request.provider === undefined ? {} : { provider: request.provider }),
    ...(request.model === undefined ? {} : { model: request.model }),
    readDefault,
  })
}

function keyFor(request: CacheRequest, selection: ModelSelection): string {
  return cacheKeyOf({
    sourceText: request.text,
    lang: request.lang,
    provider: selection.provider,
    model: selection.model,
    promptVersion: request.promptVersion,
    ...(request.extraInstruction === undefined ? {} : { extraInstruction: request.extraInstruction }),
  })
}

export function createTranslationCache(deps: CacheDeps): TranslationCache {
  const now = deps.now ?? (() => new Date())

  return {
    async cacheGet(input) {
      const request = parseInput(input)
      const selection = resolveSelection(request, deps.readDefault)
      const record = deps.store.get(keyFor(request, selection))
      if (record === undefined) return null
      return encodedBytes(record) > CACHE_VALUE_MAX_BYTES ? null : record
    },

    async cachePut(input) {
      const request = parseInput(input)
      const translated = requireText(input.translated, '译文')
      const selection = resolveSelection(request, deps.readDefault)
      const record: CachedTranslation = {
        text: translated,
        meta: {
          sourceHash: sha256Hex(normalizeSource(request.text)),
          sourceLines: integer(input.sourceLines),
          translatedLines: integer(input.translatedLines),
          lang: request.lang,
          provider: selection.provider,
          model: selection.model,
          promptVersion: request.promptVersion,
          extraInstructionHash: extraInstructionHash(request.extraInstruction),
          aligned: input.aligned === true,
          cachedAt: now().toISOString(),
        },
      }
      if (encodedBytes(record) > CACHE_VALUE_MAX_BYTES) return {}
      try {
        await deps.store.put(keyFor(request, selection), record)
      } catch (error) {
        console.warn('[dsh-active-markdown] 写翻译缓存失败，本次结果仍可用', errorText(error))
      }
      return {}
    },
  }
}
