/**
 * 缓存与保存共用的内容身份：源文本按 client 的口径归一化后取 SHA-256，再拼出
 * 缓存键。行尾与末尾换行对校验不可见，对 hash 也必须不可见，否则同一份源文件
 * 会算出两个键，缓存和过期判断都会假失手。
 */
import { createHash } from 'node:crypto'

export function normalizeSource(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

export function countSourceLines(text: string): number {
  return normalizeSource(text).split('\n').length
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function sha1Hex(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/** 空串表示「没有补充要求」，这样普通结果永远不会回答一次特调查询。 */
export function extraInstructionHash(extraInstruction: string | undefined): string {
  const text = typeof extraInstruction === 'string' ? extraInstruction.trim() : ''
  return text === '' ? '' : sha256Hex(text)
}

export interface CacheKeyInput {
  readonly sourceText: string
  readonly lang: string
  readonly provider: string
  readonly model: string
  readonly promptVersion: string
  /** Comments on and comments off produce different translations, so they never share a key. */
  readonly translateComments: boolean
  readonly extraInstruction?: string
}

export function cacheKeyOf(input: CacheKeyInput): string {
  return [
    sha256Hex(normalizeSource(input.sourceText)),
    input.lang,
    input.provider,
    input.model,
    input.promptVersion,
    input.translateComments ? 'comments' : 'plain-code',
    extraInstructionHash(input.extraInstruction),
  ].join(':')
}
