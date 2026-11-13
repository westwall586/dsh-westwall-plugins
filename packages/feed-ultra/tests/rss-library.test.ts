import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  EMPTY_RSS_LIBRARY,
  MAX_RSS_FEEDS,
  normalizeFeedUrl,
  normalizeLibrary,
  type RssLibrary,
} from '../src/contract/rss-library.ts';
import { FeedUltraError } from '../src/service/errors.ts';
import { applyOps, orderedFeeds, randomChannelId, rssLibraryView } from '../src/service/rss-library.ts';
import { ensureLayout } from '../src/store/init.ts';
import { layout, rssLibraryFile } from '../src/store/paths.ts';
import { createRssLibraryStore } from '../src/store/rss-library.ts';

const NOW = new Date('2026-11-12T09:00:00.000Z');
const AT = NOW.toISOString();

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-rss-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await ensureLayout(layout(root));
  return root;
}

function ids(): () => string {
  let n = 0;
  return () => `ch0000000${++n}`;
}

function context(parseOpml: (text: string) => readonly { url: string; name: string }[] = () => []) {
  return { at: AT, newChannelId: ids(), parseOpml };
}

function libraryWith(overrides: Partial<RssLibrary> = {}): RssLibrary {
  return { ...EMPTY_RSS_LIBRARY, ...overrides };
}

test('normalizeFeedUrl keeps absolute http(s), drops fragments and one trailing slash', () => {
  assert.equal(normalizeFeedUrl(' HTTPS://Example.com/rss/ '), 'https://example.com/rss');
  assert.equal(normalizeFeedUrl('https://example.com/feed#top'), 'https://example.com/feed');
  assert.equal(normalizeFeedUrl('https://example.com/'), 'https://example.com/');
  assert.equal(normalizeFeedUrl('javascript:alert(1)'), null);
  assert.equal(normalizeFeedUrl('/relative'), null);
  assert.equal(normalizeFeedUrl('  '), null);
});

test('a missing library reads empty and writes nothing', async (t) => {
  const root = await workspace(t);
  const store = createRssLibraryStore({ now: () => NOW });

  const read = await store.read(layout(root));

  assert.deepEqual(read.library, EMPTY_RSS_LIBRARY);
  assert.equal(read.recoveredFrom, undefined);
  assert.equal((await readdir(layout(root).data)).includes('rss-library.json'), false);
});

test('a corrupt library is moved aside and rebuilt empty', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  await writeFile(rssLibraryFile(l), '{ not json', 'utf8');
  const store = createRssLibraryStore({ now: () => NOW });

  const first = await store.read(l);
  assert.deepEqual(first.library, EMPTY_RSS_LIBRARY);
  assert.ok(first.recoveredFrom);
  assert.match(path.basename(first.recoveredFrom), /^rss-library\.corrupt-.*\.json$/);
  assert.equal(await readFile(first.recoveredFrom, 'utf8'), '{ not json');

  const second = await store.read(l);
  assert.equal(second.recoveredFrom, undefined);
  assert.deepEqual(second.library, EMPTY_RSS_LIBRARY);
});

test('a version mismatch is treated as corrupt', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  await writeFile(rssLibraryFile(l), JSON.stringify({ version: 99, channels: [], feeds: [] }), 'utf8');
  const store = createRssLibraryStore({ now: () => NOW });

  const read = await store.read(l);
  assert.deepEqual(read.library, EMPTY_RSS_LIBRARY);
  assert.ok(read.recoveredFrom);
});

test('concurrent mutations serialize without a lost update', async (t) => {
  const root = await workspace(t);
  const l = layout(root);
  const store = createRssLibraryStore({ now: () => NOW });

  await Promise.all([
    store.mutate(l, (library) => ({
      ...library,
      channels: [...library.channels, { id: 'ch00000001', name: 'One' }],
    })),
    store.mutate(l, (library) => ({
      ...library,
      channels: [...library.channels, { id: 'ch00000002', name: 'Two' }],
    })),
  ]);

  const read = await store.read(l);
  assert.deepEqual(read.library.channels.map((channel) => channel.name), ['One', 'Two']);
  const names = await readdir(l.data);
  assert.equal(names.filter((name) => name.endsWith('.tmp')).length, 0);
});

