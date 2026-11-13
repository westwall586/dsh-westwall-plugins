import { stateFileSchema } from '../contract/schema.ts';
import type { ItemState, StateFile } from '../contract/types.ts';
import { stateFile, type Layout } from './paths.ts';
import { readJsonSafe } from './read.ts';

async function readStateDay(file: string): Promise<StateFile | null> {
  const raw = await readJsonSafe(file);
  if (raw.status !== 'ok') return null;
  const parsed = stateFileSchema.safeParse(raw.value);
  // A corrupt day file degrades to "that day is unreadable" instead of failing the whole window.
  return parsed.success ? parsed.data : null;
}

/** State is partitioned by write day, so the latest write across the window wins. */
export async function readMergedState(l: Layout, rangeDays: readonly string[]): Promise<Record<string, ItemState>> {
  const merged: Record<string, ItemState> = {};
  for (const day of [...rangeDays].sort()) {
    const state = await readStateDay(stateFile(l, day));
    if (state) Object.assign(merged, state.items);
  }
  return merged;
}
