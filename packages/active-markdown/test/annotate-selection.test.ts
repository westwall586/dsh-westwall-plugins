import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import {
  atomIndexAt,
  captureAnchor,
  collectComponentRanges,
  collectLineAtoms,
  joinLineAtoms,
  locateAnchor,
  type TextLineAtom,
} from '../client/src/annotate/selection.ts'
import type { Annotation } from '../client/src/annotate/model.ts'

const SOURCE = [
  '# 标题',
  '',
  '第一段第一行',
  '第二段第一行',
  '',
  '> 引用一行',
  '> 引用二行',
  '',
  '- 项目一',
  '  - 嵌套项',
  '',
  '```ts',
  'const a = 1',
  'const b = 2',
  '```',
  '',
  '结尾段',
].join('\n')

const PARSED = parseDocument(SOURCE)
const ATOMS = collectLineAtoms(PARSED.blocks)
const COMPONENTS = collectComponentRanges(PARSED.blocks)

function atomOfLine(line: number): number {
  const index = ATOMS.findIndex(atom => atom.line === line)
  assert.notEqual(index, -1, `line ${line} has an atom`)
  return index
}

function annotation(overrides: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    seq: 1,
    kind: 'text',
    body: '意见',
    quote: '原文',
    prefix: '',
    suffix: '',
    startOffset: 0,
    blockStartId: 'p1',
    blockEndId: 'p1',
    blockSignature: '',
    section: '',
    lineStart: 1,
    lineEnd: 1,
    createdAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  }
}

function atom(line: number, text: string, blockId = 'p1', section = ''): TextLineAtom {
  return { line, blockId, text, section }
}

test('行原子覆盖嵌套列表、引用与多行段落，组件不产出原子', () => {
  assert.deepEqual(
    ATOMS.map(atom => [atom.line, atom.text]),
    [
      [1, '标题'],
      [3, '第一段第一行'],
      [4, '第二段第一行'],
      [6, '引用一行'],
      [7, '引用二行'],
      [9, '项目一'],
      [10, '嵌套项'],
      [17, '结尾段'],
    ],
  )
  assert.deepEqual(ATOMS.map(atom => atom.section), ['标题', '标题', '标题', '标题', '标题', '标题', '标题', '标题'])
  assert.deepEqual(joinLineAtoms(ATOMS).text, '标题\n第一段第一行\n第二段第一行\n引用一行\n引用二行\n项目一\n嵌套项\n结尾段')
  assert.equal(atomIndexAt(ATOMS, 13, 'code-tm1x7x-1'), undefined)
})

test('跨段落选区按行拼接，行号取起止行', () => {
  const start = atomOfLine(3)
  const end = atomOfLine(4)
  const anchor = captureAnchor(ATOMS, { atom: start, offset: 0 }, { atom: end, offset: '第二段第一行'.length }, COMPONENTS)
  assert.ok(anchor)
  assert.equal(anchor.quote, '第一段第一行\n第二段第一行')
  assert.equal(anchor.lineStart, 3)
  assert.equal(anchor.lineEnd, 4)
  assert.equal(anchor.blockStartId, ATOMS[start]!.blockId)
  assert.equal(anchor.blockEndId, ATOMS[end]!.blockId)
  assert.equal(anchor.section, '标题')
  assert.equal(anchor.blockSignature, '')
  assert.equal(anchor.startOffset, joinLineAtoms(ATOMS).starts[start]!)
})

test('引号与列表行也能捕获，跨引用段落保持行序', () => {
  const start = atomOfLine(6)
  const end = atomOfLine(7)
  const anchor = captureAnchor(ATOMS, { atom: start, offset: 0 }, { atom: end, offset: 4 }, COMPONENTS)
  assert.equal(anchor?.quote, '引用一行\n引用二行')
  assert.equal(anchor?.lineStart, 6)
  assert.equal(anchor?.lineEnd, 7)
})

