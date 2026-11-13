import { hoursToJira } from './engine/dates.js';
import { weekdayCN } from './engine/query.js';
/** 凭据缺失错误的结构化识别（SPEC 场景 11：缺什么、如何补）。 */
export function credentialsIssue(error) {
    const text = error.message;
    if (text.includes('缺少 Jira 配置') || text.includes('jira.env') || text.includes('未返回当前用户')) {
        return { error: 'jira-credentials', message: `${text}。补齐后点「刷新」重新检测，无需重启 DSH。` };
    }
    return { error: 'network', message: text };
}
/** uncertain 必附人工核对指引（D-unclear：裸「不确定」不可判断成败，禁止再出现）。 */
export const UNCERTAIN_GUIDANCE = '（写入结果未确认——请点「到 Jira 核对」人工查证；确认未写入后可再次提交，提交前查重不会写重）';
/** monthStatus 原始行 → 月视图（未登记周末已被 monthStatus 过滤；有登记的周末/调休
 * exempt 行映射 full——月历 ✓ 口径，20261029；gap 计数不受影响）。 */
export function monthOverviewFrom(statusRows, today) {
    const rows = (Array.isArray(statusRows) ? statusRows : []);
    const mapped = rows.map(row => ({
        date: String(row.date),
        loggedHours: Number(row.hours ?? 0),
        gapHours: Number(row.gap_hours ?? 0),
        status: row.status === 'gap' ? 'gap' : 'full',
    }));
    return {
        today,
        month: today.slice(0, 7),
        rows: mapped,
        gapCount: mapped.filter(row => row.status === 'gap').length,
    };
}
/** dayRegistrations 原始输出 → 日详情视图（未解析名回退「未解析任务」；无素材 git 为 null）。 */
export function dayDetailFrom(regs) {
    const gitItems = regs.git ?? [];
    const git = gitItems.length === 0 ? null : {
        pushes: gitItems.reduce((sum, item) => sum + Number(item.push_count ?? 0), 0),
        commits: gitItems.reduce((sum, item) => sum + (item.commits?.length ?? 0), 0),
        byProject: gitItems.map(item => ({
            project: String(item.project ?? ''),
            commits: (item.commits ?? []).map(commit => ({ title: String(commit.title ?? ''), time: String(commit.time ?? '') })),
        })),
    };
    return {
        date: regs.date,
        workday: regs.workday,
        loggedHours: regs.hours,
        ...(regs.workday ? { gapHours: Math.max(0, Math.round((8 - regs.hours) * 100) / 100) } : {}),
        tasks: (regs.tasks ?? []).map(task => ({
            name: task.task_name || '未解析任务',
            entries: (task.entries ?? []).map(entry => ({
                timeRange: entry.time_range, hours: entry.hours, comment: entry.comment,
            })),
        })),
        git,
    };
}
/** 素材 + 解析结果 → 草稿文档（客户端表单数据源）；degradedNotes＝不可解析素材降级提示。 */
export function draftDocumentFrom(material, draft, elapsedMs, degradedNotes) {
    return {
        draftId: draft.draftId,
        date: material.date,
        loggedHours: material.loggedHours,
        gapHours: material.gapHours,
        elapsedMs,
        tasks: material.tasks.map(task => ({ id: task.id, name: task.name })),
        entries: draft.entries,
        ...(degradedNotes !== undefined && degradedNotes.length > 0 ? { degradedNotes } : {}),
    };
}
// ---- 20261015 Wave：暂存/素材扩展映射 ----
/** 暂存概要 → overview.outbox 载荷（存储缺席由调用方省略字段）。 */
export function outboxOverviewFrom(summary) {
    return {
        days: summary.map(row => ({ date: row.date, count: row.count })),
        total: summary.reduce((sum, row) => sum + row.count, 0),
    };
}
/** 素材记录 → 客户端视图（任务名＋文本；issue key 不出宿主）。记录缺席返回 undefined。 */
export function notesViewFrom(record) {
    if (record === undefined)
        return undefined;
    return record.items.map(item => ({ id: item.id, taskName: item.taskName, text: item.text }));
}
/** 请求条目＋任务引用＋失败形态 → 暂存条目（submitFlow 记账用）。 */
export function outboxEntryFrom(entry, ref, lastStatus, lastError) {
    return {
        issueKey: ref.key,
        taskName: ref.name,
        start: entry.start,
        end: entry.end,
        comment: entry.comment,
        userEdited: entry.userEdited,
        lastStatus,
        ...(lastError !== undefined ? { lastError } : {}),
    };
}
/** 暂存记录 → 回显草稿文档（openOutboxFlow 用）。idOf＝候选集内按 issueKey 定位 id
 * （调用方保证暂存任务已并入候选集）；elapsedMs 置 0（暂存回显无生成耗时）；
 * uncertain 条目附核对链接（issueUrl 既有例外口径）。 */
