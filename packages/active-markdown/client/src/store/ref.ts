/**
 * 文档身份。`session` 授权文件操作（读、翻译、保存、编辑），`compose` 归属批注
 * 草稿（草稿最终变成输入框里的附件），`path` 是文档本身。crate 按前三者的
 * 前两项键控，`compose` 是 crate 内的维度。
 */
export interface DocumentRef {
  /** 文件所属会话，授权读、翻译、保存、编辑。 */
  readonly session: string
  /** 规范绝对路径。 */
  readonly path: string
  /** 输入框所在会话，批注草稿归它。 */
  readonly compose: string
}

/** crate 的键：文件身份，不含 composer。 */
export type DocumentKey = Pick<DocumentRef, 'session' | 'path'>

/** 构造点只接身份字段，避免与文档状态（滚动、草稿）混在一起。 */
export interface DocumentIdentity {
  session: string
  compose: string
  path: string
}

export function refFrom(identity: DocumentIdentity): DocumentRef {
  return Object.freeze({ session: identity.session, compose: identity.compose, path: identity.path })
}

/** 规范绝对路径可含换行，用 NUL 分隔不会与路径或会话 id 相撞。 */
export function crateId(key: DocumentKey): string {
  return `${key.session}\u0000${key.path}`
}

/** 同一 crate 内的 composer 维度。 */
export function composeId(key: DocumentKey, compose: string): string {
  return `${crateId(key)}\u0000${compose}`
}
