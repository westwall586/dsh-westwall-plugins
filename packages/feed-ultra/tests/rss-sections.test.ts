import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import type { RssLibrary } from '../src/contract/rss-library.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, HealthRecord, ItemRecord, SourceCapabilities } from '../src/contract/types.ts';
import { sectionState, type ProjectedSource } from '../src/service/project.ts';
import { sliceRssChannels, type RssChannelSlice } from '../src/service/rss-sections.ts';
import type { DayFactResult } from '../src/store/read.ts';

const DAY = '2026-11-12';
const AT = `${DAY}T09:00:00.000Z`;

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
    extra: { feedUrl },
  };
}

function factOf(items: ItemRecord[], feeds: Record<string, unknown>[]): DayFactResult {
  const fact: FactFile = {
    version: CONTRACT_VERSION,
    source: { id: 'rss', name: 'RSS', type: 'rss' },
    day: DAY,
    fetch: { lastAttemptAt: AT, lastSuccessAt: AT, status: 'ok', error: '' },
    meta: { newItems: items.length, scanned: items.length + 4, origin: AT, feeds },
    items,
  };
  return { kind: 'ok', fact };
}

function library(): RssLibrary {
  return {
    version: 1,
    updatedAt: AT,
    channels: [
      { id: 'ch00000001', name: '基础设施' },
      { id: 'ch00000002', name: '数字生活' },
      { id: 'ch00000003', name: '空渠道' },
    ],
    feeds: [
      { url: 'https://a.example/rss', name: 'A', note: '', channel: 'ch00000001', addedAt: '' },
      { url: 'https://b.example/rss', name: 'B', note: '', channel: 'ch00000001', addedAt: '' },
      { url: 'https://c.example/rss', name: 'C', note: '', channel: 'ch00000002', addedAt: '' },
      { url: 'https://inbox.example/rss', name: 'Inbox', note: '', channel: '', addedAt: '' },
    ],
  };
}

function feedMeta(url: string, status: 'ok' | 'error', accepted = 1, items = 2): Record<string, unknown> {
  return {
    url,
    title: url,
    titleSource: 'document',
    status,
    httpStatus: status === 'ok' ? 200 : 500,
    notModified: false,
    items,
    accepted,
    dropped: { noLink: 0, noKey: 0, dupKey: 0, overLimit: 0, firstPull: 0 },
    ...(status === 'error' ? { error: `${url} failed` } : {}),
  };
}

function projected(slice: RssChannelSlice, capabilities: SourceCapabilities = { backfill: false, translation: true, emptyState: 'empty' }): ProjectedSource {
  return {
    source: { id: 'rss', name: slice.channel.name, type: 'rss' },
    cadence: 'daily',
    capabilities,
    channelId: slice.channel.id,
    feedOutcome: slice.feedOutcome,
    fact: slice.fact,
    health: null,
    translation: { enabled: true, missing: 0, error: '' },
  };
}

function health(error: string, failures = 1): HealthRecord {
  return {
    version: CONTRACT_VERSION,
    lastAttemptAt: AT,
    lastSuccessAt: '',
    consecutiveFailures: failures,
    lastError: error,
    cursor: {},
    autoAttempts: { day: DAY, count: 1 },
    lastOutcome: 'error',
    pendingAttempts: { day: '', count: 0 },
  };
}

test('one fact becomes one slice per channel with feeds', () => {
  const items = [
    item('a1', 'https://a.example/rss'),
    item('b1', 'https://b.example/rss'),
    item('c1', 'https://c.example/rss'),
    item('inbox1', 'https://inbox.example/rss'),
    item('orphan1', 'https://gone.example/rss'),
  ];
  const fact = factOf(items, [
    feedMeta('https://a.example/rss', 'ok', 1, 2),
    feedMeta('https://b.example/rss', 'error', 0, 0),
    feedMeta('https://c.example/rss', 'ok', 1, 1),
    feedMeta('https://inbox.example/rss', 'ok', 1, 1),
  ]);

  const slices = sliceRssChannels(library(), fact);

  assert.deepEqual(slices.map((slice) => slice.channel.name), ['基础设施', '数字生活']);
  assert.deepEqual(slices[0]?.items.map((entry) => entry.naturalKey), ['a1', 'b1']);
  assert.deepEqual(slices[1]?.items.map((entry) => entry.naturalKey), ['c1']);
  assert.deepEqual(slices[0]?.feedOutcome, {
    total: 2,
    failed: 1,
    error: 'https://b.example/rss failed',
  });
  assert.deepEqual(slices[1]?.feedOutcome, { total: 1, failed: 0, error: '' });
  assert.equal(slices[0]?.meta.newItems, 1);
  assert.equal(slices[0]?.meta.scanned, 2);
  assert.equal(slices[0]?.meta.failed, 1);
  assert.equal(slices[0]?.meta.feeds.length, 2);
});

