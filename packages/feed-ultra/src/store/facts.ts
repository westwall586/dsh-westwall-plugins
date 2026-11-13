import type { ItemRecord } from '../contract/types.ts';
import { writeDayItems } from './day.ts';
import type { Layout } from './paths.ts';
import { readDayItemsSafe } from './read.ts';

/** Union of `naturalKey`s this source holds across the retention window. Both ends included. */
export async function readWindowKeys(l: Layout, sourceId: string, days: readonly string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const day of days) {
    const result = await readDayItemsSafe(l, day, sourceId);
    if (result.kind !== 'ok') continue;
    for (const item of result.fact.items) keys.add(item.naturalKey);
  }
  return keys;
}

/** The item behind one id, looked up across the window; the latest day that holds it wins. */
export async function findWindowItem(
  l: Layout,
  sourceId: string,
  days: readonly string[],
  itemId: string,
): Promise<ItemRecord | null> {
  let found: ItemRecord | null = null;
  for (const day of days) {
    const result = await readDayItemsSafe(l, day, sourceId);
    if (result.kind !== 'ok') continue;
    const item = result.fact.items.find((candidate) => candidate.id === itemId);
    if (item) found = item;
  }
  return found;
}

/**
 * Marks `extra.xDeletedAt` on every day fact that still holds the item. A missing or corrupt
 * day file is skipped; the write is atomic and keeps item order and every other field.
 * Returns how many files actually changed.
 */
export async function markItemDeleted(
  l: Layout,
  sourceId: string,
  days: readonly string[],
  itemId: string,
  at: string,
): Promise<number> {
  let changed = 0;
  for (const day of days) {
    const result = await readDayItemsSafe(l, day, sourceId);
    if (result.kind !== 'ok') continue;
    let held = false;
    let modified = false;
    const items = result.fact.items.map((item) => {
      if (item.id !== itemId) return item;
      held = true;
      if (typeof item.extra.xDeletedAt === 'string') return item;
      modified = true;
      return { ...item, extra: { ...item.extra, xDeletedAt: at } };
    });
    if (!held || !modified) continue;
    await writeDayItems(l, { ...result.fact, items });
    changed += 1;
  }
  return changed;
}
