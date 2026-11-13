import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AutoAttempts } from '../src/contract/types.ts';
import {
  MAX_AUTO_ATTEMPTS_PER_DAY,
  MAX_PENDING_ATTEMPTS_PER_DAY,
  PENDING_RETRY_INTERVAL_MINUTES,
  RETRY_INTERVAL_MINUTES,
  computeNextFetchAt,
  fetchDecision,
  isFetchDue,
  parseScheduleAt,
  type FetchDecision,
  type FetchHealthSlice,
} from '../src/engine/schedule.ts';
import { dayKeyOf } from '../src/store/paths.ts';

const NOW = new Date(2026, 10, 10, 12, 0, 0);
const TODAY = dayKeyOf(NOW);
const YESTERDAY = dayKeyOf(new Date(2026, 10, 9, 12, 0, 0));
const OPEN = { enabled: true, at: '08:00' };

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 10, 10, hours, minutes, 0);
}

function minutesBefore(minutes: number, from: Date = NOW): string {
  return new Date(from.getTime() - minutes * 60_000).toISOString();
}

function health(overrides: Partial<FetchHealthSlice> = {}): FetchHealthSlice {
  return {
    lastAttemptAt: '',
    lastSuccessAt: '',
    consecutiveFailures: 0,
    autoAttempts: { day: '', count: 0 },
    ...overrides,
  };
}

function attempts(day: string, count: number): AutoAttempts {
  return { day, count };
}

function due(
  input: { health?: FetchHealthSlice | null; schedule?: { enabled: boolean; at: string }; now?: Date } = {},
): boolean {
  return isFetchDue({ health: input.health ?? null, schedule: input.schedule ?? OPEN, now: input.now ?? NOW });
}

function next(
  input: { health?: FetchHealthSlice | null; schedule?: { enabled: boolean; at: string }; now?: Date } = {},
): string | null {
  return computeNextFetchAt({ health: input.health ?? null, schedule: input.schedule ?? OPEN, now: input.now ?? NOW });
}

function decide(
  input: { health?: FetchHealthSlice | null; schedule?: { enabled: boolean; at: string }; now?: Date } = {},
): FetchDecision {
  return fetchDecision({ health: input.health ?? null, schedule: input.schedule ?? OPEN, now: input.now ?? NOW });
}

test('parses HH:mm into minutes and rejects malformed values', () => {
  assert.equal(parseScheduleAt('08:00'), 480);
  assert.equal(parseScheduleAt('00:00'), 0);
  assert.equal(parseScheduleAt('23:59'), 1439);
  assert.equal(parseScheduleAt('24:00'), null);
  assert.equal(parseScheduleAt('8:00'), null);
  assert.equal(parseScheduleAt('08:60'), null);
  assert.equal(parseScheduleAt(''), null);
});

test('a disabled channel is never due', () => {
  assert.equal(due({ schedule: { enabled: false, at: '08:00' } }), false);
});

test('a source that never fetched is due once its own time has passed', () => {
  assert.equal(due({ health: null }), true);
});

test('a source is not due before its own time of day', () => {
  assert.equal(due({ health: null, now: at(7, 59) }), false);
  assert.equal(due({ health: null, now: at(8, 0) }), true);
});

test('a source that already succeeded today is not due', () => {
  const succeeded = health({ lastAttemptAt: minutesBefore(30), lastSuccessAt: minutesBefore(30) });
  assert.equal(due({ health: succeeded }), false);
  assert.equal(due({ health: succeeded, now: at(7, 0) }), false);
});

test('a success from yesterday does not block today', () => {
  const yesterday = new Date(2026, 10, 9, 9, 0, 0).toISOString();
  assert.equal(due({ health: health({ lastAttemptAt: yesterday, lastSuccessAt: yesterday }) }), true);
});

test('the first automatic attempt of the day is due right away', () => {
  const spent = health({ autoAttempts: attempts(TODAY, 1), lastAttemptAt: minutesBefore(60) });
  assert.equal(due({ health: spent }), true);
});

test('a retry waits the fixed interval after the previous attempt', () => {
  const spent = health({
    autoAttempts: attempts(TODAY, 1),
    lastAttemptAt: minutesBefore(RETRY_INTERVAL_MINUTES - 1),
  });
  assert.equal(due({ health: spent }), false);

  spent.lastAttemptAt = minutesBefore(RETRY_INTERVAL_MINUTES);
  assert.equal(due({ health: spent }), true);
});

