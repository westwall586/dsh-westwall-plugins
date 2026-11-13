import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import type { RawItem, SourceDescriptor } from '../src/contract/types.ts';
import { runFetch } from '../src/engine/fetch.ts';
import type { FetchOutcome, SourceAdapter } from '../src/sources/types.ts';
import { readDayItems, writeDayItems } from '../src/store/day.ts';
import { itemFile, layout } from '../src/store/paths.ts';

const DAY = '2026-11-11';
const NOW = new Date(2026, 10, 11, 8, 0, 0);
const LATER = new Date(2026, 10, 11, 9, 30, 0);

const SOURCE: SourceDescriptor = { id: 'x_bookmarks', name: 'X Bookmarks', type: 'x-bookmarks' };

function raw(naturalKey: string, extra: Record<string, unknown> = {}): RawItem {
  return {
    naturalKey,
    title: `title ${naturalKey}`,
    description: `description ${naturalKey}`,
    url: `https://x.com/i/status/${naturalKey}`,
    publishedAt: '2026-11-10T07:07:00.000Z',
    extra,
  };
}

interface Batch {
  items: RawItem[];
  meta?: Record<string, unknown>;
}

function accumulateAdapter(batch: () => Batch): SourceAdapter {
  return {
    type: SOURCE.type,
    label: SOURCE.name,
    writeMode: 'accumulate',
    async fetch(): Promise<FetchOutcome> {
      const current = batch();
      return { status: 'ok', items: current.items, ...(current.meta === undefined ? {} : { meta: current.meta }) };
    },
  };
}

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-accumulate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fetchWith(root: string, adapter: SourceAdapter, now: Date) {
  return runFetch({
    root,
    adapter,
    source: SOURCE,
    day: DAY,
    retentionDays: 30,
    trigger: 'manual',
    locale: 'zh',
    now,
  });
}

test('accumulate keeps previous item objects and puts new keys first', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  let batch: Batch = {
    items: [raw('alpha', { rank: 1 }), raw('beta', { rank: 2 })],
    meta: {
      keep: 'yes',
      lastPull: { at: NOW.toISOString(), requested: 2, added: 2, scanned: 2, exhausted: false, truncated: false },
    },
  };
  const adapter = accumulateAdapter(() => batch);

  const first = await fetchWith(root, adapter, NOW);
  assert.equal(first.status, 'ok');
  assert.equal(first.count, 2);
  assert.equal(first.status === 'ok' ? first.added : -1, 2);

  const firstFile = await readDayItems(l, DAY, SOURCE.id);
  assert.ok(firstFile);
  const alphaBefore = firstFile.items.find((item) => item.naturalKey === 'alpha');
  const betaBefore = firstFile.items.find((item) => item.naturalKey === 'beta');
  assert.ok(alphaBefore);
  assert.ok(betaBefore);
  assert.equal(alphaBefore.firstSeenAt, NOW.toISOString());

  // A delete wrote xDeletedAt locally; the next pull must not clear it.
  await writeDayItems(l, {
    ...firstFile,
    items: firstFile.items.map((item) =>
      item.naturalKey === 'alpha' ? { ...item, extra: { ...item.extra, xDeletedAt: '2026-11-11T08:30:00.000Z' } } : item,
    ),
  });

  batch = {
    items: [raw('beta', { rank: 2 }), raw('gamma', { rank: 3 })],
    meta: { lastPull: { at: LATER.toISOString(), requested: 2, added: 1, scanned: 4, exhausted: true, truncated: false } },
  };
  const second = await fetchWith(root, adapter, LATER);
  assert.equal(second.status, 'ok');
  assert.equal(second.count, 3, 'count is the merged total');
  assert.equal(second.status === 'ok' ? second.added : -1, 1, 'added counts genuinely new keys');
  assert.equal(second.status === 'ok' ? second.scanned : -1, 4);
  assert.equal(second.status === 'ok' ? second.exhausted : false, true);

  const merged = await readDayItems(l, DAY, SOURCE.id);
  assert.ok(merged);
  assert.deepEqual(
    merged.items.map((item) => item.naturalKey),
    ['gamma', 'alpha', 'beta'],
    'new items first in incoming order, then previous items in file order',
  );

  const alpha = merged.items.find((item) => item.naturalKey === 'alpha');
  const beta = merged.items.find((item) => item.naturalKey === 'beta');
  const gamma = merged.items.find((item) => item.naturalKey === 'gamma');
  assert.ok(alpha);
  assert.ok(beta);
  assert.ok(gamma);

  assert.equal(alpha.id, composeItemId(SOURCE.id, 'alpha'));
  assert.equal(alpha.firstSeenAt, NOW.toISOString(), 'firstSeenAt survives a merge');
  assert.equal(alpha.lastSeenAt, NOW.toISOString(), 'an item outside the batch keeps lastSeenAt');
  assert.deepEqual(alpha.extra, { rank: 1, xDeletedAt: '2026-11-11T08:30:00.000Z' });
  assert.equal(beta.firstSeenAt, NOW.toISOString());
  assert.equal(beta.lastSeenAt, LATER.toISOString(), 'a seen key bumps lastSeenAt');
  assert.equal(gamma.firstSeenAt, LATER.toISOString());

  assert.equal(merged.meta?.keep, 'yes', 'other meta keys survive');
  assert.equal((merged.meta?.lastPull as Record<string, unknown>).requested, 2, 'lastPull is overwritten');
  assert.equal((merged.meta?.lastPull as Record<string, unknown>).scanned, 4);
});

test('a second batch of seen keys adds nothing and keeps the total', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  let batch: Batch = { items: [raw('alpha'), raw('beta')] };
  const adapter = accumulateAdapter(() => batch);

  await fetchWith(root, adapter, NOW);
  batch = { items: [raw('beta'), raw('alpha')] };
  const second = await fetchWith(root, adapter, LATER);

  assert.equal(second.status, 'ok');
  assert.equal(second.count, 2);
  assert.equal(second.status === 'ok' ? second.added : -1, 0);

  const merged = await readDayItems(l, DAY, SOURCE.id);
  assert.ok(merged);
  assert.deepEqual(
    merged.items.map((item) => item.naturalKey),
    ['alpha', 'beta'],
    'the previous file order stays when every key is already known',
  );
});

test('a corrupt previous snapshot merges against empty instead of blocking the write', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  const file = itemFile(l, DAY, SOURCE.id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{ not json', 'utf8');

  const adapter = accumulateAdapter(() => ({ items: [raw('alpha')], meta: { lastPull: { at: LATER.toISOString() } } }));
  const result = await fetchWith(root, adapter, LATER);

  assert.equal(result.status, 'ok');
  assert.equal(result.count, 1);
  assert.equal(result.status === 'ok' ? result.added : -1, 1);
  const fact = await readDayItems(l, DAY, SOURCE.id);
  assert.ok(fact);
  assert.equal(fact.items[0]?.naturalKey, 'alpha');
  assert.equal(fact.items[0]?.firstSeenAt, LATER.toISOString());
});

test('incoming duplicates collapse inside one accumulate batch', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  const adapter = accumulateAdapter(() => ({ items: [raw('alpha', { which: 'first' }), raw('alpha', { which: 'second' })] }));

  const result = await fetchWith(root, adapter, NOW);
  assert.equal(result.status, 'ok');
  assert.equal(result.count, 1);
  assert.equal(result.status === 'ok' ? result.added : -1, 1);

  const fact = await readDayItems(l, DAY, SOURCE.id);
  assert.ok(fact);
  assert.deepEqual(fact.items[0]?.extra, { which: 'first' });
});
