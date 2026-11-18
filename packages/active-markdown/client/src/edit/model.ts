import type { Block } from '../markdown/model.ts'

export const MAX_EDIT_BYTES = 1024 * 1024

export type EditMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type EditUnsupportedReason = 'session' | 'symlink' | 'not-file' | 'fs'

export type WriteIntent =
  | { kind: 'replace', version: string }
  | { kind: 'overwrite' }
  | { kind: 'create' }

export interface WriteTextRequest {
  sessionId: string
  path: string
  text: string
  intent: WriteIntent
}

export type WriteTextResult =
  | { status: 'saved', absolutePath: string, version: string, bytes: number }
  | { status: 'stale' }
  | { status: 'exists', absolutePath: string }
  | { status: 'denied', mode: EditMode }
  | { status: 'too-large', limit: number }
  | { status: 'unsupported', reason: EditUnsupportedReason }

export interface EditCheckRequest {
  sessionId: string
  path: string
  bytes: number
}

export type EditCheckResult =
  | { status: 'ok', absolutePath: string, version: string }
  | { status: 'outside' }
  | { status: 'read-only', mode: 'read-only' }
  | { status: 'too-large', limit: number }
  | { status: 'unsupported', reason: EditUnsupportedReason }

/** Line endings differ between the reader and CodeMirror; a final newline is content. */
export function sameText(a: string, b: string): boolean {
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
}

export interface EditGate {
  check: EditCheckResult | null
  bytes: number
}

export type EditRefusal =
  | 'translated'
  | 'pending'
  | 'unchecked'
  | 'outside'
  | 'read-only'
  | 'too-large'
  | 'unsupported'

export type EditEntry = { ok: true } | { ok: false, reason: EditRefusal }

export function canEnterEdit(input: { view: 'source' | 'translated', pending: number, gate: EditGate }): EditEntry {
  if (input.view === 'translated') return { ok: false, reason: 'translated' }
  if (input.pending > 0) return { ok: false, reason: 'pending' }
  if (input.gate.check === null) return { ok: false, reason: 'unchecked' }
  switch (input.gate.check.status) {
    case 'outside': return { ok: false, reason: 'outside' }
    case 'read-only': return { ok: false, reason: 'read-only' }
    case 'too-large': return { ok: false, reason: 'too-large' }
    case 'unsupported': return { ok: false, reason: 'unsupported' }
    case 'ok':
      return input.gate.bytes > MAX_EDIT_BYTES ? { ok: false, reason: 'too-large' } : { ok: true }
  }
}

export type SaveOutcome =
  | { kind: 'saved', absolutePath: string, version: string, bytes: number }
  | { kind: 'stale' }
  | { kind: 'exists', absolutePath: string }
  | { kind: 'denied', mode: EditMode }
  | { kind: 'too-large', limit: number }
  | { kind: 'unsupported', reason: EditUnsupportedReason }

export function saveOutcomeOf(result: WriteTextResult): SaveOutcome {
  switch (result.status) {
    case 'saved':
      return { kind: 'saved', absolutePath: result.absolutePath, version: result.version, bytes: result.bytes }
    case 'stale':
      return { kind: 'stale' }
    case 'exists':
      return { kind: 'exists', absolutePath: result.absolutePath }
    case 'denied':
      return { kind: 'denied', mode: result.mode }
    case 'too-large':
      return { kind: 'too-large', limit: result.limit }
    case 'unsupported':
      return { kind: 'unsupported', reason: result.reason }
  }
}

function isSeparator(character: string): boolean {
  return character === '/' || character === '\\'
}

export function splitDisplayPath(path: string): { directory: string, leaf: string } {
  let leafStart = path.length
  while (leafStart > 0 && !isSeparator(path[leafStart - 1]!)) leafStart -= 1
  return { directory: path.slice(0, leafStart), leaf: path.slice(leafStart) }
}

export function conflictFileName(absolutePath: string, stamp: Date, taken: ReadonlySet<string>): string {
  const { directory, leaf } = splitDisplayPath(absolutePath)
  const dot = leaf.lastIndexOf('.')
  const hasExtension = dot > 0
  const stem = hasExtension ? leaf.slice(0, dot) : leaf
  const extension = hasExtension ? leaf.slice(dot) : ''
  const tag = [
    String(stamp.getFullYear()).padStart(4, '0'),
    String(stamp.getMonth() + 1).padStart(2, '0'),
    String(stamp.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(stamp.getHours()).padStart(2, '0'),
    String(stamp.getMinutes()).padStart(2, '0'),
    String(stamp.getSeconds()).padStart(2, '0'),
  ].join('')
  for (let copy = 1; copy <= 999; copy += 1) {
    const suffix = copy === 1 ? '' : `-${copy}`
    const candidate = `${directory}${stem}.conflict-${tag}${suffix}${extension}`
    if (!taken.has(candidate)) return candidate
  }
  return `${directory}${stem}.conflict-${tag}-999${extension}`
}

export function lineTarget(blocks: readonly Block[], line: number): Block | undefined {
  if (blocks.length === 0) return undefined
  let preceding: Block | undefined
  for (const block of blocks) {
    if (line >= block.sourceStartLine && line <= block.sourceEndLine) return block
    if (block.sourceStartLine <= line) preceding = block
  }
  return preceding ?? blocks[0]
}
