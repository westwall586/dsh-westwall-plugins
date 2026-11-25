/**
 * React 绑定。body 用 useNotes 读一个 composer 的批注快照；文档级槽位（阅读位置、
 * 翻译运行、编辑草稿、视图偏好）归 crate，各自有一个读取点。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { EMPTY_SNAPSHOT, type AnnotationSnapshot } from './kernel/notes.ts'
import type { Edit } from './kernel/edit.ts'
import { EMPTY_COLLAPSED, type ViewPreferences } from './kernel/preferences.ts'
import type { TranslationRun } from './kernel/translation.ts'
import type { TranslationState } from '../translate/state.ts'
import type { EditState } from '../edit/state.ts'
import type { DocumentStore, NotesWriter } from './document.ts'
import type { DocumentRef } from './ref.ts'

const NO_SUBSCRIBE = (): void => {}
const NO_TRANSLATION: TranslationState = { status: 'idle' }
const NO_EDIT: EditState = { status: 'reading' }

/**
 * 订阅一个 composer 维度的批注快照。挂载只登记引用、卸载只归还引用：切页签时
 * body 卸载，但快照必须留下，所以这里不销毁任何状态。
 */
export function useNotes(
  store: DocumentStore,
  ref: DocumentRef | null,
): { writer: NotesWriter | null, snapshot: AnnotationSnapshot } {
  const writer = useMemo(
    () => (ref === null ? null : store.notesFor(ref.compose, ref.path, ref.session)),
    [store, ref],
  )
  useEffect(() => {
    if (ref === null) return
    store.mount(ref)
    return () => {
      store.unmount(ref)
      store.release(ref.compose, ref.path, ref.session)
    }
  }, [store, ref])
  const subscribe = useCallback(
    (listener: () => void) => (writer === null ? NO_SUBSCRIBE : writer.notes.subscribe(listener)),
    [writer],
  )
  const getSnapshot = useCallback(
    () => (writer === null ? EMPTY_SNAPSHOT : writer.notes.getSnapshot()),
    [writer],
  )
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { writer, snapshot }
}

/**
 * Subscribe the body to its file's translation run. Unmounting only drops the
 * subscription: the run belongs to the file, so a tab switch must not end it.
 */
export function useTranslation(
  store: DocumentStore,
  session: string | undefined,
  path: string | undefined,
): { run: TranslationRun | null, state: TranslationState } {
  const run = useMemo(
    () => (session === undefined || path === undefined ? null : store.runFor(session, path)),
    [store, session, path],
  )
  const subscribe = useCallback(
    (listener: () => void) => (run === null ? NO_SUBSCRIBE : run.subscribe(listener)),
    [run],
  )
  const getSnapshot = useCallback(() => (run === null ? NO_TRANSLATION : run.getState()), [run])
  return { run, state: useSyncExternalStore(subscribe, getSnapshot, getSnapshot) }
}

/**
 * Subscribe the body to its file's edit draft. Unmounting only drops the
 * subscription: the draft belongs to the document, so a tab switch must keep it.
 */
export function useEdit(
  store: DocumentStore,
  session: string | undefined,
  path: string | undefined,
): { edit: Edit | null, state: EditState } {
  const edit = useMemo(
    () => (session === undefined || path === undefined ? null : store.editFor(session, path)),
    [store, session, path],
  )
  const subscribe = useCallback(
    (listener: () => void) => (edit === null ? NO_SUBSCRIBE : edit.subscribe(listener)),
    [edit],
  )
  const getSnapshot = useCallback(() => (edit === null ? NO_EDIT : edit.getState()), [edit])
  return { edit, state: useSyncExternalStore(subscribe, getSnapshot, getSnapshot) }
}

/** Subscribe the body to its file's view preferences, for the folder folds and the update cursor. */
export function useViewPreferences(
  store: DocumentStore,
  session: string | undefined,
  path: string | undefined,
): {
  preferences: ViewPreferences | null
  collapsed: ReadonlySet<string>
  updateCursor: number
} {
  const preferences = useMemo(
    () => (session === undefined || path === undefined ? null : store.viewFor(session, path)),
    [store, session, path],
  )
  const subscribe = useCallback(
    (listener: () => void) => (preferences === null ? NO_SUBSCRIBE : preferences.subscribe(listener)),
    [preferences],
  )
  const getCollapsed = useCallback(
    () => (preferences === null ? EMPTY_COLLAPSED : preferences.getCollapsed()),
    [preferences],
  )
  const getCursor = useCallback(
    () => (preferences === null ? 0 : preferences.getUpdateCursor()),
    [preferences],
  )
  const collapsed = useSyncExternalStore(subscribe, getCollapsed, getCollapsed)
  const updateCursor = useSyncExternalStore(subscribe, getCursor, getCursor)
  return { preferences, collapsed, updateCursor }
}

