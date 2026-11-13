import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import type { RawItem, SourceCapabilities } from '../src/contract/types.ts';
import { runFetch } from '../src/engine/fetch.ts';
import { FeedUltraError, type FeedUltraErrorCode } from '../src/service/errors.ts';
import { createFeedUltraService, type FeedUltraService } from '../src/service/index.ts';
import type { FeedUltraConfig } from '../src/settings.ts';
import type { SourceRuntime } from '../src/sources/registry.ts';
import { itemFile, layout, shiftDay, stateFile } from '../src/store/paths.ts';
import { readDayItemsSafe, readHealthSafe } from '../src/store/read.ts';
import type { LlmTranslateService } from '../src/translate/model.ts';

const TODAY = '2026-11-10';
const START = new Date(2026, 10, 10, 12, 0, 0);

interface Clock {
  now: Date;
}

interface Harness {
  root: string;
  canonical: string;
  config: FeedUltraConfig;
  clock: Clock;
  service: FeedUltraService;
}

function rawItems(naturalKeys: string[]): RawItem[] {
  return naturalKeys.map((naturalKey, index) => ({
    naturalKey,
    title: naturalKey,
    description: `${naturalKey} description`,
    url: `https://example.com/${naturalKey}`,
    publishedAt: '',
    extra: { rank: index + 1 },
  }));
}

const DEFAULT_CAPABILITIES: SourceCapabilities = { backfill: false, translation: true };

function runtime(
  id: string,
  items: () => RawItem[],
  capabilities: SourceCapabilities = DEFAULT_CAPABILITIES,
): SourceRuntime {
  return {
    descriptor: { id, name: id, type: id },
    cadence: 'daily',
    capabilities,
    adapter: {
      type: id,
      label: id,
      writeMode: 'replace',
      async fetch({ now }) {
        return { status: 'ok', items: items().map((item) => ({ ...item, publishedAt: now })) };
      },
    },
  };
}

async function setup(
  t: TestContext,
  options: { sources?: SourceRuntime[]; retentionDays?: number; llm?: LlmTranslateService } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-service-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const clock: Clock = { now: new Date(START) };
  const config: FeedUltraConfig = {
    workspacePath: '',
    retentionDays: options.retentionDays ?? 30,
    sources: {},
    model: null,
    autoFetch: true,
  };
  const sources: Record<string, SourceRuntime> = {};
  for (const source of options.sources ?? [runtime('test_source', () => rawItems(['alpha', 'beta']))]) {
    sources[source.descriptor.id] = source;
  }

  const service = createFeedUltraService({
    config: () => ({ ...config }),
    sources,
    now: () => new Date(clock.now),
    runFetch,
    llm: options.llm === undefined ? undefined : () => options.llm ?? null,
  });

  return { root, canonical: await realpath(root), config, clock, service };
}

async function bind(h: Harness): Promise<void> {
  const result = await h.service.bindWorkspace(h.root);
  h.config.workspacePath = result.workspace.path;
}

async function rejectsCode(promise: Promise<unknown>, code: FeedUltraErrorCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof FeedUltraError && error.code === code);
}

test('binding validates and initializes the workspace tree', async (t) => {
  const h = await setup(t);
  const result = await h.service.bindWorkspace(h.root);

  assert.equal(result.workspace.status, 'ok');
  assert.equal(result.workspace.path, h.canonical);
  assert.equal(result.created, true);
  for (const dir of ['data/items', 'data/state', 'data/cache', 'health']) {
    const info = await stat(path.join(h.canonical, '.dsh-feeds', dir));
    assert.ok(info.isDirectory(), `${dir} exists`);
  }
  assert.equal((await h.service.bindWorkspace(h.root)).created, false);
});

test('binding rejects missing, empty and non-directory paths', async (t) => {
  const h = await setup(t);
  await rejectsCode(h.service.bindWorkspace(path.join(h.root, 'missing')), 'invalid-workspace');
  await rejectsCode(h.service.bindWorkspace('   '), 'invalid-workspace');

  const file = path.join(h.root, 'plain-file.txt');
  await writeFile(file, 'not a directory', 'utf8');
  await rejectsCode(h.service.bindWorkspace(file), 'invalid-workspace');
});

