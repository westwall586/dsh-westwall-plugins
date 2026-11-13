import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { RssPreview } from '../src/contract/rss-preview.ts';
import { createFeedUltraService } from '../src/service/index.ts';
import type { FeedUltraConfig } from '../src/settings.ts';
import { SOURCES } from '../src/sources/registry.ts';
import { fetchPublicFeed, type FeedDocument } from '../src/sources/rss/http.ts';
import { previewFeed } from '../src/sources/rss/preview.ts';
import { SourceFetchError } from '../src/sources/types.ts';
import { dayKeyOf, layout, rssLibraryFile } from '../src/store/paths.ts';

const DAY = '2026-11-12';
const AT = `${DAY}T09:00:00.000Z`;

function feedText(count: number): string {
  const items = Array.from({ length: count }, (_, index) => `
    <item>
      <title>Item ${index}</title>
      <link>https://example.com/${index}</link>
      <description><![CDATA[<p>Desc ${index}</p>]]></description>
      <pubDate>Thu, 12 Nov 2026 00:00:00 GMT</pubDate>
      <guid>g${index}</guid>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <title>Preview Source</title>
      <link>https://example.com/</link>
      <description>d</description>${items}
    </channel></rss>`;
}

function documentOf(text: string): FeedDocument {
  return { notModified: false, httpStatus: 200, text, etag: '', lastModified: '' };
}

test('preview returns at most twenty items and reports the document title', async () => {
  const result = await previewFeed('https://example.com/feed', '', AT, {
    fetchPublic: async () => documentOf(feedText(25)),
  });
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://example.com/feed');
  assert.equal(result.name, '');
  assert.equal(result.title, 'Preview Source');
  assert.equal(result.scanned, 25);
  assert.equal(result.truncated, true);
  assert.equal(result.items.length, 20);
  assert.deepEqual(result.items[0], {
    title: 'Item 0',
    url: 'https://example.com/0',
    publishedAt: '2026-11-12T00:00:00.000Z',
    description: 'Desc 0',
  });
});

test('preview reports a fetch failure as data rather than throwing', async () => {
  const result = await previewFeed('https://example.com/feed', 'Stored name', AT, {
    fetchPublic: async () => {
      throw new SourceFetchError('http', 'GET https://example.com/feed returned 404');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.title, 'Stored name');
  assert.equal(result.items.length, 0);
  assert.match(result.error, /404/);
});

test('a public fetch follows redirects by hand and stops at a private hop', async () => {
  const calls: string[] = [];
  const guarded: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  }) as unknown as typeof fetch;
  const guard = async (value: string) => {
    guarded.push(value);
    if (value.includes('127.0.0.1')) throw new SourceFetchError('drift', 'blocked private hop');
    return new URL(value);
  };

  await assert.rejects(
    () => fetchPublicFeed('https://example.com/feed', { fetchImpl, guard }),
    /blocked private hop/,
  );
  assert.deepEqual(calls, ['https://example.com/feed']);
  assert.deepEqual(guarded, ['https://example.com/feed', 'http://127.0.0.1/secret']);
});

test('a redirect loop is bounded at three hops', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(null, { status: 302, headers: { location: '/next' } });
  }) as unknown as typeof fetch;
  const guard = async (value: string) => new URL(value);

  await assert.rejects(
    () => fetchPublicFeed('https://example.com/feed', { fetchImpl, guard }),
    /exceeded 3 redirects/,
  );
  assert.equal(calls.length, 4);
});

test('a public fetch rejects HTML without writing a snapshot', async () => {
  const fetchImpl = (async () => new Response('<html>not a feed</html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchPublicFeed('https://example.com/feed', { fetchImpl, guard: async value => new URL(value) }),
    /returned HTML, not a feed/,
  );
});

test('preview accepts only library URLs and never writes the library or a fact', async (t: TestContext) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config: FeedUltraConfig = {
    workspacePath: '',
    retentionDays: 30,
    sources: {},
    model: null,
    autoFetch: true,
  };
  let previewed: { url: string; name: string } | undefined;
  const service = createFeedUltraService({
    config: () => config,
    sources: SOURCES,
    now: () => new Date(AT),
    runFetch: async (request) => ({
      status: 'ok',
      sourceId: request.source.id,
      day: request.day,
      count: 0,
      added: 0,
      lastAttemptAt: AT,
      lastSuccessAt: AT,
    }),
    previewFeed: async (url, name): Promise<RssPreview> => {
      previewed = { url, name };
      return {
        ok: true,
        url,
        name,
        title: 'Preview Source',
        items: [{ title: 'Item', url: 'https://example.com/1', publishedAt: AT, description: 'd' }],
        scanned: 1,
        truncated: false,
        error: '',
      };
    },
  });
  const bound = await service.bindWorkspace(root);
  config.workspacePath = bound.workspace.path;
  await service.rssLibraryMutate([{ op: 'addFeed', url: 'https://example.com/feed' }]);

  const before = await readFile(rssLibraryFile(layout(bound.workspace.path)), 'utf8');
  const result = await service.rssPreview('https://example.com/feed');
  const after = await readFile(rssLibraryFile(layout(bound.workspace.path)), 'utf8');

  assert.equal(result.ok, true);
  assert.deepEqual(previewed, { url: 'https://example.com/feed', name: '' });
  assert.equal(after, before, 'the library file is untouched');
  await assert.rejects(access(path.join(bound.workspace.path, '.dsh-feeds', 'data', 'items', dayKeyOf(new Date(AT)), 'rss.json')));
  await assert.rejects(access(path.join(bound.workspace.path, '.dsh-feeds', 'health', 'rss.json')));

  await assert.rejects(
    () => service.rssPreview('https://other.example/feed'),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code: string }).code === 'invalid-input',
  );
});
