import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  EMPTY_LIBRARY_VIEW,
  channelIdsAfterMove,
  channelNameProblem,
  clampPage,
  collectionFeeds,
  feedHost,
  feedLabel,
  matchesQuery,
  nextCollection,
  normalizeFeedInput,
  ops,
  pageCount,
  pageForUrl,
  paginate,
  sortFeeds,
  swappedChannelIds,
  visibleFeeds,
} from '../client/src/rss-model.mjs';
import {
  itemMeta,
  itemsForChannel,
  rssSectionMeta,
  sectionEmptyState,
  sectionKey,
  sectionKeyOf,
  sectionVisible,
} from '../client/src/view-model.mjs';

const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'));

function t(key, params = {}) {
  let text = zh[key] ?? key;
  for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

function view() {
  return {
    version: 1,
    updatedAt: '',
    channels: [
      { id: 'ch00000002', name: '数字生活' },
      { id: 'ch00000001', name: '基础设施' },
    ],
    feeds: [
      { url: 'https://a.example/rss', name: 'Zeta', note: 'deep', channel: 'ch00000001', addedAt: '' },
      { url: 'https://b.example/rss', name: 'Alpha', note: '', channel: 'ch00000001', addedAt: '' },
      { url: 'https://inbox.example/rss', name: '', note: 'later', channel: '', addedAt: '' },
      { url: 'https://c.example/rss', name: 'Beta', note: '', channel: 'ch00000002', addedAt: '' },
    ],
    counts: { feeds: 4, channels: 2, inbox: 1 },
  };
}

test('feed URLs normalize the same way as the host', () => {
  assert.equal(normalizeFeedInput(' HTTPS://Example.com/rss/ '), 'https://example.com/rss');
  assert.equal(normalizeFeedInput('https://example.com/feed#top'), 'https://example.com/feed');
  assert.equal(normalizeFeedInput('https://example.com/'), 'https://example.com/');
  assert.equal(normalizeFeedInput('javascript:alert(1)'), null);
  assert.equal(normalizeFeedInput('/relative'), null);
  assert.equal(normalizeFeedInput(''), null);
});

test('a feed label is its name, or its host', () => {
  assert.equal(feedLabel({ name: '少数派', url: 'https://sspai.com/feed' }), '少数派');
  assert.equal(feedLabel({ name: '  ', url: 'https://sspai.com/feed' }), 'sspai.com');
  assert.equal(feedHost('not a url'), '');
});

test('a collection is the inbox or one channel', () => {
  assert.deepEqual(collectionFeeds(view(), 'inbox').map(feed => feed.url), ['https://inbox.example/rss']);
  assert.deepEqual(collectionFeeds(view(), 'ch00000001').map(feed => feed.url), [
    'https://a.example/rss',
    'https://b.example/rss',
  ]);
});

test('search matches name, URL or note', () => {
  const feed = view().feeds[0];
  assert.equal(matchesQuery(feed, 'zeta'), true);
  assert.equal(matchesQuery(feed, 'a.example'), true);
  assert.equal(matchesQuery(feed, 'deep'), true);
  assert.equal(matchesQuery(feed, 'missing'), false);
  assert.equal(matchesQuery(feed, '  '), true);
});

test('feeds sort by name and then by URL', () => {
  const sorted = sortFeeds(view().feeds);
  assert.deepEqual(sorted.map(feed => feedLabel(feed)), ['Alpha', 'Beta', 'inbox.example', 'Zeta']);
});

test('pagination clamps pages and reports the visible range', () => {
  const feeds = Array.from({ length: 25 }, (_, index) => ({ url: `https://example.com/${index}`, name: `F${index}` }));
  assert.equal(pageCount(25), 3);
  assert.equal(pageCount(0), 1);
  assert.equal(clampPage(9, 25), 3);
  assert.equal(clampPage(0, 25), 1);
  assert.deepEqual(
    (({ page, pages, total, from, to }) => ({ page, pages, total, from, to }))(paginate(feeds, 3)),
    { page: 3, pages: 3, total: 25, from: 21, to: 25 },
  );
  assert.deepEqual(paginate([], 1).items, []);
  assert.equal(pageForUrl(feeds, 'https://example.com/12'), 2);
  assert.equal(pageForUrl(feeds, 'https://example.com/missing'), 1);
});

test('channel names reject empty, long and duplicate values', () => {
  const channels = [{ id: 'ch1', name: '基础设施' }];
  assert.equal(channelNameProblem('', channels), 'empty');
  assert.equal(channelNameProblem('  ', channels), 'empty');
  assert.equal(channelNameProblem('a'.repeat(41), channels), 'long');
  assert.equal(channelNameProblem('基础设施', channels), 'duplicate');
  assert.equal(channelNameProblem('基础设施', channels, 'ch1'), '');
  assert.equal(channelNameProblem('数字生活', channels), '');
});

test('a drag reorder inserts the dragged channel before the target', () => {
  const channels = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(channelIdsAfterMove(channels, 'a', 'c'), ['b', 'a', 'c']);
  assert.deepEqual(channelIdsAfterMove(channels, 'c', 'a'), ['c', 'a', 'b']);
  assert.equal(channelIdsAfterMove(channels, 'x', 'a'), null);
  assert.deepEqual(swappedChannelIds(channels, 'b', -1), ['b', 'a', 'c']);
  assert.equal(swappedChannelIds(channels, 'a', -1), null);
});

test('the collection falls back to the inbox after a channel is gone', () => {
  assert.equal(nextCollection(view(), 'ch00000001'), 'ch00000001');
  assert.equal(nextCollection(view(), 'ch99999999'), 'inbox');
  assert.equal(nextCollection(view(), 'inbox'), 'inbox');
});

test('visible feeds combine collection, search and order', () => {
  assert.deepEqual(
    visibleFeeds(view(), 'ch00000001', 'e').map(feed => feedLabel(feed)),
    ['Alpha', 'Zeta'],
  );
  assert.deepEqual(visibleFeeds(EMPTY_LIBRARY_VIEW, 'inbox', ''), []);
});

test('op builders use the inbox as the empty channel', () => {
  assert.deepEqual(ops.addFeed('https://a.example/rss', 'inbox'), { op: 'addFeed', url: 'https://a.example/rss' });
  assert.deepEqual(ops.addFeed('https://a.example/rss', 'ch1'), {
    op: 'addFeed',
    url: 'https://a.example/rss',
    channel: 'ch1',
  });
  assert.deepEqual(ops.moveFeed('https://a.example/rss', 'inbox'), {
    op: 'moveFeed',
    url: 'https://a.example/rss',
    channel: '',
  });
  assert.deepEqual(ops.importOpml('<opml/>'), { op: 'importOpml', text: '<opml/>' });
});

test('section identity is the source id plus the channel id', () => {
  assert.equal(sectionKeyOf('rss', 'ch00000001'), 'rss:ch00000001');
  assert.equal(sectionKeyOf('github_trending', undefined), 'github_trending');
  assert.equal(sectionKey({ source: { id: 'rss' }, channelId: 'ch00000001' }), 'rss:ch00000001');
  assert.equal(sectionKey({ source: { id: 'rss' } }), 'rss');
  assert.equal(sectionKey(null), '');
});

test('itemsForChannel uses the section key, so two RSS channels stay apart', () => {
  const sections = [
    { source: { id: 'rss' }, channelId: 'ch1', items: [{ id: 'a' }] },
    { source: { id: 'rss' }, channelId: 'ch2', items: [{ id: 'b' }] },
  ];
  assert.deepEqual(itemsForChannel(sections, 'rss:ch1').map(item => item.id), ['a']);
  assert.deepEqual(itemsForChannel(sections, 'rss:ch2').map(item => item.id), ['b']);
  assert.deepEqual(itemsForChannel(sections, 'all').map(item => item.id), ['a', 'b']);
});

test('an empty RSS section is visible while BestBlogs keeps notPublished', () => {
  const rss = {
    source: { id: 'rss', type: 'rss' },
    cadence: 'daily',
    channelId: 'ch1',
    capabilities: { backfill: false, translation: true, emptyState: 'empty' },
    status: 'empty',
    items: [],
  };
  assert.equal(sectionEmptyState(rss), 'empty');
  assert.equal(sectionVisible(rss, ''), true);
  assert.equal(sectionEmptyState({ ...rss, status: 'missing' }), 'missing');
  assert.equal(sectionVisible({ ...rss, status: 'missing' }, ''), true);

  const brief = {
    source: { id: 'bestblogs_brief', type: 'bestblogs-brief' },
    cadence: 'daily',
    capabilities: { backfill: true, translation: false },
    status: 'empty',
    items: [],
  };
  assert.equal(sectionEmptyState(brief), 'none');
});

test('rssSectionMeta counts the attempted feeds and failures', () => {
  const meta = rssSectionMeta({
    meta: {
      feeds: [
        { url: 'https://a', status: 'ok', dropped: { overLimit: 5 } },
        { url: 'https://b', status: 'error' },
      ],
    },
  });
  assert.equal(meta.feeds.length, 2);
  assert.equal(meta.failed, 1);
  assert.equal(meta.overLimit, 5);
  assert.deepEqual(rssSectionMeta({}), { feeds: [], failed: 0, overLimit: 0 });
});

test('an RSS row meta is the feed title and the clock time', () => {
  const item = {
    url: 'https://a.example/rss/posts/one',
    publishedAt: '2026-11-12T08:05:00.000Z',
    extra: { feedTitle: '少数派' },
  };
  const meta = itemMeta(item, new Date('2026-11-12T12:00:00.000Z'), t);
  assert.match(meta, /^少数派 · \d{2}:\d{2}$/);
});
