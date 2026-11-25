import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createPendingHub,
  fileMatchesPending,
  initialCommitterState,
  observeCommitter,
  runCommitterEffects,
  settleCommitterState,
  transcriptFilesOfNodes,
  type CommitterEffectPorts,
  type CommitterObservation,
  type PendingEntry,
  type TranscriptFile,
} from '../client/src/annotate/committer.ts'
import type { Annotation, PendingReview } from '../client/src/annotate/model.ts'
import type { InputPhase } from '../client/src/context.ts'

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
    createdAt: '2026-11-17T00:00:00.000Z',
  }
}

function entry(roundId: string, id = `d-${roundId}`): PendingEntry {
  const pending: PendingReview = {
    roundId,
    draftAttachmentId: id,
    fileName: `a-review-${roundId}.md`,
    fileBytes: 10,
    fileHash: `hash-${roundId}`,
    sourceHash: `source-${roundId}`,
    annotations: [annotation()],
    feedback: '反馈',
    createdAt: '2026-11-17T00:00:00.000Z',
  }
  return { key: { session: 's1', path: `/w/${roundId}.md` }, pending }
}

function observe(
  phase: InputPhase,
  attachmentIds: readonly string[],
  verified: readonly string[],
  transcript: readonly TranscriptFile[] = [],
  draftText = '发送时的文本',
) {
  const observation: CommitterObservation = { phase, attachmentIds, verifiedRoundIds: verified, transcript, draftText }
  return observation
}

function options(ports: Partial<CommitterEffectPorts> = {}): CommitterEffectPorts {
  return {
    async commit() { return 'committed' },
    async detach() { return 'detached' },
    ...ports,
  }
}

test('只有 A 的附件进入输入框并发送时，只提交 A', () => {
  const a = entry('ra')
  const b = entry('rb')
  let state = initialCommitterState([a, b])

  const sending = observeCommitter(state, observe('sending', [a.pending.draftAttachmentId], [a.pending.roundId]))
  state = sending.state
  assert.equal(sending.effects.length, 0)

  const plain = observeCommitter(state, observe('plain', [], []))
  assert.deepEqual(plain.effects.map(effect => [effect.kind, effect.entry.pending.roundId]), [['commit', 'ra']])
  assert.equal(plain.effects[0]!.kind === 'commit' ? plain.effects[0]!.sentText : '', '发送时的文本')
})

test('A 与 B 的附件同时发送时，两个都提交', () => {
  const a = entry('ra')
  const b = entry('rb')
  let state = initialCommitterState([a, b])
  state = observeCommitter(state, observe('sending', [a.pending.draftAttachmentId, b.pending.draftAttachmentId], ['ra', 'rb'])).state
  const outcome = observeCommitter(state, observe('plain', [], []))
  assert.deepEqual(outcome.effects.map(effect => effect.entry.pending.roundId).sort(), ['ra', 'rb'])
})

test('A 的附件加 Web Clipper 文件：只提交 A', () => {
  const a = entry('ra')
  const clip: TranscriptFile = { name: 'clip.md', attachmentId: 'sha256:other' }
  let state = initialCommitterState([a])
  state = observeCommitter(state, observe('sending', [a.pending.draftAttachmentId, 'clip-draft'], ['ra'])).state
  const outcome = observeCommitter(state, observe('plain', ['clip-draft'], ['ra'], [clip]))
  assert.deepEqual(outcome.effects.map(effect => effect.entry.pending.roundId), ['ra'])
})

test('手动移除附件走 detach，批注不提交', () => {
  const a = entry('ra')
  let state = initialCommitterState([a])
  state = observeCommitter(state, observe('plain', [a.pending.draftAttachmentId], ['ra'])).state
  const outcome = observeCommitter(state, observe('plain', [], []))
  assert.deepEqual(outcome.effects.map(effect => effect.kind), ['detach'])
  assert.equal(outcome.state.candidates.length, 1, '效果执行前候选还在')
})

test('发送失败：回到 plain 时 id 还在，不提交也不 detach', () => {
  const a = entry('ra')
  let state = initialCommitterState([a])
  state = observeCommitter(state, observe('sending', [a.pending.draftAttachmentId], ['ra'])).state
  const failed = observeCommitter(state, observe('plain', [a.pending.draftAttachmentId], ['ra']))
  assert.equal(failed.effects.length, 0)
  assert.equal(failed.state.latched.size, 0)
  // A later manual removal is then a detach, not a commit.
  const removed = observeCommitter(failed.state, observe('plain', [], []))
  assert.deepEqual(removed.effects.map(effect => effect.kind), ['detach'])
})

