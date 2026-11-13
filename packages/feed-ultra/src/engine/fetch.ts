import { composeItemId } from '../contract/ids.ts';
import { CONTRACT_VERSION } from '../contract/schema.ts';
import type {
  AutoAttempts,
  FactFile,
  HealthRecord,
  ItemRecord,
  RawItem,
  SourceDescriptor,
} from '../contract/types.ts';
import type { FetchTrigger } from '../contract/views.ts';
import type { FetchContext, FetchLog, FetchOutcome, RssFeedRef, SourceAdapter } from '../sources/types.ts';
import { readHealth, writeDayItems, writeHealth } from '../store/day.ts';
import { dayKeyOf, layout } from '../store/paths.ts';
import { prune } from '../store/prune.ts';
import { readDayItemsSafe } from '../store/read.ts';

export interface FetchRequest {
  /** Workspace root; `.dsh-feeds` lives directly under it. */
  root: string;
  adapter: SourceAdapter;
  source: SourceDescriptor;
  day: string;
  retentionDays: number;
  /** Scheduled ticks spend the daily budget; manual clicks never do. */
  trigger: FetchTrigger;
  /** Channel edition passed to the adapter; not the UI language. */
  locale: string;
  /** Natural keys already present in the retention window; manual channels skip them. */
  excludeKeys?: ReadonlySet<string>;
  /** Manual pull size; 0 for channels that do not batch. */
  batchSize?: number;
  /** Feeds a pooled adapter pulls, in pull order. */
  feeds?: readonly RssFeedRef[];
  /** Browser executable override forwarded to the adapter. */
  browserPath?: string;
  /** Structured stage logger forwarded to the adapter. */
  log?: FetchLog;
  /** Fetch clock. Tests pin day boundaries; production leaves it undefined. */
  now?: Date;
}

export type FetchSummary =
  | {
      status: 'ok';
      sourceId: string;
      day: string;
      count: number;
      /** Natural keys this attempt added; separate from the merged total in `count`. */
      added: number;
      scanned?: number;
      exhausted?: boolean;
      truncated?: boolean;
      lastAttemptAt: string;
      lastSuccessAt: string;
    }
  | {
      status: 'error';
      sourceId: string;
      day: string;
      lastAttemptAt: string;
      error: string;
    }
  | {
      status: 'pending';
      sourceId: string;
      day: string;
      lastAttemptAt: string;
    }
  | {
      status: 'notPublished';
      sourceId: string;
      day: string;
      lastAttemptAt: string;
    };

const MAX_ERROR_LENGTH = 300;
const NO_ATTEMPTS: AutoAttempts = { day: '', count: 0 };

function attemptsAfter(previous: AutoAttempts | undefined, day: string, trigger: FetchTrigger): AutoAttempts {
  const attempts = previous ?? NO_ATTEMPTS;
  if (trigger !== 'auto') return attempts;
  const spent = attempts.day === day ? attempts.count : 0;
  return { day, count: spent + 1 };
}

function normalize(raw: RawItem[], source: SourceDescriptor, day: string, at: string, previous: FactFile | null): ItemRecord[] {
  const firstSeen = new Map((previous?.items ?? []).map((item) => [item.naturalKey, item.firstSeenAt]));
  return raw.map((item) => ({
    id: composeItemId(source.id, item.naturalKey),
    naturalKey: item.naturalKey,
    title: item.title,
    description: item.description,
    url: item.url,
    publishedAt: item.publishedAt,
    dayKey: day,
    firstSeenAt: firstSeen.get(item.naturalKey) ?? at,
    lastSeenAt: at,
    extra: item.extra,
  }));
}

export interface Accumulated {
  items: ItemRecord[];
  /** Natural keys that were not in the previous snapshot. */
  added: number;
}

/**
 * Merge one batch into the previous snapshot. New keys go first in incoming order; every
 * previous item keeps its id, extra, firstSeenAt and relative order, and only its
 * lastSeenAt is bumped when the incoming batch still contains it.
 */
export function accumulate(
  raw: readonly RawItem[],
  previous: FactFile | null,
  source: SourceDescriptor,
  day: string,
  at: string,
): Accumulated {
  const previousItems = previous?.items ?? [];
  const previousByKey = new Map(previousItems.map((item) => [item.naturalKey, item] as const));
  const incoming = new Map<string, RawItem>();
  for (const item of raw) if (!incoming.has(item.naturalKey)) incoming.set(item.naturalKey, item);

  const added: ItemRecord[] = [];
  for (const [naturalKey, item] of incoming) {
    if (previousByKey.has(naturalKey)) continue;
    added.push({
      id: composeItemId(source.id, naturalKey),
      naturalKey,
      title: item.title,
      description: item.description,
      url: item.url,
      publishedAt: item.publishedAt,
      dayKey: day,
      firstSeenAt: at,
      lastSeenAt: at,
      extra: item.extra,
    });
  }

  const kept = previousItems.map((item) =>
    incoming.has(item.naturalKey) ? { ...item, lastSeenAt: at } : item,
  );

  return { items: [...added, ...kept], added: added.length };
}

export function addedKeys(raw: readonly RawItem[], previous: FactFile | null): number {
  const seen = new Set((previous?.items ?? []).map((item) => item.naturalKey));
  const incoming = new Set<string>();
  for (const item of raw) if (!seen.has(item.naturalKey)) incoming.add(item.naturalKey);
  return incoming.size;
}

