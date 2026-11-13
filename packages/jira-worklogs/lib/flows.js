// Host 流程层（PLAN Host 服务单元的可测编排层，2026-09-24 Wave）：远程方法的
// 流程编排——依赖注入（配置/客户端工厂/模型选择/流式通道/草稿缓存/存储域），index.ts
// 只做 ctx 接线与描述符（沿项目惯例：运行时胶水不进 node --test）。
// 20261015 Wave：submitFlow 出口暂存记账（F-1 全分支）、openOutbox/saveNotes/dismissOutbox
// 三新 flow、overviewFlow outbox 概要、dayDetailFlow 素材与候选集、generateFlow 素材
// 取材与存在性核查、JWL_DEBUG_STORE_FAIL=io 后门；worklogs/candidates 均可选注入——
// 存储缺席按降级口径（不阻断既有能力，SPEC R8）。
import { JQL, dayRegistrations, issueSummary, monthStatus, plan, worklogDailySummary } from './engine/plan.js';
import { submitDay } from './engine/submit.js';
import { collectWorklogs, lastActiveWeek, resolveUser } from './engine/query.js';
import { HttpError } from './engine/types.js';
import { ISSUE_KEY_RE, buildMaterial, dropUnresolvableNoteTasks, parseDraft, runGeneration, } from './generate.js';
import { PERMISSION_NOTE, aggregateToDays, ambiguousNotice, credentialsIssue, dayDetailFrom, draftDocumentFrom, fallbackNotice, monthOverviewFrom, noLogsNotice, notFoundNotice, notesViewFrom, outboxEntryFrom, outboxOverviewFrom, outboxToDraft, sanitizeDetail, submitReportFrom, submitRequestToPlanDoc, } from './service.js';
const CREDENTIALS_GUIDE = 'Jira 地址、账号与密码尚未配置，请到 插件页 → Jira 工时记录 详情页补齐，保存后回本窗口刷新即可。';
async function storeIo(op) {
    if (process.env.JWL_DEBUG_STORE_FAIL === 'io') {
        throw new Error('存储域调试故障（JWL_DEBUG_STORE_FAIL=io，验收注入）');
    }
    return await op();
}
/** 东八区今天（YYYY-MM-DD）。 */
export function todayKeyEast8() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
function emptyMonth(today) {
    return { today, month: today.slice(0, 7), rows: [], gapCount: 0 };
}
/** outbox 概要覆层：缺席置 outboxUnavailable（提示条降级提示——终审 F-1）；读取失败置
 * outboxError（月历视图本体不受影响）；空暂存省略字段。 */
async function withOutbox(deps, view) {
    if (!deps.worklogs)
        return { ...view, outboxUnavailable: true };
    try {
        const summary = await storeIo(() => deps.worklogs.outboxSummary());
        return summary.length > 0 ? { ...view, outbox: outboxOverviewFrom(summary) } : view;
    }
    catch {
        return { ...view, outboxError: true };
    }
}
/** 月视图：纯配置预检缺失 → 引导态；查询期认证拒绝/凭据失效 → 结构化错误；其余原样抛出。 */
export async function overviewFlow(deps, today = todayKeyEast8()) {
    if (!deps.jiraConfigured()) {
        return withOutbox(deps, { ...emptyMonth(today), error: 'jira-credentials', message: CREDENTIALS_GUIDE });
    }
    const config = deps.engineConfig();
    try {
        const rows = await monthStatus(deps.makeClient(config.jira), today);
        return withOutbox(deps, monthOverviewFrom(rows, today));
    }
    catch (error) {
        // 认证拒绝＝凭据口径（SPEC「权限不足按凭据缺失口径处理」；T05 审读 F2）
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
            return withOutbox(deps, {
                ...emptyMonth(today),
                error: 'jira-credentials',
                message: 'Jira 认证失败（401/403，账号或密码无效），请到 插件页 → Jira 工时记录 详情页修正，保存后回本窗口刷新即可。',
            });
        }
        const issue = credentialsIssue(error);
        if (issue.error !== 'jira-credentials')
            throw error;
        return withOutbox(deps, { ...emptyMonth(today), error: issue.error, message: issue.message });
    }
}
/** 候选集构建：watched JQL ∪ 当日已登记 ∪ extra（素材/暂存任务快照，键→名）。
 * 空/键形名回退「未解析任务」（generate 同构）；产出宿主侧 id 映射与客户端候选视图。 */
