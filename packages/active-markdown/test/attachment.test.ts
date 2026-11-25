import test from 'node:test'
import assert from 'node:assert/strict'

import { createAttachmentController, type AttachmentRequest } from '../client/src/annotate/attachment.ts'
import { normalizeSourceText, sha256Hex } from '../client/src/annotate/feedback.ts'
import type { Annotation } from '../client/src/annotate/model.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import type {
  AnnotationLoadRequest,
  AnnotationSaveRequest,
  HostBridge,
  ReviewCommitRequest,
  ReviewDetachRequest,
  ReviewPrepareRequest,
} from '../client/src/context.ts'

const KEY = { session: 's1', path: '/w/a.md' }

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
    section: '',
    lineStart: 1,
    lineEnd: 1,
    createdAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  }
}

interface Harness {
  host: HostBridge
  store: ReturnType<ReturnType<typeof createDocumentStore>['notesFor']>['notes']
  controller: ReturnType<typeof createAttachmentController>
  events: string[]
  added: string[][]
  removed: string[]
  released: unknown[][]
  prepares: ReviewPrepareRequest[]
  detaches: ReviewDetachRequest[]
  drafts: Array<{ id: string, kind: 'file', file: File }>
  flags: { prepareFails: boolean, saveFails: boolean, createFails: boolean, addResult: boolean }
}

function harness(): Harness {
  const events: string[] = []
  const added: string[][] = []
  const removed: string[] = []
  const released: unknown[][] = []
  const prepares: ReviewPrepareRequest[] = []
  const detaches: ReviewDetachRequest[] = []
  const drafts: Array<{ id: string, kind: 'file', file: File }> = []
  let counter = 0

  const flags = { prepareFails: false, saveFails: false, createFails: false, addResult: true }

  const host = {
    async annotationLoad(_request: AnnotationLoadRequest) { return null },
    async annotationSave(_request: AnnotationSaveRequest) {
      events.push('save')
      if (flags.saveFails) throw new Error('disk full')
      return { status: 'saved', durable: true }
    },
    async annotationClear(_request: AnnotationLoadRequest) { return {} },
    async annotationPending() { return [] },
    async reviewPrepare(request: ReviewPrepareRequest) {
      events.push('prepare')
      prepares.push(request)
      if (flags.prepareFails) throw new Error('snapshot failed')
      return { sourceHash: await sha256Hex(normalizeSourceText(request.text)), snapshotWritten: true, bytes: 10 }
    },
    async reviewCommit(_request: ReviewCommitRequest) {
      return { roundId: 'r', committed: true, snapshotMissing: false }
    },
    async reviewDetach(request: ReviewDetachRequest) {
      events.push('detach')
      detaches.push(request)
      return { detached: true }
    },
  } as unknown as HostBridge

  const conversation = {
    createDrafts(_sessionId: string, files: readonly File[], _uploadImages: boolean) {
      events.push('create')
      if (flags.createFails) throw new Error('composer refused')
      const created = files.map(file => ({ id: `d${++counter}`, kind: 'file' as const, file }))
      drafts.push(...created)
      return created
    },
    releaseDraftAttachments(items: readonly unknown[]) {
      events.push('release')
      released.push([...items])
    },
    releaseDraftAttachment() {},
    resolveDraftAttachments(ids: readonly string[]) {
      return drafts.filter(draft => ids.includes(draft.id))
    },
  }

  const documents = createDocumentStore({ host: async () => host })
  const { notes: store, withLock } = documents.notesFor(KEY.session, KEY.path, KEY.session)
  const controller = createAttachmentController({
    store,
    withLock,
    composeSession: () => KEY.session,
    host: async () => host,
    conversation: () => conversation,
    now: () => new Date('2026-11-17T00:00:00.000Z'),
    random: () => 0.25,
  })

  return { host, store, controller, events, added, removed, released, prepares, detaches, drafts, flags }
}

function request(overrides: Partial<AttachmentRequest> = {}): AttachmentRequest {
  return {
    key: KEY,
    composeSessionId: 's1',
    path: KEY.path,
    displayPath: 'docs/a.md',
    text: '原文',
    annotations: [annotation()],
    unlocatable: new Set(),
    input: {
      addAttachments: () => true,
      removeAttachment: () => {},
    },
    phase: 'plain',
    ...overrides,
  }
}

