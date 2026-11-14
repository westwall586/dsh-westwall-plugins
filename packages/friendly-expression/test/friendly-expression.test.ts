import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject, name } from '../src/index.ts'

test('插件导出形状合法', () => {
  assert.equal(name, 'friendly-expression')
  assert.ok(Array.isArray(inject))
  assert.equal(typeof apply, 'function')
})

test('设计阶段不依赖宿主服务', () => {
  assert.deepEqual(inject, [])
})