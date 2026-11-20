/**
 * Pure formatting and day arithmetic for the feedUltra panel. Every visible
 * string comes from the locale seat passed in as `t`, so this module owns shape
 * and boundaries, not copy.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const RELATIVE_HOURS = 6;
const STAR = '★';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function partsOf(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return { year, month, day };
}

/** Local calendar day key for an instant. */
export function dayKeyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Shift a day key by whole local days, across month and year boundaries. */
export function shiftDayKey(dayKey, delta) {
  const { year, month, day } = partsOf(dayKey);
  const date = new Date(year, month - 1, day + delta);
  return dayKeyOf(date);
}

/** `YYYY-MM` key of a day key, the calendar's unit of navigation. */
export function monthKeyOf(dayKey) {
  return dayKey.slice(0, 7);
}

function monthPartsOf(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return { year, month };
}

/** Shift a month key by whole months, across year boundaries. */
export function shiftMonthKey(monthKey, delta) {
  const { year, month } = monthPartsOf(monthKey);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function monthTitle(monthKey, t) {
  const { year, month } = monthPartsOf(monthKey);
  return t('calendar.title', { year, month: t(`monthLong.${month}`) });
}

const GRID_CELLS = 42;

/**
 * The fixed six-row, Monday-first grid containing a month. The range spans
 * the whole grid, including the leading and trailing days of adjacent months,
 * so the host returns dot state for every rendered day in one call.
 */
export function monthGridRange(monthKey) {
  const { year, month } = monthPartsOf(monthKey);
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const cells = Array.from(
    { length: GRID_CELLS },
    (_, index) => dayKeyOf(new Date(year, month - 1, 1 - offset + index)),
  );
  return { from: cells[0], to: cells[cells.length - 1], cells };
}

/**
 * Dot state for one calendar day, read only from the CalendarView entry.
 * A missing entry or a missing state has no dot; unread content is solid,
 * fully read content is a hollow ring.
 */
export function calendarDot(entry) {
  if (!entry || entry.state === 'missing') return null;
  const total = Number(entry.total) || 0;
  const unread = Number(entry.unread) || 0;
  if (unread > 0) return 'present';
  if (total > 0) return 'read';
  return null;
}

/**
 * Calendar entries with one day rewritten after a read, so a read costs no
 * 42-day RPC. `total === 0` removes the day outright.
 */
export function calendarWithDay(entries, day, total, unread) {
  const next = new Map(entries ?? []);
  if (total > 0) {
    next.set(day, {
      ...next.get(day),
      day,
      total,
      unread,
      state: unread > 0 ? 'present' : 'read',
    });
  } else {
    next.delete(day);
  }
  return next;
}

/** Items in one channel (`all` means every source). */
export function itemsForChannel(sections, channel) {
  const rows = channel === 'all'
    ? sections ?? []
    : (sections ?? []).filter(section => sectionKey(section) === channel);
  return rows.flatMap(section => section.items ?? []);
}

/** One section's identity in state and React, never the source id alone. */
export function sectionKeyOf(sourceId, channelId) {
  if (typeof sourceId !== 'string' || sourceId === '') return '';
  return typeof channelId === 'string' && channelId !== '' ? `${sourceId}:${channelId}` : sourceId;
}

export function sectionKey(section) {
  return sectionKeyOf(section?.source?.id, section?.channelId);
}

export function unreadCount(items) {
  return (items ?? []).reduce((sum, item) => sum + (item && !item.read ? 1 : 0), 0);
}

/** The manual daily channels: pulled on demand, never by the scheduler or "fetch all". */
export function isManualSection(section) {
  return section?.cadence === 'manual';
}

/**
 * The ids whose description is expanded. Insertion order is age, so a new id
 * goes last and the oldest leaves once the set passes the cap; a row that is
 * already expanded is simply removed.
 */
export function withToggledExpanded(set, id, limit = 200) {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  next.add(id);
  while (next.size > limit) next.delete(next.values().next().value);
  return next;
}

/** The X bookmark channel, selected by source type rather than source id. */
export function isTweetSection(section) {
  return section?.source?.type === 'x-bookmarks';
}

/** The pull batch size, defaulting to three when the section has no usable value. */
export function batchSizeOf(section) {
  const value = Number(section?.batchSize);
  if (!Number.isInteger(value) || value < 1 || value > 20) return 3;
  return value;
}

/** Source ids a global fetch should run: manual channels are pulled from their own header. */
export function fetchableSourceIds(sources) {
  return (sources?.sources ?? [])
    .filter(source => source && source.cadence !== 'manual')
    .map(source => source.id);
}

const TWEET_COUNT_MISSING = 0;

function tweetCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : TWEET_COUNT_MISSING;
}

