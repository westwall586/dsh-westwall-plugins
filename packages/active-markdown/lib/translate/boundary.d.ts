export declare const MAX_TRANSLATED_BYTES: number;
/**
 * 落盘比缓存宽松：缓存是「可丢的便利」，超限只是不命中；译文文件是读者要的
 * 结果，能翻出来就该能存。上限仍有，免得一次误写把磁盘撑爆。
 */
export declare const MAX_SAVED_BYTES: number;
export declare function requireText(value: unknown, what: string): string;
export declare function requireTranslatedText(value: unknown): string;
/** 写工作区的译文；比自动缓存的 4 MiB 边界宽。 */
export declare function requireSavedText(value: unknown): string;
export declare function requireLanguage(value: unknown): string;
export declare function requireSessionId(value: unknown): string;
export declare function errorText(error: unknown): string;
