import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { SourceDescriptor } from '../src/contract/types.ts';
import { runFetch, type FetchSummary } from '../src/engine/fetch.ts';
import { SourceFetchError, type FetchOutcome, type SourceAdapter } from '../src/sources/types.ts';
import { layout } from '../src/store/paths.ts';
import { readDayItemsSafe, readHealthSafe } from '../src/store/read.ts';

const DESCRIPTOR: SourceDescriptor = { id: 'test_source', name: 'Test Source', type: 'test' };
const DAY = '2026-11-10';
const NEXT_DAY = '2026-11-11';
const NOW = new Date(2026, 10, 10, 12, 0, 0);

type Behavior = 'ok' | 'fail' | 'pending' | 'notPublished';

function adapter(behavior: Behavior): SourceAdapter {
  return {
    type: 'test',
    label: 'Test',
    writeMode: 'replace',
    async fetch(): Promise<FetchOutcome> {
      if (behavior === 'fail') throw new SourceFetchError('network', 'network is down');
      if (behavior === 'pending') return { status: 'pending' };
      if (behavior === 'notPublished') return { status: 'notPublished', meta: { briefDate: DAY } };
      return {
        status: 'ok',
        items: [
          {
            naturalKey: 'acme/rocket',
            title: 'acme/rocket',
            description: 'A rocket',
            url: 'https://example.com/acme/rocket',
            publishedAt: NOW.toISOString(),
            extra: {},
          },
        ],
      };
    },
  };
}

async function root(t: TestContext): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-attempts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fetchWith(
  rootDir: string,
  behavior: Behavior,
  trigger: 'auto' | 'manual',
  options: { day?: string; now?: Date } = {},
): Promise<FetchSummary> {
  return runFetch({
    root: rootDir,
    adapter: adapter(behavior),
    source: DESCRIPTOR,
    day: options.day ?? DAY,
    retentionDays: 30,
    trigger,
    locale: 'zh',
    now: options.now ?? NOW,
  });
}

async function healthOf(rootDir: string) {
  const health = await readHealthSafe(layout(rootDir), DESCRIPTOR.id);
  assert.ok(health, 'health was written');
  return health;
}

test('a successful automatic fetch spends one attempt', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'ok', 'auto');
  assert.deepEqual((await healthOf(dir)).autoAttempts, { day: DAY, count: 1 });
});

test('a failed automatic fetch still spends the attempt', async (t) => {
  const dir = await root(t);
  const summary = await fetchWith(dir, 'fail', 'auto');

  assert.equal(summary.status, 'error');
  assert.deepEqual((await healthOf(dir)).autoAttempts, { day: DAY, count: 1 });
});

test('manual fetches never spend the automatic budget', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'fail', 'auto');
  await fetchWith(dir, 'fail', 'manual');

  assert.deepEqual((await healthOf(dir)).autoAttempts, { day: DAY, count: 1 });
});

test('the counter accumulates across attempts on the same day', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'fail', 'auto');
  await fetchWith(dir, 'fail', 'auto');

  assert.deepEqual((await healthOf(dir)).autoAttempts, { day: DAY, count: 2 });
});

test('a new day starts the counter over', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'fail', 'auto');

  await fetchWith(dir, 'fail', 'auto', { day: NEXT_DAY, now: new Date(2026, 10, 11, 12, 0, 0) });
  assert.deepEqual((await healthOf(dir)).autoAttempts, { day: NEXT_DAY, count: 1 });
});

test('a manual fetch on a fresh day does not invent an automatic attempt', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'ok', 'manual');
  assert.deepEqual((await healthOf(dir)).autoAttempts, { day: '', count: 0 });
});

test('an automatic pending attempt spends the pending budget but not the failure budget', async (t) => {
  const dir = await root(t);
  const summary = await fetchWith(dir, 'pending', 'auto');

  assert.equal(summary.status, 'pending');
  const health = await healthOf(dir);
  assert.equal(health.lastOutcome, 'pending');
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastError, '');
  assert.deepEqual(health.autoAttempts, { day: '', count: 0 });
  assert.deepEqual(health.pendingAttempts, { day: DAY, count: 1 });
  assert.equal((await readDayItemsSafe(layout(dir), DAY, DESCRIPTOR.id)).kind, 'missing', 'no snapshot is written');
});

test('a manual pending attempt updates the outcome but never the pending budget', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'pending', 'manual');

  const health = await healthOf(dir);
  assert.equal(health.lastOutcome, 'pending');
  assert.deepEqual(health.pendingAttempts, { day: '', count: 0 });
});

test('pending preserves the last success and the failure count', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'ok', 'auto');
  const success = await healthOf(dir);

  await fetchWith(dir, 'pending', 'auto');
  const health = await healthOf(dir);
  assert.equal(health.lastSuccessAt, success.lastSuccessAt);
  assert.equal(health.consecutiveFailures, 0);
  assert.deepEqual(health.autoAttempts, { day: DAY, count: 1 });
});

test('notPublished writes an empty snapshot and never writes health', async (t) => {
  const dir = await root(t);
  const summary = await fetchWith(dir, 'notPublished', 'manual', { day: NEXT_DAY, now: new Date(2026, 10, 11, 12, 0, 0) });

  assert.equal(summary.status, 'notPublished');
  const fact = await readDayItemsSafe(layout(dir), NEXT_DAY, DESCRIPTOR.id);
  assert.equal(fact.kind, 'ok');
  if (fact.kind !== 'ok') return;
  assert.equal(fact.fact.items.length, 0);
  assert.equal(fact.fact.meta?.notPublished, true);
  assert.equal(await readHealthSafe(layout(dir), DESCRIPTOR.id), null);
});

test('notPublished for today also leaves the existing health untouched', async (t) => {
  const dir = await root(t);
  await fetchWith(dir, 'ok', 'auto');
  const before = await healthOf(dir);

  await fetchWith(dir, 'notPublished', 'auto');
  assert.deepEqual(await healthOf(dir), before);
});
