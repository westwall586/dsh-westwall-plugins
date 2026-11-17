import { type ModelSelection } from './request.ts';
export interface CachedMeta {
    readonly sourceHash: string;
    readonly sourceLines: number;
    readonly translatedLines: number;
    readonly lang: string;
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly extraInstructionHash: string;
    readonly aligned: boolean;
    readonly cachedAt: string;
}
export interface CachedTranslation {
    readonly text: string;
    readonly meta: CachedMeta;
}
export interface CacheGetInput {
    readonly text: string;
    readonly lang: string;
    readonly provider?: string;
    readonly model?: string;
    readonly promptVersion: string;
    readonly translateComments: boolean;
    readonly extraInstruction?: string;
}
export interface CachePutInput extends CacheGetInput {
    readonly translated: string;
    readonly aligned: boolean;
    readonly sourceLines: number;
    readonly translatedLines: number;
}
/** 空对象是 wire 上的成功回执；写入失败返回它并只记录警告，校验失败仍抛类型化错误。 */
export type CachePutView = Record<string, never>;
/** 一块同步读、异步写的键值表；插件存储的 domain table 就是这个形状。 */
export interface CacheTable {
    get(key: string): CachedTranslation | undefined;
    put(key: string, value: CachedTranslation): Promise<void>;
}
export interface CacheDomain {
    table(name: 'translations'): CacheTable;
}
export interface StorageDomainFacility {
    open(spec: typeof translationCacheDomain): Promise<CacheDomain>;
}
export declare const translationCacheDomain: {
    name: string;
    version: number;
    layout: "per-record";
    invalidRecords: "backup-and-skip";
    tables: {
        translations: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, CachedTranslation>;
    };
};
export interface CacheStore {
    get(key: string): CachedTranslation | undefined;
    put(key: string, value: CachedTranslation): Promise<void>;
}
export interface CacheDeps {
    readonly store: CacheStore;
    readonly readDefault: () => ModelSelection | null;
    readonly now?: () => Date;
}
export interface TranslationCache {
    cacheGet(input: CacheGetInput): Promise<CachedTranslation | null>;
    cachePut(input: CachePutInput): Promise<CachePutView>;
}
/** 进程内回落；没有插件存储时，本次运行内仍可命中。 */
export declare function createMemoryCacheStore(): CacheStore;
/**
 * 打开插件存储里的缓存 domain。`storageDomain` 不在（或 domain 打不开）时退回
 * 内存，翻译本身不受影响；domain 的生命周期由 facility 在插件卸载时收尾。
 */
export declare function openCacheStore(facility: StorageDomainFacility | null): Promise<CacheStore>;
export declare function createTranslationCache(deps: CacheDeps): TranslationCache;
