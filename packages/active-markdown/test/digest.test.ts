import test from 'node:test'
import assert from 'node:assert/strict'

import { cacheKeyOf } from '../src/translate/digest.ts'

/** 存储后端的 per-record 布局把记录键直接当文件名。 */
const PATH_SAFE = /^[a-zA-Z0-9_-]+$/

test('缓存键能当文件名：后端只接受 [a-zA-Z0-9_-]+', () => {
  const key = cacheKeyOf({
    sourceText: '# Title\n\nBody.\n',
    lang: 'zh',
    provider: 'qwen-token-plan-cn',
    model: 'qwen4-max',
    promptVersion: 'am.translate.v1',
    translateComments: true,
  })

  assert.match(key, PATH_SAFE)
  assert.ok(key.length > 0)
})

test('内容身份一变键就变，摘要不会把两次翻译混成同一条', () => {
  const base = {
    sourceText: '# Title\n\nBody.\n',
    lang: 'zh',
    provider: 'deepseek',
    model: 'chat',
    promptVersion: 'am.translate.v1',
    translateComments: true,
  }
  const key = cacheKeyOf(base)

  assert.notEqual(cacheKeyOf({ ...base, lang: 'en' }), key)
  assert.notEqual(cacheKeyOf({ ...base, model: 'reasoner' }), key)
  assert.notEqual(cacheKeyOf({ ...base, translateComments: false }), key)
  assert.notEqual(cacheKeyOf({ ...base, sourceText: `${base.sourceText}More.\n` }), key)
  // 行尾对内容身份不可见，缓存不能因为换行风格不同就假失手。
  assert.equal(cacheKeyOf({ ...base, sourceText: base.sourceText.replace(/\n/g, '\r\n') }), key)
})
