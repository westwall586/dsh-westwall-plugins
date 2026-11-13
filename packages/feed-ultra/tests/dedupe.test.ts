import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranslationRecord } from '../src/contract/types.ts';
import type { DayCache } from '../src/store/cache.ts';
import { buildDedupeIndex, lookupByHash } from '../src/translate/dedupe.ts';

function record(hash: string, text: string, at: string): TranslationRecord {
  return { hash, lang: 'zh-CN', text, model: 'fake/model', promptVersion: 'feedUltra.translate.v1', at };
}

function cache(day: string, items: Record<string, TranslationRecord>): DayCache {
  return { day, items };
}

test('the newest day wins for one hash, regardless of input order', () => {
  const older = cache('2026-11-08', { 'a/one': record('h1', 'old', '2026-11-08T09:00:00Z') });
  const newer = cache('2026-11-10', { 'a/two': record('h1', 'new', '2026-11-10T09:00:00Z') });

  const index = buildDedupeIndex({ caches: [newer, older], builtAt: '2026-11-10T12:00:00Z' });
  assert.equal(lookupByHash(index, 'h1')?.text, 'new');
  assert.deepEqual(index.days, ['2026-11-08', '2026-11-10']);
});

test('every record of every partition is indexed, not only the newest per row', () => {
  const day = cache('2026-11-10', {
    'a/one': record('h1', 'one', '2026-11-10T09:00:00Z'),
    'a/two': record('h2', 'two', '2026-11-10T09:00:00Z'),
  });
  const index = buildDedupeIndex({ caches: [day], builtAt: '2026-11-10T12:00:00Z' });

  assert.equal(lookupByHash(index, 'h1')?.text, 'one');
  assert.equal(lookupByHash(index, 'h2')?.text, 'two');
});

test('an unreadable partition is reported; a missing hash is a clean miss', () => {
  const index = buildDedupeIndex({
    caches: [cache('2026-11-10', {})],
    unreadable: ['2026-11-09'],
    builtAt: '2026-11-10T12:00:00Z',
  });

  assert.deepEqual(index.unreadable, ['2026-11-09']);
  assert.equal(lookupByHash(index, 'absent'), null);
});
