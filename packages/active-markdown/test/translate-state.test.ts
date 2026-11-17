import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dismissStale,
  lineAligned,
  markSaved,
  readyState,
  saveable,
  staleNoticeOf,
  translatedText,
  type PromptRun,
} from '../client/src/translate/state.ts'

const SOURCE = '# Title\n\nLine one.\nLine two.\n'
const TRANSLATED = '# 标题\n\n第一行。\n第二行。\n'
const RUN: PromptRun = {
  promptVersion: 'am.translate.v1',
  extraInstruction: '',
  lang: 'zh',
  translateComments: true,
}

test('缓存里的译文没写进工作区，因此可以保存', () => {
  const restored = readyState({ text: TRANSLATED, sourceText: SOURCE, persistence: { kind: 'unsaved' }, run: RUN })
  assert.equal(translatedText(restored), TRANSLATED)
  assert.equal(saveable(restored), restored)
  assert.equal(staleNoticeOf(restored), false)
  assert.equal(translatedText({ status: 'idle' }), undefined)
})

test('已保存的译文过期时提示原文已更新，忽略后不再提示，且都不可再保存', () => {
  const restored = readyState({
    text: TRANSLATED,
    sourceText: SOURCE,
    persistence: { kind: 'saved', stale: true, dismissed: false },
    run: RUN,
  })
  assert.equal(staleNoticeOf(restored), true)
  assert.equal(saveable(restored), undefined)
  assert.equal(translatedText(restored), TRANSLATED)

  const dismissed = dismissStale(restored)
  assert.equal(staleNoticeOf(dismissed), false)
  assert.equal(saveable(dismissed), undefined)
  assert.equal(translatedText(dismissed), TRANSLATED)
})

test('本次翻译的结果可以保存，保存成功后不再提示过期也不再可保存', () => {
  const ready = readyState({ text: TRANSLATED, sourceText: SOURCE, persistence: { kind: 'unsaved' }, run: RUN })
  assert.equal(lineAligned(ready), true)
  assert.equal(saveable(ready), ready)

  const saved = markSaved(ready)
  assert.equal(saveable(saved), undefined)
  assert.equal(staleNoticeOf(saved), false)
  assert.equal(translatedText(saved), TRANSLATED)
})

test('行数相同但标题断了时停止逐行对齐，译文照常可读', () => {
  const broken = readyState({
    text: '## 标题\n\n第一行。\n第二行。\n',
    sourceText: SOURCE,
    persistence: { kind: 'unsaved' },
    run: RUN,
  })
  assert.equal(broken.alignment.sourceLines, broken.alignment.translatedLines)
  assert.deepEqual(broken.alignment.headingBreak, {
    kind: 'mismatch',
    source: { line: 1, level: 1 },
    translated: { line: 1, level: 2 },
  })
  assert.equal(lineAligned(broken), false)
  assert.equal(translatedText(broken), '## 标题\n\n第一行。\n第二行。\n')
})

test('行数不一致时停止逐行对齐，译文照常可读', () => {
  const unmatched = readyState({
    text: '# 标题\n\n第一行。\n',
    sourceText: SOURCE,
    persistence: { kind: 'unsaved' },
    run: RUN,
  })
  assert.equal(unmatched.alignment.sourceLines, 4)
  assert.equal(unmatched.alignment.translatedLines, 3)
  assert.equal(lineAligned(unmatched), false)
  assert.equal(translatedText(unmatched), '# 标题\n\n第一行。\n')
})

test('运行中的部分译文只渲染，完成校验后才开放逐行对照', () => {
  assert.equal(lineAligned({ status: 'running', chunk: 1, chunks: 2 }), false)
  assert.equal(lineAligned({ status: 'running', chunk: 1, chunks: 2, partial: TRANSLATED }), false)
  assert.equal(translatedText({ status: 'running', chunk: 1, chunks: 2, partial: TRANSLATED }), TRANSLATED)
})
