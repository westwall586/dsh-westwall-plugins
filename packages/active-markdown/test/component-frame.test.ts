import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { parseDocument } from '../client/src/markdown/blocks.ts'
import { COMPONENT_BLOCKS, COMPONENT_REGISTRY, componentLabel, componentOf, frameButtons } from '../client/src/markdown/model.ts'
import { annotateBlock, blockAnnotationOf, blockAnchor } from '../client/src/annotate/model.ts'
import { locateBlockAnchor } from '../client/src/annotate/selection.ts'

const SOURCE = [
  '# 标题',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const a = 1',
  '```',
  '',
  '段落',
].join('\n')

const PARSED = parseDocument(SOURCE)
const TABLE = PARSED.blocks.find(block => block.type === 'table')!
const CODE = PARSED.blocks.find(block => block.type === 'code')!
const PARAGRAPH = PARSED.blocks.find(block => block.type === 'paragraph')!

const OPTIONS = { id: 'a1', seq: 1, createdAt: '2026-11-17T00:00:00.000Z' }

test('文本块没有组件外壳，表格与代码块有类型、能力与签名', () => {
  assert.equal(componentOf(PARAGRAPH), null)
  assert.equal(componentOf(PARSED.blocks[0]!), null)

  const table = componentOf(TABLE)!
  assert.equal(table.kind, 'table')
  assert.deepEqual(table.label, { kind: 'table', columns: 2, rows: 1 })
  assert.deepEqual(table.capabilities, {
    fullscreen: true, clickToExpand: false, zoom: false, pan: false, wrap: false, panelWrap: true, copy: false, annotate: true,
  })
  assert.match(table.signature, /^table:2x1:/)
  assert.equal(table.lineStart, TABLE.sourceStartLine)
  assert.equal(table.lineEnd, TABLE.sourceEndLine)

  const code = componentOf(CODE)!
  assert.equal(code.kind, 'code')
  assert.deepEqual(code.label, { kind: 'code', lang: 'ts' })
  assert.deepEqual(code.capabilities, {
    fullscreen: true, clickToExpand: false, zoom: false, pan: false, wrap: true, panelWrap: false, copy: true, annotate: true,
  })
  assert.equal(code.copyText, 'const a = 1')
  assert.match(code.signature, /^code:ts:/)
})

test('能力表按组件给按钮，图才有点击放大与缩放平移', () => {
  const source = [
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '```markmap',
    '# 根',
    '```',
  ].join('\n')
  const components = parseDocument(source).blocks.map(componentOf)
  assert.deepEqual(components.map(component => component?.kind), ['mermaid', 'markmap'])
  for (const component of components) {
    assert.deepEqual(component!.capabilities, {
      fullscreen: true, clickToExpand: true, zoom: true, pan: true, wrap: false, panelWrap: false, copy: true, annotate: true,
    })
    assert.deepEqual(frameButtons(component!.capabilities), ['copy', 'annotate', 'fullscreen'])
  }
})

test('按钮顺序固定为换行、复制、批注、全屏，callout 只有批注', () => {
  assert.deepEqual(frameButtons(COMPONENT_REGISTRY.table.capabilities), ['annotate', 'fullscreen'])
  assert.deepEqual(frameButtons(COMPONENT_REGISTRY.code.capabilities), ['wrap', 'copy', 'annotate', 'fullscreen'])
  assert.deepEqual(frameButtons(COMPONENT_REGISTRY.mermaid.capabilities), ['copy', 'annotate', 'fullscreen'])
  assert.deepEqual(frameButtons(COMPONENT_REGISTRY.markmap.capabilities), ['copy', 'annotate', 'fullscreen'])
  assert.deepEqual(frameButtons(COMPONENT_REGISTRY.callout.capabilities), ['annotate'])
  for (const definition of Object.values(COMPONENT_REGISTRY)) {
    assert.equal(definition.capabilities.zoom, definition.capabilities.pan, `${definition.kind} 的缩放与拖动同开同关`)
  }
})

test('表格只在全屏面板里多一个换行开关，内联按钮不变', () => {
  const table = COMPONENT_REGISTRY.table.capabilities
  assert.equal(table.wrap, false)
  assert.equal(table.panelWrap, true)
  assert.deepEqual(frameButtons(table), ['annotate', 'fullscreen'])
  for (const definition of Object.values(COMPONENT_REGISTRY)) {
    if (definition.kind === 'table') continue
    assert.equal(definition.capabilities.panelWrap, false, `${definition.kind} 没有面板换行`)
  }
})

test('图标集齐全：每个按钮与底栏都有 14px 的内联 SVG，与顶栏同网格', () => {
  // node:test 不能 import .tsx，这里核对图标源文件本身。
  const icons = readFileSync(new URL('../client/src/rich/icons.tsx', import.meta.url), 'utf8')
  for (const name of ['ExpandIcon', 'CollapseIcon', 'CloseIcon', 'CopyIcon', 'CheckIcon', 'WrapIcon', 'AnnotateIcon', 'FitIcon', 'ActualIcon']) {
    assert.match(icons, new RegExp(`export function ${name}\\(`), `缺少 ${name}`)
  }
  assert.match(icons, /strokeWidth=\{1\.3\}/)
  assert.match(icons, /stroke="currentColor"/)
  assert.match(icons, /size = 14/)
  assert.match(icons, /viewBox="0 0 16 16"/)
})

