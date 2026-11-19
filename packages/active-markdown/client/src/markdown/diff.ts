/**
 * Top-level block diff behind the "updated" markers and the table of contents.
 * Blocks are compared by a rendering-semantic key, not by source lines, so
 * re-wrapped prose, a different list marker, or another fence style is not an
 * update; text, links, images, emphasis, code, tables, and heading levels are.
 */
import type { Block, Inline, TableCell } from './model.ts'

export type DiffStatus = 'updated'

export interface DocumentDiff {
  /** One entry per top-level `after` block; undefined means unchanged. */
  statuses: readonly (DiffStatus | undefined)[]
  counts: { updated: number }
}

export interface TocEntry {
  anchor: string
  text: string
  level: number
}

/** Myers stops after this edit distance; the middle span is then all updated. */
const MAX_D = 1200

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Soft and hard breaks render as whitespace, so both join the surrounding run. */
function inlineKeys(inlines: readonly Inline[]): unknown[] {
  const keys: unknown[] = []
  let run = ''
  const flush = (): void => {
    const text = collapse(run)
    if (text !== '') keys.push(['text', text])
    run = ''
  }
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
        run += inline.text
        break
      case 'softbreak':
      case 'hardbreak':
        run += ' '
        break
      case 'code':
        flush()
        keys.push(['code', collapse(inline.text)])
        break
      case 'strong':
      case 'em':
      case 'del':
        flush()
        keys.push([inline.kind, inlineKeys(inline.children)])
        break
      case 'link':
        flush()
        keys.push(['link', inline.href, inline.title ?? '', inlineKeys(inline.children)])
        break
      case 'image':
        flush()
        keys.push(['image', inline.src, inline.title ?? '', inline.alt])
        break
    }
  }
  flush()
  return keys
}

/** Trailing whitespace is not visible; indentation and inner spacing are. */
function normalizeCode(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
}

function cellKey(cell: TableCell): unknown {
  return [inlineKeys(cell.inline), cell.align ?? null]
}

function blockKey(block: Block): string {
  switch (block.type) {
    case 'heading':
      return JSON.stringify(['heading', block.level, inlineKeys(block.inline)])
    case 'paragraph':
      return JSON.stringify(['paragraph', inlineKeys(block.inline)])
    case 'code':
      return JSON.stringify(['code', block.lang, normalizeCode(block.content)])
    case 'mermaid':
      return JSON.stringify(['mermaid', normalizeCode(block.content)])
    case 'markmap':
      return JSON.stringify(['markmap', block.lang, normalizeCode(block.content)])
    case 'table':
      return JSON.stringify(['table', block.header.map(cellKey), block.rows.map(row => row.map(cellKey))])
    case 'list':
      return JSON.stringify([
        'list',
        block.ordered,
        block.start,
        block.items.map(item => [item.task ?? '', item.blocks.map(blockKey)]),
      ])
    case 'quote':
      return JSON.stringify(['quote', block.blocks.map(blockKey)])
    case 'callout':
      return JSON.stringify(['callout', block.kind, block.title, block.blocks.map(blockKey)])
    case 'divider':
      return JSON.stringify(['divider'])
  }
}

interface Match {
  before: number
  after: number
}

/** Walk back through the Myers trace, recording the diagonal moves. */
function backtrack(trace: readonly Int32Array[], offset: number, endX: number, endY: number): Match[] {
  let x = endX
  let y = endY
  const matches: Match[] = []
  for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
    const furthest = trace[depth]
    const diagonal = x - y
    const byInsert = diagonal === -depth
      || (diagonal !== depth && furthest[offset + diagonal - 1] < furthest[offset + diagonal + 1])
    const previousDiagonal = byInsert ? diagonal + 1 : diagonal - 1
    const previousX = furthest[offset + previousDiagonal]
    const previousY = previousX - previousDiagonal
    while (x > previousX && y > previousY) {
      matches.push({ before: x - 1, after: y - 1 })
      x -= 1
      y -= 1
    }
    x = previousX
    y = previousY
  }
  return matches.reverse()
}

