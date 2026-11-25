import test from 'node:test'
import assert from 'node:assert/strict'

import { createDocumentStore } from '../client/src/store/document.ts'
import type { Notes } from '../client/src/store/kernel/notes.ts'
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
  detaches: { sessionId: string, path: string, roundId: string }[]
  commits: { sessionId: string, path: string, roundId: string, sentText: string }[]
  loadResult: AnnotationDraft | null
  loadError: Error | null
  loadGate: Promise<void> | null
  saveResult: AnnotationSaveView
  saveError: Error | null
  saveGate: Promise<void> | null
  detachError: Error | null
  commitResult: { roundId: string, committed: boolean, snapshotMissing: boolean }
  commitError: Error | null
}

function fakeHost(): FakeHost {
  const state: FakeHost = {
    loads: [],
    saves: [],
    clears: [],
    detaches: [],
    commits: [],
    loadResult: null,
    loadError: null,
    loadGate: null,
    saveResult: { status: 'saved', durable: true },
    saveError: null,
    saveGate: null,
    detachError: null,
    commitResult: { roundId: 'r1', committed: true, snapshotMissing: false },
    commitError: null,
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
    async reviewDetach(request: { sessionId: string, path: string, roundId: string }) {
      state.detaches.push(request)
      if (state.detachError !== null) throw state.detachError
      return { detached: true }
    },
    async reviewCommit(request: { sessionId: string, path: string, roundId: string, sentText: string }) {
      state.commits.push(request)
      if (state.commitError !== null) throw state.commitError
      return state.commitResult
    },
    async reviewPrepare() {
      return { sourceHash: 'hash', snapshotWritten: true, bytes: 1 }
    },
  } as unknown as HostBridge
  return state
}

const REF = { session: 's1', compose: 's1', path: '/w/a.md' }

/** A composer's view of one document: the crate's notes plus its lock. */
interface Doc {
  notes: Notes
  withLock<T>(job: () => Promise<T>): Promise<T>
}

function doc(store: ReturnType<typeof createDocumentStore>, sessionId = 's1', path = '/w/a.md'): Doc {
  const { notes, withLock } = store.notesFor(sessionId, path, sessionId)
  return { notes, withLock }
}

function deferred(): { promise: Promise<void>, resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

test('body 卸载后重挂载，批注快照仍在，不重新 load', async () => {
  const fake = fakeHost()
  const loads = fake.loads
  const documents = createDocumentStore({ host: async () => fake.host })
  documents.mount(REF)
  const first = documents.notesFor(REF.compose, REF.path, REF.session).notes
  first.load()
  await flush()
  await first.write([annotation(1, '切走前的意见')])
  documents.unmount(REF)

  documents.mount(REF)
  const second = documents.notesFor(REF.compose, REF.path, REF.session).notes
  second.load()
  await flush()

  assert.equal(second.getSnapshot().annotations[0]?.body, '切走前的意见')
  assert.equal(loads.length, 1, '卸载后重挂载不重新读 Host 草稿')
})

test('load 把 Host 草稿放进快照并通知订阅者', async () => {
  const fake = fakeHost()
  fake.loadResult = draft([annotation(1)], 2)
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  let notified = 0
  const unsubscribe = store.subscribe(() => { notified += 1 })

  store.load()
  assert.equal(store.getSnapshot().status, 'loading')
  await flush()

  const snapshot = store.getSnapshot()
  assert.equal(snapshot.status, 'ready')
  assert.equal(snapshot.annotations[0]?.body, '意见')
  assert.equal(snapshot.nextSeq, 2)
  assert.equal(snapshot.persistence, 'durable')
  assert.ok(notified >= 2)
  unsubscribe()
})

test('写入先更新内存快照，再按 session + 路径落盘', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  const result = await store.write([annotation(1, '新意见')])
  assert.deepEqual(result, { status: 'saved', durable: true })
  assert.equal(store.getSnapshot().annotations[0]?.body, '新意见')
  assert.equal(store.getSnapshot().persistence, 'durable')
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
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes

  const first = store.write([annotation(1)])
  const second = store.write([annotation(1), annotation(2)])
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
  const documents = createDocumentStore({ host: async () => fake.host })
  const first = doc(documents, 's1').notes
  const second = doc(documents, 's2').notes
  await first.write([annotation(1, '会话一')])
  await second.write([annotation(1, '会话二')])

  assert.equal(first.getSnapshot().annotations[0]?.body, '会话一')
  assert.equal(second.getSnapshot().annotations[0]?.body, '会话二')
  assert.deepEqual(fake.saves.map(save => save.sessionId), ['s1', 's2'])
})

