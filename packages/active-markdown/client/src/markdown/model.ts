/** The block model P0 renders and later phases annotate. */
import { calloutLabel, resolveCallout, type CalloutFamily, type CalloutType } from './callout.ts'

export type ComponentKind = 'table' | 'code' | 'callout' | 'mermaid' | 'markmap'

/**
 * What the shared shell offers one component. The header buttons come from
 * `fullscreen`, `wrap`, `annotate`, and `copy`; the rest describe what the
 * body does in the expanded panel.
 */
export interface ComponentCapabilities {
  /** The panel toggle and, inside the panel, the close button. */
  fullscreen: boolean
  /** Clicking the inline body, or Enter / Space on it, opens the panel. */
  clickToExpand: boolean
  /** The footer zoom bar, and a zoomable panel body. */
  zoom: boolean
  /** Dragging the panel body pans it. */
  pan: boolean
  /** The header's wrap toggle. */
  wrap: boolean
  /** The header's copy button, when the component has text to copy. */
  copy: boolean
  /** The header's annotation button, when the view is not read-only. */
  annotate: boolean
}

/** One non-text block family; new rich blocks register here instead of a new frame. */
export interface ComponentDefinition {
  kind: ComponentKind
  capabilities: ComponentCapabilities
}

export const COMPONENT_REGISTRY: Record<ComponentKind, ComponentDefinition> = {
  table: {
    kind: 'table',
    capabilities: { fullscreen: true, clickToExpand: false, zoom: false, pan: false, wrap: false, copy: false, annotate: true },
  },
  code: {
    kind: 'code',
    capabilities: { fullscreen: true, clickToExpand: false, zoom: false, pan: false, wrap: true, copy: true, annotate: true },
  },
  callout: {
    kind: 'callout',
    capabilities: { fullscreen: false, clickToExpand: false, zoom: false, pan: false, wrap: false, copy: false, annotate: true },
  },
  mermaid: {
    kind: 'mermaid',
    capabilities: { fullscreen: true, clickToExpand: true, zoom: true, pan: true, wrap: false, copy: true, annotate: true },
  },
  markmap: {
    kind: 'markmap',
    capabilities: { fullscreen: true, clickToExpand: true, zoom: true, pan: true, wrap: false, copy: true, annotate: true },
  },
}

/** One header button slot, in the order the shell renders them. */
export type FrameButton = 'fullscreen' | 'wrap' | 'annotate' | 'copy'

/**
 * Project capabilities onto the header buttons, in render order.
 * @param capabilities - one component's capability record.
 * @returns fullscreen, wrap, annotate, copy, keeping only what the component has.
 */
export function frameButtons(capabilities: ComponentCapabilities): readonly FrameButton[] {
  // Right-to-left reading: the most-used action sits closest to the content,
  // the panel toggle at the far edge.
  const buttons: FrameButton[] = []
  if (capabilities.wrap) buttons.push('wrap')
  if (capabilities.copy) buttons.push('copy')
  if (capabilities.annotate) buttons.push('annotate')
  if (capabilities.fullscreen) buttons.push('fullscreen')
  return buttons
}

/** The dimensions or language a frame shows in its header. */
export type ComponentLabel =
  | { kind: 'table', columns: number, rows: number }
  | { kind: 'code', lang: string }
  | { kind: 'callout', type: CalloutType }
  | { kind: 'mermaid' }
  | { kind: 'markmap' }

export interface ComponentView {
  kind: ComponentKind
  label: ComponentLabel
  /** Content identity for block annotation restore; line shifts keep it stable. */
  signature: string
  lineStart: number
  lineEnd: number
  capabilities: ComponentCapabilities
  copyText?: string
}

export type Inline =
  | { kind: 'text', text: string }
  | { kind: 'softbreak' }
  | { kind: 'hardbreak' }
  | { kind: 'code', text: string }
  | { kind: 'strong', children: Inline[] }
  | { kind: 'em', children: Inline[] }
  | { kind: 'del', children: Inline[] }
  | { kind: 'link', href: string, title?: string, children: Inline[] }
  | { kind: 'image', src: string, title?: string, alt: string }

export interface BlockBase {
  /** Stable within one document revision: type, text hash, and occurrence. */
  id: string
  type: string
  /** 1-based, inclusive, always relative to the whole source file. */
  sourceStartLine: number
  sourceEndLine: number
  headingPath: readonly string[]
  /** Plain-text projection used for ids, matching, and later quoting. */
  text: string
}

export interface HeadingBlock extends BlockBase {
  type: 'heading'
  level: number
  /** Deduplicated slug the `#fragment` links address. */
  anchor: string
  inline: Inline[]
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph'
  inline: Inline[]
  /** Hidden paragraph inside a tight list item; rendered without a `<p>`. */
  tight: boolean
}

export interface CodeBlock extends BlockBase {
  type: 'code'
  lang: string
  content: string
  /** Fenced code starts one source line after `sourceStartLine`; indented code does not. */
  fence: boolean
}

export interface MermaidBlock extends BlockBase {
  type: 'mermaid'
  lang: 'mermaid'
  content: string
}

export interface MarkmapBlock extends BlockBase {
  type: 'markmap'
  /** `markmap` or `mindmap`; the fence info string picks which alias the author wrote. */
  lang: string
  content: string
}

