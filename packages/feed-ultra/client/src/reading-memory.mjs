import { oldestDayKey, sectionKeyOf } from './view-model.mjs';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCROLL_POSITIONS = 120;

const EMPTY_SELECTION = {
  workspacePath: '',
  channel: 'all',
  filter: 'all',
  day: '',
  today: '',
};

function dayOrEmpty(value) {
  return typeof value === 'string' && DAY_PATTERN.test(value) ? value : '';
}

function normalize(next) {
  return {
    workspacePath: typeof next.workspacePath === 'string' ? next.workspacePath : '',
    channel: typeof next.channel === 'string' && next.channel !== '' ? next.channel : 'all',
    filter: next.filter === 'unread' ? 'unread' : 'all',
    day: dayOrEmpty(next.day),
    today: dayOrEmpty(next.today),
  };
}

export function createReadingMemory() {
  let selection = { ...EMPTY_SELECTION };
  const scrolls = new Map();

  return {
    readSelection() {
      return { ...selection };
    },
    rememberSelection(next) {
      selection = normalize({ ...selection, ...next });
    },
    readScroll(key) {
      return scrolls.get(key) ?? 0;
    },
    rememberScroll(key, top) {
      if (typeof key !== 'string' || key === '' || !Number.isFinite(top) || top < 0) return;
      scrolls.delete(key);
      scrolls.set(key, Math.round(top));
      while (scrolls.size > MAX_SCROLL_POSITIONS) {
        scrolls.delete(scrolls.keys().next().value);
      }
    },
    reset() {
      selection = { ...EMPTY_SELECTION };
      scrolls.clear();
    },
  };
}

/**
 * A day that was today follows the new today. A historical day survives only
 * while it is inside the retention window; a different workspace starts fresh.
 */
export function resolveReadingDay(memory, { today, retentionDays, workspacePath }) {
  const stored = dayOrEmpty(memory?.day);
  if (stored === '') return today;
  const storedWorkspace = typeof memory?.workspacePath === 'string' ? memory.workspacePath : '';
  if (storedWorkspace !== '' && storedWorkspace !== workspacePath) return today;
  if (stored === dayOrEmpty(memory?.today)) return today;
  if (stored > today) return today;
  const days = Number.isFinite(retentionDays) ? retentionDays : 30;
  return stored < oldestDayKey(today, days) ? today : stored;
}

export function resolveReadingChannel(channel, sources) {
  if (typeof channel !== 'string' || channel === '' || channel === 'all') return 'all';
  const rows = sources?.sources;
  if (Array.isArray(rows) && rows.some(source => source?.id === channel)) return channel;
  const channels = sources?.rssChannels;
  if (Array.isArray(channels) && channels.some(entry => channel === sectionKeyOf('rss', entry?.id))) {
    return channel;
  }
  return 'all';
}

export function readingScrollKey({ workspacePath, day, channel, filter }) {
  return JSON.stringify([
    typeof workspacePath === 'string' ? workspacePath : '',
    typeof day === 'string' ? day : '',
    typeof channel === 'string' ? channel : 'all',
    filter === 'unread' ? 'unread' : 'all',
  ]);
}
