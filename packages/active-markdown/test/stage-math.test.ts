import test from 'node:test'
import assert from 'node:assert/strict'

import { actualFactor, actualTransform, clampScale, fitPercent, fitTransform, panBy, zoomAt } from '../client/src/rich/stage-math.ts'

test('缩放被夹在上下限之间', () => {
  assert.equal(clampScale(0.01), 0.1)
  assert.equal(clampScale(99), 8)
  assert.equal(clampScale(1.5), 1.5)
})

test('fit 把内容按较小的一边铺满并居中，留出边距', () => {
  const view = fitTransform({ width: 1000, height: 500 }, { width: 400, height: 400 })
  assert.ok(Math.abs(view.scale - 1.15) < 1e-9)
  assert.ok(Math.abs(view.x - (1000 - 400 * view.scale) / 2) < 1e-9)
  assert.ok(Math.abs(view.y - (500 - 400 * view.scale) / 2) < 1e-9)
})

test('空内容不缩放，留在原点', () => {
  assert.deepEqual(fitTransform({ width: 800, height: 600 }, { width: 0, height: 0 }), { scale: 1, x: 0, y: 0 })
})

test('以指针为中心缩放，指针下的内容不动', () => {
  const before = { scale: 1, x: 100, y: 50 }
  const point = { x: 300, y: 200 }
  const after = zoomAt(before, 2, point)
  assert.equal(after.scale, 2)
  const contentPoint = { x: (point.x - before.x) / before.scale, y: (point.y - before.y) / before.scale }
  assert.equal(after.x + contentPoint.x * after.scale, point.x)
  assert.equal(after.y + contentPoint.y * after.scale, point.y)
})

test('缩放越界时用夹过的比例换算位移', () => {
  const after = zoomAt({ scale: 7, x: 0, y: 0 }, 100, { x: 10, y: 10 })
  assert.equal(after.scale, 8)
})

test('拖动只改位移', () => {
  assert.deepEqual(panBy({ scale: 2, x: 10, y: 20 }, { x: -5, y: 7 }), { scale: 2, x: 5, y: 27 })
})

test('实际大小把内容按原尺寸居中', () => {
  const view = actualTransform({ width: 1000, height: 500 }, { width: 400, height: 200 })
  assert.deepEqual(view, { scale: 1, x: 300, y: 150 })
})

test('百分比以适配为 100%，翻倍就显示 200%', () => {
  const fit = fitTransform({ width: 1000, height: 500 }, { width: 400, height: 400 })
  assert.ok(Math.abs(fitPercent(fit.scale, fit.scale) - 100) < 1e-9)
  assert.ok(Math.abs(fitPercent(fit.scale * 2, fit.scale) - 200) < 1e-9)
  assert.ok(Math.abs(fitPercent(fit.scale / 2, fit.scale) - 50) < 1e-9)
  assert.equal(fitPercent(1, 0), 100)
})

test('实际大小的相对倍率能把当前缩放拉回适配', () => {
  assert.equal(actualFactor(2, 1.5), 0.75)
  assert.equal(actualFactor(1, 1), 1)
  assert.equal(actualFactor(0, 1), 1)
  const rescaled = 2 * actualFactor(2, 1.5)
  assert.ok(Math.abs(rescaled - 1.5) < 1e-9)
})