/** A bookmark is deleted on X once the host stamps `extra.xDeletedAt`. */
export function tweetDeleted(item) {
  return typeof item?.extra?.xDeletedAt === 'string' && item.extra.xDeletedAt !== '';
}

/** X note text uses blank lines between paragraphs; the card shows one line break. */
export function tweetDisplayText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)*[ \t]*/g, '\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * A bookmark's relative time line. Once it is deleted on X the time is dropped:
 * the deleted tag beside it says the bookmark is gone.
 */
export function tweetTime(item, now, t) {
  if (tweetDeleted(item) || !item?.publishedAt) return '';
  const published = new Date(item.publishedAt);
  return Number.isNaN(published.getTime()) ? '' : formatRelativeTime(item.publishedAt, now, t);
}

/**
 * The like count segment of a bookmark's meta line, or '' when the source never
 * recorded one. The reader used it to judge a bookmark before opening it, so the
 * unified meta line keeps it instead of dropping it.
 */
export function tweetLikes(extra, t) {
  const favorites = tweetCount(extra?.favorites);
  return favorites === TWEET_COUNT_MISSING ? '' : t('x.likes', { n: formatCompact(favorites) });
}

/** The read-count segment of a bookmark's meta line, or '' when absent. */
export function tweetReads(extra, t) {
  const views = tweetCount(extra?.views);
  return views === TWEET_COUNT_MISSING ? '' : t('x.reads', { n: formatCompact(views) });
}

/** Which item actions the section capability allows; the row adds the item's own state. */
export function rowActions(section, item) {
  const declared = section?.capabilities?.actions;
  const canDelete = Array.isArray(declared) && declared.includes('deleteBookmark');
  return {
    delete: canDelete && !tweetDeleted(item),
    read: !item?.read,
    open: typeof item?.url === 'string' && item.url !== '',
  };
}

/** The pull button label, shared by the section header and its empty state. */
export function pullLabel(section, busy, t) {
  return busy ? t('x.pulling') : t('x.pull', { n: batchSizeOf(section) });
}

/**
 * Whether the manual pull button shows. Only today can pull; a historical day
 * keeps the section read-only even when it is empty.
 */
export function pullControl(section, { day, today, busy = false } = {}, t) {
  if (!isManualSection(section) || day !== today) return { show: false, label: '', disabled: false };
  return { show: true, label: pullLabel(section, busy, t), disabled: busy === true };
}

function lastPullOf(section) {
  const last = section?.meta?.lastPull;
  return last !== null && typeof last === 'object' && !Array.isArray(last) ? last : null;
}

/**
 * The one line a manual section shows after a pull: how many landed, that X has
 * nothing new, or that the 1000-item scan cap left older bookmarks unseen.
 */
export function pullSummary(section, t) {
  if (!isManualSection(section)) return '';
  const last = lastPullOf(section);
  if (!last) return '';
  if (last.truncated === true) return t('x.truncated');
  const added = Number(last.added) || 0;
  return added > 0 ? t('x.pulled', { n: added }) : t('x.noMore');
}

/**
 * The copy of a manual section's empty card. Today offers the first pull; a
 * historical day explains that nothing was pulled and points back to today.
 */
export function manualEmptyCopy(section, isToday, t) {
  if (!isManualSection(section)) return null;
  const kind = sectionEmptyState(section);
  if (kind === 'missing') {
    return isToday
      ? { title: t('x.emptyTitle'), sub: t('x.emptySub', { n: batchSizeOf(section) }) }
      : { title: t('x.pastEmpty'), sub: '' };
  }
  if (kind !== 'empty') return null;
  const last = lastPullOf(section);
  if (last && last.truncated === true) return { title: t('x.truncated'), sub: '' };
  if (last && !(Number(last.added) > 0)) return { title: t('x.noMore'), sub: '' };
  return isToday
    ? { title: t('x.emptyTitle'), sub: t('x.emptySub', { n: batchSizeOf(section) }) }
    : { title: t('x.pastEmpty'), sub: '' };
}

/**
 * A source's display name in the interface language. The descriptor name is the
 * neutral fallback, so an unknown channel or a t() that echoes its key still
 * renders a readable label.
 */
