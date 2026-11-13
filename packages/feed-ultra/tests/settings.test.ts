import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Config,
  DEFAULT_SCHEDULE_AT,
  channelConfig,
  configSnapshot,
  hasChannelSettings,
  scheduleAtOrDefault,
} from '../src/settings.ts';

const OPTIONS = { sourceIds: ['github_trending', 'rss'] } as const;

test('dereferences volatile leaves from the live host config', () => {
  const snapshot = configSnapshot(
    {
      workspacePath: { get: () => '/workspace' },
      retentionDays: { get: () => 7 },
      autoFetch: { get: () => false },
    },
    OPTIONS,
  );

  assert.equal(snapshot.workspacePath, '/workspace');
  assert.equal(snapshot.retentionDays, 7);
  assert.equal(snapshot.autoFetch, false);
});

test('accepts plain values so tests and defaults work without the host', () => {
  const snapshot = configSnapshot({ workspacePath: '/workspace', retentionDays: 3, autoFetch: false }, OPTIONS);
  assert.equal(snapshot.workspacePath, '/workspace');
  assert.equal(snapshot.retentionDays, 3);

  const empty = configSnapshot(undefined, OPTIONS);
  assert.equal(empty.workspacePath, '');
  assert.equal(empty.retentionDays, 30);
  assert.equal(empty.autoFetch, true);
  assert.equal(empty.model, null);
});

test('migration seeds every registered channel from the legacy global switch', () => {
  const enabled = configSnapshot({ autoFetch: true }, OPTIONS);
  assert.deepEqual(enabled.sources, {
    github_trending: {
      scheduleEnabled: true,
      scheduleAt: DEFAULT_SCHEDULE_AT,
      translationEnabled: true,
      locale: 'zh',
      batchSize: 3,
      egoBrowserPath: '',
    },
    rss: {
      scheduleEnabled: true,
      scheduleAt: DEFAULT_SCHEDULE_AT,
      translationEnabled: true,
      locale: 'zh',
      batchSize: 3,
      egoBrowserPath: '',
    },
  });

  const disabled = configSnapshot({ autoFetch: false }, OPTIONS);
  assert.equal(disabled.sources.github_trending?.scheduleEnabled, false);
  assert.equal(disabled.sources.rss?.scheduleEnabled, false);
});

test('an existing channel subtree wins over the legacy switch', () => {
  const snapshot = configSnapshot(
    {
      autoFetch: false,
      sources: {
        github_trending: { scheduleEnabled: true, scheduleAt: '21:30', translationEnabled: false, locale: 'en' },
      },
    },
    OPTIONS,
  );

  assert.deepEqual(snapshot.sources.github_trending, {
    scheduleEnabled: true,
    scheduleAt: '21:30',
    translationEnabled: false,
    locale: 'en',
    batchSize: 3,
    egoBrowserPath: '',
  });
  // A registered channel the stored config never mentioned falls back to the defaults.
  assert.deepEqual(snapshot.sources.rss, {
    scheduleEnabled: true,
    scheduleAt: DEFAULT_SCHEDULE_AT,
    translationEnabled: true,
    locale: 'zh',
    batchSize: 3,
    egoBrowserPath: '',
  });
});

test('unknown source ids are dropped instead of surfaced', () => {
  const snapshot = configSnapshot(
    { sources: { ghost: { scheduleEnabled: false, scheduleAt: '01:00', translationEnabled: false } } },
    OPTIONS,
  );

  assert.deepEqual(Object.keys(snapshot.sources).sort(), ['github_trending', 'rss']);
  assert.equal(snapshot.sources.github_trending?.scheduleEnabled, true);
});

test('a malformed schedule time falls back to 08:00 rather than failing', () => {
  assert.equal(scheduleAtOrDefault('25:00'), DEFAULT_SCHEDULE_AT);
  assert.equal(scheduleAtOrDefault('08:0'), DEFAULT_SCHEDULE_AT);
  assert.equal(scheduleAtOrDefault(9), DEFAULT_SCHEDULE_AT);
  assert.equal(scheduleAtOrDefault('21:30'), '21:30');

  const snapshot = configSnapshot({ sources: { github_trending: { scheduleAt: 'oops' } } }, OPTIONS);
  assert.equal(snapshot.sources.github_trending?.scheduleAt, DEFAULT_SCHEDULE_AT);
});

