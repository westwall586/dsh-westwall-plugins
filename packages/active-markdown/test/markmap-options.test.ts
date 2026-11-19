import test from 'node:test'
import assert from 'node:assert/strict'

import { interactionOptions } from '../client/src/rich/markmap/options.ts'

test('内嵌思维导图不接滚轮，滚轮交还页面', () => {
  const inline = interactionOptions('inline')
  assert.equal(inline.zoom, false, '内嵌不缩放')
  assert.equal(inline.pan, false, '内嵌不吞滚轮')
  assert.equal(inline.scrollForPan, false, 'macOS 默认把滚轮当平移，这里显式关掉')
})

test('全屏思维导图滚轮缩放，平移交给拖拽', () => {
  const panel = interactionOptions('panel')
  assert.equal(panel.zoom, true, '全屏滚轮缩放')
  assert.equal(panel.pan, false, '滚轮不再平移，拖拽仍然可用')
  assert.equal(panel.scrollForPan, false, '否则 macOS 上滚轮只平移不缩放')
})
