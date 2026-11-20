import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, ItemRecord, RawItem, SourceCapabilities, SourceDescriptor } from '../src/contract/types.ts';
import { runFetch } from '../src/engine/fetch.ts';
import { FeedUltraError, type FeedUltraErrorCode } from '../src/service/errors.ts';
import { createFeedUltraService, type FeedUltraService } from '../src/service/index.ts';
import type { FeedUltraConfig } from '../src/settings.ts';
import type { SourceRuntime } from '../src/sources/registry.ts';
import type { DeleteBookmarkInput, DeleteBookmarkOutcome, FetchContext } from '../src/sources/types.ts';
import { readDayItems, writeDayItems } from '../src/store/day.ts';
import { layout, shiftDay } from '../src/store/paths.ts';

const TODAY = '2026-11-11';
const YESTERDAY = shiftDay(TODAY, -1);
const START = new Date(2026, 10, 11, 12, 0, 0);
const X: SourceDescriptor = { id: 'x_bookmarks', name: 'X Bookmarks', type: 'x-bookmarks' };
const X_CAPABILITIES: SourceCapabilities = {
  backfill: false,
  translation: false,
  actions: ['deleteBookmark'],
  manualBatch: true,
};

interface Harness {
  root: string;
  config: FeedUltraConfig;
  clock: { now: Date };
  service: FeedUltraService;
  fetchContexts: FetchContext[];
  logs: Array<{ message: string; level: string }>;
  deleteCalls: DeleteBookmarkInput[];
}

function raw(naturalKey: string): RawItem {
  return {
    naturalKey,
    title: `title ${naturalKey}`,
    description: `description ${naturalKey}`,
    url: `https://x.com/author/status/${naturalKey}`,
    publishedAt: '2026-11-10T07:07:00.000Z',
    extra: { handle: 'author' },
  };
}

function item(day: string, naturalKey: string, extra: Record<string, unknown> = {}): ItemRecord {
  const at = `${day}T08:00:00Z`;
  return {
    id: composeItemId(X.id, naturalKey),
    naturalKey,
    title: naturalKey,
    description: `description ${naturalKey}`,
    url: `https://x.com/author/status/${naturalKey}`,
    publishedAt: '2026-11-10T07:07:00.000Z',
    dayKey: day,
    firstSeenAt: at,
    lastSeenAt: at,
    extra,
  };
}

function fact(day: string, items: readonly ItemRecord[], meta?: Record<string, unknown>): FactFile {
  const at = `${day}T08:00:00Z`;
  return {
    version: CONTRACT_VERSION,
    source: X,
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    ...(meta === undefined ? {} : { meta }),
    items: [...items],
  };
}

