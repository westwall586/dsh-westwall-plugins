import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, ItemRecord, RawItem } from '../src/contract/types.ts';
import { runFetch } from '../src/engine/fetch.ts';
import { createFeedUltraService, type FeedUltraService } from '../src/service/index.ts';
import type { FeedUltraConfig } from '../src/settings.ts';
import type { SourceRuntime } from '../src/sources/registry.ts';
import { readDayCache } from '../src/store/cache.ts';
import { writeDayItems } from '../src/store/day.ts';
import { layout, type Layout } from '../src/store/paths.ts';
import type { LlmCallOptions, LlmTranslateService } from '../src/translate/model.ts';

const TODAY = '2026-11-10';
const START = new Date(2026, 10, 10, 12, 0, 0);

type Reply = { text: string; delayMs?: number } | { fail: string };

interface FakeLlm {
  llm: LlmTranslateService;
  calls: LlmCallOptions[];
}

interface Harness {
  root: string;
  canonical: string;
  config: FeedUltraConfig;
  clock: { now: Date };
  service: FeedUltraService;
  calls: LlmCallOptions[];
}

function userPayload(options: LlmCallOptions): { items: Array<{ key: string; text: string }> } {
  const user = options.messages.find((message) => message.role === 'user');
  assert.ok(user);
  return JSON.parse(user.content[0]?.text ?? '') as { items: Array<{ key: string; text: string }> };
}

function translateReply(options: LlmCallOptions): Reply {
  return {
    text: JSON.stringify(userPayload(options).items.map(({ key, text }) => ({ key, zh: `zh:${text}` }))),
  };
}

function fakeLlm(handler: (options: LlmCallOptions) => Reply = translateReply): FakeLlm {
  const calls: LlmCallOptions[] = [];
  const llm: LlmTranslateService = {
    async *stream(options) {
      calls.push(options);
      const reply = handler(options);
      if ('fail' in reply) throw new Error(reply.fail);
      if (reply.delayMs !== undefined) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, reply.delayMs);
          if (options.signal?.aborted) {
            clearTimeout(timer);
            reject(new Error('aborted'));
            return;
          }
          options.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
      }
      yield { type: 'text-delta', text: reply.text };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };
  return { llm, calls };
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

function runtime(id: string, items: () => RawItem[]): SourceRuntime {
  return {
    descriptor: { id, name: id, type: id },
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
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

function item(sourceId: string, naturalKey: string, description: string, day = TODAY): ItemRecord {
  const at = `${day}T08:00:00Z`;
  return {
    id: composeItemId(sourceId, naturalKey),
    naturalKey,
    title: naturalKey,
    description,
    url: `https://github.com/${naturalKey}`,
    publishedAt: at,
    dayKey: day,
    firstSeenAt: at,
    lastSeenAt: at,
    extra: {},
  };
}

function fact(sourceId: string, day: string, items: readonly ItemRecord[]): FactFile {
  const at = `${day}T08:00:00Z`;
  return {
    version: CONTRACT_VERSION,
    source: { id: sourceId, name: sourceId, type: sourceId },
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    items: [...items],
  };
}

async function setup(
  t: TestContext,
  options: {
    sources?: SourceRuntime[];
    llm?: LlmTranslateService | null;
    budgetMs?: number;
    translationEnabled?: boolean;
  } = {},
): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-translate-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const clock = { now: new Date(START) };
  const config: FeedUltraConfig = {
    workspacePath: '',
    retentionDays: 30,
    sources:
      options.translationEnabled === false
        ? {
            test_source: {
              scheduleEnabled: true,
              scheduleAt: '08:00',
              translationEnabled: false,
              locale: 'zh',
              batchSize: 3,
              egoBrowserPath: '',
            },
          }
        : {},
    model: null,
    autoFetch: true,
  };

  const sources: Record<string, SourceRuntime> = {};
  for (const source of options.sources ?? [runtime('test_source', () => rawItems(['alpha', 'beta']))]) {
    sources[source.descriptor.id] = source;
  }

  const fake = fakeLlm();
  const service = createFeedUltraService({
    config: () => ({ ...config }),
    sources,
    now: () => new Date(clock.now),
    runFetch,
    llm: options.llm === undefined ? () => fake.llm : () => options.llm ?? null,
    readDefault: () => ({ provider: 'fake', model: 'fake-model' }),
    budgetMs: options.budgetMs,
  });

  const bound = await service.bindWorkspace(root);
  config.workspacePath = bound.workspace.path;

  return {
    root,
    canonical: await realpath(root),
    config,
    clock,
    service,
    calls: fake.calls,
  };
}

async function seed(h: Harness, sourceId: string, items: readonly ItemRecord[], day = TODAY): Promise<void> {
  await writeDayItems(layout(h.canonical), fact(sourceId, day, items));
}

function layoutOf(h: Harness): Layout {
  return layout(h.canonical);
}

test('manual translate fills the day view and clears missing', async (t) => {
  const h = await setup(t);
  const items = [item('test_source', 'a/one', 'first description'), item('test_source', 'a/two', 'second description')];
  await seed(h, 'test_source', items);

  const result = await h.service.translate('test_source', TODAY);
  assert.deepEqual(result, {
    sourceId: 'test_source',
    day: TODAY,
    translated: 2,
    skipped: 0,
    failed: 0,
    error: '',
  });
  assert.equal(result.translated + result.skipped + result.failed, items.length);

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.translation.missing, 0);
  assert.equal(view.sections[0]?.items[0]?.descriptionTranslated, 'zh:first description');
  assert.equal(view.sections[0]?.items[0]?.descriptionLang, 'zh-CN');

  const sources = await h.service.sources();
  assert.equal(sources.sources[0]?.translation.missing, 0);
  assert.equal(sources.sources[0]?.translation.error, '');
});

