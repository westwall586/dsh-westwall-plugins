import { test } from 'node:test'
import assert from 'node:assert/strict'

const { composerButtonVisible, isDesktopGlobal, tabMenuItemVisible } = await import('../client/src/ui/visibility.mjs')

test('the desktop carrier is the only desktop signal', () => {
  assert.equal(isDesktopGlobal({ dshDesktop: { protocolVersion: 1 } }), true)
  assert.equal(isDesktopGlobal({ dshDesktop: { protocolVersion: 2 } }), false)
  assert.equal(isDesktopGlobal({}), false)
})

test('a tab menu row shows only for desktop browser tabs', () => {
  assert.equal(tabMenuItemVisible({ desktop: true, tabKind: 'browser' }), true)
  assert.equal(tabMenuItemVisible({ desktop: false, tabKind: 'browser' }), false)
  assert.equal(tabMenuItemVisible({ desktop: true, tabKind: 'guide' }), false)
  assert.equal(tabMenuItemVisible({ desktop: true, tabKind: undefined }), false)
})

test('the composer button needs a browser tab in this Session', () => {
  const tabs = [
    { sessionId: 's1', tabId: 'b1', kind: 'browser' },
    { sessionId: 's2', tabId: 'b2', kind: 'browser' },
    { sessionId: 's1', tabId: 'g', kind: 'guide' },
  ]
  assert.equal(composerButtonVisible({ desktop: true, sessionId: 's1', tabs }), true)
  assert.equal(composerButtonVisible({ desktop: true, sessionId: 's3', tabs }), false)
  assert.equal(composerButtonVisible({ desktop: false, sessionId: 's1', tabs }), false)
  assert.equal(composerButtonVisible({ desktop: true, sessionId: undefined, tabs }), false)
  assert.equal(composerButtonVisible({
    desktop: true,
    sessionId: 's1',
    tabs: [{ sessionId: 's1', tabId: 'g', kind: 'guide' }],
  }), false)
})