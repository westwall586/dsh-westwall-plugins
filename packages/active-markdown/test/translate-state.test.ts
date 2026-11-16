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
const RUN: PromptRun = { promptVersion: 'am.translate.v1', extraInstruction: '' }

test('缓存里的译文能看，但没有可保存的副本', () => {
  const restored = readyState({ text: TRANSLATED, sourceText: SOURCE, source: { kind: 'cache' }, run: RUN })
  assert.equal(translatedText(restored), TRANSLATED)
  assert.equal(saveable(restored), undefined)
  assert.equal(staleNoticeOf(restored), false)
  assert.equal(translatedText({ status: 'idle' }), undefined)
})

test('已保存的译文过期时提示原文已更新，忽略后不再提示且译文仍可读', () => {
  const restored = readyState({
    text: TRANSLATED,
    sourceText: SOURCE,
    source: { kind: 'saved', stale: true, dismissed: false },
    run: RUN,
  })
  assert.equal(staleNoticeOf(restored), true)
  assert.equal(translatedText(restored), TRANSLATED)

  const dismissed = dismissStale(restored)
  assert.equal(staleNoticeOf(dismissed), false)
  assert.equal(translatedText(dismissed), TRANSLATED)
})

test('本次翻译的结果可以保存，保存成功后不再提示过期', () => {
  const ready = readyState({ text: TRANSLATED, sourceText: SOURCE, source: { kind: 'run' }, run: RUN })
  assert.equal(lineAligned(ready), true)
  assert.equal(saveable(ready), ready)

  const saved = markSaved(ready)
  assert.notEqual(saveable(saved), undefined)
  assert.equal(staleNoticeOf(saved), false)
  assert.equal(translatedText(saved), TRANSLATED)
})

test('行数不一致时停止逐行对齐，译文照常可读', () => {
  const unmatched = readyState({
    text: '# 标题\n\n第一行。\n',
    sourceText: SOURCE,
    source: { kind: 'run' },
    run: RUN,
  })
  assert.equal(unmatched.sourceLines, 4)
  assert.equal(unmatched.translatedLines, 3)
  assert.equal(lineAligned(unmatched), false)
  assert.equal(translatedText(unmatched), '# 标题\n\n第一行。\n')
})
