import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, ItemRecord, ModelChoice, TranslationRecord } from '../src/contract/types.ts';
import { readDayItems, writeDayItems } from '../src/store/day.ts';
import { layout, type Layout } from '../src/store/paths.ts';
import {
  descriptionHash,
  emptyDayCache,
  readDayCache,
  withRecords,
  writeDayCache,
} from '../src/store/cache.ts';
import { startBudget, type Budget } from '../src/translate/budget.ts';
import { translateDay, type TranslateDayResult } from '../src/translate/engine.ts';
import {
  resolveModelChoice,
  type LlmCallOptions,
  type LlmTranslateService,
} from '../src/translate/model.ts';
import { displayTranslations, planTranslations } from '../src/translate/plan.ts';
import { SYSTEM_PROMPT } from '../src/translate/prompt.ts';

const DAY = '2026-11-10';
const YESTERDAY = '2026-11-09';
const MODEL: ModelChoice = { provider: 'fake', model: 'fake-model' };

type Reply = { text: string; delayMs?: number } | { fail: string };

interface FakeLlm {
  llm: LlmTranslateService;
  calls: LlmCallOptions[];
}

function item(naturalKey: string, description: string, day = DAY): ItemRecord {
  const at = `${day}T08:00:00Z`;
  return {
    id: composeItemId('github_trending', naturalKey),
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

function record(description: string, text = `zh:${description}`, at = `${YESTERDAY}T09:00:00Z`): TranslationRecord {
  return {
    hash: descriptionHash(description),
    lang: 'zh-CN',
    text,
    model: 'fake/old-model',
    promptVersion: 'feedUltra.translate.v1',
    at,
  };
}

function userPayload(options: LlmCallOptions): { items: Array<{ key: string; text: string }> } {
  const user = options.messages.find((message) => message.role === 'user');
  assert.ok(user);
  // A retry appends the corrective instruction after the JSON payload.
  const [jsonPayload] = (user.content[0]?.text ?? '').split('\n\n');
  return JSON.parse(jsonPayload ?? '') as { items: Array<{ key: string; text: string }> };
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

async function workspace(t: TestContext): Promise<Layout> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return layout(root);
}

async function runTranslate(input: {
  l: Layout;
  day: string;
  today: string;
  items: readonly ItemRecord[];
  llm: LlmTranslateService | null;
  model?: ModelChoice | null;
  readDefault?: () => ModelChoice | null;
  budgetMs?: number;
  budget?: Budget;
}): Promise<TranslateDayResult> {
  // A supplied budget lets a test expire it from inside the model call instead of
  // racing a wall-clock timer that can fire before the first call even starts.
  const owned = input.budget === undefined;
  const budget = input.budget ?? startBudget(input.budgetMs ?? 10_000);
  try {
    return await translateDay({
      l: input.l,
      day: input.day,
      today: input.today,
      items: input.items,
      retentionDays: 30,
      llm: input.llm,
      model: input.model === undefined ? MODEL : input.model,
      readDefault: input.readDefault ?? (() => null),
      now: () => new Date(`${DAY}T12:00:00Z`),
      budget,
    });
  } finally {
    if (owned) budget.dispose();
  }
}

async function assertInvariant(
  l: Layout,
  day: string,
  items: readonly ItemRecord[],
  result: TranslateDayResult,
): Promise<void> {
  assert.equal(
    result.outcome.translated + result.outcome.skipped + result.outcome.failed,
    items.length,
    'translated + skipped + failed equals the day total',
  );
  const cache = await readDayCache(l, day);
  assert.equal(result.outcome.failed, planTranslations(cache, items).missing, 'failed equals missing after the run');
}

function fact(items: readonly ItemRecord[], day = DAY): FactFile {
  const at = `${day}T08:00:00Z`;
  return {
    version: CONTRACT_VERSION,
    source: { id: 'github_trending', name: 'GitHub Trending', type: 'github-trending' },
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    items: [...items],
  };
}

test('an unchanged description on the next day makes zero model calls', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'same description'), item('a/two', 'another description')];
  await writeDayCache(
    l,
    withRecords(
      emptyDayCache(YESTERDAY),
      items.map((entry) => [entry.id, record(entry.description)] as const),
    ),
  );
  const { llm, calls } = fakeLlm();

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 0);
  assert.equal(result.outcome.translated, 0);
  assert.equal(result.outcome.skipped, 2);
  assert.equal(result.outcome.failed, 0);
  assert.equal(result.outcome.failure, null);
  const cache = await readDayCache(l, DAY);
  assert.equal(cache.items[items[0]?.id ?? '']?.text, 'zh:same description');
  await assertInvariant(l, DAY, items, result);
});

