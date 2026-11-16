import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, inject, name } from '../src/index.ts'

test('插件导出形状合法', () => {
  assert.equal(name, 'active-markdown')
  assert.ok(Array.isArray(inject))
  assert.equal(typeof apply, 'function')
})
