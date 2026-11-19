/** The block tree: source lines, ids, heading paths, and plain text for every block. */
import {
  blockText, hashText, inlineText, slugify,
  type Block, type CalloutBlock, type CodeBlock, type DividerBlock, type HeadingBlock, type ListBlock,
  type ListItem, type ParagraphBlock, type QuoteBlock, type TableBlock, type TableCell,
} from './model.ts'
import { resolveCallout, type CalloutType } from './callout.ts'
import { inlineOf, parseMarkdown, splitFrontmatter, type Frontmatter, type Token } from './parse.ts'

/** A whole parsed document, front matter included. */
export interface ParsedDocument {
  frontmatter?: Frontmatter
  blocks: Block[]
}

interface BuildContext {
  lineOffset: number
  headingPath: string[]
  counters: Map<string, number>
  anchors: Set<string>
}

/**
 * Parse one Markdown source into the block tree P0 renders.
 * @param text - the whole source file.
 * @returns front matter and top-level blocks.
 */
export function parseDocument(text: string): ParsedDocument {
  const split = splitFrontmatter(text)
  const tokens = parseMarkdown(split.body)
  const context: BuildContext = {
    lineOffset: split.lineOffset,
    headingPath: [],
    counters: new Map(),
    anchors: new Set(),
  }
  return { frontmatter: split.frontmatter, blocks: buildBlocks(tokens, 0, tokens.length, context, true) }
}

/** 1-based inclusive source lines of one token. */
function linesOf(token: Token, context: BuildContext): { sourceStartLine: number, sourceEndLine: number } {
  const from = token.map?.[0] ?? 0
  const to = token.map?.[1] ?? from + 1
  return { sourceStartLine: from + 1 + context.lineOffset, sourceEndLine: to + context.lineOffset }
}

/** A per-type unique id: type, text hash, occurrence. */
function makeId(context: BuildContext, type: string, text: string): string {
  const count = (context.counters.get(type) ?? 0) + 1
  context.counters.set(type, count)
  return `${type}-${hashText(text)}-${count}`
}

/** One deduplicated fragment id per heading text. */
function makeAnchor(context: BuildContext, text: string): string {
  const base = slugify(text)
  let anchor = base
  let suffix = 2
  while (context.anchors.has(anchor)) {
    anchor = `${base}-${suffix}`
    suffix += 1
  }
  context.anchors.add(anchor)
  return anchor
}

/** Index of the token closing the one at `open`, counting nesting. */
function matching(tokens: readonly Token[], open: number, openType: string, closeType: string): number {
  let depth = 0
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index].type === openType) depth += 1
    else if (tokens[index].type === closeType) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return tokens.length
}

/** Token after `open` when it is the inline payload. */
function inlineAfter(tokens: readonly Token[], open: number): Token[] | null | undefined {
  const next = tokens[open + 1]
  return next?.type === 'inline' ? next.children : undefined
}

/** `[!type] title`, anchored to the start of the quote's opening line. */
const CALLOUT_MARKER = /^\[!([A-Za-z][A-Za-z0-9-]*)\](.*)$/

/** Read the callout marker from the opening paragraph of one quote; undefined for a plain quote. */
function calloutHeadOf(tokens: readonly Token[], open: number): { type: CalloutType, title: string } | undefined {
  if (tokens[open + 1]?.type !== 'paragraph_open') return undefined
  const inline = tokens[open + 2]
  if (inline?.type !== 'inline') return undefined
  const firstLine = inline.content.split('\n', 1)[0] ?? ''
  const match = CALLOUT_MARKER.exec(firstLine)
  if (match === null) return undefined
  const rest: string = match[2]
  // Obsidian binds `-`/`+` straight to the marker to fold the block; keep those quotes.
  if (rest.startsWith('-') || rest.startsWith('+')) return undefined
  const type = resolveCallout(match[1])
  if (type === undefined) return undefined
  return { type, title: rest.trim() }
}

/** Shallow-copy one parser token, keeping the prototype methods `attrGet` and friends live. */
function patchToken(token: Token, patch: Partial<Token>): Token {
  return Object.assign(Object.create(Object.getPrototypeOf(token)) as Token, token, patch)
}

