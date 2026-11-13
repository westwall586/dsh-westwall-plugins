import { randomBytes } from 'node:crypto';
import {
  CHANNEL_ID_PATTERN,
  MAX_CHANNEL_NAME,
  MAX_FEED_NAME,
  MAX_FEED_NOTE,
  MAX_ACTIVE_FEEDS,
  MAX_RSS_CHANNELS,
  MAX_RSS_FEEDS,
  normalizeFeedUrl,
  type RssChannel,
  type RssFeed,
  type RssLibrary,
} from '../contract/rss-library.ts';
import type { RssLibraryOp, RssLibraryView } from '../contract/views.ts';
import type { RssFeedRef } from '../sources/types.ts';
import { FeedUltraError } from './errors.ts';

const MAX_OPML_BYTES = 2_000_000;

export interface OpmlCandidate {
  url: string;
  name: string;
}

export interface RssOpContext {
  at: string;
  newChannelId(library: RssLibrary): string;
  parseOpml(text: string): readonly OpmlCandidate[];
}

export interface ImportCount {
  added: number;
  skipped: number;
}

export interface AppliedOps {
  library: RssLibrary;
  lastImport?: ImportCount;
}

function invalid(message: string): never {
  throw new FeedUltraError('invalid-input', message);
}

function opRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid('op must be an object');
  return value as Record<string, unknown>;
}

function stringField(op: Record<string, unknown>, field: string): string {
  const value = op[field];
  if (typeof value !== 'string') invalid(`${String(op.op)}: ${field} must be a string`);
  return value;
}

function requireChannel(library: RssLibrary, id: string): RssChannel {
  const channel = library.channels.find((candidate) => candidate.id === id);
  if (channel === undefined) invalid(`unknown channel: ${JSON.stringify(id)}`);
  return channel;
}

function activeFeedCount(library: RssLibrary): number {
  return library.feeds.filter(feed => feed.channel !== '').length;
}

function requireFeed(library: RssLibrary, url: string): number {
  const index = library.feeds.findIndex((feed) => feed.url === url);
  if (index === -1) invalid(`unknown feed: ${JSON.stringify(url)}`);
  return index;
}

function channelNameOf(op: Record<string, unknown>): string {
  const name = stringField(op, 'name').trim().slice(0, MAX_CHANNEL_NAME);
  if (name === '') invalid('channel name must not be empty');
  return name;
}

export function randomChannelId(library: RssLibrary): string {
  for (;;) {
    const id = `ch${randomBytes(4).toString('hex')}`;
    if (!library.channels.some((channel) => channel.id === id)) return id;
  }
}

/**
 * The one op reducer. It throws on the first illegal op, so a batch either
 * applies completely or the caller has nothing to write.
 */
