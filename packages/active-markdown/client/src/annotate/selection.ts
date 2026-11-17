/**
 * 选区原子与锚点恢复。渲染器按源行产出 `[data-line]` 元素，每个元素就是一行
 * 文本的原子；选区边界落在原子上，跨行时用 `\n` 拼接，列表、引用与软换行
 * 都不会把偏移算歪。恢复只认精确偏移、唯一搜索，绝不把批注糊到相近文本上。
 */
import type { Block, Inline } from '../markdown/model.ts'
import { splitSourceLines } from '../markdown/lines.ts'
import type { Anchor } from './model.ts'

export interface TextLineAtom {
  /** 1-based，相对整份源文件。 */
  line: number
  blockId: string
  /** 这一行渲染出的纯文本投影。 */
  text: string
  /** 捕获时所在块的标题路径，抽屉按它分组。 */
  section: string
}

export interface ComponentRange {
  blockId: string
  lineStart: number
  lineEnd: number
}

/** 选区边界：第几个 line atom 里的第几个 UTF-16 单元。 */
export interface LinePoint {
  atom: number
  offset: number
}

export interface JoinedLines {
  text: string
  /** `starts[atom]` 是这一行在拼接串里的起点。 */
  starts: number[]
}

export type AnchorLocation =
  | { status: 'located', startOffset: number, endOffset: number }
  | { status: 'unlocatable' }

/** 行文本的投影要和 DOM 的 textContent 对齐：图片只贡献 alt 属性，不是文本。 */
function projectInline(inlines: readonly Inline[]): string {
  let text = ''
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text':
      case 'code':
        text += inline.text
        break
      case 'softbreak':
      case 'hardbreak':
      case 'image':
        break
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        text += projectInline(inline.children)
        break
    }
  }
  return text
}

function walkBlocks(blocks: readonly Block[], visit: (block: Block) => void): void {
  for (const block of blocks) {
    visit(block)
    if (block.type === 'list') {
      for (const item of block.items) walkBlocks(item.blocks, visit)
    } else if (block.type === 'quote') {
      walkBlocks(block.blocks, visit)
    }
  }
}

/**
 * Collect one atom per rendered text line, in document order.
 * @param blocks - the parsed block tree.
 * @returns heading and paragraph lines only; components contribute no atom.
 */
export function collectLineAtoms(blocks: readonly Block[]): TextLineAtom[] {
  const atoms: TextLineAtom[] = []
  const sectionOf = (block: Block): string => block.headingPath.join(' / ')
  walkBlocks(blocks, (block) => {
    if (block.type !== 'heading' && block.type !== 'paragraph') return
    const section = sectionOf(block)
    for (const line of splitSourceLines(block.inline, block.sourceStartLine)) {
      atoms.push({ line: line.line, blockId: block.id, text: projectInline(line.inline), section })
    }
  })
  return atoms
}

/** 表格与代码块占用的源行区间；文本选区跨到它们就拒绝。 */
export function collectComponentRanges(blocks: readonly Block[]): ComponentRange[] {
  const ranges: ComponentRange[] = []
  walkBlocks(blocks, (block) => {
    if (block.type !== 'code' && block.type !== 'table') return
    ranges.push({ blockId: block.id, lineStart: block.sourceStartLine, lineEnd: block.sourceEndLine })
  })
  return ranges
}

export function joinLineAtoms(atoms: readonly TextLineAtom[]): JoinedLines {
  const starts: number[] = []
  let text = ''
  for (const [index, atom] of atoms.entries()) {
    starts.push(text.length)
    text += atom.text
    if (index < atoms.length - 1) text += '\n'
  }
  return { text, starts }
}

/** Find the atom a rendered line element belongs to. */
export function atomIndexAt(atoms: readonly TextLineAtom[], line: number, blockId: string): number | undefined {
  const index = atoms.findIndex(atom => atom.line === line && atom.blockId === blockId)
  return index === -1 ? undefined : index
}

function overlapsComponent(lineStart: number, lineEnd: number, components: readonly ComponentRange[]): boolean {
  return components.some(component => component.lineStart <= lineEnd && lineStart <= component.lineEnd)
}

/**
 * Capture an anchor from two line points.
 * @param atoms - the document's line atoms.
 * @param start - selection start.
 * @param end - selection end.
 * @param components - component line ranges, so a selection crossing one is refused.
 * @returns the anchor, or null for an empty selection or one that crosses a component.
 */
export function captureAnchor(
  atoms: readonly TextLineAtom[],
  start: LinePoint,
  end: LinePoint,
  components: readonly ComponentRange[] = [],
): Anchor | null {
  const startAtom = atoms[start.atom]
  const endAtom = atoms[end.atom]
  if (startAtom === undefined || endAtom === undefined) return null
  const { text, starts } = joinLineAtoms(atoms)
  const startOffset = starts[start.atom]! + Math.max(0, Math.min(start.offset, startAtom.text.length))
  const endOffset = starts[end.atom]! + Math.max(0, Math.min(end.offset, endAtom.text.length))
  if (endOffset <= startOffset) return null
  if (overlapsComponent(startAtom.line, endAtom.line, components)) return null

  const raw = text.slice(startOffset, endOffset)
  const lead = raw.length - raw.trimStart().length
  const trail = raw.length - raw.trimEnd().length
  const trimmed = raw.slice(lead, raw.length - trail)
  if (trimmed === '') return null
  const from = startOffset + lead
  const to = endOffset - trail
  return {
    quote: trimmed,
    prefix: text.slice(Math.max(0, from - 32), from),
    suffix: text.slice(to, to + 32),
    startOffset: from,
    blockStartId: startAtom.blockId,
    blockEndId: endAtom.blockId,
    blockSignature: '',
    section: startAtom.section,
    lineStart: startAtom.line,
    lineEnd: endAtom.line,
  }
}

function prefixMatches(text: string, annotation: Anchor): boolean {
  const from = annotation.startOffset - annotation.prefix.length
  return from >= 0 && text.slice(from, annotation.startOffset) === annotation.prefix
}

function suffixMatches(text: string, annotation: Anchor): boolean {
  const to = annotation.startOffset + annotation.quote.length
  return text.slice(to, to + annotation.suffix.length) === annotation.suffix
}

/**
 * Locate an annotation against the current text: exact offset first, then a
 * unique `prefix + quote + suffix` search. Zero or several matches are
 * unlocatable, never a nearby block.
 * @param annotation - the stored anchor.
 * @param lines - the current document's joined line atoms.
 * @returns where it lands now, or that it cannot be placed.
 */
export function locateAnchor(annotation: Anchor, lines: JoinedLines): AnchorLocation {
  const { text } = lines
  const endOffset = annotation.startOffset + annotation.quote.length
  if (
    annotation.startOffset >= 0
    && text.slice(annotation.startOffset, endOffset) === annotation.quote
    && prefixMatches(text, annotation)
    && suffixMatches(text, annotation)
  ) {
    return { status: 'located', startOffset: annotation.startOffset, endOffset }
  }

  const needle = annotation.prefix + annotation.quote + annotation.suffix
  let found = -1
  let count = 0
  let from = 0
  while (from <= text.length) {
    const index = text.indexOf(needle, from)
    if (index === -1) break
    count += 1
    found = index
    if (count > 1) break
    from = index + 1
  }
  if (count !== 1) return { status: 'unlocatable' }
  const start = found + annotation.prefix.length
  return { status: 'located', startOffset: start, endOffset: start + annotation.quote.length }
}