/** Build the callout body: the quote's blocks without the marker line. */
function calloutChildren(tokens: readonly Token[], open: number, close: number, context: BuildContext): Block[] {
  const paragraph = tokens[open + 1]
  const inline = tokens[open + 2]
  const children = inline.children ?? []
  const breakAt = children.findIndex(child => child.type === 'softbreak' || child.type === 'hardbreak')
  // A marker-only paragraph leaves the remaining blocks untouched.
  if (breakAt === -1) return buildBlocks(tokens, open + 4, close, context)
  const startLine = (paragraph.map?.[0] ?? 0) + 1
  const patched: Token[] = [
    patchToken(paragraph, { map: [startLine, paragraph.map?.[1] ?? startLine] }),
    patchToken(inline, { children: children.slice(breakAt + 1) }),
    ...tokens.slice(open + 3, close),
  ]
  return buildBlocks(patched, 0, patched.length, context)
}

/** Build the blocks of one token range, sharing id and anchor counters; callouts only at the top level. */
function buildBlocks(tokens: readonly Token[], start: number, end: number, context: BuildContext, allowCallout = false): Block[] {
  const blocks: Block[] = []
  let index = start
  while (index < end) {
    const token = tokens[index]
    switch (token.type) {
      case 'heading_open': {
        const level = Number(token.tag.slice(1))
        const inline = inlineOf(inlineAfter(tokens, index))
        const text = inlineText(inline)
        context.headingPath = [...context.headingPath.slice(0, level - 1), text]
        const block: HeadingBlock = {
          id: makeId(context, 'heading', text),
          type: 'heading',
          ...linesOf(token, context),
          headingPath: [...context.headingPath],
          text,
          level,
          anchor: makeAnchor(context, text),
          inline,
        }
        blocks.push(block)
        index += 3
        break
      }
      case 'paragraph_open': {
        const inline = inlineOf(inlineAfter(tokens, index))
        const text = inlineText(inline)
        const block: ParagraphBlock = {
          id: makeId(context, 'paragraph', text),
          type: 'paragraph',
          ...linesOf(token, context),
          headingPath: [...context.headingPath],
          text,
          inline,
          tight: token.hidden === true,
        }
        blocks.push(block)
        index += 3
        break
      }
      case 'fence':
      case 'code_block': {
        const content = token.content.replace(/\n$/, '')
        const lang = token.info.trim().split(/\s+/)[0] ?? ''
        const block: CodeBlock = {
          id: makeId(context, 'code', content),
          type: 'code',
          ...linesOf(token, context),
          headingPath: [...context.headingPath],
          text: content,
          lang,
          content,
          fence: token.type === 'fence',
        }
        blocks.push(block)
        index += 1
        break
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const list = buildList(tokens, index, context)
        blocks.push(list.block)
        index = list.next
        break
      }
      case 'blockquote_open': {
        const close = matching(tokens, index, 'blockquote_open', 'blockquote_close')
        const head = allowCallout ? calloutHeadOf(tokens, index) : undefined
        if (head !== undefined) {
          const children = calloutChildren(tokens, index, close, { ...context, headingPath: [...context.headingPath] })
          const text = [head.title, ...children.map(blockText)].filter(part => part !== '').join('\n')
          const block: CalloutBlock = {
            id: makeId(context, 'callout', text),
            type: 'callout',
            ...linesOf(token, context),
            headingPath: [...context.headingPath],
            text,
            kind: head.type.id,
            family: head.type.family,
            title: head.title,
            blocks: children,
          }
          blocks.push(block)
          index = close + 1
          break
        }
        const children = buildBlocks(tokens, index + 1, close, { ...context, headingPath: [...context.headingPath] })
        const text = children.map(blockText).join('\n')
        const block: QuoteBlock = {
          id: makeId(context, 'quote', text),
          type: 'quote',
          ...linesOf(token, context),
          headingPath: [...context.headingPath],
          text,
          blocks: children,
        }
        blocks.push(block)
        index = close + 1
        break
      }
      case 'table_open': {
        const table = buildTable(tokens, index, context)
        blocks.push(table.block)
        index = table.next
        break
      }
      case 'hr': {
        const block: DividerBlock = {
          id: makeId(context, 'divider', ''),
          type: 'divider',
          ...linesOf(token, context),
          headingPath: [...context.headingPath],
          text: '',
        }
        blocks.push(block)
        index += 1
        break
      }
      case 'html_block': {
        const inline = [{ kind: 'text' as const, text: token.content }]
        const block: ParagraphBlock = {
          id: makeId(context, 'paragraph', token.content),
          type: 'paragraph',
          ...linesOf(token, context),
          headingPath: [...context.headingPath],
          text: token.content,
          inline,
          tight: false,
        }
        blocks.push(block)
        index += 1
        break
      }
      default:
        index += 1
    }
  }
  return blocks
}