export function channelName(source, t) {
  const id = typeof source?.id === 'string' ? source.id : '';
  const name = typeof source?.name === 'string' ? source.name : '';
  if (id === '') return name;
  const key = `channel.${id}`;
  const label = t(key);
  return typeof label === 'string' && label !== '' && label !== key ? label : name;
}

export function filterItems(items, filter) {
  return filter === 'unread' ? (items ?? []).filter(item => !item.read) : items ?? [];
}

/** First day the retention window still holds, inclusive. */
export function oldestDayKey(todayKey, retentionDays) {
  const days = Math.max(1, retentionDays);
  return shiftDayKey(todayKey, -(days - 1));
}

/** Day keys sort lexically because they are zero padded ISO dates. */
export function isFutureDay(dayKey, todayKey) {
  return dayKey > todayKey;
}

export function formatDateTitle(dayKey, t) {
  const { month, day } = partsOf(dayKey);
  return t('date.title', { month: t(`month.${month}`), day });
}

export function formatWeekday(dayKey, t) {
  const { year, month, day } = partsOf(dayKey);
  return t(`weekday.${new Date(year, month - 1, day).getDay()}`);
}

/**
 * Relative time for a timestamp. The ladder is 刚刚, N 分钟前, N 小时前 (up to
 * six hours), today's clock time, 昨天 HH:mm, then a month/day date.
 */
export function formatRelativeTime(value, now, t) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return t('time.none');

  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE_MS) return t('time.justNow');
  if (diff < HOUR_MS) return t('time.minutes', { n: Math.floor(diff / MINUTE_MS) });
  if (diff < RELATIVE_HOURS * HOUR_MS) return t('time.hours', { n: Math.floor(diff / HOUR_MS) });

  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const today = dayKeyOf(now);
  const day = dayKeyOf(date);
  if (day === today) return clock;
  if (day === shiftDayKey(today, -1)) return t('time.yesterday', { time: clock });
  return formatDateTitle(day, t);
}


/** Compact star totals: 999, 1k, 8.2k, 15.1k. */
export function formatCompact(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 1000) return String(rounded);
  const thousands = Math.round((rounded / 1000) * 10) / 10;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
}

function isStarExtra(extra) {
  return extra !== null && typeof extra === 'object'
    && typeof extra.stars === 'number'
    && Number.isFinite(extra.stars);
}

/**
 * Normalized repository stats for the row meta: total stars and language.
 * The daily star delta is deliberately dropped from the row.
 */
export function githubStats(extra) {
  if (!isStarExtra(extra)) return null;
  return {
    stars: formatCompact(extra.stars),
    language: typeof extra.language === 'string' ? extra.language.trim() : '',
  };
}

