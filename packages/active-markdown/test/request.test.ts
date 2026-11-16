import test from 'node:test'
import assert from 'node:assert/strict'

import type { LlmCallOptions, LlmLike, LlmStreamChunk } from '../src/translate/call.ts'
import { FALLBACK_MAX_TOKENS } from '../src/translate/call.ts'
import {
  MAX_TEXT_BYTES,
  resolveModel,
  translateRequest,
  TranslateError,
  type TranslateErrorCode,
  type TranslateInput,
} from '../src/translate/request.ts'
import { PROMPT_VERSION } from '../src/translate/prompt.ts'

interface FakeLlmOptions {
  readonly chunks?: readonly string[]
  readonly finish?: { readonly kind: string, readonly failure?: { readonly code?: string, readonly message?: string } }
  readonly defaultMaxTokens?: number
  readonly resolveError?: string
}

function fakeLlm(options: FakeLlmOptions = {}): { llm: LlmLike, calls: LlmCallOptions[] } {
  const calls: LlmCallOptions[] = []
  const llm: LlmLike = {
    async resolveModelInfo() {
      if (options.resolveError !== undefined) throw new Error(options.resolveError)
      return options.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: options.defaultMaxTokens }
    },
    stream(callOptions) {
      calls.push(callOptions)
      const chunks: LlmStreamChunk[] = (options.chunks ?? []).map(text => ({ type: 'text-delta', text }))
      if (options.finish !== undefined) chunks.push({ type: 'finish', reason: options.finish })
      return (async function* produce() {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
  return { llm, calls }
}

const SOURCE = '# Title\n\nBody line.\n'

function request(overrides: Partial<TranslateInput> = {}): TranslateInput {
  return {
    sessionId: 'session-1',
    path: 'docs/README.md',
    text: SOURCE,
    lang: '简体中文',
    promptVersion: PROMPT_VERSION,
    ...overrides,
  }
}

const DEFAULT_SELECTION = { provider: 'deepseek', model: 'deepseek-chat' }

async function expectCode(code: TranslateErrorCode, run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof TranslateError, `期望 TranslateError，实际 ${String(error)}`)
    assert.equal(error.code, code)
    return true
  })
}

test('一次调用返回整篇译文，行数与原文一致', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['# 标题\n', '\n', '正文。\n'], defaultMaxTokens: 4096 })
  const view = await translateRequest({
    llm,
    readDefault: () => DEFAULT_SELECTION,
    request: request(),
  })

  assert.equal(view.text.split('\n').length, SOURCE.split('\n').length)
  assert.equal(calls.length, 1, '整篇只发一次请求')
  assert.equal(calls[0].purpose, 'activeMarkdown.translate')
  assert.equal(calls[0].temperature, 0)
  assert.equal(calls[0].maxTokens, 4096, '输出上限取模型声明的默认值')
  assert.equal(calls[0].provider, 'deepseek')
  assert.equal(calls[0].model, 'deepseek-chat')
  assert.match(calls[0].system ?? '', /- 目标语言：简体中文/)
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: [{ type: 'text', text: SOURCE }] }])
})

test('模型未声明输出上限时回落到 8192', async () => {
  const calls: LlmCallOptions[] = []
  const llm: LlmLike = {
    stream(callOptions) {
      calls.push(callOptions)
      return (async function* produce() {
        yield { type: 'text-delta', text: '译文' }
      })()
    },
  }
  const view = await translateRequest({ llm, readDefault: () => DEFAULT_SELECTION, request: request() })
  assert.equal(view.text, '译文')
  assert.equal(calls[0].maxTokens, FALLBACK_MAX_TOKENS)
  assert.equal(FALLBACK_MAX_TOKENS, 8192)
})