test('加载返回前已有本地写入时，晚到的磁盘结果不覆盖它', async () => {
  const fake = fakeHost()
  const gate = deferred()
  fake.loadGate = gate.promise
  fake.loadResult = draft([annotation(1, '磁盘旧稿')], 2)
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes

  store.load()
  await store.write([annotation(3, '本地新稿')])
  gate.resolve()
  await flush()

  assert.equal(store.getSnapshot().annotations[0]?.body, '本地新稿')
  assert.equal(store.getSnapshot().status, 'ready')
})

test('too-large 保留内存草稿并标记，不抛出', async () => {
  const fake = fakeHost()
  fake.saveResult = { status: 'too-large', bytes: 900_000, limit: 524_288 }
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  const result = await store.write([annotation(1)])
  assert.deepEqual(result, { status: 'too-large', bytes: 900_000, limit: 524_288 })
  assert.equal(store.getSnapshot().annotations.length, 1)
  assert.equal(store.getSnapshot().persistence, 'too-large')
})

test('Host 写入失败时保留内存并给出失败结果', async () => {
  const fake = fakeHost()
  fake.saveError = new Error('disk full')
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  const result = await store.write([annotation(1)])
  assert.deepEqual(result, { status: 'failed', message: 'disk full' })
  assert.equal(store.getSnapshot().persistence, 'memory')
  assert.equal(store.getSnapshot().annotations.length, 1)
})

test('加载失败退回内存空快照，不阻塞新批注', async () => {
  const fake = fakeHost()
  fake.loadError = new Error('domain closed')
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  store.load()
  await flush()

  assert.equal(store.getSnapshot().status, 'ready')
  assert.deepEqual(store.getSnapshot().annotations, [])
  assert.equal(store.getSnapshot().persistence, 'memory')
  assert.deepEqual(await store.write([annotation(1)]), { status: 'saved', durable: true })
})

test('清空立即清掉内存并请求 Host 删除', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  assert.deepEqual(await store.clear(), { status: 'saved', durable: true })
  assert.deepEqual(store.getSnapshot().annotations, [])
  assert.equal(store.getSnapshot().nextSeq, 1)
  assert.deepEqual(fake.clears, [{ sessionId: 's1', path: '/w/a.md' }])
})

test('写入推进编号高水位，删除后不回收', async () => {
  const fake = fakeHost()
  fake.loadResult = draft([annotation(1), annotation(2)], 3)
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  store.load()
  await flush()

  await store.write([annotation(1), annotation(2), annotation(3)])
  assert.equal(store.getSnapshot().nextSeq, 4)
  await store.write([annotation(1)])
  assert.equal(store.getSnapshot().nextSeq, 4)
})

function pendingReview(roundId: string, annotations: Annotation[] = [annotation(1)]): PendingReview {
  return {
    roundId,
    draftAttachmentId: `d-${roundId}`,
    fileName: `a-review-${roundId}.md`,
    fileBytes: 10,
    fileHash: `hash-${roundId}`,
    sourceHash: `source-${roundId}`,
    annotations,
    feedback: '反馈',
    createdAt: '2026-11-17T00:00:00.000Z',
  }
}

test('加入附件后再写批注，pending 记录保留', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  assert.deepEqual(await store.attach(pendingReview('r1')), { status: 'saved', durable: true })

  await store.write([annotation(1, '改过的意见')])
  assert.equal(store.getSnapshot().pending?.roundId, 'r1')
  assert.deepEqual(fake.saves.at(-1)?.pending?.roundId, 'r1')
  assert.deepEqual(fake.saves.at(-1)?.annotations[0]?.body, '改过的意见')
})

