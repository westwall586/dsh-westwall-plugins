import type { SourceCapabilities, SourceDescriptor } from '../contract/types.ts';
import type { SourceCadence } from '../contract/views.ts';
import { FeedUltraError } from '../service/errors.ts';
import { adapter as bestblogsBriefAdapter, descriptor as bestblogsBriefSource } from './bestblogs-brief/index.ts';
import { adapter as githubTrendingAdapter, descriptor as githubTrendingSource } from './github-trending/index.ts';
import { adapter as rssAdapter, descriptor as rssSource } from './rss/index.ts';
import { adapter as xBookmarksAdapter, descriptor as xBookmarksSource } from './x-bookmarks/index.ts';
import type { SourceAdapter } from './types.ts';

/** One source's runtime identity: its facts contract, code, cadence and declared capabilities. */
export interface SourceRuntime {
  descriptor: SourceDescriptor;
  adapter: SourceAdapter;
  cadence: SourceCadence;
  capabilities: SourceCapabilities;
  /** One fact slices into one section per subscribed view. Host only, never serialized. */
  pooled?: boolean;
}

/**
 * The only place that maps a source id to its capabilities. Nothing outside an adapter
 * may branch on a source id, so a new channel is one entry here plus its own directory.
 */
export const SOURCES: Record<string, SourceRuntime> = {
  [githubTrendingSource.id]: {
    descriptor: githubTrendingSource,
    adapter: githubTrendingAdapter,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
  },
  [bestblogsBriefSource.id]: {
    descriptor: bestblogsBriefSource,
    adapter: bestblogsBriefAdapter,
    cadence: 'daily',
    capabilities: { backfill: true, translation: false, locales: ['zh', 'en'], minScheduleAt: '07:00' },
  },
  [xBookmarksSource.id]: {
    descriptor: xBookmarksSource,
    adapter: xBookmarksAdapter,
    cadence: 'manual',
    capabilities: {
      backfill: false,
      translation: false,
      actions: ['deleteBookmark'],
      manualBatch: true,
    },
  },
  [rssSource.id]: {
    descriptor: rssSource,
    adapter: rssAdapter,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true, emptyState: 'empty' },
    pooled: true,
  },
};

export function sourceOrThrow(sourceId: string): SourceRuntime {
  const source = SOURCES[sourceId];
  if (!source) throw new FeedUltraError('unknown-source', `unknown source: ${JSON.stringify(sourceId)}`);
  return source;
}
