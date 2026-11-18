/** Render the block tree as themed React elements. */
import * as React from 'react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Inline, Block, ListItem } from './model.ts'
import { componentOf } from './model.ts'
import type { DiffStatus, DocumentDiff } from './diff.ts'
import { ComponentFrame } from './component-frame.tsx'
import { splitSourceLines, type SourceLine } from './lines.ts'
import { isRemoteSource } from '../images.ts'

/** Copy the labels this view needs. */
export interface RenderLabels {
  copy: string
  copied: string
  imageFailed: string
  annotate: string
  edit: string
}

/** Side effects the view delegates to the body. */
export interface RenderActions {
  openLink(href: string): void
  resolveImage(src: string): Promise<string | undefined>
}

/** The block frame's annotation hooks; absent actions mean the view is read-only. */
export interface ComponentContext {
  labelOf(block: Block): string
  annotationOf(block: Block): { seq: number } | undefined
  annotate?: (block: Block) => void
}

export interface MarkdownViewProps {
  blocks: readonly Block[]
  labels: RenderLabels
  actions: RenderActions
  lineNumbers: boolean
  components: ComponentContext
  /** Present in the source view once a review baseline differs from the text. */
  diff?: DocumentDiff
}

/**
 * Render the whole document body.
 * @param props - block tree, labels, line-number toggle, component hooks, and link/image behaviour.
 * @returns the rendered article.
 */
export function MarkdownView({ blocks, labels, actions, lineNumbers, components, diff }: MarkdownViewProps): ReactNode {
  const doc = useRef<HTMLElement | null>(null)
  // Gutter numbers are absolutely positioned inside the article, so their tops
  // have to be measured after layout and again whenever the prose reflows.
  useLayoutEffect(() => {
    const element = doc.current
    if (element === null || !lineNumbers) return
    const place = (): void => {
      const top = element.getBoundingClientRect().top
      for (const line of element.querySelectorAll<HTMLElement>('[data-gutter-line]')) {
        line.style.setProperty('--am-line-top', `${line.getBoundingClientRect().top - top}px`)
      }
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    return () => observer.disconnect()
  }, [blocks, lineNumbers])
  return (
    <article ref={doc} className="am-doc" data-active-markdown-doc>
      {blocks.map((block, index) => renderBlock(block, `b${index}`, labels, actions, components, diff?.statuses[index]))}
    </article>
  )
}

function renderBlock(
  block: Block,
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
  components: ComponentContext,
  status?: DiffStatus,
): ReactNode {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as 'h1'
      return (
        <Tag key={key} className="am-heading" data-block-id={block.id} data-block-type="heading" data-source-line={block.sourceStartLine} data-line={block.sourceStartLine} data-gutter-line={block.sourceStartLine} data-anchor={block.anchor} data-diff={status}>
          {renderInline(block.inline, key, labels, actions)}
        </Tag>
      )
    }
    case 'paragraph': {
      const lines = splitSourceLines(block.inline, block.sourceStartLine)
      if (block.tight) return <React.Fragment key={key}>{renderLineSpans(lines, key, labels, actions, true, block.id)}</React.Fragment>
      const single = lines.length === 1
      return (
        <p
          key={key}
          className="am-paragraph"
          data-block-id={block.id}
          data-block-type="paragraph"
          data-source-line={block.sourceStartLine}
          data-diff={status}
          {...(single ? { 'data-line': block.sourceStartLine, 'data-gutter-line': block.sourceStartLine } : {})}
        >
          {single ? renderInline(lines[0].inline, key, labels, actions) : renderLineSpans(lines, key, labels, actions, true, block.id)}
        </p>
      )
    }
    case 'code':
    case 'table': {
      const component = componentOf(block)
      if (component === null) return null
      return (
        <ComponentFrame
          key={key}
          block={block}
          component={component}
          annotation={components.annotationOf(block)}
          diff={status}
          {...(components.annotate === undefined ? {} : { annotate: components.annotate })}
          label={components.labelOf(block)}
          labels={{ annotate: labels.annotate, edit: labels.edit, copy: labels.copy, copied: labels.copied }}
        >
          {block.type === 'table' ? renderTable(block, key, labels, actions) : renderCode(block)}
        </ComponentFrame>
      )
    }
    case 'list': {
      const items = block.items.map((item, index) => renderItem(item, `${key}-i${index}`, labels, actions, components))
      return block.ordered
        ? <ol key={key} className="am-list" start={block.start} data-block-id={block.id} data-block-type="list" data-source-line={block.sourceStartLine} data-diff={status}>{items}</ol>
        : <ul key={key} className="am-list" data-block-id={block.id} data-block-type="list" data-source-line={block.sourceStartLine} data-diff={status}>{items}</ul>
    }
    case 'quote': return (
      <blockquote key={key} className="am-quote" data-block-id={block.id} data-block-type="quote" data-source-line={block.sourceStartLine} data-diff={status}>
        {block.blocks.map((child, index) => renderBlock(child, `${key}-q${index}`, labels, actions, components))}
      </blockquote>
    )
    case 'divider': return <hr key={key} className="am-divider" data-block-id={block.id} data-block-type="divider" data-source-line={block.sourceStartLine} data-line={block.sourceStartLine} data-gutter-line={block.sourceStartLine} data-diff={status} />
  }
}