test('the daily budget stops automatic retries until tomorrow', () => {
  const spent = health({
    autoAttempts: attempts(TODAY, MAX_AUTO_ATTEMPTS_PER_DAY),
    lastAttemptAt: minutesBefore(120),
  });
  assert.equal(due({ health: spent }), false);
});

test('yesterday spending the whole budget does not block today', () => {
  const spent = health({
    autoAttempts: attempts(YESTERDAY, MAX_AUTO_ATTEMPTS_PER_DAY),
    lastAttemptAt: new Date(2026, 10, 9, 17, 0, 0).toISOString(),
  });
  assert.equal(due({ health: spent }), true);
});

test('manual attempts never spend the automatic budget', () => {
  const manual = health({ lastAttemptAt: minutesBefore(1), autoAttempts: attempts('', 0) });
  assert.equal(due({ health: manual }), true);
});

test('moving the time later today postpones the fetch', () => {
  const schedule = { enabled: true, at: '18:00' };
  assert.equal(due({ health: null, schedule, now: at(12, 0) }), false);
  assert.equal(due({ health: null, schedule, now: at(18, 0) }), true);
});

test('an invalid schedule time falls back to 08:00 instead of blocking the channel', () => {
  assert.equal(due({ health: null, schedule: { enabled: true, at: 'nonsense' }, now: at(8, 0) }), true);
});

test('the decision reports due: true when no gate blocks the fetch', () => {
  assert.deepEqual(decide(), { due: true });
});

test('the decision names each blocking gate', () => {
  assert.deepEqual(decide({ schedule: { enabled: false, at: '08:00' } }), { due: false, reason: 'disabled' });

  const succeeded = health({ lastAttemptAt: minutesBefore(30), lastSuccessAt: minutesBefore(30) });
  assert.deepEqual(decide({ health: succeeded }), { due: false, reason: 'already-succeeded' });

  assert.deepEqual(decide({ health: null, now: at(7, 59) }), { due: false, reason: 'before-time' });

  const spent = health({
    autoAttempts: attempts(TODAY, MAX_AUTO_ATTEMPTS_PER_DAY),
    lastAttemptAt: minutesBefore(120),
  });
  assert.deepEqual(decide({ health: spent }), { due: false, reason: 'budget-spent' });

  const retrying = health({
    autoAttempts: attempts(TODAY, 1),
    lastAttemptAt: minutesBefore(RETRY_INTERVAL_MINUTES - 1),
  });
  assert.deepEqual(decide({ health: retrying }), { due: false, reason: 'waiting' });
});

test('the earliest blocking gate names the reason when several would block', () => {
  const blocked = health({
    autoAttempts: attempts(TODAY, MAX_AUTO_ATTEMPTS_PER_DAY),
    lastAttemptAt: minutesBefore(120),
    lastSuccessAt: minutesBefore(30),
  });
  assert.deepEqual(decide({ health: blocked, schedule: { enabled: false, at: '18:00' } }), {
    due: false,
    reason: 'disabled',
  });
  assert.deepEqual(decide({ health: blocked, schedule: { enabled: true, at: '18:00' }, now: at(12, 0) }), {
    due: false,
    reason: 'already-succeeded',
  });

  const unsolved = health({ autoAttempts: attempts(TODAY, MAX_AUTO_ATTEMPTS_PER_DAY), lastAttemptAt: minutesBefore(120) });
  assert.deepEqual(decide({ health: unsolved, schedule: { enabled: true, at: '18:00' }, now: at(12, 0) }), {
    due: false,
    reason: 'before-time',
  });
});

test('nextFetchAt is null when the schedule is off', () => {
  assert.equal(next({ schedule: { enabled: false, at: '08:00' } }), null);
});

test('nextFetchAt points at today before the time and tomorrow after a success', () => {
  assert.equal(next({ health: null, now: at(7, 0) }), at(8, 0).toISOString());

  const succeeded = health({ lastAttemptAt: minutesBefore(30), lastSuccessAt: minutesBefore(30) });
  assert.equal(next({ health: succeeded }), new Date(2026, 10, 11, 8, 0, 0).toISOString());
});

test('nextFetchAt points at the next retry while the budget lasts, then at tomorrow', () => {
  const retrying = health({ autoAttempts: attempts(TODAY, 1), lastAttemptAt: minutesBefore(2) });
  const expected = new Date(NOW.getTime() + (RETRY_INTERVAL_MINUTES - 2) * 60_000).toISOString();
  assert.equal(next({ health: retrying }), expected);

  const spent = health({
    autoAttempts: attempts(TODAY, MAX_AUTO_ATTEMPTS_PER_DAY),
    lastAttemptAt: minutesBefore(30),
  });
  assert.equal(next({ health: spent }), new Date(2026, 10, 11, 8, 0, 0).toISOString());
});

