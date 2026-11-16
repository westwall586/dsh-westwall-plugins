/**
 * The right-click family this renderer contributes: one target per source line.
 * The shared context menu owns presentation and dismissal; this module only maps
 * a captured target back to the body instance that can show it.
 */
export const LINE_MENU_KIND = 'activeMarkdown.line'

/** Immutable identifier of one clicked source line. */
export interface LineMenuValue {
  readonly docId: string
  readonly line: number
}

const handlers = new Map<string, (line: number) => void>()

/** Register the mounted body for one document; returns the unregister function. */
export function registerLineHandler(docId: string, handler: (line: number) => void): () => void {
  handlers.set(docId, handler)
  return () => {
    if (handlers.get(docId) === handler) handlers.delete(docId)
  }
}

/** Run the action a menu click selected, against the body that owns that document. */
export function lookUpSource(value: LineMenuValue | undefined): void {
  if (value === undefined) return
  handlers.get(value.docId)?.(value.line)
}