test('the sliced fact carries the channel identity and no pool keys', () => {
  const slices = sliceRssChannels(library(), factOf([item('a1', 'https://a.example/rss')], [
    feedMeta('https://a.example/rss', 'ok'),
  ]));

  const fact = slices[0]?.fact;
  assert.equal(fact?.kind, 'ok');
  if (fact?.kind !== 'ok') return;
  assert.deepEqual(fact.fact.source, { id: 'rss', name: '基础设施', type: 'rss' });
  assert.equal(fact.fact.meta?.origin, undefined);
  assert.equal(fact.fact.meta?.newItems, 1);
  assert.equal(fact.fact.items.length, 1);
});

test('a missing or corrupt pool fact still yields a slice per channel with feeds', () => {
  const missing: DayFactResult = { kind: 'missing' };
  const missingSlices = sliceRssChannels(library(), missing);
  assert.equal(missingSlices.length, 2);
  assert.deepEqual(missingSlices[0]?.items, []);
  assert.equal(missingSlices[0]?.feedOutcome.total, 2);

  const corrupt: DayFactResult = { kind: 'corrupt', error: 'bad json' };
  const corruptSlices = sliceRssChannels(library(), corrupt);
  assert.equal(corruptSlices.length, 2);
  assert.deepEqual(corruptSlices[0]?.fact, corrupt);
});

test('an all-failed channel reads error while a mixed channel reads ok', () => {
  const fact = factOf([item('c1', 'https://c.example/rss')], [
    feedMeta('https://a.example/rss', 'error', 0, 0),
    feedMeta('https://b.example/rss', 'error', 0, 0),
    feedMeta('https://c.example/rss', 'ok', 1, 1),
  ]);
  const slices = sliceRssChannels(library(), fact);

  const first = sectionState({ date: DAY, today: DAY, state: {}, source: projected(slices[0] as RssChannelSlice) });
  assert.equal(first.status, 'error');
  assert.equal(first.fetch.error, 'https://a.example/rss failed');

  const second = sectionState({ date: DAY, today: DAY, state: {}, source: projected(slices[1] as RssChannelSlice) });
  assert.equal(second.status, 'ok');
});

test('a zero-item channel reads empty only when the capability says so', () => {
  const fact = factOf([], [feedMeta('https://a.example/rss', 'ok', 0, 0)]);
  const slices = sliceRssChannels(library(), fact);

  const empty = sectionState({
    date: DAY,
    today: DAY,
    state: {},
    source: projected(slices[0] as RssChannelSlice),
  });
  assert.equal(empty.status, 'empty');

  const notPublished = sectionState({
    date: DAY,
    today: DAY,
    state: {},
    source: projected(slices[0] as RssChannelSlice, { backfill: false, translation: true }),
  });
  assert.equal(notPublished.status, 'notPublished');
});

test("today's pool failure outranks a written fact, history ignores it", () => {
  const fact = factOf([item('a1', 'https://a.example/rss')], [feedMeta('https://a.example/rss', 'ok')]);
  const slices = sliceRssChannels(library(), fact);
  const source = { ...projected(slices[0] as RssChannelSlice), health: health('pool down') };

  assert.equal(sectionState({ date: DAY, today: DAY, state: {}, source }).status, 'error');
  assert.equal(sectionState({ date: '2026-11-11', today: DAY, state: {}, source }).status, 'ok');
});

test('a total failure with no fact reads error from health', () => {
  const missing: DayFactResult = { kind: 'missing' };
  const slices = sliceRssChannels(library(), missing);
  const source = { ...projected(slices[0] as RssChannelSlice), health: health('pool down') };

  const state = sectionState({ date: DAY, today: DAY, state: {}, source });
  assert.equal(state.status, 'error');
  assert.equal(state.fetch.error, 'pool down');
});

test('a corrupt fact reads corrupt for every channel', () => {
  const corrupt: DayFactResult = { kind: 'corrupt', error: 'bad json' };
  const slices = sliceRssChannels(library(), corrupt);
  const state = sectionState({ date: DAY, today: DAY, state: {}, source: projected(slices[0] as RssChannelSlice) });
  assert.equal(state.status, 'corrupt');
});
