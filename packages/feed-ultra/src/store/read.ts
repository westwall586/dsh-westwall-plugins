import { readFile } from 'node:fs/promises';
import { parseFactFile, parseHealth } from '../contract/schema.ts';
import type { FactFile, HealthRecord, ItemRecord, ItemState } from '../contract/types.ts';
import { healthFile, itemFile, shiftDay, type Layout } from './paths.ts';

export type JsonReadResult =
  | { status: 'ok'; value: unknown }
  | { status: 'missing' }
  | { status: 'corrupt'; error: string };

export type DayFactResult =
  | { kind: 'ok'; fact: FactFile }
  | { kind: 'missing' }
  | { kind: 'corrupt'; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tolerant JSON read for files a previous run may have left half-written. */
export async function readJsonSafe(file: string): Promise<JsonReadResult> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw error;
  }

  try {
    return { status: 'ok', value: JSON.parse(text) as unknown };
  } catch (error) {
    return { status: 'corrupt', error: errorText(error) };
  }
}

export async function readDayItemsSafe(l: Layout, day: string, sourceId: string): Promise<DayFactResult> {
  const raw = await readJsonSafe(itemFile(l, day, sourceId));
  if (raw.status === 'missing') return { kind: 'missing' };
  if (raw.status === 'corrupt') return { kind: 'corrupt', error: raw.error };

  try {
    return { kind: 'ok', fact: parseFactFile(raw.value) };
  } catch (error) {
    return { kind: 'corrupt', error: errorText(error) };
  }
}

export async function readHealthSafe(l: Layout, sourceId: string): Promise<HealthRecord | null> {
  const raw = await readJsonSafe(healthFile(l, sourceId));
  if (raw.status !== 'ok') return null;

  try {
    return parseHealth(raw.value);
  } catch {
    return null;
  }
}

/** Ascending day keys of the retention window, both ends included. */
export function windowDays(today: string, retentionDays: number): string[] {
  const days: string[] = [];
  for (let offset = 1 - retentionDays; offset <= 0; offset += 1) days.push(shiftDay(today, offset));
  return days;
}

export function countUnread(
  items: readonly ItemRecord[],
  state: Record<string, ItemState>,
): { read: number; unread: number } {
  let read = 0;
  for (const item of items) if (state[item.id]?.readAt) read += 1;
  return { read, unread: items.length - read };
}