async function candidateSets(client, regs, extra) {
    const keyName = new Map();
    for (const raw of await client.searchAll(JQL)) {
        const item = issueSummary(raw);
        const key = String(item.issue_key ?? '');
        if (key)
            keyName.set(key, String(item.summary ?? ''));
    }
    for (const task of regs.tasks) {
        if (task.task_name)
            keyName.set(task.issue_key, task.task_name);
    }
    for (const [key, name] of extra)
        keyName.set(key, name);
    const map = new Map();
    const view = [];
    let id = 1;
    for (const [key, rawName] of keyName) {
        const name = rawName && !ISSUE_KEY_RE.test(rawName) ? rawName : '未解析任务';
        map.set(id, { key, name });
        view.push({ id, name });
        id += 1;
    }
    return { map, view };
}
/** 日详情：全量登记 + 名称解析 + 单日 Git + 素材读取 + 候选集构建与映射注册。 */
export async function dayDetailFlow(deps, date) {
    const config = deps.engineConfig();
    const client = deps.makeClient(config.jira);
    const regs = await dayRegistrations(client, config.gitlab, config.repoFilter, date);
    const view = dayDetailFrom(regs);
    const extra = new Map();
    let notesRecord;
    if (deps.worklogs) {
        try {
            notesRecord = await storeIo(() => deps.worklogs.getNotes(date));
            for (const item of notesRecord?.items ?? [])
                extra.set(item.issueKey, item.taskName);
        }
        catch {
            view.notesError = true;
            notesRecord = undefined;
        }
    }
    const { map, view: candidates } = await candidateSets(client, regs, extra);
    deps.candidates?.put(date, map);
    // 存储缺席：candidates 省略（素材区整体降级提示、下拉不渲染——PLAN 失败表行 1，终审 F-1）
    if (deps.worklogs)
        view.candidates = candidates;
    if (notesRecord !== undefined)
        view.notes = notesViewFrom(notesRecord);
    return view;
}
/** 平台错误分类学精确匹配（HarnessError 自述「route on code, never by parsing message」；
 * 文案仅作 code 丢失时的兜底二次校验。INVALID_CREDENTIAL＝已存凭据非法，恢复动作与
 * MISSING_CREDENTIAL 同类——检查平台默认模型（T05 复审 R1）。 */
const ROUTE_CODE_RE = /\b(NO_ADAPTER|MISSING_CREDENTIAL|INVALID_CREDENTIAL)\b/;
function messageOf(error) {
    const record = error;
    return `${String(record?.code ?? '')} ${String(record?.message ?? record ?? error)}`;
}
/** 路由类失败统一加固定前缀（客户端按「默认模型路由不可用」分类，S11；m5 契约常量）。 */
function rethrowRouteClass(error) {
    if (ROUTE_CODE_RE.test(messageOf(error))) {
        throw new Error(`默认模型路由不可用：${messageOf(error).trim()}（请到平台设置检查默认模型后再来重试）`);
    }
    throw error;
}
/** 生成：plan 全量素材 → 素材读取（缺席/读失败降级空）→ 存在性核查 → 脱敏素材 →
 * 一次性模型调用 → fail-closed 解析（原话分档）→ 草稿入缓存。 */
