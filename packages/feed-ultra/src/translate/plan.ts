import type { ItemRecord } from '../contract/types.ts';
import { descriptionHash, validRecord, type DayCache } from '../store/cache.ts';
import { MAX_TEXT } from './prompt.ts';
import { clampText, isChinese } from './text.ts';

/** One description that needs the model, plus every item id that shares it. */
export interface PendingUnit {
  /** naturalKey, 'owner/repo'. The prompt key and the response key. */
  readonly key: string;
  /** Primary first; aliases share the same hash and get the same record. */
  readonly itemIds: readonly string[];
  readonly hash: string;
  /** Clamped for the request only; `hash` is of the untruncated description. */
  readonly text: string;
}

export interface PendingPlan {
  /** Item ids needing a record. */
  readonly missing: number;
  /** Item ids needing nothing: empty, already Chinese, or already translated. */
  readonly skipped: number;
  readonly units: readonly PendingUnit[];
}

/**
 * The single source of `missing` for the section, the source list, and the
 * engine. The Chinese skip runs before the cache check so a Chinese row can
 * never keep the translate button visible.
 */
export function planTranslations(cache: DayCache, items: readonly ItemRecord[]): PendingPlan {
  const units = new Map<string, { key: string; itemIds: string[]; hash: string; text: string }>();
  let missing = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.description.trim() === '') {
      skipped += 1;
      continue;
    }
    if (isChinese(item.description)) {
      skipped += 1;
      continue;
    }
    if (validRecord(cache, item) !== null) {
      skipped += 1;
      continue;
    }

    missing += 1;
    const hash = descriptionHash(item.description);
    const existing = units.get(hash);
    if (existing !== undefined) {
      existing.itemIds.push(item.id);
      continue;
    }
    units.set(hash, {
      key: item.naturalKey,
      itemIds: [item.id],
      hash,
      text: clampText(item.description, MAX_TEXT),
    });
  }

  return { missing, skipped, units: [...units.values()] };
}

/** Only a record whose hash matches may be shown; Chinese-ness is a spend rule, not a display rule. */
export function displayTranslations(
  cache: DayCache,
  items: readonly ItemRecord[],
): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  for (const item of items) {
    const record = validRecord(cache, item);
    if (record !== null) texts.set(item.id, record.text);
  }
  return texts;
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`);
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
  return batches;
}
