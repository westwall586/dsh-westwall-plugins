/**
 * Locate the page the user is reading in the desktop right-sidebar browser and
 * read its rendered DOM through the Electron webview tag.
 *
 * Hidden tabs stay mounted, so selection must ignore them and prefer the active
 * pane. Everything here returns a result object; callers never see throws.
 */

/** Stable host attributes for the desktop browser guest. */
export const WEBVIEW_SELECTOR = 'webview[data-sidebar-browser-frame="webview"]'
export const MAX_HTML_BYTES = 4 * 1024 * 1024
export const CAPTURE_TIMEOUT_MS = 8000

/** Serialize in the guest so an oversized page never crosses the IPC boundary. */
const serializeScript = (maxBytes) => `(() => {
  const html = document.documentElement.outerHTML
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(html).length : html.length
  const truncated = bytes > ${maxBytes}
  return {
    html: truncated ? '' : html,
    text: (document.body && document.body.innerText) || '',
    url: location.href,
    title: document.title,
    truncated,
  }
})()`
const TIMED_OUT = Symbol('capture-timeout')

const failure = (code, detail) => (detail === undefined ? { ok: false, code } : { ok: false, code, detail })

/** A hidden pane or an `about:` document is not a page the user can clip. */
function isHidden(element) {
  return element.closest?.('[hidden], [aria-hidden="true"]') !== null
}

function readUrl(element) {
  try {
    if (typeof element.getURL === 'function') {
      const url = element.getURL()
      if (typeof url === 'string' && url !== '') return url
    }
  } catch {
    // The guest is not ready; fall back to the configured source below.
  }
  const source = element.getAttribute?.('src') ?? element.src
  return typeof source === 'string' ? source : ''
}

/** @returns the active visible guest, or the first visible one. */
export function findActiveWebview(doc = document) {
  const candidates = [...doc.querySelectorAll(WEBVIEW_SELECTOR)]
    .filter((element) => element.isConnected !== false)
    .filter((element) => !isHidden(element))
    .filter((element) => !/^about:/i.test(readUrl(element)))
  if (candidates.length === 0) return undefined
  return candidates.find((element) => element.closest?.('[data-dockkit-pane-active]') !== null) ?? candidates[0]
}

export function isWebviewLoading(element) {
  try {
    return typeof element.isLoading === 'function' && element.isLoading() === true
  } catch {
    return false
  }
}

/** UTF-8 size of the serialized page; the 4 MB cap is about bytes, not characters. */
function byteLength(text) {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length
}

async function withTimeout(promise, timeoutMs) {
  let timer
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param options - `{ doc, webview, timeoutMs }`; `webview` is a test seam.
 * @returns `{ ok: true, page }` or `{ ok: false, code, detail? }`.
 */
export async function captureActivePage(options = {}) {
  const { doc = globalThis.document, webview, timeoutMs = CAPTURE_TIMEOUT_MS } = options
  const target = webview ?? findActiveWebview(doc)
  if (target === undefined) return failure('no-page')
  if (isWebviewLoading(target)) return failure('page-loading')

  let raw
  try {
    raw = await withTimeout(target.executeJavaScript(serializeScript(MAX_HTML_BYTES), false), timeoutMs)
  } catch (error) {
    return failure('capture-failed', error instanceof Error ? error.message : String(error))
  }
  if (raw === TIMED_OUT) return failure('capture-timeout')
  if (raw === null || typeof raw !== 'object') return failure('capture-failed', 'empty capture')

  const text = String(raw.text ?? '')
  const html = String(raw.html ?? '')
  const truncated = raw.truncated === true || byteLength(html) > MAX_HTML_BYTES
  return {
    ok: true,
    page: {
      title: String(raw.title ?? ''),
      url: String(raw.url || readUrl(target) || ''),
      html: truncated ? '' : html,
      text,
      truncated,
    },
  }
}