/** Myers' O(ND) match set, or null once the distance passes `limit`. */
function myersMatches(before: readonly string[], after: readonly string[], limit: number): Match[] | null {
  const rows = before.length
  const columns = after.length
  if (rows === 0 || columns === 0) return []
  const budget = Math.min(limit, rows + columns)
  const offset = budget + 1
  const furthest = new Int32Array(2 * budget + 3).fill(-1)
  furthest[offset + 1] = 0
  const trace: Int32Array[] = []
  for (let depth = 0; depth <= budget; depth += 1) {
    trace.push(furthest.slice())
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const insert = diagonal === -depth
        || (diagonal !== depth && furthest[offset + diagonal - 1] < furthest[offset + diagonal + 1])
      let x = insert ? furthest[offset + diagonal + 1] : furthest[offset + diagonal - 1] + 1
      if (x < 0) x = 0
      let y = x - diagonal
      while (x < rows && y < columns && before[x] === after[y]) {
        x += 1
        y += 1
      }
      furthest[offset + diagonal] = x
      if (x >= rows && y >= columns) return backtrack(trace, offset, x, y)
    }
  }
  return null
}

/**
 * Diff the top-level blocks. Unmatched new blocks are `updated`; unmatched old
 * blocks are deleted and ignored; an unmatched new key that still occurs among
 * the unmatched old blocks is a move and consumes one occurrence. No added /
 * modified distinction.
 */
export function diffBlocks(before: readonly Block[], after: readonly Block[]): DocumentDiff {
  const beforeKeys = before.map(blockKey)
  const afterKeys = after.map(blockKey)
  const statuses: (DiffStatus | undefined)[] = new Array(after.length).fill(undefined)

  let start = 0
  while (start < beforeKeys.length && start < afterKeys.length && beforeKeys[start] === afterKeys[start]) {
    start += 1
  }
  let beforeEnd = beforeKeys.length
  let afterEnd = afterKeys.length
  while (
    beforeEnd > start
    && afterEnd > start
    && beforeKeys[beforeEnd - 1] === afterKeys[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  const oldKeys = beforeKeys.slice(start, beforeEnd)
  const newKeys = afterKeys.slice(start, afterEnd)
  let updated = 0
  const mark = (index: number): void => {
    statuses[start + index] = 'updated'
    updated += 1
  }

  const matches = myersMatches(oldKeys, newKeys, MAX_D)
  if (matches === null) {
    for (let index = 0; index < newKeys.length; index += 1) mark(index)
    return { statuses, counts: { updated } }
  }

  const matchedBefore = new Set(matches.map(match => match.before))
  const matchedAfter = new Set(matches.map(match => match.after))
  const moves = new Map<string, number>()
  for (let index = 0; index < oldKeys.length; index += 1) {
    if (matchedBefore.has(index)) continue
    const key = oldKeys[index]
    moves.set(key, (moves.get(key) ?? 0) + 1)
  }
  for (let index = 0; index < newKeys.length; index += 1) {
    if (matchedAfter.has(index)) continue
    const key = newKeys[index]
    const remaining = moves.get(key) ?? 0
    if (remaining > 0) moves.set(key, remaining - 1)
    else mark(index)
  }
  return { statuses, counts: { updated } }
}

/**
 * The heading anchor each updated block belongs to, one entry per updated
 * block. A heading marks itself; body blocks mark the nearest open heading;
 * blocks before the first heading have no section.
 */
export function updatedSections(
  blocks: readonly Block[],
  statuses: readonly (DiffStatus | undefined)[],
): readonly string[] {
  const sections: string[] = []
  const headings: { level: number, anchor: string }[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.type === 'heading') {
      while (headings.length > 0 && headings[headings.length - 1].level >= block.level) headings.pop()
      headings.push({ level: block.level, anchor: block.anchor })
      if (statuses[index] === 'updated') sections.push(block.anchor)
      continue
    }
    if (statuses[index] !== 'updated') continue
    const heading = headings[headings.length - 1]
    if (heading !== undefined) sections.push(heading.anchor)
  }
  return sections
}

/** H1-H6 headings in document order, for the minimal table of contents. */
export function tocEntries(blocks: readonly Block[]): readonly TocEntry[] {
  return blocks.flatMap((block) => block.type === 'heading'
    ? [{ anchor: block.anchor, text: block.text, level: block.level }]
    : [])
}