test('status reports unbound, ok and invalid workspaces', async (t) => {
  const h = await setup(t);
  const unbound = await h.service.status();
  assert.equal(unbound.workspace.status, 'unbound');
  assert.equal(unbound.today, TODAY);
  assert.equal(unbound.retentionDays, 30);
  assert.equal(unbound.autoFetch, true);
  assert.equal(unbound.sourceCount, 1);

  await bind(h);
  assert.equal((await h.service.status()).workspace.status, 'ok');

  h.config.workspacePath = path.join(h.root, 'gone');
  assert.equal((await h.service.status()).workspace.status, 'invalid');
});

test('day is empty before the first fetch and complete after it', async (t) => {
  const h = await setup(t);
  await bind(h);

  const before = await h.service.day(TODAY);
  assert.equal(before.workspace.status, 'ok');
  assert.equal(before.sections.length, 1);
  assert.equal(before.sections[0]?.status, 'missing');
  assert.deepEqual(before.sections[0]?.items, []);
  assert.equal(before.total, 0);

  const fetched = await h.service.fetch('test_source');
  assert.deepEqual(fetched, {
    sourceId: 'test_source',
    day: TODAY,
    status: 'ok',
    count: 2,
    added: 2,
    translated: 0,
    translationError: '',
  });

  const after = await h.service.day(TODAY);
  assert.equal(after.sections[0]?.status, 'ok');
  assert.equal(after.sections[0]?.count, 2);
  assert.deepEqual(
    after.sections[0]?.items.map((item) => item.title),
    ['alpha', 'beta'],
  );
  assert.equal(after.total, 2);
  assert.equal(after.read, 0);
  assert.equal(after.unread, 2);
});

test('fetch writes the day facts and source health', async (t) => {
  const h = await setup(t);
  await bind(h);
  await h.service.fetch('test_source');

  const l = layout(h.canonical);
  const fact = await readDayItemsSafe(l, TODAY, 'test_source');
  assert.equal(fact.kind, 'ok');
  if (fact.kind !== 'ok') return;

  assert.equal(fact.fact.items.length, 2);
  assert.equal(fact.fact.items[0]?.id, composeItemId('test_source', 'alpha'));

  const health = await readHealthSafe(l, 'test_source');
  assert.ok(health);
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastSuccessAt, fact.fact.fetch.lastSuccessAt);
});

test('refetching replaces the snapshot and keeps firstSeenAt', async (t) => {
  let keys = ['alpha', 'beta'];
  const h = await setup(t, { sources: [runtime('test_source', () => rawItems(keys))] });
  await bind(h);

  await h.service.fetch('test_source');
  const first = await h.service.day(TODAY);
  const firstSeen = new Map(
    (first.sections[0]?.items ?? []).map((item) => [item.naturalKey, item.firstSeenAt] as const),
  );
  assert.equal(first.total, 2);

  await h.service.fetch('test_source');
  const twice = await h.service.day(TODAY);
  assert.equal(twice.total, 2, 'replacement must not double the snapshot');
  for (const item of twice.sections[0]?.items ?? []) {
    assert.equal(item.firstSeenAt, firstSeen.get(item.naturalKey));
  }

  keys = ['beta'];
  await h.service.fetch('test_source');
  const replaced = await h.service.day(TODAY);
  assert.deepEqual(
    replaced.sections[0]?.items.map((item) => item.naturalKey),
    ['beta'],
  );
});

