import test from 'node:test'
import assert from 'node:assert/strict'

import ActiveMarkdown from '../src/index.ts'

test('插件默认导出 Host 服务类', () => {
  assert.equal(typeof ActiveMarkdown, 'function')
  assert.equal(ActiveMarkdown.name, 'ActiveMarkdown')
  assert.equal(typeof ActiveMarkdown.prototype.translate, 'function')
  assert.equal(typeof ActiveMarkdown.prototype.describe, 'function')
})