test('首尾空白被裁掉，并记录前 32 / 后 32 个 UTF-16 单元', () => {
  const text = '0123456789'.repeat(12)
  const atoms = [atom(1, text)]
  const joined = joinLineAtoms(atoms)
  const anchor = captureAnchor(atoms, { atom: 0, offset: 40 }, { atom: 0, offset: 60 })
  assert.ok(anchor)
  assert.equal(anchor.quote, text.slice(40, 60))
  assert.equal(anchor.prefix, text.slice(40 - 32, 40))
  assert.equal(anchor.suffix, text.slice(60, 60 + 32))
  assert.equal(anchor.prefix.length, 32)
  assert.equal(anchor.suffix.length, 32)
  assert.equal(anchor.startOffset, 40)

  const padded = captureAnchor([atom(1, '  中间  ')], { atom: 0, offset: 0 }, { atom: 0, offset: 7 })
  assert.equal(padded?.quote, '中间')
  assert.equal(padded?.startOffset, 2)
  assert.equal(joined.text.length, 120)
})

test('选区跨到代码块时拒绝，不降级为块级定位', () => {
  const start = atomOfLine(10)
  const end = atomOfLine(17)
  assert.equal(captureAnchor(ATOMS, { atom: start, offset: 0 }, { atom: end, offset: 3 }, COMPONENTS), null)
  assert.deepEqual(COMPONENTS, [{ blockId: 'code-tm1x7x-1', lineStart: 12, lineEnd: 15 }])

  const textOnly = captureAnchor(ATOMS, { atom: start, offset: 0 }, { atom: end, offset: 3 })
  assert.equal(textOnly?.quote, '嵌套项\n结尾段')
})

test('空选区与反向边界都返回 null', () => {
  const start = atomOfLine(3)
  assert.equal(captureAnchor(ATOMS, { atom: start, offset: 2 }, { atom: start, offset: 2 }), null)
  assert.equal(captureAnchor(ATOMS, { atom: start, offset: 4 }, { atom: start, offset: 1 }), null)
})

const RESTORE_ATOMS = [
  atom(1, 'The quick brown fox', 'p1'),
  atom(2, 'jumps over the lazy dog', 'p1'),
]
const RESTORE_LINES = joinLineAtoms(RESTORE_ATOMS)

test('恢复先认精确偏移与前后文', () => {
  const located = locateAnchor(annotation({
    quote: 'quick brown',
    prefix: 'The ',
    suffix: ' fox',
    startOffset: 4,
  }), RESTORE_LINES)
  assert.deepEqual(located, { status: 'located', startOffset: 4, endOffset: 15 })
})

test('偏移失效时按前后文唯一搜索，找到新位置', () => {
  const located = locateAnchor(annotation({
    quote: 'lazy dog',
    prefix: 'the ',
    suffix: '',
    startOffset: 0,
  }), RESTORE_LINES)
  assert.deepEqual(located, { status: 'located', startOffset: RESTORE_LINES.text.indexOf('lazy dog'), endOffset: RESTORE_LINES.text.indexOf('lazy dog') + 'lazy dog'.length })
})

test('零命中或多命中都标记无法定位', () => {
  assert.deepEqual(locateAnchor(annotation({ quote: 'missing text', startOffset: 0 }), RESTORE_LINES), { status: 'unlocatable' })

  const ambiguous = joinLineAtoms([atom(1, 'same same', 'p1')])
  assert.deepEqual(locateAnchor(annotation({ quote: 'same', startOffset: 99 }), ambiguous), { status: 'unlocatable' })
})

test('前缀或后缀对不上时，若整段唯一仍可恢复，否则不定位', () => {
  const unique = locateAnchor(annotation({
    quote: 'brown fox',
    prefix: 'quick ',
    suffix: '',
    startOffset: 99,
  }), RESTORE_LINES)
  assert.equal(unique.status, 'located')

  const wrongStart = locateAnchor(annotation({
    quote: 'quick',
    prefix: 'The ',
    suffix: ' brown',
    startOffset: 5,
  }), RESTORE_LINES)
  assert.equal(wrongStart.status, 'located')
})
