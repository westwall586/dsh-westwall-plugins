import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createAdapter, descriptor } from '../src/sources/bestblogs-brief/index.ts';
import { SourceFetchError, type FetchContext, type FetchOutcome } from '../src/sources/types.ts';

const BRIEF = fileURLToPath(new URL('../src/sources/bestblogs-brief/fixtures/brief-2026-11-11.json', import.meta.url));
const META = fileURLToPath(new URL('../src/sources/bestblogs-brief/fixtures/batch-meta-2026-11-11.json', import.meta.url));
const NULL_BRIEF = fileURLToPath(new URL('../src/sources/bestblogs-brief/fixtures/brief-null.json', import.meta.url));

const DAY = '2026-11-11';
const PAST = '2026-11-10';

interface CapturedRequest {
  method: string;
  url: string;
  userAgent: string;
  body: string;
}

interface Reply {
  status?: number;
  body: string;
  contentType?: string;
}

async function serve(t: TestContext, handler: (request: CapturedRequest) => Reply): Promise<{ baseUrl: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const captured: CapturedRequest = {
      method: request.method ?? 'GET',
      url: request.url ?? '',
      userAgent: request.headers['user-agent'] ?? '',
      body: Buffer.concat(chunks).toString('utf8'),
    };
    requests.push(captured);
    const reply = handler(captured);
    response.writeHead(reply.status ?? 200, {
      'content-type': reply.contentType ?? 'application/json; charset=utf-8',
    });
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

function context(day = DAY, today = DAY, locale = 'zh'): FetchContext {
  return { now: `${DAY}T00:00:00.000Z`, day, today, locale, excludeKeys: new Set(), batchSize: 0 };
}

function expectOk(outcome: FetchOutcome) {
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') throw new Error('expected ok');
  return outcome;
}

function expectNotPublished(outcome: FetchOutcome) {
  assert.equal(outcome.status, 'notPublished');
  if (outcome.status !== 'notPublished') throw new Error('expected notPublished');
  return outcome;
}

function contentItem(resourceId: string | undefined, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(resourceId === undefined ? {} : { resourceId }),
    contentType: 'ARTICLE',
    language: 'zh_CN',
    title: `content title ${resourceId ?? 'none'}`,
    matchReason: `match reason ${resourceId ?? 'none'}`,
    sourceName: 'content source',
    totalScore: 80,
    editorialRole: 'ESSENTIAL',
    ...overrides,
  };
}

function detailItem(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `detail title ${id}`,
    oneSentenceSummary: `detail summary ${id}`,
    url: `https://example.com/${id}`,
    readUrl: `https://www.bestblogs.dev/article/${id.replace(/^RAW_/, '')}`,
    cover: 'https://media.example.com/cover.jpg',
    sourceName: 'detail source',
    resourceType: 'ARTICLE',
    language: 'zh_CN',
    tags: ['tag one', 'tag two'],
    wordCount: 100,
    readTime: 2,
    publishTimeStamp: 1_700_000_000_000,
    score: 90,
    ...overrides,
  };
}

function briefBody(items: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    success: true,
    data: {
      briefDate: DAY,
      status: 'COMPLETED',
      contentItems: items,
      keywords: ['keyword one', 'keyword two'],
      podcastTitle: 'EP233 · Test brief',
      editorIntro: 'Today intro',
      podcastCoverUrl: 'https://media.example.com/brief-cover.webp',
      ...overrides,
    },
  });
}

function metaBody(items: unknown[]): string {
  return JSON.stringify({ success: true, data: items });
}