test('a pending day waits the pending interval, not the failure interval', () => {
  const pending = health({
    lastAttemptAt: minutesBefore(PENDING_RETRY_INTERVAL_MINUTES - 1),
    lastOutcome: 'pending',
    pendingAttempts: attempts(TODAY, 1),
  });
  assert.equal(due({ health: pending }), false);
  assert.deepEqual(decide({ health: pending }), { due: false, reason: 'waiting' });

  pending.lastAttemptAt = minutesBefore(PENDING_RETRY_INTERVAL_MINUTES);
  assert.equal(due({ health: pending }), true);
});

test('three pending attempts stop automatic retries for the day', () => {
  const exhausted = health({
    lastAttemptAt: minutesBefore(PENDING_RETRY_INTERVAL_MINUTES + 1),
    lastOutcome: 'pending',
    pendingAttempts: attempts(TODAY, MAX_PENDING_ATTEMPTS_PER_DAY),
  });
  assert.equal(due({ health: exhausted }), false);
  assert.deepEqual(decide({ health: exhausted }), { due: false, reason: 'pending-exhausted' });
});

test('the pending cap survives a later manual failure', () => {
  const mixed = health({
    lastAttemptAt: minutesBefore(RETRY_INTERVAL_MINUTES + 1),
    lastOutcome: 'error',
    consecutiveFailures: 1,
    autoAttempts: attempts(TODAY, 1),
    pendingAttempts: attempts(TODAY, MAX_PENDING_ATTEMPTS_PER_DAY),
  });
  assert.deepEqual(decide({ health: mixed }), { due: false, reason: 'pending-exhausted' });
});

test('the pending budget is independent from the failure budget', () => {
  const pending = health({
    lastAttemptAt: minutesBefore(PENDING_RETRY_INTERVAL_MINUTES),
    lastOutcome: 'pending',
    autoAttempts: attempts(TODAY, MAX_AUTO_ATTEMPTS_PER_DAY),
    pendingAttempts: attempts(TODAY, MAX_PENDING_ATTEMPTS_PER_DAY - 1),
  });
  assert.equal(due({ health: pending }), true);
});

test('pending attempts reset across a local day boundary', () => {
  const yesterdayPending = health({
    lastAttemptAt: new Date(2026, 10, 9, 23, 0, 0).toISOString(),
    lastOutcome: 'pending',
    pendingAttempts: attempts(YESTERDAY, MAX_PENDING_ATTEMPTS_PER_DAY),
  });
  assert.equal(due({ health: yesterdayPending }), true);
});

test('a stale pending outcome at 23:59 does not delay the 00:05 attempt', () => {
  const midnight = new Date(2026, 10, 11, 0, 5, 0);
  const stale = health({
    lastAttemptAt: new Date(2026, 10, 10, 23, 59, 0).toISOString(),
    lastOutcome: 'pending',
    pendingAttempts: attempts(YESTERDAY, 1),
  });

  assert.equal(due({ health: stale, schedule: { enabled: true, at: '00:00' }, now: midnight }), true);
  assert.deepEqual(decide({ health: stale, schedule: { enabled: true, at: '00:00' }, now: midnight }), {
    due: true,
  });
});

test('nextFetchAt points at the pending retry, then at tomorrow once exhausted', () => {
  const pending = health({
    lastAttemptAt: minutesBefore(5),
    lastOutcome: 'pending',
    pendingAttempts: attempts(TODAY, 1),
  });
  const expected = new Date(NOW.getTime() + (PENDING_RETRY_INTERVAL_MINUTES - 5) * 60_000).toISOString();
  assert.equal(next({ health: pending }), expected);

  const exhausted = health({
    lastAttemptAt: minutesBefore(60),
    lastOutcome: 'pending',
    pendingAttempts: attempts(TODAY, MAX_PENDING_ATTEMPTS_PER_DAY),
  });
  assert.equal(next({ health: exhausted }), new Date(2026, 10, 11, 8, 0, 0).toISOString());
});

test('nextFetchAt ignores a pending outcome from an earlier local day', () => {
  const midnight = new Date(2026, 10, 11, 0, 5, 0);
  const stale = health({
    lastAttemptAt: new Date(2026, 10, 10, 23, 59, 0).toISOString(),
    lastOutcome: 'pending',
    pendingAttempts: attempts(YESTERDAY, 1),
  });
  assert.equal(
    next({ health: stale, schedule: { enabled: true, at: '00:00' }, now: midnight }),
    midnight.toISOString(),
  );
});
