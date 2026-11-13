import { z } from 'zod';

/** Library storage ceiling. The inbox is not capped at the active limit. */
export const MAX_RSS_FEEDS = 5000;
/** Feeds filed into a channel, the set the daily pull pays for. */
export const MAX_ACTIVE_FEEDS = 200;
export const MAX_RSS_CHANNELS = 20;
export const CHANNEL_ID_PATTERN = /^ch[a-z0-9]{6,12}$/;
export const MAX_FEED_NAME = 80;
export const MAX_FEED_NOTE = 200;
export const MAX_CHANNEL_NAME = 40;

export interface RssChannel {
  id: string;
  name: string;
}

export interface RssFeed {
  url: string;
  name: string;
  note: string;
  channel: string;
  addedAt: string;
}

/** `data/rss-library.json`: the workspace-scoped channel and feed table. */
export interface RssLibrary {
  version: 1;
  updatedAt: string;
  channels: RssChannel[];
  feeds: RssFeed[];
}

export const EMPTY_RSS_LIBRARY: RssLibrary = {
  version: 1,
  updatedAt: '',
  channels: [],
  feeds: [],
};

const channelSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
});

const feedSchema = z.object({
  url: z.string(),
  name: z.string().default(''),
  note: z.string().default(''),
  channel: z.string().default(''),
  addedAt: z.string().default(''),
});

export const rssLibrarySchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().default(''),
  channels: z.array(channelSchema).default([]),
  feeds: z.array(feedSchema).default([]),
});

/** Absolute http(s), fragment dropped, host lowercased, one trailing slash dropped. */
export function normalizeFeedUrl(raw: string): string | null {
  const value = raw.trim();
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

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/**
 * The one normalization table for the library. Both the store and the client
 * mirror apply it, so a hand-edited file and an RPC write land on the same shape.
 */
export function normalizeLibrary(input: RssLibrary): RssLibrary {
  const channels: RssChannel[] = [];
  const channelIds = new Set<string>();
  for (const candidate of input.channels) {
    if (channels.length >= MAX_RSS_CHANNELS) break;
    const id = candidate.id.trim();
    const name = clip(candidate.name, MAX_CHANNEL_NAME);
    if (!CHANNEL_ID_PATTERN.test(id) || channelIds.has(id) || name === '') continue;
    channelIds.add(id);
    channels.push({ id, name });
  }

  const feeds: RssFeed[] = [];
  const urls = new Set<string>();
  for (const candidate of input.feeds) {
    if (feeds.length >= MAX_RSS_FEEDS) break;
    const url = normalizeFeedUrl(candidate.url);
    if (url === null || urls.has(url)) continue;
    urls.add(url);
    const channel = channelIds.has(candidate.channel) ? candidate.channel : '';
    feeds.push({
      url,
      name: clip(candidate.name, MAX_FEED_NAME),
      note: clip(candidate.note, MAX_FEED_NOTE),
      channel,
      addedAt: typeof candidate.addedAt === 'string' ? candidate.addedAt : '',
    });
  }

  return { version: 1, updatedAt: input.updatedAt, channels, feeds };
}

export function parseRssLibrary(input: unknown): RssLibrary {
  return normalizeLibrary(rssLibrarySchema.parse(input));
}
