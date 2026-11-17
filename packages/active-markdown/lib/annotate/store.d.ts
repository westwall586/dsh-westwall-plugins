import { type Annotation, type AnnotationDraft, type PendingReview } from './schema.ts';
export declare const annotationDraftDomain: {
    name: string;
    version: number;
    layout: "per-record";
    invalidRecords: "backup-and-skip";
    tables: {
        drafts: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            sessionId: string;
            path: string;
            annotations: {
                id: string;
                seq: number;
                kind: "text" | "block";
                body: string;
                quote: string;
                prefix: string;
                suffix: string;
                startOffset: number;
                blockStartId: string;
                blockEndId: string;
                blockSignature: string;
                section: string;
                lineStart: number;
                lineEnd: number;
                createdAt: string;
            }[];
            nextSeq: number;
            createdAt: string;
            updatedAt: string;
            pending?: {
                roundId: string;
                draftAttachmentId: string;
                fileName: string;
                fileBytes: number;
                fileHash: string;
                sourceHash: string;
                annotations: {
                    id: string;
                    seq: number;
                    kind: "text" | "block";
                    body: string;
                    quote: string;
                    prefix: string;
                    suffix: string;
                    startOffset: number;
                    blockStartId: string;
                    blockEndId: string;
                    blockSignature: string;
                    section: string;
                    lineStart: number;
                    lineEnd: number;
                    createdAt: string;
                }[];
                feedback: string;
                createdAt: string;
            } | undefined;
        }>;
    };
};
/** 草稿表的最小接口；domain table 与测试内存表都满足它。 */
export interface AnnotationTable {
    get(key: string): AnnotationDraft | undefined;
    entries(): IterableIterator<[string, AnnotationDraft]>;
    put(key: string, value: AnnotationDraft): Promise<void>;
    delete(key: string): Promise<boolean>;
}
export interface AnnotationLoadInput {
    readonly sessionId: string;
    readonly path: string;
}
export interface AnnotationSaveInput {
    readonly sessionId: string;
    readonly path: string;
    readonly annotations: readonly Annotation[];
    readonly pending: PendingReview | null;
}
export type AnnotationSaveView = {
    readonly status: 'saved';
    readonly durable: boolean;
} | {
    readonly status: 'too-large';
    readonly bytes: number;
    readonly limit: number;
};
export interface AnnotationStore {
    load(input: AnnotationLoadInput): Promise<AnnotationDraft | null>;
    save(input: AnnotationSaveInput): Promise<AnnotationSaveView>;
    clear(input: AnnotationLoadInput): Promise<Record<string, never>>;
    pending(sessionId: string): Promise<AnnotationDraft[]>;
    /** 打开 domain 后先跑一次 30 天/20 份清理。 */
    prune(keepKey?: string): Promise<void>;
}
export interface AnnotationDomain {
    table(name: 'drafts'): AnnotationTable;
}
export interface AnnotationDomainFacility {
    open(spec: typeof annotationDraftDomain): Promise<AnnotationDomain>;
}
export interface AnnotationStoreDeps {
    readonly table: AnnotationTable;
    readonly durable: boolean;
    readonly now?: () => Date;
    /** `open` 把 domain 打不开的警告压在这里，测试可注入。 */
    readonly warn?: (message: string, error: unknown) => void;
}
/** 插件存储缺失或 domain 打不开时的进程内回落。 */
export declare function createMemoryAnnotationTable(): AnnotationTable;
export declare function createAnnotationStore(deps: AnnotationStoreDeps): AnnotationStore;
/**
 * 打开批注 domain；facility 缺失或 open 失败时退回内存，并保留一次警告。
 * 生命周期由 storageDomain facility 收尾，与翻译缓存一致。
 */
export declare function openAnnotationStore(facility: AnnotationDomainFacility | null, options?: {
    readonly now?: () => Date;
    readonly warn?: (message: string, error: unknown) => void;
}): Promise<AnnotationStore>;