test('the model choice is null while following and carries the effort when explicit', () => {
  assert.equal(configSnapshot({}, OPTIONS).model, null);
  assert.equal(configSnapshot({ model: null }, OPTIONS).model, null);
  assert.equal(configSnapshot({ model: { provider: '', model: 'x' } }, OPTIONS).model, null);

  assert.deepEqual(configSnapshot({ model: { provider: 'deepseek', model: 'flash' } }, OPTIONS).model, {
    provider: 'deepseek',
    model: 'flash',
  });
  assert.deepEqual(
    configSnapshot({ model: { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' } }, OPTIONS).model,
    { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' },
  );
});

test('hasChannelSettings tells whether the migration write already happened', () => {
  assert.equal(hasChannelSettings({}), false);
  assert.equal(hasChannelSettings(undefined), false);
  assert.equal(hasChannelSettings({ sources: null }), false);
  assert.equal(hasChannelSettings({ sources: {} }), true);
});

test('channelConfig falls back to the product defaults for an unsaved channel', () => {
  const snapshot = configSnapshot({}, OPTIONS);
  assert.deepEqual(channelConfig(snapshot, 'rss'), {
    scheduleEnabled: true,
    scheduleAt: DEFAULT_SCHEDULE_AT,
    translationEnabled: true,
    locale: 'zh',
    batchSize: 3,
    egoBrowserPath: '',
  });
  assert.equal(channelConfig(snapshot, 'never-registered').scheduleAt, DEFAULT_SCHEDULE_AT);
});

test('the channel locale keeps en and falls back to zh for unknown values', () => {
  const en = configSnapshot({ sources: { github_trending: { locale: 'en' } } }, OPTIONS);
  assert.equal(en.sources.github_trending?.locale, 'en');

  const unknown = configSnapshot({ sources: { github_trending: { locale: 'ja' } } }, OPTIONS);
  assert.equal(unknown.sources.github_trending?.locale, 'zh');

  const wrongType = configSnapshot({ sources: { github_trending: { locale: 42 } } }, OPTIONS);
  assert.equal(wrongType.sources.github_trending?.locale, 'zh');

  const deref = configSnapshot({ sources: { github_trending: { locale: { get: () => 'en' } } } }, OPTIONS);
  assert.equal(deref.sources.github_trending?.locale, 'en');
});

test('batchSize accepts 1..20 and malformed values fall back to 3', () => {
  assert.equal(configSnapshot({ sources: { github_trending: { batchSize: 1 } } }, OPTIONS).sources.github_trending?.batchSize, 1);
  assert.equal(configSnapshot({ sources: { github_trending: { batchSize: 20 } } }, OPTIONS).sources.github_trending?.batchSize, 20);
  assert.equal(
    configSnapshot({ sources: { github_trending: { batchSize: { get: () => 7 } } } }, OPTIONS).sources.github_trending?.batchSize,
    7,
  );

  for (const malformed of [0, 21, -1, 2.5, '4', null, undefined, Number.NaN]) {
    const snapshot = configSnapshot({ sources: { github_trending: { batchSize: malformed } } }, OPTIONS);
    assert.equal(snapshot.sources.github_trending?.batchSize, 3, `batchSize ${String(malformed)} falls back`);
  }

  assert.throws(() => Config({ sources: { x: { batchSize: 21 } } }), /batchSize/);
  assert.throws(() => Config({ sources: { x: { batchSize: 0 } } }), /batchSize/);
  assert.throws(() => Config({ sources: { x: { batchSize: 2.5 } } }), /batchSize/);
  assert.doesNotThrow(() => Config({ sources: { x: { batchSize: 20 } } }));
});

test('egoBrowserPath is a per-channel string with an empty default', () => {
  const xOptions = { sourceIds: ['x_bookmarks'] } as const;
  assert.equal(configSnapshot({}, OPTIONS).sources.github_trending?.egoBrowserPath, '');
  assert.equal(
    configSnapshot({ sources: { x_bookmarks: { egoBrowserPath: '/opt/ego-browser' } } }, xOptions).sources.x_bookmarks
      ?.egoBrowserPath,
    '/opt/ego-browser',
  );
  assert.equal(
    configSnapshot({ sources: { x_bookmarks: { egoBrowserPath: { get: () => '/env/ego-browser' } } } }, xOptions)
      .sources.x_bookmarks?.egoBrowserPath,
    '/env/ego-browser',
  );
  assert.equal(
    configSnapshot({ sources: { x_bookmarks: { egoBrowserPath: 42 } } }, xOptions).sources.x_bookmarks?.egoBrowserPath,
    '',
  );
});