export function outboxToDraft(record, candidates, idOf, draftId, hours, server) {
    const entries = record.entries.map(entry => {
        const id = idOf(entry.issueKey);
        if (id === undefined)
            throw new Error('任务不在草稿候选集，请重新打开暂存');
        return {
            taskId: id,
            start: entry.start,
            end: entry.end,
            comment: entry.comment,
            userEdited: entry.userEdited,
            ...(entry.lastStatus !== undefined ? { lastStatus: entry.lastStatus } : {}),
            ...(entry.lastStatus === 'uncertain' ? { issueUrl: `${server.replace(/\/+$/, '')}/browse/${entry.issueKey}` } : {}),
        };
    });
    return {
        draftId,
        date: record.date,
        loggedHours: hours.loggedHours,
        gapHours: hours.gapHours,
        elapsedMs: 0,
        tasks: candidates,
        entries,
    };
}
function rangeHours(start, end) {
    const toMinutes = (value) => {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
        return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const a = toMinutes(start);
    const b = toMinutes(end);
    if (a === null || b === null || b <= a)
        throw new Error(`时间段非法（${start}–${end}），请修正后再提交`);
    return Math.round(((b - a) / 60) * 100) / 100;
}
/** 表单条目 → 引擎 jira-worklog-plan.v1 文档（today_existing_hours＝提交时现查值）。 */
export function submitRequestToPlanDoc(request, context, todayHours) {
    const entries = request.entries.map(entry => {
        const ref = context.taskKeys.get(entry.taskId);
        if (!ref)
            throw new Error('任务不在草稿候选集，请重新生成');
        const hours = rangeHours(entry.start, entry.end);
        return {
            issue_key: ref.key,
            task_name: ref.name,
            time_spent: hoursToJira(hours),
            hours,
            started: `${context.date}T${entry.start}:00.000+0800`,
            comment: entry.comment,
            comment_source: entry.userEdited ? 'user_confirmed' : 'model_draft',
            adjust_estimate: 'auto',
        };
    });
    return {
        schema: 'jira-worklog-plan.v1',
        target_date: context.date,
        today_existing_hours: todayHours,
        minimum_hours: 8,
        entries,
    };
}
/** 引擎日级回报 → 客户端回报（按请求序对回；uncertain 的 error 并入 reason 供展示，
 * 错误文本中的 issue key 形态串抹除——键不进客户端可见文本，T05 审读 F4）。 */
const ISSUE_KEY_TEXT_RE = /\b[A-Z][A-Z0-9]+-\d{1,6}\b/g;
function sanitizeDetail(value) {
    if (value === undefined || value === null)
        return undefined;
    // 已知误伤族（UTF-8/ISO-8601 等与键同形的技术词会被抹除）——仅 reason 展示退化，
    // 无泄漏无功能损害，按脱敏优先接受（T05 复审 R2 口径）
    return String(value).replace(ISSUE_KEY_TEXT_RE, '该任务');
}
export { sanitizeDetail };
export function submitReportFrom(dayReport, request, issueUrls) {
    const statusMap = {
        success: 'ok', partial: 'partial', failed: 'failed', blocked: 'blocked',
    };
    const status = statusMap[String(dayReport.status)] ?? 'failed';
    const results = (Array.isArray(dayReport.results) ? dayReport.results : [])
        .map((item, index) => {
        const req = request.entries[index];
        if (!req)
            return undefined;
        const isUncertain = item.status === 'uncertain';
        const detail = sanitizeDetail(item.reason ?? item.error);
        // uncertain 必附核对指引：有原始原因（网络错误等）则接在其后，无则给默认语义。
        const reason = isUncertain
            ? `${detail ?? '写入请求已发出，但回读未确认是否落库'}${UNCERTAIN_GUIDANCE}`
            : detail;
        const issueUrl = issueUrls?.[index];
        return {
            taskId: req.taskId,
            start: req.start,
            end: req.end,
            status: item.status,
            ...(reason !== undefined ? { reason } : {}),
            ...(issueUrl !== undefined ? { issueUrl } : {}),
        };
    })
        .filter((item) => item !== undefined);
    return {
        status,
        errors: (Array.isArray(dayReport.errors) ? dayReport.errors : []).map(error => String(error)),
        results,
    };
}
/** 可见性口径说明（随 ok 结果固定展示）。 */
export const PERMISSION_NOTE = '结果限于当前账号可浏览项目内的工时，受限记录不会出现。';
/** 工时条目 → 按日聚合（日期倒序、组内耗时升序、两位小数合计；issueUrl 为该任务浏览页）。 */
export function aggregateToDays(entries, server) {
    const base = server.replace(/\/+$/, '');
    const byDay = new Map();
    for (const entry of entries) {
        if (!byDay.has(entry.startedDate))
            byDay.set(entry.startedDate, []);
        byDay.get(entry.startedDate).push(entry);
    }
    return [...byDay.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, list]) => ({
        date,
        weekday: weekdayCN(date),
        totalHours: Math.round(list.reduce((sum, item) => sum + item.hours, 0) * 100) / 100,
        entries: [...list]
            .sort((a, b) => a.hours - b.hours)
            .map(item => ({
            hours: item.hours,
            issueKey: item.issueKey,
            issueUrl: `${base}/browse/${item.issueKey}`,
            summary: item.summary,
            comment: item.comment,
        })),
    }));
}
/** 回溯说明：含原查询窗口（三态表述）与回溯到的自然周。 */
export function fallbackNotice(displayName, name, from, to, week) {
    const window = from !== undefined && to !== undefined
        ? `${from} 至 ${to}`
        : from !== undefined
            ? `${from} 起`
            : to !== undefined
                ? `至 ${to}`
                : '不限日期';
    return `${displayName}（${name}）在${window}无日志，已回溯其最后活跃周 ${week.monday} 至 ${week.sunday}：`;
}
export function noLogsNotice(displayName, name) {
    return `${displayName}（${name}）无任何可见日志。`;
}
export function notFoundNotice(input) {
    return `查无此人：${input}（账号可能不存在、已禁用或离职）。`;
}
/** 同名歧义提示：列候选（登录 ID＋显示名）并引导登录 ID 重查；满 20 注明截断。 */
export function ambiguousNotice(input, candidates) {
    const list = candidates.map(item => `${item.name}（${item.displayName}）`).join('、');
    const cap = candidates.length >= 20 ? '（仅显示前 20）' : '';
    return `「${input}」匹配到多个账号${cap}：${list}。请用登录 ID 重查。`;
}
//# sourceMappingURL=service.js.map