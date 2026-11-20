/** One translation's lifecycle in one tab. */
import { alignOf, aligned, type Alignment } from './verify.ts'

/**
 * The identity of the run that produced a translation. It travels with the
 * ready state so the workspace write and the cache use the same language,
 * model, and prompt that produced the text, even after the plugin-page
 * settings change.
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
 * Whether the workspace holds this translation. A finished translation is
 * written on its own, so `saving`/`failed` are states the reader watches
 * rather than actions they take; the only manual path left is retrying a
 * failed write. `unsaved` is the brief life of a cache hit that has not been
 * written yet.
 */
export type Persistence =
  | { readonly kind: 'unsaved' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved', readonly stale: boolean, readonly dismissed: boolean, readonly file: string }
  | { readonly kind: 'failed', readonly message: string }

export type ReadyTranslation = {
  readonly status: 'ready'
  readonly text: string
  /**
   * The source snapshot this translation was made from. Saving hashes this
   * text, not the live tab, so a write that lands after a reload still records
   * the source the translation actually belongs to.
   */
  readonly source: string
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
    source: input.sourceText,
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

/**
 * The finished translation the workspace does not hold yet: a cache hit that
 * has not been written, or one whose write failed and waits for a retry.
 */
export function needsSave(state: TranslationState): ReadyTranslation | undefined {
  if (state.status !== 'ready') return undefined
  return state.persistence.kind === 'unsaved' || state.persistence.kind === 'failed' ? state : undefined
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

/** The workspace write is in flight. */
export function markSaving(state: TranslationState): TranslationState {
  if (state.status !== 'ready') return state
  return { ...state, persistence: { kind: 'saving' } }
}

/** A mirrored file now corresponds to this translation, so the source is current again. */
export function markSaved(state: TranslationState, file: string): TranslationState {
  if (state.status !== 'ready') return state
  return { ...state, persistence: { kind: 'saved', stale: false, dismissed: false, file } }
}

/** The write failed; the text stays readable and the status becomes a retry. */
export function markSaveFailed(state: TranslationState, message: string): TranslationState {
  if (state.status !== 'ready') return state
  return { ...state, persistence: { kind: 'failed', message } }
}

/**
 * What the status label beside the language shows. `null` means the label is
 * not part of this state at all (no finished translation, or a run still in
 * progress).
 */
export type SaveFlag =
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved', readonly file: string }
  | { readonly kind: 'retry', readonly message: string }

export function saveFlagOf(state: TranslationState): SaveFlag | null {
  if (state.status !== 'ready') return null
  switch (state.persistence.kind) {
    case 'unsaved': return null
    case 'saving': return { kind: 'saving' }
    case 'saved': return { kind: 'saved', file: state.persistence.file }
    case 'failed': return { kind: 'retry', message: state.persistence.message }
  }
}
