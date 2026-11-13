import type { ItemRecord } from '../contract/types.ts';
import type { RssChannel, RssLibrary } from '../contract/rss-library.ts';
import type { DayFactResult } from '../store/read.ts';
import type { FeedOutcome } from './project.ts';

export interface RssChannelMeta {
  [key: string]: unknown;
  newItems: number;
  scanned: number;
  failed: number;
  feeds: Record<string, unknown>[];
}

export interface RssChannelSlice {
  channel: RssChannel;
  feedUrls: string[];
  items: ItemRecord[];
  meta: RssChannelMeta;
  feedOutcome: FeedOutcome;
  /** The pool fact with this channel's items, meta and source name. */
  fact: DayFactResult;
}

function feedEntries(fact: DayFactResult): Record<string, unknown>[] {
  if (fact.kind !== 'ok' || !Array.isArray(fact.fact.meta?.feeds)) return [];
  return fact.fact.meta.feeds.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
}

/** One pool fact becomes one slice per channel with at least one feed. */
export function sliceRssChannels(library: RssLibrary, fact: DayFactResult): RssChannelSlice[] {
  const urlsByChannel = new Map<string, string[]>();
  for (const channel of library.channels) urlsByChannel.set(channel.id, []);
  for (const feed of library.feeds) {
    if (feed.channel === '') continue;
    urlsByChannel.get(feed.channel)?.push(feed.url);
  }

  const poolFeeds = feedEntries(fact);
  const slices: RssChannelSlice[] = [];

  for (const channel of library.channels) {
    const feedUrls = urlsByChannel.get(channel.id) ?? [];
    if (feedUrls.length === 0) continue;

    const urls = new Set(feedUrls);
    const items =
      fact.kind === 'ok'
        ? fact.fact.items.filter(
            (item) => typeof item.extra.feedUrl === 'string' && urls.has(item.extra.feedUrl),
          )
        : [];
    const feeds = poolFeeds.filter((entry) => urls.has(String(entry.url)));
    const failedFeeds = feeds.filter((entry) => entry.status !== 'ok');
    const firstFailure = failedFeeds[0];
    const meta: RssChannelMeta = {
      newItems: feeds.reduce(
        (sum, entry) => sum + (typeof entry.accepted === 'number' ? entry.accepted : 0),
        0,
      ),
      scanned: feeds.reduce((sum, entry) => sum + (typeof entry.items === 'number' ? entry.items : 0), 0),
      failed: failedFeeds.length,
      feeds,
    };
    const feedOutcome: FeedOutcome = {
      total: feedUrls.length,
      failed: failedFeeds.length,
      error: typeof firstFailure?.error === 'string' ? firstFailure.error : '',
    };
    const sliced: DayFactResult =
      fact.kind === 'ok'
        ? {
            kind: 'ok',
            fact: {
              ...fact.fact,
              source: { id: 'rss', name: channel.name, type: 'rss' },
              meta,
              items,
            },
          }
        : fact;

    slices.push({ channel, feedUrls, items, meta, feedOutcome, fact: sliced });
  }

  return slices;
}