export interface TableCell {
  inline: Inline[]
  align?: 'left' | 'center' | 'right'
  header: boolean
}

export interface TableBlock extends BlockBase {
  type: 'table'
  header: TableCell[]
  rows: TableCell[][]
}

export interface ListItem {
  id: string
  sourceStartLine: number
  sourceEndLine: number
  text: string
  task?: 'todo' | 'done'
  blocks: Block[]
}

export interface ListBlock extends BlockBase {
  type: 'list'
  ordered: boolean
  start: number
  items: ListItem[]
}

export interface QuoteBlock extends BlockBase {
  type: 'quote'
  blocks: Block[]
}

export interface CalloutBlock extends BlockBase {
  type: 'callout'
  /** Canonical type id from `CALLOUT_TYPES`. */
  kind: string
  family: CalloutFamily
  /** The marker line's remaining text; may be empty. */
  title: string
  blocks: Block[]
}

export interface DividerBlock extends BlockBase {
  type: 'divider'
}

export type Block =
  | HeadingBlock | ParagraphBlock | CodeBlock | MermaidBlock | MarkmapBlock | TableBlock | ListBlock | QuoteBlock
  | CalloutBlock | DividerBlock

/** Concatenate the readable text of one inline tree. */
export function inlineText(inlines: readonly Inline[]): string {
  let text = ''
  for (const inline of inlines) {
    switch (inline.kind) {
      case 'text': text += inline.text; break
      case 'code': text += inline.text; break
      case 'softbreak':
      case 'hardbreak': text += ' '; break
      case 'strong':
      case 'em':
      case 'del':
      case 'link': text += inlineText(inline.children); break
      case 'image': text += inline.alt; break
    }
  }
  return text
}

/** Read one block's text without its nested blocks. */
export function blockText(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph': return inlineText(block.inline)
    case 'code': return block.content
    case 'mermaid':
    case 'markmap': return block.content
    case 'table': return [...block.header, ...block.rows.flat()].map(cell => inlineText(cell.inline)).join(' | ')
    case 'list': return block.items.map(item => item.text).join('\n')
    case 'quote': return block.blocks.map(blockText).join('\n')
    case 'callout': return [block.title, ...block.blocks.map(blockText)].filter(part => part !== '').join('\n')
    case 'divider': return ''
  }
}

/** Strip inline formatting and punctuation so a heading reads as a URL fragment. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug === '' ? 'section' : slug
}

/** FNV-1a, enough to keep ids apart without a dependency. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Project one block onto its component shell; text blocks have no frame.
 */
export function componentOf(block: Block): ComponentView | null {
  switch (block.type) {
    case 'table':
      return {
        kind: 'table',
        label: { kind: 'table', columns: block.header.length, rows: block.rows.length },
        signature: `table:${block.header.length}x${block.rows.length}:${hashText(block.text)}:${block.text.length}`,
        lineStart: block.sourceStartLine,
        lineEnd: block.sourceEndLine,
        capabilities: COMPONENT_REGISTRY.table.capabilities,
      }
    case 'code':
      return {
        kind: 'code',
        label: { kind: 'code', lang: block.lang },
        signature: `code:${block.lang}:${hashText(block.content)}:${block.content.length}`,
        lineStart: block.sourceStartLine,
        lineEnd: block.sourceEndLine,
        capabilities: COMPONENT_REGISTRY.code.capabilities,
        copyText: block.content,
      }
    case 'callout': {
      const type = resolveCallout(block.kind)
      if (type === undefined) return null
      return {
        kind: 'callout',
        label: { kind: 'callout', type },
        signature: `callout:${block.kind}:${hashText(block.text)}:${block.text.length}`,
        lineStart: block.sourceStartLine,
        lineEnd: block.sourceEndLine,
        capabilities: COMPONENT_REGISTRY.callout.capabilities,
      }
    }
    case 'mermaid':
      return {
        kind: 'mermaid',
        label: { kind: 'mermaid' },
        signature: `mermaid:${hashText(block.content)}:${block.content.length}`,
        lineStart: block.sourceStartLine,
        lineEnd: block.sourceEndLine,
        capabilities: COMPONENT_REGISTRY.mermaid.capabilities,
        copyText: block.content,
      }
    case 'markmap':
      return {
        kind: 'markmap',
        label: { kind: 'markmap' },
        signature: `markmap:${block.lang}:${hashText(block.content)}:${block.content.length}`,
        lineStart: block.sourceStartLine,
        lineEnd: block.sourceEndLine,
        capabilities: COMPONENT_REGISTRY.markmap.capabilities,
        copyText: block.content,
      }
    default:
      return null
  }
}

/** The one-line label shared by the frame header and the block annotation quote. */
export function componentLabel(view: ComponentView, format: (key: string, params?: Record<string, string | number>) => string): string {
  switch (view.label.kind) {
    case 'table':
      return format('component.table', { columns: view.label.columns, rows: view.label.rows })
    case 'code':
      return format('component.code', { lang: view.label.lang === '' ? 'text' : view.label.lang })
    case 'callout':
      return format('component.callout', { type: calloutLabel(view.label.type, format) })
    case 'mermaid':
      return format('component.mermaid')
    case 'markmap':
      return format('component.markmap')
  }
}
