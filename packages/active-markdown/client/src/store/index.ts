/** 包内的文档 store 公开面：身份、外壳、显式创建与 React 绑定。 */
export { composeId, crateId, refFrom, type DocumentIdentity, type DocumentKey, type DocumentRef } from './ref.ts'
export { createCrate, type Crate, type CrateDeps, type Disposal } from './crate.ts'
export { createDocumentStore, type DocumentStore, type DocumentStoreDeps, type NotesWriter } from './document.ts'
export { useEdit, useNotes, useTranslation, useViewPreferences } from './binding.ts'
export { type Edit, type EditRestoreLine, type EditSlot } from './kernel/edit.ts'
export {
  FALLBACK_DESCRIBE,
  createTranslationRun,
  type RunKey,
  type RunSource,
  type TranslationRun,
  type TranslationRunDeps,
} from './kernel/translation.ts'
export { type Reading, type ReadingSlot } from './kernel/reading.ts'
export { type View } from './kernel/view.ts'
export {
  EMPTY_SNAPSHOT,
  type AnnotationCommit,
  type AnnotationPersistence,
  type AnnotationSnapshot,
  type AnnotationWrite,
  type AnnotationWriteOptions,
  type Notes,
  type NotesPort,
  type PendingRefusal,
  type PendingWrite,
} from './kernel/notes.ts'
