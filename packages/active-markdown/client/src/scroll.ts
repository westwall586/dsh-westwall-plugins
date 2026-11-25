/**
 * The preview's scroll owner. The documented body (`.am-root`) is its own
 * scroller, so the nearest ancestor with a vertical scroll is that body
 * itself; a fallback chain keeps callers correct inside the editor, whose
 * `.cm-scroller` owns its own overflow.
 *
 * Reading position lives with the document body, so the ancestors above it
 * are walls, not scroll owners: the host's `[data-textpreview-body]` scroller
 * must stay at 0 or the body would be scrolled by two nested containers.
 */
export function scrollportOf(element: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = element
  while (node !== null) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
    if (node.hasAttribute('data-active-markdown') || node.hasAttribute('data-textpreview-body')) return null
    node = node.parentElement
  }
  return null
}
