import test from 'node:test'
import assert from 'node:assert/strict'

import { createDocumentStore } from '../client/src/store/document.ts'
import { createReading, createReadingSlot, type Reading } from '../client/src/store/kernel/reading.ts'
import type { HostBridge } from '../client/src/context.ts'

const REF = { session: 's1', compose: 's1', path: '/w/a.md' }

function store(): ReturnType<typeof createDocumentStore> {
  const host = (async () => ({}) as HostBridge) as () => Promise<HostBridge>
  return createDocumentStore({ host, readingDelayMs: 0 })
}

function reading(delayMs = 0): { reading: Reading, changes: number[] } {
  const slot = createReadingSlot()
  const changes: number[] = []
  slot.listeners.add(() => { changes.push(slot.source) })
  return { reading: createReading({ slot, delayMs }), changes }
}

test('原文与译文各记各的位置，互不覆盖', () => {
  const { reading: port } = reading()
  port.record('source', 700)
  port.record('translated', 120)

  assert.equal(port.get('source'), 700)
  assert.equal(port.get('translated'), 120)
})

test('节流窗口内的多次滚动只落最后一次，flush 立刻生效', async () => {
  const { reading: port } = reading(50)
  port.record('source', 10)
  port.record('source', 20)
  port.record('source', 30)
  assert.equal(port.get('source'), 30, '读到的仍是挂起的值')

  port.flush()
  assert.equal(port.get('source'), 30)
  await new Promise((resolve) => { setTimeout(resolve, 60) })
  assert.equal(port.get('source'), 30)
})

test('同样的位置不重复通知', () => {
  const { reading: port, changes } = reading()
  port.record('source', 40)
  port.record('source', 40)
  port.record('source', 41)
  assert.deepEqual(changes, [40, 41])
})

test('clear 把两个视图都归零', () => {
  const { reading: port } = reading()
  port.record('source', 90)
  port.record('translated', 60)
  port.clear()

  assert.equal(port.get('source'), 0)
  assert.equal(port.get('translated'), 0)
})

test('dispose 丢掉挂起的写入，不留下已卸载文档的位置', () => {
  const slot = createReadingSlot()
  const port = createReading({ slot, delayMs: 10 })
  port.record('source', 500)
  port.dispose()
  assert.equal(slot.source, 0)
})

test('切走再挂回读同一个 crate 的位置', () => {
  const documents = store()
  documents.mount(REF)
  documents.readingFor(REF.session, REF.path)?.record('source', 640)
  documents.unmount(REF)

  documents.mount(REF)
  assert.equal(documents.readingFor(REF.session, REF.path)?.get('source'), 640)
})

test('没被打开过的文档没有阅读位置', () => {
  assert.equal(store().readingFor('s1', '/w/missing.md'), null)
})
