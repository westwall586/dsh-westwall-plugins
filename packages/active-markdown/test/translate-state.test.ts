import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dismissStale,
  lineAligned,
  markSaveFailed,
  markSaved,
  markSaving,
  needsSave,
  readyState,
  saveFlagOf,
  staleNoticeOf,
  translatedText,
  type PromptRun,
} from '../client/src/translate/state.ts'

const SOURCE = '# Title\n\nLine one.\nLine two.\n'
const TRANSLATED = '# 标题\n\n第一行。\n第二行。\n'
const FILE = '.dsh-active-markdown/translate/zh/docs/a/README.md'
const RUN: PromptRun = {
  promptVersion: 'am.translate.v1',
  extraInstruction: '',
  lang: 'zh',
  translateComments: true,
}

test('缓存里的译文没写进工作区，因此需要落盘', () => {
  const restored = readyState({ text: TRANSLATED, sourceText: SOURCE, persistence: { kind: 'unsaved' }, run: RUN })
  assert.equal(translatedText(restored), TRANSLATED)
  assert.equal(needsSave(restored), restored)
  assert.equal(saveFlagOf(restored), null)
  assert.equal(staleNoticeOf(restored), false)
  assert.equal(translatedText({ status: 'idle' }), undefined)
})

test('译文带着自己的原文快照，落盘时按它算 hash，不跟随后来的标签页', () => {
  const ready = readyState({ text: TRANSLATED, sourceText: SOURCE, persistence: { kind: 'saving' }, run: RUN })
  assert.equal(ready.source, SOURCE)
  assert.equal(ready.alignment.sourceLines, 4)
})

test('已保存的译文过期时提示原文已更新，忽略后不再提示，且都不可再落盘', () => {
  const restored = readyState({
    text: TRANSLATED,
    sourceText: SOURCE,
    persistence: { kind: 'saved', stale: true, dismissed: false, file: FILE },
    run: RUN,
  })
  assert.equal(staleNoticeOf(restored), true)
  assert.equal(needsSave(restored), undefined)
  assert.equal(translatedText(restored), TRANSLATED)
  assert.deepEqual(saveFlagOf(restored), { kind: 'saved', file: FILE })

  const dismissed = dismissStale(restored)
  assert.equal(staleNoticeOf(dismissed), false)
  assert.equal(needsSave(dismissed), undefined)
  assert.equal(translatedText(dismissed), TRANSLATED)
})

test('自动落盘：写盘中进行中、成功后显示文件名、失败后只剩重试', () => {
  const ready = readyState({ text: TRANSLATED, sourceText: SOURCE, persistence: { kind: 'unsaved' }, run: RUN })
  assert.equal(lineAligned(ready), true)
  assert.equal(needsSave(ready), ready)

  const saving = markSaving(ready)
  assert.deepEqual(saveFlagOf(saving), { kind: 'saving' })
  assert.equal(needsSave(saving), undefined)

  const saved = markSaved(saving, FILE)
  assert.equal(needsSave(saved), undefined)
  assert.equal(staleNoticeOf(saved), false)
  assert.deepEqual(saveFlagOf(saved), { kind: 'saved', file: FILE })
  assert.equal(translatedText(saved), TRANSLATED)

  const failed = markSaveFailed(saving, '磁盘只读')
  assert.deepEqual(saveFlagOf(failed), { kind: 'retry', message: '磁盘只读' })
  assert.equal(needsSave(failed), failed)
  assert.equal(translatedText(failed), TRANSLATED)
})

test('没有译文的视图不显示保存状态', () => {
  assert.equal(saveFlagOf({ status: 'idle' }), null)
  assert.equal(saveFlagOf({ status: 'running', chunk: 1, chunks: 1 }), null)
  assert.equal(needsSave({ status: 'idle' }), undefined)
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
