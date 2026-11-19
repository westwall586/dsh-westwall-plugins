/** Markdown source into tokens: front matter split, parser setup, inline trees. */
import MarkdownIt from 'markdown-it'
import type { StateBlock, StateInline } from 'markdown-it'
import type { Inline } from './model.ts'
import { displayMathAt, inlineMathAt } from './math.ts'

/** One token of the parser's flat stream. */
export type Token = ReturnType<MarkdownIt['parse']>[number]

/** A leading YAML block, kept verbatim above the body. */
export interface Frontmatter {
  source: string
  lines: number
}

const parser = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
})

/**
 * A paragraph that is only a `$$…$$` formula, on one line or several.
 * @param state - the block parser state.
 * @param startLine - the line the candidate opens on.
 * @param endLine - the block's exclusive last line.
 * @param silent - validate without writing tokens.
 * @returns whether this line opens a display formula.
 */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const lineText = (line: number): string =>
    // `tShift` is where the list item or quote marker ends, so a formula may
    // start a list item and still read as the item's first line.
    state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
  if (!lineText(startLine).trimStart().startsWith('$$')) return false
  const lines: string[] = []
  for (let line = startLine; line < endLine; line += 1) {
    const text = lineText(line)
    lines.push(text)
    // A blank line ends the paragraph, and with it the candidate.
    if (line > startLine && text.trim() === '') break
  }
  const found = displayMathAt(lines, 0)
  if (found === null) return false
  if (silent) return true
  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = found.tex
  token.markup = '$$'
  token.map = [startLine, startLine + found.lines]
  state.line = startLine + found.lines
  return true
}

/**
 * Inline `$…$` inside one paragraph line.
 * @param state - the inline parser state.
 * @param silent - validate without writing the token.
 * @returns whether a formula starts at `state.pos`.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
  const found = inlineMathAt(state.src, state.pos, state.posMax)
  if (found === null) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = found.tex
    token.markup = '$'
  }
  state.pos = found.end
  return true
}

parser.block.ruler.before('paragraph', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
parser.inline.ruler.before('text', 'math_inline', mathInline)

/**
 * Split a leading `---` block from the body.
 * @param text - the whole source file.
 * @returns the front matter, the remaining body, and how many lines it skipped.
 */
export function splitFrontmatter(text: string): { frontmatter?: Frontmatter, body: string, lineOffset: number } {
  const lines = text.split('\n')
  if (lines.length < 2 || lines[0].trim() !== '---') return { body: text, lineOffset: 0 }
  for (let index = 1; index < lines.length; index += 1) {
    const marker = lines[index].trim()
    if (marker !== '---' && marker !== '...') continue
    return {
      frontmatter: { source: lines.slice(1, index).join('\n'), lines: index + 1 },
      body: lines.slice(index + 1).join('\n'),
      lineOffset: index + 1,
    }
  }
  return { body: text, lineOffset: 0 }
}

/** Tokenize the body; the caller owns line offsets and block construction. */
export function parseMarkdown(body: string): Token[] {
  return parser.parse(body, {})
}

/**
 * Split one front matter block into display entries. This is a line scan, not
 * YAML: top-level `key: value` lines become entries and indented lines continue
 * the previous value.
 * @param source - the front matter text between the `---` markers.
 * @returns the entries in source order; lines without a colon are ignored.
 */
export function frontmatterEntries(source: string): { key: string, value: string }[] {
  const entries: { key: string, value: string }[] = []
  for (const line of source.split('\n')) {
    if (line.trim() === '') continue
    const previous = entries[entries.length - 1]
    if (/^\s/.test(line)) {
      if (previous === undefined) continue
      const continued = line.trim()
      previous.value = previous.value === '' ? continued : `${previous.value}\n${continued}`
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    entries.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() })
  }
  return entries
}

/** A frame while walking the flat inline stream. */
interface InlineFrame {
  children: Inline[]
  close?: (children: Inline[]) => Inline
}

/**
 * Turn one inline token's flat children into a tree.
 * @param tokens - an inline token's `children`.
 * @returns the inline tree, with unknown markers treated as text.
 */
export function inlineOf(tokens: readonly Token[] | null | undefined): Inline[] {
  if (tokens === null || tokens === undefined) return []
  const frames: InlineFrame[] = [{ children: [] }]
  const top = (): InlineFrame => frames[frames.length - 1]
  const push = (inline: Inline): void => { top().children.push(inline) }
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'text_special':
        if (token.content !== '') push({ kind: 'text', text: token.content })
        break
      case 'code_inline':
        push({ kind: 'code', text: token.content })
        break
      case 'math_inline':
        push({ kind: 'math', tex: token.content })
        break
      case 'softbreak': push({ kind: 'softbreak' }); break
      case 'hardbreak': push({ kind: 'hardbreak' }); break
      case 'strong_open': frames.push({ children: [], close: children => ({ kind: 'strong', children }) }); break
      case 'em_open': frames.push({ children: [], close: children => ({ kind: 'em', children }) }); break
      case 's_open': frames.push({ children: [], close: children => ({ kind: 'del', children }) }); break
      case 'link_open': {
        const href = token.attrGet('href') ?? ''
        const title = token.attrGet('title') ?? undefined
        frames.push({ children: [], close: children => ({ kind: 'link', href, children, ...(title === undefined ? {} : { title }) }) })
        break
      }
      case 'image': {
        const src = token.attrGet('src') ?? ''
        const title = token.attrGet('title') ?? undefined
        push({ kind: 'image', src, alt: plainOf(token.children ?? []), ...(title === undefined ? {} : { title }) })
        break
      }
      case 'strong_close':
      case 'em_close':
      case 's_close':
      case 'link_close': {
        if (frames.length === 1) break
        const frame = frames.pop() as InlineFrame
        push((frame.close as (children: Inline[]) => Inline)(frame.children))
        break
      }
      default:
        if (token.content !== '') push({ kind: 'text', text: token.content })
    }
  }
  while (frames.length > 1) {
    const frame = frames.pop() as InlineFrame
    push((frame.close as (children: Inline[]) => Inline)(frame.children))
  }
  return frames[0].children
}

/** Read plain text from raw inline tokens, used for image alt text. */
function plainOf(tokens: readonly Token[]): string {
  let text = ''
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline' || token.type === 'math_inline') text += token.content
    else if (token.children !== null && token.children !== undefined) text += plainOf(token.children)
  }
  return text
}
