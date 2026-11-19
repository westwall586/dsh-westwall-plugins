import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import { outlineToTree, type MarkmapNode } from '../client/src/rich/tree.ts'

function tree(source: string): MarkmapNode {
  return outlineToTree(parseDocument(source).blocks)
}

function texts(nodes: readonly MarkmapNode[]): string[] {
  return nodes.map(node => node.content)
}

test('标题按层级嵌套，同级标题成为兄弟', () => {
  const root = tree('# A\n\n## B\n\n### C\n\n## D\n')
  assert.equal(root.children.length, 1)
  const [a] = root.children
  assert.equal(a!.content, 'A')
  assert.deepEqual(texts(a!.children), ['B', 'D'])
  assert.deepEqual(texts(a!.children[0]!.children), ['C'])
})

test('嵌套列表成为列表项的子树', () => {
  const root = tree('## 计划\n\n- 一周\n  - 周一\n  - 周二\n- 二周\n')
  const [plan] = root.children
  assert.equal(plan!.content, '计划')
  assert.deepEqual(texts(plan!.children), ['一周', '二周'])
  assert.deepEqual(texts(plan!.children[0]!.children), ['周一', '周二'])
  assert.deepEqual(plan!.children[1]!.children, [])
})

test('普通段落并入最近的节点，用换行分隔标题与描述', () => {
  const root = tree('# A\n\n第一段\n\n第二段\n\n## B\n\n- 条目\n\n  详情\n')
  const [a] = root.children
  assert.equal(a!.content, 'A\n第一段\n第二段')
  assert.deepEqual(texts(a!.children), ['B'])
  assert.equal(a!.children[0]!.children[0]!.content, '条目\n详情')
})

test('多个 H1 一起挂在根节点下', () => {
  const root = tree('# 一\n\n正文一\n\n# 二\n\n正文二\n')
  assert.deepEqual(texts(root.children), ['一\n正文一', '二\n正文二'])
})

test('空文档只剩没有内容的根节点', () => {
  const root = tree('')
  assert.equal(root.content, '')
  assert.deepEqual(root.children, [])
})