test('maps the real brief into ordered raw items with details, meta and the two request shapes', async (t) => {
  const brief = await readFile(BRIEF, 'utf8');
  const meta = await readFile(META, 'utf8');
  const { baseUrl, requests } = await serve(t, (request) =>
    request.method === 'POST' ? { body: meta } : { body: brief },
  );

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));

  assert.deepEqual(
    outcome.items.map((item) => item.naturalKey),
    ['RAW_39abcb5f7e', 'RAW_b8ba16a568', 'RAW_fa387eaa0'],
  );
  assert.deepEqual(
    outcome.items.map((item) => item.title),
    [
      'Gemini 4 Carbon 现已推出',
      'MiniMax H3-Image 开源：让 4K 图像生成进入 10 秒时代',
      'LinkedIn 如何让智能体从错误中改进，并验证改动有效',
    ],
  );
  assert.equal(
    outcome.items[0]?.description,
    'Google DeepMind 发布 Gemini 4 Carbon，这款前沿 AI 模型擅长网络安全、长程智能体工作流和科学推理，可通过 API 和 Google 平台使用，定价与 Argon 相同。',
  );
  assert.equal(outcome.items[0]?.url, 'https://www.bestblogs.dev/article/39abcb5f7e');
  assert.equal(outcome.items[0]?.publishedAt, new Date(1_794_326_498_670).toISOString());
  assert.deepEqual(outcome.items[0]?.extra, {
    originalUrl: 'https://deepmind.google/blog/gemini-4-carbon-is-now-available/',
    cover:
      'https://media.bestblogs.dev/20261110224730_gemini_4_carbon_key_art_16-9_lockup.width-1300.jpg',
    source: 'Google DeepMind News',
    score: 92,
    kind: 'article',
    role: 'DEEP_DIVE',
    tags: ['AI 与智能应用', '模型发布', '大语言模型 (LLM)', 'AI Agent', 'AI 安全与对齐'],
    lang: 'en_US',
    words: 1873,
    readTime: 8,
  });
  assert.equal(outcome.items[2]?.url, 'https://www.bestblogs.dev/video/fa387eaa0');
  assert.equal(outcome.items[2]?.extra.kind, 'video');

  assert.deepEqual(outcome.meta, {
    briefDate: DAY,
    episodeTitle: 'EP233 · Gemini Carbon 开放、MiniMax 开源图像、LinkedIn 校准智能体',
    intro: 'Gemini Carbon 开放、MiniMax 开源图像、LinkedIn 校准智能体：判断模型选择与改进方法。',
    keywords: ['旗舰模型', '图像开源', '智能体评估', '知识循环', '具身智能'],
    cover: 'https://media.bestblogs.dev/bestblogs-daily-briefing/2026-11-11/zh/cover.webp',
    webUrl: 'https://www.bestblogs.dev/explore/brief/2026-11-11',
    locale: 'zh',
    notPublished: false,
    detailStatus: 'ok',
    dropped: 0,
  });

  assert.deepEqual(
    requests.map((request) => [request.method, request.url]),
    [
      ['GET', `/api/proxy/briefs/public/${DAY}?locale=zh`],
      ['POST', '/api/proxy/resources/batch-meta'],
    ],
  );
  assert.equal(requests[0]?.userAgent, 'dsh-feed-ultra/0.1.0');
  assert.equal(requests[1]?.userAgent, 'dsh-feed-ultra/0.1.0');
  assert.deepEqual(JSON.parse(requests[1]?.body ?? '{}'), {
    ids: ['RAW_39abcb5f7e', 'RAW_b8ba16a568', 'RAW_fa387eaa0'],
    uiLang: 'zh',
  });
  assert.equal(descriptor.id, 'bestblogs_brief');
  assert.equal(descriptor.name, 'BestBlogs Daily Brief');
  assert.equal(descriptor.type, 'bestblogs-brief');
});

test('derives readUrl without the RAW_ prefix and falls back to the brief local midnight', async (t) => {
  const brief = briefBody([contentItem('RAW_article1'), contentItem('RAW_video1', { contentType: 'VIDEO' })]);
  const { baseUrl, requests } = await serve(t, (request) =>
    request.method === 'POST'
      ? {
          body: metaBody([
            detailItem('RAW_article1', { readUrl: null, publishTimeStamp: null }),
            detailItem('RAW_video1', { readUrl: null, publishTimeStamp: null, resourceType: 'VIDEO' }),
          ]),
        }
      : { body: brief },
  );

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));
  assert.equal(outcome.items[0]?.url, 'https://www.bestblogs.dev/article/article1');
  assert.equal(outcome.items[1]?.url, 'https://www.bestblogs.dev/video/video1');
  assert.equal(outcome.items[0]?.publishedAt, new Date(2026, 10, 11).toISOString());
  assert.equal(requests.length, 2);
});