function renderItem(
  item: ListItem,
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
  components: ComponentContext,
): ReactNode {
  return (
    <li key={key} className={item.task === undefined ? 'am-item' : 'am-item am-item-task'} data-block-id={item.id} data-block-type="list-item" data-source-line={item.sourceStartLine} data-line={item.sourceStartLine}>
      {item.task === undefined ? null : <input className="am-checkbox" type="checkbox" checked={item.task === 'done'} readOnly tabIndex={-1} aria-hidden="true" />}
      {item.blocks.map((block, index) => renderBlock(block, `${key}-${index}`, labels, actions, components))}
    </li>
  )
}

function renderTable(
  block: Extract<Block, { type: 'table' }>,
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
): ReactNode {
  return (
    <div className="am-table-wrap">
      <table className="am-table">
        <thead><tr data-line={block.sourceStartLine}>{block.header.map((cell, index) => <th key={index} style={cell.align === undefined ? undefined : { textAlign: cell.align }}>{renderInline(cell.inline, `${key}-h${index}`, labels, actions)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex} data-line={block.sourceStartLine + 2 + rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={cell.align === undefined ? undefined : { textAlign: cell.align }}>{renderInline(cell.inline, `${key}-${rowIndex}-${cellIndex}`, labels, actions)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function renderCode(block: Extract<Block, { type: 'code' }>): ReactNode {
  const lines = block.content.split('\n')
  const firstLine = block.sourceStartLine + (block.fence ? 1 : 0)
  return (
    <pre className="am-code-body"><code>
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          <span className="am-code-line" data-line={firstLine + index}>{line}</span>
          {index === lines.length - 1 ? null : '\n'}
        </React.Fragment>
      ))}
    </code></pre>
  )
}

/** One element per rendered source line; the first may anchor a gutter number. */
function renderLineSpans(
  lines: readonly SourceLine[],
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
  gutter: boolean,
  blockId: string,
): ReactNode[] {
  return lines.map((line, index) => (
    <span key={`${key}-l${index}`} data-line={line.line} data-block-id={blockId} {...(gutter && index === 0 ? { 'data-gutter-line': line.line } : {})}>
      {renderInline(line.inline, `${key}-l${index}`, labels, actions)}
      {line.break === undefined ? null : line.break === 'hard' ? <br /> : ' '}
    </span>
  ))
}

function renderInline(inlines: readonly Inline[], key: string, labels: RenderLabels, actions: RenderActions): ReactNode[] {
  return inlines.map((inline, index) => {
    const itemKey = `${key}-${index}`
    switch (inline.kind) {
      case 'text': return <React.Fragment key={itemKey}>{inline.text}</React.Fragment>
      case 'softbreak': return <React.Fragment key={itemKey}> </React.Fragment>
      case 'hardbreak': return <br key={itemKey} />
      case 'code': return <code key={itemKey} className="am-inline-code">{inline.text}</code>
      case 'strong': return <strong key={itemKey}>{renderInline(inline.children, itemKey, labels, actions)}</strong>
      case 'em': return <em key={itemKey}>{renderInline(inline.children, itemKey, labels, actions)}</em>
      case 'del': return <del key={itemKey}>{renderInline(inline.children, itemKey, labels, actions)}</del>
      case 'link': return (
        <a
          key={itemKey}
          className="am-link"
          href={inline.href}
          title={inline.title}
          rel="noreferrer noopener"
          onClick={(event) => {
            event.preventDefault()
            actions.openLink(inline.href)
          }}
        >
          {renderInline(inline.children, itemKey, labels, actions)}
        </a>
      )
      case 'image': return <InlineImage key={itemKey} src={inline.src} alt={inline.alt} title={inline.title} labels={labels} actions={actions} />
    }
  })
}

interface InlineImageProps {
  src: string
  alt: string
  title?: string
  labels: RenderLabels
  actions: RenderActions
}

/** Resolve a local image only when it approaches the viewport. */
function InlineImage({ src, alt, title, labels, actions }: InlineImageProps): ReactNode {
  const remote = isRemoteSource(src)
  const [url, setUrl] = useState<string | undefined>(remote ? src : undefined)
  const [visible, setVisible] = useState(remote)
  const [failed, setFailed] = useState(false)
  const holder = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (remote || holder.current === null) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin: '200px' })
    observer.observe(holder.current)
    return () => observer.disconnect()
  }, [remote])
  useEffect(() => {
    if (!visible || url !== undefined) return
    let alive = true
    void actions.resolveImage(src).then((next) => {
      if (!alive) return
      if (next === undefined) setFailed(true)
      else setUrl(next)
    })
    return () => { alive = false }
  }, [visible, url, src, actions])
  if (failed) return <span className="am-image-failed">{alt === '' ? labels.imageFailed : alt}</span>
  return (
    <span ref={holder} className="am-image">
      {url === undefined
        ? <span className="am-image-pending">{alt}</span>
        : <img src={url} alt={alt} title={title} loading="lazy" onError={() => setFailed(true)} />}
    </span>
  )
}
