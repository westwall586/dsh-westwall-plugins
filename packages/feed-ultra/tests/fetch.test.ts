import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile } from '../src/contract/types.ts';
import { runFetch } from '../src/engine/fetch.ts';
import { createAdapter, descriptor } from '../src/sources/github-trending/index.ts';
import type { FetchOutcome, SourceAdapter } from '../src/sources/types.ts';
import { readDayItems, readHealth, writeDayItems } from '../src/store/day.ts';
import { layout, shiftDay } from '../src/store/paths.ts';
import { readDayItemsSafe } from '../src/store/read.ts';

const FIXTURE = fileURLToPath(new URL('../src/sources/github-trending/fixtures/trending-2026-11-10.html', import.meta.url));
const DAY = '2026-11-10';
const NOW = new Date(2026, 10, 10, 12, 0, 0);
const YESTERDAY = shiftDay(DAY, -1);

interface Response {
  status: number;
  body: string;
}

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-fetch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function serve(t: TestContext, respond: () => Response, requests: Array<{ url: string; userAgent: string }>): Promise<string> {
  const server = createServer((request, response) => {
    requests.push({ url: request.url ?? '', userAgent: request.headers['user-agent'] ?? '' });
    const { status, body } = respond();
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function fixedAdapter(outcome: (now: string) => FetchOutcome): SourceAdapter {
  return {
    type: 'test',
    label: 'Test',
    writeMode: 'replace',
    async fetch({ now }) {
      return outcome(now);
    },
  };
}

function oneItem(now: string) {
  return {
    naturalKey: 'acme/rocket',
    title: 'acme/rocket',
    description: 'A rocket',
    url: 'https://example.com/acme/rocket',
    publishedAt: now,
    extra: {},
  };
}

function seededFact(day: string): FactFile {
  const at = `${day}T00:00:00Z`;
  return {
    version: CONTRACT_VERSION,
    source: descriptor,
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    items: [
      {
        id: composeItemId('github_trending', 'openai/dot'),
        naturalKey: 'openai/dot',
        title: 'openai/dot',
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

test('fetches the fixture, replaces the day snapshot and resets health', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  const html = await readFile(FIXTURE, 'utf8');
  const requests: Array<{ url: string; userAgent: string }> = [];
  const baseUrl = await serve(t, () => ({ status: 200, body: html }), requests);
  const adapter = createAdapter({ baseUrl });

  await writeDayItems(l, seededFact('2026-09-01'));

  const first = await runFetch({ root, adapter, source: descriptor, day: DAY, retentionDays: 30, trigger: 'auto', locale: 'zh', now: NOW });
  assert.equal(first.status, 'ok');
  assert.equal(first.count, 11);

  const firstFile = await readDayItems(l, DAY, 'github_trending');
  assert.ok(firstFile);
  assert.equal(firstFile.version, 1);
  assert.deepEqual(firstFile.source, { id: 'github_trending', name: 'GitHub Trending', type: 'github-trending' });
  assert.equal(firstFile.day, DAY);
  assert.equal(firstFile.fetch.status, 'ok');
  assert.equal(firstFile.items.length, 11);
  assert.equal(firstFile.items[0].id, 'github_trending__anthropics%2Fskills');
  assert.equal(firstFile.items[0].dayKey, DAY);
  assert.equal(firstFile.items[0].firstSeenAt, firstFile.items[0].lastSeenAt);

  const health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastError, '');
  assert.equal(health.lastSuccessAt, first.lastAttemptAt);
  assert.equal(health.lastOutcome, 'ok');
  assert.deepEqual(health.pendingAttempts, { day: DAY, count: 0 });
  assert.deepEqual(health.autoAttempts, { day: DAY, count: 1 });
  assert.deepEqual(health.cursor, {});

  assert.deepEqual(requests, [{ url: '/trending?since=daily', userAgent: 'dsh-feed-ultra/0.0.0' }]);
  assert.equal(await readDayItems(l, '2026-09-01', 'github_trending'), null, 'expired day is pruned');

  const second = await runFetch({ root, adapter, source: descriptor, day: DAY, retentionDays: 30, trigger: 'auto', locale: 'zh', now: NOW });
  assert.equal(second.status, 'ok');
  assert.equal(second.count, 11);
  const secondFile = await readDayItems(l, DAY, 'github_trending');
  assert.ok(secondFile);
  assert.deepEqual(
    secondFile.items.map((item) => item.id),
    firstFile.items.map((item) => item.id),
  );
});

test('records failures without disturbing the last good snapshot', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  const requests: Array<{ url: string; userAgent: string }> = [];
  let response: Response = { status: 503, body: 'unavailable' };
  const baseUrl = await serve(t, () => response, requests);
  const adapter = createAdapter({ baseUrl });

  const httpFailure = await runFetch({ root, adapter, source: descriptor, day: DAY, retentionDays: 30, trigger: 'auto', locale: 'zh', now: NOW });
  assert.equal(httpFailure.status, 'error');
  assert.match(httpFailure.status === 'error' ? httpFailure.error : '', /503/);
  let health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.lastSuccessAt, '');
  assert.equal(health.lastOutcome, 'error');
  assert.deepEqual(health.pendingAttempts, { day: '', count: 0 });
  assert.match(health.lastError, /503/);
  assert.equal(await readDayItems(l, DAY, 'github_trending'), null);

  response = { status: 200, body: '<html><body>no rows</body></html>' };
  const driftFailure = await runFetch({ root, adapter, source: descriptor, day: DAY, retentionDays: 30, trigger: 'auto', locale: 'zh', now: NOW });
  assert.equal(driftFailure.status, 'error');
  const driftText = driftFailure.status === 'error' ? driftFailure.error : '';
  assert.match(driftText, /no trending rows/);
  const snapshot = driftText.match(/html snapshot: (\S+)/)?.[1];
  assert.ok(snapshot, 'drift keeps the unreadable page for selector repair');
  assert.match(await readFile(snapshot, 'utf8'), /no rows/);
  health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.equal(health.consecutiveFailures, 2);

  response = { status: 200, body: await readFile(FIXTURE, 'utf8') };
  const recovered = await runFetch({ root, adapter, source: descriptor, day: DAY, retentionDays: 30, trigger: 'auto', locale: 'zh', now: NOW });
  assert.equal(recovered.status, 'ok');
  health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastError, '');
  const items = await readDayItems(l, DAY, 'github_trending');
  assert.equal(items?.items.length, 11);
});

test('a pending outcome writes no snapshot and spends only the pending budget', async (t) => {
  const rootDir = await workspace(t);
  const l = layout(rootDir);
  const adapter = fixedAdapter(() => ({ status: 'pending' }));

  const auto = await runFetch({
    root: rootDir,
    adapter,
    source: descriptor,
    day: DAY,
    retentionDays: 30,
    trigger: 'auto',
    locale: 'zh',
    now: NOW,
  });
  assert.equal(auto.status, 'pending');
  assert.equal((await readDayItemsSafe(l, DAY, 'github_trending')).kind, 'missing');

  let health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.equal(health.lastOutcome, 'pending');
  assert.deepEqual(health.autoAttempts, { day: '', count: 0 });
  assert.deepEqual(health.pendingAttempts, { day: DAY, count: 1 });

  const manual = await runFetch({
    root: rootDir,
    adapter,
    source: descriptor,
    day: DAY,
    retentionDays: 30,
    trigger: 'manual',
    locale: 'zh',
    now: NOW,
  });
  assert.equal(manual.status, 'pending');
  health = await readHealth(l, 'github_trending');
  assert.ok(health);
  assert.deepEqual(health.pendingAttempts, { day: DAY, count: 1 });
});

test('a notPublished outcome writes an empty snapshot and no health', async (t) => {
  const rootDir = await workspace(t);
  const l = layout(rootDir);
  const adapter = fixedAdapter(() => ({ status: 'notPublished', meta: { briefDate: DAY } }));

  const result = await runFetch({
    root: rootDir,
    adapter,
    source: descriptor,
    day: DAY,
    retentionDays: 30,
    trigger: 'auto',
    locale: 'zh',
    now: NOW,
  });
  assert.equal(result.status, 'notPublished');

  const fact = await readDayItemsSafe(l, DAY, 'github_trending');
  assert.equal(fact.kind, 'ok');
  if (fact.kind !== 'ok') return;
  assert.deepEqual(fact.fact.items, []);
  assert.equal(fact.fact.meta?.notPublished, true);
  assert.equal(fact.fact.meta?.briefDate, DAY);
  assert.equal(await readHealth(l, 'github_trending'), null);
});

test('a historical fetch never writes source health', async (t) => {
  const rootDir = await workspace(t);
  const l = layout(rootDir);
  const adapter = fixedAdapter((now) => ({ status: 'ok', items: [oneItem(now)] }));

  await runFetch({
    root: rootDir,
    adapter,
    source: descriptor,
    day: DAY,
    retentionDays: 30,
    trigger: 'auto',
    locale: 'zh',
    now: NOW,
  });
  const before = await readHealth(l, 'github_trending');
  assert.ok(before);
  assert.equal(before.consecutiveFailures, 0);
  assert.equal(before.lastSuccessAt, NOW.toISOString());

  const historical = await runFetch({
    root: rootDir,
    adapter,
    source: descriptor,
    day: YESTERDAY,
    retentionDays: 30,
    trigger: 'auto',
    locale: 'zh',
    now: NOW,
  });
  assert.equal(historical.status, 'ok');
  assert.equal((await readDayItemsSafe(l, YESTERDAY, 'github_trending')).kind, 'ok');
  assert.deepEqual(await readHealth(l, 'github_trending'), before);
});

test('adapter meta lands on disk with the snapshot', async (t) => {
  const rootDir = await workspace(t);
  const l = layout(rootDir);
  const adapter = fixedAdapter((now) => ({
    status: 'ok',
    items: [oneItem(now)],
    meta: { detailStatus: 'degraded', episodeTitle: 'EP233' },
  }));

  await runFetch({
    root: rootDir,
    adapter,
    source: descriptor,
    day: DAY,
    retentionDays: 30,
    trigger: 'auto',
    locale: 'zh',
    now: NOW,
  });

  const fact = await readDayItems(l, DAY, 'github_trending');
  assert.ok(fact);
  assert.equal(fact.meta?.detailStatus, 'degraded');
  assert.equal(fact.meta?.episodeTitle, 'EP233');
});
