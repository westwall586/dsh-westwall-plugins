/**
 * 批注草稿的存储结构。记录在 domain 打开的边界上用 zod 校验一次，Host 内部按
 * 推断出的类型使用。`pending` 与审阅轮次字段是后续附件/committer 切片的槽位：
 * 现在不写入，但结构已定，加切片时不需要改记录形状。
 */
import { z } from 'zod';
export const annotationKindSchema = z.enum(['text', 'block']);
export const annotationSchema = z.object({
    id: z.string().min(1),
    seq: z.number().int().positive(),
    kind: annotationKindSchema,
    body: z.string().min(1),
    quote: z.string().min(1),
    prefix: z.string(),
    suffix: z.string(),
    startOffset: z.number().int().nonnegative(),
    blockStartId: z.string().min(1),
    blockEndId: z.string().min(1),
    blockSignature: z.string(),
    section: z.string(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
    createdAt: z.string(),
}).strict();
export const pendingReviewSchema = z.object({
    roundId: z.string().min(1),
    draftAttachmentId: z.string(),
    fileName: z.string(),
    fileBytes: z.number().int().nonnegative(),
    fileHash: z.string(),
    sourceHash: z.string(),
    annotations: z.array(annotationSchema),
    feedback: z.string(),
    createdAt: z.string(),
}).strict();
export const annotationDraftSchema = z.object({
    sessionId: z.string().min(1),
    /** 文档的规范绝对路径，不是资源地址或工作区相对路径。 */
    path: z.string().min(1),
    annotations: z.array(annotationSchema),
    /** 已用过的最大编号 + 1，保证删掉的编号不回收。 */
    nextSeq: z.number().int().positive(),
    pending: pendingReviewSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
}).strict();
/** 发送成功后写在轮次快照旁的元数据；`annotations` 与 `feedback` 取冻结副本。 */
export const reviewRoundSchema = z.object({
    roundId: z.string().min(1),
    sessionId: z.string().min(1),
    sourcePath: z.string().min(1),
    sourceHash: z.string(),
    feedback: z.string(),
    sentText: z.string(),
    fileName: z.string(),
    annotations: z.array(annotationSchema),
    snapshotMissing: z.literal(true).optional(),
    createdAt: z.string(),
}).strict();
//# sourceMappingURL=schema.js.map