/** Build one list and its item blocks. */
function buildList(tokens: readonly Token[], open: number, context: BuildContext): { block: ListBlock, next: number } {
  const ordered = tokens[open].type === 'ordered_list_open'
  const close = matching(tokens, open, tokens[open].type, ordered ? 'ordered_list_close' : 'bullet_list_close')
  const start = ordered ? Number(tokens[open].attrGet('start') ?? '1') : 1
  const items: ListItem[] = []
  let cursor = open + 1
  while (cursor < close) {
    if (tokens[cursor].type !== 'list_item_open') {
      cursor += 1
      continue
    }
    const itemClose = matching(tokens, cursor, 'list_item_open', 'list_item_close')
    const children = buildBlocks(tokens, cursor + 1, itemClose, { ...context, headingPath: [...context.headingPath] })
    const task = takeTask(children)
    const text = children.map(blockText).join('\n')
    items.push({
      id: makeId(context, 'item', text),
      ...linesOf(tokens[cursor], context),
      text,
      ...(task === undefined ? {} : { task }),
      blocks: children,
    })
    cursor = itemClose + 1
  }
  const text = items.map(item => item.text).join('\n')
  const block: ListBlock = {
    id: makeId(context, ordered ? 'ordered' : 'bullet', text),
    type: 'list',
    ...linesOf(tokens[open], context),
    headingPath: [...context.headingPath],
    text,
    ordered,
    start: Number.isFinite(start) ? start : 1,
    items,
  }
  return { block, next: close + 1 }
}

/** Turn a leading `[ ]` / `[x]` in the item's first paragraph into a checkbox. */
function takeTask(blocks: Block[]): 'todo' | 'done' | undefined {
  const first = blocks[0]
  if (first === undefined || first.type !== 'paragraph') return undefined
  const head = first.inline[0]
  if (head === undefined || head.kind !== 'text') return undefined
  const match = /^\s*\[([ xX])\]\s+/.exec(head.text)
  if (match === null) return undefined
  const rest = head.text.slice(match[0].length)
  first.inline = rest === '' ? first.inline.slice(1) : [{ kind: 'text', text: rest }, ...first.inline.slice(1)]
  first.text = inlineText(first.inline)
  return match[1].toLowerCase() === 'x' ? 'done' : 'todo'
}

/** The alignment markdown-it records on a cell. */
function alignmentOf(token: Token): TableCell['align'] {
  const style = token.attrGet('style') ?? ''
  const match = /text-align:\s*(left|center|right)/.exec(style)
  if (match === null) return undefined
  return match[1] as TableCell['align']
}

/** Build one table from its flat row and cell tokens. */
function buildTable(tokens: readonly Token[], open: number, context: BuildContext): { block: TableBlock, next: number } {
  const close = matching(tokens, open, 'table_open', 'table_close')
  const headRows: TableCell[][] = []
  const bodyRows: TableCell[][] = []
  let row: TableCell[] | undefined
  let inHead = false
  let cursor = open + 1
  while (cursor < close) {
    const token = tokens[cursor]
    if (token.type === 'thead_open') inHead = true
    else if (token.type === 'thead_close') inHead = false
    else if (token.type === 'tr_open') row = []
    else if (token.type === 'th_open' || token.type === 'td_open') {
      const cell: TableCell = {
        inline: inlineOf(inlineAfter(tokens, cursor)),
        header: token.type === 'th_open',
        align: alignmentOf(token),
      }
      row ??= []
      row.push(cell)
    } else if (token.type === 'tr_close' && row !== undefined) {
      if (inHead) headRows.push(row)
      else bodyRows.push(row)
      row = undefined
    }
    cursor += 1
  }
  const header = headRows[0] ?? []
  const rows = [...headRows.slice(1), ...bodyRows]
  const text = [...header, ...rows.flat()].map(cell => inlineText(cell.inline)).join(' | ')
  const block: TableBlock = {
    id: makeId(context, 'table', text),
    type: 'table',
    ...linesOf(tokens[open], context),
    headingPath: [...context.headingPath],
    text,
    header,
    rows,
  }
  return { block, next: close + 1 }
}
