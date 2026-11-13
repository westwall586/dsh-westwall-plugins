import { rename } from 'node:fs/promises';
import {
  EMPTY_RSS_LIBRARY,
  normalizeLibrary,
  parseRssLibrary,
  type RssLibrary,
} from '../contract/rss-library.ts';
import { writeJsonAtomic } from './atomic.ts';
import { rssLibraryCorruptFile, rssLibraryFile, type Layout } from './paths.ts';
import { readJsonSafe } from './read.ts';
import { createSerialGate } from './serial.ts';

export interface ImportCount {
  added: number;
  skipped: number;
}

export interface LibraryRead {
  library: RssLibrary;
  /** Set when the read moved a corrupt file aside. */
  recoveredFrom?: string;
}

export type LibraryChange =
  | RssLibrary
  | { library: RssLibrary; lastImport?: ImportCount };

export interface LibraryMutation extends LibraryRead {
  lastImport?: ImportCount;
}

export interface RssLibraryStore {
  read(l: Layout): Promise<LibraryRead>;
  /** Serialized per workspace; the write happens only after `change` returns. */
  mutate(l: Layout, change: (library: RssLibrary) => LibraryChange): Promise<LibraryMutation>;
}

export function createRssLibraryStore(deps: { now(): Date }): RssLibraryStore {
  const gate = createSerialGate();

  async function read(l: Layout): Promise<LibraryRead> {
    const file = rssLibraryFile(l);
    const raw = await readJsonSafe(file);
    if (raw.status === 'missing') return { library: EMPTY_RSS_LIBRARY };

    if (raw.status === 'ok') {
      try {
        return { library: parseRssLibrary(raw.value) };
      } catch {
        // The backup path below owns every unreadable shape.
      }
    }

    const backup = rssLibraryCorruptFile(l, deps.now().toISOString());
    try {
      await rename(file, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeJsonAtomic(file, EMPTY_RSS_LIBRARY);
    return { library: EMPTY_RSS_LIBRARY, recoveredFrom: backup };
  }

  async function mutate(l: Layout, change: (library: RssLibrary) => LibraryChange): Promise<LibraryMutation> {
    return gate.run(l.root, async () => {
      const current = await read(l);
      const result = change(current.library);
      const next = 'library' in result ? result.library : result;
      const lastImport = 'library' in result ? result.lastImport : undefined;
      if (next === current.library) {
        return {
          library: current.library,
          ...(current.recoveredFrom === undefined ? {} : { recoveredFrom: current.recoveredFrom }),
          ...(lastImport === undefined ? {} : { lastImport }),
        };
      }
      const library = normalizeLibrary({ ...next, version: 1, updatedAt: deps.now().toISOString() });
      await writeJsonAtomic(rssLibraryFile(l), library);
      return {
        library,
        ...(current.recoveredFrom === undefined ? {} : { recoveredFrom: current.recoveredFrom }),
        ...(lastImport === undefined ? {} : { lastImport }),
      };
    });
  }

  return { read, mutate };
}
