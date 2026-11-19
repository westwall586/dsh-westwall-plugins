/** The one shell every non-text block wears: icon, label, header buttons, and the expanded panel. */
import * as React from 'react'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { frameButtons, type Block, type ComponentView, type FrameButton } from './model.ts'
import type { DiffStatus } from './diff.ts'
import type { AnnotationLabels } from '../annotate/form.tsx'
import { PanelAnnotation } from '../annotate/panel.tsx'
import { AnnotateIcon, CloseIcon, CopyIcon, ExpandIcon, WrapIcon } from '../rich/icons.tsx'

/** What a frame body receives: the frame's wrap preference, and whether it is the expanded copy. */
export interface ComponentBodyContext {
  wrap: boolean
  expanded: boolean
}

/** Copy the shell's header buttons need. */
export interface ComponentFrameLabels {
  annotate: string
  edit: string
  copy: string
  copied: string
  wrap: string
  nowrap: string
  fullscreen: string
  close: string
}

/** What the expanded panel's annotation drawer needs. */
export interface PanelAnnotationHooks {
  labels: AnnotationLabels
  /** The label the saved annotation records; the drawer previews it as the quote. */
  quote(block: Block): string
  save(block: Block, body: string): void
  remove?(block: Block): void
}

/** Where a frame's annotate buttons lead: the floating editor, or the panel drawer. */
export interface AnnotateHooks {
  inline(block: Block): void
  /** Present when this view may edit annotations inside the expanded panel. */
  panel?: PanelAnnotationHooks
}

export interface ComponentFrameProps {
  block: Block
  component: ComponentView
  /** The block's single annotation, if it has one. */
  annotation: { seq: number, body: string } | undefined
  /** Set when the top-level block was updated after the last review round. */
  diff?: DiffStatus
  /** Absent in the translated view, where annotations are read-only. */
  annotate?: AnnotateHooks
  /** Header text after the leading icon. */
  label: string
  /**
   * Whether the head shows `label`. Callouts set it off because their icon already
   * names the type, and the type name then lives in the head's tooltip instead.
   */
  labelVisible?: boolean
  /** Leading icon; callouts carry their semantic type icon, other blocks have none. */
  icon?: ReactNode
  /** Extra header text after the label; callouts show their own title here. */
  title?: string
  /** Callout family, which selects the semantic accent through CSS. */
  family?: string
  labels: ComponentFrameLabels
  /**
   * The frame body. The frame renders it once in place and once more inside the
   * expanded panel with `expanded: true`, so a diagram can attach its zoom bar
   * only to the copy the panel shows.
   */
  children: (context: ComponentBodyContext) => ReactNode
}

/**
 * Render one component with its head and capabilities, and its expanded view.
 * @param props - the block, its component view, annotation state, copy, and labels.
 * @returns the frame, plus the panel while expanded.
 */
