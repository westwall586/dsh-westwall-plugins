/**
 * The source editor's wire vocabulary and the small pure decisions the Body
 * makes around it. No React and no DOM here: every rule in this module is a
 * table the unit tests can walk.
 */
import type { Block } from '../markdown/model.ts'

/** The Host's authority is this same number; the client only disables early. */
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

/** What the Body knows when it asks whether the editor may open. */
export interface EditGate {
  /** The latest Host answer, or null while the check is still running. */
  check: EditCheckResult | null
  /** The bytes the opener read; the client refuses over the limit before asking again. */
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

/**
 * The mutual-exclusion table: the translated view must switch back first, an
 * unsent review blocks the source from moving under it, and every Host refusal
 * keeps its own reason so the Body can say why instead of showing a dead button.
 */
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

/** The client-facing projection of one save result, one arm per wire status. */
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

/** Split one display path into its directory (with separator) and leaf. */
export function splitDisplayPath(path: string): { directory: string, leaf: string } {
  let leafStart = path.length
  while (leafStart > 0 && !isSeparator(path[leafStart - 1]!)) leafStart -= 1
  return { directory: path.slice(0, leafStart), leaf: path.slice(leafStart) }
}

/** `<stem>.conflict-<yyyyMMdd-HHmmss>[-n]<ext>`, always beside the original. */
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

/**
 * The block a source line belongs to. A blank line between blocks resolves to
 * the block above it; a line before the first or after the last block clamps to
 * that edge, so restoring a reading position always has a target.
 */
export function lineTarget(blocks: readonly Block[], line: number): Block | undefined {
  if (blocks.length === 0) return undefined
  let preceding: Block | undefined
  for (const block of blocks) {
    if (line >= block.sourceStartLine && line <= block.sourceEndLine) return block
    if (block.sourceStartLine <= line) preceding = block
  }
  return preceding ?? blocks[0]
}
