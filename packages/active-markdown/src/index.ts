/**
 * @westwall/dsh-active-markdown — 宿主半体。
 *
 * P0 的接管全部在浏览器半体。P1 这里只多两件事：一份仅存于 Host 的翻译
 * 提示词，和一次整篇翻译的模型调用。客户端发来它正在显示的原文，Host
 * 不再读盘；返回整篇译文，由客户端做行数与结构校验。调用方没给模型时，
 * Host 自己解析会话默认模型，因为客户端读不到 agentDefaultModel。
 */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LlmLike } from './translate/call.ts'
import { PROMPT_VERSION } from './translate/prompt.ts'
import {
  translateRequest,
  TranslateError,
  type DescribeView,
  type ModelSelection,
  type TranslateErrorCode,
  type TranslateInput,
  type TranslateView,
} from './translate/request.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'activeMarkdown/invalid-request': {}
    'activeMarkdown/text-too-large': {}
    'activeMarkdown/prompt-version': {}
    'activeMarkdown/no-model': {}
    'activeMarkdown/unknown-provider': {}
    'activeMarkdown/llm-unavailable': {}
    'activeMarkdown/model-failed': {}
  }
}

type RemoteCode =
  | 'activeMarkdown/invalid-request'
  | 'activeMarkdown/text-too-large'
  | 'activeMarkdown/prompt-version'
  | 'activeMarkdown/no-model'
  | 'activeMarkdown/unknown-provider'
  | 'activeMarkdown/llm-unavailable'
  | 'activeMarkdown/model-failed'

const REMOTE_CODES: Record<TranslateErrorCode, RemoteCode> = {
  'invalid-session': 'activeMarkdown/invalid-request',
  'invalid-text': 'activeMarkdown/invalid-request',
  'invalid-language': 'activeMarkdown/invalid-request',
  'text-too-large': 'activeMarkdown/text-too-large',
  'prompt-version': 'activeMarkdown/prompt-version',
  'no-model': 'activeMarkdown/no-model',
  'provider-unknown': 'activeMarkdown/unknown-provider',
  'llm-unavailable': 'activeMarkdown/llm-unavailable',
  'model-failed': 'activeMarkdown/model-failed',
}

/** The subset of `agentDefaultModel` this plugin reads, declared structurally. */
interface DefaultModelLike {
  currentSelection(): { provider?: unknown; model?: unknown } | null
}

export default class ActiveMarkdown extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'activeMarkdown')
  }

  async translate(
    sessionId: string,
    path: string,
    text: string,
    lang: string,
    provider?: string,
    model?: string,
    promptVersion?: string,
    extraInstruction?: string,
  ): Promise<TranslateView> {
    const request: TranslateInput = {
      sessionId,
      path,
      text,
      lang,
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      promptVersion: textField(promptVersion),
      ...(extraInstruction === undefined ? {} : { extraInstruction }),
    }
    return this.call(() =>
      translateRequest({
        llm: this.llm(),
        readDefault: () => this.readDefaultSelection(),
        request,
      }),
    )
  }

  describe(): DescribeView {
    return { promptVersion: PROMPT_VERSION }
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof TranslateError) throw new RemoteError(REMOTE_CODES[error.code], error.message, {})
      throw error
    }
  }

  /**
   * Host services this plugin consumes structurally. `ctx.get` is cast once
   * here instead of augmenting the global Context: `dsh-llm` and
   * `dsh-agent-default-model` are intentionally not package dependencies.
   */
  private serviceOf<T>(name: 'llm' | 'agentDefaultModel'): T | null {
    const ctx = this.ctx as unknown as { get?: (key: string) => unknown }
    if (typeof ctx.get !== 'function') return null
    const service = ctx.get(name)
    return service === undefined || service === null ? null : (service as T)
  }

  private llm(): LlmLike | null {
    return this.serviceOf<LlmLike>('llm')
  }

  private readDefaultSelection(): ModelSelection | null {
    const service = this.serviceOf<DefaultModelLike>('agentDefaultModel')
    if (service === null) return null
    try {
      const selection = service.currentSelection()
      if (selection === null || selection === undefined) return null
      if (typeof selection.provider !== 'string' || typeof selection.model !== 'string') return null
      return { provider: selection.provider, model: selection.model }
    } catch {
      return null
    }
  }
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const METHODS = ['describe', 'translate'] as const

Object.defineProperty(ActiveMarkdown.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  configurable: true,
  value: Object.freeze(
    structuredClone({ version: 1, methods: METHODS.map((method) => ({ method, invocation: { kind: 'direct' } })) }),
  ),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Active Markdown translation, registered by the plugin row. */
    activeMarkdown: ActiveMarkdown
  }
}
