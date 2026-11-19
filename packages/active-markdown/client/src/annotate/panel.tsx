/** The annotation drawer inside an expanded component panel, sized to the panel body. */
import * as React from 'react'
import { type ReactNode } from 'react'
import { AnnotationForm, type AnnotationFormLabels } from './form.tsx'

export interface PanelAnnotationProps {
  title: string
  quote: string
  initial: string
  seq: number | undefined
  labels: AnnotationFormLabels
  onSave(body: string): void
  onCancel(): void
  onDelete?: () => void
}

/**
 * Render the panel's annotation drawer over a transparent scrim.
 * The scrim only catches a click outside the drawer; it dims nothing and binds no keys.
 * @param props - the title, quote, starting body, existing seq, copy, and actions.
 * @returns the scrim and the right-hand drawer, or their container once mounted.
 */
export function PanelAnnotation({
  title,
  quote,
  initial,
  seq,
  labels,
  onSave,
  onCancel,
  onDelete,
}: PanelAnnotationProps): ReactNode {
  const stop = (event: React.MouseEvent): void => { event.stopPropagation() }
  return (
    <div className="am-panel-annotation" data-panel-annotation>
      <div className="am-panel-annotation-scrim" data-panel-annotation-scrim onMouseDown={onCancel} />
      <aside
        className="am-panel-annotation-drawer"
        role="dialog"
        aria-label={title}
        onMouseDown={stop}
      >
        <header className="am-panel-annotation-head">
          <span className="am-panel-annotation-title">{title}</span>
          {seq === undefined ? null : <span className="am-panel-annotation-seq">#{seq}</span>}
          <button type="button" className="am-panel-annotation-close" aria-label={labels.cancel} onClick={onCancel}>×</button>
        </header>
        <div className="am-panel-annotation-body">
          <AnnotationForm
            quote={quote}
            initial={initial}
            labels={labels}
            onSave={onSave}
            onCancel={onCancel}
            {...(onDelete === undefined ? {} : { onDelete })}
          />
        </div>
      </aside>
    </div>
  )
}
