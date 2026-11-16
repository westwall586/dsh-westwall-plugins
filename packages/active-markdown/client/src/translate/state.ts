/**
 * One translation's lifecycle in one tab. The state says where a ready result
 * came from, because that decides whether it can be saved and whether the
 * source moving on is the reader's business. Line counts are measured from the
 * texts themselves: the client is the only checker, so alignment is derived
 * here and never taken from stored metadata.
 */
import { countLines } from './plan.ts'

/**
 * The identity of the run that produced a translation. It travels with the
 * ready state so 保存 and the cache use the same language, model, and prompt
 * that produced the text, even after the plugin-page settings change.
 */
export interface PromptRun {
  readonly promptVersion: string
  readonly extraInstruction: string
  readonly lang: string
  readonly provider?: string
  readonly model?: string
  readonly translateComments: boolean
}

/**
 * Where a ready translation came from. Only a mirrored file can be stale, and
 * only a dismissed notice stops being shown, so the two facts live together.
 */
export type TranslationSource =
  | { readonly kind: 'saved', readonly stale: boolean, readonly dismissed: boolean }
  | { readonly kind: 'cache' }
  | { readonly kind: 'run' }

export type ReadyTranslation = {
  readonly status: 'ready'
  readonly text: string
  readonly sourceLines: number
  readonly translatedLines: number
  readonly source: TranslationSource
  readonly run: PromptRun
}

export type TranslationState =
  | { readonly status: 'idle' }
  | { readonly status: 'running', readonly chunk: number, readonly chunks: number, readonly partial?: string }
  | ReadyTranslation
  | { readonly status: 'too-large', readonly lineCount: number }
  | { readonly status: 'failed', readonly message: string }

/**
 * Build a finished translation from its text and the source it belongs to.
 * @param input - the translated text, the source it was made from, and where it came from.
 * @returns the ready state with both line counts measured locally.
 */
export function readyState(input: {
  text: string
  sourceText: string
  source: TranslationSource
  run: PromptRun
}): ReadyTranslation {
  return {
    status: 'ready',
    text: input.text,
    sourceLines: countLines(input.sourceText),
    translatedLines: countLines(input.text),
    source: input.source,
    run: input.run,
  }
}

/** The text already on screen for the translated view, if any. */
export function translatedText(state: TranslationState): string | undefined {
  if (state.status === 'ready') return state.text
  if (state.status === 'running') return state.partial
  return undefined
}

/** True when the translated text can be paired with the source line by line. */
export function lineAligned(state: TranslationState): boolean {
  if (state.status === 'running') return state.partial !== undefined
  return state.status === 'ready' && state.sourceLines === state.translatedLines
}

/** The ready translation 保存 may write: one this tab produced, or one a mirrored file already holds. */
export function saveable(state: TranslationState): ReadyTranslation | undefined {
  return state.status === 'ready' && state.source.kind !== 'cache' ? state : undefined
}

/** The saved file predates the source, and the reader has not dismissed that. */
export function staleNoticeOf(state: TranslationState): boolean {
  return state.status === 'ready'
    && state.source.kind === 'saved'
    && state.source.stale
    && !state.source.dismissed
}

/** The reader acknowledged the source change; the translated text keeps showing. */
export function dismissStale(state: TranslationState): TranslationState {
  if (state.status !== 'ready' || state.source.kind !== 'saved') return state
  return { ...state, source: { ...state.source, dismissed: true } }
}

/** A mirrored file now corresponds to this translation, so the source is current again. */
export function markSaved(state: TranslationState): TranslationState {
  if (state.status !== 'ready') return state
  return { ...state, source: { kind: 'saved', stale: false, dismissed: false } }
}
