/** 包内的文档 store 公开面：身份、外壳、显式创建与 React 绑定。 */
export { composeId, crateId, refFrom, type DocumentIdentity, type DocumentKey, type DocumentRef } from './ref.ts'
export { createCrate, type Crate, type CrateDeps, type Disposal } from './crate.ts'
export { createDocumentStore, type DocumentStore, type DocumentStoreDeps, type NotesWriter } from './document.ts'
export { useNotes } from './binding.ts'
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
