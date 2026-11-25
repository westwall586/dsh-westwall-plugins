/**
 * React 绑定。body 用 useNotes 读一个 composer 的批注快照；文档级槽位（阅读位置、
 * 翻译运行、编辑草稿、视图偏好）归 crate，后续步骤按真实需要在这里加读取点。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { EMPTY_SNAPSHOT, type AnnotationSnapshot } from './kernel/notes.ts'
import type { DocumentStore, NotesWriter } from './document.ts'
import type { DocumentRef } from './ref.ts'

const NO_SUBSCRIBE = (): void => {}

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
