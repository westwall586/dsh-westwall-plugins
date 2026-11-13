import path from 'node:path';
import { parseRssLibrary } from '../contract/rss-library.ts';
import type { ItemRecord } from '../contract/types.ts';
import { runFetch } from '../engine/fetch.ts';
import { orderedFeeds } from '../service/rss-library.ts';
import { descriptor as githubTrendingSource } from '../sources/github-trending/index.ts';
import { githubTrendingExtraSchema } from '../sources/github-trending/parse.ts';
import { sourceOrThrow } from '../sources/registry.ts';
import { DEFAULT_LOCALE } from '../settings.ts';
import { readDayItems } from '../store/day.ts';
import { dayKeyOf, layout, rssLibraryFile } from '../store/paths.ts';
import { readJsonSafe } from '../store/read.ts';

const RETENTION_DAYS = 30;
const DEFAULT_SOURCE_ID = githubTrendingSource.id;

function renderRow(item: ItemRecord): string[] {
  const extra = githubTrendingExtraSchema.parse(item.extra);
  return [String(extra.rank), item.title, extra.starsToday.toLocaleString('en-US'), extra.language || '-'];
}

interface CliOptions {
  out: string;
  sourceId: string;
  day: string | undefined;
}

const USAGE = 'usage: node src/dev/fetch.ts --out <dir> [--source <id>] [--day YYYY-MM-DD]';

function parseArgs(argv: string[]): CliOptions {
  let out: string | undefined;
  let sourceId = DEFAULT_SOURCE_ID;
  let day: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      out = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (arg === '--source') {
      sourceId = argv[index + 1] ?? sourceId;
      index += 1;
    } else if (arg.startsWith('--source=')) {
      sourceId = arg.slice('--source='.length);
    } else if (arg === '--day') {
      day = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--day=')) {
      day = arg.slice('--day='.length);
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    }
  }

  if (!out) throw new Error(`missing required --out <dir>\n${USAGE}`);
  return { out: path.resolve(out), sourceId, day };
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)));
  const line = (row: string[]) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)].join('\n');
}

function renderBestblogsRow(item: ItemRecord): string[] {
  const extra = item.extra;
  const source = typeof extra.source === 'string' ? extra.source : '-';
  const score = typeof extra.score === 'number' ? String(extra.score) : '-';
  const kind = typeof extra.kind === 'string' ? extra.kind : 'article';
  return [item.title, source, score, kind];
}

function renderTweetRow(item: ItemRecord): string[] {
  const extra = item.extra;
  const handle = typeof extra.handle === 'string' && extra.handle !== '' ? `@${extra.handle}` : '-';
  const likes = typeof extra.favorites === 'number' ? String(extra.favorites) : '-';
  const views = typeof extra.views === 'number' ? String(extra.views) : '-';
  return [handle, likes, views, item.title];
}

function renderRssRow(item: ItemRecord): string[] {
  const extra = item.extra;
  const feed = typeof extra.feedTitle === 'string' && extra.feedTitle !== '' ? extra.feedTitle : '-';
  return [feed, item.publishedAt, item.title];
}

async function subscribedFeeds(out: string) {
  const raw = await readJsonSafe(rssLibraryFile(layout(out)));
  if (raw.status !== 'ok') return [];
  return orderedFeeds(parseRssLibrary(raw.value));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const entry = sourceOrThrow(options.sourceId);
  const day = options.day ?? dayKeyOf(new Date());
  const manual = entry.cadence === 'manual';
  const rss = entry.descriptor.type === 'rss';
  const feeds = rss ? await subscribedFeeds(options.out) : undefined;
  if (rss && (feeds?.length ?? 0) === 0) {
    console.error(`no subscribed RSS feeds in ${rssLibraryFile(layout(options.out))}`);
    process.exitCode = 1;
    return;
  }
  const summary = await runFetch({
    root: options.out,
    adapter: entry.adapter,
    source: entry.descriptor,
    day,
    retentionDays: RETENTION_DAYS,
    trigger: 'manual',
    locale: DEFAULT_LOCALE,
    // The CLI pulls a fresh batch; it has no window to skip against.
    excludeKeys: new Set(),
    batchSize: manual ? 3 : 0,
    ...(feeds === undefined ? {} : { feeds }),
    ...(manual ? { log: (message: string, fields?: Record<string, unknown>) => {
      console.log(`[${message}]`, JSON.stringify(fields ?? {}));
    } } : {}),
  });

  if (summary.status !== 'ok') {
    const detail = summary.status === 'error' ? `: ${summary.error}` : '';
    console.error(`fetch ${summary.status} for ${summary.day}${detail}`);
    if (summary.status === 'error') process.exitCode = 1;
    return;
  }

  const l = layout(options.out);
  const fact = await readDayItems(l, day, entry.descriptor.id);
  if (!fact) throw new Error(`expected ${day} data after a successful fetch`);

  console.log(`${fact.source.name} · ${day} · ${fact.items.length} items`);
  const brief = entry.descriptor.type === 'bestblogs-brief';
  const tweet = entry.descriptor.type === 'x-bookmarks';
  const header = brief
    ? ['#', 'title', 'source', 'score', 'kind']
    : tweet
      ? ['#', 'handle', 'likes', 'views', 'text']
      : rss
        ? ['#', 'feed', 'published', 'title']
        : ['#', 'repo', 'stars today', 'language'];
  const rows = brief
    ? fact.items.map((item, index) => [String(index + 1), ...renderBestblogsRow(item)])
    : tweet
      ? fact.items.map((item, index) => [String(index + 1), ...renderTweetRow(item)])
      : rss
        ? fact.items.map((item, index) => [String(index + 1), ...renderRssRow(item)])
        : fact.items.map(renderRow);
  console.log(renderTable(header, rows));
  console.log(`data: ${path.join(l.items, day, `${entry.descriptor.id}.json`)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