export function applyOps(
  current: RssLibrary,
  ops: readonly RssLibraryOp[],
  ctx: RssOpContext,
): AppliedOps {
  let library: RssLibrary = current;
  let lastImport: ImportCount | undefined;

  for (const rawOp of ops) {
    const op = opRecord(rawOp);
    const kind = stringField(op, 'op');

    if (kind === 'addFeed') {
      const url = normalizeFeedUrl(stringField(op, 'url'));
      if (url === null) invalid('addFeed: url must be absolute http(s)');
      const channel = op.channel === undefined ? '' : stringField(op, 'channel');
      if (channel !== '') requireChannel(library, channel);
      if (library.feeds.some((feed) => feed.url === url)) continue;
      if (channel !== '' && activeFeedCount(library) >= MAX_ACTIVE_FEEDS) {
        invalid(`addFeed: active feed limit reached (${MAX_ACTIVE_FEEDS})`);
      }
      if (library.feeds.length >= MAX_RSS_FEEDS) invalid('addFeed: library feed limit reached');
      library = {
        ...library,
        feeds: [...library.feeds, { url, name: '', note: '', channel, addedAt: ctx.at }],
      };
      continue;
    }

    if (kind === 'removeFeed') {
      const url = normalizeFeedUrl(stringField(op, 'url'));
      if (url === null) invalid('removeFeed: url must be absolute http(s)');
      const index = requireFeed(library, url);
      library = { ...library, feeds: library.feeds.filter((_, position) => position !== index) };
      continue;
    }

    if (kind === 'setFeedNote') {
      const url = normalizeFeedUrl(stringField(op, 'url'));
      if (url === null) invalid('setFeedNote: url must be absolute http(s)');
      const index = requireFeed(library, url);
      const note = stringField(op, 'note').trim().slice(0, MAX_FEED_NOTE);
      library = {
        ...library,
        feeds: library.feeds.map((feed, position) => (position === index ? { ...feed, note } : feed)),
      };
      continue;
    }

    if (kind === 'moveFeed') {
      const url = normalizeFeedUrl(stringField(op, 'url'));
      if (url === null) invalid('moveFeed: url must be absolute http(s)');
      const channel = stringField(op, 'channel');
      if (channel !== '') requireChannel(library, channel);
      const index = requireFeed(library, url);
      if (channel !== '' && library.feeds[index].channel === '' && activeFeedCount(library) >= MAX_ACTIVE_FEEDS) {
        invalid(`moveFeed: active feed limit reached (${MAX_ACTIVE_FEEDS})`);
      }
      library = {
        ...library,
        feeds: library.feeds.map((feed, position) => (position === index ? { ...feed, channel } : feed)),
      };
      continue;
    }

    if (kind === 'addChannel') {
      const name = channelNameOf(op);
      if (library.channels.some((channel) => channel.name === name)) invalid('addChannel: duplicate name');
      if (library.channels.length >= MAX_RSS_CHANNELS) invalid('addChannel: channel limit reached');
      const id = ctx.newChannelId(library);
      if (!CHANNEL_ID_PATTERN.test(id) || library.channels.some((channel) => channel.id === id)) {
        invalid('addChannel: generated id is invalid');
      }
      library = { ...library, channels: [...library.channels, { id, name }] };
      continue;
    }

    if (kind === 'renameChannel') {
      const id = stringField(op, 'id');
      requireChannel(library, id);
      const name = channelNameOf(op);
      if (library.channels.some((channel) => channel.id !== id && channel.name === name)) {
        invalid('renameChannel: duplicate name');
      }
      library = {
        ...library,
        channels: library.channels.map((channel) => (channel.id === id ? { ...channel, name } : channel)),
      };
      continue;
    }

    if (kind === 'removeChannel') {
      const id = stringField(op, 'id');
      requireChannel(library, id);
      library = {
        ...library,
        channels: library.channels.filter((channel) => channel.id !== id),
        feeds: library.feeds.map((feed) => (feed.channel === id ? { ...feed, channel: '' } : feed)),
      };
      continue;
    }

    if (kind === 'reorderChannels') {
      const ids = op.ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        invalid('reorderChannels: ids must be a string array');
      }
      const requested = ids as string[];
      const existing = new Set(library.channels.map((channel) => channel.id));
      const requestedSet = new Set(requested);
      if (
        requested.length !== library.channels.length ||
        requestedSet.size !== requested.length ||
        [...existing].some((id) => !requestedSet.has(id))
      ) {
        invalid('reorderChannels: ids must be a permutation of the current channels');
      }
      const byId = new Map(library.channels.map((channel) => [channel.id, channel]));
      library = {
        ...library,
        channels: requested.map((id) => byId.get(id) as RssChannel),
      };
      continue;
    }

    if (kind === 'importOpml') {
      const text = stringField(op, 'text');
      if (text.length > MAX_OPML_BYTES) invalid('importOpml: text exceeds 2 MB');
      let candidates: readonly OpmlCandidate[];
      try {
        candidates = ctx.parseOpml(text);
      } catch (error) {
        invalid(`importOpml: ${error instanceof Error ? error.message : String(error)}`);
      }
      let added = 0;
      let skipped = 0;
      const feeds: RssFeed[] = [...library.feeds];
      const urls = new Set(feeds.map((feed) => feed.url));
      for (const candidate of candidates) {
        const url = normalizeFeedUrl(candidate.url);
        if (url === null || urls.has(url) || feeds.length >= MAX_RSS_FEEDS) {
          skipped += 1;
          continue;
        }
        urls.add(url);
        feeds.push({
          url,
          name: candidate.name.trim().slice(0, MAX_FEED_NAME),
          note: '',
          channel: '',
          addedAt: ctx.at,
        });
        added += 1;
      }
      library = { ...library, feeds };
      lastImport = {
        added: (lastImport?.added ?? 0) + added,
        skipped: (lastImport?.skipped ?? 0) + skipped,
      };
      continue;
    }

    invalid(`unknown op: ${JSON.stringify(kind)}`);
  }

  return { library, ...(lastImport === undefined ? {} : { lastImport }) };
}

/** Channel order first, then each channel's feed order; the inbox never appears. */
export function orderedFeeds(library: RssLibrary): RssFeedRef[] {
  const byChannel = new Map<string, RssFeedRef[]>();
  for (const channel of library.channels) byChannel.set(channel.id, []);
  for (const feed of library.feeds) {
    if (feed.channel === '') continue;
    byChannel.get(feed.channel)?.push({ url: feed.url, name: feed.name, channel: feed.channel });
  }
  return [...byChannel.values()].flat();
}

export function rssLibraryView(
  library: RssLibrary,
  extra: Pick<RssLibraryView, 'recoveredFrom' | 'unbound' | 'lastImport'> = {},
): RssLibraryView {
  return {
    version: library.version,
    updatedAt: library.updatedAt,
    channels: library.channels,
    feeds: library.feeds,
    counts: {
      feeds: library.feeds.length,
      channels: library.channels.length,
      inbox: library.feeds.filter((feed) => feed.channel === '').length,
    },
    ...(extra.recoveredFrom === undefined ? {} : { recoveredFrom: extra.recoveredFrom }),
    ...(extra.unbound === undefined ? {} : { unbound: extra.unbound }),
    ...(extra.lastImport === undefined ? {} : { lastImport: extra.lastImport }),
  };
}
