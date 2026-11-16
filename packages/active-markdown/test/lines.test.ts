import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import { splitSourceLines } from '../client/src/markdown/lines.ts'
import { inlineText, type ParagraphBlock } from '../client/src/markdown/model.ts'

function paragraphOf(text: string): ParagraphBlock {
  const block = parseDocument(text).blocks[0]
  if (block === undefined || block.type !== 'paragraph') assert.fail('expected one paragraph block')
  return block
}

test('一个软换行切成一条源行', () => {
  const block = paragraphOf('第一行\n第二行')
  const lines = splitSourceLines(block.inline, block.sourceStartLine)
  assert.deepEqual(lines.map(line => line.line), [1, 2])
  assert.deepEqual(lines.map(line => inlineText(line.inline)), ['第一行', '第二行'])
})

test('行号相对整份文件，front matter 之后不归零', () => {
  const block = paragraphOf('---\ntitle: Demo\n---\n\n第一行\n第二行\n')
  const lines = splitSourceLines(block.inline, block.sourceStartLine)
  assert.deepEqual(lines.map(line => line.line), [5, 6])
})

test('嵌套在强调里的软换行计入下一条源行', () => {
  const block = paragraphOf('一\n二 **粗\n体** 尾\n四')
  const lines = splitSourceLines(block.inline, block.sourceStartLine)
  assert.deepEqual(lines.map(line => line.line), [1, 2, 4])
})

test('硬换行切开源行并留在上一行末尾', () => {
  const block = paragraphOf('甲  \n乙')
  const lines = splitSourceLines(block.inline, block.sourceStartLine)
  assert.deepEqual(lines.map(line => line.line), [1, 2])
  assert.deepEqual(lines.map(line => line.break), ['hard', undefined])
})

test('围栏代码的正文从围栏下一行开始，缩进代码从块首行开始', () => {
  const fenced = parseDocument('```ts\nconst x = 1\n```\n').blocks[0]
  assert.ok(fenced !== undefined && fenced.type === 'code')
  assert.equal(fenced.fence, true)
  assert.equal(fenced.sourceStartLine + 1, 2)
  const indented = parseDocument('    const x = 1\n').blocks[0]
  assert.ok(indented !== undefined && indented.type === 'code')
  assert.equal(indented.fence, false)
  assert.equal(indented.sourceStartLine, 1)
})
