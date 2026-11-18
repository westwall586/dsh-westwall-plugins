/** The preview's scroll owner: the first ancestor with its own vertical scroll. */
export function scrollportOf(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null
  while (node !== null) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
    node = node.parentElement
  }
  return null
}