test('act read flips state and reduces unread', async (t) => {
  const h = await setup(t);
  await bind(h);
  await h.service.fetch('test_source');

  const before = await h.service.day(TODAY);
  const target = before.sections[0]?.items[0];
  assert.ok(target);

  const result = await h.service.act('read', [target.id]);
  assert.deepEqual(result, { action: 'read', results: [{ id: target.id, status: 'ok' }] });

  const after = await h.service.day(TODAY);
  assert.equal(after.read, 1);
  assert.equal(after.unread, 1);
  assert.equal(after.sections[0]?.items[0]?.read, true);
  assert.ok((after.sections[0]?.items[0]?.readAt ?? '').length > 0);

  const readAt = after.sections[0]?.items[0]?.readAt;
  h.clock.now = new Date(START.getTime() + 60 * 60_000);
  await h.service.act('read', [target.id]);
  assert.equal((await h.service.day(TODAY)).sections[0]?.items[0]?.readAt, readAt, 'the earliest read wins');
});

test('batch act marks every requested item once', async (t) => {
  const h = await setup(t);
  await bind(h);
  await h.service.fetch('test_source');

  const before = await h.service.day(TODAY);
  const ids = (before.sections[0]?.items ?? []).map((item) => item.id);
  const result = await h.service.act('read', [ids[0] as string, ids[1] as string, ids[0] as string]);

  assert.equal(result.results.length, 2, 'duplicate ids collapse');
  const after = await h.service.day(TODAY);
  assert.equal(after.read, 2);
  assert.equal(after.unread, 0);
});

test('calendar reports present, read and missing days', async (t) => {
  const h = await setup(t);
  await bind(h);
  await h.service.fetch('test_source');

  const present = await h.service.calendar(TODAY, TODAY);
  assert.deepEqual(present.days, [{ day: TODAY, state: 'present', total: 2, unread: 2 }]);

  const before = await h.service.day(TODAY);
  await h.service.act('read', (before.sections[0]?.items ?? []).map((item) => item.id));
  const read = await h.service.calendar(TODAY, TODAY);
  assert.deepEqual(read.days, [{ day: TODAY, state: 'read', total: 2, unread: 0 }]);

  const yesterday = shiftDay(TODAY, -1);
  const range = await h.service.calendar(yesterday, TODAY);
  assert.deepEqual(
    range.days.map((day) => [day.day, day.state]),
    [
      [yesterday, 'missing'],
      [TODAY, 'read'],
    ],
  );
});

test('calendar accepts a 92-day span and rejects longer or reversed ranges', async (t) => {
  const h = await setup(t);
  await bind(h);
  const from = shiftDay(TODAY, -91);
  assert.equal((await h.service.calendar(from, TODAY)).days.length, 92);

  await rejectsCode(h.service.calendar(shiftDay(TODAY, -92), TODAY), 'invalid-range');
  await rejectsCode(h.service.calendar(TODAY, shiftDay(TODAY, -1)), 'invalid-range');
  await rejectsCode(h.service.calendar('not-a-day', TODAY), 'invalid-date');
});

test('a corrupt fact only degrades its own section', async (t) => {
  const h = await setup(t, {
    sources: [runtime('source_a', () => rawItems(['alpha'])), runtime('source_b', () => rawItems(['beta', 'gamma']))],
  });
  await bind(h);
  await h.service.fetch('source_a');
  await h.service.fetch('source_b');

  await writeFile(itemFile(layout(h.canonical), TODAY, 'source_a'), '{ not json', 'utf8');

  const view = await h.service.day(TODAY);
  assert.equal(view.sections.length, 2);
  assert.equal(view.sections[0]?.status, 'corrupt');
  assert.deepEqual(view.sections[0]?.items, []);
  assert.equal(view.sections[1]?.status, 'ok');
  assert.equal(view.sections[1]?.count, 2);
  assert.equal(view.total, 2);
});

test('a corrupt state file does not poison reads or writes', async (t) => {
  const h = await setup(t);
  await bind(h);
  await h.service.fetch('test_source');
  await writeFile(stateFile(layout(h.canonical), TODAY), '{ not json', 'utf8');

  const view = await h.service.day(TODAY);
  assert.equal(view.unread, 2);

  const target = view.sections[0]?.items[0];
  assert.ok(target);
  const result = await h.service.act('read', [target.id]);
  assert.equal(result.results[0]?.status, 'ok');

  const after = await h.service.day(TODAY);
  assert.equal(after.unread, 1);
  assert.equal(after.sections[0]?.items[0]?.read, true);
});

