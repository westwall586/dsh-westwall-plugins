import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

import ActiveMarkdown from '../src/index.ts'
import { FALLBACK_MAX_TOKENS, type LlmCallOptions, type LlmLike } from '../src/translate/call.ts'
import { MAX_TEXT_BYTES } from '../src/translate/request.ts'
import { PROMPT_VERSION } from '../src/translate/prompt.ts'

interface FakeLlmOptions {
  readonly chunks?: readonly string[]
  readonly finish?: { readonly kind: string, readonly failure?: { readonly message?: string } }
  readonly defaultMaxTokens?: number
}

function fakeLlm(options: FakeLlmOptions = {}): { llm: LlmLike, calls: LlmCallOptions[] } {
  const calls: LlmCallOptions[] = []
  const llm: LlmLike = {
    async resolveModelInfo() {
      return options.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: options.defaultMaxTokens }
    },
    stream(callOptions) {
      calls.push(callOptions)
      return (async function* produce() {
        for (const text of options.chunks ?? []) yield { type: 'text-delta', text }
        if (options.finish !== undefined) yield { type: 'finish', reason: options.finish }
      })()
    },
  }
  return { llm, calls }
}

function serviceWith(services: Record<string, unknown>): ActiveMarkdown {
  const ctx = new Context()
  const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
  for (const [name, value] of Object.entries(services)) provide(name, value)
  return new ActiveMarkdown(ctx)
}

const SOURCE = '# Title\n\nBody line.\n'

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

test('translate 返回整篇译文，行数与原文一致', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['# 标题\n', '\n', '正文。\n'], defaultMaxTokens: 4096 })
  const service = serviceWith({ llm })
  const view = await service.translate('session-1', 'docs/README.md', SOURCE, '简体中文', 'deepseek', 'chat', PROMPT_VERSION, '')

  assert.equal(view.text.split('\n').length, SOURCE.split('\n').length)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].purpose, 'activeMarkdown.translate')
  assert.equal(calls[0].temperature, 0)
  assert.equal(calls[0].maxTokens, 4096)
  assert.match(calls[0].system ?? '', /- 目标语言：简体中文/)
})

test('省略 provider 与 model 时用会话默认模型', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
  })
  await service.translate('session-1', 'a.md', SOURCE, '简体中文', '', '', PROMPT_VERSION, '')
  assert.deepEqual([calls[0].provider, calls[0].model], ['default-provider', 'default-model'])
  assert.equal(calls[0].maxTokens, FALLBACK_MAX_TOKENS)
})

test('显式 provider 与 model 压过默认选择', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
  })
  await service.translate('session-1', 'a.md', SOURCE, '简体中文', 'explicit-provider', 'explicit-model', PROMPT_VERSION)
  assert.deepEqual([calls[0].provider, calls[0].model], ['explicit-provider', 'explicit-model'])
})

test('describe 只回提示词版本', () => {
  const service = serviceWith({})
  assert.deepEqual(service.describe(), { promptVersion: PROMPT_VERSION })
})

test('边界守卫以 Remote 错误码返回，而不是裸异常', async () => {
  const { llm } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({ llm })

  await assert.rejects(
    service.translate('', 'a.md', SOURCE, '简体中文', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', '   ', '简体中文', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', 'a'.repeat(MAX_TEXT_BYTES + 1), '简体中文', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/text-too-large',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, '简体中文', '', '', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/no-model',
  )
})

test('模型失败以 Remote 错误码返回', async () => {
  const { llm } = fakeLlm({ chunks: ['半截'], finish: { kind: 'error', failure: { message: 'rate limited' } } })
  const service = serviceWith({ llm })
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, '简体中文', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/model-failed',
  )
})