test('标签走 locale 键，空语言显示 text', () => {
  const calls: Array<{ key: string, params?: Record<string, string | number> }> = []
  const format = (key: string, params?: Record<string, string | number>): string => {
    calls.push({ key, params })
    return key
  }
  assert.equal(componentLabel(componentOf(TABLE)!, format), 'component.table')
  assert.deepEqual(calls.at(-1), { key: 'component.table', params: { columns: 2, rows: 1 } })

  const plain = { ...componentOf(CODE)!, label: { kind: 'code' as const, lang: '' } }
  assert.equal(componentLabel(plain, format), 'component.code')
  assert.deepEqual(calls.at(-1), { key: 'component.code', params: { lang: 'text' } })
})

test('一个组件只保留一条批注，再次批注只改正文并保留编号', () => {
  const first = annotateBlock([], TABLE, '第一版', OPTIONS, '表格 · 2 列 × 1 行')
  assert.equal(first.length, 1)
  const annotation = first[0]!
  assert.equal(annotation.kind, 'block')
  assert.equal(annotation.seq, 1)
  assert.equal(annotation.quote, '表格 · 2 列 × 1 行')
  assert.equal(annotation.prefix, '')
  assert.equal(annotation.suffix, '')
  assert.equal(annotation.startOffset, 0)
  assert.equal(annotation.blockStartId, TABLE.id)
  assert.equal(annotation.blockEndId, TABLE.id)
  assert.equal(annotation.blockSignature, componentOf(TABLE)!.signature)
  assert.equal(annotation.lineStart, TABLE.sourceStartLine)
  assert.equal(annotation.lineEnd, TABLE.sourceEndLine)

  const second = annotateBlock(first, TABLE, '第二版', { ...OPTIONS, id: 'a2', seq: 2 }, '表格 · 2 列 × 1 行')
  assert.equal(second.length, 1)
  assert.equal(second[0]!.id, 'a1')
  assert.equal(second[0]!.seq, 1)
  assert.equal(second[0]!.body, '第二版')
  assert.equal(blockAnnotationOf(second, TABLE.id)?.body, '第二版')
  assert.equal(blockAnnotationOf(second, CODE.id), undefined)
})

test('组件锚点只记标签、块 id 与签名', () => {
  const anchor = blockAnchor(CODE, '代码块 · ts')
  assert.equal(anchor.quote, '代码块 · ts')
  assert.equal(anchor.blockSignature, componentOf(CODE)!.signature)
  assert.equal(anchor.blockStartId, CODE.id)
  assert.equal(anchor.lineStart, CODE.sourceStartLine)
  assert.equal(anchor.section, '标题')
})

test('恢复组件批注按块 id 与签名，块没了或内容变了都不静默挪位', () => {
  const annotation = annotateBlock([], CODE, '意见', OPTIONS, '代码块 · ts')[0]!
  const located = locateBlockAnchor(annotation, PARSED.blocks)
  assert.equal(located.status, 'located')
  if (located.status === 'located') assert.equal(located.block.id, CODE.id)

  const changed = parseDocument(SOURCE.replace('const a = 1', 'const a = 2'))
  // The block id hashes content, so changed content usually removes the id itself.
  assert.deepEqual(locateBlockAnchor(annotation, changed.blocks), { status: 'unlocatable', reason: 'missing' })
  assert.deepEqual(
    locateBlockAnchor({ ...annotation, blockSignature: 'stale-signature' }, PARSED.blocks),
    { status: 'unlocatable', reason: 'changed' },
  )
})

test('行号移动但内容与类型不变时仍能定位', () => {
  const annotation = annotateBlock([], TABLE, '意见', OPTIONS, '表格 · 2 列 × 1 行')[0]!
  const shifted = parseDocument(`前言\n\n${SOURCE}`)
  const located = locateBlockAnchor(annotation, shifted.blocks)
  assert.equal(located.status, 'located')
  if (located.status === 'located') assert.equal(located.block.id, TABLE.id)
})

test('每个组件声明一个宽度档位，注册表里没有遗漏', () => {
  for (const [kind, definition] of Object.entries(COMPONENT_REGISTRY)) {
    assert.equal(definition.kind, kind)
    assert.ok(
      ['prose', 'wide', 'graphic'].includes(definition.measure),
      `${kind} must declare a known measure, got ${JSON.stringify(definition.measure)}`,
    )
  }
})

test('宽度档位按下文的读法分配：散文限宽、表格与代码铺满、图单独限宽', () => {
  assert.equal(COMPONENT_REGISTRY.table.measure, 'wide')
  assert.equal(COMPONENT_REGISTRY.code.measure, 'wide')
  assert.equal(COMPONENT_REGISTRY.math.measure, 'wide')
  assert.equal(COMPONENT_REGISTRY.callout.measure, 'prose')
  assert.equal(COMPONENT_REGISTRY.mermaid.measure, 'graphic')
  assert.equal(COMPONENT_REGISTRY.markmap.measure, 'graphic')
})

test('组件视图把档位带出来，外壳才能只靠一条规则排版', () => {
  assert.equal(componentOf(TABLE)!.measure, 'wide')
  assert.equal(componentOf(CODE)!.measure, 'wide')
  const callout = parseDocument(['> [!NOTE] 提示', '> 正文'].join('\n')).blocks.find(block => block.type === 'callout')!
  assert.equal(componentOf(callout)!.measure, 'prose')
})

test('只有组件自己定宽，其余块都进同一个阅读列', () => {
  const componentTypes = ['code', 'table', 'mermaid', 'markmap', 'math']
  for (const type of componentTypes) assert.ok(COMPONENT_BLOCKS.has(type), `${type} 走组件路径`)
  const proseTypes = ['heading', 'paragraph', 'list', 'quote', 'divider', 'callout']
  for (const type of proseTypes) assert.equal(COMPONENT_BLOCKS.has(type), false, `${type} 进阅读列`)
})
