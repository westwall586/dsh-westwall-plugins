import test from 'node:test'
import assert from 'node:assert/strict'

import { createAnnotationStore, type DraftKey } from '../client/src/annotate/store.ts'
import type { Annotation, AnnotationDraft, AnnotationSaveView } from '../client/src/annotate/model.ts'
import type { HostBridge, AnnotationSaveRequest, AnnotationLoadRequest } from '../client/src/context.ts'

function annotation(seq: number, body = '意见'): Annotation {
  return {
    id: `a${seq}`,
    seq,
    kind: 'text',
    body,
    quote: '原文',
    prefix: '',
    suffix: '',
    startOffset: 0,
    blockStartId: 'paragraph-1',
    blockEndId: 'paragraph-1',
    blockSignature: '',
    section: '',
    lineStart: 1,
    lineEnd: 1,
    createdAt: '2026-11-17T00:00:00.000Z',
  }
}

function draft(annotations: Annotation[], nextSeq: number): AnnotationDraft {
  return {
    sessionId: 's1',
    path: '/w/a.md',
    annotations,
    nextSeq,
    createdAt: '2026-11-17T00:00:00.000Z',
    updatedAt: '2026-11-17T00:00:00.000Z',
  }
}

interface FakeHost {
  host: HostBridge
  loads: AnnotationLoadRequest[]
  saves: AnnotationSaveRequest[]
  clears: AnnotationLoadRequest[]
  loadResult: AnnotationDraft | null
  loadError: Error | null
  loadGate: Promise<void> | null
  saveResult: AnnotationSaveView
  saveError: Error | null
  saveGate: Promise<void> | null
}

function fakeHost(): FakeHost {
  const state: FakeHost = {
    loads: [],
    saves: [],
    clears: [],
    loadResult: null,
    loadError: null,
    loadGate: null,
    saveResult: { status: 'saved', durable: true },
    saveError: null,
    saveGate: null,
    host: {} as HostBridge,
  }
  state.host = {
    async annotationLoad(request: AnnotationLoadRequest) {
      state.loads.push(request)
      if (state.loadGate !== null) await state.loadGate
      if (state.loadError !== null) throw state.loadError
      return state.loadResult
    },
    async annotationSave(request: AnnotationSaveRequest) {
      state.saves.push(request)
      if (state.saveGate !== null) await state.saveGate
      if (state.saveError !== null) throw state.saveError
      return state.saveResult
    },
    async annotationClear(request: AnnotationLoadRequest) {
      state.clears.push(request)
      return {}
    },
    async annotationPending() {
      return []
    },
  } as unknown as HostBridge
  return state
}

function key(sessionId = 's1', path = '/w/a.md'): DraftKey {
  return { sessionId, path }
}

function deferred(): { promise: Promise<void>, resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

test('load 把 Host 草稿放进快照并通知订阅者', async () => {
  const fake = fakeHost()
  fake.loadResult = draft([annotation(1)], 2)
  const store = createAnnotationStore({ host: async () => fake.host })
  let notified = 0
  const unsubscribe = store.subscribe(key(), () => { notified += 1 })

  store.load(key())
  assert.equal(store.getSnapshot(key()).status, 'loading')
  await flush()

  const snapshot = store.getSnapshot(key())
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.annotations[0]?.body, '意见')
  assert.equal(snapshot.nextSeq, 2)
  assert.equal(snapshot.persistence, 'durable')
  assert.ok(notified >= 2)
  unsubscribe()
})

test('写入先更新内存快照，再按 session + 路径落盘', async () => {
  const fake = fakeHost()
  const store = createAnnotationStore({ host: async () => fake.host })
  const result = await store.write(key(), [annotation(1, '新意见')])
  assert.deepEqual(result, { status: 'saved', durable: true })
  assert.equal(store.getSnapshot(key()).annotations[0]?.body, '新意见')
  assert.equal(store.getSnapshot(key()).persistence, 'durable')
  assert.deepEqual(fake.saves[0], {
    sessionId: 's1',
    path: '/w/a.md',
    annotations: [annotation(1, '新意见')],
    pending: null,
  })
})

