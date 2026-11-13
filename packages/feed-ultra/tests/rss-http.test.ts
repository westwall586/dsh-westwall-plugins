import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { fetchFeed, type FeedTransport } from '../src/sources/rss/http.ts';
import { SourceFetchError } from '../src/sources/types.ts';

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  delayMs?: number;
}

interface Request {
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

const localTransport: FeedTransport = (url, init) => fetch(url, init as RequestInit);
const localGuard = async (value: string): Promise<URL> => new URL(value);

function testFetch(
  url: string,
  cursor?: Parameters<typeof fetchFeed>[1],
  options: Parameters<typeof fetchFeed>[2] = {},
) {
  return fetchFeed(url, cursor, { ...options, transport: localTransport, guard: localGuard });
}

async function serve(t: TestContext, reply: (request: Request) => Reply): Promise<{ base: string; requests: Request[] }> {
  const requests: Request[] = [];
  const server = createServer((request, response) => {
    const captured = { url: request.url ?? '', headers: request.headers };
    requests.push(captured);
    const result = reply(captured);
    const send = (): void => {
      response.writeHead(result.status ?? 200, result.headers ?? {});
      response.end(result.body ?? '');
    };
    if (result.delayMs === undefined) send();
    else setTimeout(send, result.delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, requests };
}

test('fetchFeed sends validators and returns the document with its validators', async (t) => {
  const { base, requests } = await serve(t, () => ({
    headers: { 'content-type': 'application/xml; charset=utf-8', etag: '"v1"', 'last-modified': 'Wed, 11 Nov 2026 14:24:46 GMT' },
    body: '<rss version="2.0"><channel><title>x</title></channel></rss>',
  }));

  const document = await testFetch(`${base}/feed`, { etag: '"old"', lastModified: 'Tue, 10 Nov 2026 00:00:00 GMT' });

  assert.equal(document.notModified, false);
  assert.equal(document.httpStatus, 200);
  assert.match(document.text, /<title>x<\/title>/);
  assert.equal(document.etag, '"v1"');
  assert.equal(document.lastModified, 'Wed, 11 Nov 2026 14:24:46 GMT');
  const [request] = requests;
  assert.equal(request?.headers['if-none-match'], '"old"');
  assert.equal(request?.headers['if-modified-since'], 'Tue, 10 Nov 2026 00:00:00 GMT');
  assert.match(String(request?.headers['user-agent']), /^dsh-feed-ultra\//);
  assert.match(String(request?.headers.accept), /application\/rss\+xml/);
});

test('fetchFeed treats 304 as not modified and keeps the stored validator', async (t) => {
  const { base } = await serve(t, () => ({ status: 304, headers: { etag: '"same"' } }));
  const document = await testFetch(`${base}/feed`, { etag: '"same"' });

  assert.equal(document.notModified, true);
  assert.equal(document.httpStatus, 304);
  assert.equal(document.text, '');
  assert.equal(document.etag, '"same"');
});

test('fetchFeed classifies auth and http failures', async (t) => {
  const { base } = await serve(t, (request) => ({
    status: request.url === '/forbidden' ? 403 : 500,
    body: 'nope',
  }));

  await assert.rejects(testFetch(`${base}/forbidden`, undefined), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'auth');
    assert.equal(error.status, 403);
    return true;
  });
  await assert.rejects(testFetch(`${base}/broken`, undefined), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 500);
    return true;
  });
});

test('fetchFeed rejects an HTML login page and dumps the body', async (t) => {
  const { base } = await serve(t, () => ({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<html><body>sign in</body></html>',
  }));

  let caught: unknown;
  try {
    await testFetch(`${base}/feed`, undefined);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof SourceFetchError);
  assert.equal(caught.kind, 'drift');
  const match = /html snapshot: (\S+)/.exec(caught.message);
  assert.ok(match, 'the message names a dump path');
  assert.match(await readFile(match[1], 'utf8'), /sign in/);
});

test('fetchFeed rejects a body over the byte cap', async (t) => {
  const { base } = await serve(t, () => ({
    headers: { 'content-type': 'application/xml' },
    body: `<rss>${'x'.repeat(200)}</rss>`,
  }));

  await assert.rejects(testFetch(`${base}/feed`, undefined, { maxBytes: 20 }), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'drift');
    assert.match(error.message, /over the 20 byte cap/);
    return true;
  });
});

test('fetchFeed decodes a non-UTF-8 charset', async (t) => {
  const body = Uint8Array.from([...Buffer.from('<title>caf', 'latin1'), 0xe9, ...Buffer.from('</title>', 'latin1')]);
  const { base } = await serve(t, () => ({
    headers: { 'content-type': 'application/xml; charset=iso-8859-1' },
    body,
  }));

  const document = await testFetch(`${base}/feed`, undefined);
  assert.match(document.text, /café/);
});

test('fetchFeed reports a timeout', async (t) => {
  const { base } = await serve(t, () => ({ delayMs: 150, body: 'late' }));

  await assert.rejects(testFetch(`${base}/feed`, undefined, { timeoutMs: 20 }), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'timeout');
    return true;
  });
});


test('the default daily fetch refuses a private URL before any transport', async () => {
  await assert.rejects(
    fetchFeed('http://127.0.0.1/feed', undefined),
    (error: unknown) => error instanceof SourceFetchError && /blocked/.test(error.message),
  );
});

test('a redirect to a private address is refused before the second request', async () => {
  let calls = 0;
  const transport: FeedTransport = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  };
  const guard = async (value: string): Promise<URL> => {
    if (value.includes('127.0.0.1')) throw new SourceFetchError('drift', 'blocked private hop');
    return new URL(value);
  };
  await assert.rejects(
    () => fetchFeed('https://example.com/feed', undefined, { transport, guard }),
    /blocked private hop/,
  );
  assert.equal(calls, 1);
});
