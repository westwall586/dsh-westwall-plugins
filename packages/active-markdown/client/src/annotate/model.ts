/**
 * 批注的数据形状与纯草稿变换。编号只在追加时增大：删除不重排、不回收，
 * 撤销按原 id 与原 seq 放回。草稿身份由 store 生成，这里只处理一份文档的列表。
 */

export type AnnotationKind = 'text' | 'block'

/** 一条批注在原文里的位置；组件批注只有块 id 与标签。 */
export interface Anchor {
  quote: string
  /** 选区前 32 个 UTF-16 单元。 */
  prefix: string
  /** 选区后 32 个 UTF-16 单元。 */
  suffix: string
  /** 行拼接串里的偏移；组件批注为 0。 */
  startOffset: number
  blockStartId: string
  blockEndId: string
  /** 组件批注用；文本批注为空。 */
  blockSignature: string
  section: string
  lineStart: number
  lineEnd: number
}

export interface Annotation extends Anchor {
  id: string
  seq: number
  kind: AnnotationKind
  body: string
  createdAt: string
}

/** 新批注在分配 id/seq 之前的形状。 */
export type AnnotationInput = Omit<Annotation, 'id' | 'seq' | 'createdAt'>

/** 反馈附件的待发送记录；P2a-3 写入，本切片只读不写。 */
export interface PendingReview {
  roundId: string
  draftAttachmentId: string
  fileName: string
  fileBytes: number
  fileHash: string
  sourceHash: string
  annotations: Annotation[]
  feedback: string
  createdAt: string
}

/** 一份 session + 文档的草稿；Host 记录与客户端快照共用这个形状。 */
export interface AnnotationDraft {
  sessionId: string
  path: string
  annotations: Annotation[]
  /** 已用过的最大编号 + 1。 */
  nextSeq: number
  pending?: PendingReview
  createdAt: string
  updatedAt: string
}

export type AnnotationSaveView =
  | { status: 'saved', durable: boolean }
  | { status: 'too-large', bytes: number, limit: number }

export interface AddOptions {
  id: string
  seq: number
  createdAt: string
}

/** A draft-wide id that survives a reload; the random part is not user data. */
export function newAnnotationId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  if (random !== undefined) return random
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function maxSeq(annotations: readonly Annotation[]): number {
  let max = 0
  for (const annotation of annotations) {
    if (annotation.seq > max) max = annotation.seq
  }
  return max
}

/** 下一个编号：已用的高水位与当前最大值取大，保证删掉的编号不被重用。 */
export function nextSeq(annotations: readonly Annotation[], nextAvailable = 1): number {
  return Math.max(nextAvailable, maxSeq(annotations) + 1)
}

export function addAnnotation(
  annotations: readonly Annotation[],
  input: AnnotationInput,
  options: AddOptions,
): Annotation[] {
  return [...annotations, { ...input, id: options.id, seq: options.seq, createdAt: options.createdAt }]
}

export function editAnnotation(annotations: readonly Annotation[], id: string, body: string): Annotation[] {
  return annotations.map(annotation => (annotation.id === id ? { ...annotation, body } : annotation))
}

export function removeAnnotation(annotations: readonly Annotation[], id: string): Annotation[] {
  return annotations.filter(annotation => annotation.id !== id)
}

/** Undo puts the deleted entry back with its original id and seq. */
export function restoreAnnotation(annotations: readonly Annotation[], annotation: Annotation): Annotation[] {
  if (annotations.some(entry => entry.id === annotation.id)) return [...annotations]
  return [...annotations, annotation].sort((left, right) => left.seq - right.seq)
}
