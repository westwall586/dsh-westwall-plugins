/** Thin React binding for the plugin-owned annotation store. */
import { useCallback, useSyncExternalStore } from 'react'
import {
  EMPTY_SNAPSHOT,
  type AnnotationSnapshot,
  type AnnotationStore,
  type DraftKey,
} from './store.ts'

const NO_SUBSCRIBE = (): void => {}

export function useAnnotationSnapshot(store: AnnotationStore, key: DraftKey | null): AnnotationSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (key === null ? NO_SUBSCRIBE : store.subscribe(key, listener)),
    [store, key],
  )
  const getSnapshot = useCallback(
    () => (key === null ? EMPTY_SNAPSHOT : store.getSnapshot(key)),
    [store, key],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
