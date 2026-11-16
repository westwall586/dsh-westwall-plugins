/** Split a document into sequential translation chunks at block boundaries. */
import type { Block } from '../markdown/model.ts'

/** One request's line budget; calibrated once P1 measures the model's drift. */
export const LINE_CAP = 2000
/** One request's character budget, for the table-shaped and paragraph-shaped document alike. */
export const CHAR_CAP = 100000
/** Past this the document is refused outright instead of chunked. */
export const HARD_LINE_CAP = 16000

/** Half-open, 0-based indices into `normalize(text).split('\n')`. */
export interface LineRange {
  start: number
  end: number
}

/** One ordered plan for the whole document, or the refusal that carries its real size. */
export type ChunkPlan =
  | { kind: 'plan', ranges: readonly LineRange[] }
  | { kind: 'too-large', lineCount: number }

/** Line endings and one trailing newline are invisible to the checks, so they are invisible here. */
export function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

/** The line count both validation checks compare. */
export function countLines(text: string): number {
  return normalize(text).split('\n').length
}

/** A line where a chunk may start; a heading at level 3 or shallower is preferred over any block. */
interface Cut {
  line: number
  rank: number
}

/** Level 1..3 headings rank first, shallowest first; every other top-level block start ties at 4. */
const FALLBACK_RANK = 4

function cutsOf(blocks: readonly Block[], lineCount: number): Cut[] {
  const cuts: Cut[] = []
  for (const block of blocks) {
    const line = block.sourceStartLine - 1
    if (line <= 0 || line >= lineCount) continue
    const rank = block.type === 'heading' && block.level <= 3 ? block.level : FALLBACK_RANK
    cuts.push({ line, rank })
  }
  return cuts.sort((left, right) => left.line - right.line)
}

/**
 * Plan how to translate one document without exceeding a single request's budget.
 * @param text - the whole source file.
 * @param blocks - the top-level blocks of `parseDocument(text)`.
 * @returns ordered contiguous line ranges, or a refusal when the document is past the hard cap.
 */
export function planTranslation(text: string, blocks: readonly Block[]): ChunkPlan {
  const normalized = normalize(text)
  const lines = normalized.split('\n')
  const lineCount = lines.length
  if (lineCount > HARD_LINE_CAP) return { kind: 'too-large', lineCount }
  if (lineCount <= LINE_CAP && normalized.length <= CHAR_CAP) return { kind: 'plan', ranges: [{ start: 0, end: lineCount }] }

  // Prefix sums of line length plus its newline, so a chunk's character count is O(1).
  const prefix: number[] = [0]
  for (const line of lines) prefix.push(prefix[prefix.length - 1] + line.length + 1)
  const charsBetween = (start: number, end: number): number => prefix[end] - prefix[start] - 1

  const cuts = cutsOf(blocks, lineCount)
  const ranges: LineRange[] = []
  let start = 0
  while (start < lineCount) {
    // The tail has no candidate past its last block, so close it here when it fits.
    if (lineCount - start <= LINE_CAP && charsBetween(start, lineCount) <= CHAR_CAP) {
      ranges.push({ start, end: lineCount })
      break
    }
    let best = -1
    let bestRank = Number.POSITIVE_INFINITY
    for (const cut of cuts) {
      if (cut.line <= start) continue
      // Both budgets only grow as the cut moves down, so the first miss ends the window.
      if (cut.line - start > LINE_CAP || charsBetween(start, cut.line) > CHAR_CAP) break
      if (cut.rank <= bestRank) {
        best = cut.line
        bestRank = cut.rank
      }
    }
    // Nothing fits, so one block is already past the budget. Cutting inside it is worse than
    // sending one oversized request, so take the nearest block boundary and keep moving.
    if (best < 0) best = cuts.find(cut => cut.line > start)?.line ?? lineCount
    ranges.push({ start, end: best })
    start = best
  }
  return { kind: 'plan', ranges }
}

/**
 * Put the translated chunks back into one document, keeping the source's line count.
 * @param ranges - the plan's ranges, in order.
 * @param sourceLines - `normalize(text).split('\n')` of the source document.
 * @param replies - one translated reply per range, in the same order.
 * @returns the whole translated document.
 */
export function assembleTranslation(
  ranges: readonly LineRange[],
  sourceLines: readonly string[],
  replies: readonly string[],
): string {
  const assembled: string[] = []
  for (const [index, range] of ranges.entries()) {
    const source = sourceLines.slice(range.start, range.end)
    // The model trims blank lines at a fragment's edges, so blanks are restored from the
    // source instead of trusted to the reply. What it does to the content lines still shows up.
    const lead = leadingBlanks(source)
    const trail = trailingBlanks(source, lead)
    const reply = stripEdgeBlanks(normalize(replies[index]).split('\n'))
    assembled.push(...source.slice(0, lead), ...reply, ...source.slice(source.length - trail))
  }
  const text = assembled.join('\n')
  // A source whose last line is blank normalises one newline away; keep it so the counts match.
  return sourceLines[sourceLines.length - 1] === '' ? `${text}\n` : text
}

function leadingBlanks(lines: readonly string[]): number {
  let count = 0
  while (count < lines.length && lines[count].trim() === '') count += 1
  return count
}

function trailingBlanks(lines: readonly string[], lead: number): number {
  let count = 0
  while (count < lines.length - lead && lines[lines.length - 1 - count].trim() === '') count += 1
  return count
}

function stripEdgeBlanks(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end)
}
