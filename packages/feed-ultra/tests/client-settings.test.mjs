import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SETTINGS_NS,
  channelOf,
  createSettingsApi,
  isScheduleAt,
  normalizeBatchSize,
  normalizeModelChoice,
  normalizeValue,
  setOperation,
} from '../client/src/settings-api.mjs';

function describeEnvelope(overrides = {}) {
  return {
    ok: true,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: [
        { ns: 'other-plugin', value: { ignored: true }, revision: 2 },
        {
          ns: SETTINGS_NS,
          value: {
            workspacePath: '/workspace/demo',
            retentionDays: 14,
            autoFetch: false,
            model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' },
            sources: {
              github_trending: { scheduleEnabled: true, scheduleAt: '09:30', translationEnabled: false },
              hand_edited: { scheduleAt: '8:00' },
            },
          },
          revision: 7,
          applies: 'live',
        },
      ],
      ...overrides,
    },
  };
}

test('describe normalizes writable, revision, and every client leaf', async () => {
  const api = createSettingsApi({ describe: async () => describeEnvelope() });
  assert.deepEqual(await api.describe(), {
    writable: true,
    revision: 7,
    value: {
      workspacePath: '/workspace/demo',
      retentionDays: 14,
      model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' },
      sources: {
        github_trending: {
          scheduleEnabled: true,
          scheduleAt: '09:30',
          translationEnabled: false,
          locale: 'zh',
          batchSize: 3,
        },
        hand_edited: {
          scheduleEnabled: true,
          scheduleAt: '08:00',
          translationEnabled: true,
          locale: 'zh',
          batchSize: 3,
        },
      },
    },
  });
});

test('describe reports a read-only profile and fills missing leaves', async () => {
  const api = createSettingsApi({
    describe: async () => ({
      ok: true,
      value: {
        writable: false,
        hasDocument: false,
        namespaces: [{ ns: SETTINGS_NS, value: {}, revision: 0 }],
      },
    }),
  });
  assert.deepEqual(await api.describe(), {
    writable: false,
    revision: 0,
    value: {
      workspacePath: '',
      retentionDays: 30,
      model: null,
      sources: {},
    },
  });
});

test('a missing dsh-feed-ultra namespace is an error, not default controls', async () => {
  const api = createSettingsApi({
    describe: async () => ({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } }),
  });
  await assert.rejects(api.describe(), (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.code, 'settings/missing');
    assert.match(error.message, /dsh-feed-ultra/);
    return true;
  });
});

test('mutate forwards the namespace, ops, and expected revision and returns the new view', async () => {
  const calls = [];
  const ops = [setOperation(['sources', 'github_trending', 'scheduleAt'], '09:30')];
  const api = createSettingsApi({
    describe: async () => {
      throw new Error('not called');
    },
    mutate: async (ns, receivedOps, revision) => {
      calls.push([ns, receivedOps, revision]);
      return {
        ok: true,
        value: {
          ns,
          revision: revision + 1,
          value: {
            workspacePath: '/workspace',
            retentionDays: 30,
            autoFetch: false,
            model: null,
            sources: { github_trending: { scheduleEnabled: true, scheduleAt: '09:30' } },
          },
        },
      };
    },
  });

  assert.deepEqual(await api.mutate(ops, 7), {
    revision: 8,
    value: {
      workspacePath: '/workspace',
      retentionDays: 30,
      model: null,
      sources: { github_trending: { scheduleEnabled: true, scheduleAt: '09:30', translationEnabled: true, locale: 'zh', batchSize: 3 } },
    },
  });
  assert.deepEqual(calls, [[SETTINGS_NS, ops, 7]]);
  assert.equal(calls[0][1], ops, 'the facade forwards the ops array unchanged');
});

test('failed envelopes surface the host code, including conflicts', async () => {
  const api = createSettingsApi({
    describe: async () => ({ ok: false, error: { code: 'settings/rejected', message: 'provider refused' } }),
    mutate: async () => ({ ok: false, error: { code: 'settings/conflict', message: 'stale revision' } }),
  });

  await assert.rejects(api.describe(), (error) => {
    assert.equal(error.code, 'settings/rejected');
    assert.match(error.message, /provider refused/);
    return true;
  });
  await assert.rejects(api.mutate([setOperation(['retentionDays'], 7)], 3), (error) => {
    assert.equal(error.code, 'settings/conflict');
    assert.match(error.message, /stale revision/);
    return true;
  });
});

