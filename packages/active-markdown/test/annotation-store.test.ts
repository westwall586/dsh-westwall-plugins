import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createAnnotationStore,
  createMemoryAnnotationTable,
  openAnnotationStore,
  type AnnotationDomainFacility,
  type AnnotationTable,
} from '../src/annotate/store.ts'
import { AnnotationError, draftKeyOf, MAX_DRAFT_BYTES } from '../src/annotate/paths.ts'
import type { Annotation, AnnotationDraft, PendingReview } from '../src/annotate/schema.ts'

const PATH = '/workspace/docs/a.md'

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    seq: 1,
    kind: 'text',
    body: '意见',
    quote: '原文',
    prefix: '',
    suffix: '',
    startOffset: 0,
    blockStartId: 'paragraph-1',
    blockEndId: 'paragraph-1',
    blockSignature: '',
    section: '标题',
    lineStart: 1,
    lineEnd: 1,
    createdAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  }
}

function pending(roundId: string): PendingReview {
  return {
    roundId,
    draftAttachmentId: `draft-${roundId}`,
    fileName: `review-${roundId}.md`,
    fileBytes: 10,
    fileHash: `hash-${roundId}`,
    sourceHash: `source-${roundId}`,
    annotations: [annotation()],
    feedback: '反馈',
    createdAt: '2026-11-17T00:00:00.000Z',
  }
}

interface Clock {
  now(): Date
  advance(ms: number): void
  set(iso: string): void
}

function clock(start = '2026-01-01T00:00:00.000Z'): Clock {
  let time = Date.parse(start)
  return {
    now: () => new Date(time),
    advance: (ms) => { time += ms },
    set: (iso) => { time = Date.parse(iso) },
  }
}