async function attachWithInput(
  value: Harness,
  overrides: Partial<AttachmentRequest> = {},
): Promise<Awaited<ReturnType<typeof value.controller.attach>>> {
  return value.controller.attach({
    ...request(),
    ...overrides,
    input: {
      addAttachments(ids) {
        value.events.push('add')
        value.added.push([...ids])
        return value.flags.addResult
      },
      removeAttachment(id) {
        value.events.push('remove')
        value.removed.push(id)
      },
    },
  })
}

async function ready(harnessValue: Harness): Promise<void> {
  await harnessValue.store.write([annotation()])
  harnessValue.events.length = 0
}

test('加入输入框依次 prepare / create / add / save，并冻结待发送记录', async () => {
  const value = harness()
  await ready(value)

  const result = await attachWithInput(value)
  assert.equal(result.status, 'attached')
  if (result.status !== 'attached') return
  assert.deepEqual(value.events, ['prepare', 'create', 'add', 'save'])
  assert.equal(value.prepares[0]?.roundId, result.pending.roundId)
  assert.match(result.pending.roundId, /^[a-z0-9]{8}$/)
  assert.equal(result.pending.draftAttachmentId, 'd1')
  assert.equal(result.pending.fileName, `a-review-${result.pending.roundId}.md`)
  assert.match(result.pending.sourceHash, /^[0-9a-f]{64}$/)
  assert.equal(result.pending.annotations.length, 1)
  assert.equal(value.store.getSnapshot().pending?.roundId, result.pending.roundId)
  assert.equal(value.added[0]?.length, 1)
})

test('composer 不在 plain 时拒绝，不创建 draft', async () => {
  const value = harness()
  await ready(value)
  const result = await attachWithInput(value, { phase: 'sending' })
  assert.deepEqual(result, { status: 'refused', reason: 'composer-busy' })
  assert.deepEqual(value.events, [])
})

test('addAttachments 拒绝时释放 draft 并清掉 pending 快照', async () => {
  const value = harness()
  await ready(value)
  value.flags.addResult = false
  const result = await attachWithInput(value)
  assert.deepEqual(result, { status: 'refused', reason: 'composer-busy' })
  assert.deepEqual(value.events, ['prepare', 'create', 'add', 'release', 'detach'])
  assert.equal(value.detaches.length, 1)
  assert.equal(value.store.getSnapshot().pending, null)
})

test('prepare 失败仍然加入输入框，并标出没有旧版快照', async () => {
  const value = harness()
  await ready(value)
  value.flags.prepareFails = true
  const result = await attachWithInput(value)
  assert.equal(result.status, 'attached')
  if (result.status !== 'attached') return
  assert.equal(result.snapshotSaved, false)
  assert.equal(result.pending.sourceHash.length, 64, '本地补算 sourceHash')
  assert.equal(value.store.getSnapshot().pending?.roundId, result.pending.roundId)
})

test('保存 pending 失败时移除附件、释放 draft、清 Host pending，批注保留', async () => {
  const value = harness()
  await ready(value)
  value.flags.saveFails = true
  const result = await attachWithInput(value)
  assert.deepEqual(result, { status: 'failed', reason: 'save-failed', message: 'disk full' })
  assert.deepEqual(value.events, ['prepare', 'create', 'add', 'save', 'remove', 'release', 'detach'])
  assert.equal(value.store.getSnapshot().pending, null)
  assert.equal(value.store.getSnapshot().annotations.length, 1)
})

test('再次加入被拒绝，已有 pending 时不创建新 draft', async () => {
  const value = harness()
  await ready(value)
  const first = await attachWithInput(value)
  assert.equal(first.status, 'attached')
  value.events.length = 0
  const second = await attachWithInput(value)
  assert.deepEqual(second, { status: 'refused', reason: 'duplicate' })
  assert.deepEqual(value.events, [])
})