test('setOperation builds exactly one set op and copies the path', () => {
  const path = ['sources', 'github_trending', 'scheduleAt'];
  const op = setOperation(path, '09:30');
  assert.deepEqual(op, {
    op: 'set',
    path: ['sources', 'github_trending', 'scheduleAt'],
    value: '09:30',
  });
  assert.notEqual(op.path, path, 'the wire op owns its own array');
  path.push('mutated');
  assert.deepEqual(op.path, ['sources', 'github_trending', 'scheduleAt']);
});

test('normalizeValue parses the model and channel leaves and drops autoFetch', () => {
  const value = normalizeValue({
    workspacePath: '/workspace',
    retentionDays: 7,
    autoFetch: false,
    model: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: '' },
    sources: {
      github_trending: { scheduleEnabled: false, scheduleAt: '23:59', translationEnabled: false },
      hand_edited: { scheduleAt: '7:00', scheduleEnabled: 'yes', locale: 'en' },
    },
  });

  assert.deepEqual(value, {
    workspacePath: '/workspace',
    retentionDays: 7,
    model: { provider: 'deepseek', model: 'deepseek-reasoner' },
    sources: {
      github_trending: {
        scheduleEnabled: false,
        scheduleAt: '23:59',
        translationEnabled: false,
        locale: 'zh',
        batchSize: 3,
      },
      hand_edited: { scheduleEnabled: true, scheduleAt: '08:00', translationEnabled: true, locale: 'en', batchSize: 3 },
    },
  });
  assert.equal('autoFetch' in value, false, 'the legacy switch never reaches the client document');
});

test('model and schedule parsing reject empty or malformed wire values', () => {
  assert.deepEqual(normalizeModelChoice({ provider: 'p', model: 'm' }), { provider: 'p', model: 'm' });
  assert.deepEqual(
    normalizeModelChoice({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    { provider: 'p', model: 'm', reasoningEffort: 'high' },
  );
  assert.equal(normalizeModelChoice({ provider: '', model: 'm' }), null);
  assert.equal(normalizeModelChoice({ provider: 'p', model: '' }), null);
  assert.equal(normalizeModelChoice(null), null);
  assert.equal(normalizeModelChoice('deepseek'), null);

  assert.equal(isScheduleAt('08:00'), true);
  assert.equal(isScheduleAt('23:59'), true);
  assert.equal(isScheduleAt('8:00'), false);
  assert.equal(isScheduleAt('24:00'), false);
  assert.equal(isScheduleAt(''), false);
  assert.equal(isScheduleAt(800), false);
});

test('channelOf reads one channel and defaults a missing entry', () => {
  const value = normalizeValue({
    sources: { github_trending: { scheduleEnabled: false, scheduleAt: '06:15' } },
  });
  assert.deepEqual(channelOf(value, 'github_trending'), {
    scheduleEnabled: false,
    scheduleAt: '06:15',
    translationEnabled: true,
    locale: 'zh',
    batchSize: 3,
  });
  assert.deepEqual(channelOf(value, 'missing'), {
    scheduleEnabled: true,
    scheduleAt: '08:00',
    translationEnabled: true,
    locale: 'zh',
    batchSize: 3,
  });
  assert.deepEqual(channelOf(null, 'missing'), {
    scheduleEnabled: true,
    scheduleAt: '08:00',
    translationEnabled: true,
    locale: 'zh',
    batchSize: 3,
  });
});

test('a channel batch size stays an integer in one through twenty', () => {
  const value = normalizeValue({
    sources: {
      x_bookmarks: { batchSize: 7 },
      too_small: { batchSize: 0 },
      too_large: { batchSize: 21 },
      fractional: { batchSize: 2.5 },
      text: { batchSize: 'not-a-number' },
    },
  });
  assert.equal(channelOf(value, 'x_bookmarks').batchSize, 7);
  assert.equal(channelOf(value, 'too_small').batchSize, 3);
  assert.equal(channelOf(value, 'too_large').batchSize, 3);
  assert.equal(channelOf(value, 'fractional').batchSize, 3);
  assert.equal(channelOf(value, 'text').batchSize, 3);
  assert.equal(normalizeBatchSize('12'), 12);
  assert.equal(normalizeBatchSize(''), 3);
  assert.equal(normalizeBatchSize(true), 3);
});