export async function generateFlow(deps, date, signal) {
    if (process.env.JWL_DEBUG_PARSE_FAIL === '1') {
        throw new Error('模型输出无法解析为工时草稿（调试注入 JWL_DEBUG_PARSE_FAIL=1，未写入任何内容）');
    }
    const config = deps.engineConfig();
    const client = deps.makeClient(config.jira);
    const planOut = await plan(client, date, {
        checkDays: 5,
        gitInstances: config.gitlab,
        repoFilter: config.repoFilter,
    });
    const regs = await dayRegistrations(client, [], [], date);
    let notes = [];
    if (deps.worklogs) {
        try {
            notes = (await storeIo(() => deps.worklogs.getNotes(date)))?.items ?? [];
        }
        catch {
            notes = []; // 读失败降级空素材（存储故障不阻断生成，SPEC R8）
        }
    }
    const built = buildMaterial(planOut, regs, notes);
    // 存在性核查（仅素材强制并入键）：existingKeys＝watched ∪ 当日已登记 ∪ 核查命中
    //（T03 review F3 不变量——watched/已登记恒在集内，不被误杀）
    const planKeys = new Set((planOut.candidates ?? []).map(item => String(item.issue_key ?? '')));
    const regKeys = new Set(regs.tasks.map(task => task.issue_key));
    const forcedKeys = [...new Set(notes.map(note => String(note.issueKey ?? '')))]
        .filter(key => key && !planKeys.has(key) && !regKeys.has(key));
    let material = built;
    let degradedNotes = [];
    if (forcedKeys.length > 0) {
        const found = await client.searchAll(`issuekey in (${forcedKeys.join(',')})`);
        const existingKeys = new Set([...planKeys, ...regKeys, ...found.map(raw => String(issueSummary(raw).issue_key ?? ''))]);
        ({ material, degradedNotes } = dropUnresolvableNoteTasks(built, existingKeys));
    }
    let text;
    let elapsedMs;
    try {
        const selection = deps.currentSelection();
        ({ text, elapsedMs } = await runGeneration(deps.stream, selection, material, signal));
    }
    catch (error) {
        rethrowRouteClass(error);
    }
    const draft = parseDraft(text, material.tasks, material.notes);
    const taskKeys = new Map([...material.taskKeys.entries()].map(([id, key]) => {
        const name = material.tasks.find(task => task.id === id)?.name ?? key;
        return [id, { key, name }];
    }));
    const draftId = deps.store.put({ date, taskKeys });
    return draftDocumentFrom(material, { draftId, entries: draft.entries }, elapsedMs, degradedNotes.length > 0 ? degradedNotes : undefined);
}
/** 按日整存暂存（保留首建 createdAt）。 */
async function putOutboxPreserving(worklogs, date, entries) {
    const now = new Date().toISOString();
    const prev = worklogs.getOutbox(date);
    await worklogs.putOutbox({ date, entries, createdAt: prev?.createdAt ?? now, updatedAt: now });
}
/** 远程段抛错的暂存兜底：全量条目按 failed 暂存；存在无任务映射条目＝请求本身不合法
 * （对位本地错误口径，整体不暂存——T05 review f4a）；暂存成功 → 原错误重抛，空集直接
 * 重抛（f4b）；暂存失败 → 错误消息拼接「暂存未生效」（S10，消息兜底 f4c）。 */
async function persistAllFailedAndRethrow(deps, context, request, error) {
    const entries = request.entries.map(entry => {
        const ref = context.taskKeys.get(entry.taskId);
        return ref ? outboxEntryFrom(entry, ref, 'failed') : null;
    });
    if (entries.some(entry => entry === null))
        throw error; // 有无映射条目：不暂存（同本地错误口径）
    if (entries.length === 0)
        throw error; // 无可暂存内容：不附加误导性提示
    let saved = false;
    if (deps.worklogs) {
        try {
            await storeIo(() => putOutboxPreserving(deps.worklogs, context.date, entries));
            saved = true;
        }
        catch {
            saved = false;
        }
    }
    if (!saved) {
        const message = String(error?.message ?? error);
        throw new Error(`${message}；暂存未生效——请勿关闭面板/重启，可稍后在表单内重试提交`);
    }
    throw error;
}
/** 出口记账：failed/uncertain 条目按日整存（替换语义——本次未成功项即该日暂存全集）；
 * 暂存来源（outboxDate）全部终态成功 → 清除、部分成功 → 替换为剩余；blocked 不动既有
 * 暂存（条目未提交）；写失败返回 false（outboxSaved 口径），无动作返回 undefined。 */
async function accountOutbox(deps, context, request, dayReport) {
    if (dayReport.status === 'blocked')
        return undefined;
    if (!deps.worklogs)
        return undefined;
    const failedEntries = [];
    request.entries.forEach((entry, index) => {
        const result = dayReport.results[index];
        const status = result?.status;
        if (status !== 'failed' && status !== 'uncertain')
            return;
        const ref = context.taskKeys.get(entry.taskId);
        if (!ref)
            return;
        failedEntries.push(outboxEntryFrom(entry, ref, status, sanitizeDetail(result.error ?? result.reason)));
    });
    if (context.outboxDate !== undefined && failedEntries.length === 0) {
        try {
            await storeIo(() => deps.worklogs.deleteOutbox(context.outboxDate));
        }
        catch {
            // 清除失败：暂存留存，提示条下次刷新仍见——不干扰提交回报
        }
        return undefined;
    }
    if (failedEntries.length === 0)
        return undefined;
    try {
        await storeIo(() => putOutboxPreserving(deps.worklogs, context.outboxDate ?? context.date, failedEntries));
        return true;
    }
    catch {
        return false;
    }
}
/** 提交：草稿上下文 → 当日已填现查（D23）→ 重组计划文档 → 引擎写入 → 回报按序对回。
 * confirm 恒 true——UI「提交」按钮点击即显式确认语义（D6）；DayMutex 互斥在 index.ts 接线层。
 * 20261015 Wave：出口暂存记账（F-1 全分支）——catch 仅覆盖 Jira 远程段（现查＋引擎写入），
 * 本地重组错误（时间段非法/候选缺失）不暂存（对位 blocked 口径，SPEC 范围）。 */
