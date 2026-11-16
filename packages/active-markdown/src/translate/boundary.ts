/**
 * 缓存与保存方法的边界守卫。`translate` 的校验仍留在 request.ts 不动；这里只加
 * 新写盘方法共用的三条：原文/译文非空且不超 2 MiB、目标语言可安全用作文件名
 * 片段、会话标识非空。
 */
import { MAX_TEXT_BYTES, TranslateError } from './request.ts'

export function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TranslateError('invalid-text', `${what}为空`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
    throw new TranslateError('text-too-large', `${what}超过 ${MAX_TEXT_BYTES / 1024 / 1024} MiB`)
  }
  return value
}

const UNSAFE_SEGMENT = /[\\/\u0000-\u001f]/

export function requireLanguage(value: unknown): string {
  const lang = typeof value === 'string' ? value.trim() : ''
  if (lang === '') throw new TranslateError('invalid-language', '缺少目标语言')
  if (lang === '.' || lang === '..' || UNSAFE_SEGMENT.test(lang)) {
    throw new TranslateError('invalid-language', `目标语言不能用作文件名：${lang}`)
  }
  return lang
}

export function requireSessionId(value: unknown): string {
  const sessionId = typeof value === 'string' ? value.trim() : ''
  if (sessionId === '') throw new TranslateError('invalid-session', '缺少会话标识')
  return sessionId
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