test('a null brief is pending today and notPublished on a past day, with no detail request', async (t) => {
  const nullBrief = await readFile(NULL_BRIEF, 'utf8');
  const { baseUrl, requests } = await serve(t, () => ({ body: nullBrief }));
  const adapter = createAdapter({ baseUrl });

  assert.deepEqual(await adapter.fetch(context()), { status: 'pending' });

  const past = expectNotPublished(await adapter.fetch(context(PAST, DAY)));
  assert.deepEqual(past.meta, {
    briefDate: PAST,
    webUrl: `https://www.bestblogs.dev/explore/brief/${PAST}`,
    locale: 'zh',
    notPublished: true,
    detailStatus: 'ok',
    dropped: 0,
  });
  assert.equal(requests.length, 2, 'neither call reaches batch-meta');
  assert.ok(requests.every((request) => request.method === 'GET'));
});

test('a non-COMPLETED brief is pending today and notPublished on a past day', async (t) => {
  const body = briefBody([contentItem('RAW_x')], { status: 'PROCESSING' });
  const { baseUrl, requests } = await serve(t, () => ({ body }));
  const adapter = createAdapter({ baseUrl });

  assert.deepEqual(await adapter.fetch(context()), { status: 'pending' });
  const past = expectNotPublished(await adapter.fetch(context(PAST, DAY)));
  assert.equal(past.meta?.detailStatus, 'ok');
  assert.equal(requests.filter((request) => request.method === 'POST').length, 0);
});

test('a completed brief with no content items is drift and keeps the raw JSON', async (t) => {
  const body = briefBody([]);
  const { baseUrl } = await serve(t, () => ({ body }));

  await assert.rejects(createAdapter({ baseUrl }).fetch(context()), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'drift');
    const snapshot = error.message.match(/json snapshot: (\S+)/)?.[1];
    assert.ok(snapshot, 'drift keeps the unreadable payload');
    return true;
  });
});

test('an unreadable first response is drift with a JSON snapshot', async (t) => {
  const body = JSON.stringify({ success: true, data: {} });
  const { baseUrl } = await serve(t, () => ({ body }));

  const error = await createAdapter({ baseUrl }).fetch(context()).then(
    () => null,
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof SourceFetchError);
  assert.equal(error.kind, 'drift');
  const snapshot = error.message.match(/json snapshot: (\S+)/)?.[1];
  assert.ok(snapshot, 'drift keeps the unreadable payload');
  assert.match(await readFile(snapshot, 'utf8'), /"data":\{\}/);
});

test('an HTTP failure on the first request is an http error', async (t) => {
  const { baseUrl } = await serve(t, () => ({ status: 502, body: 'bad gateway' }));

  await assert.rejects(createAdapter({ baseUrl }).fetch(context()), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 502);
    return true;
  });
});

test('a batch-meta 500 is retried once, then the day degrades instead of failing', async (t) => {
  const brief = briefBody([contentItem('RAW_a', { title: 'content a' })]);
  let posts = 0;
  const { baseUrl } = await serve(t, (request) => {
    if (request.method !== 'POST') return { body: brief };
    posts += 1;
    return { status: 500, body: 'detail service down' };
  });

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));
  assert.equal(posts, 2, 'one retry');
  assert.equal(outcome.items.length, 1);
  assert.equal(outcome.items[0]?.title, 'content a');
  assert.equal(outcome.items[0]?.url, 'https://www.bestblogs.dev/article/a');
  assert.equal(outcome.items[0]?.extra.cover, '');
  assert.equal(outcome.items[0]?.extra.score, 80, 'score falls back to the content item total');
  assert.deepEqual(outcome.items[0]?.extra.tags, []);
  assert.equal(outcome.meta?.detailStatus, 'degraded');
});