test('fetch lands the snapshot and waits for translation', async (t) => {
  const h = await setup(t);

  const result = await h.service.fetch('test_source');
  assert.equal(result.status, 'ok');
  assert.equal(result.count, 2);
  assert.equal(result.translated, 2);
  assert.equal(result.translationError, '');

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.status, 'ok');
  assert.equal(view.sections[0]?.items.length, 2);
  assert.equal(view.sections[0]?.items[0]?.descriptionTranslated, 'zh:alpha description');
  const cache = await readDayCache(layoutOf(h), TODAY);
  assert.equal(Object.keys(cache.items).length, 2);
});

test('a translation failure never fails the fetch', async (t) => {
  const h = await setup(t, { llm: null });

  const result = await h.service.fetch('test_source');
  assert.equal(result.status, 'ok');
  assert.equal(result.count, 2);
  assert.equal(result.translated, 0);
  assert.notEqual(result.translationError, '');

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.status, 'ok');
  assert.equal(view.sections[0]?.translation.missing, 2);
  assert.notEqual(view.sections[0]?.translation.error, '');
  assert.equal(view.sections[0]?.items[0]?.descriptionTranslated, undefined);
});

test('a day of Chinese descriptions never leaves the translate button stuck', async (t) => {
  const h = await setup(t);
  await seed(h, 'test_source', [
    item('test_source', 'a/one', '这是一个中文简介，介绍一个股票分析工具。'),
    item('test_source', 'a/two', '另一个中文简介，同样不需要翻译。'),
  ]);

  const result = await h.service.translate('test_source', TODAY);
  assert.equal(result.translated, 0);
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.error, '');
  assert.equal(h.calls.length, 0);

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.translation.missing, 0);
  assert.equal((await h.service.sources()).sources[0]?.translation.missing, 0);
});

test('translation disabled on the channel skips the model and the fields stay clean', async (t) => {
  const h = await setup(t, { translationEnabled: false });

  const result = await h.service.fetch('test_source');
  assert.equal(result.status, 'ok');
  assert.equal(result.translated, 0);
  assert.equal(result.translationError, '');
  assert.equal(h.calls.length, 0);

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.translation.enabled, false);
  assert.equal(view.sections[0]?.translation.missing, 2);
  assert.equal(view.sections[0]?.items[0]?.descriptionTranslated, undefined);
});

test('a translate queued past its deadline makes no model call and no write', async (t) => {
  const calls: LlmCallOptions[] = [];
  const lateFailure: LlmTranslateService = {
    async *stream(options) {
      calls.push(options);
      await new Promise((resolve) => setTimeout(resolve, 100));
      throw new Error('late model failure');
    },
  };
  const h = await setup(t, { budgetMs: 20, llm: lateFailure });
  await seed(h, 'test_source', [item('test_source', 'a/one', 'first description')]);

  const first = h.service.translate('test_source', TODAY);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = h.service.translate('test_source', TODAY);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls.length, 1);
  assert.equal(firstResult.error.includes('超时'), true);
  assert.equal(secondResult.translated, 0);
  assert.equal(secondResult.error.includes('超时'), true);
  const cache = await readDayCache(layoutOf(h), TODAY);
  assert.equal(Object.keys(cache.items).length, 0);
});

test('two sources translating the same day leave both record sets on disk', async (t) => {
  const h = await setup(t, {
    sources: [
      runtime('source_a', () => rawItems(['alpha'])),
      runtime('source_b', () => rawItems(['beta'])),
    ],
  });
  const a = item('source_a', 'a/alpha', 'alpha description');
  const b = item('source_b', 'b/beta', 'beta description');
  await seed(h, 'source_a', [a]);
  await seed(h, 'source_b', [b]);

  const [resultA, resultB] = await Promise.all([
    h.service.translate('source_a', TODAY),
    h.service.translate('source_b', TODAY),
  ]);
  assert.equal(resultA.failed, 0);
  assert.equal(resultB.failed, 0);
  assert.equal(h.calls.length, 2);

  const cache = await readDayCache(layoutOf(h), TODAY);
  assert.equal(cache.items[a.id]?.text, 'zh:alpha description');
  assert.equal(cache.items[b.id]?.text, 'zh:beta description');

  const view = await h.service.day(TODAY);
  assert.equal(view.sections[0]?.items[0]?.descriptionTranslated, 'zh:alpha description');
  assert.equal(view.sections[1]?.items[0]?.descriptionTranslated, 'zh:beta description');
});

test('translate rejects unknown sources, malformed days and future days; a missing snapshot is a no-op', async (t) => {
  const h = await setup(t);

  await assert.rejects(h.service.translate('nope', TODAY), (error: unknown) => {
    return error instanceof Error && error.name === 'FeedUltraError';
  });
  await assert.rejects(h.service.translate('test_source', 'not-a-day'), (error: unknown) => {
    return error instanceof Error && error.name === 'FeedUltraError';
  });
  await assert.rejects(h.service.translate('test_source', '2026-11-11'), (error: unknown) => {
    return error instanceof Error && error.name === 'FeedUltraError';
  });

  const empty = await h.service.translate('test_source', '2026-11-09');
  assert.deepEqual(empty, { sourceId: 'test_source', day: '2026-11-09', translated: 0, skipped: 0, failed: 0, error: '' });
});
