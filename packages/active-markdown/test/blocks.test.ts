import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import { splitFrontmatter } from '../client/src/markdown/parse.ts'

const DOC = `---
title: Demo
tags: [a, b]
---

# 安装

第一段 **加粗** 与 \`代码\`。

- [ ] 待办
- [x] 已完成

| 左 | 中 | 右 |
| --- | :---: | ---: |
| a | b | c |

\`\`\`ts
const x = 1
\`\`\`

> 引用
`

test('front matter 被切出正文，正文行号仍是整份文件的行号', () => {
  const parsed = parseDocument(DOC)
  assert.equal(parsed.frontmatter?.source, 'title: Demo\ntags: [a, b]')
  const heading = parsed.blocks[0]
  assert.equal(heading.type, 'heading')
  assert.equal(heading.sourceStartLine, 6)
  assert.equal(heading.text, '安装')
  assert.equal(heading.anchor, '安装')
  assert.deepEqual(heading.headingPath, ['安装'])
})

test('块 id 在文档内唯一', () => {
  const { blocks } = parseDocument(DOC)
  const ids: string[] = []
  const walk = (list: readonly { id: string }[]): void => {
    for (const block of list) {
      ids.push(block.id)
      if ('items' in block) walk(block.items.flatMap(item => item.blocks))
      if ('blocks' in block && block.type === 'quote') walk(block.blocks)
    }
  }
  walk(blocks)
  assert.equal(new Set(ids).size, ids.length)
})

test('任务列表标记变成 checkbox 状态并从文本里移除', () => {
  const list = parseDocument(DOC).blocks.find(block => block.type === 'list')
  assert.ok(list !== undefined && list.type === 'list')
  assert.deepEqual(list.items.map(item => item.task), ['todo', 'done'])
  assert.deepEqual(list.items.map(item => item.text), ['待办', '已完成'])
  const first = list.items[0].blocks[0]
  assert.ok(first.type === 'paragraph')
  assert.equal(first.tight, true)
})

test('表格保留对齐与表头', () => {
  const table = parseDocument(DOC).blocks.find(block => block.type === 'table')
  assert.ok(table !== undefined && table.type === 'table')
  assert.deepEqual(table.header.map(cell => cell.align), [undefined, 'center', 'right'])
  assert.deepEqual(table.rows.map(row => row.map(cell => cell.align)), [[undefined, 'center', 'right']])
  assert.equal(table.text, '左 | 中 | 右 | a | b | c')
})

test('代码块保留语言与内容', () => {
  const code = parseDocument(DOC).blocks.find(block => block.type === 'code')
  assert.ok(code !== undefined && code.type === 'code')
  assert.equal(code.lang, 'ts')
  assert.equal(code.content, 'const x = 1')
})

test('引用里的块保持嵌套', () => {
  const quote = parseDocument(DOC).blocks.find(block => block.type === 'quote')
  assert.ok(quote !== undefined && quote.type === 'quote')
  assert.equal(quote.blocks[0].type, 'paragraph')
})

test('未闭合的 front matter 仍是正文', () => {
  const split = splitFrontmatter('---\ntitle: x\n\n# 标题')
  assert.equal(split.frontmatter, undefined)
  assert.equal(split.body, '---\ntitle: x\n\n# 标题')
  assert.equal(split.lineOffset, 0)
})

test('同名标题有不同锚点', () => {
  const { blocks } = parseDocument('# 同名\n\n# 同名\n')
  const anchors = blocks.filter(block => block.type === 'heading').map(block => block.anchor)
  assert.deepEqual(anchors, ['同名', '同名-2'])
})
