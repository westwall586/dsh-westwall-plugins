import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { ItemRecord, TranslationRecord } from '../src/contract/types.ts';
import { writeJsonAtomic } from '../src/store/atomic.ts';
import {
  descriptionHash,
  emptyDayCache,
  readDayCache,
  readWindowCache,
  validRecord,
  withRecords,
  writeDayCache,
} from '../src/store/cache.ts';
import { cacheFile, layout, type Layout } from '../src/store/paths.ts';

const DAY = '2026-11-10';

async function workspace(t: TestContext): Promise<Layout> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return layout(root);
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

function record(description: string): TranslationRecord {
  return {
    hash: descriptionHash(description),
    lang: 'zh-CN',
    text: `zh:${description}`,
    model: 'fake/model',
    promptVersion: 'feedUltra.translate.v1',
    at: '2026-11-10T09:00:00Z',
  };
}

test('round-trips a day cache through the contract schema', async (t) => {
  const l = await workspace(t);
  const cache = withRecords(emptyDayCache(DAY), [[item('a/b', 'hello').id, record('hello')]]);
  await writeDayCache(l, cache);
  assert.deepEqual(await readDayCache(l, DAY), cache);
});

test('a record from the pre-translation cache is dropped, not the whole file', async (t) => {
  const l = await workspace(t);
  const good = record('hello');
  await writeJsonAtomic(cacheFile(l, DAY), {
    version: CONTRACT_VERSION,
    day: DAY,
    items: { keeping: good, legacy: {} },
  });

  const cache = await readDayCache(l, DAY);
  assert.deepEqual(cache.items, { keeping: good });
});

test('corrupt JSON and a wrong envelope degrade to an empty day', async (t) => {
  const l = await workspace(t);
  await mkdir(path.dirname(cacheFile(l, DAY)), { recursive: true });
  await writeFile(cacheFile(l, DAY), '{ not json', 'utf8');
  assert.deepEqual(await readDayCache(l, DAY), emptyDayCache(DAY));

  await writeJsonAtomic(cacheFile(l, DAY), { version: CONTRACT_VERSION, day: '2026-11-09', items: {} });
  assert.deepEqual(await readDayCache(l, DAY), emptyDayCache(DAY));

  const window = await readWindowCache(l, [DAY]);
  assert.deepEqual(window.unreadable, [DAY]);
});

test('one bad record does not cost the other records', async (t) => {
  const l = await workspace(t);
  const good = record('hello');
  await writeJsonAtomic(cacheFile(l, DAY), {
    version: CONTRACT_VERSION,
    day: DAY,
    items: { good, bad: { hash: 'x', lang: 'zh-CN', text: 42 } },
  });

  assert.deepEqual((await readDayCache(l, DAY)).items, { good });
});

test('a changed description invalidates the record without touching the cache', async (t) => {
  const l = await workspace(t);
  const before = item('a/b', 'hello');
  await writeDayCache(l, withRecords(emptyDayCache(DAY), [[before.id, record('hello')]]));
  const cache = await readDayCache(l, DAY);

  assert.equal(validRecord(cache, before)?.text, 'zh:hello');
  assert.equal(validRecord(cache, item('a/b', 'hello again')), null);
  assert.equal(validRecord(cache, item('a/c', 'hello')), null);
});

test('withRecords is a pure merge and later entries win', async (t) => {
  const l = await workspace(t);
  const first = emptyDayCache(DAY);
  const id = item('a/b', 'hello').id;
  const merged = withRecords(first, [[id, record('hello')]]);

  assert.deepEqual(first.items, {});
  assert.equal(merged.items[id]?.text, 'zh:hello');
  const overwritten = withRecords(merged, [[id, record('hello')]]);
  assert.notEqual(overwritten, merged);
});

test('atomic writes leave no temp file behind', async (t) => {
  const l = await workspace(t);
  await writeDayCache(l, withRecords(emptyDayCache(DAY), [[item('a/b', 'hello').id, record('hello')]]));
  const names = await readdir(l.root, { recursive: true });
  assert.deepEqual(names.filter((name) => name.endsWith('.tmp')), []);
});

test('the hash trims outer whitespace and never collapses a truncated prefix', () => {
  assert.equal(descriptionHash('  hello \n'), descriptionHash('hello'));
  assert.notEqual(descriptionHash('hello there'), descriptionHash('hello'));

  const prefix = 'x'.repeat(400);
  assert.notEqual(descriptionHash(`${prefix} one`), descriptionHash(`${prefix} two`));
});
