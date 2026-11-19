/** Floating annotation editor: a positioned shell around the shared annotation form. */
import * as React from 'react'
import type { ReactNode } from 'react'
import { AnnotationForm, type AnnotationLabels } from './form.tsx'

export const ANNOTATION_POPOVER_WIDTH = 320

export interface AnnotationPopoverProps {
  left: number
  top: number
  above: boolean
  panelRef?: React.Ref<HTMLDivElement>
  quote: string
  initial: string
  labels: AnnotationLabels
  onSave(body: string): void
  onCancel(): void
}

export function AnnotationPopover({
  left,
  top,
  above,
  panelRef,
  quote,
  initial,
  labels,
  onSave,
  onCancel,
}: AnnotationPopoverProps): ReactNode {
  return (
    <div ref={panelRef} className="am-annotate" style={{ left, top }} data-above={above ? 'true' : 'false'} role="dialog" aria-label={labels.title}>
      <div className="am-annotate-head">{labels.title}</div>
      <AnnotationForm quote={quote} initial={initial} labels={labels} onSave={onSave} onCancel={onCancel} />
    </div>
  )
}
