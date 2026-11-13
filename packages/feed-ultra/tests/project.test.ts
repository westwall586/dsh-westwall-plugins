import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeItemId } from '../src/contract/ids.ts';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { FactFile, HealthRecord, ItemState, SourceDescriptor } from '../src/contract/types.ts';
import type { ChannelScheduleView, TranslationView } from '../src/contract/views.ts';
import type { ProjectedSource } from '../src/service/project.ts';
import { projectDay, projectSection, sourceHealthView } from '../src/service/project.ts';

const TODAY = '2026-11-10';
const YESTERDAY = '2026-11-09';
const TODAY_AT = new Date(2026, 10, 10, 9, 0, 0).toISOString();
const YESTERDAY_AT = new Date(2026, 10, 9, 9, 0, 0).toISOString();
const SOURCE: SourceDescriptor = { id: 'test_source', name: 'Test Source', type: 'test' };
const SCHEDULE: ChannelScheduleView = { enabled: true, at: '08:00' };
const TRANSLATION: TranslationView = { enabled: true, missing: 0, error: '' };
const NOW = new Date(2026, 10, 10, 12, 0, 0);

function fact(day: string, naturalKeys: string[]): FactFile {
  const at = `${day}T08:00:00Z`;
  return {
    version: CONTRACT_VERSION,
    source: SOURCE,
    day,
    fetch: { lastAttemptAt: at, lastSuccessAt: at, status: 'ok', error: '' },
    items: naturalKeys.map((naturalKey, index) => ({
      id: composeItemId(SOURCE.id, naturalKey),
      naturalKey,
      title: naturalKey,
      description: '',
      url: `https://example.com/${index}`,
      publishedAt: at,
      dayKey: day,
      firstSeenAt: at,
      lastSeenAt: at,
      extra: { rank: index + 1 },
    })),
  };
}

function health(overrides: Partial<HealthRecord> = {}): HealthRecord {
  return {
    version: CONTRACT_VERSION,
    lastAttemptAt: TODAY_AT,
    lastSuccessAt: TODAY_AT,
    consecutiveFailures: 0,
    lastError: '',
    cursor: {},
    autoAttempts: { day: '', count: 0 },
    lastOutcome: '',
    pendingAttempts: { day: '', count: 0 },
    ...overrides,
  };
}

function projected(source: Partial<ProjectedSource> = {}): ProjectedSource {
  return {
    source: SOURCE,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
    fact: { kind: 'ok', fact: fact(TODAY, ['alpha', 'beta']) },
    health: health(),
    translation: TRANSLATION,
    ...source,
  };
}

test("today's active failure still lists the last good snapshot", () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ health: health({ consecutiveFailures: 1, lastError: 'GET failed' }) }),
  });

  assert.equal(section.status, 'error');
  assert.equal(section.count, 2);
  assert.deepEqual(
    section.items.map((item) => item.title),
    ['alpha', 'beta'],
  );
  assert.equal(section.fetch.status, 'error');
  assert.equal(section.fetch.error, 'GET failed');
});

test('a historical missing day does not borrow today\'s fetch time', () => {
  const section = projectSection({
    date: YESTERDAY,
    today: TODAY,
    state: {},
    source: projected({ fact: { kind: 'missing' }, health: health() }),
  });
  assert.equal(section.status, 'missing');
  assert.equal(section.fetch.lastAttemptAt, '');
  assert.equal(section.fetch.lastSuccessAt, '');
});

test('a corrupt fact degrades only its own section', () => {
  const view = projectDay({
    date: TODAY,
    today: TODAY,
    workspace: { status: 'ok', path: '/workspace' },
    state: {},
    sources: [
      projected({ fact: { kind: 'corrupt', error: 'bad json' } }),
      { ...projected(), source: { id: 'other', name: 'Other', type: 'other' } },
    ],
  });

  assert.equal(view.sections[0]?.status, 'corrupt');
  assert.deepEqual(view.sections[0]?.items, []);
  assert.equal(view.sections[0]?.fetch.error, 'bad json');
  assert.equal(view.sections[1]?.status, 'ok');
  assert.equal(view.sections[1]?.count, 2);
  assert.equal(view.total, 2);
});

test('a missing fact is an error only while the latest attempt failed today', () => {
  const missing = { kind: 'missing' as const };
  const failedToday = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ fact: missing, health: health({ consecutiveFailures: 1, lastOutcome: 'error' }) }),
  });
  const failedYesterday = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: missing,
      health: health({ lastAttemptAt: YESTERDAY_AT, consecutiveFailures: 1, lastOutcome: 'error' }),
    }),
  });
  const neverFetched = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ fact: missing, health: null }),
  });

  assert.equal(failedToday.status, 'error');
  assert.equal(failedYesterday.status, 'missing');
  assert.equal(neverFetched.status, 'missing');
});

