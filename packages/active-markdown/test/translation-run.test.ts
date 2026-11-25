import test from 'node:test'
import assert from 'node:assert/strict'

import type { HostBridge } from '../client/src/context.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import type { TranslationRun } from '../client/src/store/kernel/translation.ts'
import type { ReadyTranslation, TranslationState } from '../client/src/translate/state.ts'

const SESSION = 's1'
const PATH = '/w/a.md'
const SOURCE = '# Title\n\nBody line.\n\nAnother line.\n'
const TRANSLATED = '# 标题\n\n正文。\n\n另一行。\n'
const REF = { session: SESSION, compose: SESSION, path: PATH }

interface Harness {
  documents: ReturnType<typeof createDocumentStore>
  run: TranslationRun
  calls: string[]
  signals: AbortSignal[]
  /** Release one pending translation call with the text it should answer. */
  reply(text: string): void
}

function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

function harness(): Harness {
  const calls: string[] = []
  const signals: AbortSignal[] = []
  const pending: Array<{ resolve: (text: string) => void, reject: (error: unknown) => void }> = []
  const bridge = {
    async describe() {
      return {
        promptVersion: 'am.translate.v2',
        settings: { lang: 'zh', model: { provider: 'deepseek', model: 'chat' }, translateComments: true },
        languages: [],
      }
    },
    async cacheGet() {
      return null
    },
    async cachePut() {},
    async save(request: { translated: string }) {
      return { file: `.dsh-active-markdown/translate/zh/${request.translated.length}.md`, meta: { promptVersion: 'am.translate.v2', lang: 'zh', provider: 'deepseek', model: 'chat' } }
    },
    translate(request: { text: string }, signal?: AbortSignal) {
      calls.push(request.text)
      if (signal !== undefined) signals.push(signal)
      return new Promise<string>((resolve, reject) => {
        pending.push({ resolve, reject })
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    },
  }
  const documents = createDocumentStore({ host: async () => bridge as unknown as HostBridge })
  return {
    documents,
    run: documents.runFor(SESSION, PATH),
    calls,
    signals,
    reply(text) {
      const next = pending.shift()
      assert.ok(next !== undefined, '没有挂起的翻译请求')
      next.resolve(text)
    },
  }
}

function source(): { text: string, absolutePath: string } {
  return { text: SOURCE, absolutePath: PATH }
}

test('卸载不 abort 翻译：切页签后请求继续，进度留在 crate 里', async () => {
  const h = harness()
  h.documents.mount(REF)
  h.run.start(source(), '', false)
  await flush()
  assert.equal(h.run.getState().status, 'running')
  assert.equal(h.calls.length, 1)

  // A tab switch unmounts the body and releases the composer; nothing else runs.
  h.documents.unmount(REF)
  h.documents.release(REF.compose, REF.path, REF.session)
  await flush()

  assert.equal(h.signals[0]?.aborted, false, '卸载后控制器没被 abort')
  assert.equal(h.run.controller()?.signal.aborted, false)
  assert.equal(h.run.getState().status, 'running')

  // 切回来：同一个 crate 的同一个运行，状态还在。
  h.documents.mount(REF)
  const again = h.documents.runFor(SESSION, PATH)
  assert.equal(again, h.run)
  assert.deepEqual(again.getState(), h.run.getState())
})

test('重挂载后用同样的意图再点一次，不会重发请求', async () => {
  const h = harness()
  h.documents.mount(REF)
  h.run.start(source(), '', false)
  await flush()
  h.documents.unmount(REF)
  h.documents.mount(REF)

  h.documents.runFor(SESSION, PATH).start(source(), '', false)
  await flush()

  assert.equal(h.calls.length, 1, '仍在跑的那次被复用，没有发出第二个请求')
})

test('运行结束后挂起的分段落地为 ready，并落盘', async () => {
  const h = harness()
  h.run.start(source(), '', false)
  await flush()
  h.reply(TRANSLATED)
  await flush()
  await flush()

  const state = h.run.getState() as ReadyTranslation
  assert.equal(state.status, 'ready')
  // normalize 会吃掉文件末尾那个换行，所以比较规范化后的结果。
  assert.equal(state.text, TRANSLATED.trimEnd())
  assert.equal(state.persistence.kind, 'saved')
})

test('abort 结束运行，晚到的分段结果不会再写回状态', async () => {
  const h = harness()
  h.run.start(source(), '', false)
  await flush()

  h.run.abort()
  assert.equal(h.run.getState().status, 'idle')
  assert.equal(h.signals[0]?.aborted, true)

  h.reply(TRANSLATED)
  await flush()
  assert.equal(h.run.getState().status, 'idle')
})

test('同一文件被两个 compose 会话打开，拿到同一个运行', () => {
  const h = harness()
  h.documents.mount({ session: SESSION, compose: 's2', path: PATH })
  assert.equal(h.documents.runFor(SESSION, PATH), h.run)
})

test('磁盘上的译文只在还没有状态时放进来', async () => {
  const h = harness()
  const restored: ReadyTranslation = {
    status: 'ready',
    text: TRANSLATED,
    source: SOURCE,
    alignment: (await import('../client/src/translate/verify.ts')).alignOf(SOURCE, TRANSLATED),
    persistence: { kind: 'saved', stale: false, dismissed: false, file: 'x.md' },
    run: { promptVersion: 'am.translate.v2', extraInstruction: '', lang: 'zh', translateComments: true },
  }
  h.run.start(source(), '', false)
  await flush()

  h.run.restore(restored)
  const running: TranslationState = h.run.getState()
  assert.equal(running.status, 'running', '正在跑的那次不被旧结果顶掉')
})