interface PullFlags {
  scanned?: number;
  exhausted?: boolean;
  truncated?: boolean;
}

function lastPullFlags(meta: Record<string, unknown> | undefined): PullFlags {
  const pull = meta?.lastPull;
  if (typeof pull !== 'object' || pull === null) return {};
  const fields = pull as Record<string, unknown>;
  return {
    ...(typeof fields.scanned === 'number' ? { scanned: fields.scanned } : {}),
    ...(typeof fields.exhausted === 'boolean' ? { exhausted: fields.exhausted } : {}),
    ...(typeof fields.truncated === 'boolean' ? { truncated: fields.truncated } : {}),
  };
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}

/**
 * One fetch attempt. `day === today` owns source health; a historical fetch (backfill)
 * never writes it, so it cannot reset the live channel's retry budget.
 */
export async function runFetch(request: FetchRequest): Promise<FetchSummary> {
  const { root, adapter, source, day, retentionDays, trigger, locale } = request;
  const now = request.now ?? new Date();
  const at = now.toISOString();
  const today = dayKeyOf(now);
  const l = layout(root);

  await prune(root, today, retentionDays);
  const previousHealth = await readHealth(l, source.id);
  const ctx: FetchContext = {
    now: at,
    day,
    today,
    locale,
    excludeKeys: request.excludeKeys ?? new Set<string>(),
    batchSize: request.batchSize ?? 0,
    cursor: previousHealth?.cursor ?? {},
    ...(request.feeds === undefined ? {} : { feeds: request.feeds }),
    ...(request.browserPath === undefined ? {} : { browserPath: request.browserPath }),
    ...(request.log === undefined ? {} : { log: request.log }),
  };

  let outcome: FetchOutcome;
  try {
    outcome = await adapter.fetch(ctx);
  } catch (error) {
    const text = errorText(error);
    if (day === today) {
      const health: HealthRecord = {
        version: CONTRACT_VERSION,
        lastAttemptAt: at,
        lastSuccessAt: previousHealth?.lastSuccessAt ?? '',
        consecutiveFailures: (previousHealth?.consecutiveFailures ?? 0) + 1,
        lastError: text,
        cursor: previousHealth?.cursor ?? {},
        autoAttempts: attemptsAfter(previousHealth?.autoAttempts, today, trigger),
        lastOutcome: 'error',
        pendingAttempts: previousHealth?.pendingAttempts ?? NO_ATTEMPTS,
      };
      await writeHealth(l, source.id, health);
    }
    return { status: 'error', sourceId: source.id, day, lastAttemptAt: at, error: text };
  }

  if (outcome.status === 'pending') {
    if (day === today) {
      await writeHealth(l, source.id, {
        version: CONTRACT_VERSION,
        lastAttemptAt: at,
        lastSuccessAt: previousHealth?.lastSuccessAt ?? '',
        consecutiveFailures: previousHealth?.consecutiveFailures ?? 0,
        lastError: '',
        cursor: previousHealth?.cursor ?? {},
        autoAttempts: previousHealth?.autoAttempts ?? NO_ATTEMPTS,
        lastOutcome: 'pending',
        pendingAttempts: attemptsAfter(previousHealth?.pendingAttempts, today, trigger),
      });
    }
    return { status: 'pending', sourceId: source.id, day, lastAttemptAt: at };
  }

  if (outcome.status === 'notPublished') {
    const fact: FactFile = {
      version: CONTRACT_VERSION,
      source,
      day,
      fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
      meta: { ...(outcome.meta ?? {}), notPublished: true },
      items: [],
    };
    await writeDayItems(l, fact);
    return { status: 'notPublished', sourceId: source.id, day, lastAttemptAt: at };
  }

  const previous = await readDayItemsSafe(l, day, source.id);
  const previousFact = previous.kind === 'ok' ? previous.fact : null;
  const accumulating = adapter.writeMode === 'accumulate';
  const merged = accumulating
    ? accumulate(outcome.items, previousFact, source, day, at)
    : {
        items: normalize(outcome.items, source, day, at, previousFact),
        added: addedKeys(outcome.items, previousFact),
      };
  const meta = accumulating
    ? { ...(previousFact?.meta ?? {}), ...(outcome.meta ?? {}) }
    : outcome.meta;
  const fact: FactFile = {
    version: CONTRACT_VERSION,
    source,
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    ...(meta === undefined || Object.keys(meta).length === 0 ? {} : { meta }),
    items: merged.items,
  };
  await writeDayItems(l, fact);

  if (day === today) {
    await writeHealth(l, source.id, {
      version: CONTRACT_VERSION,
      lastAttemptAt: at,
      lastSuccessAt: at,
      consecutiveFailures: 0,
      lastError: '',
      cursor: outcome.cursor ?? previousHealth?.cursor ?? {},
      autoAttempts: attemptsAfter(previousHealth?.autoAttempts, today, trigger),
      lastOutcome: 'ok',
      pendingAttempts: { day: today, count: 0 },
    });
  }

  return {
    status: 'ok',
    sourceId: source.id,
    day,
    count: merged.items.length,
    added: merged.added,
    ...lastPullFlags(outcome.meta),
    lastAttemptAt: at,
    lastSuccessAt: at,
  };
}
