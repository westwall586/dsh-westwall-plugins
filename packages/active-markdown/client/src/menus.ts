/**
 * The right-click family this renderer contributes: one target per non-empty
 * selection. The shared context menu owns presentation and dismissal; this
 * module maps the captured value back to the body instance that opened it, so
 * two tabs of one document never dispatch to each other.
 */
import type { MenuAction } from './context.ts'
import type { Anchor } from './annotate/model.ts'

export const SELECTION_MENU_KIND = 'activeMarkdown.selection'

export type SelectionView = 'source' | 'translated'

export interface SelectionRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Everything the menu needs after the DOM selection may already be gone. */
export interface SelectionMenuValue {
  readonly instanceId: string
  readonly view: SelectionView
  readonly text: string
  readonly lineStart: number
  readonly lineEnd: number
  readonly rect: SelectionRect
  /** False when the translation is not line-aligned. */
  readonly canShowSource: boolean
  readonly anchor?: Anchor
}

export type SelectionAction = 'annotate' | 'copy' | 'show-source'

export interface SelectionLabels {
  annotate: string
  copy: string
  showSource: string
}

export type SelectionHandler = (value: SelectionMenuValue, action: SelectionAction) => void

const handlers = new Map<string, SelectionHandler>()

/** Register the mounted body for one document instance; returns the unregister function. */
export function registerSelectionHandler(instanceId: string, handler: SelectionHandler): () => void {
  handlers.set(instanceId, handler)
  return () => {
    if (handlers.get(instanceId) === handler) handlers.delete(instanceId)
  }
}

export function dispatchSelection(value: SelectionMenuValue, action: SelectionAction): void {
  handlers.get(value.instanceId)?.(value, action)
}

export function selectionActions(value: SelectionMenuValue, labels: SelectionLabels): readonly MenuAction[] {
  const copy: MenuAction = {
    id: 'copy',
    label: labels.copy,
    run: () => dispatchSelection(value, 'copy'),
  }
  if (value.view === 'translated') {
    return value.canShowSource
      ? [{ id: 'show-source', label: labels.showSource, run: () => dispatchSelection(value, 'show-source') }, copy]
      : [copy]
  }
  if (value.anchor === undefined) return [copy]
  return [
    { id: 'annotate', label: labels.annotate, run: () => dispatchSelection(value, 'annotate') },
    copy,
  ]
}
