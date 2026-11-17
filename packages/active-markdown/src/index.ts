/**
 * @westwall/dsh-active-markdown — 宿主半体。
 *
 * P1 的接管与翻译之外，这里还管翻译结果的两级留存：每次成功翻译写插件存储的
 * 自动缓存，用户点保存时把译文镜像进工作区的 `.dsh-active-markdown/translate/`。
 * 客户端发来它正在显示的原文，Host 不读盘做翻译；读取已保存译文时，Host 用
 * 同一份源文件重算 hash，把「原文已更新」交给客户端展示。调用方没给模型时，
 * Host 自己解析会话默认模型，因为客户端读不到 agentDefaultModel。
 */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LlmLike } from './translate/call.ts'
import {
  createTranslationCache,
  openCacheStore,
  type CachedTranslation,
  type CachePutView,
  type StorageDomainFacility,
  type TranslationCache,
} from './translate/cache.ts'
import { LANGUAGES } from './translate/language.ts'
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
import { Config, configSnapshot, type ActiveMarkdownConfig } from './settings.ts'
import {
  createTranslationStore,
  nodeFiles,
  type TranslationLoadView,
  type TranslationSaveView,
  type TranslationStore,
} from './translate/store.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'activeMarkdown/invalid-request': {}
    'activeMarkdown/unknown-session': {}
    'activeMarkdown/invalid-path': {}
    'activeMarkdown/text-too-large': {}
    'activeMarkdown/prompt-version': {}
    'activeMarkdown/no-model': {}
    'activeMarkdown/unknown-provider': {}
    'activeMarkdown/llm-unavailable': {}
    'activeMarkdown/model-failed': {}
    'activeMarkdown/read-failed': {}
    'activeMarkdown/write-failed': {}
  }
}

type RemoteCode =
  | 'activeMarkdown/invalid-request'
  | 'activeMarkdown/unknown-session'
  | 'activeMarkdown/invalid-path'
  | 'activeMarkdown/text-too-large'
  | 'activeMarkdown/prompt-version'
  | 'activeMarkdown/no-model'
  | 'activeMarkdown/unknown-provider'
  | 'activeMarkdown/llm-unavailable'
  | 'activeMarkdown/model-failed'
  | 'activeMarkdown/read-failed'
  | 'activeMarkdown/write-failed'

const REMOTE_CODES: Record<TranslateErrorCode, RemoteCode> = {
  'invalid-session': 'activeMarkdown/invalid-request',
  'unknown-session': 'activeMarkdown/unknown-session',
  'invalid-path': 'activeMarkdown/invalid-path',
  'invalid-text': 'activeMarkdown/invalid-request',
  'invalid-language': 'activeMarkdown/invalid-request',
  'text-too-large': 'activeMarkdown/text-too-large',
  'prompt-version': 'activeMarkdown/prompt-version',
  'no-model': 'activeMarkdown/no-model',
  'provider-unknown': 'activeMarkdown/unknown-provider',
  'llm-unavailable': 'activeMarkdown/llm-unavailable',
  'model-failed': 'activeMarkdown/model-failed',
  'read-failed': 'activeMarkdown/read-failed',
  'write-failed': 'activeMarkdown/write-failed',
}

/** The subset of `agentDefaultModel` this plugin reads, declared structurally. */
interface DefaultModelLike {
  currentSelection(): { provider?: unknown; model?: unknown } | null
}

/** The live session store and its working-directory projection, declared structurally. */
interface SessionLike {
  readonly header?: { readonly cwd?: string }
}

interface SessionStoreLike {
  get(id: string): SessionLike | undefined
}

interface WorkingDirectoryLike {
  get(session: SessionLike): string
}

interface SessionPersistenceLike {
  stat(id: string): Promise<{ readonly header?: { readonly cwd?: string } } | undefined>
}

