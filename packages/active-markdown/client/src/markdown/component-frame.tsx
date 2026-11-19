/** The one shell every non-text block wears: label, actions, and the expanded view. */
import * as React from 'react'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Block, ComponentView } from './model.ts'
import type { DiffStatus } from './diff.ts'

/** What a frame body receives: the frame's wrap preference, and whether it is the expanded copy. */
export interface ComponentBodyContext {
  wrap: boolean
  expanded: boolean
}

export interface ComponentFrameProps {
  block: Block
  component: ComponentView
  /** The block's single annotation, if it has one. */
  annotation: { seq: number } | undefined
  /** Set when the top-level block was updated after the last review round. */
  diff?: DiffStatus
  /** Absent in the translated view, where annotations are read-only. */
  annotate?: (block: Block) => void
  label: string
  labels: {
    annotate: string
    edit: string
    copy: string
    copied: string
    wrap: string
    nowrap: string
    fullscreen: string
    close: string
  }
  /**
   * The frame body. The frame renders it once in place and once more inside the
   * expanded panel with `expanded: true`, so a diagram can attach its zoom bar
   * only to the copy the panel shows.
   */
  children: (context: ComponentBodyContext) => ReactNode
}

/**
 * Render one component with its label and actions, and its expanded view.
 * @param props - the block, its component view, annotation state, and labels.
 * @returns the frame, plus the panel while expanded.
 */
export function ComponentFrame({
  block,
  component,
  annotation,
  diff,
  annotate,
  label,
  labels,
  children,
}: ComponentFrameProps): ReactNode {
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const expandButton = useRef<HTMLButtonElement | null>(null)
  const copy = useCallback(() => {
    if (component.copyText === undefined) return
    void navigator.clipboard?.writeText(component.copyText).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }, [component.copyText])
  useEffect(() => () => clearTimeout(timer.current), [])
  const canCopy = component.actions.includes('copy') && component.copyText !== undefined
  const canExpand = component.actions.includes('fullscreen')
  return (
    <div
      className="am-component"
      data-component={component.kind}
      data-block-id={block.id}
      data-block-type={block.type}
      data-source-line={block.sourceStartLine}
      data-annotated={annotation === undefined ? undefined : ''}
      data-diff={diff}
    >
      <div className="am-component-head">
        <span className="am-component-label">{label}</span>
        {annotation === undefined ? null : <span className="am-component-seq">#{annotation.seq}</span>}
        <div className="am-component-actions">
          {canExpand
            ? (
              <button
                ref={expandButton}
                type="button"
                className="am-component-action"
                aria-expanded={expanded}
                onClick={() => setExpanded(true)}
              >
                {labels.fullscreen}
              </button>
            )
            : null}
          {component.kind === 'code'
            ? (
              <button type="button" className="am-component-action" aria-pressed={wrap} onClick={() => setWrap(value => !value)}>
                {wrap ? labels.nowrap : labels.wrap}
              </button>
            )
            : null}
          {annotate === undefined
            ? null
            : (
              <button type="button" className="am-component-action" onClick={() => annotate(block)}>
                {annotation === undefined ? labels.annotate : labels.edit}
              </button>
            )}
          {canCopy
            ? <button type="button" className="am-component-action" onClick={copy}>{copied ? labels.copied : labels.copy}</button>
            : null}
        </div>
      </div>
      <div className="am-component-body">{children({ wrap, expanded: false })}</div>
      {expanded
        ? (
          <ComponentPanel kind={component.kind} label={label} closeLabel={labels.close} returnFocus={expandButton} onClose={() => setExpanded(false)}>
            {children({ wrap, expanded: true })}
          </ComponentPanel>
        )
        : null}
    </div>
  )
}

interface ComponentPanelProps {
  kind: string
  label: string
  closeLabel: string
  /** The fullscreen button; focus goes back to it after every close. */
  returnFocus: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
}

/**
 * Show one component over a full-viewport scrim.
 * Esc, the scrim, and the close button all close it; the panel takes focus on
 * open and hands it back to the button that opened it on close.
 * @param props - the component kind and label, close copy, focus target, and body.
 * @returns the portal, or null before the document body exists.
 */
function ComponentPanel({ kind, label, closeLabel, returnFocus, onClose, children }: ComponentPanelProps): ReactNode {
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previous
      returnFocus.current?.focus()
    }
  }, [returnFocus])
  const stop = useCallback((event: React.MouseEvent): void => { event.stopPropagation() }, [])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="am-component-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={() => close.current()}
    >
      <div className="am-component-panel" data-component-panel={kind} onClick={stop}>
        <header className="am-component-panel-head">
          <span className="am-component-panel-title">{label}</span>
          <button ref={closeButton} type="button" className="am-component-action" onClick={() => close.current()}>
            {closeLabel}
          </button>
        </header>
        <div className="am-component-panel-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