test('a changed description pays once and the old record is not displayed', async (t) => {
  const l = await workspace(t);
  const oldItem = item('a/one', 'old description', YESTERDAY);
  await writeDayCache(l, withRecords(emptyDayCache(YESTERDAY), [[oldItem.id, record('old description')]]));
  const changed = item('a/one', 'new description');
  const { llm, calls } = fakeLlm();

  const result = await runTranslate({ l, day: DAY, today: DAY, items: [changed], llm });

  assert.equal(calls.length, 1);
  assert.equal(result.outcome.translated, 1);
  assert.equal(result.outcome.failed, 0);
  const yesterdayCache = await readDayCache(l, YESTERDAY);
  assert.equal(displayTranslations(yesterdayCache, [changed]).size, 0);
  const today = await readDayCache(l, DAY);
  assert.equal(today.items[changed.id]?.hash, descriptionHash('new description'));
  assert.equal(today.items[changed.id]?.text, 'zh:new description');
  await assertInvariant(l, DAY, [changed], result);
});

test('a day of Chinese descriptions reports missing 0 and makes no model call', async (t) => {
  const l = await workspace(t);
  const items = [
    item('a/one', '这是一个中文简介，介绍一个股票分析工具。'),
    item('a/two', '另一个中文简介，同样不需要翻译。'),
  ];
  const { llm, calls } = fakeLlm();

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 0);
  assert.equal(result.outcome.translated, 0);
  assert.equal(result.outcome.skipped, 2);
  assert.equal(result.outcome.failed, 0);
  assert.equal(planTranslations(await readDayCache(l, DAY), items).missing, 0);
  await assertInvariant(l, DAY, items, result);
});

test('a mixed-language row is translated because it is not Chinese', async (t) => {
  const l = await workspace(t);
  const mixed = item(
    'a/one',
    '股票分析工具 stock analysis for A-share, Hong Kong and US markets. '.repeat(4),
  );
  const { llm, calls } = fakeLlm();

  const result = await runTranslate({ l, day: DAY, today: DAY, items: [mixed], llm });

  assert.equal(calls.length, 1);
  assert.equal(result.outcome.translated, 1);
  assert.equal(result.outcome.skipped, 0);
  await assertInvariant(l, DAY, [mixed], result);
});

test('a missing key falls back while an extra key is ignored', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description'), item('a/two', 'second description')];
  const key = items[0]?.naturalKey ?? '';
  const { llm, calls } = fakeLlm(() => ({
    text: JSON.stringify([
      { key, zh: 'zh:first description' },
      { key: 'extra/repo', zh: 'should never land' },
    ]),
  }));

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 1);
  assert.equal(result.outcome.translated, 1);
  assert.equal(result.outcome.failed, 1);
  assert.equal(result.outcome.failure, null);
  const cache = await readDayCache(l, DAY);
  assert.equal(cache.items[items[0]?.id ?? '']?.text, 'zh:first description');
  assert.equal(Object.keys(cache.items).length, 1);
  await assertInvariant(l, DAY, items, result);
});

test('invalid JSON retries exactly once and succeeds on the second reply', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description'), item('a/two', 'second description')];
  let call = 0;
  const { llm, calls } = fakeLlm((options) => {
    call += 1;
    return call === 1 ? { text: 'not json' } : translateReply(options);
  });

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 2);
  assert.equal(result.outcome.translated, 2);
  assert.equal(result.outcome.failed, 0);
  assert.equal(result.outcome.failure, null);
  await assertInvariant(l, DAY, items, result);
});

