import { test } from 'node:test'
import assert from 'node:assert/strict'

const { MAX_HTML_BYTES, captureActivePage, findActiveWebview, isWebviewLoading } = await import('../client/src/webview.mjs')

function webview(options = {}) {
  const {
    url = 'https://example.com/article',
    hidden = false,
    paneActive = false,
    loading = false,
    result = { title: 'Article', url, html: '<html><body>article</body></html>', text: 'article' },
    execute,
  } = options
  return {
    isConnected: true,
    src: url,
    closest(selector) {
      if (selector === '[hidden], [aria-hidden="true"]') return hidden ? {} : null
      if (selector === '[data-dockkit-pane-active]') return paneActive ? {} : null
      return null
    },
    getURL() { return url },
    isLoading() { return loading },
    executeJavaScript: execute ?? (async () => result),
  }
}

function docOf(webviews) {
  return { querySelectorAll: (selector) => {
    assert.equal(selector, 'webview[data-sidebar-browser-frame="webview"]')
    return webviews
  } }
}

test('skips hidden keep-mounted tabs and prefers the active pane', () => {
  const hiddenTab = webview({ url: 'https://example.com/hidden', hidden: true })
  const first = webview({ url: 'https://example.com/first' })
  const active = webview({ url: 'https://example.com/active', paneActive: true })
  assert.equal(findActiveWebview(docOf([hiddenTab, first, active])), active)
})

test('falls back to the first visible guest when no pane reports active', () => {
  const first = webview({ url: 'https://example.com/first' })
  const second = webview({ url: 'https://example.com/second' })
  assert.equal(findActiveWebview(docOf([first, second])), first)
})

test('ignores about: pages', async () => {
  const blank = webview({ url: 'about:blank#lease' })
  assert.equal(findActiveWebview(docOf([blank])), undefined)
  assert.deepEqual(await captureActivePage({ doc: docOf([blank]) }), { ok: false, code: 'no-page' })
})

test('returns no-page when the sidebar has no browser guest', async () => {
  assert.deepEqual(await captureActivePage({ doc: docOf([]) }), { ok: false, code: 'no-page' })
})

test('fails while the guest is still loading', async () => {
  const loading = webview({ loading: true })
  assert.deepEqual(await captureActivePage({ doc: docOf([loading]) }), { ok: false, code: 'page-loading' })
})

test('captures title, final URL, html and text together', async () => {
  const guest = webview({ result: { title: 'Page', url: 'https://example.com/final', html: '<html>x</html>', text: 'x' } })
  const result = await captureActivePage({ doc: docOf([guest]) })
  assert.equal(result.ok, true)
  assert.deepEqual(result.page, {
    title: 'Page',
    url: 'https://example.com/final',
    html: '<html>x</html>',
    text: 'x',
    truncated: false,
  })
})

test('the guest script enforces the HTML cap before crossing IPC', async () => {
  let script
  const guest = webview({
    execute: async (source) => {
      script = source
      return { title: 'Page', url: 'https://example.com/final', html: '', text: 'x', truncated: true }
    },
  })
  const result = await captureActivePage({ doc: docOf([guest]) })
  assert.match(script, /TextEncoder/)
  assert.ok(script.includes(String(MAX_HTML_BYTES)))
  assert.equal(result.page.truncated, true)
})

test('falls back to innerText above the 4 MB HTML cap', async () => {
  const guest = webview({ result: {
    title: 'Huge',
    url: 'https://example.com/huge',
    html: 'x'.repeat(MAX_HTML_BYTES + 1),
    text: 'visible text',
  } })
  const result = await captureActivePage({ doc: docOf([guest]) })
  assert.equal(result.ok, true)
  assert.equal(result.page.truncated, true)
  assert.equal(result.page.html, '')
  assert.equal(result.page.text, 'visible text')
})

test('reports a capture timeout', async () => {
  const guest = webview({ execute: () => new Promise(() => {}) })
  const result = await captureActivePage({ doc: docOf([guest]), timeoutMs: 10 })
  assert.deepEqual(result, { ok: false, code: 'capture-timeout' })
})

test('reports a guest exception as capture-failed', async () => {
  const guest = webview({ execute: async () => { throw new Error('guest crashed') } })
  const result = await captureActivePage({ doc: docOf([guest]) })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'capture-failed')
  assert.equal(result.detail, 'guest crashed')
})
test('the loading flag is read without throwing for a missing guest method', () => {
  assert.equal(isWebviewLoading(webview({ loading: true })), true)
  assert.equal(isWebviewLoading(webview({ loading: false })), false)
  assert.equal(isWebviewLoading({ isLoading() { throw new Error('not ready') } }), false)
  assert.equal(isWebviewLoading(undefined), false)
})
