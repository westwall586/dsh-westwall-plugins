/**
 * Small feedback host for clip results. It mirrors the host toast shape without
 * importing host packages, and every color comes from a theme token.
 */

const DISMISS_MS = 4000

/**
 * @param t - locale translate function (region label).
 * @param deps - test seams `{ document, setTimeout, clearTimeout }`.
 * @returns `{ show, dispose }`.
 */
export function createToastHost(t, deps = {}) {
  const doc = deps.document ?? document
  const schedule = deps.setTimeout ?? globalThis.setTimeout.bind(globalThis)
  const cancel = deps.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
  let container = null

  function ensureContainer() {
    if (container === null || !container.isConnected) {
      container = doc.createElement('div')
      container.className = 'dwc-toasts'
      container.setAttribute('role', 'region')
      container.setAttribute('aria-label', t('toast.region'))
      doc.body.append(container)
    }
    return container
  }

  return {
    show(message, kind = 'success') {
      const element = doc.createElement('div')
      element.className = `dwc-toast dwc-toast--${kind}`
      element.setAttribute('role', 'status')
      element.textContent = message
      ensureContainer().append(element)
      const timer = schedule(() => { element.remove() }, DISMISS_MS)
      element.addEventListener('click', () => {
        cancel(timer)
        element.remove()
      })
    },

    dispose() {
      container?.remove()
      container = null
    },
  }
}