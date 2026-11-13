import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile } from '../src/contract/types.ts';
import { writeJsonAtomic } from '../src/store/atomic.ts';
import { writeDayItems } from '../src/store/day.ts';
import { cacheFile, itemDayDir, layout, stateFile, type Layout } from '../src/store/paths.ts';
import { prune } from '../src/store/prune.ts';

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-prune-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function fact(day: string): FactFile {
  const at = `${day}T09:00:00Z`;
  const naturalKey = 'openai/dot';
  return {
    version: CONTRACT_VERSION,
    source: { id: 'github_trending', name: 'GitHub Trending', type: 'github-trending' },
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    items: [
      {
        id: composeItemId('github_trending', naturalKey),
        naturalKey,
        title: naturalKey,
        description: '',
        url: 'https://github.com/openai/dot',
        publishedAt: at,
        dayKey: day,
        firstSeenAt: at,
        lastSeenAt: at,
        extra: { rank: 1 },
      },
    ],
  };
}

async function seed(l: Layout, day: string): Promise<void> {
  await writeDayItems(l, fact(day));
  await writeJsonAtomic(stateFile(l, day), { version: CONTRACT_VERSION, day, items: {} });
  await writeJsonAtomic(cacheFile(l, day), { version: CONTRACT_VERSION, day, items: {} });
}

test('deletes only days outside the retention window', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  for (const day of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07']) {
    await seed(l, day);
  }
  await writeJsonAtomic(path.join(l.state, 'notes.json'), { keep: true });
  await writeJsonAtomic(path.join(l.state, '2026-01-01.txt'), 'keep');
  await writeJsonAtomic(path.join(l.items, 'not-a-day', 'github_trending.json'), fact('2026-01-01'));

  const result = await prune(root, '2026-01-06', 3);
  assert.deepEqual(result, { itemsDays: 3, stateFiles: 3, cacheFiles: 3 });

  for (const day of ['2026-01-01', '2026-01-02', '2026-01-03']) {
    assert.equal(await exists(itemDayDir(l, day)), false, `${day} items should be gone`);
    assert.equal(await exists(stateFile(l, day)), false, `${day} state should be gone`);
    assert.equal(await exists(cacheFile(l, day)), false, `${day} cache should be gone`);
  }
  for (const day of ['2026-01-04', '2026-01-05', '2026-01-06']) {
    assert.equal(await exists(itemDayDir(l, day)), true, `${day} items should stay`);
    assert.equal(await exists(stateFile(l, day)), true, `${day} state should stay`);
    assert.equal(await exists(cacheFile(l, day)), true, `${day} cache should stay`);
  }
  assert.equal(await exists(path.join(l.items, 'not-a-day')), true);
  assert.equal(await exists(path.join(l.state, 'notes.json')), true);
  assert.equal(await exists(path.join(l.state, '2026-01-01.txt')), true);

  assert.deepEqual(await prune(root, '2026-01-06', 3), { itemsDays: 0, stateFiles: 0, cacheFiles: 0 });
});

test('retention 1 keeps today and any future-dated day', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  for (const day of ['2026-01-05', '2026-01-06', '2026-01-07']) await seed(l, day);

  const result = await prune(root, '2026-01-06', 1);
  assert.deepEqual(result, { itemsDays: 1, stateFiles: 1, cacheFiles: 1 });
  assert.equal(await exists(itemDayDir(l, '2026-01-05')), false);
  assert.equal(await exists(itemDayDir(l, '2026-01-06')), true);
  assert.equal(await exists(itemDayDir(l, '2026-01-07')), true);
});

test('pruning an uninitialized workspace is a no-op', async (t) => {
  const root = await workspace(t);
  assert.deepEqual(await prune(root, '2026-01-06', 30), { itemsDays: 0, stateFiles: 0, cacheFiles: 0 });
});

test('rejects a retention window that would delete everything', async (t) => {
  const root = await workspace(t);
  await assert.rejects(prune(root, '2026-01-06', 0), /positive integer/);
  await assert.rejects(prune(root, '2026-01-06', 1.5), /positive integer/);
});
