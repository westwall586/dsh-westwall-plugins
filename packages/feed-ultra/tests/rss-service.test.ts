import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import type { RssLibrary } from '../src/contract/rss-library.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, HealthRecord, ItemRecord } from '../src/contract/types.ts';
import type { FetchRequest } from '../src/engine/fetch.ts';
import { createFeedUltraService } from '../src/service/index.ts';
import type { FeedUltraConfig } from '../src/settings.ts';
import { SOURCES } from '../src/sources/registry.ts';
import type { FetchSummary } from '../src/engine/fetch.ts';
import { writeJsonAtomic } from '../src/store/atomic.ts';
import { readHealth, writeDayItems, writeHealth } from '../src/store/day.ts';
import { dayKeyOf, layout, rssLibraryFile, shiftDay } from '../src/store/paths.ts';
import { FeedUltraError } from '../src/service/errors.ts';

const DAY = '2026-11-12';
const AT = `${DAY}T09:00:00.000Z`;

interface Harness {
  root: string;
  clock: { now: Date };
  config: FeedUltraConfig;
  service: ReturnType<typeof createFeedUltraService>;
  requests: FetchRequest[];
}

async function harness(
  t: TestContext,
  runFetch?: (request: FetchRequest) => Promise<FetchSummary>,
): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-rss-service-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clock = { now: new Date(2026, 10, 12, 9, 0, 0) };
  const requests: FetchRequest[] = [];
  let channelSequence = 0;
  const config: FeedUltraConfig = {
    workspacePath: '',
    retentionDays: 30,
    sources: {},
    model: null,
    autoFetch: true,
  };
  const service = createFeedUltraService({
    config: () => config,
    sources: SOURCES,
    now: () => new Date(clock.now),
    newChannelId: () => `ch${String(++channelSequence).padStart(8, '0')}`,
    runFetch: async (request) => {
      requests.push(request);
      if (runFetch !== undefined) return runFetch(request);
      return {
        status: 'ok',
        sourceId: request.source.id,
        day: request.day,
        count: 0,
        added: 0,
        lastAttemptAt: AT,
        lastSuccessAt: AT,
      };
    },
  });
  const bound = await service.bindWorkspace(root);
  config.workspacePath = bound.workspace.path;
  return { root: bound.workspace.path, clock, config, service, requests };
}

function libraryOf(channels: RssLibrary['channels'], feeds: RssLibrary['feeds']): RssLibrary {
  return { version: 1, updatedAt: AT, channels, feeds };
}

function feed(url: string, channel: string, name = ''): RssLibrary['feeds'][number] {
  return { url, name, note: '', channel, addedAt: AT };
}

function item(key: string, feedUrl: string): ItemRecord {
  return {
    id: composeItemId('rss', key),
    naturalKey: key,
    title: key,
    description: '',
    url: `https://example.com/${key}`,
    publishedAt: `${DAY}T08:00:00.000Z`,
    dayKey: DAY,
    firstSeenAt: AT,
    lastSeenAt: AT,
    extra: { feedUrl, feedTitle: feedUrl },
  };
}

function factOf(items: ItemRecord[], feeds: Record<string, unknown>[], day = DAY): FactFile {
  return {
    version: CONTRACT_VERSION,
    source: { id: 'rss', name: 'RSS', type: 'rss' },
    day,
    fetch: { lastAttemptAt: AT, lastSuccessAt: AT, status: 'ok', error: '' },
    meta: { newItems: items.length, scanned: items.length, origin: AT, feeds },
    items,
  };
}

function okFeed(url: string, accepted = 1): Record<string, unknown> {
  return {
    url,
    title: 'Feed',
    titleSource: 'document',
    status: 'ok',
    httpStatus: 200,
    notModified: false,
    items: accepted,
    accepted,
    dropped: { noLink: 0, noKey: 0, dupKey: 0, overLimit: 0, firstPull: 0 },
  };
}

function health(error = ''): HealthRecord {
  return {
    version: CONTRACT_VERSION,
    lastAttemptAt: AT,
    lastSuccessAt: error === '' ? AT : '',
    consecutiveFailures: error === '' ? 0 : 1,
    lastError: error,
    cursor: {},
    autoAttempts: { day: DAY, count: 0 },
    lastOutcome: error === '' ? 'ok' : 'error',
    pendingAttempts: { day: '', count: 0 },
  };
}

async function seedLibrary(root: string, library: RssLibrary): Promise<void> {
  await writeJsonAtomic(rssLibraryFile(layout(root)), library);
}

