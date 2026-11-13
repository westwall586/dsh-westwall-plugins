import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import { runFetch } from '../src/engine/fetch.ts';
import type { SourceDescriptor } from '../src/contract/types.ts';
import type { FetchContext, SourceAdapter } from '../src/sources/types.ts';
import { readHealth, writeHealth } from '../src/store/day.ts';
import { dayKeyOf, layout } from '../src/store/paths.ts';

const NOW = new Date(2026, 10, 12, 9, 0, 0);
const DAY = dayKeyOf(NOW);
const SOURCE: SourceDescriptor = { id: 'rss', name: 'RSS', type: 'rss' };

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-rss-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function adapterWith(fetch: (ctx: FetchContext) => ReturnType<SourceAdapter['fetch']>): SourceAdapter {
  return { type: 'rss', label: 'RSS', writeMode: 'accumulate', fetch };
}

test('the ok path writes the adapter cursor into health', async (t) => {
  const root = await workspace(t);
  const adapter = adapterWith(async () => ({
    status: 'ok',
    items: [],
    cursor: { feeds: { 'https://a.example/rss': { etag: '"v1"' } } },
  }));

  const summary = await runFetch({
    root,
    adapter,
    source: SOURCE,
    day: DAY,
    retentionDays: 30,
    trigger: 'manual',
    locale: 'zh',
    now: NOW,
  });

  assert.equal(summary.status, 'ok');
  const health = await readHealth(layout(root), 'rss');
  assert.deepEqual(health?.cursor, { feeds: { 'https://a.example/rss': { etag: '"v1"' } } });
});

test('a failed attempt preserves the previous cursor', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  await writeHealth(l, 'rss', {
    version: CONTRACT_VERSION,
    lastAttemptAt: '',
    lastSuccessAt: '',
    consecutiveFailures: 0,
    lastError: '',
    cursor: { feeds: { 'https://a.example/rss': { etag: '"keep"' } } },
    autoAttempts: { day: '', count: 0 },
    lastOutcome: '',
    pendingAttempts: { day: '', count: 0 },
  });

  const adapter = adapterWith(async () => {
    throw new Error('boom');
  });
  const summary = await runFetch({
    root,
    adapter,
    source: SOURCE,
    day: DAY,
    retentionDays: 30,
    trigger: 'auto',
    locale: 'zh',
    now: NOW,
  });

  assert.equal(summary.status, 'error');
  const health = await readHealth(l, 'rss');
  assert.deepEqual(health?.cursor, { feeds: { 'https://a.example/rss': { etag: '"keep"' } } });
  assert.equal(health?.consecutiveFailures, 1);
});

test('feeds and the prior cursor reach the adapter', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  await writeHealth(l, 'rss', {
    version: CONTRACT_VERSION,
    lastAttemptAt: '',
    lastSuccessAt: '',
    consecutiveFailures: 0,
    lastError: '',
    cursor: { feeds: { 'https://a.example/rss': { etag: '"seen"' } } },
    autoAttempts: { day: '', count: 0 },
    lastOutcome: '',
    pendingAttempts: { day: '', count: 0 },
  });

  const captured: { ctx: FetchContext | null } = { ctx: null };
  const adapter = adapterWith(async (ctx) => {
    captured.ctx = ctx;
    return { status: 'ok', items: [] };
  });
  await runFetch({
    root,
    adapter,
    source: SOURCE,
    day: DAY,
    retentionDays: 30,
    trigger: 'manual',
    locale: 'zh',
    feeds: [{ url: 'https://a.example/rss', name: 'A', channel: 'ch1' }],
    now: NOW,
  });

  assert.deepEqual(captured.ctx?.feeds, [{ url: 'https://a.example/rss', name: 'A', channel: 'ch1' }]);
  assert.deepEqual(captured.ctx?.cursor, { feeds: { 'https://a.example/rss': { etag: '"seen"' } } });
});