test('the latest outcome wins when a pending retry follows an error on the same day', () => {
  const missing = { kind: 'missing' as const };
  const pending = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: missing,
      health: health({
        lastAttemptAt: TODAY_AT,
        consecutiveFailures: 2,
        lastError: '',
        lastOutcome: 'pending',
        pendingAttempts: { day: TODAY, count: 1 },
      }),
    }),
  });
  assert.equal(pending.status, 'pending', 'the old failure count must not override the pending retry');

  const error = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: missing,
      health: health({
        lastAttemptAt: TODAY_AT,
        consecutiveFailures: 1,
        lastError: 'boom',
        lastOutcome: 'error',
        pendingAttempts: { day: TODAY, count: 3 },
      }),
    }),
  });
  assert.equal(error.status, 'error', 'the pending cap belongs to scheduling, not display');
});

test('a legacy health record without lastOutcome still shows its failure', () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: { kind: 'missing' },
      health: health({ consecutiveFailures: 1, lastOutcome: '' }),
    }),
  });
  assert.equal(section.status, 'error');
});

test('a leftover attempt from today never paints a historical day', () => {
  const missing = { kind: 'missing' as const };
  for (const lastOutcome of ['pending', 'error'] as const) {
    const section = projectSection({
      date: YESTERDAY,
      today: TODAY,
      state: {},
      source: projected({
        fact: missing,
        health: health({ lastAttemptAt: TODAY_AT, lastOutcome, consecutiveFailures: 1 }),
      }),
    });
    assert.equal(section.status, 'missing', `${lastOutcome} today must not mark yesterday`);
  }
});

test('a past day keeps its snapshot even when the source now fails', () => {
  const section = projectSection({
    date: YESTERDAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: { kind: 'ok', fact: fact(YESTERDAY, ['alpha']) },
      health: health({ consecutiveFailures: 2 }),
    }),
  });

  assert.equal(section.status, 'ok');
});

test('projectDay merges read state into items and totals', () => {
  const state: Record<string, ItemState> = {
    [composeItemId(SOURCE.id, 'alpha')]: { readAt: `${TODAY}T10:00:00Z` },
  };
  const view = projectDay({
    date: TODAY,
    today: TODAY,
    workspace: { status: 'ok', path: '/workspace' },
    state,
    sources: [projected()],
  });

  assert.equal(view.total, 2);
  assert.equal(view.read, 1);
  assert.equal(view.unread, 1);
  assert.equal(view.sections[0]?.items[0]?.read, true);
  assert.equal(view.sections[0]?.items[0]?.readAt, `${TODAY}T10:00:00Z`);
  assert.equal(view.sections[0]?.items[1]?.read, false);
  assert.equal(view.sections[0]?.items[1]?.readAt, '');
});

test('the fact file order is the rank order', () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ fact: { kind: 'ok', fact: fact(TODAY, ['zeta', 'alpha']) } }),
  });

  assert.deepEqual(
    section.items.map((item) => item.naturalKey),
    ['zeta', 'alpha'],
  );
});

test('source health distinguishes idle, ok and error', () => {
  const idle = sourceHealthView({
    source: SOURCE,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
    health: null,
    todayFact: { kind: 'missing' },
    state: {},
    schedule: SCHEDULE,
    translation: { enabled: true, missing: 0, error: '', model: null },
    now: NOW,
  });
  const ok = sourceHealthView({
    source: SOURCE,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
    health: health(),
    todayFact: { kind: 'ok', fact: fact(TODAY, ['alpha', 'beta']) },
    state: { [composeItemId(SOURCE.id, 'alpha')]: { readAt: `${TODAY}T10:00:00Z` } },
    schedule: SCHEDULE,
    translation: { enabled: true, missing: 0, error: '', model: null },
    now: NOW,
  });
  const error = sourceHealthView({
    source: SOURCE,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
    health: health({ consecutiveFailures: 1, lastError: 'boom' }),
    todayFact: { kind: 'missing' },
    state: {},
    schedule: SCHEDULE,
    translation: { enabled: true, missing: 0, error: '', model: null },
    now: NOW,
  });

  assert.equal(idle.status, 'idle');
  assert.equal(idle.todayCount, 0);
  assert.equal(idle.unread, 0);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.todayCount, 2);
  assert.equal(ok.unread, 1);
  assert.equal(error.status, 'error');
  assert.equal(error.error, 'boom');
});

test('pending shows only for today and only while no snapshot exists', () => {
  const pendingHealth = health({ lastAttemptAt: TODAY_AT, lastOutcome: 'pending' });

  const today = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ fact: { kind: 'missing' }, health: pendingHealth }),
  });
  assert.equal(today.status, 'pending');
  assert.deepEqual(today.meta, {});
  assert.deepEqual(today.capabilities, { backfill: false, translation: true });

  const past = projectSection({
    date: YESTERDAY,
    today: TODAY,
    state: {},
    source: projected({ fact: { kind: 'missing' }, health: pendingHealth }),
  });
  assert.equal(past.status, 'missing');
});

