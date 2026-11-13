// 存储域仓库（PLAN「存储域仓库」单元，20261015 Wave）：outbox_day / notes_day 两表
// 操作的唯一封装。形态仿 dsh-feed-reader src/store/domain.ts——defineDomain +
// domainTable + zod 校验；createWorklogsStore 纯函数装配（内存表可离线测），
// openWorklogsStore 为生产路径（要求 inject(['storageDomain']) 声明内上下文）。
// 凭据不落库；issueKey 只在宿主存储与流程内存（脱敏基线，键不出客户端载荷）。
import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const outboxEntrySchema = z.object({
    issueKey: z.string().min(1),
    taskName: z.string(),
    start: z.string().regex(TIME_RE),
    end: z.string().regex(TIME_RE),
    comment: z.string(),
    userEdited: z.boolean(),
    lastStatus: z.enum(['failed', 'uncertain']),
    lastError: z.string().optional(),
}).strict();
const outboxDaySchema = z.object({
    date: z.string().regex(DAY_RE),
    entries: z.array(outboxEntrySchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
}).strict();
const noteEntrySchema = z.object({
    id: z.string().min(1),
    issueKey: z.string().min(1),
    taskName: z.string(),
    text: z.string(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
}).strict();
const notesDaySchema = z.object({
    date: z.string().regex(DAY_RE),
    items: z.array(noteEntrySchema),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
}).strict();
export const jiraWorklogsDomain = defineDomain({
    name: 'dsh_jira_worklogs',
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: {
        outbox_day: domainTable(outboxDaySchema),
        notes_day: domainTable(notesDaySchema),
    },
});
/** 核心包装逻辑（纯函数式装配，内存表即可测——feed-reader 同构）。 */
export function createWorklogsStore(tables) {
    const { outbox_day, notes_day } = tables;
    return {
        getOutbox: date => outbox_day.get(date),
        async putOutbox(record) { await outbox_day.put(record.date, record); },
        async deleteOutbox(date) { return outbox_day.delete(date); },
        outboxSummary() {
            return [...outbox_day.entries()]
                .map(([date, record]) => ({ date, count: record.entries.length }))
                .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        },
        getNotes: date => notes_day.get(date),
        async putNotes(record) { await notes_day.put(record.date, record); },
        async close() { },
    };
}
/** 生产路径：调用方（host apply）须以 inject(['storageDomain']) 声明的上下文调用。 */
export async function openWorklogsStore(ctx) {
    if (process.env.JWL_DEBUG_STORE_FAIL === 'open') {
        throw new Error('存储域调试故障（JWL_DEBUG_STORE_FAIL=open，验收注入——存储缺席降级形态）');
    }
    const facility = ctx.storageDomain;
    if (facility === undefined) {
        throw new Error("storageDomain 服务不可用：调用方须声明 inject(['storageDomain']) 后传入该上下文");
    }
    const domain = await facility.open(jiraWorklogsDomain);
    const outbox_day = domain.table('outbox_day');
    const notes_day = domain.table('notes_day');
    const core = createWorklogsStore({ outbox_day, notes_day });
    return {
        ...core,
        async close() { await domain.close(); },
    };
}
//# sourceMappingURL=domain.js.map