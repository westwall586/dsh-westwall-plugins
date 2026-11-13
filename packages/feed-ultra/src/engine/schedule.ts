import type { AutoAttempts, FetchOutcomeKind } from '../contract/types.ts';
import type { ChannelScheduleView } from '../contract/views.ts';
import { DEFAULT_SCHEDULE_AT } from '../settings.ts';
import { dayKeyOf } from '../store/paths.ts';

/** Two automatic attempts on the same day are never closer than this. */
export const RETRY_INTERVAL_MINUTES = 10;

/** Automatic attempts per local day, the first try included. Manual fetches never spend it. */
export const MAX_AUTO_ATTEMPTS_PER_DAY = 3;

/** A pending day is not a failure: wait longer and never spend the failure budget. */
export const PENDING_RETRY_INTERVAL_MINUTES = 30;

/** Automatic pending attempts per local day, the first try included. */
export const MAX_PENDING_ATTEMPTS_PER_DAY = 3;

export interface FetchHealthSlice {
  lastAttemptAt: string;
  lastSuccessAt: string;
  consecutiveFailures: number;
  autoAttempts?: AutoAttempts;
  lastOutcome?: FetchOutcomeKind;
  pendingAttempts?: AutoAttempts;
}

export interface DueInput {
  health: FetchHealthSlice | null;
  schedule: ChannelScheduleView;
  now: Date;
}

const SCHEDULE_AT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FALLBACK_AT_MINUTES = minutesOfDayOf(DEFAULT_SCHEDULE_AT);

/** `HH:mm` as minutes since local midnight, or `null` when the value is malformed. */
export function parseScheduleAt(at: string): number | null {
  const match = SCHEDULE_AT_PATTERN.exec(at);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesOfDayOf(at: string): number {
  const match = SCHEDULE_AT_PATTERN.exec(at);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 8 * 60;
}

function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function parseInstant(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function attemptsOnDay(attempts: AutoAttempts | undefined, day: string): number {
  if (!attempts || attempts.day !== day) return 0;
  const count = Math.floor(attempts.count);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function scheduleAtMinutes(schedule: ChannelScheduleView): number {
  return parseScheduleAt(schedule.at) ?? FALLBACK_AT_MINUTES;
}

function succeededOnDay(health: FetchHealthSlice | null, day: string): boolean {
  const success = parseInstant(health?.lastSuccessAt);
  return success !== null && dayKeyOf(new Date(success)) === day;
}

/** The last attempt instant, but only when it belongs to the given local day. */
function lastAttemptOnDay(health: FetchHealthSlice | null, day: string): number | null {
  const lastAttempt = parseInstant(health?.lastAttemptAt);
  if (lastAttempt === null) return null;
  return dayKeyOf(new Date(lastAttempt)) === day ? lastAttempt : null;
}

/** One due decision: `due: true`, or the first gate in gate order that blocked the fetch. */
export type FetchDecision =
  | { due: true }
  | {
      due: false;
      reason: 'disabled' | 'already-succeeded' | 'before-time' | 'pending-exhausted' | 'budget-spent' | 'waiting';
    };

/** A daily source is due when its own schedule allows it, today is unsolved, and its budget is not spent. */
export function fetchDecision(input: DueInput): FetchDecision {
  if (!input.schedule.enabled) return { due: false, reason: 'disabled' };

  const today = dayKeyOf(input.now);
  if (succeededOnDay(input.health, today)) return { due: false, reason: 'already-succeeded' };
  if (minutesOfDay(input.now) < scheduleAtMinutes(input.schedule)) return { due: false, reason: 'before-time' };

  if (attemptsOnDay(input.health?.pendingAttempts, today) >= MAX_PENDING_ATTEMPTS_PER_DAY) {
    return { due: false, reason: 'pending-exhausted' };
  }

  if (input.health?.lastOutcome === 'pending') {
    const lastAttempt = lastAttemptOnDay(input.health, today);
    if (lastAttempt !== null && input.now.getTime() - lastAttempt < PENDING_RETRY_INTERVAL_MINUTES * 60_000) {
      return { due: false, reason: 'waiting' };
    }
    return { due: true };
  }

  const attempts = attemptsOnDay(input.health?.autoAttempts, today);
  if (attempts >= MAX_AUTO_ATTEMPTS_PER_DAY) return { due: false, reason: 'budget-spent' };

  if (attempts > 0) {
    const lastAttempt = parseInstant(input.health?.lastAttemptAt);
    if (lastAttempt !== null) {
      const elapsed = input.now.getTime() - lastAttempt;
      if (elapsed < RETRY_INTERVAL_MINUTES * 60_000) return { due: false, reason: 'waiting' };
    }
  }

  return { due: true };
}

/** Whether a daily source is due, as a projection of `fetchDecision`. */
export function isFetchDue(input: DueInput): boolean {
  return fetchDecision(input).due;
}

function instantAtLocalTime(now: Date, atMinutes: number): Date {
  const result = new Date(now.getTime());
  result.setHours(Math.floor(atMinutes / 60), atMinutes % 60, 0, 0);
  return result;
}

function nextLocalDay(now: Date): Date {
  const result = new Date(now.getTime());
  result.setDate(result.getDate() + 1);
  return result;
}

/** When the next automatic fetch is expected, or `null` when the channel schedule is off. */
export function computeNextFetchAt(input: DueInput): string | null {
  if (!input.schedule.enabled) return null;

  const today = dayKeyOf(input.now);
  const atMinutes = scheduleAtMinutes(input.schedule);
  const atToday = instantAtLocalTime(input.now, atMinutes);
  const atTomorrow = instantAtLocalTime(nextLocalDay(input.now), atMinutes);

  if (succeededOnDay(input.health, today)) return atTomorrow.toISOString();
  if (attemptsOnDay(input.health?.pendingAttempts, today) >= MAX_PENDING_ATTEMPTS_PER_DAY) {
    return atTomorrow.toISOString();
  }
  if (input.now.getTime() < atToday.getTime()) return atToday.toISOString();

  if (input.health?.lastOutcome === 'pending') {
    const lastAttempt = lastAttemptOnDay(input.health, today);
    if (lastAttempt === null) return input.now.toISOString();
    const nextRetry = lastAttempt + PENDING_RETRY_INTERVAL_MINUTES * 60_000;
    return new Date(Math.max(input.now.getTime(), nextRetry)).toISOString();
  }

  const attempts = attemptsOnDay(input.health?.autoAttempts, today);
  if (attempts >= MAX_AUTO_ATTEMPTS_PER_DAY) return atTomorrow.toISOString();
  if (attempts === 0) return input.now.toISOString();

  const lastAttempt = parseInstant(input.health?.lastAttemptAt);
  if (lastAttempt === null) return input.now.toISOString();
  const nextRetry = lastAttempt + RETRY_INTERVAL_MINUTES * 60_000;
  return new Date(Math.max(input.now.getTime(), nextRetry)).toISOString();
}