test('同一文档的写入按调用顺序串行，不交叉落盘', async () => {
  const fake = fakeHost()
  const gate = deferred()
  fake.saveGate = gate.promise
  const store = createAnnotationStore({ host: async () => fake.host })

  const first = store.write(key(), [annotation(1)])
  const second = store.write(key(), [annotation(1), annotation(2)])
  await flush()
  assert.equal(fake.saves.length, 1, '第二次写入等第一次完成')
  assert.equal(fake.saves[0]?.annotations.length, 1)

  gate.resolve()
  await first
  await flush()
  assert.equal(fake.saves.length, 2)
  assert.equal(fake.saves[1]?.annotations.length, 2)
  await second
})

test('不同会话的同一文档各有快照与写入', async () => {
  const fake = fakeHost()
  const store = createAnnotationStore({ host: async () => fake.host })
  await store.write(key('s1'), [annotation(1, '会话一')])
  await store.write(key('s2'), [annotation(1, '会话二')])

  assert.equal(store.getSnapshot(key('s1')).annotations[0]?.body, '会话一')
  assert.equal(store.getSnapshot(key('s2')).annotations[0]?.body, '会话二')
  assert.deepEqual(fake.saves.map(save => save.sessionId), ['s1', 's2'])
})

test('加载返回前已有本地写入时，晚到的磁盘结果不覆盖它', async () => {
  const fake = fakeHost()
  const gate = deferred()
  fake.loadGate = gate.promise
  fake.loadResult = draft([annotation(1, '磁盘旧稿')], 2)
  const store = createAnnotationStore({ host: async () => fake.host })

  store.load(key())
  await store.write(key(), [annotation(3, '本地新稿')])
  gate.resolve()
  await flush()

  assert.equal(store.getSnapshot(key()).annotations[0]?.body, '本地新稿')
  assert.equal(store.getSnapshot(key()).status, 'ready')
})

test('too-large 保留内存草稿并标记，不抛出', async () => {
  const fake = fakeHost()
  fake.saveResult = { status: 'too-large', bytes: 900_000, limit: 524_288 }
  const store = createAnnotationStore({ host: async () => fake.host })
  const result = await store.write(key(), [annotation(1)])
  assert.deepEqual(result, { status: 'too-large', bytes: 900_000, limit: 524_288 })
  assert.equal(store.getSnapshot(key()).annotations.length, 1)
  assert.equal(store.getSnapshot(key()).persistence, 'too-large')
})

test('Host 写入失败时保留内存并给出失败结果', async () => {
  const fake = fakeHost()
  fake.saveError = new Error('disk full')
  const store = createAnnotationStore({ host: async () => fake.host })
  const result = await store.write(key(), [annotation(1)])
  assert.deepEqual(result, { status: 'failed', message: 'disk full' })
  assert.equal(store.getSnapshot(key()).persistence, 'memory')
  assert.equal(store.getSnapshot(key()).annotations.length, 1)
})

test('加载失败退回内存空快照，不阻塞新批注', async () => {
  const fake = fakeHost()
  fake.loadError = new Error('domain closed')
  const store = createAnnotationStore({ host: async () => fake.host })
  store.load(key())
  await flush()

  assert.equal(store.getSnapshot(key()).status, 'ready')
  assert.deepEqual(store.getSnapshot(key()).annotations, [])
  assert.equal(store.getSnapshot(key()).persistence, 'memory')
  assert.deepEqual(await store.write(key(), [annotation(1)]), { status: 'saved', durable: true })
})

test('清空立即清掉内存并请求 Host 删除', async () => {
  const fake = fakeHost()
  const store = createAnnotationStore({ host: async () => fake.host })
  await store.write(key(), [annotation(1)])
  assert.deepEqual(await store.clear(key()), { status: 'saved', durable: true })
  assert.deepEqual(store.getSnapshot(key()).annotations, [])
  assert.equal(store.getSnapshot(key()).nextSeq, 1)
  assert.deepEqual(fake.clears, [{ sessionId: 's1', path: '/w/a.md' }])
})

test('写入推进编号高水位，删除后不回收', async () => {
  const fake = fakeHost()
  fake.loadResult = draft([annotation(1), annotation(2)], 3)
  const store = createAnnotationStore({ host: async () => fake.host })
  store.load(key())
  await flush()

  await store.write(key(), [annotation(1), annotation(2), annotation(3)])
  assert.equal(store.getSnapshot(key()).nextSeq, 4)
  await store.write(key(), [annotation(1)])
  assert.equal(store.getSnapshot(key()).nextSeq, 4)
})
