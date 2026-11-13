// 写入链路——逐段对照参考实现 entry_match / submit 移植，外加多日封装。
// 安全语义：POST 前同任务五维查重；POST 永不自动重试；回读失败 uncertain，
// 本批次内不再对该条 POST；单条失败不回滚；dry-run 亦须 confirm（有意收紧）。
import { formatTimeRange, parseStarted, parseTimeSpent } from './dates.js';
import { authorMatches, commentText, loadEntries, validate } from './validate.js';
import { HttpError } from './types.js';
import { localDateKey } from './plan.js';
/** 完全匹配判定：同任务范围内 人+日+时长+说明 五维（参考 entry_match）。 */
export function entryMatch(log, entry, myself) {
    const date = localDateKey(log.started);
    const expectedDate = localDateKey(entry.started);
    const author = (log.author ?? {});
    let expectedSeconds;
    try {
        expectedSeconds = Math.round(parseTimeSpent(String(entry.time_spent ?? '')) * 3600);
    }
    catch {
        return false;
    }
    return date !== null
        && expectedDate !== null
        && date === expectedDate
        && authorMatches(author, myself)
        && Number(log.timeSpentSeconds ?? 0) === expectedSeconds
        && commentText(log.comment) === String(entry.comment ?? '');
}
/** 单日提交（参考 submit()）。confirm 非 true 一律拒绝（含 dry-run，有意收紧）。 */
export async function submitDay(client, planData, options) {
    const target = String(planData.target_date ?? '');
    if (options.confirm !== true) {
        return { schema: 'jira-worklog-submit.v1', status: 'blocked', target_date: target, errors: ['缺少确认（confirm: true），未执行任何 Jira 写入'], results: [] };
    }
    const errors = validate(planData);
    if (errors.length > 0) {
        return { schema: 'jira-worklog-submit.v1', status: 'blocked', target_date: target, errors, results: [] };
    }
    const myself = await client.myself();
    const entries = loadEntries(planData);
    const results = [];
    for (const entry of entries) {
        const key = String(entry.issue_key);
        const start = parseStarted(entry.started);
        let hours = 0;
        try {
            hours = parseTimeSpent(String(entry.time_spent));
        }
        catch { /* validate 已拦截，此处防御 */ }
        const item = {
            issue_key: key,
            task_name: String(entry.task_name ?? '未解析任务'),
            time_spent: String(entry.time_spent),
            started: String(entry.started),
            time_range: start !== null ? formatTimeRange(start, hours) : '',
            comment: String(entry.comment),
            ...(entry.comment_source ? { comment_source: String(entry.comment_source) } : {}),
            ...(entry.adjust_estimate ? { adjust_estimate: String(entry.adjust_estimate) } : {}),
            status: 'failed',
        };
        const payload = {
            timeSpent: String(entry.time_spent),
            started: String(entry.started),
            comment: String(entry.comment),
        };
        try {
            const before = await client.worklogs(key);
            if (before.some(log => entryMatch(log, entry, myself))) {
                results.push({ ...item, status: 'skipped', reason: '已有完全匹配的工时' });
                continue;
            }
            if (options.dryRun === true) {
                results.push({ ...item, status: 'would_write' });
                continue;
            }
            const response = await client.addWorklog(key, payload, String(entry.adjust_estimate ?? 'auto'));
            const after = await client.worklogs(key);
            const verified = after.some(log => entryMatch(log, entry, myself));
            results.push({ ...item, status: verified ? 'written' : 'uncertain', worklog_id: String(response.id ?? '') });
        }
        catch (error) {
            if (error instanceof HttpError) {
                // 4xx/5xx 是确定性失败（认证、权限、字段错误），不进入查重分支。
                results.push({ ...item, status: 'failed', error: error.message });
            }
            else {
                // 网络类失败：只读查证一次定级，绝不再次 POST。
                let verified = false;
                try {
                    const after = await client.worklogs(key);
                    verified = after.some(log => entryMatch(log, entry, myself));
                }
                catch {
                    verified = false;
                }
                results.push({ ...item, status: verified ? 'written' : 'uncertain', error: verified ? null : error.message });
            }
        }
    }
    const statuses = new Set(results.map(result => result.status));
    const successful = ['skipped', 'written', 'would_write'];
    const okCount = [...statuses].filter(status => successful.includes(status)).length;
    const status = statuses.size === okCount
        ? 'success'
        : okCount > 0 ? 'partial' : 'failed';
    return { schema: 'jira-worklog-submit.v1', status, target_date: target, errors: [], results };
}
/** 多日提交：逐日校验与写入，日级隔离；overall 映射参考实现 success 定级。 */
export async function submit(client, plans, options) {
    if (plans.length === 0) {
        return { schema: 'jira-worklog-submit-multi.v1', overall: 'failed', per_day: [] };
    }
    const perDay = [];
    for (const planData of plans) {
        try {
            perDay.push(await submitDay(client, planData, options));
        }
        catch (error) {
            // 日级网络事故（如 myself 失败）不吞掉其他日已完成的回报——已写入却零报告
            // 正是 uncertain 记账纪律要防的形态。
            perDay.push({
                schema: 'jira-worklog-submit.v1',
                status: 'failed',
                target_date: String(planData.target_date ?? ''),
                errors: [error instanceof Error ? error.message : String(error)],
                results: [],
            });
        }
    }
    const statuses = new Set(perDay.map(day => day.status));
    const good = ['success', 'partial'];
    const okCount = [...statuses].filter(status => good.includes(status)).length;
    const overall = statuses.size === okCount && !statuses.has('partial')
        ? 'ok'
        : okCount > 0 ? 'partial' : 'failed';
    return { schema: 'jira-worklog-submit-multi.v1', overall, per_day: perDay };
}
//# sourceMappingURL=submit.js.map