test('已有 pending 时再次 attach 被拒绝，不写盘', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  await store.attach(pendingReview('r1'))
  const saves = fake.saves.length

  assert.deepEqual(await store.attach(pendingReview('r2')), { status: 'refused', reason: 'already-pending' })
  assert.equal(fake.saves.length, saves)
})

test('regenerate 只接受同一 roundId，替换后仍是同一条 pending', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  await store.attach(pendingReview('r1'))

  assert.deepEqual(
    await store.regenerate('r2', pendingReview('r2')),
    { status: 'refused', reason: 'round-mismatch' },
  )
  assert.deepEqual(await store.regenerate('r1', pendingReview('r1')), { status: 'saved', durable: true })
  assert.equal(store.getSnapshot().pending?.roundId, 'r1')
})

test('detach 的 roundId 不匹配时拒绝，不调用 Host', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  await store.attach(pendingReview('r1'))

  assert.deepEqual(await store.detach('r2'), { status: 'refused', reason: 'round-mismatch' })
  assert.deepEqual(fake.detaches, [])

  assert.deepEqual(await store.detach('r1'), { status: 'saved', durable: true })
  assert.deepEqual(fake.detaches, [{ sessionId: 's1', path: '/w/a.md', roundId: 'r1' }])
  assert.equal(store.getSnapshot().pending, null)
  assert.equal(store.getSnapshot().annotations.length, 1, 'detach 不删批注')
})

test('commit 使用冻结的 roundId，成功后才清空草稿', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  await store.attach(pendingReview('r1'))

  assert.deepEqual(await store.commit('r2', '已发送'), { status: 'refused', reason: 'round-mismatch' })
  assert.equal(store.getSnapshot().annotations.length, 1)

  assert.deepEqual(await store.commit('r1', '已发送'), { status: 'committed', snapshotMissing: false })
  assert.deepEqual(fake.commits, [{ sessionId: 's1', path: '/w/a.md', roundId: 'r1', sentText: '已发送' }])
  assert.deepEqual(store.getSnapshot().annotations, [])
  assert.equal(store.getSnapshot().pending, null)
})

test('commit 只清掉冻结轮次里的批注，发送后新加的批注留下', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  await store.attach(pendingReview('r1', [annotation(1)]))
  await store.write([annotation(1), annotation(2)])

  assert.deepEqual(await store.commit('r1', '已发送'), { status: 'committed', snapshotMissing: false })
  assert.deepEqual(store.getSnapshot().annotations.map(item => item.seq), [2])
  assert.equal(store.getSnapshot().nextSeq, 3)
  assert.equal(store.getSnapshot().pending, null)
})

test('commit 保留发送后改过、未进入冻结轮次的同一批注内容', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1, '旧意见')])
  await store.attach(pendingReview('r1', [annotation(1, '旧意见')]))
  await store.write([annotation(1, '新意见')])

  assert.deepEqual(await store.commit('r1', '已发送'), { status: 'committed', snapshotMissing: false })
  assert.deepEqual(store.getSnapshot().annotations.map(item => item.body), ['新意见'])
  assert.equal(store.getSnapshot().pending, null)
})

test('commit 失败保留草稿与 pending，可重试', async () => {
  const fake = fakeHost()
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes
  await store.write([annotation(1)])
  await store.attach(pendingReview('r1'))
  fake.commitError = new Error('meta failed')

  assert.deepEqual(await store.commit('r1', ''), { status: 'failed', message: 'meta failed' })
  assert.equal(store.getSnapshot().pending?.roundId, 'r1')
  assert.equal(store.getSnapshot().annotations.length, 1)
})

test('committer 在快照未加载时先读 Host 草稿再提交', async () => {
  const fake = fakeHost()
  fake.loadResult = { ...draft([annotation(1)], 2), pending: pendingReview('r1') }
  const documents = createDocumentStore({ host: async () => fake.host })
  const store = doc(documents).notes

  assert.deepEqual(await store.commit('r1', '发送'), { status: 'committed', snapshotMissing: false })
  assert.equal(fake.loads.length, 1)
  assert.deepEqual(fake.commits, [{ sessionId: 's1', path: '/w/a.md', roundId: 'r1', sentText: '发送' }])
  assert.deepEqual(store.getSnapshot().annotations, [])
})
