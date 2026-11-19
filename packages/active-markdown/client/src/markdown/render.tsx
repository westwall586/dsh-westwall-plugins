/** Render the block tree as themed React elements. */
import * as React from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CodeBlock, ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Inline, Block, ListItem } from './model.ts'
import { componentOf } from './model.ts'
import type { DiffStatus, DocumentDiff } from './diff.ts'
import { ComponentFrame, type AnnotateHooks, type ComponentFrameLabels } from './component-frame.tsx'
import { calloutHeadTitle, resolveCallout } from './callout.ts'
import { splitSourceLines, type SourceLine } from './lines.ts'
import { isRemoteSource } from '../images.ts'
import type { AnnotationLabels } from '../annotate/form.tsx'
import { MarkmapView } from '../rich/markmap.tsx'
import { MermaidView } from '../rich/mermaid.tsx'
import { MathInline, MathView } from '../rich/math.tsx'
import type { RichLabels } from '../rich/labels.ts'

/** Copy the labels this view needs. */
export interface RenderLabels {
  copy: string
  copied: string
  imageFailed: string
  imageDialog: string
  imageClose: string
  annotate: string
  edit: string
  wrap: string
  nowrap: string
  fullscreen: string
  close: string
  /** The annotation editor and drawer copy, shared by the popover and the panel drawer. */
  annotation: AnnotationLabels
  /** Localized copy for the lazily rendered diagrams. */
  rich: RichLabels
  /** One callout type's localized label. */
  calloutType: (id: string) => string
}

/** Side effects the view delegates to the body. */
export interface RenderActions {
  openLink(href: string): void
  resolveImage(src: string): Promise<string | undefined>
}

/** The block frame's annotation hooks; absent actions mean the view is read-only. */
export interface ComponentContext {
  labelOf(block: Block): string
  annotationOf(block: Block): { seq: number, body: string } | undefined
  annotate?: AnnotateHooks
}

export interface MarkdownViewProps {
  blocks: readonly Block[]
  labels: RenderLabels
  actions: RenderActions
  components: ComponentContext
  /** Present in the source view once a review baseline differs from the text. */
  diff?: DocumentDiff
}

/**
 * One mapping from the view's copy to the shell's copy, so every frame call site
 * passes the same shape instead of repeating it.
 */
function frameLabels(labels: RenderLabels): ComponentFrameLabels {
  return {
    annotate: labels.annotate,
    edit: labels.edit,
    copy: labels.copy,
    copied: labels.copied,
    wrap: labels.wrap,
    nowrap: labels.nowrap,
    fullscreen: labels.fullscreen,
    close: labels.close,
  }
}

/**
 * Render the whole document body.
 * @param props - block tree, labels, component hooks, and link/image behaviour.
 * @returns the rendered article.
 */
export function MarkdownView({ blocks, labels, actions, components, diff }: MarkdownViewProps): ReactNode {
  const doc = useRef<HTMLElement | null>(null)
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
        <Tag key={key} className="am-heading" data-block-id={block.id} data-block-type="heading" data-source-line={block.sourceStartLine} data-line={block.sourceStartLine} data-anchor={block.anchor} data-diff={status}>
          {renderInline(block.inline, key, labels, actions)}
        </Tag>
      )
    }
    case 'paragraph': {
      const lines = splitSourceLines(block.inline, block.sourceStartLine)
      if (block.tight) return <React.Fragment key={key}>{renderLineSpans(lines, key, labels, actions, block.id)}</React.Fragment>
      const single = lines.length === 1
      return (
        <p
          key={key}
          className="am-paragraph"
          data-block-id={block.id}
          data-block-type="paragraph"
          data-source-line={block.sourceStartLine}
          data-diff={status}
          {...(single ? { 'data-line': block.sourceStartLine } : {})}
        >
          {single ? renderInline(lines[0].inline, key, labels, actions) : renderLineSpans(lines, key, labels, actions, block.id)}
        </p>
      )
    }
    case 'code':
    case 'table':
    case 'mermaid':
    case 'markmap':
    case 'math': {
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
          labels={frameLabels(labels)}
        >
          {(context) => {
            switch (block.type) {
              case 'table': return renderTable(block, key, labels, actions, context.wrap)
              case 'code': return renderCode(block, context.wrap, labels)
              case 'mermaid': return <MermaidView code={block.content} labels={labels.rich} expanded={context.expanded} />
              case 'markmap': return <MarkmapView code={block.content} labels={labels.rich} expanded={context.expanded} />
              case 'math': return <MathView tex={block.tex} labels={labels.rich} />
            }
          }}
        </ComponentFrame>
      )
    }
    case 'callout': return renderCallout(block, key, labels, actions, components, status)
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
    case 'divider': return <hr key={key} className="am-divider" data-block-id={block.id} data-block-type="divider" data-source-line={block.sourceStartLine} data-line={block.sourceStartLine} data-diff={status} />
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

