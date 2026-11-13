import { parseFactFile, parseHealth } from '../contract/schema.ts';
import type { FactFile, HealthRecord } from '../contract/types.ts';
import { readJsonOr, writeJsonAtomic } from './atomic.ts';
import { healthFile, itemFile, type Layout } from './paths.ts';

export async function readDayItems(l: Layout, day: string, sourceId: string): Promise<FactFile | null> {
  const raw = await readJsonOr(itemFile(l, day, sourceId), null);
  return raw === null ? null : parseFactFile(raw);
}

/** Replaces the whole source-day file; a fetch is a snapshot, not an append. */
export async function writeDayItems(l: Layout, fact: FactFile): Promise<void> {
  await writeJsonAtomic(itemFile(l, fact.day, fact.source.id), fact);
}

export async function readHealth(l: Layout, sourceId: string): Promise<HealthRecord | null> {
  const raw = await readJsonOr(healthFile(l, sourceId), null);
  return raw === null ? null : parseHealth(raw);
}

export async function writeHealth(l: Layout, sourceId: string, health: HealthRecord): Promise<void> {
  await writeJsonAtomic(healthFile(l, sourceId), health);
}
