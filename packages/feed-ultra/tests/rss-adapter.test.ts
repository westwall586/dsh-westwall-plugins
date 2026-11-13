import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { fetchFeed } from '../src/sources/rss/http.ts';
import { createAdapter } from '../src/sources/rss/index.ts';
import type { FetchContext } from '../src/sources/types.ts';

const NOW = '2026-11-12T09:00:00.000Z';

interface Route {
  status?: number;
  body?: string;
  etag?: string;
  notModifiedOn?: string;
}

async function serve(t: TestContext, routes: Record<string, Route>): Promise<{ base: string; requests: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> }> {
  const requests: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '';
    requests.push({ url, headers: request.headers });
    const route = routes[url];
    if (!route) {
      response.writeHead(404).end('missing');
      return;
    }
    if (route.notModifiedOn !== undefined && request.headers['if-none-match'] === route.notModifiedOn) {
      response.writeHead(304, { etag: route.etag ?? route.notModifiedOn }).end();
      return;
    }
    response.writeHead(route.status ?? 200, {
      'content-type': 'application/xml; charset=utf-8',
      ...(route.etag === undefined ? {} : { etag: route.etag }),
    });
    response.end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, requests };
}

const localFetch: typeof fetchFeed = (url, cursor, options = {}) => fetchFeed(url, cursor, {
  ...options,
  transport: (target, init) => fetch(target, init as RequestInit),
  guard: async value => new URL(value),
});

function testAdapter() {
  return createAdapter({ fetchFeed: localFetch });
}

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    now: NOW,
    day: '2026-11-12',
    today: '2026-11-12',
    locale: 'zh',
    excludeKeys: new Set<string>(),
    batchSize: 0,
    ...overrides,
  };
}

function rssFeed(count: number, guidPrefix = 'g'): string {
  const items = Array.from({ length: count }, (_, index) => {
    const published = new Date(Date.UTC(2026, 10, 12, 8) - index * 86_400_000).toISOString();
    return `<item><title>Entry ${index + 1}</title><link>https://example.com/${index + 1}</link><guid>${guidPrefix}${index + 1}</guid><description>Body ${index + 1}</description><pubDate>${published}</pubDate></item>`;
  });
  return `<rss version="2.0"><channel><title>Generated</title><link>https://example.com/</link>${items.join('')}</channel></rss>`;
}

