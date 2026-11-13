import { createHash } from 'node:crypto';
import { CONTRACT_VERSION, parseCacheFile } from '../contract/schema.ts';
import type { ItemRecord, TranslationRecord } from '../contract/types.ts';
import { writeJsonAtomic } from './atomic.ts';
import { cacheFile, type Layout } from './paths.ts';
import { readJsonSafe } from './read.ts';

/** One day's cache, parsed and sanitized. `readonly` is the caller's contract, not a frozen object. */
export interface DayCache {
  readonly day: string;
  readonly items: Readonly<Record<string, TranslationRecord>>;
}

export interface WindowCache {
  /** Ascending day order. */
  readonly caches: readonly DayCache[];
  /** Partitions that exist but cannot be parsed; a missing partition is not listed. */
  readonly unreadable: readonly string[];
}

export function emptyDayCache(day: string): DayCache {
  return { day, items: {} };
}

async function readCache(l: Layout, day: string): Promise<{ cache: DayCache; unreadable: boolean }> {
  const raw = await readJsonSafe(cacheFile(l, day));
  if (raw.status === 'missing') return { cache: emptyDayCache(day), unreadable: false };
  if (raw.status === 'corrupt') return { cache: emptyDayCache(day), unreadable: true };

  try {
    const parsed = parseCacheFile(raw.value);
    // A file whose envelope names another day is not this day's cache.
    if (parsed.day !== day) return { cache: emptyDayCache(day), unreadable: true };
    return { cache: { day: parsed.day, items: parsed.items }, unreadable: false };
  } catch {
    return { cache: emptyDayCache(day), unreadable: true };
  }
}

/** Tolerant read: corrupt content degrades to "no records", I/O failures still throw. */
export async function readDayCache(l: Layout, day: string): Promise<DayCache> {
  return (await readCache(l, day)).cache;
}

/** Ascending. A partition that cannot be read is reported instead of failing the window. */
export async function readWindowCache(l: Layout, days: readonly string[]): Promise<WindowCache> {
  const caches: DayCache[] = [];
  const unreadable: string[] = [];
  for (const day of [...days].sort()) {
    try {
      const read = await readCache(l, day);
      caches.push(read.cache);
      if (read.unreadable) unreadable.push(day);
    } catch {
      caches.push(emptyDayCache(day));
      unreadable.push(day);
    }
  }
  return { caches, unreadable };
}

/** Whole-file atomic replace. The caller holds the day gate. */
export async function writeDayCache(l: Layout, cache: DayCache): Promise<void> {
  await writeJsonAtomic(cacheFile(l, cache.day), {
    version: CONTRACT_VERSION,
    day: cache.day,
    items: cache.items,
  });
}

/** The validity rule: a record is usable only while its hash matches the current description. */
export function validRecord(cache: DayCache, item: ItemRecord): TranslationRecord | null {
  const record = cache.items[item.id];
  if (record === undefined) return null;
  return record.hash === descriptionHash(item.description) ? record : null;
}

/** Pure merge, later entries win per item id. */
export function withRecords(
  cache: DayCache,
  records: Iterable<readonly [string, TranslationRecord]>,
): DayCache {
  const items: Record<string, TranslationRecord> = { ...cache.items };
  for (const [id, record] of records) items[id] = record;
  return { day: cache.day, items };
}

/**
 * The cache's identity function: sha256 of the trimmed description, lowercase hex.
 * Changing it invalidates every stored record, so it is part of the cache format.
 */
export function descriptionHash(description: string): string {
  return createHash('sha256').update(description.trim(), 'utf8').digest('hex');
}
