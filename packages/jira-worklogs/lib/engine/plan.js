// 排班草案与素材组装——逐段对照参考实现 plan() 及其子函数移植。
// 输出结构镜像参考实现 JSON 形态（snake_case），供工具层与素材组装消费。
import { formatStarted, formatTimeRange, hoursToJira, isWorkday, parseStarted, parseTimeSpent, workdaysBefore } from './dates.js';
import { collectGitActivity } from './gitlab.js';
import { authorMatches, commentText } from './validate.js';
export const JQL = 'issue in watchedIssues() AND resolution = EMPTY ORDER BY watchers DESC';
const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const ISSUE_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const ISSUE_KEY_TEXT_RE = /\b([A-Z][A-Z0-9]+-\d{1,6})(?!\d)/g;
/** 从 started 串取日期前缀（参考 local_date：YYYY[-/]MM[-/]DD 前缀匹配）。 */
export function localDateKey(value) {
    const match = String(value ?? '').match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
    if (!match)
        return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}
/** worklog 归一（参考 normalize_worklog）。 */
export function normalizeWorklog(item) {
    const author = (item.author ?? {});
    return {
        id: String(item.id ?? ''),
        started: String(item.started ?? ''),
        date: localDateKey(item.started) ?? '0001-01-01',
        time_spent: String(item.timeSpent ?? ''),
        time_spent_seconds: Number(item.timeSpentSeconds ?? 0),
        hours: Math.round((Number(item.timeSpentSeconds ?? 0) / 3600) * 10000) / 10000,
        comment: commentText(item.comment),
        author: String(author.displayName ?? author.name ?? ''),
    };
}
/** 从 09:00 连续排班；已有工时从最晚结束时刻续排（参考 schedule_entries）。 */
export function scheduleEntries(entries, day, existingLogs = []) {
    const base = Date.parse(`${day}T09:00:00+08:00`);
    const parsedEnds = [];
    let existingHours = 0;
    for (const log of existingLogs) {
        const hours = Math.max(0, Number(log.hours ?? 0));
        existingHours += hours;
        const started = parseStarted(log.started);
        if (started !== null && hours > 0)
            parsedEnds.push(started + hours * 3600000);
    }
    let cursor = parsedEnds.length > 0 ? Math.max(...parsedEnds) : base + existingHours * 3600000;
    if (cursor < base)
        cursor = base;
    const result = [];
    for (const raw of entries) {
        const item = { ...raw };
        const hours = Number(item.hours ?? parseTimeSpent(String(item.time_spent ?? '')));
        item.hours = Math.round(hours * 10000) / 10000;
        item.started = formatStarted(cursor);
        item.time_range = formatTimeRange(cursor, hours);
        item.date = day;
        result.push(item);
        cursor += hours * 3600000;
    }
    return result;
}
/** 不暴露 Jira key 的用户确认视图（参考 user_proposal）。 */
export function userProposal(entries) {
    return entries.map(item => ({
        task_name: String(item.task_name ?? '未解析任务'),
        date: item.date ?? localDateKey(item.started),
        time_range: item.time_range ?? '',
        time_spent: item.time_spent ?? hoursToJira(Number(item.hours ?? 0)),
        comment: String(item.comment ?? ''),
        evidence: item.evidence ?? item.basis ?? '',
    }));
}
/** 关注问题摘要（参考 issue_summary）。searchAll 返回 Jira 原生形态
 * （{key, fields}），消费方一律经本函数归一化后取 issue_key/summary——
 * 裸读 .issue_key 恒为 undefined（round-01 验收 P1 教训）。 */