export async function submitFlow(deps, request) {
    const context = deps.store.get(request.draftId);
    if (!context)
        throw new Error('草稿已过期，请重新生成后再提交');
    const config = deps.engineConfig();
    const client = deps.makeClient(config.jira);
    let todayHours;
    try {
        const daily = await worklogDailySummary(client, await client.myself(), [context.date]);
        todayHours = Math.round((daily[context.date] ?? [])
            .reduce((sum, item) => sum + Number(item.hours ?? 0), 0) * 10000) / 10000;
    }
    catch (error) {
        throw await persistAllFailedAndRethrow(deps, context, request, error);
    }
    const doc = submitRequestToPlanDoc(request, context, todayHours);
    let dayReport;
    try {
        dayReport = await submitDay(client, doc, { confirm: true });
    }
    catch (error) {
        throw await persistAllFailedAndRethrow(deps, context, request, error);
    }
    // 核对链接按请求序对齐（结构化字段，键不进脱敏文本）；任务缺引用时该条无链接。
    const server = config.jira.server.replace(/\/+$/, '');
    const issueUrls = request.entries.map(entry => {
        const ref = context.taskKeys.get(entry.taskId);
        return ref ? `${server}/browse/${ref.key}` : undefined;
    });
    const report = submitReportFrom(dayReport, request, issueUrls);
    const outboxSaved = await accountOutbox(deps, context, request, dayReport);
    if (outboxSaved !== undefined)
        report.outboxSaved = outboxSaved;
    return report;
}
/** 暂存回显：读暂存 → 现查该日登记 → 候选集（watched ∪ 已登记 ∪ 暂存任务）→ 注册
 * 草稿缓存（outboxDate 标记）→ 回显文档（elapsedMs 0、lastStatus、uncertain 核对链接）。 */
export async function openOutboxFlow(deps, date) {
    if (!deps.worklogs)
        throw new Error('存储不可用：暂存暂不能打开，请稍后刷新重试');
    const record = await storeIo(() => deps.worklogs.getOutbox(date));
    if (record === undefined || record.entries.length === 0)
        throw new Error('暂存不存在或已清除，请刷新面板');
    const config = deps.engineConfig();
    const client = deps.makeClient(config.jira);
    const regs = await dayRegistrations(client, [], [], date);
    const extra = new Map(record.entries.map(entry => [entry.issueKey, entry.taskName]));
    // 自用局部映射——不重注册 CandidateStore（候选映射所有权在 dayDetail，重注册会使
    // 素材下拉的 candidateId 解析落到与用户所见不同的任务——T05 review f3）
    const { map, view: candidates } = await candidateSets(client, regs, extra);
    const idOf = (key) => [...map.entries()].find(([, ref]) => ref.key === key)?.[0];
    const draftId = deps.store.put({ date, taskKeys: map, outboxDate: date });
    const gapHours = regs.workday ? Math.max(0, Math.round((8 - regs.hours) * 100) / 100) : 0;
    return outboxToDraft(record, candidates, idOf, draftId, { loggedHours: regs.hours, gapHours }, config.jira.server);
}
/** 素材保存：整日条目集落库——已存条目按 id 保留键与任务（给 candidateId 即换任务），
 * 新条目经 candidateId 解析（候选映射由最近 dayDetail 注册）；空文本剔除、空数组＝清空。 */