test('an empty pool performs no request and keeps the cursor', async () => {
  let calls = 0;
  const adapter = createAdapter({
    fetchFeed: async () => {
      calls += 1;
      return { notModified: false, httpStatus: 200, text: '', etag: '', lastModified: '' };
    },
  });

  const outcome = await adapter.fetch(context({ feeds: [], cursor: { feeds: { 'https://a.example/rss': { etag: '"x"' } } } }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(calls, 0);
  assert.deepEqual(outcome.items, []);
  assert.deepEqual(outcome.meta?.feeds, []);
  assert.deepEqual(outcome.cursor, { feeds: { 'https://a.example/rss': { etag: '"x"' } } });
});

test('two feeds merge, sort and report per-feed meta and cursor', async (t) => {
  const rss = await readFile(new URL('../src/sources/rss/fixtures/rss2-full.xml', import.meta.url), 'utf8');
  const atom = await readFile(new URL('../src/sources/rss/fixtures/atom-full.xml', import.meta.url), 'utf8');
  const { base } = await serve(t, {
    '/rss2.xml': { body: rss, etag: '"rss"' },
    '/atom.xml': { body: atom, etag: '"atom"' },
  });

  const outcome = await testAdapter().fetch(context({
    feeds: [
      { url: `${base}/rss2.xml`, name: '', channel: 'ch1' },
      { url: `${base}/atom.xml`, name: 'Atom', channel: 'ch1' },
    ],
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.deepEqual(outcome.items.map((item) => item.title), [
    'Updated only',
    'Permalink item with & entities',
    'Choosing QuePaxa',
    'Rust 1.90',
  ]);

  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal(feeds.length, 2);
  assert.equal(feeds[0]?.status, 'ok');
  assert.equal(feeds[0]?.title, 'Example Engineering');
  assert.equal(feeds[0]?.titleSource, 'document');
  assert.equal(feeds[0]?.items, 2);
  assert.equal(feeds[0]?.accepted, 2);
  assert.equal(feeds[1]?.items, 3);
  assert.equal(feeds[1]?.accepted, 2);
  assert.equal((feeds[1]?.dropped as Record<string, number>).noLink, 1);

  const cursor = outcome.cursor as { feeds: Record<string, { etag?: string }> };
  assert.equal(cursor.feeds[`${base}/rss2.xml`]?.etag, '"rss"');
  assert.equal(cursor.feeds[`${base}/atom.xml`]?.etag, '"atom"');
});

test('one failed feed leaves the pool ok with an error entry', async (t) => {
  const rss = await readFile(new URL('../src/sources/rss/fixtures/rss2-full.xml', import.meta.url), 'utf8');
  const { base } = await serve(t, {
    '/rss2.xml': { body: rss, etag: '"rss"' },
    '/broken.xml': { status: 500, body: 'down' },
  });

  const outcome = await testAdapter().fetch(context({
    feeds: [
      { url: `${base}/rss2.xml`, name: 'RSS', channel: 'ch1' },
      { url: `${base}/broken.xml`, name: 'Broken', channel: 'ch1' },
    ],
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal(feeds[0]?.status, 'ok');
  assert.equal(feeds[1]?.status, 'error');
  assert.equal(feeds[1]?.httpStatus, 500);
  const cursor = outcome.cursor as { feeds: Record<string, unknown> };
  assert.ok(cursor.feeds[`${base}/rss2.xml`]);
  assert.equal(cursor.feeds[`${base}/broken.xml`], undefined);
});

test('every feed failing throws the pool summary', async (t) => {
  const { base } = await serve(t, {
    '/a.xml': { status: 500, body: 'a' },
    '/b.xml': { status: 403, body: 'b' },
  });

  await assert.rejects(
    testAdapter().fetch(context({
      feeds: [
        { url: `${base}/a.xml`, name: 'A', channel: 'ch1' },
        { url: `${base}/b.xml`, name: 'B', channel: 'ch1' },
      ],
    })),
    /2\/2 个订阅源失败：/,
  );
});

test('a 304 keeps the stored validators and returns no items', async (t) => {
  const rss = await readFile(new URL('../src/sources/rss/fixtures/rss2-full.xml', import.meta.url), 'utf8');
  const { base, requests } = await serve(t, {
    '/feed.xml': { body: rss, etag: '"v1"', notModifiedOn: '"v1"' },
  });
  const url = `${base}/feed.xml`;

  const first = await testAdapter().fetch(context({ feeds: [{ url, name: 'RSS', channel: 'ch1' }] }));
  assert.equal(first.status, 'ok');
  if (first.status !== 'ok') return;
  const cursor = first.cursor as { feeds: Record<string, { etag?: string; watermark?: unknown }> };
  assert.ok(cursor.feeds[url]?.watermark, 'the first pull records a watermark');

  const second = await testAdapter().fetch(context({
    feeds: [{ url, name: 'RSS', channel: 'ch1' }],
    cursor,
  }));
  assert.equal(second.status, 'ok');
  if (second.status !== 'ok') return;
  assert.deepEqual(second.items, []);
  const feeds = second.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal(feeds[0]?.notModified, true);
  assert.equal(feeds[0]?.httpStatus, 304);
  const next = second.cursor as { feeds: Record<string, { etag?: string; watermark?: unknown }> };
  assert.equal(next.feeds[url]?.etag, '"v1"');
  assert.deepEqual(next.feeds[url]?.watermark, cursor.feeds[url]?.watermark);
  assert.equal(requests.at(-1)?.headers['if-none-match'], '"v1"');
});

test('the first pull caps a feed at twenty items and records a watermark', async (t) => {
  const { base } = await serve(t, { '/feed.xml': { body: rssFeed(22) } });
  const outcome = await testAdapter().fetch(context({
    feeds: [{ url: `${base}/feed.xml`, name: 'Fresh', channel: 'ch1' }],
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.items.length, 20);
  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal((feeds[0]?.dropped as Record<string, number>).firstPull, 2);
  const cursor = outcome.cursor as {
    feeds: Record<string, { watermark?: { id: string; at: string } }>;
  };
  assert.deepEqual(cursor.feeds[`${base}/feed.xml`]?.watermark, {
    id: 'g1',
    at: '2026-11-12T08:00:00.000Z',
  });
});

test('a later pull only takes items above the watermark, with no per-feed cap', async (t) => {
  const { base } = await serve(t, { '/feed.xml': { body: rssFeed(35) } });
  const url = `${base}/feed.xml`;
  const outcome = await testAdapter().fetch(context({
    feeds: [{ url, name: 'Known', channel: 'ch1' }],
    cursor: {
      feeds: {
        [url]: { etag: '"known"', watermark: { id: 'seed', at: '2020-01-01T00:00:00.000Z' } },
      },
    },
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.items.length, 35, 'no per-feed cap once a watermark exists');
  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal((feeds[0]?.dropped as Record<string, number>).overLimit, 0);
});

test('the second pull drops the first-pull backlog instead of trickling old items', async (t) => {
  const { base } = await serve(t, { '/feed.xml': { body: rssFeed(22) } });
  const url = `${base}/feed.xml`;
  const first = await testAdapter().fetch(context({
    feeds: [{ url, name: 'Known', channel: 'ch1' }],
  }));
  assert.equal(first.status, 'ok');
  if (first.status !== 'ok') return;
  assert.equal(first.items.length, 20);

  const second = await testAdapter().fetch(context({
    feeds: [{ url, name: 'Known', channel: 'ch1' }],
    cursor: first.cursor,
    excludeKeys: new Set(first.items.map(item => item.naturalKey)),
  }));
  assert.equal(second.status, 'ok');
  if (second.status !== 'ok') return;
  assert.equal(second.items.length, 0);
});

test('a same-timestamp item above the watermark id is still new', async () => {
  const feed = (prefix: string, count: number): string => {
    const items = Array.from({ length: count }, (_, index) =>
      `<item><title>${prefix}${index}</title><link>https://example.com/${prefix}${index}</link><guid>${prefix}${index}</guid><pubDate>Thu, 12 Nov 2026 08:00:00 GMT</pubDate></item>`).join('');
    return `<rss version="2.0"><channel><title>Same</title>${items}</channel></rss>`;
  };
  let body = feed('g', 2);
  const adapter = createAdapter({
    fetchFeed: async () => ({ notModified: false, httpStatus: 200, text: body, etag: '"v1"', lastModified: '' }),
  });
  const first = await adapter.fetch(context({
    feeds: [{ url: 'https://example.com/feed', name: 'Same', channel: 'ch1' }],
  }));
  assert.equal(first.status, 'ok');
  if (first.status !== 'ok') return;
  assert.deepEqual((first.cursor as { feeds: Record<string, { watermark?: unknown }> }).feeds['https://example.com/feed']?.watermark, {
    id: 'g0',
    at: '2026-11-12T08:00:00.000Z',
  });

  body = feed('g', 2).replace(
    '<channel><title>Same</title>',
    '<channel><title>Same</title><item><title>new</title><link>https://example.com/new</link><guid>new</guid><pubDate>Thu, 12 Nov 2026 08:00:00 GMT</pubDate></item>',
  );
  const second = await adapter.fetch(context({
    feeds: [{ url: 'https://example.com/feed', name: 'Same', channel: 'ch1' }],
    cursor: first.cursor,
  }));
  assert.equal(second.status, 'ok');
  if (second.status !== 'ok') return;
  assert.deepEqual(second.items.map(item => item.naturalKey), ['new']);
});

test('the global cap holds the watermark when it has to drop items', async (t) => {
  const { base } = await serve(t, { '/feed.xml': { body: rssFeed(1005) } });
  const url = `${base}/feed.xml`;
  const old = { id: 'seed', at: '2020-01-01T00:00:00.000Z' };
  const outcome = await testAdapter().fetch(context({
    feeds: [{ url, name: 'Huge', channel: 'ch1' }],
    cursor: { feeds: { [url]: { etag: '"known"', watermark: old } } },
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.items.length, 1000);
  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal((feeds[0]?.dropped as Record<string, number>).overLimit, 5);
  const cursor = outcome.cursor as { feeds: Record<string, { watermark?: unknown }> };
  assert.deepEqual(cursor.feeds[url]?.watermark, old, 'watermark does not move past dropped items');
});

test('excluded keys are skipped without counting as a drop', async (t) => {
  const { base } = await serve(t, { '/feed.xml': { body: rssFeed(2) } });
  const outcome = await testAdapter().fetch(context({
    feeds: [{ url: `${base}/feed.xml`, name: 'Known', channel: 'ch1' }],
    excludeKeys: new Set(['g1']),
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.deepEqual(outcome.items.map((item) => item.naturalKey), ['g2']);
  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  const dropped = feeds[0]?.dropped as Record<string, number>;
  assert.deepEqual(dropped, { noLink: 0, noKey: 0, dupKey: 0, overLimit: 0, firstPull: 0 });
});

test('the first feed wins a cross-feed duplicate', async (t) => {
  const body = (link: string): string =>
    `<rss version="2.0"><channel><title>Dup</title><item><title>Same</title><link>${link}</link><guid>same-key</guid><description>Body</description><pubDate>Thu, 12 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  const { base } = await serve(t, {
    '/a.xml': { body: body('https://example.com/a') },
    '/b.xml': { body: body('https://example.com/b') },
  });

  const outcome = await testAdapter().fetch(context({
    feeds: [
      { url: `${base}/a.xml`, name: 'A', channel: 'ch1' },
      { url: `${base}/b.xml`, name: 'B', channel: 'ch1' },
    ],
  }));

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.items.length, 1);
  assert.equal(outcome.items[0]?.url, 'https://example.com/a');
  const feeds = outcome.meta?.feeds as Array<Record<string, unknown>>;
  assert.equal((feeds[1]?.dropped as Record<string, number>).dupKey, 1);
});
