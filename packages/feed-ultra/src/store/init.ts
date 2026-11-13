import { mkdir, stat } from 'node:fs/promises';
import type { Layout } from './paths.ts';

/** Create the whole `.dsh-feeds` tree; `created` reports whether the root itself was missing. */
export async function ensureLayout(l: Layout): Promise<{ created: boolean }> {
  let created = false;
  try {
    await stat(l.root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    created = true;
  }

  await Promise.all([
    mkdir(l.items, { recursive: true }),
    mkdir(l.state, { recursive: true }),
    mkdir(l.cache, { recursive: true }),
    mkdir(l.health, { recursive: true }),
  ]);
  return { created };
}