export default class ActiveMarkdown extends TypertRemoteService {
  static Config = Config

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
    translateComments?: boolean,
    signal?: AbortSignal,
  ): Promise<TranslateView> {
    const request: TranslateInput = {
      sessionId,
      path,
      text,
      lang,
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      promptVersion: textField(promptVersion),
      translateComments: this.commentsFor(translateComments),
      ...(extraInstruction === undefined ? {} : { extraInstruction }),
    }
    return this.call(() =>
      translateRequest({
        llm: this.llm(),
        readDefault: () => this.readDefaultSelection(),
        request,
        ...(signal === undefined ? {} : { signal }),
      }),
    )
  }

  describe(): DescribeView {
    const settings = this.settings()
    return {
      promptVersion: PROMPT_VERSION,
      settings: {
        lang: settings.lang,
        model: settings.model,
        translateComments: settings.translateComments,
      },
      languages: LANGUAGES,
    }
  }

  /** Read an automatic cache entry without touching the model. */
  async cacheGet(
    text: string,
    lang: string,
    provider?: string,
    model?: string,
    promptVersion?: string,
    extraInstruction?: string,
    translateComments?: boolean,
  ): Promise<CachedTranslation | null> {
    return this.call(async () => {
      const cache = await this.cache()
      return cache.cacheGet({
        text,
        lang,
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        promptVersion: textField(promptVersion),
        translateComments: this.commentsFor(translateComments),
        ...(extraInstruction === undefined ? {} : { extraInstruction }),
      })
    })
  }

  /** Store a successful translation under the same key `cacheGet` will use. */
  async cachePut(
    text: string,
    translated: string,
    lang: string,
    provider?: string,
    model?: string,
    promptVersion?: string,
    extraInstruction?: string,
    aligned?: boolean,
    sourceLines?: number,
    translatedLines?: number,
    translateComments?: boolean,
  ): Promise<CachePutView> {
    return this.call(async () => {
      const cache = await this.cache()
      return cache.cachePut({
        text,
        translated,
        lang,
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        promptVersion: textField(promptVersion),
        translateComments: this.commentsFor(translateComments),
        ...(extraInstruction === undefined ? {} : { extraInstruction }),
        aligned: aligned === true,
        sourceLines: sourceLines ?? 0,
        translatedLines: translatedLines ?? 0,
      })
    })
  }

  /** Write the mirrored Markdown + JSON pair under `.dsh-active-markdown/translate/`. */
  async translationSave(
    sessionId: string,
    path: string,
    text: string,
    translated: string,
    lang: string,
    provider?: string,
    model?: string,
    promptVersion?: string,
    extraInstruction?: string,
    aligned?: boolean,
  ): Promise<TranslationSaveView> {
    return this.call(() =>
      this.fileStore().save({
        sessionId,
        path,
        text,
        translated,
        lang,
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        promptVersion: textField(promptVersion),
        ...(extraInstruction === undefined ? {} : { extraInstruction }),
        aligned: aligned === true,
      }),
    )
  }

  /** Read a saved pair from the workspace and say whether the source moved on. */
  async translationLoad(sessionId: string, path: string, lang: string): Promise<TranslationLoadView | null> {
    return this.call(() => this.fileStore().load({ sessionId, path, lang }))
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
   * The effective settings, read fresh so a plugin-page write applies to the
   * next run. A client that sends its own comment policy still wins, because
   * that run's cache key must match the prompt that produced it.
   */
  private settings(): ActiveMarkdownConfig {
    try {
      return configSnapshot((this.ctx as unknown as { fiber?: { rawConfig?: unknown } }).fiber?.rawConfig)
    } catch {
      return configSnapshot(undefined)
    }
  }

  private commentsFor(explicit: boolean | undefined): boolean {
    return typeof explicit === 'boolean' ? explicit : this.settings().translateComments
  }

  private fileStoreValue?: TranslationStore
  private cacheValue?: Promise<TranslationCache>

  private fileStore(): TranslationStore {
    this.fileStoreValue ??= createTranslationStore({
      files: nodeFiles,
      workspaceOf: (sessionId) => this.workspaceOf(sessionId),
      readDefault: () => this.readDefaultSelection(),
      now: () => new Date(),
    })
    return this.fileStoreValue
  }

  private cache(): Promise<TranslationCache> {
    this.cacheValue ??= openCacheStore(this.serviceOf<StorageDomainFacility>('storageDomain')).then((store) =>
      createTranslationCache({
        store,
        readDefault: () => this.readDefaultSelection(),
        now: () => new Date(),
      }),
    )
    return this.cacheValue
  }

  /**
   * The directory a session's writes belong to: the committed working directory
   * when the Host is running that session, otherwise the header's original cwd
   * for a session loaded from persistence. A live session that names no
   * directory is refused rather than guessed.
   */
  private async workspaceOf(sessionId: string): Promise<string | null> {
    const sessions = this.serviceOf<SessionStoreLike>('sessions')
    let session: SessionLike | undefined
    try {
      session = sessions?.get(sessionId)
    } catch {
      session = undefined
    }
    if (session !== undefined) {
      const workingDirectory = this.serviceOf<WorkingDirectoryLike>('workingDirectory')
      if (workingDirectory !== null) {
        try {
          const directory = workingDirectory.get(session)
          if (typeof directory === 'string' && directory !== '') return directory
        } catch {
          // Fall through to the immutable header directory.
        }
      }
      const cwd = session.header?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : null
    }

    const persistence = this.serviceOf<SessionPersistenceLike>('sessionPersistence')
    if (persistence === null) return null
    try {
      const snapshot = await persistence.stat(sessionId)
      const cwd = snapshot?.header?.cwd
      return typeof cwd === 'string' && cwd !== '' ? cwd : null
    } catch {
      return null
    }
  }

  /**
   * Host services this plugin consumes structurally. `ctx.get` is cast once
   * here instead of augmenting the global Context: `dsh-llm`, `dsh-agent-default-model`,
   * `dsh-session` and the other consumers are intentionally not package dependencies.
   */
  private serviceOf<T>(
    name:
      | 'llm'
      | 'agentDefaultModel'
      | 'sessions'
      | 'workingDirectory'
      | 'sessionPersistence'
      | 'storageDomain',
  ): T | null {
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

const METHODS = ['describe', 'translate', 'cacheGet', 'cachePut', 'translationSave', 'translationLoad'] as const

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