test('显式模型压过默认选择；缺省的一半由默认补齐', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })

  await translateRequest({
    llm,
    readDefault: () => ({ provider: 'default-provider', model: 'default-model' }),
    request: request({ provider: 'explicit-provider', model: 'explicit-model' }),
  })
  assert.deepEqual([calls[0].provider, calls[0].model], ['explicit-provider', 'explicit-model'])

  await translateRequest({
    llm,
    readDefault: () => ({ provider: 'default-provider', model: 'default-model' }),
    request: request(),
  })
  assert.deepEqual([calls[1].provider, calls[1].model], ['default-provider', 'default-model'])

  await translateRequest({
    llm,
    readDefault: () => ({ provider: 'default-provider', model: 'default-model' }),
    request: request({ provider: 'explicit-provider' }),
  })
  assert.deepEqual([calls[2].provider, calls[2].model], ['explicit-provider', 'default-model'])
})

test('没有显式模型也没有默认选择时拒绝为 no-model', async () => {
  const { llm } = fakeLlm({ chunks: ['译文'] })
  await expectCode('no-model', () =>
    translateRequest({ llm, readDefault: () => null, request: request() }))
  await expectCode('no-model', () =>
    translateRequest({
      llm,
      readDefault: () => ({ provider: 'deepseek', model: '' }),
      request: request(),
    }))
})

test('空字符串按未提供处理，回落到默认模型', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })
  await translateRequest({
    llm,
    readDefault: () => DEFAULT_SELECTION,
    request: request({ provider: '', model: '', extraInstruction: '' }),
  })
  assert.deepEqual([calls[0].provider, calls[0].model], ['deepseek', 'deepseek-chat'])
  assert.doesNotMatch(calls[0].system ?? '', /# 本次补充要求/)
})

test('边界守卫拒绝每个坏输入，并给出类型化错误码', async () => {
  const { llm } = fakeLlm({ chunks: ['译文'] })
  const readDefault = () => DEFAULT_SELECTION

  await expectCode('invalid-session', () =>
    translateRequest({ llm, readDefault, request: request({ sessionId: '  ' }) }))
  await expectCode('invalid-text', () =>
    translateRequest({ llm, readDefault, request: request({ text: '   ' }) }))
  await expectCode('text-too-large', () =>
    translateRequest({ llm, readDefault, request: request({ text: 'a'.repeat(MAX_TEXT_BYTES + 1) }) }))
  await expectCode('invalid-language', () =>
    translateRequest({ llm, readDefault, request: request({ lang: '' }) }))
  await expectCode('prompt-version', () =>
    translateRequest({ llm, readDefault, request: request({ promptVersion: 'am.translate.v0' }) }))
  await expectCode('llm-unavailable', () =>
    translateRequest({ llm: null, readDefault, request: request() }))
})

test('模型解析失败与模型调用失败都变成类型化错误', async () => {
  const unknown = fakeLlm({ resolveError: 'provider not found' })
  await expectCode('provider-unknown', () =>
    translateRequest({ llm: unknown.llm, readDefault: () => DEFAULT_SELECTION, request: request() }))

  const failed = fakeLlm({
    chunks: ['半截'],
    finish: { kind: 'error', failure: { message: 'rate limited' } },
  })
  await expectCode('model-failed', () =>
    translateRequest({ llm: failed.llm, readDefault: () => DEFAULT_SELECTION, request: request() }))

  const empty = fakeLlm({ chunks: [] })
  await expectCode('model-failed', () =>
    translateRequest({ llm: empty.llm, readDefault: () => DEFAULT_SELECTION, request: request() }))
})

test('resolveModel 只看显式半与默认半', () => {
  assert.deepEqual(
    resolveModel({ provider: 'p', model: 'm', readDefault: () => null }),
    { provider: 'p', model: 'm' },
  )
  assert.deepEqual(
    resolveModel({ provider: 'p', readDefault: () => ({ provider: 'd', model: 'm2' }) }),
    { provider: 'p', model: 'm2' },
  )
  assert.throws(
    () => resolveModel({ readDefault: () => null }),
    (error: unknown) => error instanceof TranslateError && error.code === 'no-model',
  )
})
