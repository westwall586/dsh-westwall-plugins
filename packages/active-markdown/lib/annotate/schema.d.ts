/**
 * 批注草稿的存储结构。记录在 domain 打开的边界上用 zod 校验一次，Host 内部按
 * 推断出的类型使用。`pending` 与审阅轮次字段是后续附件/committer 切片的槽位：
 * 现在不写入，但结构已定，加切片时不需要改记录形状。
 */
import { z } from 'zod';
export declare const annotationKindSchema: z.ZodEnum<{
    text: "text";
    block: "block";
}>;
export declare const annotationSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    kind: z.ZodEnum<{
        text: "text";
        block: "block";
    }>;
    body: z.ZodString;
    quote: z.ZodString;
    prefix: z.ZodString;
    suffix: z.ZodString;
    startOffset: z.ZodNumber;
    blockStartId: z.ZodString;
    blockEndId: z.ZodString;
    blockSignature: z.ZodString;
    section: z.ZodString;
    lineStart: z.ZodNumber;
    lineEnd: z.ZodNumber;
    createdAt: z.ZodString;
}, z.core.$strict>;
export declare const pendingReviewSchema: z.ZodObject<{
    roundId: z.ZodString;
    draftAttachmentId: z.ZodString;
    fileName: z.ZodString;
    fileBytes: z.ZodNumber;
    fileHash: z.ZodString;
    sourceHash: z.ZodString;
    annotations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        kind: z.ZodEnum<{
            text: "text";
            block: "block";
        }>;
        body: z.ZodString;
        quote: z.ZodString;
        prefix: z.ZodString;
        suffix: z.ZodString;
        startOffset: z.ZodNumber;
        blockStartId: z.ZodString;
        blockEndId: z.ZodString;
        blockSignature: z.ZodString;
        section: z.ZodString;
        lineStart: z.ZodNumber;
        lineEnd: z.ZodNumber;
        createdAt: z.ZodString;
    }, z.core.$strict>>;
    feedback: z.ZodString;
    createdAt: z.ZodString;
}, z.core.$strict>;
export declare const annotationDraftSchema: z.ZodObject<{
    sessionId: z.ZodString;
    path: z.ZodString;
    annotations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        kind: z.ZodEnum<{
            text: "text";
            block: "block";
        }>;
        body: z.ZodString;
        quote: z.ZodString;
        prefix: z.ZodString;
        suffix: z.ZodString;
        startOffset: z.ZodNumber;
        blockStartId: z.ZodString;
        blockEndId: z.ZodString;
        blockSignature: z.ZodString;
        section: z.ZodString;
        lineStart: z.ZodNumber;
        lineEnd: z.ZodNumber;
        createdAt: z.ZodString;
    }, z.core.$strict>>;
    nextSeq: z.ZodNumber;
    pending: z.ZodOptional<z.ZodObject<{
        roundId: z.ZodString;
        draftAttachmentId: z.ZodString;
        fileName: z.ZodString;
        fileBytes: z.ZodNumber;
        fileHash: z.ZodString;
        sourceHash: z.ZodString;
        annotations: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            seq: z.ZodNumber;
            kind: z.ZodEnum<{
                text: "text";
                block: "block";
            }>;
            body: z.ZodString;
            quote: z.ZodString;
            prefix: z.ZodString;
            suffix: z.ZodString;
            startOffset: z.ZodNumber;
            blockStartId: z.ZodString;
            blockEndId: z.ZodString;
            blockSignature: z.ZodString;
            section: z.ZodString;
            lineStart: z.ZodNumber;
            lineEnd: z.ZodNumber;
            createdAt: z.ZodString;
        }, z.core.$strict>>;
        feedback: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strict>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strict>;
export type Annotation = z.infer<typeof annotationSchema>;
export type PendingReview = z.infer<typeof pendingReviewSchema>;
export type AnnotationDraft = z.infer<typeof annotationDraftSchema>;
/** 发送成功后写在轮次快照旁的元数据；`annotations` 与 `feedback` 取冻结副本。 */
export declare const reviewRoundSchema: z.ZodObject<{
    roundId: z.ZodString;
    sessionId: z.ZodString;
    sourcePath: z.ZodString;
    sourceHash: z.ZodString;
    feedback: z.ZodString;
    sentText: z.ZodString;
    fileName: z.ZodString;
    annotations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        kind: z.ZodEnum<{
            text: "text";
            block: "block";
        }>;
        body: z.ZodString;
        quote: z.ZodString;
        prefix: z.ZodString;
        suffix: z.ZodString;
        startOffset: z.ZodNumber;
        blockStartId: z.ZodString;
        blockEndId: z.ZodString;
        blockSignature: z.ZodString;
        section: z.ZodString;
        lineStart: z.ZodNumber;
        lineEnd: z.ZodNumber;
        createdAt: z.ZodString;
    }, z.core.$strict>>;
    snapshotMissing: z.ZodOptional<z.ZodLiteral<true>>;
    createdAt: z.ZodString;
}, z.core.$strict>;
export type ReviewRound = z.infer<typeof reviewRoundSchema>;