function manualRuntime(id: string, options: { capabilities?: SourceCapabilities; delayMs?: number } = {}): SourceRuntime {
  return {
    descriptor: { id, name: id, type: 'x-bookmarks' },
    cadence: 'manual',
    capabilities: options.capabilities ?? X_CAPABILITIES,
    adapter: {
      type: 'x-bookmarks',
      label: id,
      writeMode: 'accumulate',
      async fetch(ctx) {
        if (options.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        return { status: 'ok', items: [raw('1001')] };
      },
    },
  };
}

async function setup(
  t: TestContext,
  options: {
    sources?: SourceRuntime[];
    config?: Partial<FeedUltraConfig>;
    deleteOutcome?: (input: DeleteBookmarkInput) => Promise<DeleteBookmarkOutcome>;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-x-service-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const clock = { now: new Date(START) };
  const config: FeedUltraConfig = {
    workspacePath: '',
    retentionDays: 30,
    sources: {
      x_bookmarks: {
        scheduleEnabled: true,
        scheduleAt: '08:00',
        translationEnabled: true,
        locale: 'zh',
        batchSize: 5,
        egoBrowserPath: '/opt/ego-browser',
      },
    },
    model: null,
    autoFetch: true,
    ...options.config,
  };

  const runtimeList = options.sources ?? [manualRuntime('x_bookmarks')];
  const sources: Record<string, SourceRuntime> = {};
  for (const runtime of runtimeList) sources[runtime.descriptor.id] = runtime;

  const fetchContexts: FetchContext[] = [];
  for (const runtime of runtimeList) {
    const original = runtime.adapter.fetch.bind(runtime.adapter);
    runtime.adapter.fetch = async (ctx) => {
      fetchContexts.push(ctx);
      return original(ctx);
    };
  }

  const logs: Array<{ message: string; level: string }> = [];
  const deleteCalls: DeleteBookmarkInput[] = [];
  const service = createFeedUltraService({
    config: () => ({ ...config }),
    sources,
    now: () => new Date(clock.now),
    runFetch,
    log: (message, level) => logs.push({ message, level }),
    deleteBookmark: async (input) => {
      deleteCalls.push(input);
      if (options.deleteOutcome !== undefined) return options.deleteOutcome(input);
      return { ok: true, alreadyDeleted: false };
    },
  });

  const result = await service.bindWorkspace(root);
  config.workspacePath = result.workspace.path;
  return { root, config: config as FeedUltraConfig, clock, service, fetchContexts, logs, deleteCalls };
}

async function rejectsCode(promise: Promise<unknown>, code: FeedUltraErrorCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof FeedUltraError && error.code === code);
}

test('fetch hands the window exclusion set, batch size, browser path and log to the adapter', async (t) => {
  const h = await setup(t);
  const l = layout(h.config.workspacePath);
  await writeDayItems(l, fact(YESTERDAY, [item(YESTERDAY, '1001'), item(YESTERDAY, '2002')]));

  const result = await h.service.fetch('x_bookmarks');
  assert.equal(result.status, 'ok');
  assert.equal(result.count, 1);
  assert.equal(result.added, 1);

  const ctx = h.fetchContexts[0];
  assert.ok(ctx);
  assert.deepEqual([...ctx.excludeKeys].sort(), ['1001', '2002']);
  assert.equal(ctx.batchSize, 5);
  assert.equal(ctx.browserPath, '/opt/ego-browser');
  assert.equal(typeof ctx.log, 'function');

  ctx.log?.('goto', { ms: 12, login: false });
  assert.ok(
    h.logs.some((entry) => entry.message === '[feedUltra:x_bookmarks] goto ms=12 login=false'),
    'adapter stage lines reach the host logger',
  );

  const view = await h.service.day(TODAY);
  const section = view.sections.find((entry) => entry.source.id === 'x_bookmarks');
  assert.ok(section);
  assert.equal(section.batchSize, 5);

  const sources = await h.service.sources();
  const health = sources.sources.find((entry) => entry.id === 'x_bookmarks');
  assert.ok(health);
  assert.equal(health.batchSize, 5);
  assert.equal(health.nextFetchAt, null, 'a manual channel never advertises a next fetch');
  assert.equal(health.schedule.enabled, false, 'the stored schedule default does not enable a manual channel');
});

test('manual snapshots with zero items are empty, daily ones stay notPublished', async (t) => {
  const h = await setup(t);
  const l = layout(h.config.workspacePath);
  await writeDayItems(l, fact(TODAY, []));
  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.status, 'empty');

  const daily = await setup(t, {
    sources: [
      {
        descriptor: { id: 'daily', name: 'Daily', type: 'daily' },
        cadence: 'daily',
        capabilities: { backfill: false, translation: false },
        adapter: {
          type: 'daily',
          label: 'Daily',
          writeMode: 'replace',
          async fetch() {
            return { status: 'ok', items: [] };
          },
        },
      },
    ],
  });
  const dailyLayout = layout(daily.config.workspacePath);
  await writeDayItems(dailyLayout, {
    ...fact(TODAY, []),
    source: { id: 'daily', name: 'Daily', type: 'daily' },
  });
  const dailyView = await daily.service.day(TODAY);
  assert.equal(dailyView.sections[0]?.status, 'notPublished');
});

