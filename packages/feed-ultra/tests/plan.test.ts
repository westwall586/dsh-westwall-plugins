import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import type { ItemRecord, TranslationRecord } from '../src/contract/types.ts';
import { descriptionHash, emptyDayCache, withRecords } from '../src/store/cache.ts';
import { MAX_BATCH, MAX_TEXT } from '../src/translate/prompt.ts';
import { chunk, displayTranslations, planTranslations } from '../src/translate/plan.ts';

const DAY = '2026-11-10';

function item(naturalKey: string, description: string): ItemRecord {
  const at = `${DAY}T08:00:00Z`;
  return {
    id: composeItemId('github_trending', naturalKey),
    naturalKey,
    title: naturalKey,
    description,
    url: `https://github.com/${naturalKey}`,
    publishedAt: at,
    dayKey: DAY,
    firstSeenAt: at,
    lastSeenAt: at,
    extra: {},
  };
}

function record(description: string): TranslationRecord {
  return {
    hash: descriptionHash(description),
    lang: 'zh-CN',
    text: `zh:${description}`,
    model: 'fake/model',
    promptVersion: 'feedUltra.translate.v1',
    at: `${DAY}T09:00:00Z`,
  };
}

test('the Chinese skip runs before the cache and never counts as missing', () => {
  const items = [
    item('a/one', '这是一个中文简介，介绍一个股票分析工具。'),
    item('a/two', '另一个中文简介，同样不需要翻译。'),
  ];
  const plan = planTranslations(emptyDayCache(DAY), items);
  assert.equal(plan.missing, 0);
  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.units, []);
});

test('an empty description is skipped and never becomes a paid request', () => {
  const plan = planTranslations(emptyDayCache(DAY), [item('a/one', '   ')]);
  assert.equal(plan.missing, 0);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.units, []);
});

test('a valid cached record is skipped; a stale one is not', () => {
  const fresh = item('a/one', 'hello');
  const stale = item('a/two', 'hello again');
  const cache = withRecords(emptyDayCache(DAY), [
    [fresh.id, record('hello')],
    [stale.id, record('hello')],
  ]);

  const plan = planTranslations(cache, [fresh, stale]);
  assert.equal(plan.skipped, 1);
  assert.equal(plan.missing, 1);
  assert.deepEqual(
    plan.units.map((unit) => unit.key),
    ['a/two'],
  );
});

test('two rows with one description fold into one unit with two ids', () => {
  const primary = item('a/one', 'same description');
  const alias = item('a/two', 'same description');
  const plan = planTranslations(emptyDayCache(DAY), [primary, alias]);

  assert.equal(plan.missing, 2);
  assert.equal(plan.units.length, 1);
  assert.deepEqual(plan.units[0]?.itemIds, [primary.id, alias.id]);
  assert.equal(plan.units[0]?.key, 'a/one');
});

test('the hash is of the untruncated description; only the request text is clamped', () => {
  const prefix = 'x'.repeat(MAX_TEXT);
  const first = item('a/one', `${prefix} tail-one`);
  const second = item('a/two', `${prefix} tail-two`);
  const plan = planTranslations(emptyDayCache(DAY), [first, second]);

  assert.equal(plan.units.length, 2);
  for (const unit of plan.units) assert.equal([...unit.text].length, MAX_TEXT);
  assert.notEqual(plan.units[0]?.hash, plan.units[1]?.hash);
});

test('display uses only a record whose hash matches the current description', () => {
  const fresh = item('a/one', 'hello');
  const stale = item('a/two', 'hello again');
  const cache = withRecords(emptyDayCache(DAY), [
    [fresh.id, record('hello')],
    [stale.id, record('hello')],
  ]);

  const texts = displayTranslations(cache, [fresh, stale]);
  assert.deepEqual([...texts.entries()], [[fresh.id, 'zh:hello']]);
});

test('a batch is capped at 20 units, serially ordered', () => {
  const items = Array.from({ length: 21 }, (_, index) => item(`a/${index}`, `description ${index}`));
  const batches = chunk(planTranslations(emptyDayCache(DAY), items).units, MAX_BATCH);

  assert.equal(MAX_BATCH, 20);
  assert.equal(batches.length, 2);
  assert.equal(batches[0]?.length, 20);
  assert.equal(batches[1]?.length, 1);
});
