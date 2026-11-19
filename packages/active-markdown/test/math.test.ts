import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import { displayMathAt, inlineMathAt } from '../client/src/markdown/math.ts'
import {
  COMPONENT_REGISTRY, componentLabel, componentOf, frameButtons, inlineText, type Inline,
} from '../client/src/markdown/model.ts'
import { en, zh } from '../client/src/locales.ts'

/** The first paragraph's inline tree, which every prose case below starts with. */
function paragraphInline(source: string): Inline[] {
  const block = parseDocument(source).blocks[0]
  assert.ok(block !== undefined && block.type === 'paragraph', '第一个块是段落')
  return block.inline
}

function mathNodes(inline: readonly Inline[]): Inline[] {
  return inline.filter(node => node.kind === 'math')
}

test('行内 $…$ 切出来，一行可以有多个', () => {
  const inline = paragraphInline('质能方程 $E = mc^2$，欧拉恒等式 $e^{i\\pi} + 1 = 0$。')
  assert.deepEqual(mathNodes(inline), [
    { kind: 'math', tex: 'E = mc^2' },
    { kind: 'math', tex: 'e^{i\\pi} + 1 = 0' },
  ])
  assert.equal(inlineText(inline), '质能方程 E = mc^2，欧拉恒等式 e^{i\\pi} + 1 = 0。')
})

test('$ 后或闭合 $ 前是空白就不算公式', () => {
  for (const source of ['示例 $ x $ 不是公式。', '示例 $x $ 也不是。']) {
    const inline = paragraphInline(source)
    assert.deepEqual(mathNodes(inline), [], source)
    assert.equal(inlineText(inline), source, '原文保持')
  }
})

test('未闭合的 $ 保持普通文本', () => {
  const inline = paragraphInline('未闭合 $x 保持文本。')
  assert.deepEqual(mathNodes(inline), [])
  assert.equal(inlineText(inline), '未闭合 $x 保持文本。')
})

test('反斜杠转义的 \\$ 不算起始，后面的 $ 也不配对', () => {
  const inline = paragraphInline('价格 \\$5 与 \\$x$。')
  assert.deepEqual(mathNodes(inline), [])
  assert.equal(inlineText(inline), '价格 $5 与 $x$。')
})

test('行内代码里的 $ 不解析', () => {
  const inline = paragraphInline('`$x$` 不解析。')
  assert.deepEqual(mathNodes(inline), [])
  assert.deepEqual(inline[0], { kind: 'code', text: '$x$' })
})

test('同一行的 $$x$$ 是行间公式', () => {
  const block = parseDocument('$$x$$').blocks[0]
  assert.ok(block !== undefined && block.type === 'math')
  assert.equal(block.tex, 'x')
  assert.equal(block.display, true)
  assert.equal(block.sourceStartLine, 1)
  assert.equal(block.sourceEndLine, 1)
})

test('跨行的 $$…$$ 是一块行间公式，首尾空白不进 TeX', () => {
  const block = parseDocument('$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$').blocks[0]
  assert.ok(block !== undefined && block.type === 'math')
  assert.equal(block.tex, '\\int_0^1 x^2 \\, dx = \\frac{1}{3}')
  assert.equal(block.sourceStartLine, 1)
  assert.equal(block.sourceEndLine, 3)
})

test('同一行 $$x$$ 后面还有文字就不算行间公式', () => {
  const block = parseDocument('$$x$$ tail').blocks[0]
  assert.ok(block !== undefined && block.type === 'paragraph')
  assert.equal(block.text, '$$x$$ tail')
})

test('未闭合的 $$ 不吞掉后面的正文', () => {
  const blocks = parseDocument('$$\nx\n\n下一段').blocks
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'paragraph'])
})

test('```math 围栏直接成为行间公式，普通围栏仍是代码块', () => {
  const math = parseDocument('```math\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2}\n```').blocks[0]
  assert.ok(math !== undefined && math.type === 'math')
  assert.equal(math.tex, '\\sum_{n=1}^{\\infty} \\frac{1}{n^2}')
  assert.equal(math.sourceStartLine, 1)
  assert.equal(math.sourceEndLine, 3)

  const code = parseDocument('```text\n$x$\n```').blocks[0]
  assert.ok(code !== undefined && code.type === 'code')
  assert.equal(code.lang, 'text')
})

