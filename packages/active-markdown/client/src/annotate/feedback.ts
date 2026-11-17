/**
 * The feedback Markdown attached to the composer. Identity is the round id and
 * the file hash, never the prose: this module only builds bytes and names.
 */
import type { Annotation } from './model.ts'

/** Round ids are short and survive file-name sanitizing unchanged. */
const ROUND_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const ROUND_LENGTH = 8
export const ROUND_ID_PATTERN = /^[a-z0-9]{2,32}$/

/** The instruction that closes every feedback file. */
export const FEEDBACK_INSTRUCTION = '请根据以上反馈修改该文件，尽量只改动相关部分。'

export interface FeedbackInput {
  roundId: string
  /** Workspace-relative display path; the Agent reads this, the host never trusts it. */
  sourcePath: string
  annotations: readonly Annotation[]
  /** Annotation ids that no longer resolve in the current source. */
  unlocatable?: ReadonlySet<string>
}

export interface FeedbackFile {
  fileName: string
  content: string
  bytes: number
}

export function newRoundId(random: () => number = Math.random): string {
  let id = ''
  for (let index = 0; index < ROUND_LENGTH; index += 1) {
    const value = Math.floor(random() * ROUND_ALPHABET.length)
    id += ROUND_ALPHABET[Math.min(ROUND_ALPHABET.length - 1, Math.max(0, value))]
  }
  return id
}

function sanitizeSegment(value: string): string {
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/u, '')
  return clean === '' || clean === '.' || clean === '..' ? 'document' : clean
}

/** Keep the whole leaf name inside what every host filesystem stores. */
function utf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0
  let prefix = ''
  for (const character of value) {
    const size = new TextEncoder().encode(character).byteLength
    if (bytes + size > maxBytes) break
    prefix += character
    bytes += size
  }
  return prefix
}

/** `<doc stem>-review-<roundId>.md`, sanitized so the round id always survives. */
export function feedbackFileName(sourcePath: string, roundId: string): string {
  const leaf = sourcePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const stem = leaf.replace(/\.(?:markdown|md)$/iu, '')
  const suffix = `-review-${roundId}.md`
  const clean = sanitizeSegment(stem)
  const room = Math.max(1, 200 - new TextEncoder().encode(suffix).byteLength)
  return `${utf8Prefix(clean, room)}${suffix}`
}

function quoteLines(text: string): string[] {
  return text.split('\n').map(line => `> ${line}`)
}

function lineLabel(annotation: Annotation): string {
  return annotation.lineStart === annotation.lineEnd
    ? `${annotation.lineStart}`
    : `${annotation.lineStart}-${annotation.lineEnd}`
}

function entryOf(annotation: Annotation, changed: boolean): string[] {
  const label = changed ? `${lineLabel(annotation)}（原文可能已变化）` : lineLabel(annotation)
  return [
    `行号：${label}`,
    '原文：',
    ...quoteLines(annotation.quote),
    '',
    '意见：',
    ...quoteLines(annotation.body),
  ]
}

/**
 * Render the whole feedback file. Unresolvable entries go last so the Agent
 * reads the ones with trustworthy anchors first.
 */
export function renderFeedback(input: FeedbackInput): string {
  const resolvable = input.annotations.filter(annotation => input.unlocatable?.has(annotation.id) !== true)
  const changed = input.annotations.filter(annotation => input.unlocatable?.has(annotation.id) === true)
  const lines = [
    '---',
    `dsh-active-markdown-review: ${input.roundId}`,
    `source: ${JSON.stringify(input.sourcePath)}`,
    '---',
    '',
    `文件路径：${input.sourcePath}`,
    '',
    '## 我的反馈',
    '',
  ]
  for (const annotation of resolvable) lines.push(...entryOf(annotation, false), '')
  for (const annotation of changed) lines.push(...entryOf(annotation, true), '')
  lines.push(FEEDBACK_INSTRUCTION, '')
  return lines.join('\n')
}

export function feedbackFileOf(input: FeedbackInput): FeedbackFile {
  const content = renderFeedback(input)
  return {
    fileName: feedbackFileName(input.sourcePath, input.roundId),
    content,
    bytes: new TextEncoder().encode(content).byteLength,
  }
}

/** Same normalization as the Host's source hash: line endings and the final newline are invisible. */
export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

async function digestHex(data: BufferSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new Error('SHA-256 is unavailable')
  const digest = await subtle.digest('SHA-256', data)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** SHA-256 hex over UTF-8 bytes, using the Web Crypto both shells ship. */
export function sha256Hex(text: string): Promise<string> {
  return digestHex(new TextEncoder().encode(text))
}

export function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return digestHex(bytes)
}

export function isRoundId(value: unknown): value is string {
  return typeof value === 'string' && ROUND_ID_PATTERN.test(value)
}