export function ComponentFrame({
  block,
  component,
  annotation,
  diff,
  annotate,
  label,
  labelVisible = true,
  icon,
  title,
  family,
  labels,
  children,
}: ComponentFrameProps): ReactNode {
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [panelAnnotating, setPanelAnnotating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const expandButton = useRef<HTMLButtonElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const annotateButton = useRef<HTMLButtonElement | null>(null)
  const copy = useCallback(() => {
    if (component.copyText === undefined) return
    void navigator.clipboard?.writeText(component.copyText).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }, [component.copyText])
  useEffect(() => () => clearTimeout(timer.current), [])
  // A closed panel drops its drawer, so reopening always starts without one.
  useEffect(() => {
    if (!expanded) setPanelAnnotating(false)
  }, [expanded])

  const panelHooks = annotate?.panel
  const closePanelAnnotation = useCallback((): void => {
    setPanelAnnotating(false)
    annotateButton.current?.focus()
  }, [])
  const closeGuard = useCallback((): boolean => {
    if (!panelAnnotating) return false
    closePanelAnnotation()
    return true
  }, [panelAnnotating, closePanelAnnotation])

  const capabilities = component.capabilities
  const buttons = frameButtons(capabilities).filter((button) => {
    if (button === 'copy') return component.copyText !== undefined
    if (button === 'annotate') return annotate !== undefined
    return true
  })
  // The panel has room the pane does not, so its head offers a wrap toggle even
  // where the inline copy has none; the inline copy keeps its own layout.
  const panelButtons = capabilities.panelWrap && !buttons.includes('wrap')
    ? ['wrap' as const, ...buttons]
    : buttons
  const annotateLabel = annotation === undefined ? labels.annotate : labels.edit

  /** One header row; the panel copy swaps the expand button for a close button. */
  const head = (variant: 'inline' | 'panel'): ReactNode => (
    <div className="am-component-head" title={labelVisible ? undefined : label}>
      {icon === undefined ? null : <span className="am-component-icon" aria-hidden="true">{icon}</span>}
      {labelVisible ? <span className="am-component-label">{label}</span> : null}
      {title === undefined || title === '' ? null : <span className="am-component-title">{title}</span>}
      {annotation === undefined ? null : <span className="am-component-seq">#{annotation.seq}</span>}
      {copied ? <span className="am-component-feedback" role="status">{labels.copied}</span> : null}
      <div className="am-component-actions">
        {(variant === 'panel' ? panelButtons : buttons).map((button) => renderButton(button, variant))}
      </div>
    </div>
  )

  const renderButton = (button: FrameButton, variant: 'inline' | 'panel'): ReactNode => {
    switch (button) {
      case 'fullscreen':
        return variant === 'panel'
          ? (
            <button key="fullscreen" ref={closeButton} type="button" className="am-component-action" aria-label={labels.close} title={labels.close} onClick={() => setExpanded(false)}>
              <CloseIcon />
            </button>
          )
          : (
            <button key="fullscreen" ref={expandButton} type="button" className="am-component-action" aria-label={labels.fullscreen} title={labels.fullscreen} aria-expanded={expanded} onClick={() => setExpanded(true)}>
              <ExpandIcon />
            </button>
          )
      case 'wrap':
        return (
          <button key="wrap" type="button" className="am-component-action" aria-label={wrap ? labels.nowrap : labels.wrap} title={wrap ? labels.nowrap : labels.wrap} aria-pressed={wrap} onClick={() => setWrap(value => !value)}>
            <WrapIcon />
          </button>
        )
      case 'annotate':
        return (
          <button
            key="annotate"
            {...(variant === 'panel' ? { ref: annotateButton } : {})}
            type="button"
            className="am-component-action"
            aria-label={annotateLabel}
            title={annotateLabel}
            onClick={() => {
              if (annotate === undefined) return
              // The panel's drawer is laid out for the panel; falling back to the
              // floating editor would place it against the masked document.
              if (variant === 'panel' && panelHooks !== undefined) setPanelAnnotating(true)
              else annotate.inline(block)
            }}
          >
            <AnnotateIcon />
          </button>
        )
      case 'copy':
        return (
          <button key="copy" type="button" className="am-component-action" aria-label={labels.copy} title={labels.copy} onClick={copy}>
            <CopyIcon />
          </button>
        )
    }
  }

  const drawer = expanded && panelAnnotating && panelHooks !== undefined
    ? (
      <PanelAnnotation
        title={panelHooks.labels.title}
        quote={panelHooks.quote(block)}
        initial={annotation?.body ?? ''}
        seq={annotation?.seq}
        labels={panelHooks.labels}
        onSave={(body) => {
          closePanelAnnotation()
          panelHooks.save(block, body)
        }}
        onCancel={closePanelAnnotation}
        {...(annotation !== undefined && panelHooks.remove !== undefined
          ? {
            onDelete: (): void => {
              closePanelAnnotation()
              panelHooks.remove?.(block)
            },
          }
          : {})}
      />
    )
    : null

  // Only the in-place copy opens the panel; the panel's own copy is already open.
  const clickToExpand = capabilities.clickToExpand && capabilities.fullscreen
  return (
    <div className="am-component-slot" data-diff={diff}>
      <div
        className="am-component"
        data-component={component.kind}
        data-block-id={block.id}
        data-block-type={block.type}
        data-source-line={block.sourceStartLine}
        data-annotated={annotation === undefined ? undefined : ''}
        data-family={family}
      >
        {head('inline')}
        <div
          className="am-component-body"
          data-interactive={clickToExpand ? '' : undefined}
          {...(clickToExpand
            ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': labels.fullscreen,
              'aria-expanded': expanded,
              onClick: () => setExpanded(true),
              onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                setExpanded(true)
              },
            }
            : {})}
        >
          {children({ wrap, expanded: false })}
        </div>
        {expanded
          ? (
            <ComponentPanel
              kind={component.kind}
              label={label}
              zoom={capabilities.zoom}
              pan={capabilities.pan}
              returnFocus={expandButton}
              closeButton={closeButton}
              head={head('panel')}
              drawer={drawer}
              closeGuard={closeGuard}
              onClose={() => setExpanded(false)}
            >
              {children({ wrap, expanded: true })}
            </ComponentPanel>
          )
          : null}
      </div>
    </div>
  )
}

interface ComponentPanelProps {
  kind: string
  label: string
  /** A zoomable body gets the dotted stage and the footer its body renders. */
  zoom: boolean
  /** A pannable body shows the grab cursor. */
  pan: boolean
  /** The fullscreen button; focus goes back to it after every close. */
  returnFocus: RefObject<HTMLElement | null>
  /** The close button, which takes focus when the panel opens. */
  closeButton: RefObject<HTMLButtonElement | null>
  /** The shared header row, already bound to this panel's close handler. */
  head: ReactNode
  /** The annotation drawer, layered over the body. */
  drawer?: ReactNode
  /** Runs before Esc closes the panel; true means something inside consumed it. */
  closeGuard?: () => boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Show one component over a full-viewport scrim.
 * Esc, the scrim, and the close button all close it; the panel takes focus on
 * open and hands it back to the button that opened it on close.
 * @param props - the component kind and label, panel behaviour, focus targets, and body.
 * @returns the portal, or null before the document body exists.
 */
function ComponentPanel({ kind, label, zoom, pan, returnFocus, closeButton, head, drawer, closeGuard, onClose, children }: ComponentPanelProps): ReactNode {
  const close = useRef(onClose)
  close.current = onClose
  const guard = useRef(closeGuard)
  guard.current = closeGuard
  useEffect(() => {
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // The open drawer owns the first Esc; the panel closes on the next one.
      if (guard.current?.() === true) {
        event.stopPropagation()
        return
      }
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
  }, [returnFocus, closeButton])
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
        {head}
        <div className="am-component-panel-main">
          <div
            className="am-component-panel-body"
            data-zoom={zoom ? '' : undefined}
            data-pan={pan ? '' : undefined}
          >
            {children}
          </div>
          {drawer}
        </div>
      </div>
    </div>,
    document.body,
  )
}
