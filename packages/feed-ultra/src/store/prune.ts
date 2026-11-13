import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDayKey, layout, shiftDay } from './paths.ts';

export interface PruneResult {
  itemsDays: number;
  stateFiles: number;
  cacheFiles: number;
}

const JSON_SUFFIX = '.json';

async function readNames(dir: string, options: { directories: boolean }): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => (options.directories ? entry.isDirectory() : entry.isFile())).map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function isExpired(day: string, oldestKept: string): boolean {
  // Future-dated days are left alone: only aging out matters, and a skewed clock must not destroy data.
  return isDayKey(day) && day < oldestKept;
}

async function pruneDayFiles(dir: string, oldestKept: string): Promise<number> {
  let count = 0;
  for (const name of await readNames(dir, { directories: false })) {
    if (!name.endsWith(JSON_SUFFIX)) continue;
    if (!isExpired(name.slice(0, -JSON_SUFFIX.length), oldestKept)) continue;
    await rm(path.join(dir, name), { force: true });
    count += 1;
  }
  return count;
}

/** Deletes data older than the retention window. The window is [today - retentionDays + 1, today]. */
export async function prune(root: string, today: string, retentionDays: number): Promise<PruneResult> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error(`retentionDays must be a positive integer, got ${retentionDays}`);
  }
  const l = layout(root);
  const oldestKept = shiftDay(today, 1 - retentionDays);
  let itemsDays = 0;

  for (const day of await readNames(l.items, { directories: true })) {
    if (!isExpired(day, oldestKept)) continue;
    await rm(path.join(l.items, day), { recursive: true, force: true });
    itemsDays += 1;
  }

  return {
    itemsDays,
    stateFiles: await pruneDayFiles(l.state, oldestKept),
    cacheFiles: await pruneDayFiles(l.cache, oldestKept),
  };
}
