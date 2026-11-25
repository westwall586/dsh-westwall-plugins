/**
 * 一次翻译运行：按文件（`path`）键控，不按 crate。同一个文件被两个 compose 会话
 * 打开时共用这一份运行，谁挂载谁读它的状态，不会跑第二次。
 *
 * 运行的结束只由显式的 `abort` 触发（用户点返回原文/重新翻译、关闭页签、文件被
 * 外部修改）。挂载与卸载不碰它：切页签会让 body 卸载，而翻译必须继续。
 */
import type { DescribeView, HostBridge, ModelChoice, TranslationMeta } from '../../context.ts'
import { parseDocument } from '../../markdown/blocks.ts'
import { assembleTranslation, normalize, planTranslation } from '../../translate/plan.ts'
import type { PromptRun, ReadyTranslation, TranslationState } from '../../translate/state.ts'
import { readyState } from '../../translate/state.ts'
import { aligned } from '../../translate/verify.ts'
import type { DocumentKey } from '../ref.ts'

/** `ModelChoice` 非空时的 `provider`/`model` 两项，空时没有这两项。 */
type TranslationProvider = { provider?: string, model?: string }

/** 运行所属的文件身份；`session` 授权模型调用与落盘。 */
export type RunKey = Pick<DocumentKey, 'session' | 'path'>

/** 运行需要的当前原文；重挂载时带上这次读到的版本。 */
export interface RunSource {
  readonly text: string
  readonly absolutePath: string
}

export interface TranslationRunDeps {
  readonly key: RunKey
  host(): Promise<HostBridge>
}

export interface TranslationRun {
  readonly key: RunKey
  getState(): TranslationState
  /** 当前在跑的控制器；没有运行时为 null。 */
  controller(): AbortController | null
  subscribe(listener: () => void): () => void
  /**
   * 接受一次来自 UI 的运行意图。正在跑且意图一致时什么都不做：重挂载的 body
   * 不能把已经在跑的那次再发一遍。
   */
  start(source: RunSource, extraInstruction: string, reuseStored: boolean): void
  /**
   * 把一份已完成但没有落盘的译文写进工作区（缓存命中、写失败后的重试）。
   * 有意重发翻译请求：那一轮没有模型调用，只差这一次写。
   */
  save(ready: ReadyTranslation): void
  /** 磁盘上已有的译文，只在还没有任何状态时放进去：它不能顶掉正在跑的那次。 */
  restore(ready: ReadyTranslation): void
  abort(): void
  dispose(): void
}

