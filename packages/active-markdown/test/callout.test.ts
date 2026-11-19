import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import { CALLOUT_TYPES, calloutHeadTitle, calloutLabel, resolveCallout } from '../client/src/markdown/callout.ts'
import { componentLabel, componentOf, type Block } from '../client/src/markdown/model.ts'

/** Parse a source whose whole body must be one block. */
function only(source: string): Block {
  const { blocks } = parseDocument(source)
  assert.equal(blocks.length, 1, `expected one top-level block, got ${blocks.length}`)
  return blocks[0]!
}

test('13 个规范类型各自解析成 callout，family 来自类型表', () => {
  for (const type of CALLOUT_TYPES) {
    const block = only(`> [!${type.id}] 标题\n> 正文`)
    assert.ok(block.type === 'callout', `${type.id} 应解析成 callout`)
    assert.equal(block.kind, type.id)
    assert.equal(block.family, type.family)
    assert.equal(block.title, '标题')
    assert.equal(block.text, '标题\n正文')
    assert.deepEqual(block.blocks.map(child => child.text), ['正文'])
  }
})

test('类型标记大小写不敏感', () => {
  const block = only('> [!WARNING] 注意\n> 正文')
  assert.ok(block.type === 'callout')
  assert.equal(block.kind, 'warning')
  assert.equal(block.family, 'warning')
})

test('别名解析到规范类型', () => {
  const alias = only('> [!summary] 摘要\n> 正文')
  assert.ok(alias.type === 'callout')
  assert.equal(alias.kind, 'abstract')
  assert.equal(alias.family, 'abstract')
})

test('resolveCallout 先比规范 id 再比别名，未知返回 undefined', () => {
  assert.equal(resolveCallout('note')?.id, 'note')
  assert.equal(resolveCallout('NOTE')?.id, 'note')
  assert.equal(resolveCallout('tldr')?.id, 'abstract')
  assert.equal(resolveCallout('cite')?.id, 'quote')
  assert.equal(resolveCallout('foo'), undefined)
})

test('未知类型保持普通引用', () => {
  const block = only('> [!foo] 标题\n> 正文')
  assert.equal(block.type, 'quote')
})

test('Obsidian 的折叠语法保持普通引用', () => {
  assert.equal(only('> [!note]- 标题\n> 正文').type, 'quote')
  assert.equal(only('> [!note]+ 标题\n> 正文').type, 'quote')
})

test('列表项里的标记保持普通引用', () => {
  const list = only('- 项目\n  > [!note] 标题\n  > 正文')
  assert.ok(list.type === 'list')
  assert.equal(list.items[0]!.blocks[1]!.type, 'quote')
})

test('嵌套引用里的标记保持普通引用', () => {
  const outer = only('> > [!note] 标题\n> > 正文')
  assert.ok(outer.type === 'quote')
  assert.equal(outer.blocks[0]!.type, 'quote')
})

test('省略标题时标题为空串', () => {
  const block = only('> [!tip]\n> 正文')
  assert.ok(block.type === 'callout')
  assert.equal(block.title, '')
  assert.deepEqual(block.blocks.map(child => child.text), ['正文'])
})

test('标题以短横线开头时整段留在标题里', () => {
  const block = only('> [!note] - 标题\n> 正文')
  assert.ok(block.type === 'callout')
  assert.equal(block.title, '- 标题')
})

test('标记行与正文同段时只去掉标记行，正文从下一行开始', () => {
  const block = only('> [!note] 标题\n> 第一行\n> 第二行')
  assert.ok(block.type === 'callout')
  assert.deepEqual(block.blocks.map(child => [child.type, child.text, child.sourceStartLine]), [
    ['paragraph', '第一行 第二行', 2],
  ])
})

test('标记行独占一段时后续段落保留原行号', () => {
  const block = only('> [!note] 标题\n>\n> 第二段')
  assert.ok(block.type === 'callout')
  assert.deepEqual(block.blocks.map(child => [child.sourceStartLine, child.text]), [[3, '第二段']])
})

test('只有标记行时正文为空', () => {
  const block = only('> [!tip]')
  assert.ok(block.type === 'callout')
  assert.deepEqual(block.blocks, [])
})

test('callout 是组件，能力只留批注，签名按类型和正文', () => {
  const block = only('> [!example] 示例\n> 正文')
  const view = componentOf(block)
  assert.ok(view !== null)
  assert.equal(view.kind, 'callout')
  assert.equal(view.capabilities.annotate, true)
  assert.equal(view.capabilities.fullscreen, false)
  assert.equal(view.capabilities.copy, false)
  assert.match(view.signature, /^callout:example:/)
  assert.equal(view.lineStart, 1)
  assert.equal(view.lineEnd, 2)
})

test('批注引用走 locale 键，类型名随语言变化', () => {
  const view = componentOf(only('> [!example] 示例\n> 正文'))!
  const format = (key: string, params?: Record<string, string | number>): string => {
    if (key === 'callout.example') return 'Example'
    return key === 'component.callout' ? `Callout · ${params?.type}` : key
  }
  assert.equal(componentLabel(view, format), 'Callout · Example')
})

test('类型 label 走词条，缺词条时回到规范 label', () => {
  const example = CALLOUT_TYPES.find(type => type.id === 'example')!
  assert.equal(calloutLabel(example, key => key), example.label)
  assert.equal(calloutLabel(example, key => key === 'callout.example' ? 'Example' : key), 'Example')
})

test('头部只留一行：有标题用标题，空标题用类型名兜底', () => {
  assert.equal(calloutHeadTitle('说明族', '说明'), '说明族')
  assert.equal(calloutHeadTitle('  说明族  ', '说明'), '说明族')
  assert.equal(calloutHeadTitle('', '说明'), '说明')
  assert.equal(calloutHeadTitle('   ', '说明'), '说明')
})
