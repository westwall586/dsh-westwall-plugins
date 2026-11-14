import { test } from 'node:test'
import assert from 'node:assert/strict'

const { PLACEMENT_TIMEOUT_MS, attachArtifact, hasDirectIntake } = await import('../client/src/attach.mjs')

const ARTIFACT = {
  kind: 'markdown',
  title: 'Article',
  url: 'https://example.com/a',
  name: 'Article.md',
  type: 'text/markdown',
  content: '---\ntitle: "Article"\n---\nbody',
}

test('direct path creates a File and adds the draft ids', async () => {
  let created
  let added
  const drafts = [{ id: 'd1' }, { id: 'd2' }]
  const conversation = {
    createDrafts(sessionId, files, uploadImages) {
      created = { sessionId, files, uploadImages }
      return drafts
    },
    releaseDraftAttachments() {
      assert.fail('a successful add must not release drafts')
    },
  }
  const inputActions = { addAttachments(ids) { added = ids; return true } }

  assert.equal(hasDirectIntake(conversation, inputActions), true)
  const result = await attachArtifact({ artifact: ARTIFACT, sessionId: 's1', inputActions, conversation })
  assert.deepEqual(result, { ok: true, mode: 'draft' })
  assert.equal(created.sessionId, 's1')
  assert.equal(created.uploadImages, true)
  assert.equal(created.files.length, 1)
  assert.equal(created.files[0].name, 'Article.md')
  assert.equal(created.files[0].type, 'text/markdown')
  assert.equal(await created.files[0].text(), ARTIFACT.content)
  assert.deepEqual(added, ['d1', 'd2'])
})

test('a refused add releases the drafts and reports composer-busy', async () => {
  const drafts = [{ id: 'd1' }]
  let released
  const conversation = {
    createDrafts: () => drafts,
    releaseDraftAttachments(value) { released = value },
  }
  const inputActions = { addAttachments: () => false }

  const result = await attachArtifact({ artifact: ARTIFACT, sessionId: 's1', inputActions, conversation })
  assert.deepEqual(result, { ok: false, code: 'composer-busy' })
  assert.equal(released, drafts)
})

test('a throw while creating drafts reports attach-failed', async () => {
  const conversation = {
    createDrafts: () => { throw new Error('draft boom') },
    releaseDraftAttachments() {},
  }
  const result = await attachArtifact({
    artifact: ARTIFACT,
    sessionId: 's1',
    inputActions: { addAttachments: () => true },
    conversation,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'attach-failed')
})

test('fallback dispatches one synthetic drop and confirms the rail', async () => {
  const files = []
  const dispatched = []
  class FakeDataTransfer {
    constructor() { this.items = { add: (file) => files.push(file) } }
  }
  class FakeDragEvent {
    constructor(type, init) {
      this.type = type
      Object.assign(this, init)
    }
  }
  const doc = {
    dispatchEvent(event) { dispatched.push(event); return true },
    querySelector: () => ({ textContent: `attachment ${files[0]?.name ?? ''}` }),
  }

  const result = await attachArtifact({
    artifact: ARTIFACT,
    sessionId: 's1',
    inputActions: {},
    conversation: undefined,
    doc,
    DataTransfer: FakeDataTransfer,
    DragEvent: FakeDragEvent,
    sleep: async () => {},
    timeoutMs: 50,
  })
  assert.deepEqual(result, { ok: true, mode: 'drop' })
  assert.equal(dispatched.length, 1)
  assert.equal(dispatched[0].type, 'drop')
  assert.equal(dispatched[0].bubbles, true)
  assert.equal(dispatched[0].cancelable, true)
  assert.equal(files[0].name, 'Article.md')
  assert.equal(files[0].type, 'text/markdown')
})

test('the fallback is never used when the direct service exists', async () => {
  const conversation = {
    createDrafts: () => [{ id: 'd1' }],
    releaseDraftAttachments() {},
  }
  const doc = {
    dispatchEvent() { assert.fail('direct path must not dispatch a drop') },
    querySelector() { return null },
  }
  const result = await attachArtifact({
    artifact: ARTIFACT,
    sessionId: 's1',
    inputActions: { addAttachments: () => true },
    conversation,
    doc,
  })
  assert.deepEqual(result, { ok: true, mode: 'draft' })
})

test('a missing drop capability reports attach-failed', async () => {
  const result = await attachArtifact({
    artifact: ARTIFACT,
    sessionId: 's1',
    inputActions: {},
    conversation: undefined,
    doc: { querySelector: () => null, dispatchEvent() {} },
    DataTransfer: null,
    DragEvent: null,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'attach-failed')
})

test('an unplaced drop times out with a bounded poll', async () => {
  let polls = 0
  const doc = {
    dispatchEvent() {},
    querySelector() { polls += 1; return null },
  }
  class FakeDataTransfer { constructor() { this.items = { add() {} } } }
  class FakeDragEvent { constructor(type, init) { this.type = type; Object.assign(this, init) } }
  const result = await attachArtifact({
    artifact: ARTIFACT,
    sessionId: 's1',
    inputActions: {},
    conversation: undefined,
    doc,
    DataTransfer: FakeDataTransfer,
    DragEvent: FakeDragEvent,
    sleep: async () => {},
    timeoutMs: 20,
  })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'attach-failed')
  assert.ok(polls > 1)
  assert.ok(PLACEMENT_TIMEOUT_MS >= 1000)
})