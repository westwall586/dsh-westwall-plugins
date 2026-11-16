import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import {
  CHAR_CAP, HARD_LINE_CAP, LINE_CAP, assembleTranslation, countLines, normalize, planTranslation,
  type ChunkPlan, type LineRange,
} from '../client/src/translate/plan.ts'

/** 每节 10 行：标题、空行、7 行正文、空行。 */
function documentOf(heading: string, sections: number): string {
  const lines: string[] = []
  for (let index = 0; index < sections; index += 1) {
    lines.push(`${heading}第 ${index} 节`, '')
    for (let row = 0; row < 7; row += 1) lines.push(`第 ${index} 节第 ${row} 行正文。`)
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function planFor(text: string): ChunkPlan {
  return planTranslation(text, parseDocument(text).blocks)
}

function rangesOf(text: string): readonly LineRange[] {
  const plan = planFor(text)
  if (plan.kind === 'too-large') assert.fail(`应当给出分块计划，实际以 ${plan.lineCount} 行拒绝`)
  return plan.ranges
}

function sourceLines(text: string): string[] {
  return normalize(text).split('\n')
}

function assertTiles(text: string, ranges: readonly LineRange[]): void {
  assert.ok(ranges.length > 0, '至少一段')
  assert.equal(ranges[0].start, 0, '从第一行开始')
  for (const [index, range] of ranges.entries()) {
    assert.ok(range.end > range.start, `第 ${index} 段非空`)
    if (index > 0) assert.equal(range.start, ranges[index - 1].end, `第 ${index} 段紧接上一段`)
  }
  assert.equal(ranges[ranges.length - 1].end, countLines(text), '最后一段收在末行')
}

function assertBlockStarts(text: string, ranges: readonly LineRange[]): void {
  const starts = new Set([0, ...parseDocument(text).blocks.map(block => block.sourceStartLine - 1)])
  for (const range of ranges) assert.ok(starts.has(range.start), `第 ${range.start} 行是块边界`)
}

function assertWithinCaps(text: string, ranges: readonly LineRange[]): void {
  const lines = sourceLines(text)
  for (const range of ranges) {
    assert.ok(range.end - range.start <= LINE_CAP, `第 ${range.start} 段行数不超上限`)
    assert.ok(lines.slice(range.start, range.end).join('\n').length <= CHAR_CAP, `第 ${range.start} 段字符数不超上限`)
  }
}

/** Run the plan, translate each chunk with `translate`, and assemble the replies back. */
function assembleFor(text: string, translate: (chunk: string, index: number) => string): string {
  const ranges = rangesOf(text)
  const lines = sourceLines(text)
  const replies = ranges.map((range, index) => translate(lines.slice(range.start, range.end).join('\n'), index))
  return assembleTranslation(ranges, lines, replies)
}

test('短文只切一段，覆盖全文', () => {
  const text = '# 标题\n\n第一段。\n\n## 小节\n\n第二段。\n'
  assert.deepEqual(rangesOf(text), [{ start: 0, end: countLines(text) }])
})

test('2500 行带标题的文档切成多段，每段不超上限且无缝铺满', () => {
  const text = documentOf('## ', 250)
  assert.equal(countLines(text), 2500)
  const ranges = rangesOf(text)
  assert.ok(ranges.length >= 2, '切成了多段')
  assertWithinCaps(text, ranges)
  assertTiles(text, ranges)
  assertBlockStarts(text, ranges)

  const headings = new Set(parseDocument(text).blocks
    .filter(block => block.type === 'heading' && block.level <= 3)
    .map(block => block.sourceStartLine - 1))
  for (const range of ranges.slice(1)) assert.ok(headings.has(range.start), `第 ${range.start} 行是可用标题`)
})

test('只有四级标题时退到块起点切开', () => {
  const text = documentOf('#### ', 250)
  const ranges = rangesOf(text)
  assert.ok(ranges.length >= 2, '切成了多段')
  assertWithinCaps(text, ranges)
  assertTiles(text, ranges)
  assertBlockStarts(text, ranges)
})

test('没有标题的文档在段落起点切开，而不是拒绝', () => {
  const lines: string[] = []
  for (let index = 0; index < 1250; index += 1) lines.push(`第 ${index} 段正文。`, '')
  const text = `${lines.join('\n')}\n`
  assert.equal(countLines(text), 2500)
  const ranges = rangesOf(text)
  assert.ok(ranges.length >= 2, '切成了多段')
  assertWithinCaps(text, ranges)
  assertTiles(text, ranges)
  assertBlockStarts(text, ranges)
})

test('行数未超但字符数超限时也分块', () => {
  const lines: string[] = []
  for (let index = 0; index < 600; index += 1) lines.push(`第 ${index} 段。${'长'.repeat(200)}`, '')
  const text = `${lines.join('\n')}\n`
  assert.ok(countLines(text) <= LINE_CAP, '行数在上限内')
  assert.ok(normalize(text).length > CHAR_CAP, '字符数超出上限')
  const ranges = rangesOf(text)
  assert.ok(ranges.length >= 2, '按字符预算切成了多段')
  assertWithinCaps(text, ranges)
  assertTiles(text, ranges)
})

test('超过硬上限的文档直接拒绝，并带上真实行数', () => {
  const lines = Array.from({ length: HARD_LINE_CAP + 1 }, (_, index) => `第 ${index} 行`)
  const text = `${lines.join('\n')}\n`
  assert.equal(countLines(text), HARD_LINE_CAP + 1)
  assert.deepEqual(planFor(text), { kind: 'too-large', lineCount: HARD_LINE_CAP + 1 })
})

test('单一超大块不切开，也不因此拒绝', () => {
  const fence = ['```ts', ...Array.from({ length: 2500 }, (_, index) => `const value${index} = ${index}`), '```'].join('\n')
  const text = `${fence}\n`
  const ranges = rangesOf(text)
  assert.deepEqual(ranges, [{ start: 0, end: countLines(text) }])
  assert.ok(ranges[0].end - ranges[0].start > LINE_CAP, '块内没有可切点，接受超预算的一段')
})

test('分块译文拼回后与原文逐行一致', () => {
  const text = documentOf('## ', 250)
  const assembled = assembleFor(text, chunk => chunk)
  assert.equal(countLines(assembled), countLines(text))
  assert.equal(assembled, text)
})

test('模型省略块尾换行时总行数仍然一致', () => {
  const text = documentOf('## ', 250)
  const assembled = assembleFor(text, chunk => normalize(chunk))
  assert.equal(countLines(assembled), countLines(text))
})

test('某块少一行时总行数检查仍会报不一致', () => {
  const text = documentOf('## ', 250)
  const assembled = assembleFor(text, (chunk, index) => {
    if (index > 0) return chunk
    const lines = chunk.split('\n')
    return [...lines.slice(0, 3), ...lines.slice(4)].join('\n')
  })
  assert.notEqual(countLines(assembled), countLines(text))
})
