/** Markdown source into tokens: front matter split, parser setup, inline trees. */
import MarkdownIt from 'markdown-it'
import type { Inline } from './model.ts'

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
    if (token.type === 'text' || token.type === 'code_inline') text += token.content
    else if (token.children !== null && token.children !== undefined) text += plainOf(token.children)
  }
  return text
}
