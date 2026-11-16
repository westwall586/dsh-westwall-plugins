/**
 * 插件设置：翻译模型、目标语言代码、代码注释策略。三项都是 volatile，插件页
 * 写入后不必重启服务；`configSnapshot` 每次调用都重新读，所以下一次翻译立即
 * 使用新值。模型为 null 表示跟随会话默认模型。
 */
import z from '@deepseek-ai/schemastery'
import { DEFAULT_LANGUAGE, isLanguageCode } from './translate/language.ts'
import type { ModelSelection } from './translate/request.ts'

// The inferred builder type names a cosmokit helper, which the package does not
// depend on directly. `unknown` keeps the emitted declaration portable; the
// loader uses the runtime schema, and `configSnapshot` is the typed read.
export const Config: unknown = z.object({
  model: z.union([
    z.object({
      provider: z.string().required(),
      model: z.string().required(),
    }),
    z.const(null),
  ]).default(null).volatile(),
  lang: z.union([z.const('zh'), z.const('zh-Hant'), z.const('en')]).default(DEFAULT_LANGUAGE).volatile(),
  translateComments: z.boolean().default(true).volatile(),
})

export interface ActiveMarkdownConfig {
  readonly model: ModelSelection | null
  readonly lang: string
  readonly translateComments: boolean
}

function deref(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { get?: unknown }
    if (typeof candidate.get === 'function') return (candidate.get as () => unknown)()
  }
  return value
}

function recordOf(value: unknown): Record<string, unknown> | null {
  const node = deref(value)
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null
  return node as Record<string, unknown>
}

function modelOf(value: unknown): ModelSelection | null {
  const node = recordOf(value)
  if (node === null) return null
  const provider = deref(node.provider)
  const model = deref(node.model)
  if (typeof provider !== 'string' || provider === '') return null
  if (typeof model !== 'string' || model === '') return null
  return { provider, model }
}

/** 解析后的设置；缺失或损坏的字段回落到产品默认值。 */
export function configSnapshot(raw: unknown): ActiveMarkdownConfig {
  const source = recordOf(raw) ?? {}
  const lang = deref(source.lang)
  const translateComments = deref(source.translateComments)
  return {
    model: modelOf(source.model),
    lang: isLanguageCode(lang) ? lang : DEFAULT_LANGUAGE,
    translateComments: typeof translateComments === 'boolean' ? translateComments : true,
  }
}
