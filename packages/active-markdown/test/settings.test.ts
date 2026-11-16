import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, configSnapshot } from '../src/settings.ts'

type Schema = (input?: unknown) => unknown

const schema = Config as Schema

test('Config 默认跟随会话模型、zh、翻译注释', () => {
  assert.deepEqual(configSnapshot(schema()), {
    model: null,
    lang: 'zh',
    translateComments: true,
  })
})

test('Config 接受三值语言代码与 provider/model 对', () => {
  const raw = schema({
    model: { provider: 'deepseek', model: 'chat' },
    lang: 'zh-Hant',
    translateComments: false,
  })
  assert.deepEqual(configSnapshot(raw), {
    model: { provider: 'deepseek', model: 'chat' },
    lang: 'zh-Hant',
    translateComments: false,
  })
})

test('Config 拒绝枚举外的语言代码', () => {
  assert.throws(() => schema({ lang: 'fr' }))
  assert.throws(() => schema({ lang: 'zh-TW' }))
})