test('deleteBookmark marks the card read and keeps file order', async (t) => {
  const h = await setup(t);
  const l = layout(h.config.workspacePath);
  const target = item(TODAY, '1001', { keep: 'yes' });
  await writeDayItems(l, fact(TODAY, [item(TODAY, '2002'), target]));
  await writeDayItems(l, fact(YESTERDAY, [target]));

  const before = await h.service.day(TODAY);

  const result = await h.service.act('deleteBookmark', [target.id]);
  assert.deepEqual(result, {
    action: 'deleteBookmark',
    results: [{ id: target.id, status: 'ok', deletedAt: START.toISOString() }],
  });

  assert.equal(h.deleteCalls.length, 1);
  assert.equal(h.deleteCalls[0]?.url, target.url);
  assert.equal(h.deleteCalls[0]?.browserPath, '/opt/ego-browser');

  for (const day of [TODAY, YESTERDAY]) {
    const stored = await readDayItems(l, day, X.id);
    assert.ok(stored);
    const found = stored.items.find((entry) => entry.id === target.id);
    assert.ok(found);
    assert.equal(found.extra.xDeletedAt, START.toISOString());
    assert.equal(found.extra.keep, 'yes', 'other extra fields survive');
  }

  const todayFact = await readDayItems(l, TODAY, X.id);
  assert.ok(todayFact);
  assert.deepEqual(
    todayFact.items.map((entry) => entry.naturalKey),
    ['2002', '1001'],
    'file order is preserved',
  );

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.items.find((entry) => entry.id === target.id)?.read, true);
  assert.equal(view.unread, before.unread - 1, 'the unread count drops by one');

  const historical = await h.service.day(YESTERDAY);
  assert.equal(
    historical.sections[0]?.items.find((entry) => entry.id === target.id)?.read,
    true,
    'one read stamp covers the whole retention window',
  );
});

test('an X delete that cannot write the local marker reports the dedicated error', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('root ignores directory permissions');
    return;
  }

  const h = await setup(t);
  const l = layout(h.config.workspacePath);
  const target = item(TODAY, '1001');
  await writeDayItems(l, fact(TODAY, [target]));

  const dayDir = path.dirname(path.join(l.items, TODAY, `${X.id}.json`));
  await chmod(dayDir, 0o500);
  let result;
  try {
    result = await h.service.act('deleteBookmark', [target.id]);
  } finally {
    await chmod(dayDir, 0o700);
  }
  assert.deepEqual(result, {
    action: 'deleteBookmark',
    results: [{ id: target.id, status: 'error', error: '已从 X 删除，本地标记失败' }],
  });

  const stored = await readDayItems(l, TODAY, X.id);
  assert.ok(stored);
  assert.equal(stored.items[0]?.extra.xDeletedAt, undefined);
});

test('an already-deleted bookmark is idempotent and still marks the local card', async (t) => {
  const h = await setup(t, { deleteOutcome: async () => ({ ok: true, alreadyDeleted: true }) });
  const l = layout(h.config.workspacePath);
  const target = item(TODAY, '1001');
  await writeDayItems(l, fact(TODAY, [target]));

  const first = await h.service.act('deleteBookmark', [target.id]);
  assert.equal(first.results[0]?.status, 'ok');
  const second = await h.service.act('deleteBookmark', [target.id]);
  assert.equal(second.results[0]?.status, 'ok');

  const stored = await readDayItems(l, TODAY, X.id);
  assert.ok(stored);
  assert.equal(stored.items[0]?.extra.xDeletedAt, START.toISOString());
});