test('a failed refetch reports an error but keeps the last snapshot', async (t) => {
  let fail = false;
  const h = await setup(t, {
    sources: [
      runtime('test_source', () => {
        if (fail) throw new Error('network down');
        return rawItems(['alpha', 'beta']);
      }),
    ],
  });
  await bind(h);
  await h.service.fetch('test_source');

  fail = true;
  const result = await h.service.fetch('test_source');
  assert.equal(result.status, 'error');
  assert.match(result.status === 'error' ? (result.error ?? '') : '', /network down/);

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.status, 'error');
  assert.equal(view.total, 2, 'the snapshot survives a failed refetch');
});

test('a corrupt previous day file does not abort a refetch', async (t) => {
  const h = await setup(t);
  await bind(h);
  await h.service.fetch('test_source');
  await writeFile(itemFile(layout(h.canonical), TODAY, 'test_source'), '{ not json', 'utf8');

  const result = await h.service.fetch('test_source');
  assert.equal(result.status, 'ok');

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.status, 'ok');
  assert.equal(view.total, 2);
});

test('concurrent fetches of one source run one at a time', async (t) => {
  let active = 0;
  let peak = 0;
  const h = await setup(t, {
    sources: [
      {
        descriptor: { id: 'slow_source', name: 'Slow', type: 'slow' },
        cadence: 'daily',
        capabilities: DEFAULT_CAPABILITIES,
        adapter: {
          type: 'slow',
          label: 'Slow',
          writeMode: 'replace',
          async fetch({ now }) {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            active -= 1;
            return { status: 'ok', items: rawItems(['alpha']).map((item) => ({ ...item, publishedAt: now })) };
          },
        },
      },
    ],
  });
  await bind(h);

  const results = await Promise.all([
    h.service.fetch('slow_source'),
    h.service.fetch('slow_source'),
    h.service.fetch('slow_source'),
  ]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['ok', 'ok', 'ok'],
  );
  assert.equal(peak, 1, 'the same source never fetches concurrently');
});

test('sources reports idle health before any fetch and today counts after one', async (t) => {
  const h = await setup(t);
  const unbound = await h.service.sources();
  assert.equal(unbound.workspace.status, 'unbound');
  assert.equal(unbound.sources[0]?.status, 'idle');
  assert.equal(unbound.sources[0]?.todayCount, 0);

  await bind(h);
  assert.equal((await h.service.sources()).sources[0]?.status, 'idle');

  await h.service.fetch('test_source');
  const after = await h.service.sources();
  assert.equal(after.sources[0]?.status, 'ok');
  assert.equal(after.sources[0]?.todayCount, 2);
  assert.equal(after.sources[0]?.unread, 2);
});

test('unbound writes are rejected', async (t) => {
  const h = await setup(t);
  await rejectsCode(h.service.fetch('test_source'), 'unbound');
  await rejectsCode(h.service.act('read', ['test_source__alpha']), 'unbound');
});

test('unknown sources, malformed ids and unsupported actions are rejected', async (t) => {
  const h = await setup(t);
  await bind(h);

  await rejectsCode(h.service.fetch('nope'), 'unknown-source');
  await rejectsCode(h.service.act('read', ['nope__alpha']), 'unknown-source');
  await rejectsCode(h.service.act('read', ['not-an-item-id']), 'invalid-request');
  await rejectsCode(h.service.act('read', []), 'invalid-request');
  await rejectsCode(h.service.act('archive', ['test_source__alpha']), 'unsupported-action');
});

test('day rejects malformed and future dates', async (t) => {
  const h = await setup(t);
  await bind(h);
  await rejectsCode(h.service.day('2026-13-01'), 'invalid-date');
  await rejectsCode(h.service.day(shiftDay(TODAY, 1)), 'future-date');
});

