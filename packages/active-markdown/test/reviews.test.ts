import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  createReviewStore,
  type ReviewFilePort,
  type ReviewStore,
} from '../src/annotate/reviews.ts'
import type { Annotation, PendingReview } from '../src/annotate/schema.ts'

const WORKSPACE = '/w'
const DOC = '/w/docs/a.md'
const PENDING_ROOT = `${WORKSPACE}/.dsh-active-markdown/reviews/pending`

interface Clock {
  now(): Date
  advance(ms: number): void
}

function clock(start = '2026-01-01T00:00:00.000Z'): Clock {
  let time = Date.parse(start)
  return {
    now: () => new Date(time),
    advance: (ms) => { time += ms },
  }
}

interface MemoryFile {
  content: string
  mtimeMs: number
}

class MemoryFiles implements ReviewFilePort {
  readonly files = new Map<string, MemoryFile>()
  readonly events: string[] = []

  readonly clock: Clock

  constructor(clock: Clock) {
    this.clock = clock
  }

  async read(path: string): Promise<string | null> {
    return this.files.get(path)?.content ?? null
  }

  async write(path: string, content: string): Promise<void> {
    this.events.push(`write:${path}`)
    this.files.set(path, { content, mtimeMs: this.clock.now().getTime() })
  }

  async rename(from: string, to: string): Promise<void> {
    this.events.push(`rename:${from}->${to}`)
    const file = this.files.get(from)
    if (file === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    this.files.set(to, file)
    this.files.delete(from)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }

  async mkdir(_path: string): Promise<void> {}

  contentOf(path: string): string | undefined {
    return this.files.get(path)?.content
  }

  keys(): string[] {
    return [...this.files.keys()]
  }
}

function annotation(): Annotation {
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
    section: '',
    lineStart: 1,
    lineEnd: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function pendingOf(roundId: string): PendingReview {
  return {
    roundId,
    draftAttachmentId: `d-${roundId}`,
    fileName: `a-review-${roundId}.md`,
    fileBytes: 10,
    fileHash: 'f'.repeat(64),
    sourceHash: 's'.repeat(64),
    annotations: [annotation()],
    feedback: '反馈正文',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function storeWith(files: MemoryFiles, clockValue: Clock, limits = {}): ReviewStore {
  return createReviewStore({
    files,
    workspaceOf: () => WORKSPACE,
    now: clockValue.now,
    limits,
  })
}

const ROUND_DIR = `${WORKSPACE}/.dsh-active-markdown/reviews/docs/a.md`

test('reviewPrepare 先写临时文件再 rename，并建立 .gitignore', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)

  const view = await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r1', text: '原文\n' })
  assert.equal(view.snapshotWritten, true)
  assert.equal(view.bytes, Buffer.byteLength('原文\n', 'utf8'))
  assert.equal(view.sourceHash, createHash('sha256').update('原文', 'utf8').digest('hex'))

  const target = `${PENDING_ROOT}/r1.md`
  assert.equal(files.contentOf(target), '原文\n')
  const temp = files.events.find(event => event.startsWith(`write:${target}.`) && event.endsWith('.tmp'))
  assert.ok(temp, '先写同目录临时文件')
  assert.ok(files.events.includes(`rename:${temp?.slice('write:'.length)}->${target}`))
  assert.equal(files.contentOf(`${WORKSPACE}/.dsh-active-markdown/.gitignore`), '*\n!.gitignore\n')
})

test('reviewCommit 把 pending 转正并写元数据，然后调用方可删草稿', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r1', text: '旧版原文' })

  const view = await store.commit({
    sessionId: 's1',
    path: DOC,
    roundId: 'r1',
    pending: pendingOf('r1'),
    sentText: '发出去的文本',
  })
  assert.deepEqual(view, { roundId: 'r1', committed: true, snapshotMissing: false })
  assert.equal(files.contentOf(`${ROUND_DIR}/r1.md`), '旧版原文')
  assert.equal(files.contentOf(`${PENDING_ROOT}/r1.md`), undefined)

  const meta = JSON.parse(files.contentOf(`${ROUND_DIR}/r1.json`) ?? '{}')
  assert.equal(meta.roundId, 'r1')
  assert.equal(meta.sessionId, 's1')
  assert.equal(meta.sourcePath, 'docs/a.md')
  assert.equal(meta.sourceHash, 's'.repeat(64))
  assert.equal(meta.feedback, '反馈正文')
  assert.equal(meta.sentText, '发出去的文本')
  assert.equal(meta.fileName, 'a-review-r1.md')
  assert.equal(meta.annotations.length, 1)
  assert.equal(meta.snapshotMissing, undefined)
})

test('pending 缺失时 commit 不阻塞，元数据标 snapshotMissing', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)

  const view = await store.commit({
    sessionId: 's1',
    path: DOC,
    roundId: 'r1',
    pending: pendingOf('r1'),
    sentText: '',
  })
  assert.equal(view.committed, true)
  assert.equal(view.snapshotMissing, true)
  assert.equal(files.contentOf(`${ROUND_DIR}/r1.md`), undefined)
  const meta = JSON.parse(files.contentOf(`${ROUND_DIR}/r1.json`) ?? '{}')
  assert.equal(meta.snapshotMissing, true)
})

test('reviewDetach 只删 pending 快照', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r1', text: '旧版' })
  await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r2', text: '其他轮' })

  assert.deepEqual(await store.detach({ sessionId: 's1', roundId: 'r1' }), { detached: true })
  assert.equal(files.contentOf(`${PENDING_ROOT}/r1.md`), undefined)
  assert.equal(files.contentOf(`${PENDING_ROOT}/r2.md`), '其他轮')
})

test('工作区外文档按路径 hash 收进 _external', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  const external = '/outside/doc.md'
  const hash = createHash('sha1').update(external).digest('hex').slice(0, 8)
  const directory = `${WORKSPACE}/.dsh-active-markdown/reviews/_external/${hash}/doc.md`

  await store.prepare({ sessionId: 's1', path: external, roundId: 'r1', text: '外部原文' })
  await store.commit({
    sessionId: 's1',
    path: external,
    roundId: 'r1',
    pending: { ...pendingOf('r1'), sourceHash: 'x'.repeat(64) },
    sentText: '',
  })
  assert.equal(files.contentOf(`${directory}/r1.md`), '外部原文')
  const meta = JSON.parse(files.contentOf(`${directory}/r1.json`) ?? '{}')
  assert.equal(meta.sourcePath, external)
})
