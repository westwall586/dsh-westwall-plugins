/**
 * Pure helpers for the RSS settings page. The host stays authoritative; this
 * module mirrors its normalization so the page can answer before a round trip.
 */

export const RSS_PAGE_SIZE = 10;
export const MAX_CHANNEL_NAME = 40;

export const EMPTY_LIBRARY_VIEW = {
  version: 1,
  updatedAt: '',
  channels: [],
  feeds: [],
  counts: { feeds: 0, channels: 0, inbox: 0 },
};

export function feedHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function feedLabel(feed) {
  const name = typeof feed?.name === 'string' ? feed.name.trim() : '';
  return name === '' ? feedHost(feed?.url ?? '') : name;
}

/** Mirrors the host's URL normalization so a duplicate is caught before the write. */
export function normalizeFeedInput(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export function collectionFeeds(view, collection) {
  const feeds = Array.isArray(view?.feeds) ? view.feeds : [];
  return collection === 'inbox'
    ? feeds.filter(feed => feed.channel === '')
    : feeds.filter(feed => feed.channel === collection);
}

export function matchesQuery(feed, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (needle === '') return true;
  return [feed.name, feed.url, feed.note].some(value =>
    typeof value === 'string' && value.toLowerCase().includes(needle));
}

export function sortFeeds(feeds) {
  return [...feeds].sort((left, right) => {
    const byName = feedLabel(left).localeCompare(feedLabel(right), 'zh-Hans-CN');
    if (byName !== 0) return byName;
    return left.url < right.url ? -1 : left.url > right.url ? 1 : 0;
  });
}

export function visibleFeeds(view, collection, query) {
  return sortFeeds(collectionFeeds(view, collection).filter(feed => matchesQuery(feed, query)));
}

export function pageCount(total) {
  return Math.max(1, Math.ceil(Math.max(0, total) / RSS_PAGE_SIZE));
}

export function clampPage(page, total) {
  const value = Number.isInteger(page) && page > 0 ? page : 1;
  return Math.min(value, pageCount(total));
}

export function paginate(feeds, page) {
  const total = feeds.length;
  const pages = pageCount(total);
  const current = clampPage(page, total);
  const start = (current - 1) * RSS_PAGE_SIZE;
  return {
    page: current,
    pages,
    total,
    items: feeds.slice(start, start + RSS_PAGE_SIZE),
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + RSS_PAGE_SIZE, total),
  };
}

export function pageForUrl(feeds, url) {
  const index = feeds.findIndex(feed => feed.url === url);
  return index === -1 ? 1 : Math.floor(index / RSS_PAGE_SIZE) + 1;
}

/** The collection after a delete: a removed channel falls back to the inbox. */
export function nextCollection(view, collection) {
  if (collection === 'inbox') return 'inbox';
  const channels = Array.isArray(view?.channels) ? view.channels : [];
  return channels.some(channel => channel.id === collection) ? collection : 'inbox';
}

export function channelNameProblem(name, channels, currentId = '') {
  const value = typeof name === 'string' ? name.trim() : '';
  if (value === '') return 'empty';
  if ([...value].length > MAX_CHANNEL_NAME) return 'long';
  const rows = Array.isArray(channels) ? channels : [];
  if (rows.some(channel => channel.id !== currentId && channel.name === value)) return 'duplicate';
  return '';
}

export function channelIdsAfterMove(channels, fromId, toId) {
  const rows = Array.isArray(channels) ? channels : [];
  const ids = rows.map(channel => channel.id).filter(id => id !== fromId);
  const target = ids.indexOf(toId);
  if (target === -1 || !rows.some(channel => channel.id === fromId)) return null;
  ids.splice(target, 0, fromId);
  return ids;
}

export function swappedChannelIds(channels, id, delta) {
  const rows = Array.isArray(channels) ? channels : [];
  const ids = rows.map(channel => channel.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

export const ops = {
  addFeed: (url, collection) => (collection === 'inbox'
    ? { op: 'addFeed', url }
    : { op: 'addFeed', url, channel: collection }),
  removeFeed: url => ({ op: 'removeFeed', url }),
  setNote: (url, note) => ({ op: 'setFeedNote', url, note }),
  moveFeed: (url, collection) => ({ op: 'moveFeed', url, channel: collection === 'inbox' ? '' : collection }),
  addChannel: name => ({ op: 'addChannel', name }),
  renameChannel: (id, name) => ({ op: 'renameChannel', id, name }),
  removeChannel: id => ({ op: 'removeChannel', id }),
  reorderChannels: ids => ({ op: 'reorderChannels', ids }),
  importOpml: text => ({ op: 'importOpml', text }),
};