/** A callout keeps its semantic accent but wears the same shell head as every other component. */
function renderCallout(
  block: Extract<Block, { type: 'callout' }>,
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
  components: ComponentContext,
  status?: DiffStatus,
): ReactNode {
  const component = componentOf(block)
  const type = resolveCallout(block.kind)
  if (component === null || type === undefined) return null
  const typeLabel = labels.calloutType(block.kind)
  return (
    <ComponentFrame
      key={key}
      block={block}
      component={component}
      annotation={components.annotationOf(block)}
      diff={status}
      {...(components.annotate === undefined ? {} : { annotate: components.annotate })}
      label={typeLabel}
      labelVisible={false}
      icon={<span dangerouslySetInnerHTML={{ __html: type.icon }} />}
      title={calloutHeadTitle(block.title, typeLabel)}
      family={block.family}
      labels={frameLabels(labels)}
    >
      {() => block.blocks.length === 0
        ? null
        : (
          <div className="am-callout-body">
            {block.blocks.map((child, index) => renderBlock(child, `${key}-c${index}`, labels, actions, components))}
          </div>
        )}
    </ComponentFrame>
  )
}

function renderTable(
  block: Extract<Block, { type: 'table' }>,
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
  wrap: boolean,
): ReactNode {
  // Only the panel copy honors `wrap`; the inline copy is styled to scroll.
  return (
    <div className="am-table-wrap" data-wrap={wrap ? 'true' : undefined}>
      <table className="am-table">
        <thead><tr data-line={block.sourceStartLine}>{block.header.map((cell, index) => <th key={index} style={cell.align === undefined ? undefined : { textAlign: cell.align }}>{renderInline(cell.inline, `${key}-h${index}`, labels, actions)}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex} data-line={block.sourceStartLine + 2 + rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} style={cell.align === undefined ? undefined : { textAlign: cell.align }}>{renderInline(cell.inline, `${key}-${rowIndex}-${cellIndex}`, labels, actions)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/**
 * Render one fence body through the platform's code block, which carries the
 * syntax highlighting, scrollport, and wrapping semantics chat uses.
 */
function renderCode(block: Extract<Block, { type: 'code' }>, wrap: boolean, labels: RenderLabels): ReactNode {
  return (
    <CodeBlock
      // The frame owns the header, so the platform card only supplies the body;
      // the appended newline is what its display trim expects of a fence.
      code={`${block.content}\n`}
      lang={block.lang}
      showHeader={false}
      // The card decides the wrap flag and hides its own toolbar action; the
      // frame's header button is the only switch the reader sees.
      toolbarLabels={{ codeLabel: block.lang === '' ? 'text' : block.lang, wrapLabel: labels.wrap, unwrapLabel: labels.nowrap }}
      wrap={wrap}
      copyLabel={labels.copy}
      copiedLabel={labels.copied}
    />
  )
}

/** One element per rendered source line. */
function renderLineSpans(
  lines: readonly SourceLine[],
  key: string,
  labels: RenderLabels,
  actions: RenderActions,
  blockId: string,
): ReactNode[] {
  return lines.map((line, index) => (
    <span key={`${key}-l${index}`} data-line={line.line} data-block-id={blockId}>
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
      case 'math': return <MathInline key={itemKey} tex={inline.tex} />
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
  const [zoom, setZoom] = useState(false)
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
  const open = (image: HTMLImageElement): void => {
    image.focus()
    setZoom(true)
  }
  return (
    <span ref={holder} className="am-image">
      {url === undefined
        ? <span className="am-image-pending">{alt}</span>
        : (
          <React.Fragment>
            <img
              src={url}
              alt={alt}
              title={title}
              loading="lazy"
              role="button"
              tabIndex={0}
              aria-label={alt === '' ? labels.imageDialog : undefined}
              onClick={event => open(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                open(event.currentTarget)
              }}
              onError={() => setFailed(true)}
            />
            {zoom
              ? (
                <ImageLightbox
                  src={url}
                  alt={alt}
                  labels={{ dialog: labels.imageDialog, close: labels.imageClose }}
                  onClose={() => setZoom(false)}
                />
              )
              : null}
          </React.Fragment>
        )}
    </span>
  )
}
