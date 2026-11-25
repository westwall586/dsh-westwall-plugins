import test from 'node:test'
import assert from 'node:assert/strict'

import type { HostBridge } from '../client/src/context.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import { sessionOf } from '../client/src/edit/state.ts'

const SESSION = 's1'
const PATH = '/w/a.md'
const REF = { session: SESSION, compose: SESSION, path: PATH }

function store(): ReturnType<typeof createDocumentStore> {
  const host = (async () => ({}) as HostBridge) as () => Promise<HostBridge>
  return createDocumentStore({ host, readingDelayMs: 0 })
}

test('切走再挂回读同一份编辑草稿', () => {
  const documents = store()
  documents.mount(REF)
  const draft = documents.editFor(SESSION, PATH)
  assert.ok(draft !== null)
  draft.reduce({ type: 'enter', text: '原文', version: 'v1', line: 3 })
  draft.reduce({ type: 'change', text: '改过的原文', cursorLine: 7 })
  documents.unmount(REF)

  documents.mount(REF)
  const again = documents.editFor(SESSION, PATH)
  assert.equal(again, draft)
  const state = again?.getState()
  assert.equal(state?.status, 'editing')
  const session = state === undefined ? undefined : sessionOf(state)
  assert.equal(session?.draft, '改过的原文')
  assert.equal(session?.cursorLine, 7)
})

test('草稿的序列号与回滚行随 crate 存活', () => {
  const documents = store()
  documents.mount(REF)
  const draft = documents.editFor(SESSION, PATH)
  assert.equal(draft?.seq, 0)
  draft?.nextSeq()
  draft?.restoreLine.set(12)

  const again = documents.editFor(SESSION, PATH)
  assert.equal(again?.seq, 1)
  assert.equal(again?.restoreLine.peek(), 12)
  assert.equal(again?.restoreLine.take(), 12)
  assert.equal(again?.restoreLine.take(), undefined, '取走一次就没了')
})

test('只有真的变了才通知订阅者，且通知时已能读到新状态', () => {
  const documents = store()
  documents.mount(REF)
  const draft = documents.editFor(SESSION, PATH)
  assert.ok(draft !== null)
  const seen: string[] = []
  // React 的外部 store 在通知里重读快照，所以通知时新状态必须已经可见。
  draft.subscribe(() => { seen.push(draft.getState().status) })
  draft.reduce({ type: 'enter', text: '原文', version: 'v1', line: 1 })
  draft.reduce({ type: 'save' })
  draft.reduce({ type: 'save' })
  draft.reduce({ type: 'exit' })
  assert.deepEqual(seen, ['editing', 'saving', 'reading'], '重复的 save 不通知')
})

test('没被打开过的文档没有编辑草稿', () => {
  const documents = store()
  documents.mount(REF)
  assert.equal(documents.editFor(SESSION, '/w/missing.md'), null)
})
