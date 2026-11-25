import test from 'node:test'
import assert from 'node:assert/strict'

import type { HostBridge } from '../client/src/context.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import { createPreferences, createPreferencesSlot } from '../client/src/store/kernel/preferences.ts'

const SESSION = 's1'
const PATH = '/w/a.md'
const REF = { session: SESSION, compose: SESSION, path: PATH }

function store(): ReturnType<typeof createDocumentStore> {
  const host = (async () => ({}) as HostBridge) as () => Promise<HostBridge>
  return createDocumentStore({ host, readingDelayMs: 0 })
}

test('折叠一节，再折一次展开', () => {
  const preferences = createPreferences(createPreferencesSlot())
  preferences.toggleCollapsed('h1')
  assert.deepEqual([...preferences.getCollapsed()], ['h1'])
  preferences.toggleCollapsed('h2')
  assert.deepEqual([...preferences.getCollapsed()].sort(), ['h1', 'h2'])
  preferences.toggleCollapsed('h1')
  assert.deepEqual([...preferences.getCollapsed()], ['h2'])
})

test('每次折叠换一个新集合，订阅者才会重渲染', () => {
  const preferences = createPreferences(createPreferencesSlot())
  preferences.toggleCollapsed('h1')
  const first = preferences.getCollapsed()
  preferences.toggleCollapsed('h2')
  assert.notEqual(preferences.getCollapsed(), first)
})

test('切走再挂回读同一份视图偏好', () => {
  const documents = store()
  documents.mount(REF)
  const preferences = documents.viewFor(SESSION, PATH)
  assert.ok(preferences !== null)
  preferences.toggleCollapsed('h1')
  preferences.setUpdateCursor(3)
  documents.unmount(REF)

  documents.mount(REF)
  const again = documents.viewFor(SESSION, PATH)
  assert.equal(again, preferences)
  assert.deepEqual([...again!.getCollapsed()], ['h1'])
  assert.equal(again!.getUpdateCursor(), 3)
})

test('游标与折叠落到同一个订阅上', () => {
  const preferences = createPreferences(createPreferencesSlot())
  const seen: string[] = []
  preferences.subscribe(() => { seen.push(`${[...preferences.getCollapsed()].join(',')}|${preferences.getUpdateCursor()}`) })
  preferences.toggleCollapsed('h1')
  preferences.setUpdateCursor(2)
  preferences.setUpdateCursor(2)
  preferences.setCollapsed(new Set())
  assert.deepEqual(seen, ['h1|0', 'h1|2', '|2'])
})
