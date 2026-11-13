import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBatch } from '../src/translate/response.ts';

test('a bare JSON array is parsed', () => {
  const parsed = parseBatch('[{"key":"a/b","zh":"甲"}]', ['a/b']);
  assert.deepEqual([...parsed.entries.entries()], [['a/b', '甲']]);
  assert.deepEqual(parsed.missingKeys, []);
  assert.equal(parsed.ignored, 0);
  assert.equal(parsed.error, '');
});

test('a fenced reply and a prose prefix are tolerated', () => {
  const fenced = parseBatch('```json\n[{"key":"a/b","zh":"甲"}]\n```', ['a/b']);
  assert.deepEqual([...fenced.entries.entries()], [['a/b', '甲']]);

  const prose = parseBatch('Here is the result:\n[{"key":"a/b","zh":"甲"}]', ['a/b']);
  assert.deepEqual([...prose.entries.entries()], [['a/b', '甲']]);
});

test('a missing key is reported; an extra key is ignored', () => {
  const parsed = parseBatch(
    '[{"key":"a/b","zh":"甲"},{"key":"x/y","zh":"乙"}]',
    ['a/b', 'c/d'],
  );
  assert.deepEqual([...parsed.entries.entries()], [['a/b', '甲']]);
  assert.deepEqual(parsed.missingKeys, ['c/d']);
  assert.equal(parsed.ignored, 1);
  assert.equal(parsed.error, '');
});

test('a duplicate key is last-wins and counted as ignored', () => {
  const parsed = parseBatch(
    '[{"key":"a/b","zh":"甲"},{"key":"a/b","zh":"乙"}]',
    ['a/b'],
  );
  assert.equal(parsed.entries.get('a/b'), '乙');
  assert.equal(parsed.ignored, 1);
});

test('malformed entries are ignored rather than failing the batch', () => {
  const parsed = parseBatch(
    '[{"key":"a/b","zh":"甲"},{"key":1,"zh":"乙"},{"key":"c/d","zh":""},null,"nope"]',
    ['a/b', 'c/d'],
  );
  assert.deepEqual([...parsed.entries.entries()], [['a/b', '甲']]);
  assert.deepEqual(parsed.missingKeys, ['c/d']);
  assert.equal(parsed.ignored, 4);
  assert.equal(parsed.error, '');
});

test('an object envelope with an items array is accepted', () => {
  const parsed = parseBatch('{"items":[{"key":"a/b","zh":"甲"}]}', ['a/b']);
  assert.deepEqual([...parsed.entries.entries()], [['a/b', '甲']]);
});

test('non-JSON and wrong structures are a structural error', () => {
  for (const raw of ['', 'no json at all', '{"items":"nope"}', '{"key":"a/b"}']) {
    const parsed = parseBatch(raw, ['a/b']);
    assert.equal(parsed.entries.size, 0);
    assert.deepEqual(parsed.missingKeys, ['a/b']);
    assert.notEqual(parsed.error, '');
  }
});