test('批注改动后按同一 roundId 重新生成，先加新 id 再移除旧 id', async () => {
  const value = harness()
  await ready(value)
  const first = await attachWithInput(value)
  assert.equal(first.status, 'attached')
  if (first.status !== 'attached') return
  value.events.length = 0
  value.removed.length = 0

  const result = await value.controller.regenerate({
    ...request(),
    input: {
      addAttachments(ids) {
        value.events.push('add')
        value.added.push([...ids])
        return true
      },
      removeAttachment(id) {
        value.events.push('remove')
        value.removed.push(id)
      },
    },
    annotations: [annotation({ body: '改过的意见' })],
    roundId: first.pending.roundId,
  })
  assert.equal(result.status, 'attached')
  if (result.status !== 'attached') return
  assert.equal(result.pending.roundId, first.pending.roundId)
  assert.notEqual(result.pending.draftAttachmentId, first.pending.draftAttachmentId)
  assert.ok(result.pending.feedback.includes('改过的意见'))
  assert.deepEqual(value.events, ['prepare', 'create', 'add', 'save', 'remove'])
  assert.deepEqual(value.removed, [first.pending.draftAttachmentId])
  assert.equal(value.store.getSnapshot().pending?.draftAttachmentId, result.pending.draftAttachmentId)
})

test('源文变化后拒绝按旧轮次重新生成', async () => {
  const value = harness()
  await ready(value)
  const first = await attachWithInput(value)
  assert.equal(first.status, 'attached')
  if (first.status !== 'attached') return
  value.events.length = 0

  const result = await value.controller.regenerate({
    ...request({ text: '原文改了' }),
    annotations: [annotation({ body: '改过的意见' })],
    roundId: first.pending.roundId,
  })
  assert.deepEqual(result, { status: 'refused', reason: 'source-changed' })
  assert.deepEqual(value.events, [])
  assert.equal(value.store.getSnapshot().pending?.roundId, first.pending.roundId)
})

test('createDrafts 失败时清掉已写的 pending 快照', async () => {
  const value = harness()
  await ready(value)
  value.flags.createFails = true
  const result = await attachWithInput(value)
  assert.equal(result.status, 'failed')
  assert.equal(value.detaches.length, 1)
  assert.equal(value.store.getSnapshot().pending, null)
})

test('compose session 与草稿键不一致时拒绝', async () => {
  const value = harness()
  await ready(value)
  const result = await attachWithInput(value, { composeSessionId: 's2' })
  assert.deepEqual(result, { status: 'refused', reason: 'compose-session' })
  assert.deepEqual(value.events, [])
})

test('detach 只清匹配的 roundId，匹配时移除附件并保留批注', async () => {
  const value = harness()
  await ready(value)
  const attached = await attachWithInput(value)
  assert.equal(attached.status, 'attached')
  if (attached.status !== 'attached') return
  value.events.length = 0

  const mismatch = await value.controller.detach({
    key: KEY,
    roundId: 'other-round',
    input: { addAttachments: () => true, removeAttachment: () => {} },
    phase: 'plain',
  })
  assert.equal(mismatch.status, 'refused')
  assert.deepEqual(value.events, [])

  const detached = await value.controller.detach({
    key: KEY,
    roundId: attached.pending.roundId,
    input: {
      addAttachments: () => true,
      removeAttachment(id) {
        value.events.push(`remove:${id}`)
      },
    },
    phase: 'plain',
  })
  assert.deepEqual(detached, { status: 'detached' })
  assert.ok(value.events.includes(`remove:${attached.pending.draftAttachmentId}`))
  assert.equal(value.store.getSnapshot().pending, null)
  assert.equal(value.store.getSnapshot().annotations.length, 1)
})

test('verify 需要文件名、字节数与 sha256 全部匹配', async () => {
  const value = harness()
  await ready(value)
  const attached = await attachWithInput(value)
  assert.equal(attached.status, 'attached')
  if (attached.status !== 'attached') return
  assert.equal(await value.controller.verify(attached.pending, 's1'), true)
  assert.equal(await value.controller.verify({ ...attached.pending, fileHash: '0'.repeat(64) }, 's1'), false)
  assert.equal(await value.controller.verify({ ...attached.pending, fileName: 'other.md' }, 's1'), false)
})
