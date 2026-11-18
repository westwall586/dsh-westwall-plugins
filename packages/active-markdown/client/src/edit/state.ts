/**
 * The edit session as a pure state machine. The document itself stays in the
 * Body; this module only owns the draft, the version a save guards against,
 * and the two interruptions that need a decision (a stale write and an
 * external revision).
 */
import { sameText } from './model.ts'

/** Everything below `reading` is the edit phase; the draft exists only there. */
export interface EditSession {
  /** The text the editor holds right now. */
  readonly draft: string
  /** The last text a successful save or adoption made current. */
  readonly savedText: string
  /** The version a guarded save sends; a save-as does not replace it. */
  readonly version: string
  /** The source line the reader was at, kept as the restore fallback. */
  readonly entryLine: number
  /** The latest cursor line reported by the editor. */
  readonly cursorLine: number
  /** A revision arrived while the draft was dirty. */
  readonly external: boolean
}

export interface EditConflict {
  readonly reason: 'stale'
}

export type EditState =
  | { readonly status: 'reading' }
  | { readonly status: 'editing', readonly session: EditSession }
  | { readonly status: 'saving', readonly session: EditSession }
  | { readonly status: 'conflict', readonly session: EditSession, readonly conflict: EditConflict }

/** Where a save wrote: back to the original file, or beside it. */
export type SaveTarget = 'original' | 'copy'

export type EditEvent =
  | { type: 'enter', text: string, version: string, line: number }
  | { type: 'change', text: string, cursorLine: number }
  | { type: 'save' }
  | { type: 'saved', target: SaveTarget, text: string, version: string }
  | { type: 'stale' }
  | { type: 'write-failed' }
  | { type: 'conflict-back' }
  | { type: 'external', text: string, version: string }
  | { type: 'external-dismiss' }
  | { type: 'conflict-close' }
  | { type: 'exit' }

const READING: EditState = { status: 'reading' }

/** True when the draft differs from what is on disk, line endings aside. */
export function dirty(session: EditSession): boolean {
  return !sameText(session.draft, session.savedText)
}

/** The session behind either interruptible phase, or undefined in reading. */
export function sessionOf(state: EditState): EditSession | undefined {
  return state.status === 'reading' ? undefined : state.session
}

/**
 * Apply one event. `external` adopts a clean draft wholesale but never moves
 * the version of a dirty one; `stale` keeps the old version inside the
 * conflict; `saved` always returns to reading, and the Body takes the text.
 */
export function editReduce(state: EditState, event: EditEvent): EditState {
  switch (event.type) {
    case 'enter':
      return {
        status: 'editing',
        session: {
          draft: event.text,
          savedText: event.text,
          version: event.version,
          entryLine: event.line,
          cursorLine: event.line,
          external: false,
        },
      }
    case 'change':
      if (state.status !== 'editing') return state
      return { ...state, session: { ...state.session, draft: event.text, cursorLine: event.cursorLine } }
    case 'save':
      if (state.status === 'editing' || state.status === 'conflict') {
        return { status: 'saving', session: state.session }
      }
      return state
    case 'saved':
      // A save-as leaves the original on disk untouched, but either way the
      // edit phase ends: the Body decides what the document view shows.
      return READING
    case 'stale':
      if (state.status !== 'saving') return state
      return { status: 'conflict', session: state.session, conflict: { reason: 'stale' } }
    case 'write-failed':
      if (state.status !== 'saving') return state
      return { status: 'editing', session: state.session }
    case 'conflict-back':
      if (state.status !== 'saving') return state
      return { status: 'conflict', session: state.session, conflict: { reason: 'stale' } }
    case 'external': {
      if (state.status === 'reading') return state
      const session = state.session
      if (sameText(session.draft, session.savedText)) {
        return {
          ...state,
          session: {
            ...session,
            draft: event.text,
            savedText: event.text,
            version: event.version,
            external: false,
          },
        }
      }
      return { ...state, session: { ...session, external: true } }
    }
    case 'external-dismiss':
      if (state.status === 'reading') return state
      return { ...state, session: { ...state.session, external: false } }
    case 'conflict-close':
      if (state.status !== 'conflict') return state
      return { status: 'editing', session: state.session }
    case 'exit':
      return READING
  }
}
