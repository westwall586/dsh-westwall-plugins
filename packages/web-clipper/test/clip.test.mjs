import { test } from 'node:test'
import assert from 'node:assert/strict'

const { createClipper, resolveTarget } = await import('../client/src/clip.mjs')

const FIXED = new Date(2026, 10, 14, 12, 30, 0)
const PAGE = { title: 'T', url: 'https://example.com/a', html: '<html><body>x</body></html>', text: '', truncated: false }

function artifact(overrides = {}) {
  return {
    kind: 'markdown',
    title: 'T',
    url: 'https://example.com/a',
    name: 'T.md',
    type: 'text/markdown',
    content: 'body',
    ...overrides,
  }
}

function setup(overrides = {}) {
  const toasts = []
  const focused = []
  let activeTab = { id: 'b1', kind: 'browser' }
  const deps = {
    capture: async () => ({ ok: true, page: PAGE }),
    extract: () => artifact(),
    attach: async () => ({ ok: true, mode: 'draft' }),
    toast: { show: (message, kind) => toasts.push({ message, kind }) },
    t: (key, params) => (params?.title === undefined ? key : `${key}:${params.title}`),
    sidebarRight: {
      active: () => activeTab,
      openTabs: { getSnapshot: () => [{ sessionId: 's1', tabId: 'b1', kind: 'browser' }] },
      focus: (id) => {
        focused.push(id)
        activeTab = { id, kind: 'browser' }
      },
    },
    conversationFor: () => undefined,
    desktop: () => true,
    now: () => FIXED,
    waitFrames: async () => {},
    ...overrides,
  }
  return { deps, toasts, focused }
}

test('success returns the shared result shape and a titled toast', async () => {
  const { deps, toasts } = setup()
  const clipper = createClipper(deps)
  const result = await clipper.clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(result, { ok: true, title: 'T', fileName: 'T.md', mode: 'draft' })
  assert.deepEqual(toasts, [{ message: 'toast.success:T', kind: 'success' }])
})

test('the capture-start time is the clipped_at input', async () => {
  let seen
  const { deps } = setup({ extract: (_page, options) => { seen = options; return artifact() } })
  await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(seen.clippedAt, FIXED)
})

test('a full-page fallback uses the full-page toast', async () => {
  const { deps, toasts } = setup({ extract: () => artifact({ kind: 'full-page', name: 'T.html', type: 'text/html' }) })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, true)
  assert.deepEqual(toasts, [{ message: 'toast.successFullPage:T', kind: 'success' }])
})

test('no browser tab reports no-page without capturing', async () => {
  let captured = false
  const { deps, toasts } = setup({
    capture: async () => { captured = true; return { ok: true, page: PAGE } },
    sidebarRight: {
      active: () => ({ id: 'g', kind: 'guide' }),
      openTabs: { getSnapshot: () => [{ sessionId: 's1', tabId: 'g', kind: 'guide' }] },
      focus: () => {},
    },
  })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(result, { ok: false, code: 'no-page' })
  assert.equal(captured, false)
  assert.deepEqual(toasts, [{ message: 'error.no-page', kind: 'error' }])
})

test('a loading page keeps its error code', async () => {
  const { deps, toasts } = setup({ capture: async () => ({ ok: false, code: 'page-loading' }) })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(result, { ok: false, code: 'page-loading' })
  assert.deepEqual(toasts, [{ message: 'error.page-loading', kind: 'error' }])
})

test('a capture failure keeps its detail', async () => {
  const { deps } = setup({ capture: async () => ({ ok: false, code: 'capture-failed', detail: 'guest boom' }) })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(result, { ok: false, code: 'capture-failed', detail: 'guest boom' })
})

test('the busy guard refuses a concurrent clip', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { deps } = setup({
    capture: async () => { await gate; return { ok: true, page: PAGE } },
  })
  const clipper = createClipper(deps)
  const first = clipper.clip({ sessionId: 's1', inputActions: {} })
  const second = await clipper.clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(second, { ok: false, code: 'busy' })
  release()
  assert.equal((await first).ok, true)
})

test('a busy composer surfaces composer-busy', async () => {
  const { deps, toasts } = setup({ attach: async () => ({ ok: false, code: 'composer-busy' }) })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(result, { ok: false, code: 'composer-busy' })
  assert.deepEqual(toasts, [{ message: 'error.composer-busy', kind: 'error' }])
})

test('an extractor throw maps to extract-failed', async () => {
  const { deps } = setup({ extract: () => { throw new Error('kernel boom') } })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'extract-failed')
  assert.equal(result.detail, 'kernel boom')
})

test('Web reports desktop-only and shows no toast', async () => {
  const { deps, toasts } = setup({ desktop: () => false })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.deepEqual(result, { ok: false, code: 'desktop-only' })
  assert.deepEqual(toasts, [])
})

