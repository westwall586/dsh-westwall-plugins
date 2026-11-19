/** The one shell every non-text block wears: label, actions, and annotation state. */
import * as React from 'react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Block, ComponentView } from './model.ts'
import type { DiffStatus } from './diff.ts'

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
  labels: { annotate: string, edit: string, copy: string, copied: string, wrap: string, nowrap: string }
  /** The frame body; a code block receives its local wrap state instead of a fixed child. */
  children: ReactNode | ((wrap: boolean) => ReactNode)
}

/**
 * Render one component. Fullscreen and collapse stay reserved: the registry may
 * list them, but this slice gives them no button.
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
      <div className="am-component-body">{typeof children === 'function' ? children(wrap) : children}</div>
    </div>
  )
}