test('an unbound workspace returns an empty library and refuses a write', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-rss-unbound-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config: FeedUltraConfig = { workspacePath: '', retentionDays: 30, sources: {}, model: null, autoFetch: true };
  const service = createFeedUltraService({
    config: () => config,
    sources: SOURCES,
    now: () => new Date(2026, 10, 12, 9, 0, 0),
    runFetch: async () => {
      throw new Error('unused');
    },
  });

  const view = await service.rssLibrary();
  assert.equal(view.unbound, true);
  assert.deepEqual(view.counts, { feeds: 0, channels: 0, inbox: 0 });

  await assert.rejects(
    service.rssLibraryMutate([{ op: 'addChannel', name: 'One' }]),
    (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-workspace',
  );
});

test('mutations write the library and an illegal batch writes nothing', async (t) => {
  const h = await harness(t);

  const view = await h.service.rssLibraryMutate([
    { op: 'addChannel', name: '基础设施' },
    { op: 'addFeed', url: 'https://example.com/rss/', channel: 'ch00000001' },
  ]);
  assert.equal(view.channels.length, 1);
  assert.equal(view.feeds.length, 1);
  assert.equal(view.counts.inbox, 0);
  assert.ok(view.updatedAt);

  const before = await readFile(rssLibraryFile(layout(h.root)), 'utf8');
  await assert.rejects(
    h.service.rssLibraryMutate([
      { op: 'addChannel', name: 'OK' },
      { op: 'renameChannel', id: 'ch99999999', name: 'Broken' },
    ]),
    (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-input',
  );
  assert.equal(await readFile(rssLibraryFile(layout(h.root)), 'utf8'), before);
});

test('importOpml returns the added and skipped counts', async (t) => {
  const h = await harness(t);
  await h.service.rssLibraryMutate([
    { op: 'addFeed', url: 'https://existing.example/rss' },
  ]);

  const view = await h.service.rssLibraryMutate([{
    op: 'importOpml',
    text: `<opml version="2.0"><body>
      <outline text="Existing" xmlUrl="https://existing.example/rss"/>
      <outline text="New" xmlUrl="https://new.example/feed"/>
    </body></opml>`,
  }]);

  assert.deepEqual(view.lastImport, { added: 1, skipped: 1 });
  assert.equal(view.feeds.length, 2);
  assert.equal(view.counts.inbox, 2);
});

test('sources reports one channel view per channel with feeds', async (t) => {
  const h = await harness(t);
  await seedLibrary(h.root, libraryOf(
    [{ id: 'ch00000001', name: '基础设施' }, { id: 'ch00000002', name: '空渠道' }],
    [feed('https://a.example/rss', 'ch00000001')],
  ));
  await writeDayItems(layout(h.root), factOf([item('a1', 'https://a.example/rss')], [okFeed('https://a.example/rss')]));
  await writeHealth(layout(h.root), 'rss', health());

  const view = await h.service.sources();
  assert.equal(view.rssChannels.length, 1);
  const channel = view.rssChannels[0];
  assert.equal(channel?.name, '基础设施');
  assert.equal(channel?.feedCount, 1);
  assert.equal(channel?.todayCount, 1);
  assert.equal(channel?.unread, 1);
  assert.equal(channel?.status, 'ok');
});

test('a channel whose only feed failed reads error with its reason', async (t) => {
  const h = await harness(t);
  await seedLibrary(h.root, libraryOf(
    [{ id: 'ch00000001', name: '基础设施' }],
    [feed('https://a.example/rss', 'ch00000001')],
  ));
  await writeDayItems(layout(h.root), factOf([], [{
    ...okFeed('https://a.example/rss', 0),
    status: 'error',
    httpStatus: 500,
    error: 'timeout',
  }]));
  await writeHealth(layout(h.root), 'rss', health());

  const view = await h.service.sources();
  assert.equal(view.rssChannels[0]?.status, 'error');
  assert.equal(view.rssChannels[0]?.error, 'timeout');
});

test('day projects one section per channel and hides the inbox', async (t) => {
  const h = await harness(t);
  await seedLibrary(h.root, libraryOf(
    [{ id: 'ch00000001', name: '基础设施' }, { id: 'ch00000002', name: '空渠道' }],
    [
      feed('https://a.example/rss', 'ch00000001'),
      feed('https://inbox.example/rss', ''),
    ],
  ));
  await writeDayItems(layout(h.root), factOf(
    [item('a1', 'https://a.example/rss'), item('inbox1', 'https://inbox.example/rss')],
    [okFeed('https://a.example/rss'), okFeed('https://inbox.example/rss')],
  ));

  const day = await h.service.day(DAY);
  const rss = day.sections.filter((section) => section.source.id === 'rss');
  assert.equal(rss.length, 1);
  assert.equal(rss[0]?.channelId, 'ch00000001');
  assert.equal(rss[0]?.source.name, '基础设施');
  assert.deepEqual(rss[0]?.items.map((entry) => entry.naturalKey), ['a1']);
  assert.equal(day.total, 1);
});

test('fetch passes ordered feeds and the accumulate exclusion set', async (t) => {
  const h = await harness(t);
  await seedLibrary(h.root, libraryOf(
    [{ id: 'ch00000001', name: 'One' }, { id: 'ch00000002', name: 'Two' }],
    [
      feed('https://a.example/rss', 'ch00000001'),
      feed('https://b.example/rss', 'ch00000001'),
      feed('https://c.example/rss', 'ch00000002'),
    ],
  ));
  await writeDayItems(
    layout(h.root),
    factOf([item('old', 'https://a.example/rss')], [okFeed('https://a.example/rss')], shiftDay(DAY, -1)),
  );

  await h.service.fetch('rss');

  const request = h.requests.at(-1);
  assert.deepEqual(request?.feeds?.map((entry) => entry.url), [
    'https://a.example/rss',
    'https://b.example/rss',
    'https://c.example/rss',
  ]);
  assert.ok(request?.excludeKeys?.has('old'));
});

test('a successful fetch fills an empty feed name from the document title', async (t) => {
  const h = await harness(t, async (request) => {
    await writeDayItems(layout(request.root), factOf([], [{
      ...okFeed('https://a.example/rss', 0),
      title: 'A Document Title',
      titleSource: 'document',
    }], request.day));
    return {
      status: 'ok',
      sourceId: 'rss',
      day: request.day,
      count: 0,
      added: 0,
      lastAttemptAt: AT,
      lastSuccessAt: AT,
    };
  });
  await seedLibrary(h.root, libraryOf(
    [{ id: 'ch00000001', name: 'One' }],
    [
      feed('https://a.example/rss', 'ch00000001'),
      feed('https://b.example/rss', 'ch00000001', 'My Name'),
    ],
  ));

  await h.service.fetch('rss');

  const library = JSON.parse(await readFile(rssLibraryFile(layout(h.root)), 'utf8')) as RssLibrary;
  assert.equal(library.feeds.find((entry) => entry.url === 'https://a.example/rss')?.name, 'A Document Title');
  assert.equal(library.feeds.find((entry) => entry.url === 'https://b.example/rss')?.name, 'My Name');
});

test('calendar stops counting a feed that moved back to the inbox', async (t) => {
  const h = await harness(t);
  await seedLibrary(h.root, libraryOf(
    [{ id: 'ch00000001', name: 'One' }],
    [feed('https://a.example/rss', 'ch00000001'), feed('https://inbox.example/rss', '')],
  ));
  await writeDayItems(layout(h.root), factOf(
    [item('a1', 'https://a.example/rss'), item('inbox1', 'https://inbox.example/rss')],
    [okFeed('https://a.example/rss'), okFeed('https://inbox.example/rss')],
  ));

  const calendar = await h.service.calendar(DAY, DAY);
  assert.equal(calendar.days[0]?.total, 1);
});


test('moving a feed to the inbox clears its fetch cursor and keeps its history', async (t) => {
  const h = await harness(t);
  const added = await h.service.rssLibraryMutate([
    { op: 'addChannel', name: 'Active' },
    { op: 'addFeed', url: 'https://example.com/feed' },
  ]);
  const channel = added.channels.find(entry => entry.name === 'Active');
  assert.ok(channel);
  await h.service.rssLibraryMutate([{ op: 'moveFeed', url: 'https://example.com/feed', channel: channel.id }]);

  const l = layout(h.root);
  await writeHealth(l, 'rss', {
    ...health(),
    cursor: {
      feeds: {
        'https://example.com/feed': { etag: '"v1"', watermark: { id: 'g1', at: AT } },
        'https://other.example/feed': { etag: '"v2"' },
      },
    },
  });

  const view = await h.service.rssLibraryMutate([{ op: 'moveFeed', url: 'https://example.com/feed', channel: '' }]);
  assert.equal(view.feeds.find(feed => feed.url === 'https://example.com/feed')?.channel, '');
  const next = await readHealth(l, 'rss');
  assert.deepEqual(next?.cursor.feeds, {
    'https://other.example/feed': { etag: '"v2"' },
  });
});

test('deleting a channel clears the cursors of the feeds it returns to the inbox', async (t) => {
  const h = await harness(t);
  const added = await h.service.rssLibraryMutate([
    { op: 'addChannel', name: 'Active' },
    { op: 'addFeed', url: 'https://example.com/feed' },
  ]);
  const channel = added.channels.find(entry => entry.name === 'Active');
  assert.ok(channel);
  await h.service.rssLibraryMutate([{ op: 'moveFeed', url: 'https://example.com/feed', channel: channel.id }]);

  const l = layout(h.root);
  await writeHealth(l, 'rss', {
    ...health(),
    cursor: { feeds: { 'https://example.com/feed': { etag: '"v1"', watermark: { id: 'g1', at: AT } } } },
  });

  await h.service.rssLibraryMutate([{ op: 'removeChannel', id: channel.id }]);
  const next = await readHealth(l, 'rss');
  assert.deepEqual(next?.cursor.feeds, {});
});
