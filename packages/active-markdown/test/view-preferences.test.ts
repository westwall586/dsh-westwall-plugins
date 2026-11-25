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

test('偏好端口带身份：同一个 crate 是同一个 clock，重建后的 crate 是另一个', () => {
  const documents = store()
  documents.mount(REF)
  const first = documents.viewFor(SESSION, PATH)
  assert.ok(first !== null)
  first.toggleCollapsed('h1')
  const clock = first.clock

  // 同一个 crate：再取还是同一个 identity。
  assert.equal(documents.viewFor(SESSION, PATH)?.clock, clock)

  // 切会话回来时 crate 重建：新实例不能再沿用旧的“第一次运行”判断。
  documents.unmount(REF)
  void documents.dispose(SESSION, PATH, 'close')
  const fresh = documents.viewFor(SESSION, PATH)
  assert.notEqual(fresh?.clock, clock)
  assert.deepEqual([...(fresh?.getCollapsed() ?? [])], [])
})

test('折叠只在换文档或换视图时清，同一个 (文档, 视图) 反复调用不清', () => {
  const documents = store()
  documents.mount(REF)
  const preferences = documents.viewFor(SESSION, PATH)
  assert.ok(preferences !== null)
  const identity = documents.crateIdentity(SESSION, PATH)
  assert.ok(identity !== null)

  preferences.resetCollapsedOn(identity, 'source\0a.md')
  preferences.toggleCollapsed('h1')
  assert.deepEqual([...preferences.getCollapsed()], ['h1'])

  // body 重建后带着空状态再调一次：同一个 (文档, 视图) 不该清。
  preferences.resetCollapsedOn(identity, 'source\0a.md')
  assert.deepEqual([...preferences.getCollapsed()], ['h1'], '同一份文档同一个视图不清')

  // 换视图：清。
  preferences.resetCollapsedOn(identity, 'translated\0a.md')
  assert.deepEqual([...preferences.getCollapsed()], [])
})

test('游标同样只在换文档或换视图时归零', () => {
  const documents = store()
  const preferences = documents.viewFor(SESSION, PATH)
  assert.ok(preferences !== null)
  const identity = documents.crateIdentity(SESSION, PATH)
  preferences.resetCursorOn(identity, 'source\0a.md')
  preferences.setUpdateCursor(3)
  preferences.resetCursorOn(identity, 'source\0a.md')
  assert.equal(preferences.getUpdateCursor(), 3, '同一份文档同一个视图不归零')
  preferences.resetCursorOn(identity, 'translated\0a.md')
  assert.equal(preferences.getUpdateCursor(), 0)
})
