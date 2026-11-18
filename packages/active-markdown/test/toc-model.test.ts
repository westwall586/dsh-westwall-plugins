import test from 'node:test'
import assert from 'node:assert/strict'

import type { TocEntry } from '../client/src/markdown/diff.ts'
import { activeAnchorOf, tocRows } from '../client/src/markdown/toc-model.ts'

function entriesOf(levels: readonly number[]): TocEntry[] {
  return levels.map((level, index) => ({ anchor: `h${index}`, text: `标题 ${index}`, level }))
}

function anchorsOf(rows: readonly { anchor: string }[]): string[] {
  return rows.map(row => row.anchor)
}

function stackVisibility(entries: readonly TocEntry[], collapsed: ReadonlySet<string>): boolean[] {
  const stack: { level: number, collapsed: boolean }[] = []
  const visible: boolean[] = []
  for (const entry of entries) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= entry.level) stack.pop()
    visible.push(!stack.some(node => node.collapsed))
    stack.push({ level: entry.level, collapsed: collapsed.has(entry.anchor) })
  }
  return visible
}

function sequencesOf(length: number, maxLevel: number): number[][] {
  if (length === 0) return [[]]
  const shorter = sequencesOf(length - 1, maxLevel)
  const sequences: number[][] = []
  for (const prefix of shorter) {
    for (let level = 1; level <= maxLevel; level += 1) sequences.push([...prefix, level])
  }
  return sequences
}

test('有更深后继标题的条目才可折叠', () => {
  const rows = tocRows(entriesOf([1, 2, 2, 1]), new Set(), undefined)
  assert.deepEqual(rows.map(row => row.hasChildren), [true, false, false, false])
})

test('默认展开时全部可见且顺序不变', () => {
  const levels = [1, 2, 3, 2, 1]
  const rows = tocRows(entriesOf(levels), new Set(), undefined)
  assert.deepEqual(anchorsOf(rows), levels.map((_, index) => `h${index}`))
  assert.deepEqual(rows.map(row => row.level), levels)
  assert.equal(rows.some(row => row.isCurrent), false)
})

test('折叠隐藏所有后代直到同级或更高级标题', () => {
  const rows = tocRows(entriesOf([1, 2, 3, 2, 1]), new Set(['h0']), undefined)
  assert.deepEqual(anchorsOf(rows), ['h0', 'h4'])
})

test('内层折叠在父级展开时仍然生效', () => {
  const rows = tocRows(entriesOf([1, 2, 3, 2, 1]), new Set(['h1']), undefined)
  assert.deepEqual(anchorsOf(rows), ['h0', 'h1', 'h3', 'h4'])
})

test('跳过层级（H1 后接 H3）按层级隐藏后代', () => {
  const rows = tocRows(entriesOf([1, 3, 3, 1]), new Set(['h0']), undefined)
  assert.deepEqual(anchorsOf(rows), ['h0', 'h3'])
  assert.equal(rows[0]!.hasChildren, true)
})

test('折叠集合里的陈旧锚点不影响可见性', () => {
  const rows = tocRows(entriesOf([1, 2, 1]), new Set(['missing', 'gone']), undefined)
  assert.deepEqual(anchorsOf(rows), ['h0', 'h1', 'h2'])
})

test('单次层级扫描与栈式参考实现在全部层级序列上一致', () => {
  const sequences = [1, 2, 3, 4, 5].flatMap(length => sequencesOf(length, 4))
  let checked = 0
  for (const levels of sequences) {
    const entries = entriesOf(levels)
    for (let mask = 0; mask < 2 ** entries.length; mask += 1) {
      const collapsed = new Set(entries.filter((_, index) => (mask & (1 << index)) !== 0).map(entry => entry.anchor))
      const expected = stackVisibility(entries, collapsed)
      const visible = entries.filter((_, index) => expected[index]).map(entry => entry.anchor)
      assert.deepEqual(
        anchorsOf(tocRows(entries, collapsed, undefined)),
        visible,
        `层级序列 ${levels.join(',')} 折叠 ${[...collapsed].join(',')}`,
      )
      checked += 1
    }
  }
  assert.ok(checked > 1000)
})

test('隐藏的当前章节投影到最近的可见祖先', () => {
  const rows = tocRows(entriesOf([1, 2, 3]), new Set(['h1']), 'h2')
  assert.deepEqual(anchorsOf(rows), ['h0', 'h1'])
  assert.equal(rows[1]!.isCurrent, true)
  assert.equal(rows.filter(row => row.isCurrent).length, 1)
})

test('嵌套折叠时当前章节投影到外层标题', () => {
  const rows = tocRows(entriesOf([1, 2, 3]), new Set(['h0', 'h1']), 'h2')
  assert.deepEqual(anchorsOf(rows), ['h0'])
  assert.equal(rows[0]!.isCurrent, true)
})

test('当前章节自身可见时标它自己', () => {
  const rows = tocRows(entriesOf([1, 2, 2]), new Set(), 'h1')
  assert.deepEqual(rows.filter(row => row.isCurrent).map(row => row.anchor), ['h1'])
})

test('第一个标题之前没有当前章节', () => {
  const entries = entriesOf([1, 2])
  const tops = new Map([['h0', 100], ['h1', 200]])
  assert.equal(activeAnchorOf(entries, tops, 50), undefined)
})

test('当前章节取最后一个顶边越过阈值的标题', () => {
  const entries = entriesOf([1, 2, 3])
  const tops = new Map([['h0', 10], ['h1', 100], ['h2', 200]])
  assert.equal(activeAnchorOf(entries, tops, 150), 'h1')
  assert.equal(activeAnchorOf(entries, tops, 100), 'h1')
  assert.equal(activeAnchorOf(entries, tops, 200), 'h2')
  assert.equal(activeAnchorOf(entries, tops, 9), undefined)
})

test('缺少顶边数据的标题不参与当前章节判定', () => {
  const entries = entriesOf([1, 2, 3])
  const tops = new Map<string, number>([['h0', 10], ['h2', 200]])
  assert.equal(activeAnchorOf(entries, tops, 250), 'h2')
  tops.set('h1', Number.NaN)
  assert.equal(activeAnchorOf(entries, tops, 150), 'h0')
  tops.set('h1', Number.POSITIVE_INFINITY)
  assert.equal(activeAnchorOf(entries, tops, 250), 'h2')
})