test('the retry after an unusable reply carries the first parse error in a different user payload', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description'), item('a/two', 'second description')];
  let call = 0;
  const { llm, calls } = fakeLlm((options) => {
    call += 1;
    return call === 1 ? { text: 'not json' } : translateReply(options);
  });

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 2);
  assert.equal(result.outcome.translated, 2);
  assert.equal(result.outcome.failed, 0);
  assert.equal(result.outcome.failure, null);

  const first = calls[0]?.messages[0]?.content[0]?.text;
  const second = calls[1]?.messages[0]?.content[0]?.text;
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.ok(second.includes('no JSON array in the response'), 'the retry carries the first parse error');
  await assertInvariant(l, DAY, items, result);
});

test('two invalid replies abandon the batch, keep the originals, and report an error', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description'), item('a/two', 'second description')];
  const { llm, calls } = fakeLlm(() => ({ text: 'not json' }));

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 2);
  assert.equal(result.outcome.translated, 0);
  assert.equal(result.outcome.failed, 2);
  assert.equal(result.outcome.failure?.stage, 'parse');
  assert.notEqual(result.outcome.failure?.error, '');
  assert.equal(displayTranslations(await readDayCache(l, DAY), items).size, 0);
  await assertInvariant(l, DAY, items, result);
});

test('a model failure is data: the batch fails and the run does not throw', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description')];
  const { llm, calls } = fakeLlm(() => ({ fail: 'provider is down' }));

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 1);
  assert.equal(result.outcome.translated, 0);
  assert.equal(result.outcome.failed, 1);
  assert.equal(result.outcome.failure?.stage, 'call');
  assert.match(result.outcome.failure?.error ?? '', /provider is down/);
  await assertInvariant(l, DAY, items, result);
});

test('a budget that expires during the call leaves the snapshot and cache unchanged', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description'), item('a/two', 'second description')];
  const written = fact(items);
  await writeDayItems(l, written);
  // A wall-clock budget of a few milliseconds can expire before the first call even
  // starts under load, which tests the wrong branch. Expire it from inside the call.
  const controller = new AbortController();
  let expired = false;
  const budget = {
    signal: controller.signal,
    get timedOut() { return expired; },
    dispose() {},
  };
  const { llm, calls } = fakeLlm(() => {
    expired = true;
    controller.abort();
    return { text: '', delayMs: 100 };
  });

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm, budget });

  assert.equal(calls.length, 1);
  assert.equal(result.outcome.translated, 0);
  assert.equal(result.outcome.failed, 2);
  assert.equal(result.outcome.failure?.stage, 'call');
  assert.match(result.outcome.failure?.error ?? '', /超时/);
  assert.deepEqual(await readDayItems(l, DAY, 'github_trending'), written);
  assert.equal(displayTranslations(await readDayCache(l, DAY), items).size, 0);
  await assertInvariant(l, DAY, items, result);
});

test('a timeout on the second batch keeps the first batch on disk', async (t) => {
  const l = await workspace(t);
  const items = Array.from({ length: 21 }, (_, index) => item(`a/${index}`, `description ${index}`));
  let call = 0;
  const { llm } = fakeLlm((options) => {
    call += 1;
    return call === 1 ? translateReply(options) : { text: '', delayMs: 100 };
  });

  // The first batch must finish well inside the budget; the second one then blocks
  // long enough that the deadline lands during its call.
  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm, budgetMs: 80 });

  assert.equal(call, 2);
  assert.equal(result.outcome.translated, 20);
  assert.equal(result.outcome.failed, 1);
  assert.equal(result.outcome.failure?.stage, 'call');
  const cache = await readDayCache(l, DAY);
  assert.equal(Object.keys(cache.items).length, 20);
  await assertInvariant(l, DAY, items, result);
});

test('a cross-day reuse-only run writes the record with no model call', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'same description')];
  await writeDayCache(l, withRecords(emptyDayCache(YESTERDAY), [[items[0]?.id ?? '', record('same description')]]));
  const { llm, calls } = fakeLlm();

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm });

  assert.equal(calls.length, 0);
  assert.equal(result.outcome.reached, 'commit');
  const cache = await readDayCache(l, DAY);
  assert.equal(cache.items[items[0]?.id ?? '']?.at, `${YESTERDAY}T09:00:00Z`);
  await assertInvariant(l, DAY, items, result);
});

