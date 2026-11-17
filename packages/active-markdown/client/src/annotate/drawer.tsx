/** The annotation drawer: grouped by heading path, with locate, edit, delete and attach. */
import * as React from 'react'
import type { ReactNode } from 'react'
import type { Annotation, PendingReview } from './model.ts'
import type { AnnotationPersistence } from './store.ts'

export interface AnnotationDrawerLabels {
  title: string
  empty: string
  clear: string
  locate: string
  edit: string
  delete: string
  missing: string
  memory: string
  tooLarge: string
  readOnly: string
  top: string
  attach: string
  attached: string
  removeAttachment: string
  line(line: number): string
  range(start: number, end: number): string
}

export interface AnnotationDrawerProps {
  open: boolean
  annotations: readonly Annotation[]
  /** True in the translated view: locate still works, editing does not. */
  readOnly: boolean
  located: ReadonlyMap<string, boolean>
  persistence: AnnotationPersistence
  /** One pending review per document; its id must be in the composer to count as attached. */
  pending: PendingReview | null
  attached: boolean
  /** The composer is sending or running a command; edits and attach wait. */
  busy: boolean
  attachError: string | null
  labels: AnnotationDrawerLabels
  onClose(): void
  onLocate(annotation: Annotation): void
  onEdit(annotation: Annotation): void
  onDelete(annotation: Annotation): void
  onClear(): void
  onAttach(): void
  onRemoveAttachment(): void
}

interface Section {
  title: string
  annotations: Annotation[]
}

/** Group in first-seen order so the list follows the document. */
function groupBySection(annotations: readonly Annotation[], top: string): Section[] {
  const sections = new Map<string, Annotation[]>()
  for (const annotation of annotations) {
    const title = annotation.section === '' ? top : annotation.section
    const list = sections.get(title)
    if (list === undefined) sections.set(title, [annotation])
    else list.push(annotation)
  }
  return [...sections].map(([title, list]) => ({ title, annotations: list }))
}

export function AnnotationDrawer({
  open,
  annotations,
  readOnly,
  located,
  persistence,
  pending,
  attached,
  busy,
  attachError,
  labels,
  onClose,
  onLocate,
  onEdit,
  onDelete,
  onClear,
  onAttach,
  onRemoveAttachment,
}: AnnotationDrawerProps): ReactNode {
  if (!open) return null
  return (
    <>
      <div className="am-drawer-scrim" onClick={onClose} />
      <aside className="am-drawer" role="dialog" aria-modal="false" aria-label={labels.title}>
        <header className="am-drawer-head">
          <span className="am-drawer-title">{labels.title}</span>
          <span className="am-drawer-count">{annotations.length}</span>
          <button type="button" className="am-drawer-close" aria-label={labels.title} onClick={onClose}>×</button>
        </header>
        {annotations.length === 0
          ? <p className="am-drawer-empty">{labels.empty}</p>
          : (
            <div className="am-drawer-list">
              {groupBySection(annotations, labels.top).map(section => (
                <section key={section.title} className="am-drawer-section">
                  <div className="am-drawer-section-title">{section.title}</div>
                  {section.annotations.map(annotation => {
                    const placeable = located.get(annotation.id) === true
                    return (
                      <article key={annotation.id} className="am-drawer-item" data-missing={placeable ? undefined : ''}>
                        <div className="am-drawer-item-head">
                          <span className="am-drawer-seq">{annotation.seq}</span>
                          <span className="am-drawer-lines">
                            {annotation.lineStart === annotation.lineEnd
                              ? labels.line(annotation.lineStart)
                              : labels.range(annotation.lineStart, annotation.lineEnd)}
                          </span>
                          {placeable ? null : <span className="am-drawer-missing">{labels.missing}</span>}
                        </div>
                        <blockquote className="am-drawer-quote">{annotation.quote}</blockquote>
                        <p className="am-drawer-body">{annotation.body}</p>
                        <div className="am-drawer-actions">
                          <button type="button" className="am-drawer-action" disabled={!placeable} onClick={() => onLocate(annotation)}>
                            {labels.locate}
                          </button>
                          {readOnly ? null : (
                            <button type="button" className="am-drawer-action" disabled={busy} onClick={() => onEdit(annotation)}>
                              {labels.edit}
                            </button>
                          )}
                          {readOnly ? null : (
                            <button type="button" className="am-drawer-action am-drawer-delete" disabled={busy} onClick={() => onDelete(annotation)}>
                              {labels.delete}
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </section>
              ))}
            </div>
          )}
        <footer className="am-drawer-foot">
          {attachError === null ? null : <span className="am-drawer-warning">{attachError}</span>}
          {persistence === 'memory' ? <span className="am-drawer-warning">{labels.memory}</span> : null}
          {persistence === 'too-large' ? <span className="am-drawer-warning">{labels.tooLarge}</span> : null}
          {readOnly ? <span className="am-drawer-note">{labels.readOnly}</span> : null}
          <div className="am-drawer-attach">
            {attached
              ? (
                <>
                  <span className="am-drawer-attached">{labels.attached}</span>
                  <button type="button" className="am-drawer-action" disabled={busy} onClick={onRemoveAttachment}>
                    {labels.removeAttachment}
                  </button>
                </>
              )
              : (
                <button
                  type="button"
                  className="am-drawer-attach-action"
                  disabled={busy || annotations.length === 0}
                  onClick={onAttach}
                >
                  {labels.attach}
                </button>
              )}
          </div>
          {readOnly || annotations.length === 0
            ? null
            : <button type="button" className="am-drawer-clear" disabled={busy} onClick={onClear}>{labels.clear}</button>}
        </footer>
      </aside>
    </>
  )
}
