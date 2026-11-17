/** One translation's lifecycle in one tab. */
import { alignOf, aligned, type Alignment } from './verify.ts'

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
 * Whether the workspace already holds this translation. Only a mirrored file
 * can be stale, and only a dismissed notice stops being shown, so the two facts
 * live together; a translation that is not persisted has neither.
 */
export type Persistence =
  | { readonly kind: 'unsaved' }
  | { readonly kind: 'saved', readonly stale: boolean, readonly dismissed: boolean }

export type ReadyTranslation = {
  readonly status: 'ready'
  readonly text: string
  readonly alignment: Alignment
  readonly persistence: Persistence
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
 * @param input - the translated text, the source it was made from, and whether it is persisted.
 * @returns the ready state with line counts and the heading comparison measured locally.
 */
export function readyState(input: {
  text: string
  sourceText: string
  persistence: Persistence
  run: PromptRun
}): ReadyTranslation {
  return {
    status: 'ready',
    text: input.text,
    alignment: alignOf(input.sourceText, input.text),
    persistence: input.persistence,
    run: input.run,
  }
}

/** The text already on screen for the translated view, if any. */
export function translatedText(state: TranslationState): string | undefined {
  if (state.status === 'ready') return state.text
  if (state.status === 'running') return state.partial
  return undefined
}

/** True when a finished translation passed both line and heading checks. */
export function lineAligned(state: TranslationState): boolean {
  return state.status === 'ready' && aligned(state.alignment)
}

/** The ready translation 保存 may write: one the workspace does not hold yet. */
export function saveable(state: TranslationState): ReadyTranslation | undefined {
  return state.status === 'ready' && state.persistence.kind === 'unsaved' ? state : undefined
}

/** The saved file predates the source, and the reader has not dismissed that. */
export function staleNoticeOf(state: TranslationState): boolean {
  return state.status === 'ready'
    && state.persistence.kind === 'saved'
    && state.persistence.stale
    && !state.persistence.dismissed
}

/** The reader acknowledged the source change; the translated text keeps showing. */
export function dismissStale(state: TranslationState): TranslationState {
  if (state.status !== 'ready' || state.persistence.kind !== 'saved') return state
  return { ...state, persistence: { ...state.persistence, dismissed: true } }
}

/** A mirrored file now corresponds to this translation, so the source is current again. */
export function markSaved(state: TranslationState): TranslationState {
  if (state.status !== 'ready') return state
  return { ...state, persistence: { kind: 'saved', stale: false, dismissed: false } }
}
