// 提交校验全集与条目装载——逐段对照参考实现 load_entries / validate_plan /
// comment_text / author_matches 移植。
// 20261028：说明长度上限（40/60 分档）移除——简短为提示词软约束，长度不再硬校验。
import { parseDate, parseStarted, parseTimeSpent } from './dates.js';
const ISSUE_RE = /^[A-Z][A-Z0-9]+-\d+$/;
/** Jira 评论正文归一：字符串 / {body|text} / 列表拼接（参考 comment_text）。 */
export function commentText(value) {
    if (typeof value === 'string')
        return value;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const record = value;
        return String(record.body ?? record.text ?? '');
    }
    if (Array.isArray(value))
        return value.map(commentText).join('\n');
    return String(value ?? '');
}
/** 作者与本人身份交集判定（name/key/emailAddress/email，参考 author_matches）。 */
export function authorMatches(author, myself) {
    const pick = (source) => new Set(['name', 'key', 'emailAddress', 'email']
        .filter(key => source[key])
        .map(key => String(source[key]).toLowerCase()));
    const values = pick(author);
    for (const mine of pick(myself)) {
        if (values.has(mine))
            return true;
    }
    return false;
}
/** 按 entries > submission_entries > suggested_entries 取条目，并做确认收敛（参考 load_entries）。 */
export function loadEntries(data) {
    const direct = data.entries;
    if (Array.isArray(direct))
        return direct;
    const primary = data.submission_entries;
    const secondary = data.suggested_entries;
    if (Array.isArray(primary) && primary.length > 0) {
        if (!(Array.isArray(secondary) && secondary.length > 0))
            return primary;
        const merged = [];
        for (let index = 0; index < primary.length; index++) {
            const item = { ...primary[index] };
            const other = secondary[index];
            if (other) {
                const aligned = String(other.issue_key) === String(item.issue_key) && String(other.started) === String(item.started);
                const minePending = String(item.comment ?? '').startsWith('待用户');
                const otherComment = String(other.comment ?? '').trim();
                if (aligned && minePending && otherComment && !otherComment.startsWith('待用户')) {
                    item.comment = other.comment;
                    if (other.comment_source)
                        item.comment_source = other.comment_source;
                }
            }
            merged.push(item);
        }
        return merged;
    }
    return Array.isArray(secondary) ? secondary : [];
}
/** 提交前校验全集（参考 validate_plan）；返回错误列表，空数组即通过。 */
export function validate(data) {
    const errors = [];
    if (data === null || typeof data !== 'object' || Array.isArray(data))
        return ['计划必须是 JSON 对象'];
    const plan = data;
    if (plan.schema !== 'jira-worklog-plan.v1')
        errors.push('计划 schema 不受支持');
    let target = null;
    try {
        target = parseDate(String(plan.target_date ?? ''));
    }
    catch (error) {
        errors.push(error.message);
    }
    const entries = loadEntries(plan);
    if (entries.length === 0) {
        errors.push('计划没有可提交条目');
        return errors;
    }
    const totalExisting = Number(plan.today_existing_hours ?? 0) || 0;
    let total = totalExisting;
    const seen = new Set();
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            errors.push(`第 ${index + 1} 条必须是对象`);
            continue;
        }
        const key = String(entry.issue_key ?? '');
        if (!ISSUE_RE.test(key))
            errors.push(`第 ${index + 1} 条 Jira key 无效`);
        let parsedHours = 0;
        try {
            parsedHours = parseTimeSpent(String(entry.time_spent ?? ''));
            total += parsedHours;
        }
        catch (error) {
            errors.push(`第 ${index + 1} 条：${error.message}`);
        }
        if (entry.hours !== undefined && entry.hours !== null) {
            const hours = Number(entry.hours);
            if (Number.isNaN(hours)) {
                errors.push(`第 ${index + 1} 条 hours 无效`);
            }
            else if (Math.abs(hours - parsedHours) > 0.01) {
                errors.push(`第 ${index + 1} 条 hours 与 time_spent 不一致`);
            }
        }
        const started = parseStarted(entry.started);
        const startedDate = started === null ? null : new Date(started + 8 * 3600000).toISOString().slice(0, 10);
        if (started === null) {
            errors.push(`第 ${index + 1} 条开始时间无效`);
        }
        else if (target !== null && startedDate !== target) {
            errors.push(`第 ${index + 1} 条开始日期不是目标日 ${target}；补填历史缺口请对该日重跑 plan（--date）`);
        }
        const comment = String(entry.comment ?? '').trim();
        if (!comment || comment.startsWith('待用户')) {
            errors.push(`第 ${index + 1} 条缺少已确认的真实工作说明`);
        }
        if (String(entry.task_name ?? '').trim() === key) {
            errors.push(`第 ${index + 1} 条任务名不能只显示 Jira key`);
        }
        if (!['auto', 'leave'].includes(String(entry.adjust_estimate ?? 'auto'))) {
            errors.push(`第 ${index + 1} 条剩余估算策略不支持`);
        }
        const dedupe = `${key}|${String(entry.started ?? '')}|${comment}`;
        if (seen.has(dedupe))
            errors.push(`第 ${index + 1} 条与前面条目重复`);
        seen.add(dedupe);
    }
    const minimum = Number(plan.minimum_hours ?? 8) || 0;
    if (total < minimum) {
        errors.push(`当天总工时为 ${Math.round(total * 100) / 100}h，不足 ${Math.round(minimum * 100) / 100}h`);
    }
    return errors;
}
//# sourceMappingURL=validate.js.map