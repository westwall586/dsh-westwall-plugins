import type { RawItem, SourceDescriptor } from '../../contract/types.ts';
import {
  SourceFetchError,
  type FetchContext,
  type FetchOutcome,
  type RssFeedRef,
  type SourceAdapter,
} from '../types.ts';
import { fetchFeed, type FeedCursor, type FeedDocument, type FeedWatermark } from './http.ts';
import { parseFeedText } from './parse.ts';

export const FIRST_PULL_ITEMS = 20;
export const PER_FETCH_LIMIT = 1000;

export const descriptor: SourceDescriptor = { id: 'rss', name: 'RSS', type: 'rss' };

interface Dropped {
  noLink: number;
  noKey: number;
  dupKey: number;
  overLimit: number;
  firstPull: number;
}

interface FeedMeta {
  url: string;
  title: string;
  titleSource: 'document' | 'host';
  status: 'ok' | 'error';
  httpStatus: number;
  notModified: boolean;
  items: number;
  accepted: number;
  dropped: Dropped;
  error?: string;
}

function emptyDropped(): Dropped {
  return { noLink: 0, noKey: 0, dupKey: 0, overLimit: 0, firstPull: 0 };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function entryOf(value: unknown): FeedCursor | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const entry: FeedCursor = {};
  if (typeof record.etag === 'string') entry.etag = record.etag;
  if (typeof record.lastModified === 'string') entry.lastModified = record.lastModified;
  if (typeof record.lastOkAt === 'string') entry.lastOkAt = record.lastOkAt;
  if (typeof record.lastItems === 'number') entry.lastItems = record.lastItems;
  if (typeof record.watermark === 'object' && record.watermark !== null && !Array.isArray(record.watermark)) {
    const watermark = record.watermark as Record<string, unknown>;
    if (
      typeof watermark.id === 'string'
      && typeof watermark.at === 'string'
      && !Number.isNaN(Date.parse(watermark.at))
    ) {
      entry.watermark = { id: watermark.id, at: watermark.at };
    }
  }
  return Object.keys(entry).length === 0 ? undefined : entry;
}

function cursorOf(raw: Record<string, unknown> | undefined): Record<string, FeedCursor> {
  const feeds = raw?.feeds;
  if (typeof feeds !== 'object' || feeds === null || Array.isArray(feeds)) return {};
  const out: Record<string, FeedCursor> = {};
  for (const [url, value] of Object.entries(feeds)) {
    const entry = entryOf(value);
    if (entry !== undefined) out[url] = entry;
  }
  return out;
}

function metaOf(feed: RssFeedRef): FeedMeta {
  return {
    url: feed.url,
    title: feed.name.trim() === '' ? hostOf(feed.url) : feed.name,
    titleSource: 'host',
    status: 'ok',
    httpStatus: 0,
    notModified: false,
    items: 0,
    accepted: 0,
    dropped: emptyDropped(),
  };
}

function nextCursor(
  previous: FeedCursor | undefined,
  document: FeedDocument,
  at: string,
  items: number,
  watermark?: FeedWatermark,
): FeedCursor {
  const nextWatermark = watermark ?? previous?.watermark;
  return {
    ...(document.etag !== '' ? { etag: document.etag } : previous?.etag ? { etag: previous.etag } : {}),
    ...(document.lastModified !== ''
      ? { lastModified: document.lastModified }
      : previous?.lastModified
        ? { lastModified: previous.lastModified }
        : {}),
    lastOkAt: at,
    lastItems: items,
    ...(nextWatermark === undefined ? {} : { watermark: nextWatermark }),
  };
}

function newestWatermark(items: readonly RawItem[], now: string): FeedWatermark | undefined {
  let newest: RawItem | undefined;
  for (const item of items) {
    if (newest === undefined || item.publishedAt > newest.publishedAt) newest = item;
  }
  if (newest === undefined) return undefined;
  return { id: newest.naturalKey, at: newest.publishedAt > now ? now : newest.publishedAt };
}

function candidatesAfterWatermark(
  items: readonly RawItem[],
  watermark: FeedWatermark | undefined,
): readonly RawItem[] {
  if (watermark === undefined) return items;
  const index = items.findIndex(item => item.naturalKey === watermark.id);
  return items.filter((item, position) =>
    item.publishedAt > watermark.at
    || (item.publishedAt === watermark.at && index >= 0 && position < index));
}

export interface RssAdapterOptions {
  /** Overridable so tests can spy or serve fixtures without a network. */
  fetchFeed?: typeof fetchFeed;
}

