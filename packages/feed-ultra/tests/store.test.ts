import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, HealthRecord } from '../src/contract/types.ts';
import { readJsonOr, writeJsonAtomic } from '../src/store/atomic.ts';
import { readDayItems, readHealth, writeDayItems, writeHealth } from '../src/store/day.ts';
import { healthFile, itemFile, layout, stateFile, type Layout } from '../src/store/paths.ts';

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fact(day: string, naturalKeys: string[]): FactFile {
  const at = `${day}T09:00:00Z`;
  return {
    version: CONTRACT_VERSION,
    source: { id: 'github_trending', name: 'GitHub Trending', type: 'github-trending' },
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    items: naturalKeys.map((naturalKey, index) => ({
      id: composeItemId('github_trending', naturalKey),
      naturalKey,
      title: naturalKey,
      description: `description ${index}`,
      url: `https://github.com/${naturalKey}`,
      publishedAt: at,
      dayKey: day,
      firstSeenAt: at,
      lastSeenAt: at,
      extra: { rank: index + 1 },
    })),
  };
}

test('round-trips a day file through the contract schema', async (t) => {
  const l = layout(await workspace(t));
  const written = fact('2026-11-10', ['openai/dot', 'acme/rocket']);
  await writeDayItems(l, written);
  assert.deepEqual(await readDayItems(l, '2026-11-10', 'github_trending'), written);
});

test('replaces the whole source-day file instead of appending', async (t) => {
  const l = layout(await workspace(t));
  await writeDayItems(l, fact('2026-11-10', ['openai/dot', 'acme/rocket', 'acme/ship']));
  await writeDayItems(l, fact('2026-11-10', ['acme/rocket']));

  const after = await readDayItems(l, '2026-11-10', 'github_trending');
  assert.ok(after);
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].naturalKey, 'acme/rocket');
});

test('a write touches only its own day file', async (t) => {
  const l = layout(await workspace(t));
  await writeDayItems(l, fact('2026-11-09', ['openai/dot']));
  await writeDayItems(l, fact('2026-11-10', ['openai/dot']));
  await writeDayItems(l, fact('2026-11-10', ['acme/rocket']));

  const untouched = await readDayItems(l, '2026-11-09', 'github_trending');
  assert.ok(untouched);
  assert.deepEqual(
    untouched.items.map((item) => item.naturalKey),
    ['openai/dot'],
  );
});

test('atomic writes leave no temp file behind', async (t) => {
  const l = layout(await workspace(t));
  await writeDayItems(l, fact('2026-11-10', ['openai/dot']));
  await writeDayItems(l, fact('2026-11-10', ['acme/rocket']));
  const names = await readdir(l.root, { recursive: true });
  assert.deepEqual(
    names.filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('round-trips health, including a source that never succeeded', async (t) => {
  const l = layout(await workspace(t));
  const health: HealthRecord = {
    version: CONTRACT_VERSION,
    lastAttemptAt: '2026-11-10T09:00:00Z',
    lastSuccessAt: '',
    consecutiveFailures: 2,
    lastError: 'GET https://github.com/trending returned 503',
    cursor: {},
    autoAttempts: { day: '2026-11-10', count: 2 },
    lastOutcome: 'error',
    pendingAttempts: { day: '2026-11-10', count: 0 },
  };
  await writeHealth(l, 'github_trending', health);
  assert.deepEqual(await readHealth(l, 'github_trending'), health);
});

test('an older health file without lastOutcome and pendingAttempts reads with defaults', async (t) => {
  const l = layout(await workspace(t));
  await writeJsonAtomic(healthFile(l, 'github_trending'), {
    version: CONTRACT_VERSION,
    lastAttemptAt: '2026-11-10T09:00:00Z',
    lastSuccessAt: '',
    consecutiveFailures: 1,
    lastError: 'boom',
    cursor: {},
    autoAttempts: { day: '2026-11-10', count: 1 },
  });

  const health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.equal(health.lastOutcome, '');
  assert.deepEqual(health.pendingAttempts, { day: '', count: 0 });
});

test('missing files read as null', async (t) => {
  const l = layout(await workspace(t));
  assert.equal(await readDayItems(l, '2026-11-10', 'github_trending'), null);
  assert.equal(await readHealth(l, 'github_trending'), null);
});

test('readJsonOr falls back only when the file is missing', async (t) => {
  const root = await workspace(t);
  assert.deepEqual(await readJsonOr(path.join(root, 'missing.json'), null), null);

  const corrupt = path.join(root, 'corrupt.json');
  await writeFile(corrupt, '{ not json', 'utf8');
  await assert.rejects(readJsonOr(corrupt, null), SyntaxError);
});

test('a day file that breaks the contract is rejected on read', async (t) => {
  const l = layout(await workspace(t));
  await writeJsonAtomic(itemFile(l, '2026-11-10', 'github_trending'), { ...fact('2026-11-10', []), version: 99 });
  await assert.rejects(readDayItems(l, '2026-11-10', 'github_trending'));
});

test('day paths reject values that would escape the layout', async (t) => {
  const l = layout(await workspace(t));
  assert.throws(() => itemFile(l, '../2026-11-10', 'github_trending'), /invalid day key/);
  assert.throws(() => stateFile(l, '../../etc/passwd'), /invalid day key/);
  assert.throws(() => healthFile(l, '../github_trending'), /invalid source id/);
});

test('the written file is readable JSON with a trailing newline', async (t) => {
  const l = layout(await workspace(t));
  await writeDayItems(l, fact('2026-11-10', ['openai/dot']));
  const text = await readFile(itemFile(l, '2026-11-10', 'github_trending'), 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.equal(JSON.parse(text).items.length, 1);
});

test('a legacy .dailies root is moved to .dsh-feeds on first use', async (t) => {
  const root = await workspace(t);
  await mkdir(path.join(root, '.dailies', 'data'), { recursive: true });
  await writeFile(path.join(root, '.dailies', 'data', 'marker.txt'), 'kept', 'utf8');
  const l = layout(root);
  assert.equal(l.root, path.join(root, '.dsh-feeds'));
  assert.equal(await readFile(path.join(root, '.dsh-feeds', 'data', 'marker.txt'), 'utf8'), 'kept');
  assert.equal(existsSync(path.join(root, '.dailies')), false);
});
