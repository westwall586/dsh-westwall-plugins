import test from 'node:test'
import assert from 'node:assert/strict'

import type { HostBridge } from '../client/src/context.ts'
import { decideLoad } from '../client/src/document-load.ts'
import { createDocumentStore } from '../client/src/store/document.ts'
import type { TranslationRun } from '../client/src/store/kernel/translation.ts'
import { sameText } from '../client/src/edit/model.ts'

const SESSION = 's1'
const PATH = '/w/a.md'
const REF = { session: SESSION, compose: SESSION, path: PATH }
const SOURCE = '# Title\n\nBody line.\n\nAnother line.\n'
const TRANSLATED = '# 标题\n\n正文。\n\n另一行。\n'

function decide(previous: { text: string, version: string } | null, version: string, text: string, changedDocument = false) {
  return decideLoad({ changedDocument, previous, version, text, sameText })
}

test('刷新恢复的页签第一次读取：没有可比较的上一次，按初次打开', () => {
  assert.equal(decide(null, 'v1', SOURCE), 'first')
})

test('同版本重读：宿主刷新、保存后重载都不是外部改写', () => {
  assert.equal(decide({ text: SOURCE, version: 'v1' }, 'v1', SOURCE), 'same')
})

test('同版本但正文不同：只有异常路径，按外部改写处理', () => {
  assert.equal(decide({ text: SOURCE, version: 'v1' }, 'v1', '# Other\n'), 'rewrite')
})

test('版本变了但正文一致：普通重读，不是外部改写', () => {
  assert.equal(decide({ text: SOURCE, version: 'v1' }, 'v2', SOURCE), 'reload')
})

test('版本与正文都变了：外部改写', () => {
  assert.equal(decide({ text: SOURCE, version: 'v1' }, 'v2', '# Changed\n'), 'external-change')
})

test('换文档时上一次读到的正文不参与比较', () => {
  assert.equal(decide({ text: SOURCE, version: 'v1' }, 'v1', SOURCE, true), 'first')
})

test('不在编辑态时，版本身份不变的重读不 abort 正在跑的翻译', async () => {
  const calls: string[] = []
  const pending: Array<(text: string) => void> = []
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
    async save() {
      return { file: '.dsh-active-markdown/translate/zh/a.md', meta: { promptVersion: 'am.translate.v2', lang: 'zh', provider: 'deepseek', model: 'chat' } }
    },
    translate(request: { text: string }) {
      calls.push(request.text)
      return new Promise<string>((resolve) => { pending.push(resolve) })
    },
  }
  const documents = createDocumentStore({ host: async () => bridge as unknown as HostBridge, readingDelayMs: 0 })
  documents.mount(REF)
  const run = documents.runFor(SESSION, PATH) as TranslationRun
  run.start({ text: SOURCE, absolutePath: PATH }, '', false)
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  assert.equal(run.getState().status, 'running')

  // body 收到一次 revision 重载并读回同一正文：这是 `same`，不该打断翻译。
  const decision = decide({ text: SOURCE, version: 'v1' }, 'v1', SOURCE)
  assert.equal(decision, 'same')
  assert.equal(run.controller()?.signal.aborted, false, '重读没有 abort 运行')
  assert.equal(run.getState().status, 'running', '翻译继续')

  pending.shift()?.(TRANSLATED)
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  assert.equal(run.getState().status, 'ready')
  assert.equal(calls.length, 1)
})
