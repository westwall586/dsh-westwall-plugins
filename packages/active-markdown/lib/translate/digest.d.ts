export declare function normalizeSource(text: string): string;
export declare function countSourceLines(text: string): number;
export declare function sha256Hex(text: string): string;
export declare function sha1Hex(text: string): string;
/** 空串表示「没有补充要求」，这样普通结果永远不会回答一次特调查询。 */
export declare function extraInstructionHash(extraInstruction: string | undefined): string;
export interface CacheKeyInput {
    readonly sourceText: string;
    readonly lang: string;
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    /** Comments on and comments off produce different translations, so they never share a key. */
    readonly translateComments: boolean;
    readonly extraInstruction?: string;
}
/**
 * 存储后端的记录键就是文件名（per-record 布局只接受 `[a-zA-Z0-9_-]+`），
 * 而内容身份里有 `:` 与 provider/model 自带的 `.`，所以拼好之后再取一次
 * 摘要当键。拆开看得懂的身份留在元数据里，不靠文件名承载。
 */
export declare function cacheKeyOf(input: CacheKeyInput): string;