test('the composer entry focuses the first browser tab when the active tab is not one', async () => {
  const focused = []
  let activeTab = { id: 'g', kind: 'guide' }
  const { deps } = setup({
    sidebarRight: {
      active: () => activeTab,
      openTabs: { getSnapshot: () => [
        { sessionId: 's1', tabId: 'b1', kind: 'browser' },
        { sessionId: 's1', tabId: 'b2', kind: 'browser' },
      ] },
      focus: (id) => {
        focused.push(id)
        activeTab = { id, kind: 'browser' }
      },
    },
  })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, true)
  assert.deepEqual(focused, ['b1'])
})

test('a tab that never becomes active is refused instead of clipping another page', async () => {
  const { deps, toasts } = setup({
    sidebarRight: {
      active: () => ({ id: 'b1', kind: 'browser' }),
      openTabs: { getSnapshot: () => [] },
      focus: () => {},
    },
  })
  const result = await createClipper(deps).clip({
    sessionId: 's1',
    inputActions: {},
    tab: { id: 'b9', kind: 'browser' },
  })
  assert.deepEqual(result, { ok: false, code: 'no-page', detail: 'target tab did not become active' })
  assert.deepEqual(toasts, [{ message: 'error.no-page', kind: 'error' }])
})

test('a collapsed sidebar is expanded before capture', async () => {
  let expanded = false
  let toggles = 0
  let activeTab = { id: 'b1', kind: 'browser' }
  const { deps } = setup({
    sidebarRight: {
      active: () => activeTab,
      openTabs: { getSnapshot: () => [{ sessionId: 's1', tabId: 'b1', kind: 'browser' }] },
      focus: (id) => { activeTab = { id, kind: 'browser' } },
      isExpanded: () => expanded,
      toggleExpanded: () => { toggles += 1; expanded = true },
    },
  })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, true)
  assert.equal(toggles, 1)
})

test('the tab entry focuses its own tab even when another tab is active', async () => {
  const { deps, focused } = setup()
  const result = await createClipper(deps).clip({
    sessionId: 's1',
    inputActions: {},
    tab: { id: 'b9', kind: 'browser' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(focused, ['b9'])
})

test('the tab entry refuses a non-browser tab', async () => {
  const { deps, focused } = setup()
  const result = await createClipper(deps).clip({
    sessionId: 's1',
    inputActions: {},
    tab: { id: 'g', kind: 'guide' },
  })
  assert.deepEqual(result, { ok: false, code: 'no-page' })
  assert.deepEqual(focused, [])
})

test('two frames are awaited before capture', async () => {
  let frames = 0
  const { deps } = setup({ waitFrames: async () => { frames += 1 } })
  await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(frames, 1)
})

test('resolveTarget prefers the active browser tab, then this Session first browser tab', () => {
  assert.deepEqual(resolveTarget({
    active: () => ({ id: 'b2', kind: 'browser' }),
    openTabs: { getSnapshot: () => [] },
  }, 's1'), { tabId: 'b2', kind: 'browser' })
  assert.deepEqual(resolveTarget({
    active: () => ({ id: 'g', kind: 'guide' }),
    openTabs: { getSnapshot: () => [{ sessionId: 's1', tabId: 'b1', kind: 'browser' }] },
  }, 's1'), { tabId: 'b1', kind: 'browser' })
  assert.equal(resolveTarget({
    active: () => ({ id: 'g', kind: 'guide' }),
    openTabs: { getSnapshot: () => [] },
  }, 's1'), undefined)
})
test('a readable copy is saved before the attachment is added', async () => {
  const order = []
  const { deps } = setup({
    copy: {
      save: async (name, content) => {
        order.push(`copy:${name}:${content}`)
        return { ok: true, path: '/tmp/T.md', directory: '/tmp', isDefault: true }
      },
    },
    attach: async () => {
      order.push('attach')
      return { ok: true, mode: 'draft' }
    },
  })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, true)
  assert.deepEqual(order, ['copy:T.md:body', 'attach'])
})

test('a copy failure warns but still adds the attachment', async () => {
  const { deps, toasts } = setup({
    copy: { save: async () => ({ ok: false, code: 'write-failed', detail: 'disk full' }) },
  })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, true)
  assert.equal(toasts.length, 2)
  assert.equal(toasts[0].kind, 'warning')
  assert.equal(toasts[0].message, 'toast.copyFailed')
  assert.equal(toasts[1].kind, 'success')
})

test('a copy throw also warns and keeps the attachment', async () => {
  const { deps, toasts } = setup({
    copy: { save: async () => { throw new Error('remote offline') } },
  })
  const result = await createClipper(deps).clip({ sessionId: 's1', inputActions: {} })
  assert.equal(result.ok, true)
  assert.equal(toasts[0].kind, 'warning')
  assert.equal(toasts[1].kind, 'success')
})