export function issueSummary(raw) {
    const fields = (raw.fields ?? {});
    const byName = (source) => String(source?.name ?? '');
    return {
        issue_key: String(raw.key ?? ''),
        issue_id: String(raw.id ?? ''),
        summary: String(fields.summary ?? ''),
        status: byName(fields.status),
        assignee: String(fields.assignee?.displayName ?? ''),
        issue_type: byName(fields.issuetype),
        project: String(fields.project?.key ?? ''),
        timespent_hours: Math.round((Number(fields.timespent ?? 0) / 3600) * 10000) / 10000,
        original_estimate_hours: Math.round((Number(fields.timeoriginalestimate ?? 0) / 3600) * 10000) / 10000,
    };
}
/** 补齐 Git key 的 Jira summary；失败的 key 不猜任务名（参考 resolve_task_names）。 */
export async function resolveTaskNames(client, known, keys) {
    const names = { ...known };
    const unresolved = [];
    for (const key of [...keys].filter(key => !(key in names)).sort()) {
        let summary = '';
        try {
            summary = String(issueSummary(await client.issue(key)).summary ?? '');
        }
        catch {
            summary = '';
        }
        if (summary)
            names[key] = summary;
        else
            unresolved.push(key);
    }
    return { names, unresolved };
}
/** 提交标题提取 Jira key → 标题列表；Merge 提交不计（参考 extract_issue_evidence）。 */
export function extractIssueEvidence(commits) {
    const evidence = {};
    for (const commit of commits) {
        const title = String(commit.title ?? '');
        if (title.startsWith('Merge branch') || title.startsWith('Merge pull'))
            continue;
        const keys = new Set([...title.matchAll(ISSUE_KEY_TEXT_RE)].map(match => match[1]));
        for (const key of keys)
            (evidence[key] ??= []).push(title);
    }
    return evidence;
}
/** 按权重分摊 total 小时，0.5h 粒度，总和守恒（参考 split_hours）。 */
export function splitHours(total, weights) {
    if (weights.length === 0 || total <= 0)
        return [];
    const maxSlots = Math.max(1, Math.round(total / 0.5));
    let selected = weights;
    if (weights.length > maxSlots) {
        const keep = weights.map((weight, index) => ({ weight, index }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, maxSlots)
            .map(item => item.index)
            .sort((a, b) => a - b);
        selected = keep.map(index => weights[index]);
    }
    if (selected.length === 1)
        return [Math.round(total * 100) / 100];
    const round2 = (value) => Math.round(value * 100) / 100;
    if (round2(0.5 * selected.length) >= total) {
        const amounts = Array(selected.length - 1).fill(0.5);
        amounts.push(round2(total - 0.5 * (selected.length - 1)));
        return amounts;
    }
    const scale = selected.reduce((sum, weight) => sum + weight, 0);
    const amounts = selected.map(weight => Math.max(0.5, Math.round((total * weight) / scale * 2) / 2));
    amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + (total - amounts.reduce((a, b) => a + b, 0)));
    if (amounts[amounts.length - 1] < 0.5)
        amounts[amounts.length - 1] = 0.5;
    return amounts;
}
/** 有 Git 证据时按 Jira key 分配缺口（参考 build_git_day_entries）。 */
export function buildGitDayEntries(day, gapHours, gitItems, taskNames = {}, historyComments = {}) {
    if (gapHours <= 0)
        return [];
    const evidence = {};
    for (const item of gitItems) {
        for (const [key, titles] of Object.entries(extractIssueEvidence(item.commits))) {
            if (Object.keys(taskNames).length > 0 && !(key in taskNames))
                continue;
            (evidence[key] ??= []).push(...titles);
        }
    }
    const keys = Object.keys(evidence).sort();
    if (keys.length === 0)
        return [];
    const amounts = splitHours(gapHours, keys.map(key => evidence[key].length));
    const entries = [];
    for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const titles = evidence[key];
        const prior = historyComments[key] ?? [];
        const allEvidence = [...new Set([...titles, ...prior])];
        const shown = allEvidence.slice(0, 5).join('；');
        const suffix = allEvidence.length > 5 ? ` 等 ${allEvidence.length} 条证据` : '';
        entries.push({
            issue_key: key,
            task_name: taskNames[key] ?? key,
            time_spent: hoursToJira(amounts[index]),
            hours: amounts[index],
            comment: `待用户确认：${shown}${suffix}`,
            basis: `GitLab 提交标题含 ${key}（${titles.length} 次）`,
            comment_source: 'git_commits',
        });
    }
    return entries;
}
/** 按日聚合当前用户全部 worklog（一次 JQL 覆盖窗口，参考 worklog_daily_summary）。 */
export async function worklogDailySummary(client, myself, dates) {
    const start = dates.reduce((min, day) => (day < min ? day : min));
    const end = dates.reduce((max, day) => (day > max ? day : max));
    const jql = `worklogAuthor = currentUser() AND worklogDate >= "${start}" AND worklogDate <= "${end}"`;
    const summary = {};
    for (const day of dates)
        summary[day] = [];
    for (const rawIssue of await client.searchAll(jql, 'key')) {
        const key = String(rawIssue.key ?? '');
        if (!key)
            continue;
        for (const rawLog of await client.worklogs(key)) {
            const day = localDateKey(rawLog.started);
            if (day === null || !(day in summary))
                continue;
            const author = (rawLog.author ?? {});
            if (!authorMatches(author, myself))
                continue;
            summary[day].push({ ...normalizeWorklog(rawLog), issue_key: key });
        }
    }
    return summary;
}
/** 逐日检查行：已填/缺口/豁免（参考 build_check_rows）。 */
export function buildCheckRows(daily, checkDates, target, extraWorkdays = [], extraHolidays = []) {
    const rows = [];
    for (const day of checkDates) {
        const logs = daily[day] ?? [];
        const hours = Math.round(logs.reduce((sum, item) => sum + Number(item.hours ?? 0), 0) * 10000) / 10000;
        const weekend = !isWorkday(day, extraWorkdays, extraHolidays);
        const gap = weekend ? 0 : Math.round(Math.max(0, 8 - hours) * 100) / 100;
        rows.push({
            date: day,
            weekday: WEEKDAY_NAMES[(new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay() + 6) % 7],
            is_target: day === target,
            required: !weekend,
            hours,
            gap_hours: gap,
            status: weekend ? 'exempt' : hours >= 8 ? 'full' : 'gap',
            issues: [...new Set(logs.map(item => String(item.issue_key)))].sort(),
        });
    }
    return rows;
}
export function gitIssueKeys(gitByDate) {
    const keys = new Set();
    for (const items of Object.values(gitByDate)) {
        for (const item of items) {
            for (const key of Object.keys(extractIssueEvidence(item.commits)))
                keys.add(key);
        }
    }
    return keys;
}
export function historyCommentIndex(daily) {
    const index = {};
    for (const logs of Object.values(daily)) {
        for (const log of logs) {
            const comment = String(log.comment ?? '').trim();
            const key = String(log.issue_key ?? '');
            if (key && comment)
                (index[key] ??= []).push(comment);
        }
    }
    return index;
}
/** 历史缺口日补填建议：Git 证据优先，回退当天/最近/关注问题（参考 suggest_gap_fills）。 */
export function suggestGapFills(rows, daily, fallbackKeys, gitByDate = {}, taskNames = {}, historyComments = {}) {
    let recentIssue = '';
    for (const row of [...rows].reverse()) {
        if (row.is_target)
            continue;
        const logs = daily[String(row.date)] ?? [];
        if (logs.length > 0) {
            recentIssue = String(logs[logs.length - 1].issue_key);
            break;
        }
    }
    const suggestions = [];
    for (const row of rows) {
        if (row.is_target || row.status !== 'gap')
            continue;
        const day = String(row.date);
        const gitEntries = buildGitDayEntries(day, Number(row.gap_hours), gitByDate[day] ?? [], taskNames, historyComments);
        if (gitEntries.length > 0) {
            for (const entry of gitEntries) {
                entry.basis = `GitLab 提交证据：${String(entry.basis)}`;
                suggestions.push(entry);
            }
            continue;
        }
        const logs = daily[day] ?? [];
        let issueKey;
        let basis;
        let priorComment;
        if (logs.length > 0) {
            issueKey = String(logs[logs.length - 1].issue_key);
            basis = `当天已有记录的问题 ${issueKey}`;
            priorComment = String(logs[logs.length - 1].comment ?? '');
        }
        else if (recentIssue) {
            issueKey = recentIssue;
            basis = `沿用窗口内最近有记录的问题 ${issueKey}`;
            const prior = historyComments[issueKey] ?? [];
            priorComment = prior.length > 0 ? prior[prior.length - 1] : '';
        }
        else if (fallbackKeys.length > 0) {
            issueKey = [...fallbackKeys].sort()[0];
            basis = '无历史记录，回退到当前关注问题';
            priorComment = '';
        }
        else {
            continue;
        }
        suggestions.push({
            date: day,
            issue_key: issueKey,
            time_spent: hoursToJira(Number(row.gap_hours)),
            hours: Number(row.gap_hours),
            started: `${day}T09:00:00.000+0800`,
            comment: priorComment ? `待用户确认：延续「${priorComment}」` : '待用户补充真实工作说明',
            basis,
            comment_source: priorComment ? 'recent_history' : 'jira_history_fallback',
        });
    }
    return suggestions;
}
/** 默认草案：最近有记录工作日的分布顺延（参考 recent_day_entries）。 */
export function recentDayEntries(daily, historyDates, hours, taskNames, historyComments) {
    if (hours <= 0)
        return [];
    for (const day of [...historyDates].reverse()) {
        const logs = daily[day] ?? [];
        if (logs.length === 0)
            continue;
        const totals = new Map();
        for (const log of logs) {
            const key = String(log.issue_key ?? '');
            if (key)
                totals.set(key, (totals.get(key) ?? 0) + Number(log.hours ?? 0));
        }
        const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
        const keys = ranked.map(([key]) => key);
        const amounts = keys.length === 1
            ? [Math.round(hours * 100) / 100]
            : splitHours(hours, ranked.map(([, total]) => Math.max(1, Math.round(total * 2))));
        const entries = [];
        for (let index = 0; index < keys.length; index++) {
            const key = keys[index];
            const prior = historyComments[key] ?? [];
            const draft = prior.length > 0 ? `待用户确认：延续「${prior[prior.length - 1]}」` : '待用户补充真实工作说明';
            entries.push({
                issue_key: key,
                task_name: taskNames[key] ?? key,
                time_spent: hoursToJira(amounts[index]),
                hours: amounts[index],
                comment: draft,
                basis: `最近工作日 ${day} 工时分布顺延（${key} ${ranked[index][1]}h），供模型结合窗口趋势修正`,
                comment_source: prior.length > 0 ? 'recent_history' : 'no_evidence',
                adjust_estimate: 'auto',
            });
        }
        return entries;
    }
    return [];
}
/** 冷启动兜底：全额记到排序第一的关注问题（参考 cold_start_entries）。 */
export function coldStartEntries(candidates, hours) {
    if (candidates.length === 0 || hours <= 0)
        return [];
    const meta = candidates[0];
    return [{
            issue_key: meta.issue_key,
            task_name: meta.task_name ?? meta.issue_key,
            time_spent: hoursToJira(hours),
            hours: Math.round(hours * 100) / 100,
            comment: '待用户补充真实工作说明',
            basis: `窗口内无本人工时记录，默认记到关注问题 ${meta.issue_key}`,
            comment_source: 'cold_start',
            adjust_estimate: 'auto',
        }];
}
/** 只读规划（参考 plan()）：缺口检查、缺口建议、候选、Git 素材与目标日草案。 */
export async function plan(client, target, options = {}) {
    const checkDays = options.checkDays ?? 5;
    const extraWorkdays = options.workdays ?? [];
    const extraHolidays = options.holidays ?? [];
    const myself = await client.myself();
    const historyDates = workdaysBefore(target, checkDays, extraWorkdays, extraHolidays);
    const checkDates = [...historyDates, target];
    const daily = await worklogDailySummary(client, myself, checkDates);
    const rows = buildCheckRows(daily, checkDates, target, extraWorkdays, extraHolidays);
    const watched = (await client.searchAll(JQL))
        .map(raw => issueSummary(raw))
        .filter(item => ISSUE_RE.test(String(item.issue_key)))
        .sort((a, b) => String(a.issue_key).localeCompare(String(b.issue_key)));
    const watchedKeys = watched.map(item => String(item.issue_key));
    let taskNames = {};
    for (const item of watched)
        taskNames[String(item.issue_key)] = String(item.summary ?? '');
    const candidates = [];
    for (const meta of watched) {
        const key = String(meta.issue_key);
        const summary = String(meta.summary ?? '') || key;
        const ownHistory = historyDates.flatMap(day => (daily[day] ?? []).filter(log => log.issue_key === key).map(log => ({ ...log, task_name: summary })));
        const todayLogs = (daily[target] ?? []).filter(log => log.issue_key === key).map(log => ({ ...log, task_name: summary }));
        candidates.push({
            ...meta,
            task_name: summary,
            history_worklogs: ownHistory,
            today_worklogs: todayLogs,
            today_hours: Math.round(todayLogs.reduce((sum, item) => sum + Number(item.hours ?? 0), 0) * 10000) / 10000,
        });
    }
    const loggedKeys = new Set(Object.values(daily).flat().map(log => String(log.issue_key)));
    const otherIssues = [...loggedKeys].filter(key => !watchedKeys.includes(key)).sort();
    const targetExempt = !isWorkday(target, extraWorkdays, extraHolidays);
    const allToday = Math.round((daily[target] ?? []).reduce((sum, item) => sum + Number(item.hours ?? 0), 0) * 10000) / 10000;
    const includeGit = options.includeGit !== false;
    const gitInstances = options.gitInstances ?? [];
    const gitActivity = includeGit && gitInstances.length > 0
        ? await collectGitActivity(gitInstances, checkDates, options.repoFilter ?? [], options.gitClientFactory)
        : { enabled: false, instances: [], by_date: Object.fromEntries(checkDates.map(day => [day, []])) };
    const gitByDate = gitActivity.by_date ?? {};
    const resolved = await resolveTaskNames(client, taskNames, gitIssueKeys(gitByDate));
    taskNames = resolved.names;
    const historyComments = historyCommentIndex(daily);
    const gapSuggestions = suggestGapFills(rows, daily, watchedKeys, gitByDate, taskNames, historyComments);
    const historyGapHours = Math.round(rows.filter(row => !row.is_target).reduce((sum, row) => sum + Number(row.gap_hours ?? 0), 0) * 100) / 100;
    const pending = ['每条说明为待确认草稿，经用户 review/修改/确认后才能提交'];
    const remaining = targetExempt ? 0 : Math.max(0, 8 - allToday);
    if (targetExempt)
        pending.push('目标日是豁免日（周末/节假日），不强制 8h；调休上班日用 workday 声明');
    const historyGapForTarget = buildGitDayEntries(target, remaining, gitByDate[target] ?? [], taskNames, historyComments);
    const active = recentDayEntries(daily, historyDates, remaining, taskNames, historyComments);
    let suggested = historyGapForTarget.length > 0 ? historyGapForTarget : active.length > 0 ? active : coldStartEntries(candidates, remaining);
    if (suggested.length > 0 && suggested[0].comment_source === 'cold_start') {
        pending.push(`窗口内无本人工时记录，默认建议记到 ${String(suggested[0].issue_key)}；请确认或改指`);
    }
    suggested = scheduleEntries(suggested, target, daily[target] ?? []);
    const total = Math.round((allToday + suggested.reduce((sum, item) => sum + Number(item.hours ?? 0), 0)) * 10000) / 10000;
    for (const entry of suggested) {
        entry.adjust_estimate ??= 'auto';
        entry.evidence ??= entry.basis ?? '待用户确认';
    }
    const mine = {};
    for (const key of ['name', 'key', 'emailAddress', 'displayName']) {
        if (myself[key])
            mine[key] = myself[key];
    }
    return {
        schema: 'jira-worklog-plan.v1',
        target_date: target,
        timezone: 'Asia/Shanghai',
        check_days: checkDays,
        schedule_start: '09:00',
        history_dates: historyDates,
        jql: JQL,
        myself: mine,
        worklog_check: {
            window: { start: checkDates[0], end: checkDates[checkDates.length - 1] },
            rule: '周一至周五每天至少 8h；周六周日默认豁免，调休/节假日用 workdays/holidays 覆盖',
            daily: rows,
            history_gap_hours: historyGapHours,
            target_gap_hours: targetExempt ? 0 : Math.round(Math.max(0, 8 - allToday) * 100) / 100,
        },
        gap_suggestions: gapSuggestions,
        candidates,
        other_logged_issues: otherIssues,
        git_activity: gitActivity,
        unresolved_git_tasks: resolved.unresolved,
        today_existing_hours: allToday,
        suggested_entries: suggested,
        user_proposal: userProposal(suggested),
        planned_total_hours: total,
        minimum_hours: targetExempt ? 0 : 8,
        calendar_overrides: {
            workdays: [...extraWorkdays].sort(),
            holidays: [...extraHolidays].sort(),
        },
        ready_for_confirmation: (targetExempt || total >= 8) && suggested.length > 0 && suggested.every(item => !String(item.comment ?? '').startsWith('待用户')),
        pending_confirmations: pending,
    };
}
/** 当月（月首至 today）逐日状态行——工作日全量＋有登记的周末/调休日（exempt 且
 * hours>0 才出行，月历 ✓ 可视，20261029 用户裁决）；未登记周末不出行、不计缺口。
 * 不拉关注问题（watched JQL）、不拉 Git（PLAN 引擎查询层，D21）。 */
