// 东八区固定偏移的日期与排班工具——逐函数对照参考实现移植。
// 全部日期用 YYYY-MM-DD 字符串表示；时刻用 epoch 毫秒（UTC 语义）表示，
// 输出时按 +08:00 固定偏移格式化，不依赖宿主机时区。
const TZ_OFFSET_MS = 8 * 3600 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /(\d+(?:\.\d+)?)\s*([wdhm])/gi;
/** YYYY-MM-DD 严格解析；非法报可读错误（参考 parse_date）。 */
export function parseDate(value) {
    if (DATE_RE.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));
        if (date.getUTCMonth() === m - 1 && date.getUTCDate() === d)
            return value;
    }
    throw new Error(`日期必须是 YYYY-MM-DD：${value}`);
}
function dateToUtcMs(day) {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}
/** 周几：0=周一 … 6=周日（UTC 语义下与本地无关）。 */
function weekday(day) {
    return (new Date(dateToUtcMs(day)).getUTCDay() + 6) % 7;
}
function shiftDays(day, delta) {
    const date = new Date(dateToUtcMs(day) + delta * 86400000);
    return date.toISOString().slice(0, 10);
}
/** 工作日判定：默认周一至五，声明覆盖调休上班日与节假日（参考 is_workday）。 */
export function isWorkday(day, extraWorkdays = [], extraHolidays = []) {
    if (extraHolidays.includes(day))
        return false;
    if (extraWorkdays.includes(day))
        return true;
    return weekday(day) < 5;
}
/** 自 target 前一日起回溯收集 count 个工作日，升序返回（参考 workdays_before）。 */
export function workdaysBefore(target, count = 5, extraWorkdays = [], extraHolidays = []) {
    const days = [];
    let cursor = shiftDays(target, -1);
    while (days.length < count) {
        if (isWorkday(cursor, extraWorkdays, extraHolidays))
            days.push(cursor);
        cursor = shiftDays(cursor, -1);
    }
    return days.reverse();
}
/** ISO 时刻折算东八区日期；无时区按 UTC（参考 commit_local_date——提交时间归因）。 */
export function commitLocalDate(value) {
    const ms = parseIsoToMs(value, 0);
    if (ms === null)
        return null;
    return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
/** 解析 started 时刻为 epoch 毫秒；无时区按东八区（参考 parse_started）。 */
export function parseStarted(value) {
    return parseIsoToMs(value, TZ_OFFSET_MS);
}
function parseIsoToMs(value, naiveOffsetMs) {
    const text = String(value ?? '').trim();
    if (!text)
        return null;
    // 归一化：Z→+00:00，+0800→+08:00（非冒号形态非标准 ISO，V8 之外不保证可解析）。
    const normalized = text.replace('Z', '+00:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const ms = Date.parse(normalized);
    if (Number.isNaN(ms))
        return null;
    // JS Date.parse 对无时区字符串按本地时区解释——按目标偏移纠正回 UTC。
    const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
    if (hasZone)
        return ms;
    const localInterpreted = new Date(ms).getTime();
    const actualUtc = localInterpreted - naiveOffsetMs + localTzOffsetMs(localInterpreted);
    return actualUtc;
}
function localTzOffsetMs(ms) {
    return new Date(ms).getTimezoneOffset() * -60000;
}
/** epoch 毫秒 → Jira started 形态（+0800 固定偏移，参考 format_started）。 */
export function formatStarted(ms) {
    const local = new Date(ms + TZ_OFFSET_MS);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
        + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}.000+0800`;
}
/** 东八区 HH:mm-HH:mm 时间段（参考 format_time_range）。 */
export function formatTimeRange(startMs, hours) {
    const fmt = (ms) => {
        const local = new Date(ms + TZ_OFFSET_MS);
        return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
    };
    return `${fmt(startMs)}-${fmt(startMs + hours * 3600000)}`;
}
/** Jira 工时串折算小时：w=40h、d=8h、h、m（参考 parse_time_spent）。 */
export function parseTimeSpent(value) {
    const text = String(value ?? '').trim();
    if (!text)
        throw new Error('耗费时间不能为空');
    const matches = [...text.matchAll(TIME_RE)];
    const joined = matches.map(match => match[0]).join('').replace(/\s+/g, '');
    if (matches.length === 0 || joined !== text.replace(/\s+/g, '')) {
        throw new Error(`不支持的 Jira 工时格式：${value}`);
    }
    let hours = 0;
    for (const match of matches) {
        const amount = Number(match[1]);
        const unit = match[2].toLowerCase();
        hours += amount * { w: 40, d: 8, h: 1, m: 1 / 60 }[unit];
    }
    if (hours <= 0)
        throw new Error('耗费时间必须大于 0');
    return hours;
}
/** 小时 → Jira 工时串：整点 Nh、不足一小时 Nm、其余 Nh Nm（参考 hours_to_jira）。 */
export function hoursToJira(hours) {
    if (hours <= 0)
        throw new Error('小时数必须大于 0');
    if (Math.abs(hours - Math.round(hours)) < 1e-9)
        return `${Math.round(hours)}h`;
    const minutes = Math.round(hours * 60);
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
//# sourceMappingURL=dates.js.map