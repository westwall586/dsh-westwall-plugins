import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  createReviewStore,
  REVIEW_LIMITS,
  type ReviewFileEntry,
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
  readonly dirs = new Set<string>()
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
    this.addParent(path)
    this.files.set(path, { content, mtimeMs: this.clock.now().getTime() })
  }

  async rename(from: string, to: string): Promise<void> {
    this.events.push(`rename:${from}->${to}`)
    const file = this.files.get(from)
    if (file === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    this.addParent(to)
    this.files.set(to, file)
    this.files.delete(from)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string): Promise<void> {
    const segments = path.split('/')
    for (let index = 2; index <= segments.length; index += 1) {
      this.dirs.add(segments.slice(0, index).join('/'))
    }
  }

  async list(path: string): Promise<readonly ReviewFileEntry[]> {
    const entries: ReviewFileEntry[] = []
    const prefix = `${path}/`
    for (const [filePath, file] of this.files) {
      if (!filePath.startsWith(prefix)) continue
      const rest = filePath.slice(prefix.length)
      if (rest.includes('/')) continue
      entries.push({ name: rest, path: filePath, directory: false, size: Buffer.byteLength(file.content, 'utf8'), mtimeMs: file.mtimeMs })
    }
    for (const directory of this.dirs) {
      if (!directory.startsWith(prefix)) continue
      const rest = directory.slice(prefix.length)
      if (rest === '' || rest.includes('/')) continue
      entries.push({ name: rest, path: directory, directory: true, size: 0, mtimeMs: 0 })
    }
    return entries
  }

  private addParent(path: string): void {
    const segments = path.split('/')
    for (let index = 2; index < segments.length; index += 1) {
      this.dirs.add(segments.slice(0, index).join('/'))
    }
  }

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

test('同一 roundId 重试是幂等的，不会产生第二轮', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r1', text: '旧版' })
  await store.commit({ sessionId: 's1', path: DOC, roundId: 'r1', pending: pendingOf('r1'), sentText: '' })

  const first = files.keys().sort()
  const retry = await store.commit({ sessionId: 's1', path: DOC, roundId: 'r1', pending: pendingOf('r1'), sentText: '' })
  assert.equal(retry.committed, true)
  assert.equal(retry.snapshotMissing, false)
  const afterDraftDeleted = await store.commit({ sessionId: 's1', path: DOC, roundId: 'r1', pending: null, sentText: '' })
  assert.equal(afterDraftDeleted.committed, true)
  assert.deepEqual(files.keys().sort(), first)
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

test('每个文档最多保留 5 轮，最新的不淘汰', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)

  for (let index = 1; index <= 6; index += 1) {
    clockValue.advance(60_000)
    const roundId = `r${index}`
    await store.prepare({ sessionId: 's1', path: DOC, roundId, text: `版本 ${index}` })
    await store.commit({ sessionId: 's1', path: DOC, roundId, pending: pendingOf(roundId), sentText: '' })
  }

  const rounds = [...files.files.keys()]
    .filter(path => path.startsWith(`${ROUND_DIR}/`) && path.endsWith('.json'))
    .map(path => path.slice(path.lastIndexOf('/') + 1, -'.json'.length))
    .sort()
  assert.deepEqual(rounds, ['r2', 'r3', 'r4', 'r5', 'r6'])
  assert.equal(files.contentOf(`${ROUND_DIR}/r1.md`), undefined)
  assert.equal(files.contentOf(`${ROUND_DIR}/r6.md`), '版本 6')
})

test('超过 30 天的旧轮次被清掉，但每个文档最新一轮留下', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)

  for (const [roundId, text] of [['r1', '第一天'], ['r2', '第二天']] as const) {
    await store.prepare({ sessionId: 's1', path: DOC, roundId, text })
    await store.commit({ sessionId: 's1', path: DOC, roundId, pending: pendingOf(roundId), sentText: '' })
    clockValue.advance(24 * 60 * 60 * 1000)
  }
  clockValue.advance(31 * 24 * 60 * 60 * 1000)
  const other = '/w/docs/b.md'
  await store.prepare({ sessionId: 's1', path: other, roundId: 's1', text: '另一份' })
  await store.commit({ sessionId: 's1', path: other, roundId: 's1', pending: pendingOf('s1'), sentText: '' })

  assert.equal(files.contentOf(`${ROUND_DIR}/r1.md`), undefined)
  assert.equal(files.contentOf(`${ROUND_DIR}/r2.md`), '第二天')
  const otherDir = `${WORKSPACE}/.dsh-active-markdown/reviews/docs/b.md`
  assert.equal(files.contentOf(`${otherDir}/s1.md`), '另一份')
})

