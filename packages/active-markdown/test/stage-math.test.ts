import test from 'node:test'
import assert from 'node:assert/strict'

import { clampScale, fitTransform, panBy, zoomAt } from '../client/src/rich/stage-math.ts'

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