test('a failed remote delete leaves the local facts untouched', async (t) => {
  const h = await setup(t, {
    deleteOutcome: async () => ({ ok: false, alreadyDeleted: false, error: 'drift', kind: 'drift', evidencePath: '/tmp/e.html' }),
  });
  const l = layout(h.config.workspacePath);
  const target = item(TODAY, '1001');
  await writeDayItems(l, fact(TODAY, [target]));

  const result = await h.service.act('deleteBookmark', [target.id]);
  assert.deepEqual(result, {
    action: 'deleteBookmark',
    results: [{ id: target.id, status: 'error', error: 'drift' }],
  });

  const stored = await readDayItems(l, TODAY, X.id);
  assert.ok(stored);
  assert.equal(stored.items[0]?.extra.xDeletedAt, undefined);
  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.items.find((entry) => entry.id === target.id)?.read, false, 'the card stays unread');
  assert.ok(h.logs.some((entry) => entry.message.includes('evidencePath=/tmp/e.html')));
});

test('deleteBookmark uses the tweet url fallback when the local item is gone', async (t) => {
  const h = await setup(t);
  const result = await h.service.act('deleteBookmark', [composeItemId(X.id, '9999')]);

  assert.equal(result.results[0]?.status, 'ok');
  assert.equal(h.deleteCalls[0]?.url, 'https://x.com/i/status/9999');
});

test('deleteBookmark validation rejects malformed ids, mixed sources and missing capability', async (t) => {
  const other = manualRuntime('other_manual', { capabilities: { backfill: false, translation: false } });
  const h = await setup(t, { sources: [manualRuntime('x_bookmarks'), other] });

  await rejectsCode(h.service.act('deleteBookmark', []), 'invalid-request');
  await rejectsCode(h.service.act('deleteBookmark', ['not-an-item-id']), 'invalid-request');
  await rejectsCode(
    h.service.act('deleteBookmark', [composeItemId(X.id, '1'), composeItemId('other_manual', '2')]),
    'invalid-request',
  );
  await rejectsCode(h.service.act('deleteBookmark', [composeItemId('other_manual', '2')]), 'unsupported-action');
  await rejectsCode(h.service.act('archive', []), 'unsupported-action');
  await rejectsCode(h.service.act('deleteBookmark', [composeItemId('ghost', '1')]), 'unknown-source');
});

test('fetch and delete of one source run one at a time', async (t) => {
  const runtime = manualRuntime('x_bookmarks', { delayMs: 30 });
  let active = 0;
  let peak = 0;
  const h = await setup(t, {
    sources: [runtime],
    deleteOutcome: async () => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { ok: true, alreadyDeleted: false };
      } finally {
        active -= 1;
      }
    },
  });
  const l = layout(h.config.workspacePath);
  const target = item(TODAY, '1001');
  await writeDayItems(l, fact(TODAY, [target]));

  const originalFetch = runtime.adapter.fetch.bind(runtime.adapter);
  runtime.adapter.fetch = async (ctx) => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      return await originalFetch(ctx);
    } finally {
      active -= 1;
    }
  };

  const results = await Promise.all([
    h.service.fetch('x_bookmarks'),
    h.service.act('deleteBookmark', [target.id]),
  ]);
  assert.equal(results[0]?.status, 'ok');
  assert.equal(results[1]?.results[0]?.status, 'ok');
  assert.equal(peak, 1, 'fetch and delete share one per-source queue');
});

test('a corrupt day file is skipped by the window helpers instead of aborting delete', async (t) => {
  const h = await setup(t);
  const l = layout(h.config.workspacePath);
  const target = item(TODAY, '1001');
  await writeDayItems(l, fact(TODAY, [target]));
  await mkdir(path.join(l.items, YESTERDAY), { recursive: true });
  await writeFile(path.join(l.items, YESTERDAY, `${X.id}.json`), '{ not json', 'utf8');

  const result = await h.service.act('deleteBookmark', [target.id]);
  assert.equal(result.results[0]?.status, 'ok');
});
