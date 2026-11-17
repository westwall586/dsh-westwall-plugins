import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  FEEDBACK_INSTRUCTION,
  feedbackFileOf,
  feedbackFileName,
  newRoundId,
  renderFeedback,
  sha256Hex,
} from '../client/src/annotate/feedback.ts'
import type { Annotation } from '../client/src/annotate/model.ts'

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    seq: 1,
    kind: 'text',
    body: '意见一',
    quote: '原文一\n第二行',
    prefix: '',
    suffix: '',
    startOffset: 0,
    blockStartId: 'paragraph-1',
    blockEndId: 'paragraph-1',
    blockSignature: '',
    section: '章节',
    lineStart: 12,
    lineEnd: 14,
    createdAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  }
}

test('roundId 短且只含 [a-z0-9]', () => {
  const values = [0, 0.1, 0.5, 0.99, 0.999]
  let index = 0
  const id = newRoundId(() => values[index++ % values.length]!)
  assert.match(id, /^[a-z0-9]{8}$/)
  assert.equal(newRoundId(() => 0), 'aaaaaaaa')
  assert.equal(newRoundId(() => 0.999), '99999999')
})

test('文件名取文档名去掉扩展名，roundId 在 sanitize 后仍保留', () => {
  assert.equal(feedbackFileName('docs/designs/P2.md', 'ab12cd34'), 'P2-review-ab12cd34.md')
  assert.equal(feedbackFileName('C:\\docs\\我的 文档.markdown', 'ab12cd34'), '我的 文档-review-ab12cd34.md')
  assert.equal(feedbackFileName('docs/a:b*c?.md', 'ab12cd34'), 'a_b_c_-review-ab12cd34.md')
  assert.equal(feedbackFileName('', 'ab12cd34'), 'document-review-ab12cd34.md')
})

test('反馈文件有 frontmatter、路径只出现一次、没有标签和版本', () => {
  const content = renderFeedback({
    roundId: 'ab12cd34',
    sourcePath: 'docs/a.md',
    annotations: [annotation()],
  })
  const lines = content.split('\n')
  assert.deepEqual(lines.slice(0, 5), [
    '---',
    'dsh-active-markdown-review: ab12cd34',
    'source: docs/a.md',
    '---',
    '',
  ])
  assert.ok(content.includes('文件路径：docs/a.md'))
  assert.equal(content.split('docs/a.md').length - 1, 2, 'frontmatter 与正文各一次')
  assert.ok(content.includes('## 我的反馈'))
  assert.ok(content.includes('行号：12-14'))
  assert.ok(content.includes('原文：\n> 原文一\n> 第二行'))
  assert.ok(content.includes('意见：\n> 意见一'))
  assert.ok(content.trimEnd().endsWith(FEEDBACK_INSTRUCTION))
  assert.equal(content.includes('标签'), false)
  assert.equal(content.includes('版本'), false)
  assert.equal(content.includes('优先级'), false)
})

test('无法定位的条目排在最后并注明原文可能已变化', () => {
  const first = annotation({ id: 'a1', seq: 1, lineStart: 5, lineEnd: 5, quote: '定位得到' })
  const second = annotation({ id: 'a2', seq: 2, lineStart: 40, lineEnd: 40, quote: '定位不到' })
  const content = renderFeedback({
    roundId: 'r1',
    sourcePath: 'docs/a.md',
    annotations: [second, first],
    unlocatable: new Set(['a2']),
  })
  assert.ok(content.indexOf('定位得到') < content.indexOf('定位不到'))
  assert.ok(content.includes('行号：40（原文可能已变化）'))
  assert.equal(content.includes('行号：5（原文可能已变化）'), false)
})

test('单行批注的行号不带范围', () => {
  const content = renderFeedback({
    roundId: 'r1',
    sourcePath: 'a.md',
    annotations: [annotation({ lineStart: 7, lineEnd: 7 })],
  })
  assert.ok(content.includes('行号：7\n'))
  assert.equal(content.includes('行号：7-7'), false)
})

test('字节数是 UTF-8 长度，hash 与文件内容一致', async () => {
  const file = feedbackFileOf({
    roundId: 'r1',
    sourcePath: 'docs/a.md',
    annotations: [annotation()],
  })
  assert.equal(file.bytes, Buffer.byteLength(file.content, 'utf8'))
  const expected = createHash('sha256').update(file.content, 'utf8').digest('hex')
  assert.equal(await sha256Hex(file.content), expected)
})
