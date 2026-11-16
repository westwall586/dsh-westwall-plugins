import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

import ActiveMarkdown from '../src/index.ts'
import { FALLBACK_MAX_TOKENS, type LlmCallOptions, type LlmLike } from '../src/translate/call.ts'
import { LANGUAGES } from '../src/translate/language.ts'
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

function serviceWith(services: Record<string, unknown>, config?: unknown): ActiveMarkdown {
  const ctx = new Context()
  const provide = (ctx as unknown as { provide(name: string, value: unknown): void }).provide.bind(ctx)
  for (const [name, value] of Object.entries(services)) provide(name, value)
  if (config !== undefined) {
    (ctx as unknown as { fiber: { rawConfig: unknown } }).fiber.rawConfig = config
  }
  return new ActiveMarkdown(ctx)
}

const SOURCE = '# Title\n\nBody line.\n'

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

test('translate 返回整篇译文，行数与原文一致', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['# 标题\n', '\n', '正文。\n'], defaultMaxTokens: 4096 })
  const service = serviceWith({ llm })
  const view = await service.translate('session-1', 'docs/README.md', SOURCE, 'zh', 'deepseek', 'chat', PROMPT_VERSION, '')

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
  await service.translate('session-1', 'a.md', SOURCE, 'zh', '', '', PROMPT_VERSION, '')
  assert.deepEqual([calls[0].provider, calls[0].model], ['default-provider', 'default-model'])
  assert.equal(calls[0].maxTokens, FALLBACK_MAX_TOKENS)
})

test('显式 provider 与 model 压过默认选择', async () => {
  const { llm, calls } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({
    llm,
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) },
  })
  await service.translate('session-1', 'a.md', SOURCE, 'zh', 'explicit-provider', 'explicit-model', PROMPT_VERSION)
  assert.deepEqual([calls[0].provider, calls[0].model], ['explicit-provider', 'explicit-model'])
})

test('describe 回提示词版本、生效设置与语言表', () => {
  const service = serviceWith({})
  assert.deepEqual(service.describe(), {
    promptVersion: PROMPT_VERSION,
    settings: { lang: 'zh', model: null, translateComments: true },
    languages: LANGUAGES,
  })
})

test('describe 读插件设置里的模型、语言代码与注释策略', () => {
  const service = serviceWith({}, {
    model: { provider: 'p', model: 'm' },
    lang: 'en',
    translateComments: false,
  })
  assert.deepEqual(service.describe().settings, {
    lang: 'en',
    model: { provider: 'p', model: 'm' },
    translateComments: false,
  })
})

test('未显式给注释策略时用插件设置，显式值压过设置', async () => {
  const off = fakeLlm({ chunks: ['译文'] })
  const offService = serviceWith({ llm: off.llm }, { translateComments: false })
  await offService.translate('session-1', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION, '')
  assert.match(off.calls[0]!.system ?? '', /注释也不翻译/)

  const on = fakeLlm({ chunks: ['译文'] })
  const onService = serviceWith({ llm: on.llm }, { translateComments: false })
  await onService.translate('session-1', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION, '', true)
  assert.match(on.calls[0]!.system ?? '', /注释、说明性内容可以翻译/)
})

test('边界守卫以 Remote 错误码返回，而不是裸异常', async () => {
  const { llm } = fakeLlm({ chunks: ['译文'] })
  const service = serviceWith({ llm })

  await assert.rejects(
    service.translate('', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', '   ', 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', 'a'.repeat(MAX_TEXT_BYTES + 1), 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/text-too-large',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, '', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/invalid-request',
  )
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, 'zh', '', '', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/no-model',
  )
})

test('模型失败以 Remote 错误码返回', async () => {
  const { llm } = fakeLlm({ chunks: ['半截'], finish: { kind: 'error', failure: { message: 'rate limited' } } })
  const service = serviceWith({ llm })
  await assert.rejects(
    service.translate('session-1', 'a.md', SOURCE, 'zh', 'p', 'm', PROMPT_VERSION),
    (error: unknown) => codeOf(error) === 'activeMarkdown/model-failed',
  )
})