export async function monthStatus(client, today) {
    const [year, month, day] = today.split('-').map(Number);
    const dates = [];
    for (let d = 1; d <= day; d++) {
        dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    // 防御保留（逐日全量后 dates 恒非空，原「月首无工作日空窗」F1 场景不再触发）
    if (dates.length === 0)
        return [];
    const daily = await worklogDailySummary(client, await client.myself(), dates);
    return buildCheckRows(daily, dates, today)
        .filter(row => row.status !== 'exempt' || Number(row.hours ?? 0) > 0);
}
/** 单日全量登记（含非候选任务）＋名称解析（未解析回退空串，服务层映射「未解析任务」）
 * ＋单日 Git 素材——弹窗日详情路径（F17 输出面扩展）。 */
export async function dayRegistrations(client, gitInstances, repoFilter, date, gitClientFactory) {
    const daily = await worklogDailySummary(client, await client.myself(), [date]);
    const logs = daily[date] ?? [];
    const byKey = new Map();
    for (const log of logs) {
        const key = String(log.issue_key ?? '');
        if (!key)
            continue;
        const list = byKey.get(key) ?? [];
        list.push(log);
        byKey.set(key, list);
    }
    const resolved = await resolveTaskNames(client, {}, new Set(byKey.keys()));
    const hours = Math.round(logs.reduce((sum, item) => sum + Number(item.hours ?? 0), 0) * 10000) / 10000;
    const gitActivity = gitInstances.length > 0
        ? await collectGitActivity(gitInstances, [date], repoFilter, gitClientFactory)
        : { enabled: false, instances: [], by_date: {} };
    return {
        date,
        workday: isWorkday(date),
        hours,
        tasks: [...byKey.keys()].sort().map(key => ({
            issue_key: key,
            task_name: resolved.names[key] ?? '',
            entries: (byKey.get(key) ?? []).map(log => {
                const started = parseStarted(log.started);
                const logHours = Number(log.hours ?? 0);
                return {
                    time_range: started !== null ? formatTimeRange(started, logHours) : String(log.time_range ?? ''),
                    hours: logHours,
                    comment: String(log.comment ?? ''),
                };
            }),
        })),
        git: gitActivity.by_date[date] ?? [],
    };
}
//# sourceMappingURL=plan.js.map