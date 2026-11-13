import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLIENT_CONTRIBUTION,
  DESCRIPTORS,
  createApi,
  unwrap,
} from '../client/src/api.mjs';

const ENDPOINTS = [
  { method: 'status', params: [], id: 'dsh-feed-ultra/feedUltra.status' },
  { method: 'bindWorkspace', params: ['path'], id: 'dsh-feed-ultra/feedUltra.bindWorkspace' },
  { method: 'sources', params: [], id: 'dsh-feed-ultra/feedUltra.sources' },
  { method: 'day', params: ['date'], id: 'dsh-feed-ultra/feedUltra.day' },
  { method: 'calendar', params: ['from', 'to'], id: 'dsh-feed-ultra/feedUltra.calendar' },
  { method: 'act', params: ['action', 'ids'], id: 'dsh-feed-ultra/feedUltra.act' },
  { method: 'fetch', params: ['sourceId'], id: 'dsh-feed-ultra/feedUltra.fetch' },
  { method: 'backfill', params: ['sourceId', 'day'], id: 'dsh-feed-ultra/feedUltra.backfill' },
  { method: 'translate', params: ['sourceId', 'day'], id: 'dsh-feed-ultra/feedUltra.translate' },
  { method: 'models', params: [], id: 'dsh-feed-ultra/feedUltra.models' },
  { method: 'modelEfforts', params: ['provider', 'model'], id: 'dsh-feed-ultra/feedUltra.modelEfforts' },
  { method: 'rssLibrary', params: [], id: 'dsh-feed-ultra/feedUltra.rssLibrary' },
  { method: 'rssLibraryMutate', params: ['ops'], id: 'dsh-feed-ultra/feedUltra.rssLibraryMutate' },
  { method: 'rssPreview', params: ['url'], id: 'dsh-feed-ultra/feedUltra.rssPreview' },
];

function assertStrictCodec(codec, label) {
  assert.equal(codec?.mode, 'strict', `${label} has a strict codec`);
  assert.equal(typeof codec.create, 'function', `${label} codec creates a codec instance`);
  const instance = codec.create();
  assert.equal(typeof instance.parse, 'function', `${label} codec instance parses`);
  const value = { probe: true };
  assert.equal(instance.parse(value), value, `${label} codec passes JSON through`);
}

test('registers every direct descriptor in the host SRC order', () => {
  assert.equal(DESCRIPTORS.length, ENDPOINTS.length);
  assert.equal(CLIENT_CONTRIBUTION.package, 'dsh-feed-ultra');
  assert.equal(CLIENT_CONTRIBUTION.descriptors, DESCRIPTORS);

  DESCRIPTORS.forEach((descriptor, index) => {
    const expected = ENDPOINTS[index];
    assert.equal(descriptor.version, 1);
    assert.equal(descriptor.method, expected.method);
    assert.equal(descriptor.id, expected.id);
    assert.equal(descriptor.id.startsWith('dsh-feed-ultra/'), true);
    assert.equal(descriptor.service, 'feedUltra');
    assert.equal(descriptor.namespace, 'feedUltra');
    assert.deepEqual(descriptor.invocation, { kind: 'direct' });
    assert.deepEqual(
      descriptor.parameters.map(parameter => parameter.wire),
      expected.params,
      `${expected.method} wire parameters match the host SRC`,
    );
  });
});

test('every parameter is a required strict JSON field', () => {
  for (const descriptor of DESCRIPTORS) {
    for (const parameter of descriptor.parameters) {
      assert.equal(parameter.name, parameter.wire, `${descriptor.method}.${parameter.name} names its wire field`);
      assert.equal(parameter.source, 'json');
      assert.equal(parameter.optional, undefined, `${descriptor.method}.${parameter.wire} is required`);
      assert.equal(parameter.acceptsUndefined, undefined, `${descriptor.method}.${parameter.wire} is required`);
      assertStrictCodec(parameter.codec, `${descriptor.method}.${parameter.wire}`);
      assert.equal(parameter.codec, descriptor.parameters[0]?.codec);
    }
    assertStrictCodec(descriptor.result, `${descriptor.method} result`);
  }
});

test('unwrap returns values and keeps the host error code', () => {
  assert.equal(unwrap({ ok: true, value: 42 }), 42);

  assert.throws(
    () => unwrap({ ok: false, error: { code: 'feedUltra/invalid-request', message: 'bad date' } }),
    (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.code, 'feedUltra/invalid-request');
      assert.match(error.message, /bad date/);
      return true;
    },
  );
});

test('createApi hands callers values and forwards positional arguments', async () => {
  const calls = [];
  const remote = {
    feedUltra: {
      status: async () => ({ ok: true, value: { today: '2026-11-10' } }),
      day: async (date) => {
        calls.push(['day', date]);
        return { ok: true, value: { date } };
      },
      calendar: async (from, to) => {
        calls.push(['calendar', from, to]);
        return { ok: true, value: { from, to } };
      },
      act: async (action, ids) => {
        calls.push(['act', action, ids]);
        return { ok: true, value: { action, results: ids.map(id => ({ id, status: 'ok' })) } };
      },
      fetch: async (sourceId) => ({
        ok: false,
        error: { code: 'feedUltra/source-unknown', message: `unknown source ${sourceId}` },
      }),
      backfill: async (sourceId, day) => {
        calls.push(['backfill', sourceId, day]);
        return { ok: true, value: { sourceId, day, status: 'ok', count: 3 } };
      },
    },
  };
  const api = createApi(remote.feedUltra);

  assert.deepEqual(await api.status(), { today: '2026-11-10' });
  assert.equal((await api.day('2026-11-09')).date, '2026-11-09');
  assert.deepEqual(await api.calendar('2026-11-01', '2026-11-10'), {
    from: '2026-11-01',
    to: '2026-11-10',
  });
  assert.deepEqual(await api.act('read', ['a', 'b']), {
    action: 'read',
    results: [{ id: 'a', status: 'ok' }, { id: 'b', status: 'ok' }],
  });
  assert.deepEqual(await api.backfill('bestblogs_brief', '2026-10-20'), {
    sourceId: 'bestblogs_brief',
    day: '2026-10-20',
    status: 'ok',
    count: 3,
  });

  await assert.rejects(
    api.fetch('nope'),
    (error) => error instanceof Error
      && error.code === 'feedUltra/source-unknown'
      && /unknown source nope/.test(error.message),
  );

  assert.deepEqual(calls, [
    ['day', '2026-11-09'],
    ['calendar', '2026-11-01', '2026-11-10'],
    ['act', 'read', ['a', 'b']],
    ['backfill', 'bestblogs_brief', '2026-10-20'],
  ]);
});
