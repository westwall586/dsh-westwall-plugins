import { sameText } from './model.ts'

export interface EditSession {
  readonly draft: string
  readonly savedText: string
  readonly version: string
  readonly entryLine: number
  readonly cursorLine: number
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

export type EditEvent =
  | { type: 'enter', text: string, version: string, line: number }
  | { type: 'change', text: string, cursorLine: number }
  | { type: 'save' }
  | { type: 'saved' }
  | { type: 'stale' }
  | { type: 'write-failed' }
  | { type: 'conflict-back' }
  | { type: 'external', text: string, version: string }
  | { type: 'external-dismiss' }
  | { type: 'conflict-close' }
  | { type: 'exit' }

const READING: EditState = { status: 'reading' }

export function dirty(session: EditSession): boolean {
  return !sameText(session.draft, session.savedText)
}

export function sessionOf(state: EditState): EditSession | undefined {
  return state.status === 'reading' ? undefined : state.session
}

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