test('an existing snapshot outranks a pending last outcome', () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ health: health({ lastAttemptAt: TODAY_AT, lastOutcome: 'pending' }) }),
  });
  assert.equal(section.status, 'ok');
  assert.equal(section.count, 2);
});

test('a notPublished snapshot is its own status and carries meta and capabilities', () => {
  const snapshot: FactFile = {
    ...fact(TODAY, []),
    meta: { notPublished: true, briefDate: TODAY, detailStatus: 'ok' },
  };
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: { kind: 'ok', fact: snapshot },
      health: health(),
      capabilities: { backfill: true, translation: false, locales: ['zh', 'en'], minScheduleAt: '07:00' },
    }),
  });

  assert.equal(section.status, 'notPublished');
  assert.equal(section.count, 0);
  assert.equal(section.meta.notPublished, true);
  assert.deepEqual(section.capabilities, { backfill: true, translation: false, locales: ['zh', 'en'], minScheduleAt: '07:00' });
});

test('a failure today outranks an empty published snapshot', () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      fact: { kind: 'ok', fact: fact(TODAY, []) },
      health: health({ consecutiveFailures: 1, lastError: 'boom' }),
    }),
  });

  assert.equal(section.status, 'error');
  assert.equal(section.fetch.error, 'boom');
});

test('a zero-item ok snapshot is notPublished even without the meta marker', () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ fact: { kind: 'ok', fact: fact(TODAY, []) }, health: health() }),
  });

  assert.equal(section.status, 'notPublished');
  assert.equal(section.count, 0);
});

test('a manual empty snapshot is empty, not notPublished, and carries batchSize', () => {
  const section = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      cadence: 'manual',
      batchSize: 3,
      capabilities: { backfill: false, translation: false, actions: ['deleteBookmark'], manualBatch: true },
      fact: { kind: 'ok', fact: fact(TODAY, []) },
      health: health(),
    }),
  });

  assert.equal(section.status, 'empty');
  assert.equal(section.batchSize, 3);

  const daily = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ fact: { kind: 'ok', fact: fact(TODAY, []) }, health: health() }),
  });
  assert.equal(daily.status, 'notPublished');
  assert.equal(daily.batchSize, undefined);
});

test('manual status precedence runs corrupt > error > pending > notPublished > empty > ok > missing', () => {
  const manual = { cadence: 'manual' as const, batchSize: 3 };
  const corrupt = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      ...manual,
      fact: { kind: 'corrupt', error: 'bad json' },
      health: health({ consecutiveFailures: 1, lastOutcome: 'error' }),
    }),
  });
  const error = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      ...manual,
      fact: { kind: 'ok', fact: fact(TODAY, []) },
      health: health({ consecutiveFailures: 1, lastOutcome: 'error' }),
    }),
  });
  const pending = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      ...manual,
      fact: { kind: 'missing' },
      health: health({ consecutiveFailures: 0, lastOutcome: 'pending' }),
    }),
  });
  const notPublished = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({
      ...manual,
      fact: { kind: 'ok', fact: { ...fact(TODAY, []), meta: { notPublished: true } } },
      health: health(),
    }),
  });
  const empty = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ ...manual, fact: { kind: 'ok', fact: fact(TODAY, []) }, health: health() }),
  });
  const ok = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ ...manual, health: health() }),
  });
  const missing = projectSection({
    date: TODAY,
    today: TODAY,
    state: {},
    source: projected({ ...manual, fact: { kind: 'missing' }, health: null }),
  });

  assert.equal(corrupt.status, 'corrupt');
  assert.equal(error.status, 'error');
  assert.equal(pending.status, 'pending');
  assert.equal(notPublished.status, 'notPublished');
  assert.equal(empty.status, 'empty');
  assert.equal(ok.status, 'ok');
  assert.equal(missing.status, 'missing');
});

test('a manual channel hides its stored schedule and next fetch', () => {
  const manual = sourceHealthView({
    source: SOURCE,
    cadence: 'manual',
    capabilities: { backfill: false, translation: false, actions: ['deleteBookmark'], manualBatch: true },
    health: health(),
    todayFact: { kind: 'ok', fact: fact(TODAY, []) },
    state: {},
    schedule: { enabled: true, at: '08:00' },
    translation: { enabled: false, missing: 0, error: '', model: null },
    batchSize: 3,
    now: NOW,
  });

  assert.equal(manual.nextFetchAt, null);
  assert.equal(manual.schedule.enabled, false);
  assert.equal(manual.batchSize, 3);

  const daily = sourceHealthView({
    source: SOURCE,
    cadence: 'daily',
    capabilities: { backfill: false, translation: true },
    health: health(),
    todayFact: { kind: 'missing' },
    state: {},
    schedule: SCHEDULE,
    translation: { enabled: true, missing: 0, error: '', model: null },
    now: NOW,
  });

  assert.notEqual(daily.nextFetchAt, null);
  assert.equal(daily.schedule.enabled, true);
  assert.equal(daily.batchSize, undefined);
});
