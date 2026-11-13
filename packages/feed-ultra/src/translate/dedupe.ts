import type { TranslationRecord } from '../contract/types.ts';
import type { DayCache } from '../store/cache.ts';

/** Derived from the cache window for one gated action; never persisted. */
export interface DedupeIndex {
  /** hash -> the newest record that carried that hash. */
  readonly byHash: ReadonlyMap<string, TranslationRecord>;
  /** Partitions folded in, ascending. */
  readonly days: readonly string[];
  /** Partitions that could not be parsed; the index stays usable, only lossier. */
  readonly unreadable: readonly string[];
  readonly builtAt: string;
}

export interface DedupeIndexInput {
  readonly caches: readonly DayCache[];
  readonly unreadable?: readonly string[];
  readonly builtAt: string;
}

export function buildDedupeIndex(input: DedupeIndexInput): DedupeIndex {
  const caches = [...input.caches].sort((left, right) => left.day.localeCompare(right.day));
  const byHash = new Map<string, TranslationRecord>();
  for (const cache of caches) {
    for (const record of Object.values(cache.items)) byHash.set(record.hash, record);
  }
  return {
    byHash,
    days: caches.map((cache) => cache.day),
    unreadable: [...(input.unreadable ?? [])],
    builtAt: input.builtAt,
  };
}

export function lookupByHash(index: DedupeIndex, hash: string): TranslationRecord | null {
  return index.byHash.get(hash) ?? null;
}