export async function saveNotesFlow(deps, request) {
    if (!deps.worklogs)
        throw new Error('存储不可用：素材暂不能保存，请稍后重试');
    const date = String(request.date ?? '');
    const prevRecord = await storeIo(() => deps.worklogs.getNotes(date));
    const prev = new Map((prevRecord?.items ?? []).map(item => [item.id, item]));
    const map = deps.candidates?.get(date);
    const now = new Date().toISOString();
    const items = [];
    const seenIds = new Set(); // 行身份唯一性：重复 id 即客户端缺陷形态，拒绝落库（T05 review f5）
    let seq = Date.now();
    for (const raw of request.items) {
        const text = String(raw.text ?? '').trim();
        if (!text)
            continue;
        const held = raw.id !== undefined ? prev.get(raw.id) : undefined;
        if (raw.id !== undefined && held === undefined)
            throw new Error('素材条目已不存在，请刷新面板后重试');
        if (raw.id !== undefined) {
            if (seenIds.has(raw.id))
                throw new Error('素材条目重复，请刷新面板后重试');
            seenIds.add(raw.id);
        }
        let issueKey = held?.issueKey;
        let taskName = held?.taskName ?? '';
        if (raw.candidateId !== undefined) {
            const ref = map?.get(raw.candidateId);
            if (ref === undefined)
                throw new Error('任务选择已失效，请刷新面板后重试');
            issueKey = ref.key;
            taskName = ref.name;
        }
        if (issueKey === undefined)
            throw new Error('新素材条目缺少任务选择');
        items.push({
            id: held?.id ?? `n-${date}-${seq++}`,
            issueKey,
            taskName,
            text,
            createdAt: held?.createdAt ?? now,
            updatedAt: now,
        });
    }
    await storeIo(() => deps.worklogs.putNotes({ date, items, createdAt: prevRecord?.createdAt ?? now, updatedAt: now }));
    return { items: items.map(({ id, taskName, text }) => ({ id, taskName, text })) };
}
/** 放弃暂存：删除该日暂存记录（不写任何 Jira 内容）。 */
export async function dismissOutboxFlow(deps, date) {
    if (!deps.worklogs)
        throw new Error('存储不可用：操作暂不能完成，请稍后重试');
    await storeIo(() => deps.worklogs.deleteOutbox(date));
}
/** 查同事日志编排：凭据预检（myself 前置，坏凭据不得伪装成查询结果——SPEC 成功结果 4；
 * 401/403 补同构凭据文案，与 overviewFlow 口径一致）→ 名字解析 → 窗口采集 →
 * 空窗口回溯最后活跃周 → 视图映射。全程只读。today 注入供测试确定性。 */
export async function queryFlow(deps, request, today = todayKeyEast8()) {
    if (!deps.jiraConfigured()) {
        throw new Error(CREDENTIALS_GUIDE);
    }
    const config = deps.engineConfig();
    const client = deps.makeClient(config.jira);
    try {
        await client.myself();
    }
    catch (error) {
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
            throw new Error('Jira 认证失败（401/403，账号或密码无效），请到插件设置修正后再来重试。');
        }
        throw error;
    }
    const resolved = await resolveUser(client, request.name);
    if (resolved.status === 'not-found') {
        return { status: 'not-found', notice: notFoundNotice(request.name) };
    }
    if (resolved.status === 'ambiguous') {
        const candidates = resolved.candidates.map(({ name, displayName }) => ({ name, displayName }));
        return { status: 'ambiguous', notice: ambiguousNotice(request.name, candidates), candidates };
    }
    const entries = await collectWorklogs(client, resolved.name, request.from, request.to, today);
    if (entries.length > 0) {
        return {
            status: 'ok',
            displayName: resolved.displayName,
            name: resolved.name,
            days: aggregateToDays(entries, config.jira.server),
            permissionNote: PERMISSION_NOTE,
        };
    }
    // 窗口空：不限窗口重采推导最后活跃周；不限窗口本身为空＝无任何日志（无需重采）
    const unbounded = request.from === undefined && request.to === undefined;
    const all = unbounded ? entries : await collectWorklogs(client, resolved.name, undefined, undefined, today);
    const week = lastActiveWeek(all);
    if (week === undefined) {
        return { status: 'no-logs', displayName: resolved.displayName, name: resolved.name, notice: noLogsNotice(resolved.displayName, resolved.name) };
    }
    const weekEntries = all.filter(item => item.startedDate >= week.monday && item.startedDate <= week.sunday);
    return {
        status: 'ok',
        displayName: resolved.displayName,
        name: resolved.name,
        days: aggregateToDays(weekEntries, config.jira.server),
        notice: fallbackNotice(resolved.displayName, resolved.name, request.from, request.to, week),
        permissionNote: PERMISSION_NOTE,
    };
}
//# sourceMappingURL=flows.js.map