export declare const MAX_DRAFT_BYTES: number;
export declare const MAX_DRAFTS = 20;
export declare const DRAFT_TTL_MS: number;
/** Document keys double as backend document names; hex is a safe subset. */
export declare const DRAFT_KEY_PATTERN: RegExp;
export type AnnotationErrorCode = 'invalid-request' | 'read-failed' | 'write-failed';
/** 批注存储的边界失败；由服务层映射成 Remote 错误码。 */
export declare class AnnotationError extends Error {
    readonly code: AnnotationErrorCode;
    constructor(code: AnnotationErrorCode, message: string);
}
export declare function requireSessionId(sessionId: unknown): string;
/**
 * 草稿只认规范绝对路径。客户端从 `readBytes` 的 `absolutePath` 取值；相对路径
 * 会随工作目录变化，不能让两份草稿抢同一个键。
 */
export declare function canonicalDocumentPath(path: unknown): string;
/** 一份草稿的 domain 记录键。 */
export declare function draftKeyOf(sessionId: unknown, path: unknown): string;