test('model resolution prefers an explicit choice and reports an unreadable default', () => {
  assert.deepEqual(resolveModelChoice(MODEL, () => null), { choice: MODEL });
  assert.deepEqual(resolveModelChoice(null, () => ({ provider: 'p', model: 'm' })), {
    choice: { provider: 'p', model: 'm' },
  });
  assert.equal('error' in resolveModelChoice(null, () => null), true);
  assert.equal(
    'error' in
      resolveModelChoice(null, () => {
        throw new Error('default service down');
      }),
    true,
  );
});

test('an unresolvable model fails before any call and reports stage resolve', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description')];
  const { llm, calls } = fakeLlm();

  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm, model: null, readDefault: () => null });

  assert.equal(calls.length, 0);
  assert.equal(result.outcome.failed, 1);
  assert.equal(result.outcome.failure?.stage, 'resolve');
  await assertInvariant(l, DAY, items, result);
});

test('a run whose budget expired before the gate reports queue and keeps the counters honest', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description'), item('a/two', 'second description')];
  const cached = items[0];
  assert.ok(cached);
  await writeDayCache(l, withRecords(emptyDayCache(DAY), [[cached.id, record('first description')]]));
  const { llm, calls } = fakeLlm();
  const budget = startBudget(0);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const result = await translateDay({
    l,
    day: DAY,
    today: DAY,
    items,
    retentionDays: 30,
    llm,
    model: MODEL,
    readDefault: () => null,
    now: () => new Date(`${DAY}T12:00:00Z`),
    budget,
  });
  budget.dispose();

  assert.equal(calls.length, 0);
  assert.equal(result.outcome.reached, 'queue');
  assert.equal(result.outcome.translated, 0);
  assert.equal(result.outcome.skipped, 1);
  assert.equal(result.outcome.failed, 1);
  assert.equal(result.outcome.failure?.stage, 'queue');
  await assertInvariant(l, DAY, items, result);
});

test('the model request carries the frozen sampling, purpose and system message', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description')];
  const { llm, calls } = fakeLlm();

  await runTranslate({ l, day: DAY, today: DAY, items, llm });

  const options = calls[0];
  assert.ok(options);
  assert.equal(options.provider, 'fake');
  assert.equal(options.model, 'fake-model');
  assert.equal(options.temperature, 0);
  assert.equal(options.maxTokens, 2000);
  assert.equal(options.purpose, 'feedUltra.translate');
  assert.equal(options.reasoningEffort, undefined);
  assert.equal(options.system, SYSTEM_PROMPT);
  assert.equal(options.messages.length, 1);
  const message = options.messages[0];
  assert.ok(message);
  assert.equal(message.role, 'user');
  assert.deepEqual(Object.keys(message).sort(), ['content', 'role']);
  assert.deepEqual(userPayload(options).items, [{ key: 'a/one', text: 'first description' }]);
});

test('a verified result that arrives after the deadline is kept', async (t) => {
  const l = await workspace(t);
  const items = [item('a/one', 'first description')];
  const late: LlmTranslateService = {
    async *stream(options) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const text = JSON.stringify(userPayload(options).items.map(({ key, text: source }) => ({ key, zh: `zh:${source}` })));
      yield { type: 'text-delta', text };
      yield { type: 'finish', reason: { kind: 'stop' } };
    },
  };

  // Expire the deadline from inside the exchange, after the reply is fully assembled:
  // a wall-clock budget shorter than the call can fire before the call even starts,
  // which turns this into "the turn check saw a deadline" rather than "a late reply is kept".
  const budget = startBudget(10_000);
  t.after(() => budget.dispose());
  const result = await runTranslate({ l, day: DAY, today: DAY, items, llm: late, budget });

  assert.equal(result.outcome.translated, 1);
  assert.equal(result.outcome.failed, 0);
  assert.equal(result.outcome.failure, null);
  assert.equal((await readDayCache(l, DAY)).items[items[0]?.id ?? '']?.text, 'zh:first description');
  await assertInvariant(l, DAY, items, result);
});