test('a batch-meta parse failure is retried once and can recover', async (t) => {
  const brief = briefBody([contentItem('RAW_a')]);
  let posts = 0;
  const { baseUrl } = await serve(t, (request) => {
    if (request.method !== 'POST') return { body: brief };
    posts += 1;
    return posts === 1 ? { body: '{"data":"not an array"}' } : { body: metaBody([detailItem('RAW_a')]) };
  });

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));
  assert.equal(posts, 2);
  assert.equal(outcome.meta?.detailStatus, 'ok');
  assert.equal(outcome.items[0]?.title, 'detail title RAW_a');
});

test('a detail item missing from batch-meta uses content fallbacks and degrades', async (t) => {
  const brief = briefBody([contentItem('RAW_a'), contentItem('RAW_b'), contentItem('RAW_c')]);
  const { baseUrl } = await serve(t, (request) => {
    if (request.method !== 'POST') return { body: brief };
    return { body: metaBody([detailItem('RAW_a'), detailItem('RAW_b')]) };
  });

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));
  assert.equal(outcome.items.length, 3);
  assert.equal(outcome.items[2]?.title, 'content title RAW_c');
  assert.equal(outcome.items[2]?.description, 'match reason RAW_c');
  assert.equal(outcome.meta?.detailStatus, 'degraded');
});

test('content items without a resourceId are dropped and counted', async (t) => {
  const brief = briefBody([contentItem('RAW_a'), contentItem(undefined, { title: 'no id' }), contentItem('RAW_c')]);
  const { baseUrl, requests } = await serve(t, (request) => {
    if (request.method !== 'POST') return { body: brief };
    return { body: metaBody([detailItem('RAW_a'), detailItem('RAW_c')]) };
  });

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));
  assert.deepEqual(
    outcome.items.map((item) => item.naturalKey),
    ['RAW_a', 'RAW_c'],
  );
  assert.equal(outcome.meta?.dropped, 1);
  assert.deepEqual(JSON.parse(requests[1]?.body ?? '{}'), { ids: ['RAW_a', 'RAW_c'], uiLang: 'zh' });
});

test('a brief whose every item lacks a resourceId is drift', async (t) => {
  const { baseUrl } = await serve(t, () => ({ body: briefBody([contentItem(undefined), contentItem(undefined)]) }));

  await assert.rejects(createAdapter({ baseUrl }).fetch(context()), (error: unknown) => {
    assert.ok(error instanceof SourceFetchError);
    assert.equal(error.kind, 'drift');
    return true;
  });
});

test('a synthetic 50-item brief is mapped without truncation', async (t) => {
  const ids = Array.from({ length: 50 }, (_, index) => `RAW_${index.toString().padStart(2, '0')}`);
  const brief = briefBody(ids.map((id) => contentItem(id)));
  const meta = metaBody(ids.map((id) => detailItem(id)));
  const { baseUrl, requests } = await serve(t, (request) => ({ body: request.method === 'POST' ? meta : brief }));

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context()));
  assert.equal(outcome.items.length, 50);
  assert.deepEqual(
    outcome.items.map((item) => item.naturalKey),
    ids,
  );
  assert.equal(outcome.items[49]?.naturalKey, 'RAW_49');
  assert.equal(outcome.meta?.detailStatus, 'ok');
  assert.equal(JSON.parse(requests[1]?.body ?? '{}').ids.length, 50);
});

test('locale en is sent to both requests and changes the edition', async (t) => {
  const meta = await readFile(META, 'utf8');
  const brief = await readFile(BRIEF, 'utf8');
  const { baseUrl, requests } = await serve(t, (request) => ({
    body: request.method === 'POST' ? meta : brief,
  }));

  const outcome = expectOk(await createAdapter({ baseUrl }).fetch(context(DAY, DAY, 'en')));
  assert.equal(outcome.meta?.locale, 'en');
  assert.equal(requests[0]?.url, `/api/proxy/briefs/public/${DAY}?locale=en`);
  assert.deepEqual(JSON.parse(requests[1]?.body ?? '{}'), {
    ids: ['RAW_39abcb5f7e', 'RAW_b8ba16a568', 'RAW_fa387eaa0'],
    uiLang: 'en',
  });
});