test('fetch prunes days outside the live retention window', async (t) => {
  const h = await setup(t);
  await bind(h);

  const oldDay = '2026-11-08';
  h.clock.now = new Date(2026, 10, 8, 12, 0, 0);
  await h.service.fetch('test_source');
  const l = layout(h.canonical);
  assert.equal((await readDayItemsSafe(l, oldDay, 'test_source')).kind, 'ok');

  h.config.retentionDays = 1;
  h.clock.now = new Date(START);
  await h.service.fetch('test_source');
  assert.equal((await readDayItemsSafe(l, oldDay, 'test_source')).kind, 'missing');
  assert.equal((await readDayItemsSafe(l, TODAY, 'test_source')).kind, 'ok');
});

test('backfilling a past day writes data and leaves today health unchanged', async (t) => {
  const h = await setup(t, {
    sources: [runtime('backfill_source', () => rawItems(['alpha', 'beta']), { backfill: true, translation: true })],
  });
  await bind(h);
  await h.service.fetch('backfill_source');

  const l = layout(h.canonical);
  const before = await readHealthSafe(l, 'backfill_source');
  assert.ok(before);

  const past = shiftDay(TODAY, -3);
  const result = await h.service.fetch('backfill_source', 'manual', past);
  assert.deepEqual(result, {
    sourceId: 'backfill_source',
    day: past,
    status: 'ok',
    count: 2,
    added: 2,
    translated: 0,
    translationError: '',
  });

  const fact = await readDayItemsSafe(l, past, 'backfill_source');
  assert.equal(fact.kind, 'ok');
  if (fact.kind === 'ok') assert.equal(fact.fact.items.length, 2);

  assert.deepEqual(await readHealthSafe(l, 'backfill_source'), before);

  const calendar = await h.service.calendar(past, TODAY);
  assert.deepEqual(
    calendar.days.map((day) => [day.day, day.state]),
    [
      [past, 'present'],
      [shiftDay(past, 1), 'missing'],
      [shiftDay(past, 2), 'missing'],
      [TODAY, 'present'],
    ],
  );
});

test('a future backfill day is rejected', async (t) => {
  const h = await setup(t, {
    sources: [runtime('backfill_source', () => rawItems(['alpha']), { backfill: true, translation: true })],
  });
  await bind(h);

  await rejectsCode(h.service.fetch('backfill_source', 'manual', shiftDay(TODAY, 1)), 'invalid-date');
});

test('a backfill day outside the retention window is rejected with its window', async (t) => {
  const h = await setup(t, {
    retentionDays: 3,
    sources: [runtime('backfill_source', () => rawItems(['alpha']), { backfill: true, translation: true })],
  });
  await bind(h);

  await assert.rejects(
    h.service.fetch('backfill_source', 'manual', shiftDay(TODAY, -3)),
    (error: unknown) =>
      error instanceof FeedUltraError && error.code === 'invalid-date' && /retention/.test(error.message),
  );
});

test('a source without the backfill capability rejects a historical fetch', async (t) => {
  const h = await setup(t);
  await bind(h);

  await rejectsCode(h.service.fetch('test_source', 'manual', shiftDay(TODAY, -1)), 'unsupported-action');
});

test('translate rejects a channel that does not declare translation', async (t) => {
  const h = await setup(t, {
    sources: [runtime('no_translate', () => rawItems(['alpha']), { backfill: true, translation: false })],
  });
  await bind(h);

  await rejectsCode(h.service.translate('no_translate', TODAY), 'unsupported-action');
});

test('a historical fetch never auto-translates', async (t) => {
  const calls: string[] = [];
  const llm: LlmTranslateService = {
    async *stream() {
      calls.push('call');
      throw new Error('a historical fetch must not translate');
    },
  };
  const h = await setup(t, {
    sources: [runtime('backfill_source', () => rawItems(['alpha']), { backfill: true, translation: true })],
    llm,
  });
  await bind(h);

  const past = shiftDay(TODAY, -1);
  const result = await h.service.fetch('backfill_source', 'manual', past);
  assert.equal(result.status, 'ok');
  assert.equal(result.translationError, '');
  assert.equal(calls.length, 0);
});
