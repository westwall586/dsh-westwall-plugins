import test from 'node:test'
import assert from 'node:assert/strict'

import type { CacheGetInput, CachePutInput } from '../src/translate/cache.ts'
import { providerOf } from '../client/src/store/kernel/translation.ts'

const MODEL = { provider: 'deepseek', model: 'chat' } as const

test('普通运行带上整套模型选择，不会只带 lang', () => {
  assert.deepEqual(providerOf(MODEL), { provider: 'deepseek', model: 'chat' })
})

test('没有模型选择时那两项缺席，由 Host 兜底', () => {
  assert.deepEqual(providerOf(null), {})
})

test('缓存与落盘的键都是整份设置：缺 provider/model 的键与带上的键不同', () => {
  const request: CacheGetInput = {
    text: '# T',
    lang: 'zh',
    ...providerOf(MODEL),
    promptVersion: 'am.translate.v2',
    translateComments: true,
  }
  const withoutModel: CacheGetInput = {
    text: '# T',
    lang: 'zh',
    promptVersion: 'am.translate.v2',
    translateComments: true,
  }
  const put: CachePutInput = {
    ...request,
    translated: '# 标题',
    aligned: true,
    sourceLines: 1,
    translatedLines: 1,
  }
  assert.notDeepEqual(request, withoutModel)
  assert.equal(put.provider, 'deepseek')
  assert.equal(put.model, 'chat')
})