test('列表项里的行内与行间公式都成立', () => {
  const list = parseDocument('- 条目 $a+b$\n- $$\n  c\n  $$').blocks[0]
  assert.ok(list !== undefined && list.type === 'list')
  const first = list.items[0]?.blocks[0]
  assert.ok(first !== undefined && first.type === 'paragraph')
  assert.deepEqual(mathNodes(first.inline), [{ kind: 'math', tex: 'a+b' }])
  const second = list.items[1]?.blocks[0]
  assert.ok(second !== undefined && second.type === 'math')
  assert.equal(second.tex, 'c')
})

test('callout 里的行内与行间公式都成立', () => {
  const callout = parseDocument('> [!note] 公式\n> 行内 $a$\n>\n> $$z$$').blocks[0]
  assert.ok(callout !== undefined && callout.type === 'callout')
  assert.deepEqual(callout.blocks.map(block => block.type), ['paragraph', 'math'])
  const paragraph = callout.blocks[0]
  assert.ok(paragraph !== undefined && paragraph.type === 'paragraph')
  assert.deepEqual(mathNodes(paragraph.inline), [{ kind: 'math', tex: 'a' }])
})

test('紧跟在正文后的同一段落边界处也能开出行间公式', () => {
  const blocks = parseDocument('普通一行\n$$x$$').blocks
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'math'])
})

test('行间公式作为组件带复制与批注，没有全屏', () => {
  const block = parseDocument('$$\nx\n$$').blocks[0]
  assert.ok(block !== undefined && block.type === 'math')
  const view = componentOf(block)
  assert.ok(view !== null)
  assert.equal(view.kind, 'math')
  assert.deepEqual(view.label, { kind: 'math' })
  assert.equal(view.copyText, 'x')
  assert.match(view.signature, /^math:/)
  assert.deepEqual(view.capabilities, {
    fullscreen: false, clickToExpand: false, zoom: false, pan: false, wrap: false, panelWrap: false, copy: true, annotate: true,
  })
  assert.deepEqual(view.capabilities, COMPONENT_REGISTRY.math.capabilities)
  assert.deepEqual(frameButtons(view.capabilities), ['copy', 'annotate'])
  assert.equal(componentLabel(view, key => key), 'component.math')
})

test('公式的组件文案中英文都有', () => {
  assert.equal(zh['component.math'], '公式')
  assert.equal(en['component.math'], 'Formula')
})

test('行内切分：$$、空白、换行、未闭合与转义', () => {
  assert.deepEqual(inlineMathAt('$x$', 0, 3), { tex: 'x', end: 3 })
  assert.deepEqual(inlineMathAt('a $x$', 2, 5), { tex: 'x', end: 5 })
  assert.deepEqual(inlineMathAt('$a\\$b$', 0, 6), { tex: 'a\\$b', end: 6 })
  assert.equal(inlineMathAt('$$x$$', 0, 5), null)
  assert.equal(inlineMathAt('$ x$', 0, 4), null)
  assert.equal(inlineMathAt('$x $', 0, 4), null)
  assert.equal(inlineMathAt('$x', 0, 2), null)
  assert.equal(inlineMathAt('$x\ny$', 0, 5), null)
  assert.equal(inlineMathAt('x', 0, 1), null)
})

test('行间切分：同行、跨行、缩进、空行与尾随文字', () => {
  assert.deepEqual(displayMathAt(['$$x$$'], 0), { tex: 'x', lines: 1 })
  assert.deepEqual(displayMathAt(['  $$x$$'], 0), { tex: 'x', lines: 1 })
  assert.deepEqual(displayMathAt(['$$', 'a + b', '$$'], 0), { tex: 'a + b', lines: 3 })
  assert.deepEqual(displayMathAt(['$$ a ', 'b $$'], 0), { tex: 'a \nb', lines: 2 })
  assert.equal(displayMathAt(['$$x$$ tail'], 0), null)
  assert.equal(displayMathAt(['text $$x$$'], 0), null)
  assert.equal(displayMathAt(['$$', 'a', '', '$$'], 0), null)
  assert.equal(displayMathAt(['$$'], 0), null)
  assert.equal(displayMathAt(['$$$$'], 0), null)
})
