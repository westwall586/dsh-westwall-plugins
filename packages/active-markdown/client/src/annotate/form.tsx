/** The annotation editor form: quote preview, textarea, and save/cancel/delete actions. */
import * as React from 'react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface AnnotationFormLabels {
  quote: string
  placeholder: string
  save: string
  cancel: string
  delete?: string
}

/** The form labels plus the dialog title the popover and the panel drawer both show. */
export interface AnnotationLabels extends AnnotationFormLabels {
  title: string
}

export interface AnnotationFormProps {
  quote: string
  initial: string
  labels: AnnotationFormLabels
  /** Present only when editing an annotation that already exists. */
  onDelete?: () => void
  onSave(body: string): void
  onCancel(): void
}

/**
 * Render one annotation editor, shared by the floating popover and the panel drawer.
 * @param props - the quote, the starting body, copy, and the three actions.
 * @returns the form fields and their action row.
 */
export function AnnotationForm({ quote, initial, labels, onDelete, onSave, onCancel }: AnnotationFormProps): ReactNode {
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
    <>
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
        {onDelete === undefined
          ? null
          : <button type="button" className="am-annotate-delete" aria-label={labels.delete} onClick={onDelete}>{labels.delete}</button>}
        <button type="button" className="am-ask-button" onClick={onCancel}>{labels.cancel}</button>
        <button type="button" className="am-ask-button am-annotate-save" disabled={!canSave} onClick={save}>{labels.save}</button>
      </div>
    </>
  )
}