test('全局总量超过上限时从最旧的轮次删到线下，最新一轮不动', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)

  const docs = [
    { path: '/w/docs/a.md', dir: ROUND_DIR },
    { path: '/w/docs/b.md', dir: `${WORKSPACE}/.dsh-active-markdown/reviews/docs/b.md` },
    { path: '/w/docs/c.md', dir: `${WORKSPACE}/.dsh-active-markdown/reviews/docs/c.md` },
  ]
  for (const [index, doc] of docs.entries()) {
    for (const [roundId, size] of [['old', 400], ['new', 100]] as const) {
      clockValue.advance(60_000)
      const text = `${index}-${roundId}-`.padEnd(size, 'x')
      await store.prepare({ sessionId: 's1', path: doc.path, roundId, text })
      await store.commit({ sessionId: 's1', path: doc.path, roundId, pending: pendingOf(roundId), sentText: '' })
    }
  }

  const reviewsBytes = (): number => {
    let total = 0
    for (const [path, file] of files.files) {
      if (!path.includes('/reviews/')) continue
      total += Buffer.byteLength(file.content, 'utf8')
    }
    return total
  }

  const before = reviewsBytes()
  const limited = storeWith(files, clockValue, { maxTotalBytes: before - 1 })
  assert.equal(await limited.prune('s1'), 1, '至少删掉最旧的旧轮次')

  const after = reviewsBytes()
  assert.ok(after <= before - 1, `总量 ${after} 应降到上限以下`)
  for (const doc of docs) {
    assert.equal(files.contentOf(`${doc.dir}/new.md`)?.endsWith('x'), true, '最新一轮必须留下')
  }
  assert.equal(docs.filter(doc => files.contentOf(`${doc.dir}/old.md`) !== undefined).length, 2)
})

test('默认上限是 5 轮 / 30 天 / 50 MiB', () => {
  assert.equal(REVIEW_LIMITS.maxRoundsPerDocument, 5)
  assert.equal(REVIEW_LIMITS.maxAgeMs, 30 * 24 * 60 * 60 * 1000)
  assert.equal(REVIEW_LIMITS.maxTotalBytes, 50 * 1024 * 1024)
})

test('pending 快照 30 天后被清掉', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r1', text: '旧版' })
  assert.notEqual(files.contentOf(`${PENDING_ROOT}/r1.md`), undefined)

  clockValue.advance(31 * 24 * 60 * 60 * 1000)
  await store.prune('s1')
  assert.equal(files.contentOf(`${PENDING_ROOT}/r1.md`), undefined)
})

async function commitRound(store: ReviewStore, roundId: string, text: string): Promise<void> {
  await store.prepare({ sessionId: 's1', path: DOC, roundId, text })
  await store.commit({ sessionId: 's1', path: DOC, roundId, pending: pendingOf(roundId), sentText: '' })
}

test('reviewLatest 取 createdAt 最新的一轮快照，不返回更早的轮次', async () => {
  const clockValue = clock('2026-01-01T00:00:00.000Z')
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await commitRound(store, 'r1', '第一版')
  clockValue.advance(60_000)
  await commitRound(store, 'r2', '第二版')

  assert.deepEqual(await store.latest({ sessionId: 's1', path: DOC }), {
    roundId: 'r2',
    createdAt: '2026-01-01T00:01:00.000Z',
    text: '第二版',
  })
})

test('reviewLatest 在最新一轮 snapshotMissing 时返回 null，不回退到更早一轮', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await commitRound(store, 'r1', '旧版原文')
  clockValue.advance(60_000)
  await store.commit({ sessionId: 's1', path: DOC, roundId: 'r2', pending: pendingOf('r2'), sentText: '' })

  assert.equal(await store.latest({ sessionId: 's1', path: DOC }), null)
})

test('reviewLatest 在最新一轮 .md 缺失时返回 null，不回退到更早一轮', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await commitRound(store, 'r1', '旧版原文')
  clockValue.advance(60_000)
  await commitRound(store, 'r2', '新版原文')
  await files.remove(`${ROUND_DIR}/r2.md`)

  assert.equal(await store.latest({ sessionId: 's1', path: DOC }), null)
})

test('reviewLatest 跳过损坏的元数据，取可读的最新一轮', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await commitRound(store, 'r1', '旧版原文')
  clockValue.advance(60_000)
  await commitRound(store, 'r2', '新版原文')
  await files.write(`${ROUND_DIR}/r2.json`, '{ not json')

  assert.deepEqual(await store.latest({ sessionId: 's1', path: DOC }), {
    roundId: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: '旧版原文',
  })
})

test('reviewLatest 只认镜像里同一 sourcePath 的轮次', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await commitRound(store, 'r1', '本文档旧版')
  const meta = JSON.parse(files.contentOf(`${ROUND_DIR}/r1.json`) ?? '{}')
  await files.write(`${ROUND_DIR}/rx.json`, JSON.stringify({
    ...meta,
    roundId: 'rx',
    sourcePath: 'docs/b.md',
    createdAt: '2026-01-02T00:00:00.000Z',
  }))
  await files.write(`${ROUND_DIR}/rx.md`, '别的文档')

  assert.deepEqual(await store.latest({ sessionId: 's1', path: DOC }), {
    roundId: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: '本文档旧版',
  })
})

test('reviewLatest 不把 pending 当基线，没有已发送轮次时返回 null', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  await store.prepare({ sessionId: 's1', path: DOC, roundId: 'r1', text: '还没发送' })

  assert.equal(await store.latest({ sessionId: 's1', path: DOC }), null)
})

test('reviewLatest 能取工作区外文档的快照', async () => {
  const clockValue = clock()
  const files = new MemoryFiles(clockValue)
  const store = storeWith(files, clockValue)
  const external = '/outside/doc.md'
  await store.prepare({ sessionId: 's1', path: external, roundId: 'r1', text: '外部原文' })
  await store.commit({
    sessionId: 's1',
    path: external,
    roundId: 'r1',
    pending: pendingOf('r1'),
    sentText: '',
  })

  assert.deepEqual(await store.latest({ sessionId: 's1', path: external }), {
    roundId: 'r1',
    createdAt: '2026-01-01T00:00:00.000Z',
    text: '外部原文',
  })
})