/** GitHub meta text without the star glyph: `8.2k · TypeScript`, or empty. */
export function githubMeta(extra) {
  const stats = githubStats(extra);
  if (!stats) return '';
  return [stats.stars, stats.language].filter(Boolean).join(' · ');
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The brief header a Section's `meta` carries, or `null` when the snapshot has
 * no usable meta (older GitHub-era files, or a corrupt record). Keywords are
 * clipped to the five the card renders.
 */
export function briefMeta(section) {
  const raw = section?.meta;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const episodeTitle = trimmed(raw.episodeTitle);
  const intro = trimmed(raw.intro);
  const cover = trimmed(raw.cover);
  const webUrl = trimmed(raw.webUrl);
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.map(trimmed).filter(Boolean).slice(0, 5)
    : [];
  const detailStatus = raw.detailStatus === 'degraded' ? 'degraded' : 'ok';
  if (episodeTitle === '' && intro === '' && cover === '' && webUrl === '' && keywords.length === 0) {
    return null;
  }
  return { episodeTitle, intro, keywords, cover, webUrl, detailStatus };
}

/**
 * The meta line of one BestBlogs item: source, relative time, then the score
 * behind a star. A missing score drops together with its separator.
 */
export function briefItemMeta(item, now, t) {
  const extra = item?.extra ?? {};
  const when = item?.publishedAt ? formatRelativeTime(item.publishedAt, now, t) : '';
  return [trimmed(extra.source), when, briefScore(extra)].filter(Boolean).join(' · ');
}

function briefScore(extra) {
  const score = extra?.score;
  return typeof score === 'number' && Number.isFinite(score) ? `${STAR} ${formatCompact(score)}` : '';
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function genericMeta(item, now, t) {
  const feedTitle = typeof item?.extra?.feedTitle === 'string' ? item.extra.feedTitle.trim() : '';
  if (feedTitle !== '') {
    const published = item?.publishedAt ? new Date(item.publishedAt) : null;
    const when = published !== null && !Number.isNaN(published.getTime())
      ? `${pad2(published.getHours())}:${pad2(published.getMinutes())}`
      : '';
    return [feedTitle, when].filter(Boolean).join(' · ');
  }
  const host = hostOf(item.url);
  const when = item.publishedAt ? formatRelativeTime(item.publishedAt, now, t) : '';
  return [host, when].filter(Boolean).join(' · ');
}

/** Row subtitle: GitHub stars for GitHub items, host + time otherwise, plus the read marker. */
export function itemMeta(item, now, t) {
  const base = githubMeta(item.extra) || genericMeta(item, now, t);
  if (!item.read) return base;
  return base ? `${base} · ${t('row.read')}` : t('row.read');
}

export function statusLabel(status, t) {
  if (status === 'ok') return t('source.ok');
  if (status === 'error') return t('source.error');
  return t('source.idle');
}

export function countsLabel(unread, total, t) {
  return t('counts', { unread, total });
}

export function percentRead(read, total) {
  if (typeof total !== 'number' || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((read / total) * 100)));
}

/** Translations are Simplified Chinese, so only a Chinese interface shows them. */
export function isChineseUi(locale) {
  return typeof locale === 'string' && (locale === 'zh' || locale.startsWith('zh-'));
}

const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const LETTER = /\p{L}/u;

/** Mirrors the host's `isChinese` threshold so the label agrees with the skip rule. */
const HAN_RATIO_THRESHOLD = 0.5;

/**
 * Language tag for one description. Han has to be the majority of its letters: an
 * English-dominant row with a Chinese product name is still English, and a mixed
 * row must carry the same label the host used when it decided not to translate it.
 */
export function textLanguage(text) {
  const value = typeof text === 'string' ? text : '';
  let han = 0;
  let letters = 0;
  for (const char of value) {
    if (!LETTER.test(char)) continue;
    letters += 1;
    if (HAN.test(char)) han += 1;
  }
  if (letters === 0) return undefined;
  return han / letters > HAN_RATIO_THRESHOLD ? 'zh-CN' : 'en';
}

/**
 * The description a row shows. `descriptionLang` is only a label for the
 * translation and is never a gate; the host sets the translation and that label
 * together, and only when a matching record exists. `translatable` is false for
 * a channel that has no translation at all, so its text never leaves the original.
 */
export function descriptionOf(item, uiLocale, translatable = true) {
  const original = typeof item?.description === "string" ? item.description.trim() : "";
  if (original === "") return { text: "", title: "", lang: undefined, translated: false };
  const translated = translatable && typeof item?.descriptionTranslated === "string"
    ? item.descriptionTranslated.trim()
    : "";
  if (translated !== "" && isChineseUi(uiLocale)) {
    return { text: translated, title: original, lang: "zh-CN", translated: true };
  }
  return { text: original, title: "", lang: textLanguage(original), translated: false };
}

/** One string field off `extra`, empty when absent. */
function extraString(item, key) {
  return typeof item?.extra?.[key] === 'string' ? item.extra[key].trim() : '';
}

/**
 * The bookmark body. A bookmark with no text of its own shows the placeholder
 * the extractor stored as its title, so the card keeps both text slots full.
 * The extractor writes "no text" as `<p><br></p>`, which is not text.
 */
function tweetBody(item) {
  const raw = typeof item?.description === 'string' ? item.description : '';
  return raw.trim() === '' || /^<p>(?:<br\s*\/?>)*<\/p>$/i.test(raw.trim())
    ? tweetDisplayText(item?.title)
    : tweetDisplayText(raw);
}

/**
 * The cover a row shows: a bookmark's media first, then a brief's episode art,
 * then a feed item's image. `''` means no cover box at all; a cover field that
 * is clearly not a web URL renders the letter tile instead.
 */
function coverOf(item, isTweet) {
  const candidates = isTweet
    ? ['cover', 'imageUrl']
    : [item?.extra?.kind === 'brief' ? 'cover' : 'imageUrl', 'cover'];
  for (const key of candidates) {
    const value = extraString(item, key);
    if (value === '') continue;
    return /^(?:https?|data|blob):/i.test(value) ? value : '';
  }
  return '';
}

function attachmentsOf(item) {
  return Array.isArray(item?.extra?.attachments)
    ? item.extra.attachments.filter(entry => entry && typeof entry.url === 'string')
    : [];
}

/**
 * The shape a row takes, selected by the channel that produced it rather than by
 * a field on the item: a brief's `extra.kind` records whether the entry is an
 * article or a video, never that it is a brief, so reading it here would leave
 * every real brief row on the plain path.
 */
function rowKindOf(section) {
  if (section?.source?.type === 'bestblogs-brief') return 'brief';
  return isTweetSection(section) ? 'tweet' : '';
}

/**
 * Every row renders from this one shape, so the renderer branches on presence,
 * never on which source the item came from. `cover` is one string across
 * sources and empty when there is none; `meta` is one plain line.
 *
 * The sources reshape their own material into this shape here: a bookmark's
 * body becomes `description` with its author as `title`, a brief's score joins
 * its meta line, and a brief keeps `originalUrl` for the open-external action
 * that leaves the row's own link alone.
 */
export function rowOf(item, section, { now, uiLocale, t }) {
  const kind = rowKindOf(section);
  const isTweet = kind === 'tweet';
  const linked = typeof item?.url === 'string' ? item.url : '';
  const title = isTweet
    ? { text: extraString(item, 'author') || 'X', url: linked }
    : { text: typeof item?.title === 'string' ? item.title : '', url: linked };
  // A bookmark has no translation: the channel declares it off, and a record that
  // reached the file anyway still must not replace the bookmark body.
  const description = descriptionOf(
    isTweet ? { ...item, description: tweetBody(item) } : item,
    uiLocale,
    section?.capabilities?.translation !== false,
  );
  const meta = isTweet
    ? [
      tweetTime(item, now, t),
      tweetLikes(item.extra, t),
      tweetReads(item.extra, t),
      tweetDeleted(item) ? t('x.deletedTag') : '',
    ].filter(Boolean).join(' · ')
    : kind === 'brief'
      ? briefItemMeta(item, now, t)
      : itemMeta(item, now, t);
  const originalUrl = kind === 'brief' ? extraString(item, 'originalUrl') : '';
  return {
    kind,
    title,
    description,
    cover: coverOf(item, isTweet),
    meta,
    actions: { ...rowActions(section, item), externalUrl: originalUrl === '' ? linked : originalUrl },
    attachments: attachmentsOf(item),
    read: item?.read === true,
  };
}

/**
 * The section state that owns the body instead of rows: the channel empty
 * states. `missing` only reads as backfillable when the channel declares the
 * capability, but a manual channel always owns it: it was never scheduled to
 * run, so it needs a visible card on every day. `empty` is manual-only, where
 * zero merged rows is a successful pull rather than "not published".
 */
export function sectionEmptyState(section) {
  const status = section?.status;
  const emptyIsContent = section?.capabilities?.emptyState === 'empty';
  if (status === 'pending') return 'pending';
  if (status === 'notPublished') return 'notPublished';
  if (status === 'empty' && (isManualSection(section) || emptyIsContent)) return 'empty';
  if (status === 'missing' && (section?.capabilities?.backfill === true || isManualSection(section) || emptyIsContent)) {
    return 'missing';
  }
  return 'none';
}

/** The channel's attempted feeds and how many failed, from the sliced section meta. */
export function rssSectionMeta(section) {
  const meta = section?.meta !== null && typeof section?.meta === 'object' ? section.meta : {};
  const feeds = Array.isArray(meta.feeds)
    ? meta.feeds.filter(entry => entry !== null && typeof entry === 'object')
    : [];
  return {
    feeds,
    failed: feeds.filter(entry => entry.status !== 'ok').length,
    overLimit: feeds.reduce((sum, entry) => {
      const dropped = entry.dropped;
      if (dropped === null || typeof dropped !== 'object') return sum;
      const count = Number(dropped.overLimit);
      return Number.isFinite(count) && count > 0 ? sum + count : sum;
    }, 0),
  };
}

/**
 * Whether a section earns a card when the day still has no rows. Pending and
 * notPublished are always shown, missing for a backfill-capable or manual
 * channel, and a failure always shows its own card.
 */
export function sectionVisible(section, fetchError) {
  if (!section) return false;
  if ((section.items ?? []).length > 0) return true;
  if (fetchError) return true;
  if (section.status === 'error' || section.status === 'corrupt') return true;
  return sectionEmptyState(section) !== 'none';
}

/**
 * The section head actions. Translation is capability-gated: a channel that
 * never declares it (`capabilities.translation === false`) shows neither the
 * button nor the "off" status. A section without `capabilities` keeps the
 * iteration-two behaviour so an older host still renders.
 */
export function sectionHead(section, busy, t) {
  const translation = section?.translation ?? {};
  const capabilities = section?.capabilities;
  const capable = capabilities !== null && typeof capabilities === 'object'
    ? capabilities.translation === true
    : true;
  const enabled = capable && translation.enabled === true;
  const count = Math.max(0, Number(section?.count) || 0);
  const missing = Math.min(count, Math.max(0, Number(translation.missing) || 0));
  const message = typeof translation.error === 'string' ? translation.error : '';
  const fetching = busy?.fetch === true;
  const translating = busy?.translate === true;

  let statusText = '';
  if (!capable) statusText = '';
  else if (fetching && enabled) statusText = t('section.fetchingTranslation');
  else if (!enabled) statusText = t('section.translationOff');
  else if (translating && missing > 0) statusText = t('section.translatingCount', { n: missing });
  else if (missing > 0) statusText = t('section.missing', { n: missing });
  else if (count > 0) statusText = t('section.translationDone');

  const showError = capable && enabled && missing > 0 && message !== '' && !translating && !fetching;
  return {
    statusText,
    showTranslate: capable && enabled && missing > 0,
    translateLabel: !capable
      ? ''
      : translating ? t('section.translating') : showError ? t('section.retry') : t('section.translate'),
    translateDisabled: !capable || fetching || translating,
    refetchDisabled: fetching,
    showError,
    errorMessage: showError ? message : '',
  };
}

/** A failed batch with no host error still needs a visible reason. */
export function translateOutcome(result, t) {
  if (!result || typeof result !== 'object') return '';
  const error = typeof result.error === 'string' ? result.error : '';
  if (error !== '') return error;
  const failed = Number(result.failed) || 0;
  return failed > 0 ? t('section.translatePartial', { n: failed }) : '';
}

/**
 * The fetch-status line of one source. A spent daily budget wins over the raw
 * failure so the section head can say the scheduler has stopped for today.
 */
export function channelStatusLine(status, now, t) {
  if (!status || typeof status !== 'object') return { text: '', tone: 'idle', exhausted: false };
  const today = dayKeyOf(now);
  const successAt = new Date(status.lastSuccessAt);
  const succeededToday = typeof status.lastSuccessAt === 'string'
    && status.lastSuccessAt !== ''
    && !Number.isNaN(successAt.getTime())
    && dayKeyOf(successAt) === today;
  const attempts = status.autoAttempts ?? {};
  const exhausted = attempts.day === today && (Number(attempts.count) || 0) >= 3 && !succeededToday;
  const pending = status.pendingAttempts ?? {};
  const pendingCount = pending.day === today ? Number(pending.count) || 0 : 0;
  const pendingExhausted = pendingCount >= 3 && !succeededToday;
  const attemptAt = typeof status.lastAttemptAt === 'string' ? new Date(status.lastAttemptAt) : null;
  const attemptedToday = attemptAt !== null && !Number.isNaN(attemptAt.getTime()) && dayKeyOf(attemptAt) === today;
  const pendingToday = status.lastOutcome === 'pending' && attemptedToday && !succeededToday;

  if (exhausted || pendingExhausted) return { text: t('section.budgetExhausted'), tone: 'error', exhausted: true };
  // The latest attempt wins over a stale failure count: a pending retry after a
  // network error means the brief is not out yet, not that the channel is broken.
  if (pendingToday) {
    return { text: t('state.pending.title'), tone: 'idle', exhausted: false };
  }
  if (status.status === 'error' || status.error) {
    return {
      text: typeof status.error === 'string' && status.error !== '' ? status.error : t('card.failed'),
      tone: 'error',
      exhausted: false,
    };
  }
  if (succeededToday) {
    return {
      text: t('settings.channel.fetchedAt', {
        time: `${pad2(successAt.getHours())}:${pad2(successAt.getMinutes())}`,
        count: Number(status.todayCount) || 0,
      }),
      tone: 'ok',
      exhausted: false,
    };
  }
  if (typeof status.lastSuccessAt === 'string' && !Number.isNaN(successAt.getTime())) {
    return { text: formatRelativeTime(status.lastSuccessAt, now, t), tone: 'idle', exhausted: false };
  }
  return { text: t('settings.channel.never'), tone: 'idle', exhausted: false };
}
