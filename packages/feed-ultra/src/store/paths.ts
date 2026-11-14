import path from 'node:path';

/** Absolute paths of the `.dsh-feeds` tree inside a bound workspace. */
export interface Layout {
  root: string;
  data: string;
  items: string;
  state: string;
  cache: string;
  health: string;
  feedback: string;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function layout(workspaceRoot: string): Layout {
  const root = path.resolve(workspaceRoot, '.dsh-feeds');
  const data = path.join(root, 'data');
  return {
    root,
    data,
    items: path.join(data, 'items'),
    state: path.join(data, 'state'),
    cache: path.join(data, 'cache'),
    health: path.join(root, 'health'),
    feedback: path.join(data, 'feedback.jsonl'),
  };
}

export function isDayKey(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assertDayKey(value: string): string {
  if (!isDayKey(value)) throw new Error(`invalid day key: ${JSON.stringify(value)}`);
  return value;
}

export function assertSourceId(value: string): string {
  if (!SOURCE_ID_PATTERN.test(value)) throw new Error(`invalid source id: ${JSON.stringify(value)}`);
  return value;
}

export function dayKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${assertDayKey(day)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function itemDayDir(l: Layout, day: string): string {
  return path.join(l.items, assertDayKey(day));
}

export function itemFile(l: Layout, day: string, sourceId: string): string {
  return path.join(itemDayDir(l, day), `${assertSourceId(sourceId)}.json`);
}

export function stateFile(l: Layout, day: string): string {
  return path.join(l.state, `${assertDayKey(day)}.json`);
}

export function cacheFile(l: Layout, day: string): string {
  return path.join(l.cache, `${assertDayKey(day)}.json`);
}

export function healthFile(l: Layout, sourceId: string): string {
  return path.join(l.health, `${assertSourceId(sourceId)}.json`);
}

/** Workspace-scoped channel and feed table. */
export function rssLibraryFile(l: Layout): string {
  return path.join(l.data, 'rss-library.json');
}

export function rssLibraryCorruptFile(l: Layout, at: string): string {
  return path.join(l.data, `rss-library.corrupt-${at.replaceAll(':', '-')}.json`);
}
