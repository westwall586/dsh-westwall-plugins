/** Floating annotation editor: quote preview, textarea, Cmd/Ctrl+Enter save. */
import * as React from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export const ANNOTATION_POPOVER_WIDTH = 320

export interface AnnotationPopoverLabels {
  title: string
  quote: string
  placeholder: string
  save: string
  cancel: string
}

export interface AnnotationPopoverProps {
  left: number
  top: number
  quote: string
  initial: string
  labels: AnnotationPopoverLabels
  onSave(body: string): void
  onCancel(): void
}

export function AnnotationPopover({
  left,
  top,
  quote,
  initial,
  labels,
  onSave,
  onCancel,
}: AnnotationPopoverProps): ReactNode {
  const [body, setBody] = useState(initial)
  const input = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const area = input.current
    if (area === null) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [])
  const canSave = body.trim() !== ''
  const save = (): void => {
    if (!canSave) return
    onSave(body)
  }
  return (
    <div className="am-annotate" style={{ left, top }} role="dialog" aria-label={labels.title}>
      <div className="am-annotate-head">{labels.title}</div>
      <div className="am-annotate-quote-label">{labels.quote}</div>
      <blockquote className="am-annotate-quote">{quote}</blockquote>
      <textarea
        ref={input}
        className="am-annotate-input"
        value={body}
        placeholder={labels.placeholder}
        rows={4}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            return
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            save()
          }
        }}
      />
      <div className="am-annotate-actions">
        <button type="button" className="am-ask-button" onClick={onCancel}>{labels.cancel}</button>
        <button type="button" className="am-ask-button am-annotate-save" disabled={!canSave} onClick={save}>{labels.save}</button>
      </div>
    </div>
  )
}
