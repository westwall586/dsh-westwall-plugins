import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import type { Block } from '../client/src/markdown/model.ts'
import {
  diffBlocks,
  tocEntries,
  updatedSections,
  type DocumentDiff,
} from '../client/src/markdown/diff.ts'

function blocksOf(source: string): readonly Block[] {
  return parseDocument(source).blocks
}

function diffOf(before: string, after: string): DocumentDiff {
  return diffBlocks(blocksOf(before), blocksOf(after))
}

function updatedIndexes(result: DocumentDiff): number[] {
  return result.statuses.flatMap((status, index) => status === 'updated' ? [index] : [])
}

test('完全相同的文档没有更新', () => {
  const source = '# 标题\n\n第一段。\n\n- 一\n- 二\n'
  const result = diffOf(source, source)
  assert.deepEqual(result.counts, { updated: 0 })
  assert.deepEqual(result.statuses, [undefined, undefined, undefined])
  assert.deepEqual(updatedIndexes(result), [])
})

test('改一段、加一段各算 1 处，下标对应新文档', () => {
  const before = '第一段。\n\n第二段。\n\n第三段。'
  const after = '第一段。\n\n第二段改过。\n\n第三段。\n\n新增段。'
  const result = diffOf(before, after)
  assert.deepEqual(updatedIndexes(result), [1, 3])
  assert.deepEqual(result.counts, { updated: 2 })
})

test('纯删除是 0 处更新，没有状态', () => {
  const result = diffOf('第一段。\n\n第二段。\n\n第三段。', '第一段。\n\n第三段。')
  assert.deepEqual(result.counts, { updated: 0 })
  assert.deepEqual(result.statuses, [undefined, undefined])
})

test('替换：段落换成表格只算新表 1 处，旧段不计数', () => {
  const before = '前言。\n\n旧段落。\n\n结尾。'
  const after = '前言。\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n结尾。'
  const result = diffOf(before, after)
  assert.deepEqual(updatedIndexes(result), [1])
  assert.deepEqual(result.counts, { updated: 1 })
})

test('同一块换位置不算更新，移动并改写算 1 处', () => {
  const before = '甲。\n\n乙。\n\n丙。'
  assert.deepEqual(diffOf(before, '乙。\n\n丙。\n\n甲。').counts, { updated: 0 })
  assert.deepEqual(updatedIndexes(diffOf(before, '乙。\n\n丙。\n\n甲改过。')), [2])
})

test('列表项内容变化让整个顶层列表更新', () => {
  const before = '- 一\n- 二\n\n结尾。'
  const after = '- 一\n- 二改过\n\n结尾。'
  const result = diffOf(before, after)
  assert.deepEqual(updatedIndexes(result), [0])
  assert.equal(result.counts.updated, 1)
})

test('引用子块变化让整个顶层引用更新', () => {
  const before = '> 引用一\n\n结尾。'
  const after = '> 引用二\n\n结尾。'
  assert.deepEqual(updatedIndexes(diffOf(before, after)), [0])
})

test('链接地址、图片 src、强调变化都算更新', () => {
  assert.deepEqual(updatedIndexes(diffOf(
    '看[这里](https://a.example)。',
    '看[这里](https://b.example)。',
  )), [0])
  assert.deepEqual(updatedIndexes(diffOf('![图](a.png)', '![图](b.png)')), [0])
  assert.deepEqual(updatedIndexes(diffOf('这是**重点**内容。', '这是重点内容。')), [0])
  assert.deepEqual(updatedIndexes(diffOf('这是*重点*内容。', '这是**重点**内容。')), [0])
})

test('只折行、只换列表符号、只换围栏风格都不算更新', () => {
  assert.deepEqual(diffOf('第一行\n第二行。', '第一行 第二行。').counts, { updated: 0 })
  assert.deepEqual(diffOf('- 一\n- 二', '* 一\n* 二').counts, { updated: 0 })
  assert.deepEqual(diffOf('```ts\nconst a = 1\n```', '~~~ts\nconst a = 1\n~~~').counts, { updated: 0 })
})

