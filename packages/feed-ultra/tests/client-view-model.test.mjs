import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  batchSizeOf,
  briefItemMeta,
  briefMeta,
  calendarDot,
  calendarWithDay,
  channelName,
  channelStatusLine,
  countsLabel,
  dayKeyOf,
  descriptionOf,
  fetchableSourceIds,
  filterItems,
  formatCompact,
  formatDateTitle,
  formatRelativeTime,
  formatWeekday,
  githubMeta,
  githubStats,
  isChineseUi,
  isFutureDay,
  isManualSection,
  isTweetSection,
  itemMeta,
  itemsForChannel,
  manualEmptyCopy,
  monthGridRange,
  monthKeyOf,
  monthTitle,
  oldestDayKey,
  percentRead,
  pullControl,
  pullLabel,
  pullSummary,
  sectionEmptyState,
  sectionHead,
  sectionVisible,
  shiftDayKey,
  shiftMonthKey,
  statusLabel,
  textLanguage,
  translateOutcome,
  tweetActions,
  tweetDisplayText,
  tweetDeleted,
  tweetMeta,
  unreadCount,
} from '../client/src/view-model.mjs';

const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));

function t(key, params) {
  let value = zh[key] ?? key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}

test('day keys shift across month, year, and leap boundaries', () => {
  assert.equal(dayKeyOf(new Date(2026, 10, 10)), '2026-11-10');
  assert.equal(shiftDayKey('2026-11-30', 1), '2026-12-01');
  assert.equal(shiftDayKey('2026-12-01', -1), '2026-11-30');
  assert.equal(shiftDayKey('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDayKey('2028-02-28', 1), '2028-02-29');
  assert.equal(shiftDayKey('2027-02-28', 1), '2027-03-01');
  assert.equal(oldestDayKey('2026-11-10', 30), '2026-10-12');
  assert.equal(oldestDayKey('2026-11-10', 1), '2026-11-10');
  assert.equal(isFutureDay('2026-11-11', '2026-11-10'), true);
  assert.equal(isFutureDay('2026-11-10', '2026-11-10'), false);
});

test('date titles and weekdays format for Chinese', () => {
  assert.equal(formatDateTitle('2026-11-10', t), '11月10日');
  assert.equal(formatDateTitle('2026-01-05', t), '1月5日');
  assert.equal(formatWeekday('2026-11-10', t), '星期二');
  assert.equal(formatWeekday('2026-11-08', t), '星期日');
});

test('month keys shift across year boundaries', () => {
  assert.equal(monthKeyOf('2026-11-10'), '2026-11');
  assert.equal(shiftMonthKey('2026-01', -1), '2025-12');
  assert.equal(shiftMonthKey('2026-12', 1), '2027-01');
  assert.equal(shiftMonthKey('2026-11', 13), '2027-12');
  assert.equal(shiftMonthKey('2026-11', -13), '2025-10');
  assert.equal(monthTitle('2026-11', t), '2026年11月');
  assert.equal(monthTitle('2027-01', t), '2027年1月');
});

test('the calendar grid is six Monday-first rows covering the visible month', () => {
  const november = monthGridRange('2026-11');
  assert.equal(november.cells.length, 42);
  assert.equal(november.from, '2026-10-26');
  assert.equal(november.to, '2026-12-06');
  assert.equal(new Date(2026, 9, 26).getDay(), 1, 'the grid starts on a Monday');
  assert.equal(november.cells.findIndex(day => monthKeyOf(day) === '2026-11'), 6);
  assert.equal(november.cells.filter(day => monthKeyOf(day) === '2026-11').length, 30);
  const lastInMonth = november.cells.findLastIndex(day => monthKeyOf(day) === '2026-11');
  assert.equal(lastInMonth, 35);
  assert.equal(november.cells.length - lastInMonth - 1, 6, 'six trailing days fill the last row');
  assert.equal(monthKeyOf(november.cells[36]), '2026-12');
  assert.equal(november.cells[41], '2026-12-06');

  const june = monthGridRange('2026-06');
  assert.equal(june.from, '2026-06-01');
  assert.equal(june.to, '2026-07-12');
  assert.equal(june.cells.findIndex(day => monthKeyOf(day) === '2026-06'), 0);

  const january = monthGridRange('2027-01');
  assert.equal(january.from, '2026-12-28');
  assert.equal(january.to, '2027-02-07');
  assert.equal(january.cells.filter(day => monthKeyOf(day) === '2027-01').length, 31);
});

test('calendar dots come from the CalendarView entry only', () => {
  assert.equal(calendarDot({ day: '2026-11-10', state: 'present', total: 3, unread: 2 }), 'present');
  assert.equal(calendarDot({ day: '2026-11-09', state: 'read', total: 3, unread: 0 }), 'read');
  assert.equal(calendarDot({ day: '2026-11-08', state: 'missing', total: 0, unread: 0 }), null);
  assert.equal(calendarDot({ day: '2026-11-07', state: 'present', total: 0, unread: 0 }), null);
  assert.equal(calendarDot(null), null);
  assert.equal(calendarDot(undefined), null);
});

test('a local read rewrites only the viewed calendar day', () => {
  const entries = new Map([
    ['2026-11-09', { day: '2026-11-09', state: 'read', total: 5, unread: 0 }],
    ['2026-11-10', { day: '2026-11-10', state: 'present', total: 3, unread: 2 }],
  ]);

  const next = calendarWithDay(entries, '2026-11-10', 3, 0);
  assert.notEqual(next, entries, 'returns a new Map');
  assert.deepEqual(
    next.get('2026-11-10'),
    { day: '2026-11-10', state: 'read', total: 3, unread: 0 },
    'present becomes read when unread hits zero',
  );
  assert.deepEqual(next.get('2026-11-09'), entries.get('2026-11-09'), 'other days stay untouched');
  assert.equal(entries.get('2026-11-10').state, 'present', 'the input Map is not mutated');

  assert.equal(calendarWithDay(entries, '2026-11-10', 3, 1).get('2026-11-10').state, 'present');

  const fromNothing = calendarWithDay(undefined, '2026-11-10', 2, 2);
  assert.ok(fromNothing instanceof Map);
  assert.equal(fromNothing.get('2026-11-10').state, 'present');

  const removed = calendarWithDay(entries, '2026-11-09', 0, 0);
  assert.equal(removed.has('2026-11-09'), false, 'a day with no content loses its entry');
  assert.ok(removed.has('2026-11-10'));
});

test('filter helpers project channel items and count unread rows', () => {
  const items = [
    { id: 'a', read: false },
    { id: 'b', read: true },
    { id: 'c', read: false },
  ];
  assert.equal(unreadCount(items), 2);
  assert.equal(unreadCount([]), 0);
  assert.equal(unreadCount(null), 0);
  assert.deepEqual(filterItems(items, 'unread').map(item => item.id), ['a', 'c']);
  assert.equal(filterItems(items, 'all'), items);

  const sections = [
    { source: { id: 'github' }, items: [{ id: 'a', read: false }, { id: 'b', read: true }] },
    { source: { id: 'hn' }, items: [{ id: 'c', read: false }] },
    { source: { id: 'empty' }, items: [] },
  ];
  assert.deepEqual(itemsForChannel(sections, 'all').map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(itemsForChannel(sections, 'github').map(item => item.id), ['a', 'b']);
  assert.equal(unreadCount(itemsForChannel(sections, 'github')), 1);
  assert.deepEqual(itemsForChannel(sections, 'missing'), []);
  assert.deepEqual(itemsForChannel(null, 'all'), []);
});

test('channel names come from the locale and fall back to the descriptor name', () => {
  assert.equal(channelName({ id: 'github_trending', name: 'GitHub Trending' }, t), 'GitHub Trending');
  assert.equal(channelName({ id: 'bestblogs_brief', name: 'BestBlogs Daily Brief' }, t), 'BestBlogs 每日早报');
  assert.equal(channelName({ id: 'unknown_source', name: 'Unknown Source' }, t), 'Unknown Source');
  assert.equal(channelName({ id: '', name: 'Name only' }, t), 'Name only');
  assert.equal(channelName(null, t), '');
});

test('relative time follows the just-now, minutes, hours, clock, yesterday, date ladder', () => {
  const now = new Date('2026-11-10T12:00:00');
  assert.equal(formatRelativeTime('2026-11-10T12:00:00', now, t), '刚刚');
  assert.equal(formatRelativeTime('2026-11-10T11:59:30', now, t), '刚刚');
  assert.equal(formatRelativeTime('2026-11-10T11:59:00', now, t), '1 分钟前');
  assert.equal(formatRelativeTime('2026-11-10T11:00:00', now, t), '1 小时前');
  assert.equal(formatRelativeTime('2026-11-10T06:30:00', now, t), '5 小时前');
  assert.equal(formatRelativeTime('2026-11-10T05:00:00', now, t), '05:00');
  assert.equal(formatRelativeTime('2026-11-09T22:00:00', now, t), '昨天 22:00');
  assert.equal(formatRelativeTime('2026-11-01T08:00:00', now, t), '11月1日');
  assert.equal(formatRelativeTime('2026-11-10T13:00:00', now, t), '刚刚');
  assert.equal(formatRelativeTime('', now, t), '—');
  assert.equal(formatRelativeTime('not-a-date', now, t), '—');
});

test('counts format deterministically', () => {
  assert.equal(formatCompact(999), '999');
  assert.equal(formatCompact(1000), '1k');
  assert.equal(formatCompact(8200), '8.2k');
  assert.equal(formatCompact(15100), '15.1k');
});

test('GitHub item meta shows total stars and language, dropping the daily delta', () => {
  const now = new Date('2026-11-10T12:00:00');
  const extra = { rank: 1, stars: 8200, starsToday: 1204, language: 'TypeScript' };
  assert.deepEqual(githubStats(extra), { stars: '8.2k', language: 'TypeScript' });
  assert.deepEqual(githubStats({ ...extra, language: '' }), { stars: '8.2k', language: '' });
  assert.equal(githubStats({ starsToday: 12 }), null);
  assert.equal(githubMeta(extra), '8.2k · TypeScript');
  assert.equal(githubMeta({ ...extra, language: '' }), '8.2k');
  assert.equal(githubMeta({ stars: 8200 }), '8.2k');

  const base = { title: 'openai/dot', url: 'https://github.com/openai/dot', publishedAt: '2026-11-10T11:00:00', extra };
  assert.equal(itemMeta({ ...base, read: false }, now, t), '8.2k · TypeScript');
  assert.equal(itemMeta({ ...base, read: true }, now, t), '8.2k · TypeScript · 已读');
});

test('non-GitHub rows use host and time, then the read marker', () => {
  const now = new Date('2026-11-10T12:00:00');
  const item = {
    title: 'Cloudflare Workers',
    url: 'https://www.sspai.com/post/1',
    publishedAt: '2026-11-10T11:00:00',
    extra: {},
    read: false,
  };
  assert.equal(itemMeta(item, now, t), 'sspai.com · 1 小时前');
  assert.equal(itemMeta({ ...item, read: true }, now, t), 'sspai.com · 1 小时前 · 已读');
});

test('brief meta parses the header fields and clips keywords to five', () => {
  const meta = {
    briefDate: '2026-11-11',
    episodeTitle: ' EP233 · 今日主题 ',
    intro: '判断模型选择与改进方法。',
    keywords: ['旗舰模型', '图像开源', '', '智能体评估', '知识循环', '具身智能', 'extra'],
    cover: 'https://media.bestblogs.dev/cover.webp',
    webUrl: 'https://www.bestblogs.dev/explore/brief/2026-11-11',
    locale: 'zh',
    notPublished: false,
    detailStatus: 'degraded',
    dropped: 0,
  };
  assert.deepEqual(briefMeta({ meta }), {
    episodeTitle: 'EP233 · 今日主题',
    intro: '判断模型选择与改进方法。',
    keywords: ['旗舰模型', '图像开源', '智能体评估', '知识循环', '具身智能'],
    cover: 'https://media.bestblogs.dev/cover.webp',
    webUrl: 'https://www.bestblogs.dev/explore/brief/2026-11-11',
    detailStatus: 'degraded',
  });

  assert.equal(briefMeta({}), null, 'a snapshot without meta has no header');
  assert.equal(briefMeta({ meta: null }), null);
  assert.equal(briefMeta({ meta: [] }), null);
  assert.equal(briefMeta({ meta: {} }), null, 'an empty meta record has nothing to render');
  assert.equal(briefMeta({ meta: { keywords: 'not-an-array' } }), null);
  assert.equal(briefMeta(undefined), null);
  assert.equal(briefMeta({ meta: { webUrl: 'https://example.com/brief' } }).detailStatus, 'ok');
  assert.deepEqual(briefMeta({ meta: { detailStatus: 'weird' } }), null);
});

test('brief row meta joins source and relative time and leaves a missing score out', () => {
  const now = new Date('2026-11-10T12:00:00');
  const item = {
    title: 'Gemini 4 Carbon',
    url: 'https://www.bestblogs.dev/article/1',
    publishedAt: '2026-11-10T11:00:00',
    extra: { source: 'Google DeepMind News', score: 92 },
  };
  assert.deepEqual(briefItemMeta(item, now, t), {
    text: 'Google DeepMind News · 1 小时前',
    score: 92,
  });
  assert.deepEqual(briefItemMeta({ ...item, extra: { source: 'Google' } }, now, t), {
    text: 'Google · 1 小时前',
    score: null,
  });
  assert.deepEqual(briefItemMeta({ ...item, publishedAt: '' }, now, t), {
    text: 'Google DeepMind News',
    score: 92,
  });
  assert.deepEqual(briefItemMeta({ ...item, extra: { score: 0 } }, now, t).score, 0);
  assert.deepEqual(briefItemMeta({ ...item, extra: { source: 'S', score: '92' } }, now, t), {
    text: 'S · 1 小时前',
    score: null,
  });
  assert.deepEqual(briefItemMeta({ ...item, extra: {} }, now, t), { text: '1 小时前', score: null });
  assert.deepEqual(briefItemMeta({}, now, t), { text: '', score: null });
});

test('status labels and counters map to copy', () => {
  assert.equal(statusLabel('ok', t), '正常');
  assert.equal(statusLabel('error', t), '抓取失败');
  assert.equal(statusLabel('idle', t), '尚未拉取');
  assert.equal(countsLabel(3, 10, t), '3 条未读 / 10 条');
  assert.equal(percentRead(3, 4), 75);
  assert.equal(percentRead(0, 0), 0);
  assert.equal(percentRead(5, 4), 100);
});

test('a translated description renders only in a Chinese UI and keeps the original in title', () => {
  const item = {
    description: 'Public repository for Agent Skills',
    descriptionTranslated: 'Agent Skills 的公共仓库',
    descriptionLang: 'zh-CN',
  };
  assert.deepEqual(descriptionOf(item, 'zh-CN'), {
    text: 'Agent Skills 的公共仓库',
    title: 'Public repository for Agent Skills',
    lang: 'zh-CN',
    translated: true,
  });
  assert.deepEqual(descriptionOf(item, 'en-US'), {
    text: 'Public repository for Agent Skills',
    title: '',
    lang: 'en',
    translated: false,
  });
  assert.deepEqual(descriptionOf(item, 'ja'), {
    text: 'Public repository for Agent Skills',
    title: '',
    lang: 'en',
    translated: false,
  });
});

test('without a translation the original description stays visible', () => {
  assert.deepEqual(descriptionOf({ description: 'Plain English text' }, 'zh-CN'), {
    text: 'Plain English text',
    title: '',
    lang: 'en',
    translated: false,
  });
  assert.deepEqual(descriptionOf({ description: '开源设计系统' }, 'zh-CN'), {
    text: '开源设计系统',
    title: '',
    lang: 'zh-CN',
    translated: false,
  });
  assert.deepEqual(descriptionOf({ description: '   ', descriptionTranslated: '译文' }, 'zh-CN'), {
    text: '',
    title: '',
    lang: undefined,
    translated: false,
  });
  assert.deepEqual(descriptionOf({}, 'zh-CN'), {
    text: '',
    title: '',
    lang: undefined,
    translated: false,
  });
});

test('isChineseUi and textLanguage classify only what the row needs', () => {
  assert.equal(isChineseUi('zh'), true);
  assert.equal(isChineseUi('zh-CN'), true);
  assert.equal(isChineseUi('en-US'), false);
  assert.equal(isChineseUi('ja'), false);
  assert.equal(isChineseUi(''), false);
  assert.equal(isChineseUi(null), false);
  assert.equal(textLanguage('这是一个中文仓库，用来演示本地化'), 'zh-CN');
  assert.equal(textLanguage('A general purpose simulator'), 'en');
  // English-dominant with a Chinese product name: the host does not treat it as Chinese either.
  assert.equal(textLanguage('openai/dot 是一个仓库'), 'en');
  assert.equal(textLanguage('1234'), undefined);
  assert.equal(textLanguage(''), undefined);
});

test('sectionHead hides translate when it is off or nothing is missing', () => {
  const section = {
    count: 5,
    status: 'ok',
    translation: { enabled: true, missing: 2, error: '' },
  };
  assert.deepEqual(sectionHead(section, { fetch: false, translate: false }, t), {
    statusText: '2 条未翻译',
    showTranslate: true,
    translateLabel: '翻译',
    translateDisabled: false,
    refetchDisabled: false,
    showError: false,
    errorMessage: '',
  });
  assert.equal(sectionHead({ ...section, translation: { enabled: true, missing: 0, error: '' } },
    { fetch: false, translate: false }, t).showTranslate, false);
  assert.equal(sectionHead({ ...section, translation: { enabled: false, missing: 2, error: '' } },
    { fetch: false, translate: false }, t).showTranslate, false);
  assert.equal(sectionHead({ ...section, translation: { enabled: true, missing: 0, error: '' } },
    { fetch: false, translate: false }, t).statusText, '翻译完成');
  assert.equal(sectionHead({ ...section, translation: { enabled: false, missing: 0, error: '' } },
    { fetch: false, translate: false }, t).statusText, '翻译已关闭');
});

test('sectionHead relabels a failed translate and disables only what is running', () => {
  const section = {
    count: 5,
    status: 'ok',
    translation: { enabled: true, missing: 2, error: '模型返回内容不是合法 JSON。' },
  };
  const idle = sectionHead(section, { fetch: false, translate: false }, t);
  assert.equal(idle.translateLabel, '重试');
  assert.equal(idle.showError, true);
  assert.equal(idle.errorMessage, '模型返回内容不是合法 JSON。');
  assert.equal(idle.refetchDisabled, false);

  const translating = sectionHead(section, { fetch: false, translate: true }, t);
  assert.equal(translating.translateLabel, '翻译中…');
  assert.equal(translating.translateDisabled, true);
  assert.equal(translating.refetchDisabled, false, 'a translation leaves refresh enabled');
  assert.equal(translating.showError, false, 'the error row hides while a retry runs');
  assert.equal(translating.statusText, '正在翻译 2 条 · 最多 60 秒');

  const fetching = sectionHead(section, { fetch: true, translate: false }, t);
  assert.equal(fetching.refetchDisabled, true);
  assert.equal(fetching.translateDisabled, true);
  assert.equal(fetching.statusText, '正在拉取并翻译…');
  assert.equal(sectionHead({ ...section, translation: { enabled: false, missing: 2, error: '' } },
    { fetch: true, translate: false }, t).statusText, '翻译已关闭');
});

test('sectionHead hides translation entirely when the channel lacks the capability', () => {
  const section = {
    count: 5,
    status: 'ok',
    capabilities: { backfill: true, translation: false },
    translation: { enabled: true, missing: 3, error: '模型返回内容不是合法 JSON。' },
  };
  const head = sectionHead(section, { fetch: true, translate: false }, t);
  assert.equal(head.statusText, '', 'a BestBlogs section never shows 缺译 or 翻译已关闭');
  assert.equal(head.showTranslate, false);
  assert.equal(head.showError, false);
  assert.equal(head.errorMessage, '');
  assert.equal(head.translateLabel, '');
});

test('section cards stay visible for their own empty state and hide missing without backfill', () => {
  const base = { source: { id: 'bestblogs_brief' }, count: 0, status: 'ok', items: [] };
  assert.equal(sectionVisible({ ...base, status: 'pending' }, ''), true);
  assert.equal(sectionVisible({ ...base, status: 'notPublished' }, ''), true);
  assert.equal(sectionVisible({ ...base, status: 'missing', capabilities: { backfill: true } }, ''), true);
  assert.equal(sectionVisible({ ...base, status: 'missing', capabilities: { backfill: false } }, ''), false);
  assert.equal(sectionVisible({ ...base, status: 'missing' }, ''), false);
  assert.equal(sectionVisible(base, ''), false, 'an empty ok section keeps the day-level empty state');
  assert.equal(sectionVisible({ ...base, status: 'ok', items: [{ id: 'a' }] }, ''), true);
  assert.equal(sectionVisible({ ...base, status: 'error' }, ''), true);
  assert.equal(sectionVisible({ ...base, status: 'corrupt' }, ''), true);
  assert.equal(sectionVisible(base, '请求超时'), true, 'a local fetch error always shows its card');
  assert.equal(sectionVisible(null, ''), false);

  assert.equal(sectionEmptyState({ status: 'pending' }), 'pending');
  assert.equal(sectionEmptyState({ status: 'notPublished' }), 'notPublished');
  assert.equal(sectionEmptyState({ status: 'missing', capabilities: { backfill: true } }), 'missing');
  assert.equal(sectionEmptyState({ status: 'missing' }), 'none');
  assert.equal(sectionEmptyState({ status: 'ok' }), 'none');
  assert.equal(sectionEmptyState({ status: 'error' }), 'none');
  assert.equal(sectionEmptyState(null), 'none');
});

test('a manual channel owns its empty and never-pulled cards on every day', () => {
  const manual = {
    source: { id: 'x_bookmarks', type: 'x-bookmarks' },
    cadence: 'manual',
    capabilities: { backfill: false, actions: ['deleteBookmark'], manualBatch: true },
    items: [],
    batchSize: 3,
  };
  assert.equal(sectionEmptyState({ ...manual, status: 'empty' }), 'empty');
  assert.equal(sectionEmptyState({ ...manual, status: 'missing' }), 'missing');
  assert.equal(sectionVisible({ ...manual, status: 'empty' }, ''), true);
  assert.equal(sectionVisible({ ...manual, status: 'missing' }, ''), true);
  assert.equal(sectionVisible({ ...manual, status: 'missing', items: [{ id: 'a' }] }, ''), true);
  assert.equal(sectionEmptyState({ status: 'empty' }), 'none', 'empty stays a manual-only state');
  assert.equal(sectionEmptyState({ status: 'empty', cadence: 'daily' }), 'none');

  const daily = {
    source: { id: 'github_trending' },
    cadence: 'daily',
    capabilities: { backfill: true },
    items: [],
  };
  assert.equal(sectionEmptyState({ ...daily, status: 'missing' }), 'missing');
  assert.equal(sectionVisible({ ...daily, status: 'missing' }, ''), true);
  assert.equal(sectionEmptyState({ ...daily, status: 'empty' }), 'none');
});

test('tweet meta formats the author line and drops zero or missing counts', () => {
  const now = new Date('2026-11-10T12:00:00');
  const item = {
    title: 'first line',
    description: 'body',
    publishedAt: '2026-11-10T11:00:00',
    extra: { author: '林一', handle: 'linyi', favorites: 216, views: 1816 },
  };
  assert.deepEqual(tweetMeta(item, now, t), {
    author: '林一',
    handle: '@linyi',
    time: '1 小时前',
    likes: '♥ 216',
    reads: '1.8k 阅读',
    deleted: false,
  });
  assert.deepEqual(tweetMeta({
    ...item,
    extra: { author: '林一', handle: '@linyi', favorites: 0, views: null },
  }, now, t), {
    author: '林一',
    handle: '@linyi',
    time: '1 小时前',
    likes: '',
    reads: '',
    deleted: false,
  });
  assert.deepEqual(tweetMeta({ extra: {} }, now, t), {
    author: '',
    handle: '',
    time: '',
    likes: '',
    reads: '',
    deleted: false,
  });
  assert.equal(tweetMeta({ ...item, publishedAt: 'not-a-date' }, now, t).time, '');
});

test('a bookmark deleted on X keeps its card and loses only the delete action', () => {
  const item = {
    id: 'x_bookmarks__1',
    read: false,
    extra: { author: 'A', xDeletedAt: '2026-11-11T06:00:00.000Z' },
  };
  assert.equal(tweetDeleted(item), true);
  assert.equal(tweetDeleted({ ...item, extra: { author: 'A' } }), false);
  assert.equal(tweetDeleted({ ...item, extra: { xDeletedAt: '' } }), false);
  assert.equal(tweetDeleted({ ...item, extra: { xDeletedAt: 42 } }), false);
  assert.equal(tweetMeta(item, new Date('2026-11-11T07:00:00'), t).deleted, true);

  const section = { capabilities: { actions: ['deleteBookmark'] } };
  assert.deepEqual(tweetActions(section, item), { delete: false, read: true, open: true });
});

test('tweet display text keeps paragraph lines but drops blank lines', () => {
  assert.equal(tweetDisplayText('a\n\nb'), 'a\nb');
  assert.equal(tweetDisplayText('a\n\n\nb'), 'a\nb');
  assert.equal(tweetDisplayText('a\n \n\tb'), 'a\nb');
  assert.equal(tweetDisplayText('a\r\n\r\nb'), 'a\nb');
  assert.equal(tweetDisplayText('\n\na\n\n'), 'a');
  assert.equal(tweetDisplayText('a\nb'), 'a\nb');
  assert.equal(tweetDisplayText('a\n\n'), 'a');
  assert.equal(tweetDisplayText(''), '');
  assert.equal(tweetDisplayText(null), '');
  assert.equal(tweetDisplayText(undefined), '');
});

test('tweet actions follow the channel capability and the read state', () => {
  const section = { capabilities: { actions: ['deleteBookmark'] } };
  const item = { id: 'x_bookmarks__1', read: false, extra: {} };
  assert.deepEqual(tweetActions(section, item), { delete: true, read: true, open: true });
  assert.deepEqual(tweetActions(section, { ...item, read: true }), { delete: true, read: false, open: true });
  assert.deepEqual(tweetActions({ capabilities: { actions: [] } }, item), {
    delete: false,
    read: true,
    open: true,
  });
  assert.deepEqual(tweetActions({ capabilities: {} }, item), { delete: false, read: true, open: true });
  assert.deepEqual(tweetActions({}, item), { delete: false, read: true, open: true });
  assert.deepEqual(tweetActions({
    capabilities: { actions: ['deleteBookmark', 'other'] },
  }, item).delete, true);
});

test('the pull control names the batch size and shows only on today', () => {
  const section = {
    source: { id: 'x_bookmarks', type: 'x-bookmarks' },
    cadence: 'manual',
    batchSize: 5,
  };
  assert.equal(isManualSection(section), true);
  assert.equal(isTweetSection(section), true);
  assert.equal(isTweetSection({ source: { type: 'rss' } }), false);
  assert.equal(batchSizeOf(section), 5);
  assert.equal(batchSizeOf({ batchSize: 0 }), 3);
  assert.equal(batchSizeOf({ batchSize: 21 }), 3);
  assert.equal(batchSizeOf({}), 3);

  assert.deepEqual(
    pullControl(section, { day: '2026-11-11', today: '2026-11-11' }, t),
    { show: true, label: '拉取 5 条', disabled: false },
  );
  assert.deepEqual(
    pullControl(section, { day: '2026-11-11', today: '2026-11-11', busy: true }, t),
    { show: true, label: '拉取中…', disabled: true },
  );
  assert.deepEqual(
    pullControl(section, { day: '2026-11-10', today: '2026-11-11' }, t),
    { show: false, label: '', disabled: false },
  );
  assert.equal(pullControl({ ...section, cadence: 'daily' }, { day: '2026-11-11', today: '2026-11-11' }, t).show, false);
  assert.equal(pullLabel({ batchSize: 3 }, false, t), '拉取 3 条');
});

test('the pull summary reads the last pull and names the 1000-item cap', () => {
  const section = (lastPull) => ({ cadence: 'manual', meta: { lastPull } });
  assert.equal(pullSummary(section({ added: 3, exhausted: false, truncated: false }), t), '已拉取 3 条');
  assert.equal(pullSummary(section({ added: 0, exhausted: true, truncated: false }), t), '没有更多新书签');
  assert.equal(
    pullSummary(section({ added: 0, exhausted: false, truncated: true }), t),
    '还有更早的书签未扫描（本次上限 1000 条）',
  );
  assert.equal(
    pullSummary(section({ added: 2, exhausted: false, truncated: true }), t),
    '还有更早的书签未扫描（本次上限 1000 条）',
    'the scan cap outranks the added count',
  );
  assert.equal(pullSummary({ cadence: 'manual', meta: {} }, t), '');
  assert.equal(pullSummary({ cadence: 'manual' }, t), '');
  assert.equal(pullSummary({ cadence: 'daily', meta: { lastPull: { added: 2 } } }, t), '');
});

test('manual empty copy asks for a first pull today and points back to today in history', () => {
  const manual = {
    source: { id: 'x_bookmarks', type: 'x-bookmarks' },
    cadence: 'manual',
    batchSize: 3,
    items: [],
  };
  assert.deepEqual(manualEmptyCopy({ ...manual, status: 'missing' }, true, t), {
    title: '还没有拉取 X 书签',
    sub: '从 X 拉取 3 条，读完可一键删除',
  });
  assert.deepEqual(manualEmptyCopy({ ...manual, status: 'missing' }, false, t), {
    title: '该日没有拉取 X 书签',
    sub: '',
  });
  assert.deepEqual(
    manualEmptyCopy({ ...manual, status: 'empty', meta: { lastPull: { added: 0, exhausted: true } } }, true, t),
    { title: '没有更多新书签', sub: '' },
  );
  assert.deepEqual(
    manualEmptyCopy({ ...manual, status: 'empty', meta: { lastPull: { added: 0, truncated: true } } }, true, t),
    { title: '还有更早的书签未扫描（本次上限 1000 条）', sub: '' },
  );
  assert.equal(manualEmptyCopy({ ...manual, status: 'ok' }, true, t), null);
  assert.equal(manualEmptyCopy({ status: 'missing', cadence: 'daily' }, true, t), null);
});

test('a global fetch skips manual channels', () => {
  assert.deepEqual(fetchableSourceIds({
    sources: [
      { id: 'github_trending', cadence: 'daily' },
      { id: 'bestblogs_brief', cadence: 'daily' },
      { id: 'x_bookmarks', cadence: 'manual' },
    ],
  }), ['github_trending', 'bestblogs_brief']);
  assert.deepEqual(fetchableSourceIds({ sources: [{ id: 'x_bookmarks', cadence: 'manual' }] }), []);
  assert.deepEqual(fetchableSourceIds(null), []);
});

test('channelStatusLine reports today success, a spent budget, and the raw error', () => {
  const now = new Date('2026-11-10T12:00:00');
  const ok = {
    status: 'ok',
    error: '',
    lastSuccessAt: '2026-11-10T08:00:00',
    todayCount: 11,
    autoAttempts: { day: '2026-11-10', count: 1 },
  };
  assert.deepEqual(channelStatusLine(ok, now, t), {
    text: '今天 08:00 成功 · 11 条',
    tone: 'ok',
    exhausted: false,
  });
  const exhausted = {
    status: 'error',
    error: '请求超时',
    lastSuccessAt: '2026-11-09T08:00:00',
    todayCount: 0,
    autoAttempts: { day: '2026-11-10', count: 3 },
  };
  assert.deepEqual(channelStatusLine(exhausted, now, t), {
    text: '今天不再自动拉取',
    tone: 'error',
    exhausted: true,
  });
  const failed = { ...exhausted, autoAttempts: { day: '2026-11-10', count: 1 } };
  assert.deepEqual(channelStatusLine(failed, now, t), {
    text: '请求超时',
    tone: 'error',
    exhausted: false,
  });
  const idle = {
    status: 'idle',
    error: '',
    lastSuccessAt: '',
    todayCount: 0,
    autoAttempts: { day: '', count: 0 },
  };
  assert.deepEqual(channelStatusLine(idle, now, t), {
    text: '尚未抓取',
    tone: 'idle',
    exhausted: false,
  });
  assert.deepEqual(channelStatusLine({
    ...idle,
    lastSuccessAt: '2026-11-09T08:00:00',
  }, now, t), {
    text: '昨天 08:00',
    tone: 'idle',
    exhausted: false,
  });
  assert.deepEqual(channelStatusLine({
    ...idle,
    lastOutcome: 'pending',
    lastAttemptAt: '2026-11-10T06:00:00',
    pendingAttempts: { day: '2026-11-10', count: 1 },
  }, now, t), {
    text: '今日早报尚未发布',
    tone: 'idle',
    exhausted: false,
  });
  // A manual pending does not spend the auto budget, so the attempt time still
  // decides whether today is pending.
  assert.deepEqual(channelStatusLine({
    ...idle,
    lastOutcome: 'pending',
    lastAttemptAt: '2026-11-10T06:30:00',
    pendingAttempts: { day: '', count: 0 },
  }, now, t), {
    text: '今日早报尚未发布',
    tone: 'idle',
    exhausted: false,
  });
  assert.deepEqual(channelStatusLine({
    ...idle,
    lastOutcome: 'pending',
    lastAttemptAt: '2026-11-09T06:00:00',
    pendingAttempts: { day: '2026-11-09', count: 1 },
  }, now, t), {
    text: '尚未抓取',
    tone: 'idle',
    exhausted: false,
  });
  // A pending retry after a network error is the latest attempt: show pending,
  // not the stale failure count that the host keeps for the retry budget.
  assert.deepEqual(channelStatusLine({
    ...idle,
    status: 'error',
    lastOutcome: 'pending',
    lastAttemptAt: '2026-11-10T06:00:00',
    pendingAttempts: { day: '2026-11-10', count: 1 },
  }, now, t), {
    text: '今日早报尚未发布',
    tone: 'idle',
    exhausted: false,
  });
  assert.deepEqual(channelStatusLine({
    ...idle,
    status: 'error',
    lastOutcome: 'pending',
    lastAttemptAt: '2026-11-10T06:00:00',
    pendingAttempts: { day: '2026-11-10', count: 3 },
  }, now, t), {
    text: '今天不再自动拉取',
    tone: 'error',
    exhausted: true,
  });
  assert.deepEqual(channelStatusLine(null, now, t), { text: '', tone: 'idle', exhausted: false });
});

test('a spent budget stops winning once today has a success', () => {
  const now = new Date('2026-11-10T12:00:00');
  assert.deepEqual(channelStatusLine({
    status: 'ok',
    error: '',
    lastSuccessAt: '2026-11-10T08:00:00',
    todayCount: 11,
    autoAttempts: { day: '2026-11-10', count: 3 },
  }, now, t).exhausted, false);
});

test('translateOutcome surfaces a partial failure with no host error', () => {
  assert.equal(translateOutcome({ translated: 0, failed: 2, error: '' }, t), '有 2 条翻译失败，可重试');
  assert.equal(translateOutcome({ translated: 0, failed: 2, error: '模型返回内容不是合法 JSON。' }, t),
    '模型返回内容不是合法 JSON。');
  assert.equal(translateOutcome({ translated: 3, failed: 0, error: '' }, t), '');
  assert.equal(translateOutcome(null, t), '');
});

test('both locale files expose the same key set', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
});
