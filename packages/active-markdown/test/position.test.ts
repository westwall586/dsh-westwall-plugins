import test from 'node:test'
import assert from 'node:assert/strict'

import { centerDelta, placePanelBelow, placePopover, revealDelta } from '../client/src/annotate/position.ts'

const SIZE = { width: 320, height: 180 }
const VIEWPORT = { width: 800, height: 600 }

test('下方放得下时贴在锚点下方，左右夹进视口', () => {
  const placement = placePopover(
    { top: 100, left: 700, width: 50, height: 20 },
    SIZE,
    VIEWPORT,
  )

  assert.equal(placement.above, false)
  assert.equal(placement.top, 126)
  assert.equal(placement.left, 472)
})

test('下方放不下且上方更大时翻到锚点上方', () => {
  const placement = placePopover(
    { top: 450, left: 100, width: 50, height: 20 },
    SIZE,
    VIEWPORT,
  )

  assert.equal(placement.above, true)
  assert.equal(placement.top, 264)
  assert.equal(placement.left, 100)
})

test('上下都不够时仍夹在视口的 margin 内', () => {
  const placement = placePopover(
    { top: 180, left: 100, width: 50, height: 20 },
    { width: 320, height: 200 },
    { width: 800, height: 400 },
  )

  assert.equal(placement.above, false)
  assert.equal(placement.top, 192)
  assert.ok(placement.top >= 8)
  assert.ok(placement.top + 200 <= 400 - 8)
})

test('锚点在视口右侧时 left 夹到右边界', () => {
  const placement = placePopover(
    { top: 100, left: 760, width: 30, height: 20 },
    SIZE,
    VIEWPORT,
  )

  assert.equal(placement.above, false)
  assert.equal(placement.left, 472)
})

test('视口比浮层还小时 left 与 top 都落在 margin 且为有限数字', () => {
  const placement = placePopover(
    { top: 50, left: 50, width: 20, height: 20 },
    { width: 400, height: 300 },
    { width: 300, height: 200 },
  )

  assert.equal(placement.left, 8)
  assert.equal(placement.top, 8)
  assert.equal(Number.isFinite(placement.left), true)
  assert.equal(Number.isFinite(placement.top), true)
})

test('非有限输入仍返回有限数字', () => {
  const placement = placePopover(
    { top: Number.NaN, left: Number.POSITIVE_INFINITY, width: 20, height: 20 },
    SIZE,
    { width: Number.POSITIVE_INFINITY, height: Number.NaN },
  )

  assert.equal(placement.left, 8)
  assert.equal(placement.top, 8)
  assert.equal(Number.isFinite(placement.left), true)
  assert.equal(Number.isFinite(placement.top), true)
})

test('下方空间正好等于浮层高度加 gap 时不翻转', () => {
  const placement = placePopover(
    { top: 394, left: 100, width: 50, height: 20 },
    SIZE,
    VIEWPORT,
    { margin: 0 },
  )

  assert.equal(placement.above, false)
  assert.equal(placement.top, 420)
})

test('窄预览区里目录宽度与左边界夹进面板', () => {
  const placement = placePanelBelow(
    { top: 100, left: 700, width: 50, height: 20 },
    { top: 0, left: 0, width: 300, height: 400 },
  )

  assert.equal(placement.width, 284)
  assert.equal(placement.left, 8)
  assert.equal(placement.top, 126)
  assert.equal(placement.maxHeight, 266)
})

test('目录最大高度按面板底部剩余空间收缩', () => {
  const placement = placePanelBelow(
    { top: 350, left: 20, width: 50, height: 20 },
    { top: 0, left: 0, width: 300, height: 400 },
  )

  assert.equal(placement.top, 376)
  assert.equal(placement.maxHeight, 16)
})

test('面板比目录还窄时宽度有限且非负', () => {
  const placement = placePanelBelow(
    { top: 10, left: 10, width: 50, height: 20 },
    { top: 0, left: 0, width: 10, height: 40 },
  )

  assert.equal(placement.width, 0)
  assert.equal(Number.isFinite(placement.width), true)
  assert.equal(Number.isFinite(placement.left), true)
})

test('目录顶边不越出面板底部', () => {
  const bounds = { top: 100, left: 0, width: 300, height: 200 }
  const placement = placePanelBelow(
    { top: 900, left: 20, width: 50, height: 20 },
    bounds,
  )

  assert.equal(placement.top, bounds.top + bounds.height - 8)
  assert.ok(placement.top <= bounds.top + bounds.height)
  assert.equal(placement.maxHeight, 0)
})

test('当前行已可见时不滚动', () => {
  assert.equal(revealDelta(
    { top: 100, left: 0, width: 300, height: 200 },
    { top: 150, left: 0, width: 100, height: 20 },
  ), 0)
})

test('当前行在面板下方时返回正的最小滚动量', () => {
  assert.equal(revealDelta(
    { top: 100, left: 0, width: 300, height: 200 },
    { top: 320, left: 0, width: 100, height: 20 },
  ), 40)
})

test('当前行在面板上方时返回负的最小滚动量', () => {
  assert.equal(revealDelta(
    { top: 100, left: 0, width: 300, height: 200 },
    { top: 50, left: 0, width: 100, height: 20 },
  ), -50)
})

test('打开的当前行居中', () => {
  assert.equal(centerDelta(
    { top: 100, left: 0, width: 300, height: 200 },
    { top: 350, left: 0, width: 100, height: 20 },
  ), 160)
})

test('当前行已可见时打开仍居中', () => {
  assert.equal(centerDelta(
    { top: 100, left: 0, width: 300, height: 200 },
    { top: 150, left: 0, width: 100, height: 20 },
  ), -40)
})