test('代码缩进、表格单元格与对齐变化算更新', () => {
  assert.deepEqual(updatedIndexes(diffOf(
    '```ts\nconst a = 1\n```',
    '```ts\n  const a = 1\n```',
  )), [0])
  assert.deepEqual(updatedIndexes(diffOf(
    '| a |\n| - |\n| 1 |',
    '| a |\n| - |\n| 2 |',
  )), [0])
  assert.deepEqual(updatedIndexes(diffOf(
    '| a |\n| --- |\n| 1 |',
    '| a |\n| :--- |\n| 1 |',
  )), [0])
})

test('全文重写走退化路径：中间段全部更新，计数稳定', () => {
  const before = Array.from({ length: 610 }, (_, index) => `旧段落 ${index}。`).join('\n\n')
  const after = Array.from({ length: 610 }, (_, index) => `新段落 ${index}。`).join('\n\n')
  const result = diffOf(before, after)
  assert.equal(result.counts.updated, 610)
  assert.ok(result.statuses.every(status => status === 'updated'))
})

test('空旧文档、空新文档与两份空文档', () => {
  const added = diffBlocks([], blocksOf('新段落。'))
  assert.deepEqual(updatedIndexes(added), [0])
  assert.deepEqual(added.counts, { updated: 1 })

  const removed = diffBlocks(blocksOf('旧段落。'), [])
  assert.deepEqual(removed.counts, { updated: 0 })
  assert.deepEqual(removed.statuses, [])

  assert.deepEqual(diffBlocks([], []).counts, { updated: 0 })
})

test('H2 下的段落更新只标 H2，不标父级 H1', () => {
  const after = '# 一\n\n## 二\n\n新段落。'
  const result = diffOf('# 一\n\n## 二\n\n旧段落。', after)
  assert.deepEqual(updatedSections(blocksOf(after), result.statuses), ['二'])
})

test('H2 标题本身更新时标它自己', () => {
  const before = '# 一\n\n## 旧二\n\n段落。'
  const after = '# 一\n\n## 新二\n\n段落。'
  const result = diffOf(before, after)
  assert.deepEqual(updatedSections(blocksOf(after), result.statuses), ['新二'])
})

test('H5 标题更新时标 H5 自己', () => {
  const before = '##### 小节\n\n旧内容。'
  const after = '##### 小节\n\n新内容。'
  const result = diffOf(before, after)
  assert.deepEqual(updatedSections(blocksOf(after), result.statuses), ['小节'])
})

test('第一个标题之前的块更新不产生章节更新点', () => {
  const before = '旧前言。\n\n# 标题'
  const after = '新前言。\n\n# 标题'
  const result = diffOf(before, after)
  assert.deepEqual(updatedSections(blocksOf(after), result.statuses), [])
})

test('只有删除的章节没有章节更新点', () => {
  const before = '# 一\n\n要删的段落。\n\n# 二\n\n保留。'
  const after = '# 一\n\n# 二\n\n保留。'
  const result = diffOf(before, after)
  assert.deepEqual(result.counts, { updated: 0 })
  assert.deepEqual(updatedSections(blocksOf(after), result.statuses), [])
})

test('tocEntries 按文档顺序列出 H1-H6 与层级', () => {
  const source = '# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F\n\n正文。'
  assert.deepEqual(tocEntries(blocksOf(source)), [
    { anchor: 'a', text: 'A', level: 1 },
    { anchor: 'b', text: 'B', level: 2 },
    { anchor: 'c', text: 'C', level: 3 },
    { anchor: 'd', text: 'D', level: 4 },
    { anchor: 'e', text: 'E', level: 5 },
    { anchor: 'f', text: 'F', level: 6 },
  ])
  assert.deepEqual(tocEntries(blocksOf('没有标题。')), [])
})