export function createAdapter(options: RssAdapterOptions = {}): SourceAdapter {
  const transport = options.fetchFeed ?? fetchFeed;

  return {
    type: descriptor.type,
    label: descriptor.name,
    writeMode: 'accumulate',
    async fetch(ctx: FetchContext): Promise<FetchOutcome> {
      const feeds = ctx.feeds ?? [];
      const log = ctx.log;
      log?.('rss.fetch.start', { feeds: feeds.length });

      const previousCursor = cursorOf(ctx.cursor);
      const mergedCursor: Record<string, FeedCursor> = { ...previousCursor };

      if (feeds.length === 0) {
        log?.('rss.fetch.done', { ok: 0, failed: 0, newItems: 0, scanned: 0 });
        return {
          status: 'ok',
          items: [],
          meta: { newItems: 0, scanned: 0, origin: ctx.now, feeds: [] },
          cursor: { feeds: mergedCursor },
        };
      }

      const accepted = new Set<string>();
      const items: RawItem[] = [];
      const feedMetas: FeedMeta[] = [];
      let scanned = 0;
      let okCount = 0;
      let failedCount = 0;
      let firstFailure: SourceFetchError | null = null;

      for (const feed of feeds) {
        const stored = previousCursor[feed.url];
        const firstPull = stored === undefined || stored.watermark === undefined;
        const meta = metaOf(feed);
        try {
          const document = await transport(feed.url, stored, {});
          if (document.notModified) {
            meta.httpStatus = 304;
            meta.notModified = true;
            meta.items = stored?.lastItems ?? 0;
            meta.title = feed.name.trim() === '' ? hostOf(feed.url) : feed.name;
            meta.titleSource = 'host';
            mergedCursor[feed.url] = nextCursor(stored, document, ctx.now, stored?.lastItems ?? 0);
            okCount += 1;
            feedMetas.push(meta);
            log?.('rss.feed.ok', { url: feed.url, httpStatus: 304, items: meta.items, accepted: 0 });
            continue;
          }

          const parsed = parseFeedText(document.text, feed.url, ctx.now);
          scanned += parsed.scanned;
          meta.title = parsed.title;
          meta.titleSource = parsed.title === hostOf(feed.url) ? 'host' : 'document';
          meta.httpStatus = document.httpStatus;
          meta.items = parsed.scanned;
          meta.dropped.noLink = parsed.dropped.noLink;
          meta.dropped.noKey = parsed.dropped.noKey;
          meta.dropped.dupKey = parsed.dropped.dupKey;

          const candidates = firstPull
            ? parsed.items
            : candidatesAfterWatermark(parsed.items, stored?.watermark);
          const limit = firstPull ? FIRST_PULL_ITEMS : Number.POSITIVE_INFINITY;
          const acceptedForFeed: RawItem[] = [];
          for (const item of candidates) {
            if (ctx.excludeKeys.has(item.naturalKey)) continue;
            if (accepted.has(item.naturalKey)) {
              meta.dropped.dupKey += 1;
              continue;
            }
            if (acceptedForFeed.length >= limit) {
              meta.dropped.firstPull += 1;
              continue;
            }
            if (items.length >= PER_FETCH_LIMIT) {
              meta.dropped.overLimit += 1;
              continue;
            }
            accepted.add(item.naturalKey);
            items.push(item);
            acceptedForFeed.push(item);
            meta.accepted += 1;
          }

          const newest = newestWatermark(acceptedForFeed, ctx.now);
          const nextWatermark = firstPull
            ? (newest ?? { id: '', at: ctx.now })
            : (meta.dropped.overLimit > 0 ? undefined : newest);
          mergedCursor[feed.url] = nextCursor(stored, document, ctx.now, parsed.scanned, nextWatermark);
          okCount += 1;
          log?.('rss.feed.ok', {
            url: feed.url,
            httpStatus: document.httpStatus,
            items: parsed.scanned,
            accepted: meta.accepted,
            dropped: meta.dropped,
          });
        } catch (error) {
          const failure =
            error instanceof SourceFetchError
              ? error
              : new SourceFetchError('drift', messageOf(error), { cause: error });
          failedCount += 1;
          if (firstFailure === null) firstFailure = failure;
          meta.status = 'error';
          meta.error = failure.message;
          if (failure.status !== undefined) meta.httpStatus = failure.status;
          log?.('rss.feed.error', {
            url: feed.url,
            kind: failure.kind,
            status: failure.status,
            message: failure.message,
          });
        }
        feedMetas.push(meta);
      }

      if (okCount === 0 && feeds.length > 0) {
        throw new SourceFetchError(
          firstFailure?.kind ?? 'drift',
          `${failedCount}/${feeds.length} 个订阅源失败：${firstFailure?.message ?? '未知错误'}`,
        );
      }

      items.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
      log?.('rss.fetch.done', {
        ok: okCount,
        failed: failedCount,
        newItems: items.length,
        scanned,
      });

      return {
        status: 'ok',
        items,
        meta: { newItems: items.length, scanned, origin: ctx.now, feeds: feedMetas },
        cursor: { feeds: mergedCursor },
      };
    },
  };
}

export const adapter = createAdapter();