test('两次顺序发送各自提交，第二次不受第一次 inFlight 影响', () => {
  const first = entry('r1')
  let state = initialCommitterState([first])
  state = observeCommitter(state, observe('sending', [first.pending.draftAttachmentId], ['r1'])).state
  const firstOutcome = observeCommitter(state, observe('plain', [], []))
  state = settleCommitterState(firstOutcome.state, [{ roundId: 'r1', effect: 'commit', result: 'committed' }])
  assert.equal(state.candidates.length, 0)

  const second = entry('r2')
  state = { ...state, candidates: [second] }
  state = observeCommitter(state, observe('sending', [second.pending.draftAttachmentId], ['r2'])).state
  const secondOutcome = observeCommitter(state, observe('plain', [], []))
  assert.deepEqual(secondOutcome.effects.map(effect => effect.entry.pending.roundId), ['r2'])
})

test('重复的移除观察只产生一次 detach', () => {
  const a = entry('ra')
  let state = observeCommitter(initialCommitterState([a]), observe('plain', [a.pending.draftAttachmentId], ['ra'])).state
  const first = observeCommitter(state, observe('plain', [], []))
  assert.equal(first.effects.length, 1)
  state = first.state
  const second = observeCommitter(state, observe('plain', [], []))
  assert.equal(second.effects.length, 0)
})

test('刷新后的兜底：最近用户消息的 FileBlock 命中 roundId 或 sha256 即提交', () => {
  const a = entry('ra')
  const byName: TranscriptFile = { name: `a-review-${a.pending.roundId}.md`, attachmentId: 'sha256:unknown' }
  const byHash: TranscriptFile = { name: 'renamed.md', attachmentId: `sha256:${a.pending.fileHash}` }
  assert.equal(fileMatchesPending(byName, a.pending), true)
  assert.equal(fileMatchesPending(byHash, a.pending), true)
  assert.equal(fileMatchesPending({ name: 'clip.md', attachmentId: 'sha256:nope' }, a.pending), false)

  const outcome = observeCommitter(initialCommitterState([a]), observe('plain', [], [], [byHash]))
  assert.deepEqual(outcome.effects.map(effect => effect.kind), ['commit'])
})

test('提交失败保留候选，下一次观察重试', async () => {
  const a = entry('ra')
  const observation = observe('plain', [], [], [{ name: `x-${a.pending.roundId}.md`, attachmentId: 'sha256:x' }])
  let attempt = 0
  const ports = options({
    async commit() {
      attempt += 1
      return attempt === 1 ? 'failed' : 'committed'
    },
  })

  const first = observeCommitter(initialCommitterState([a]), observation)
  assert.equal(first.effects.length, 1)
  let state = settleCommitterState(first.state, await runCommitterEffects(first.effects, ports))
  assert.equal(state.candidates.length, 1)
  assert.equal(state.inFlight.size, 0)

  const retry = observeCommitter(state, observation)
  assert.deepEqual(retry.effects.map(effect => effect.kind), ['commit'])
  state = settleCommitterState(retry.state, await runCommitterEffects(retry.effects, ports))
  assert.equal(state.candidates.length, 0)
  assert.equal(attempt, 2)
})

test('slash 命令的 submitting 完全忽略，已有候选保留', () => {
  const a = entry('ra')
  let state = initialCommitterState([a])
  state = observeCommitter(state, observe('plain', [a.pending.draftAttachmentId], ['ra'])).state
  const submitting = observeCommitter(state, observe('submitting', [], []))
  assert.equal(submitting.effects.length, 0)
  assert.deepEqual(submitting.state, state)
})

test('legacy ConversationNode 的顶层 content 也能读到 FileBlock', () => {
  const files = transcriptFilesOfNodes([{
    kind: 'user',
    content: [{
      type: 'file',
      attachment: {
        attachmentId: 'sha256:abc',
        name: 'a-review-r1.md',
        bytes: 12,
      },
    }],
  }])
  assert.deepEqual(files, [{ name: 'a-review-r1.md', attachmentId: 'sha256:abc' }])
})

test('pending hub 同一文档换轮次时只保留最新一条', () => {
  const hub = createPendingHub()
  const first = entry('ra')
  const second = entry('rc', 'd-rc')
  second.key = { ...second.key, path: first.key.path }
  hub.set(first)
  hub.set(second)
  assert.deepEqual(hub.list('s1').map(item => item.pending.roundId), ['rc'])
})

test('pending hub 按会话广播，set/remove/clear 不串会话', () => {
  const hub = createPendingHub()
  const a = entry('ra')
  const b = entry('rb', 'd-rb')
  const notifications: string[] = []
  const unsubscribe = hub.subscribe('s1', () => notifications.push('s1'))
  hub.subscribe('s2', () => notifications.push('s2'))

  hub.set(a)
  hub.set(b)
  assert.deepEqual(hub.list('s1').map(item => item.pending.roundId), ['ra', 'rb'])
  hub.remove({ session: 's1', path: '/w/ra.md' }, 'ra')
  assert.deepEqual(hub.list('s1').map(item => item.pending.roundId), ['rb'])
  hub.clear('rb')
  assert.deepEqual(hub.list('s1'), [])
  assert.ok(notifications.length >= 4)
  assert.equal(notifications.includes('s2'), false)
  unsubscribe()
})