test('addFeed normalizes and is idempotent', () => {
  const { library } = applyOps(EMPTY_RSS_LIBRARY, [
    { op: 'addChannel', name: '基础设施' },
    { op: 'addFeed', url: 'https://example.com/rss/', channel: 'ch00000001' },
    { op: 'addFeed', url: 'https://example.com/rss', channel: '' },
  ], context());

  assert.equal(library.channels.length, 1);
  assert.equal(library.feeds.length, 1);
  assert.equal(library.feeds[0]?.url, 'https://example.com/rss');
  assert.equal(library.feeds[0]?.channel, 'ch00000001');
});

test('bad references and unknown ops throw invalid-input', () => {
  const seed = libraryWith({ channels: [{ id: 'ch00000001', name: 'One' }] });
  const cases = [
    [{ op: 'moveFeed', url: 'https://example.com/x', channel: 'ch99999999' }],
    [{ op: 'removeFeed', url: 'https://example.com/x' }],
    [{ op: 'renameChannel', id: 'ch99999999', name: 'X' }],
    [{ op: 'addChannel', name: 'One' }],
    [{ op: 'reorderChannels', ids: ['ch00000001', 'ch00000002'] }],
    [{ op: 'unknown' }],
    [42],
  ] as const;

  for (const ops of cases) {
    assert.throws(
      () => applyOps(seed, ops as never, context()),
      (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-input',
    );
  }
});

test('removing a channel returns its feeds to the inbox', () => {
  const seed = libraryWith({
    channels: [{ id: 'ch00000001', name: 'One' }],
    feeds: [
      { url: 'https://example.com/a', name: '', note: '', channel: 'ch00000001', addedAt: '' },
      { url: 'https://example.com/b', name: '', note: '', channel: '', addedAt: '' },
    ],
  });

  const { library } = applyOps(seed, [{ op: 'removeChannel', id: 'ch00000001' }], context());

  assert.deepEqual(library.channels, []);
  assert.deepEqual(library.feeds.map((feed) => feed.channel), ['', '']);
  assert.equal(library.feeds.length, 2);
});

test('reorderChannels accepts an exact permutation only', () => {
  const seed = libraryWith({
    channels: [
      { id: 'ch00000001', name: 'One' },
      { id: 'ch00000002', name: 'Two' },
    ],
  });

  const { library } = applyOps(seed, [{ op: 'reorderChannels', ids: ['ch00000002', 'ch00000001'] }], context());
  assert.deepEqual(library.channels.map((channel) => channel.name), ['Two', 'One']);
});

test('importOpml flattens, skips duplicates and reports counts', () => {
  const seed = libraryWith({
    feeds: [{ url: 'https://existing.example/rss', name: '', note: '', channel: '', addedAt: '' }],
  });
  const { library, lastImport } = applyOps(seed, [{ op: 'importOpml', text: '<opml/>' }], context(() => [
    { url: 'https://existing.example/rss', name: 'Existing' },
    { url: 'https://new.example/feed', name: 'New' },
    { url: 'javascript:void(0)', name: 'Bad' },
    { url: 'https://new.example/feed', name: 'Duplicate' },
  ]));

  assert.deepEqual(lastImport, { added: 1, skipped: 3 });
  assert.deepEqual(library.feeds.map((feed) => feed.url), [
    'https://existing.example/rss',
    'https://new.example/feed',
  ]);
  assert.equal(library.feeds[1]?.channel, '');
});

test('a malformed OPML fails the whole batch', () => {
  assert.throws(
    () => applyOps(EMPTY_RSS_LIBRARY, [{ op: 'importOpml', text: '<opml/>' }], context(() => {
      throw new Error('unreadable');
    })),
    (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-input',
  );
});

test('the active cap rejects a 201st channel feed while the inbox keeps growing', () => {
  const channel = { id: 'ch00000002', name: 'Active' };
  const active = Array.from({ length: 200 }, (_, index) => ({
    url: `https://example.com/a${index}`,
    name: '',
    note: '',
    channel: channel.id,
    addedAt: '',
  }));
  const seed = libraryWith({ channels: [channel], feeds: active });

  assert.throws(
    () => applyOps(seed, [{ op: 'addFeed', url: 'https://example.com/channel-extra', channel: channel.id }], context()),
    (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-input',
  );

  const withInbox = applyOps(seed, [{ op: 'addFeed', url: 'https://example.com/inbox-extra' }], context());
  assert.equal(withInbox.library.feeds.length, 201);
  assert.equal(withInbox.library.feeds.at(-1)?.channel, '');

  assert.throws(
    () => applyOps(withInbox.library, [{ op: 'moveFeed', url: 'https://example.com/inbox-extra', channel: channel.id }], context()),
    (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-input',
  );

  const withSecond = applyOps(seed, [{ op: 'addChannel', name: 'Other' }], context());
  const other = withSecond.library.channels[1];
  const moved = applyOps(withSecond.library, [{ op: 'moveFeed', url: active[0].url, channel: other.id }], context());
  assert.equal(moved.library.feeds[0]?.channel, other.id, 'channel to channel does not raise the active count');

  const freed = applyOps(withInbox.library, [{ op: 'moveFeed', url: active[0].url, channel: '' }], context());
  const refilled = applyOps(freed.library, [{ op: 'moveFeed', url: 'https://example.com/inbox-extra', channel: channel.id }], context());
  assert.equal(refilled.library.feeds.find(feed => feed.url === 'https://example.com/inbox-extra')?.channel, channel.id);
});

test('the channel cap still rejects a 21st channel', () => {
  const channels = Array.from({ length: 20 }, (_, index) => ({
    id: `ch${String(index).padStart(8, '0')}`,
    name: `C${index}`,
  }));
  assert.throws(
    () => applyOps(libraryWith({ channels }), [{ op: 'addChannel', name: 'Extra' }], context()),
    (error: unknown) => error instanceof FeedUltraError && error.code === 'invalid-input',
  );
});

test('importOpml fills the inbox even when the active cap is reached', () => {
  const channel = { id: 'ch00000002', name: 'Active' };
  const active = Array.from({ length: 200 }, (_, index) => ({
    url: `https://example.com/a${index}`,
    name: '',
    note: '',
    channel: channel.id,
    addedAt: '',
  }));
  const seed = libraryWith({ channels: [channel], feeds: active });
  const parseOpml = () => Array.from({ length: 250 }, (_, index) => ({
    url: `https://example.com/i${index}`,
    name: `I${index}`,
  }));
  const result = applyOps(seed, [{ op: 'importOpml', text: '<opml/>' }], context(parseOpml));
  assert.equal(result.library.feeds.length, 450);
  assert.equal(result.library.feeds.filter(feed => feed.channel === '').length, 250);
  assert.deepEqual(result.lastImport, { added: 250, skipped: 0 });
});

test('the storage ceiling is far above the active cap and drops only past it', () => {
  const feeds = Array.from({ length: MAX_RSS_FEEDS + 1 }, (_, index) => ({
    url: `https://example.com/s${index}`,
    name: '',
    note: '',
    channel: '',
    addedAt: '',
  }));
  const normalized = normalizeLibrary(libraryWith({ feeds }));
  assert.equal(normalized.feeds.length, MAX_RSS_FEEDS);
});

test('orderedFeeds follows channel order then feed order and skips the inbox', () => {
  const library = libraryWith({
    channels: [
      { id: 'ch00000002', name: 'Two' },
      { id: 'ch00000001', name: 'One' },
    ],
    feeds: [
      { url: 'https://example.com/inbox', name: '', note: '', channel: '', addedAt: '' },
      { url: 'https://example.com/one-a', name: 'A', note: '', channel: 'ch00000001', addedAt: '' },
      { url: 'https://example.com/two-a', name: 'B', note: '', channel: 'ch00000002', addedAt: '' },
      { url: 'https://example.com/one-b', name: 'C', note: '', channel: 'ch00000001', addedAt: '' },
    ],
  });

  assert.deepEqual(orderedFeeds(library).map((feed) => feed.url), [
    'https://example.com/two-a',
    'https://example.com/one-a',
    'https://example.com/one-b',
  ]);
});

test('randomChannelId matches the contract pattern and avoids collisions', () => {
  const library = libraryWith({ channels: [{ id: randomChannelId(EMPTY_RSS_LIBRARY), name: 'One' }] });
  const id = randomChannelId(library);
  assert.match(id, /^ch[a-z0-9]{6,12}$/);
  assert.notEqual(id, library.channels[0]?.id);
});

test('rssLibraryView counts inbox feeds separately', () => {
  const view = rssLibraryView(libraryWith({
    channels: [{ id: 'ch00000001', name: 'One' }],
    feeds: [
      { url: 'https://example.com/a', name: '', note: '', channel: 'ch00000001', addedAt: '' },
      { url: 'https://example.com/b', name: '', note: '', channel: '', addedAt: '' },
    ],
  }));

  assert.deepEqual(view.counts, { feeds: 2, channels: 1, inbox: 1 });
});
