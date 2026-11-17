/**
 * 草稿的身份与存储边界：键是 `sha1(sessionId + '\0' + 规范绝对路径)` 的十六进制串。
 * `per-record` JSON 后端只接受 `[A-Za-z0-9_-]` 的键，所以 sessionId 与完整路径
 * 只放在记录里；需要按会话取待发送草稿时用记录字段过滤。
 */
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

export const MAX_DRAFT_BYTES = 512 * 1024
export const MAX_DRAFTS = 20
export const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Document keys double as backend document names; hex is a safe subset. */
export const DRAFT_KEY_PATTERN = /^[a-z0-9]+$/

export type AnnotationErrorCode = 'invalid-request' | 'invalid-path' | 'unknown-session' | 'read-failed' | 'write-failed'

/** 批注存储的边界失败；由服务层映射成 Remote 错误码。 */
export class AnnotationError extends Error {
  readonly code: AnnotationErrorCode

  constructor(code: AnnotationErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'AnnotationError'
  }
}

export function requireSessionId(sessionId: unknown): string {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new AnnotationError('invalid-request', '缺少会话 id')
  }
  return sessionId
}

/**
 * 草稿只认规范绝对路径。客户端从 `readBytes` 的 `absolutePath` 取值；相对路径
 * 会随工作目录变化，不能让两份草稿抢同一个键。
 */
export function canonicalDocumentPath(path: unknown): string {
  const raw = typeof path === 'string' ? path.trim() : ''
  if (raw === '') throw new AnnotationError('invalid-request', '缺少文档路径')
  if (!isAbsolute(raw)) throw new AnnotationError('invalid-request', `文档路径必须是绝对路径：${raw}`)
  return resolve(raw)
}

/** 审阅轮次 id：短、稳定，sanitize 后仍能放进文件名。 */
export const ROUND_ID_PATTERN = /^[a-z0-9]{2,32}$/

export function requireRoundId(value: unknown): string {
  if (typeof value !== 'string' || !ROUND_ID_PATTERN.test(value)) {
    throw new AnnotationError('invalid-request', `轮次 id 不合法：${String(value)}`)
  }
  return value
}

/** 一份草稿的 domain 记录键。 */
export function draftKeyOf(sessionId: unknown, path: unknown): string {
  const session = requireSessionId(sessionId)
  const canonical = canonicalDocumentPath(path)
  return createHash('sha1').update(`${session}\u0000${canonical}`).digest('hex')
}