function draft(overrides: Partial<AnnotationDraft> = {}): AnnotationDraft {
  return {
    sessionId: 's1',
    path: PATH,
    annotations: [annotation()],
    nextSeq: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function keys(table: AnnotationTable): string[] {
  return [...table.entries()].map(([key]) => key)
}

test('草稿落盘后按 session + 文档读回，编号高水位保留', async () => {
  const table = createMemoryAnnotationTable()
  const store = createAnnotationStore({ table, durable: true })
  const saved = await store.save({ sessionId: 's1', path: PATH, annotations: [annotation()], pending: null })
  assert.deepEqual(saved, { status: 'saved', durable: true })

  const loaded = await store.load({ sessionId: 's1', path: PATH })
  assert.equal(loaded?.annotations[0]?.body, '意见')
  assert.equal(loaded?.nextSeq, 2)
  assert.equal(loaded?.path, PATH)
  assert.equal(loaded?.sessionId, 's1')
  assert.match(loaded?.createdAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(loaded?.createdAt, loaded?.updatedAt)

  await store.save({ sessionId: 's1', path: PATH, annotations: [annotation({ seq: 5 })], pending: null })
  assert.equal((await store.load({ sessionId: 's1', path: PATH }))?.nextSeq, 6)
})

test('记录键是安全的十六进制，按会话与规范路径区分', () => {
  const key = draftKeyOf('session-1', '/workspace/a/../docs/a.md')
  assert.match(key, /^[a-z0-9]{40}$/)
  assert.equal(key, draftKeyOf('session-1', '/workspace/docs/a.md'))
  assert.notEqual(key, draftKeyOf('session-2', '/workspace/docs/a.md'))
  assert.notEqual(key, draftKeyOf('session-1', '/workspace/docs/b.md'))
  assert.throws(() => draftKeyOf('session-1', 'docs/a.md'), (error: unknown) => error instanceof AnnotationError && error.code === 'invalid-request')
})

test('超过 20 份按 updatedAt 淘汰最旧的，当前写入的那份留下', async () => {
  const table = createMemoryAnnotationTable()
  const time = clock()
  const store = createAnnotationStore({ table, durable: true, now: time.now })

  for (let index = 0; index < 20; index += 1) {
    time.set(`2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
    await store.save({ sessionId: 's1', path: `/workspace/docs/${index}.md`, annotations: [annotation()], pending: null })
  }
  assert.equal(keys(table).length, 20)

  time.set('2026-03-01T00:00:00.000Z')
  await store.save({ sessionId: 's1', path: '/workspace/docs/20.md', annotations: [annotation()], pending: null })
  assert.equal(keys(table).length, 20)
  assert.equal(await store.load({ sessionId: 's1', path: '/workspace/docs/0.md' }), null)
  assert.notEqual(await store.load({ sessionId: 's1', path: '/workspace/docs/20.md' }), null)
})

test('当前文档即使最旧也不淘汰，淘汰的是别的文档里最旧的那份', async () => {
  const table = createMemoryAnnotationTable()
  const time = clock()
  const store = createAnnotationStore({ table, durable: true, now: time.now })

  for (let index = 1; index <= 20; index += 1) {
    time.set(`2026-02-${String(index).padStart(2, '0')}T00:00:00.000Z`)
    await store.save({ sessionId: 's1', path: `/workspace/docs/${index}.md`, annotations: [annotation()], pending: null })
  }

  time.set('2026-01-01T00:00:00.000Z')
  await store.save({ sessionId: 's1', path: '/workspace/docs/current.md', annotations: [annotation()], pending: null })
  assert.equal(keys(table).length, 20)
  assert.notEqual(await store.load({ sessionId: 's1', path: '/workspace/docs/current.md' }), null)
  assert.equal(await store.load({ sessionId: 's1', path: '/workspace/docs/1.md' }), null)
  assert.notEqual(await store.load({ sessionId: 's1', path: '/workspace/docs/2.md' }), null)
})

test('30 天未更新的草稿在下次写入时清掉', async () => {
  const table = createMemoryAnnotationTable()
  const time = clock()
  const store = createAnnotationStore({ table, durable: true, now: time.now })

  await store.save({ sessionId: 's1', path: '/workspace/docs/old.md', annotations: [annotation()], pending: null })
  time.advance(31 * 24 * 60 * 60 * 1000)
  await store.save({ sessionId: 's1', path: '/workspace/docs/new.md', annotations: [annotation()], pending: null })

  assert.equal(await store.load({ sessionId: 's1', path: '/workspace/docs/old.md' }), null)
  assert.notEqual(await store.load({ sessionId: 's1', path: '/workspace/docs/new.md' }), null)
})

test('单份超过 512 KiB 拒绝落盘，旧的 durable 记录保持原样', async () => {
  const table = createMemoryAnnotationTable()
  const store = createAnnotationStore({ table, durable: true })
  await store.save({ sessionId: 's1', path: PATH, annotations: [annotation()], pending: null })

  const huge = annotation({ body: 'x'.repeat(MAX_DRAFT_BYTES) })
  const result = await store.save({ sessionId: 's1', path: PATH, annotations: [huge], pending: null })
  assert.equal(result.status, 'too-large')
  if (result.status === 'too-large') {
    assert.ok(result.bytes > result.limit)
    assert.equal(result.limit, MAX_DRAFT_BYTES)
  }

  const loaded = await store.load({ sessionId: 's1', path: PATH })
  assert.equal(loaded?.annotations[0]?.body, '意见')
})

test('待发送草稿按会话过滤，普通草稿不出现', async () => {
  const table = createMemoryAnnotationTable()
  const store = createAnnotationStore({ table, durable: true })
  await store.save({ sessionId: 's1', path: '/workspace/docs/a.md', annotations: [annotation()], pending: pending('r1') })
  await store.save({ sessionId: 's2', path: '/workspace/docs/a.md', annotations: [annotation()], pending: pending('r2') })
  await store.save({ sessionId: 's1', path: '/workspace/docs/b.md', annotations: [annotation()], pending: null })

  const found = await store.pending('s1')
  assert.deepEqual(found.map(item => item.pending?.roundId), ['r1'])
  assert.deepEqual((await store.pending('s3')), [])
})

test('清空只删当前文档，其他会话与文档不受影响', async () => {
  const table = createMemoryAnnotationTable()
  const store = createAnnotationStore({ table, durable: true })
  await store.save({ sessionId: 's1', path: PATH, annotations: [annotation()], pending: null })
  await store.save({ sessionId: 's2', path: PATH, annotations: [annotation()], pending: null })

  assert.deepEqual(await store.clear({ sessionId: 's1', path: PATH }), {})
  assert.equal(await store.load({ sessionId: 's1', path: PATH }), null)
  assert.notEqual(await store.load({ sessionId: 's2', path: PATH }), null)
})

test('domain 打不开时退回内存，读写仍可用并标记非 durable', async () => {
  const facility: AnnotationDomainFacility = { async open() { throw new Error('no backend') } }
  const store = await openAnnotationStore(facility, { warn: () => {} })
  const saved = await store.save({ sessionId: 's1', path: PATH, annotations: [annotation()], pending: null })
  assert.deepEqual(saved, { status: 'saved', durable: false })
  assert.equal((await store.load({ sessionId: 's1', path: PATH }))?.annotations[0]?.body, '意见')
})

test('打开 domain 时顺手清掉过期草稿', async () => {
  const table = createMemoryAnnotationTable()
  await table.put(draftKeyOf('s1', '/workspace/docs/old.md'), draft({
    path: '/workspace/docs/old.md',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }))
  await table.put(draftKeyOf('s1', '/workspace/docs/fresh.md'), draft({
    path: '/workspace/docs/fresh.md',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
  const facility: AnnotationDomainFacility = { async open() { return { table: () => table } } }
  const store = await openAnnotationStore(facility, { now: () => new Date('2026-01-02T00:00:00.000Z') })

  assert.equal(await store.load({ sessionId: 's1', path: '/workspace/docs/old.md' }), null)
  assert.notEqual(await store.load({ sessionId: 's1', path: '/workspace/docs/fresh.md' }), null)
})

test('记录里的未知字段被拒绝，批注没有 tag 通道', async () => {
  const table = createMemoryAnnotationTable()
  const store = createAnnotationStore({ table, durable: true })
  const tagged = { ...annotation(), tag: 'todo' } as unknown as Annotation
  await assert.rejects(
    store.save({ sessionId: 's1', path: PATH, annotations: [tagged], pending: null }),
    (error: unknown) => error instanceof AnnotationError && error.code === 'invalid-request',
  )
  assert.equal(await store.load({ sessionId: 's1', path: PATH }), null)
})
