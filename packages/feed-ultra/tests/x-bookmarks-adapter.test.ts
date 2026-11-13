import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FetchContext } from '../src/sources/types.ts';
import { SourceFetchError } from '../src/sources/types.ts';
import {
  createAdapter,
  deleteBookmarkOnX,
  descriptor,
} from '../src/sources/x-bookmarks/index.ts';
import { EgoBridgeError, type RunScriptOptions, type ScriptRun } from '../src/sources/x-bookmarks/bridge.ts';

const NOW = '2026-11-11T06:42:00.000Z';
const TODAY = '2026-11-11';

function entry(id: string, text: string): Record<string, unknown> {
  return {
    entryId: `tweet-${id}`,
    content: {
      itemContent: {
        tweet_results: {
          result: {
            __typename: 'Tweet',
            rest_id: id,
            core: { user_results: { result: { core: { name: 'Author', screen_name: 'author' } } } },
            legacy: {
              id_str: id,
              created_at: 'Tue Nov 10 07:07:00 +0000 2026',
              full_text: text,
              lang: 'zh',
              favorite_count: 1,
              retweet_count: 2,
              reply_count: 3,
              quote_count: 4,
            },
          },
        },
      },
    },
  };
}

function scriptRun(value: unknown): ScriptRun {
  return { value, stages: [], stderr: '', elapsedMs: 1, executable: '/fake/ego-browser', version: 'fake 1' };
}

function context(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    now: NOW,
    day: TODAY,
    today: TODAY,
    locale: 'zh',
    excludeKeys: new Set<string>(),
    batchSize: 3,
    ...overrides,
  };
}

test('the adapter is an accumulate manual channel with the X descriptor', () => {
  const adapter = createAdapter({ run: async () => scriptRun({}) });
  assert.deepEqual(descriptor, { id: 'x_bookmarks', name: 'X Bookmarks', type: 'x-bookmarks' });
  assert.equal(adapter.writeMode, 'accumulate');
  assert.equal(adapter.type, 'x-bookmarks');
});

test('fetch bakes count and exclusions into the script and records lastPull', async () => {
  const calls: RunScriptOptions[] = [];
  const adapter = createAdapter({
    run: async (options) => {
      calls.push(options);
      return scriptRun({
        entries: [entry('1', 'first body'), entry('2', 'second body')],
        scanned: 7,
        exhausted: false,
        truncated: false,
      });
    },
  });
  const logs: string[] = [];

  const outcome = await adapter.fetch(
    context({
      batchSize: 4,
      browserPath: '/opt/ego-browser',
      excludeKeys: new Set(['111', '222']),
      log: (message) => logs.push(message),
    }),
  );

  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.equal(outcome.items.length, 2);
  assert.equal(outcome.items[0]?.naturalKey, '1');
  assert.deepEqual(outcome.meta?.lastPull, {
    at: NOW,
    requested: 4,
    added: 2,
    scanned: 7,
    exhausted: false,
    truncated: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.browserPath, '/opt/ego-browser');
  assert.equal(calls[0]?.timeoutMs, 90_000);
  assert.match(calls[0]?.script ?? '', /"count":4/);
  assert.match(calls[0]?.script ?? '', /"excludeKeys":\["111","222"\]/);
  assert.ok(logs.includes('start'));
  assert.ok(logs.includes('parse'));
  assert.ok(logs.includes('done'));
});

test('a bridge failure keeps its install/auth/timeout kind', async () => {
  for (const kind of ['install', 'auth', 'timeout'] as const) {
    const adapter = createAdapter({
      run: async () => {
        throw new EgoBridgeError(kind, `bridge ${kind}`);
      },
    });
    await assert.rejects(
      adapter.fetch(context()),
      (error: unknown) => error instanceof SourceFetchError && error.kind === kind && error.message === `bridge ${kind}`,
    );
  }
});

test('zero entries are a successful empty pull only when the end was confirmed', async () => {
  const empty = createAdapter({
    run: async () => scriptRun({ entries: [], scanned: 0, exhausted: true, truncated: false }),
  });
  const outcome = await empty.fetch(context());
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.deepEqual(outcome.items, []);
  assert.equal((outcome.meta?.lastPull as Record<string, unknown>).exhausted, true);

  const unresolved = createAdapter({
    run: async () => scriptRun({ entries: [], scanned: 0, exhausted: false, truncated: false }),
  });
  await assert.rejects(
    unresolved.fetch(context()),
    (error: unknown) => error instanceof SourceFetchError && error.kind === 'drift',
  );

  const truncated = createAdapter({
    run: async () => scriptRun({ entries: [], scanned: 1000, exhausted: false, truncated: true }),
  });
  const truncatedOutcome = await truncated.fetch(context());
  assert.equal(truncatedOutcome.status, 'ok');
  if (truncatedOutcome.status !== 'ok') return;
  assert.equal((truncatedOutcome.meta?.lastPull as Record<string, unknown>).truncated, true);
});

test('a batch whose entries are all unreadable is drift', async () => {
  const adapter = createAdapter({
    run: async () => scriptRun({ entries: [{ entryId: 'tweet-1' }], scanned: 1, exhausted: false, truncated: false }),
  });
  await assert.rejects(
    adapter.fetch(context()),
    (error: unknown) => error instanceof SourceFetchError && error.kind === 'drift' && /全部无法解析/.test(error.message),
  );
});

test('deleteBookmarkOnX reports deleted and already outcomes', async () => {
  for (const outcome of ['deleted', 'already'] as const) {
    const result = await deleteBookmarkOnX(
      { url: 'https://x.com/author/status/1' },
      { run: async () => scriptRun({ outcome }) },
    );
    assert.deepEqual(result, { ok: true, alreadyDeleted: outcome === 'already' });
  }
});

test('deleteBookmarkOnX maps a bridge failure to a per-item outcome', async () => {
  const result = await deleteBookmarkOnX(
    { url: 'https://x.com/author/status/1' },
    {
      run: async () => {
        throw new EgoBridgeError('drift', 'no focal article', { evidencePath: '/tmp/evidence.html' });
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    alreadyDeleted: false,
    error: 'no focal article',
    kind: 'drift',
    evidencePath: '/tmp/evidence.html',
  });
});