interface Intent {
  readonly source: RunSource
  readonly instruction: string
  readonly reuseStored: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameIntent(intent: Intent, source: RunSource, extraInstruction: string, reuseStored: boolean): boolean {
  return intent.source.text === source.text
    && intent.instruction === extraInstruction
    && intent.reuseStored === reuseStored
}

/** 让一次普通翻译也带上整套模型选择：缓存与落盘的 key 是整份设置，不能只带 lang。 */
export function providerOf(model: ModelChoice | null): TranslationProvider {
  return model === null ? {} : { provider: model.provider, model: model.model }
}

/** 存下来的元数据给出运行身份，缺失的提示版本用当前描述兜底。 */
function storedRun(meta: TranslationMeta, described: DescribeView, extraInstruction: string): PromptRun {
  return {
    promptVersion: meta.promptVersion || described.promptVersion,
    extraInstruction,
    lang: meta.lang,
    provider: meta.provider,
    model: meta.model,
    translateComments: described.settings.translateComments,
  }
}

export function createTranslationRun(deps: TranslationRunDeps): TranslationRun {
  let state: TranslationState = { status: 'idle' }
  /** 世代令牌：start、abort、dispose 都递增，晚到的异步结果据此作废。 */
  let generation = 0
  let running: AbortController | null = null
  let intent: Intent | null = null
  const listeners = new Set<() => void>()

  const set = (next: TranslationState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }

  const persist = (ready: ReadyTranslation): void => {
    const token = generation
    // 已有同文本的 ready 只换持久化标记，免得把更新的运行身份覆盖回旧的那份。
    const current = state
    set(current.status === 'ready' && current.text === ready.text ? { ...current, persistence: { kind: 'saving' } } : { ...ready, persistence: { kind: 'saving' } })
    void (async () => {
      try {
        const bridge = await deps.host()
        const saved = await bridge.save({
          sessionId: deps.key.session,
          path: deps.key.path,
          text: ready.source,
          translated: ready.text,
          lang: ready.run.lang,
          ...(ready.run.provider === undefined ? {} : { provider: ready.run.provider }),
          ...(ready.run.model === undefined ? {} : { model: ready.run.model }),
          promptVersion: ready.run.promptVersion,
          extraInstruction: ready.run.extraInstruction,
          aligned: aligned(ready.alignment),
        })
        if (token !== generation) return
        if (state.status === 'ready' && state.text === ready.text) {
          set({ ...state, persistence: { kind: 'saved', stale: false, dismissed: false, file: saved.file } })
        } else {
          set({ ...ready, persistence: { kind: 'saved', stale: false, dismissed: false, file: saved.file } })
        }
      } catch (error) {
        if (token !== generation) return
        const message = messageOf(error)
        if (state.status === 'ready' && state.text === ready.text) set({ ...state, persistence: { kind: 'failed', message } })
        else set({ ...ready, persistence: { kind: 'failed', message } })
      }
    })()
  }

  return {
    key: deps.key,

    getState: () => state,
    controller: () => running,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    start(source, extraInstruction, reuseStored) {
      if (state.status === 'running' && intent !== null && sameIntent(intent, source, extraInstruction, reuseStored)) return
      const plan = planTranslation(source.text, parseDocument(source.text).blocks)
      if (plan.kind === 'too-large') {
        // 上一轮还在跑的分段已经没有意义。
        running?.abort()
        running = null
        generation += 1
        intent = null
        set({ status: 'too-large', lineCount: plan.lineCount })
        return
      }
      running?.abort()
      const token = (generation += 1)
      intent = { source, instruction: extraInstruction, reuseStored }
      const controller = new AbortController()
      running = controller
      const sourceLines = normalize(source.text).split('\n')
      const chunks = plan.ranges.length
      set({ status: 'running', chunk: 1, chunks })
      void (async () => {
        try {
          const bridge = await deps.host()
          const described = await bridge.describe().catch(() => FALLBACK_DESCRIBE)
          if (token !== generation) return
          const settings = described.settings
          const promptVersion = described.promptVersion
          const model = settings.model
          const run: PromptRun = {
            ...providerOf(model),
            promptVersion,
            extraInstruction,
            lang: settings.lang,
            translateComments: settings.translateComments,
          }
          // 用户点的是“看译文”，已有结果就不必再付一次模型调用；显式重新翻译
          // 必须产出新的，所以那条路径不进这个分支。
          if (reuseStored) {
            const cached = await bridge.cacheGet({
              text: source.text,
              lang: settings.lang,
              ...(model === null ? {} : { provider: model.provider, model: model.model }),
              promptVersion,
              translateComments: settings.translateComments,
              extraInstruction,
            }).catch(() => null)
            if (token !== generation) return
            if (cached !== null) {
              // 缓存命中也是对一次点击的应答，所以它同样要落到工作区。
              running = null
              intent = null
              persist(readyState({
                text: cached.text,
                sourceText: source.text,
                persistence: { kind: 'unsaved' },
                run: storedRun(cached.meta, described, extraInstruction),
              }))
              return
            }
          }
          const replies: string[] = []
          let partial: string | undefined
          for (const [index, range] of plan.ranges.entries()) {
            if (token !== generation) return
            // 已经落地的分段继续显示，新的一段跑起来时进度条前进一步。
            set({ status: 'running', chunk: index + 1, chunks, ...(partial === undefined ? {} : { partial }) })
            replies.push(await bridge.translate({
              sessionId: deps.key.session,
              path: deps.key.path,
              text: sourceLines.slice(range.start, range.end).join('\n'),
              lang: settings.lang,
              ...(model === null ? {} : { provider: model.provider, model: model.model }),
              promptVersion,
              extraInstruction,
              translateComments: settings.translateComments,
            }, controller.signal))
            if (token !== generation) return
            // 完成的段落一次全部落地，未完成的保留原文，页面以恒定行数逐渐变成译文。
            const pending = plan.ranges.slice(index + 1).map(next => sourceLines.slice(next.start, next.end).join('\n'))
            partial = assembleTranslation(plan.ranges, sourceLines, [...replies, ...pending])
            set({ status: 'running', chunk: index + 2 > chunks ? chunks : index + 2, chunks, partial })
          }
          running = null
          intent = null
          const ready = readyState({
            text: assembleTranslation(plan.ranges, sourceLines, replies),
            sourceText: source.text,
            persistence: { kind: 'unsaved' },
            run,
          })
          persist(ready)
          // 缓存写失败只影响下一次运行，永远不能改变读者看到的东西。
          void bridge.cachePut({
            text: source.text,
            translated: ready.text,
            lang: run.lang,
            ...(run.provider === undefined ? {} : { provider: run.provider }),
            ...(run.model === undefined ? {} : { model: run.model }),
            promptVersion: run.promptVersion,
            translateComments: run.translateComments,
            extraInstruction: run.extraInstruction,
            aligned: aligned(ready.alignment),
            sourceLines: ready.alignment.sourceLines,
            translatedLines: ready.alignment.translatedLines,
          }).catch((error: unknown) => console.warn('[active-markdown] cache write failed', error))
        } catch (error) {
          if (token !== generation) return
          running = null
          intent = null
          set({ status: 'failed', message: messageOf(error) })
        }
      })()
    },

    save(ready) {
      persist(ready)
    },

    restore(restored) {
      if (state.status === 'idle') set(restored)
    },

    abort() {
      generation += 1
      running?.abort()
      running = null
      intent = null
      if (state.status === 'running') set({ status: 'idle' })
    },

    dispose() {
      generation += 1
      running?.abort()
      running = null
      intent = null
      listeners.clear()
    },
  }
}

/**
 * 失败兜底：一次失败的 describe 不该让整次翻译停摆，默认语言与提示版本让运行
 * 还能继续，下一次运行会重新读 Host。
 */
export const FALLBACK_DESCRIBE: DescribeView = {
  promptVersion: 'am.translate.v2',
  settings: { lang: 'zh', model: null, translateComments: true },
  languages: [],
}
