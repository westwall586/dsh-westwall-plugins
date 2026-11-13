import { CONTRACT_VERSION, stateFileSchema } from '../contract/schema.ts';
import type { ItemState } from '../contract/types.ts';
import type { ActItemResult } from '../contract/views.ts';
import { writeJsonAtomic } from './atomic.ts';
import { stateFile, type Layout } from './paths.ts';
import { readJsonSafe } from './read.ts';

/** Record reads in the write-day file, preserving any earlier `readAt` already stored there. */
export async function markRead(
  l: Layout,
  day: string,
  ids: readonly string[],
  at: string,
): Promise<ActItemResult[]> {
  const file = stateFile(l, day);
  const raw = await readJsonSafe(file);
  let items: Record<string, ItemState> = {};
  if (raw.status === 'ok') {
    const parsed = stateFileSchema.safeParse(raw.value);
    if (parsed.success) items = parsed.data.items;
  }

  let changed = false;
  for (const id of new Set(ids)) {
    if (Object.hasOwn(items, id)) continue;
    items[id] = { readAt: at };
    changed = true;
  }
  if (changed) await writeJsonAtomic(file, { version: CONTRACT_VERSION, day, items });

  return ids.map((id) => ({ id, status: 'ok' }));
}
