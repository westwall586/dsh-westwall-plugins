import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { parseItemId } from '../contract/ids.ts';
import { EMPTY_RSS_LIBRARY, normalizeFeedUrl, type RssLibrary } from '../contract/rss-library.ts';
import type { FactFile, ItemRecord, ModelChoice } from '../contract/types.ts';
import type {
  ActItemResult,
  ActResult,
  BindResult,
  CalendarDay,
  CalendarView,
  DayView,
  FetchResult,
  FetchTrigger,
  RssChannelView,
  RssLibraryOp,
  RssLibraryView,
  SourceHealth,
  SourceTranslationView,
  SourcesView,
  StatusView,
  TranslateResult,
  TranslationView,
  WorkspaceView,
} from '../contract/views.ts';
import type { FetchLog, DeleteBookmarkInput, DeleteBookmarkOutcome, RssFeedRef } from '../sources/types.ts';
import type { FetchRequest, FetchSummary } from '../engine/fetch.ts';
import { channelConfig, type FeedUltraConfig } from '../settings.ts';
import type { SourceRuntime } from '../sources/registry.ts';
import { parseOpmlText } from '../sources/rss/parse.ts';
import { previewFeed } from '../sources/rss/preview.ts';
import { readDayCache } from '../store/cache.ts';
import { writeHealth } from '../store/day.ts';
import { findWindowItem, markItemDeleted, readWindowKeys } from '../store/facts.ts';
import { ensureLayout } from '../store/init.ts';
import { dayKeyOf, isDayKey, layout, shiftDay, type Layout } from '../store/paths.ts';
import { countUnread, readDayItemsSafe, readHealthSafe, windowDays, type DayFactResult } from '../store/read.ts';
import { createRssLibraryStore } from '../store/rss-library.ts';
import { createSerialGate } from '../store/serial.ts';
import { markRead } from '../store/state.ts';
import { readMergedState } from '../store/window.ts';
import { startBudget, TRANSLATE_BUDGET_MS } from '../translate/budget.ts';
import {
  translateDay,
  type TranslateDayInput,
  type TranslateDayResult,
  type TranslationOutcome,
} from '../translate/engine.ts';
import type { LlmTranslateService } from '../translate/model.ts';
import { displayTranslations, planTranslations } from '../translate/plan.ts';
import { FeedUltraError } from './errors.ts';
import { projectDay, sectionState, sourceHealthView, type ProjectedSource } from './project.ts';
import { applyOps, orderedFeeds, randomChannelId, rssLibraryView } from './rss-library.ts';
import type { RssPreview } from '../contract/rss-preview.ts';
import { sliceRssChannels } from './rss-sections.ts';

const MAX_CALENDAR_DAYS = 92;
const DAY_MS = 86_400_000;

export interface FeedUltraServiceDeps {
  config(): FeedUltraConfig;
  sources: Record<string, SourceRuntime>;
  now(): Date;
  runFetch(request: FetchRequest): Promise<FetchSummary>;
  /** Translation is not wired in tests that only exercise fetching. */
  llm?(): LlmTranslateService | null;
  readDefault?(): ModelChoice | null;
  /** Host log sink; manual channels narrate their browser stages through it. */
  log?(message: string, level: 'info' | 'warn' | 'error'): void;
  /** Remote bookmark deletion; injected so tests never launch a browser. */
  deleteBookmark?(input: DeleteBookmarkInput): Promise<DeleteBookmarkOutcome>;
  /** Test seam for the 60 second action budget. */
  budgetMs?: number;
  /** Test seam for the engine itself. */
  translate?(input: TranslateDayInput): Promise<TranslateDayResult>;
  /** Deterministic channel ids in tests; production uses `randomChannelId`. */
  newChannelId?(library: RssLibrary): string;
  /** Test seam for the read-only preview; production fetches the feed. */
  previewFeed?(url: string, name: string, now: string): Promise<RssPreview>;
}

export interface FeedUltraService {
  status(): Promise<StatusView>;
  bindWorkspace(path: string): Promise<BindResult>;
  sources(): Promise<SourcesView>;
  day(date: string): Promise<DayView>;
  calendar(from: string, to: string): Promise<CalendarView>;
  act(action: string, ids: readonly string[]): Promise<ActResult>;
  fetch(sourceId: string, trigger?: FetchTrigger, day?: string): Promise<FetchResult>;
  translate(sourceId: string, day: string): Promise<TranslateResult>;
  rssLibrary(): Promise<RssLibraryView>;
  rssLibraryMutate(ops: readonly RssLibraryOp[]): Promise<RssLibraryView>;
  rssPreview(url: string): Promise<RssPreview>;
}

function assertDay(date: string): void {
  if (!isDayKey(date)) throw new FeedUltraError('invalid-date', `invalid date: ${JSON.stringify(date)}`);
}

async function workspaceView(config: FeedUltraConfig): Promise<WorkspaceView> {
  const path = config.workspacePath;
  if (path.trim() === '') return { status: 'unbound', path };
  try {
    const info = await stat(path);
    return info.isDirectory() ? { status: 'ok', path } : { status: 'invalid', path };
  } catch {
    return { status: 'invalid', path };
  }
}

function requireBound(workspace: WorkspaceView): string {
  if (workspace.status === 'unbound') throw new FeedUltraError('unbound', 'no workspace is bound');
  if (workspace.status === 'invalid') {
    throw new FeedUltraError('invalid-workspace', `workspace is not a readable directory: ${workspace.path}`);
  }
  return workspace.path;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createFeedUltraService(deps: FeedUltraServiceDeps): FeedUltraService {
  const fetchGate = createSerialGate();
  const dayGate = createSerialGate();
  const translationErrors = new Map<string, string>();
  const runTranslate = deps.translate ?? translateDay;
  const runPreview = deps.previewFeed ?? previewFeed;
  const budgetMs = deps.budgetMs ?? TRANSLATE_BUDGET_MS;
  const libraryStore = createRssLibraryStore({ now: () => deps.now() });
  const libraryRecovered = new Map<string, string>();

  function translationKey(sourceId: string, day: string): string {
    return `${sourceId}\u0000${day}`;
  }

  function rememberTranslation(sourceId: string, day: string, outcome: TranslationOutcome): void {
    const key = translationKey(sourceId, day);
    if (outcome.failure !== null) {
      translationErrors.set(key, outcome.failure.error);
    } else if (outcome.failed === 0) {
      translationErrors.delete(key);
    }
  }

  function rememberTranslationFailure(sourceId: string, day: string, error: string): void {
    translationErrors.set(translationKey(sourceId, day), error);
  }

  function translationErrorOf(sourceId: string, day: string): string {
    return translationErrors.get(translationKey(sourceId, day)) ?? '';
  }

  function scheduleOf(config: FeedUltraConfig, sourceId: string) {
    const channel = channelConfig(config, sourceId);
    return { enabled: channel.scheduleEnabled, at: channel.scheduleAt };
  }

  function logLine(
    sourceId: string,
    message: string,
    fields: Record<string, unknown> = {},
    level: 'info' | 'warn' | 'error' = 'info',
  ): void {
    if (deps.log === undefined) return;
    const suffix = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    deps.log(`[feedUltra:${sourceId}] ${message}${suffix === '' ? '' : ` ${suffix}`}`, level);
  }

  function adapterLog(sourceId: string): FetchLog {
    return (message, fields = {}) => logLine(sourceId, message, fields, message === 'error' ? 'warn' : 'info');
  }

  function translationView(config: FeedUltraConfig, sourceId: string, missing: number, error: string): TranslationView {
    return { enabled: channelConfig(config, sourceId).translationEnabled, missing, error };
  }

  function sourceTranslationView(
    config: FeedUltraConfig,
    sourceId: string,
    missing: number,
    error: string,
  ): SourceTranslationView {
    return { ...translationView(config, sourceId, missing, error), model: config.model };
  }

  function llmService(): LlmTranslateService | null {
    return deps.llm === undefined ? null : deps.llm();
  }

  function defaultModel(): ModelChoice | null {
    return deps.readDefault === undefined ? null : deps.readDefault();
  }

  async function readLibrary(l: Layout): Promise<RssLibrary> {
    const read = await libraryStore.read(l);
    if (read.recoveredFrom !== undefined) libraryRecovered.set(l.root, read.recoveredFrom);
    return read.library;
  }

  async function readChannelSlices(l: Layout, date: string) {
    const library = await readLibrary(l);
    return sliceRssChannels(library, await readDayItemsSafe(l, date, 'rss'));
  }

  async function channelViews(
    l: Layout,
    today: string,
    config: FeedUltraConfig,
    state: Record<string, { readAt: string }>,
    cache: Awaited<ReturnType<typeof readDayCache>>,
  ): Promise<RssChannelView[]> {
    const runtime = deps.sources.rss;
    if (runtime?.pooled !== true) return [];
    const health = await readHealthSafe(l, 'rss');
    const slices = await readChannelSlices(l, today);
    return slices.map((slice) => {
      const projected: ProjectedSource = {
        source: { id: 'rss', name: slice.channel.name, type: 'rss' },
        cadence: 'daily',
        capabilities: runtime.capabilities,
        channelId: slice.channel.id,
        feedOutcome: slice.feedOutcome,
        fact: slice.fact,
        health,
        translation: translationView(
          config,
          'rss',
          planTranslations(cache, slice.items).missing,
          translationErrorOf('rss', today),
        ),
        texts: displayTranslations(cache, slice.items),
      };
      const view = sectionState({ date: today, today, state, source: projected });
      const status: RssChannelView['status'] =
        view.status === 'error' || view.status === 'corrupt'
          ? 'error'
          : view.status === 'ok' || view.status === 'empty'
            ? 'ok'
            : 'idle';
      return {
        id: slice.channel.id,
        name: slice.channel.name,
        feedCount: slice.feedUrls.length,
        todayCount: slice.items.length,
        unread: countUnread(slice.items, state).unread,
        status,
        error: view.fetch.error || slice.feedOutcome.error,
      };
    });
  }

  async function writeBackFeedNames(l: Layout, fact: FactFile): Promise<void> {
    const entries = fact.meta?.feeds;
    if (!Array.isArray(entries)) return;
    try {
      await libraryStore.mutate(l, (library) => {
        let changed = false;
        const feeds = library.feeds.map((feed) => {
          if (feed.name !== '') return feed;
          const entry = entries.find(
            (candidate) =>
              typeof candidate === 'object' &&
              candidate !== null &&
              (candidate as Record<string, unknown>).url === feed.url,
          ) as Record<string, unknown> | undefined;
          if (entry === undefined || entry.titleSource !== 'document') return feed;
          const title = entry.title;
          if (typeof title !== 'string' || title.trim() === '') return feed;
          changed = true;
          return { ...feed, name: title.trim().slice(0, 80) };
        });
        return changed ? { ...library, feeds } : library;
      });
      libraryRecovered.delete(l.root);
    } catch (error) {
      logLine('rss', 'library.name-writeback', { error: errorText(error) }, 'warn');
    }
  }

  async function rssLibrary(): Promise<RssLibraryView> {
    const workspace = await workspaceView(deps.config());
    if (workspace.status !== 'ok') {
      return rssLibraryView(EMPTY_RSS_LIBRARY, workspace.status === 'unbound' ? { unbound: true } : {});
    }
    const l = layout(workspace.path);
    const library = await readLibrary(l);
    const recovered = libraryRecovered.get(l.root);
    return rssLibraryView(library, recovered === undefined ? {} : { recoveredFrom: recovered });
  }

  async function clearRssCursors(l: Layout, urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    try {
      await fetchGate.run('rss', async () => {
        const health = await readHealthSafe(l, 'rss');
        if (health === null) return;
        const feeds = health.cursor?.feeds;
        if (typeof feeds !== 'object' || feeds === null || Array.isArray(feeds)) return;
        const nextFeeds = { ...(feeds as Record<string, unknown>) };
        let changed = false;
        for (const url of urls) {
          if (Object.hasOwn(nextFeeds, url)) {
            delete nextFeeds[url];
            changed = true;
          }
        }
        if (!changed) return;
        await writeHealth(l, 'rss', { ...health, cursor: { ...health.cursor, feeds: nextFeeds } });
      });
    } catch (error) {
      logLine('rss', 'library.cursor-clear', { error: errorText(error) }, 'warn');
    }
  }

  async function rssLibraryMutate(ops: readonly RssLibraryOp[]): Promise<RssLibraryView> {
    const workspace = await workspaceView(deps.config());
    if (workspace.status !== 'ok') {
      throw new FeedUltraError('invalid-workspace', 'no workspace is bound');
    }
    if (!Array.isArray(ops)) {
      throw new FeedUltraError('invalid-input', 'ops must be an array');
    }
    const l = layout(workspace.path);
    let unfiled: string[] = [];
    const result = await libraryStore.mutate(l, (library) => {
      const next = applyOps(library, ops, {
        at: deps.now().toISOString(),
        newChannelId: deps.newChannelId ?? randomChannelId,
        parseOpml: parseOpmlText,
      });
      const nextByUrl = new Map(next.library.feeds.map(feed => [feed.url, feed]));
      unfiled = library.feeds
        .filter((feed) => {
          const after = nextByUrl.get(feed.url);
          return after === undefined || (after.channel === '' && feed.channel !== '');
        })
        .map(feed => feed.url);
      return next;
    });
    if (unfiled.length > 0) await clearRssCursors(l, unfiled);
    libraryRecovered.delete(l.root);
    return rssLibraryView(result.library, {
      ...(result.recoveredFrom === undefined ? {} : { recoveredFrom: result.recoveredFrom }),
      ...(result.lastImport === undefined ? {} : { lastImport: result.lastImport }),
    });
  }

  async function translateItems(
    sourceId: string,
    day: string,
    l: Layout,
    items: readonly ItemRecord[],
    config: FeedUltraConfig,
  ): Promise<TranslateResult> {
    const budget = startBudget(budgetMs);
    try {
      const result = await dayGate.run(day, () =>
        runTranslate({
          l,
          day,
          today: dayKeyOf(deps.now()),
          items,
          retentionDays: config.retentionDays,
          llm: llmService(),
          model: config.model,
          readDefault: defaultModel,
          now: () => deps.now(),
          budget,
        }),
      );
      rememberTranslation(sourceId, day, result.outcome);
      return {
        sourceId,
        day,
        translated: result.outcome.translated,
        skipped: result.outcome.skipped,
        failed: result.outcome.failed,
        error: result.outcome.failure?.error ?? '',
      };
    } finally {
      budget.dispose();
    }
  }

  async function translateSafely(
    sourceId: string,
    day: string,
    l: Layout,
    items: readonly ItemRecord[],
    config: FeedUltraConfig,
  ): Promise<TranslateResult> {
    try {
      return await translateItems(sourceId, day, l, items, config);
    } catch (error) {
      const text = errorText(error);
      rememberTranslationFailure(sourceId, day, text);
      let plan = { skipped: 0, missing: items.length };
      try {
        plan = planTranslations(await readDayCache(l, day), items);
      } catch {
        // The cache is unreadable; the whole snapshot is still missing.
      }
      return { sourceId, day, translated: 0, skipped: plan.skipped, failed: plan.missing, error: text };
    }
  }

  async function status(): Promise<StatusView> {
    const config = deps.config();
    return {
      workspace: await workspaceView(config),
      today: dayKeyOf(deps.now()),
      retentionDays: config.retentionDays,
      autoFetch: config.autoFetch,
      sourceCount: Object.keys(deps.sources).length,
    };
  }

  async function bindWorkspace(path: string): Promise<BindResult> {
    const requested = typeof path === 'string' ? path.trim() : '';
    if (requested === '') throw new FeedUltraError('invalid-workspace', 'workspace path is required');

    try {
      const canonical = await realpath(requested);
      const info = await stat(canonical);
      if (!info.isDirectory()) throw new Error('not a directory');
      await access(canonical, constants.W_OK);
      const created = await ensureLayout(layout(canonical));
      return { workspace: { status: 'ok', path: canonical }, created: created.created };
    } catch {
      throw new FeedUltraError('invalid-workspace', `workspace is not a writable directory: ${requested}`);
    }
  }

  async function sources(): Promise<SourcesView> {
    const config = deps.config();
    const workspace = await workspaceView(config);
    const today = dayKeyOf(deps.now());

    if (workspace.status !== 'ok') {
      return {
        workspace,
        today,
        sources: Object.values(deps.sources).map((runtime) =>
          sourceHealthView({
            source: runtime.descriptor,
            cadence: runtime.cadence,
            capabilities: runtime.capabilities,
            health: null,
            todayFact: { kind: 'missing' },
            state: {},
            schedule: scheduleOf(config, runtime.descriptor.id),
            translation: sourceTranslationView(config, runtime.descriptor.id, 0, ''),
            batchSize: runtime.cadence === 'manual' ? channelConfig(config, runtime.descriptor.id).batchSize : undefined,
            now: deps.now(),
          }),
        ),
        rssChannels: [],
      };
    }

    const l = layout(workspace.path);
    const state = await readMergedState(l, windowDays(today, config.retentionDays));
    const cache = await readDayCache(l, today);
    const list: SourceHealth[] = [];
    for (const runtime of Object.values(deps.sources)) {
      const sourceId = runtime.descriptor.id;
      const health = await readHealthSafe(l, sourceId);
      const todayFact = await readDayItemsSafe(l, today, sourceId);
      const missing = todayFact.kind === 'ok' ? planTranslations(cache, todayFact.fact.items).missing : 0;
      list.push(
        sourceHealthView({
          source: runtime.descriptor,
          cadence: runtime.cadence,
          capabilities: runtime.capabilities,
          health,
          todayFact,
          state,
          schedule: scheduleOf(config, sourceId),
          translation: sourceTranslationView(config, sourceId, missing, translationErrorOf(sourceId, today)),
          batchSize: runtime.cadence === 'manual' ? channelConfig(config, sourceId).batchSize : undefined,
          now: deps.now(),
        }),
      );
    }
    return {
      workspace,
      today,
      sources: list,
      rssChannels: await channelViews(l, today, config, state, cache),
    };
  }

  async function day(date: string): Promise<DayView> {
    const config = deps.config();
    const today = dayKeyOf(deps.now());
    assertDay(date);
    if (date > today) throw new FeedUltraError('future-date', `date is in the future: ${date}`);

    const workspace = await workspaceView(config);
    if (workspace.status !== 'ok') {
      return { date, today, workspace, sections: [], total: 0, read: 0, unread: 0 };
    }

    const l = layout(workspace.path);
    const state = await readMergedState(l, windowDays(today, config.retentionDays));
    const cache = await readDayCache(l, date);
    const projected: ProjectedSource[] = [];
    for (const runtime of Object.values(deps.sources)) {
      const sourceId = runtime.descriptor.id;
      if (runtime.pooled === true) {
        const health = await readHealthSafe(l, sourceId);
        for (const slice of await readChannelSlices(l, date)) {
          const plan = planTranslations(cache, slice.items);
          projected.push({
            source: { id: 'rss', name: slice.channel.name, type: 'rss' },
            cadence: 'daily',
            capabilities: runtime.capabilities,
            channelId: slice.channel.id,
            feedOutcome: slice.feedOutcome,
            fact: slice.fact,
            health,
            translation: translationView(config, 'rss', plan.missing, translationErrorOf('rss', date)),
            texts: displayTranslations(cache, slice.items),
          });
        }
        continue;
      }
      const fact = await readDayItemsSafe(l, date, sourceId);
      const items = fact.kind === 'ok' ? fact.fact.items : [];
      const plan = planTranslations(cache, items);
      projected.push({
        source: runtime.descriptor,
        cadence: runtime.cadence,
        capabilities: runtime.capabilities,
        fact,
        health: await readHealthSafe(l, sourceId),
        translation: translationView(config, sourceId, plan.missing, translationErrorOf(sourceId, date)),
        batchSize: runtime.cadence === 'manual' ? channelConfig(config, sourceId).batchSize : undefined,
        texts: displayTranslations(cache, items),
      });
    }
    return projectDay({ date, today, workspace, state, sources: projected });
  }

  async function calendar(from: string, to: string): Promise<CalendarView> {
    const config = deps.config();
    const today = dayKeyOf(deps.now());
    assertDay(from);
    assertDay(to);
    if (from > to) throw new FeedUltraError('invalid-range', `calendar range is reversed: ${from}..${to}`);

    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
    if (span > MAX_CALENDAR_DAYS) {
      throw new FeedUltraError('invalid-range', `calendar range exceeds ${MAX_CALENDAR_DAYS} days: ${from}..${to}`);
    }

    const workspace = await workspaceView(config);
    if (workspace.status !== 'ok') return { from, to, today, days: [] };

    const l = layout(workspace.path);
    const state = await readMergedState(l, windowDays(today, config.retentionDays));
    // A feed moved back to the inbox stops counting, so a day view and a calendar dot agree.
    const subscribedUrls =
      deps.sources.rss?.pooled === true
        ? new Set(
            (await readLibrary(l)).feeds
              .filter((feed) => feed.channel !== '')
              .map((feed) => feed.url),
          )
        : new Set<string>();
    const days: CalendarDay[] = [];
    for (let current = from; current <= to; current = shiftDay(current, 1)) {
      let total = 0;
      let read = 0;
      let present = false;
      for (const runtime of Object.values(deps.sources)) {
        const fact = await readDayItemsSafe(l, current, runtime.descriptor.id);
        // An empty snapshot is a "no brief published" marker, not a day with data.
        if (fact.kind !== 'ok') continue;
        const items =
          runtime.pooled === true
            ? fact.fact.items.filter(
                (item) => typeof item.extra.feedUrl === 'string' && subscribedUrls.has(item.extra.feedUrl),
              )
            : fact.fact.items;
        if (items.length === 0) continue;
        present = true;
        total += items.length;
        read += countUnread(items, state).read;
      }
      const unread = total - read;
      days.push({ day: current, state: !present ? 'missing' : unread > 0 ? 'present' : 'read', total, unread });
    }
    return { from, to, today, days };
  }

  function parseIds(ids: readonly string[]): Array<{ id: string; sourceId: string; naturalKey: string }> {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      throw new FeedUltraError('invalid-request', 'ids must be a non-empty array of strings');
    }
    return [...new Set(ids)].map((id) => {
      let parsed;
      try {
        parsed = parseItemId(id);
      } catch {
        throw new FeedUltraError('invalid-request', `invalid item id: ${JSON.stringify(id)}`);
      }
      if (!deps.sources[parsed.sourceId]) {
        throw new FeedUltraError('unknown-source', `unknown source: ${JSON.stringify(parsed.sourceId)}`);
      }
      return { id, sourceId: parsed.sourceId, naturalKey: parsed.naturalKey };
    });
  }

  async function readItems(root: string, ids: readonly string[]): Promise<ActResult> {
    const unique = parseIds(ids).map((item) => item.id);
    const now = deps.now();
    const results = await markRead(layout(root), dayKeyOf(now), unique, now.toISOString());
    return { action: 'read', results };
  }

  async function deleteBookmarks(root: string, ids: readonly string[]): Promise<ActResult> {
    const parsed = parseIds(ids);
    const sourceId = parsed[0].sourceId;
    if (parsed.some((item) => item.sourceId !== sourceId)) {
      throw new FeedUltraError('invalid-request', 'deleteBookmark requires items from one source');
    }
    const runtime = deps.sources[sourceId];
    if (!runtime.capabilities.actions?.includes('deleteBookmark')) {
      throw new FeedUltraError('unsupported-action', `source ${JSON.stringify(sourceId)} does not support deleteBookmark`);
    }
    const deleteRemote = deps.deleteBookmark;
    if (deleteRemote === undefined) {
      throw new FeedUltraError('unsupported-action', 'deleteBookmark is not available in this host');
    }

    const config = deps.config();
    const l = layout(root);
    const now = deps.now();
    const at = now.toISOString();
    const days = windowDays(dayKeyOf(now), config.retentionDays);
    const browserPath = channelConfig(config, sourceId).egoBrowserPath;

    return fetchGate.run(sourceId, async () => {
      const results: ActItemResult[] = [];
      for (const { id, naturalKey } of parsed) {
        const started = Date.now();
        try {
          let url = `https://x.com/i/status/${naturalKey}`;
          try {
            const item = await findWindowItem(l, sourceId, days, id);
            if (item) url = item.url;
          } catch {
            // An unreadable day must not stop a remote delete; the fallback URL is enough.
          }

          const outcome = await deleteRemote({ url, browserPath, log: adapterLog(sourceId) });
          if (!outcome.ok) {
            logLine(
              sourceId,
              'delete',
              { id, outcome: 'error', kind: outcome.kind ?? 'drift', evidencePath: outcome.evidencePath, ms: Date.now() - started },
              'warn',
            );
            results.push({ id, status: 'error', error: outcome.error ?? '删除书签失败' });
            continue;
          }

          try {
            await markItemDeleted(l, sourceId, days, id, at);
          } catch {
            logLine(
              sourceId,
              'delete',
              { id, outcome: 'local-write-failed', kind: 'local-write', ms: Date.now() - started },
              'warn',
            );
            results.push({ id, status: 'error', error: '已从 X 删除，本地标记失败' });
            continue;
          }

          // A deleted bookmark has been dealt with, so the card gets the same read stamp a click writes.
          // The read stamp is best effort: failing it must not overturn a delete that already happened on X.
          try {
            await markRead(l, dayKeyOf(now), [id], at);
          } catch (error) {
            logLine(sourceId, 'delete', { id, outcome: 'local-read-failed', error: errorText(error) }, 'warn');
          }

          logLine(sourceId, 'delete', {
            id,
            outcome: outcome.alreadyDeleted ? 'already' : 'deleted',
            kind: 'ok',
            local: 'ok',
            ms: Date.now() - started,
          });
          results.push({ id, status: 'ok', deletedAt: at });
        } catch (error) {
          logLine(
            sourceId,
            'delete',
            { id, outcome: 'error', kind: 'unexpected', error: errorText(error), ms: Date.now() - started },
            'warn',
          );
          results.push({ id, status: 'error', error: errorText(error) });
        }
      }
      return { action: 'deleteBookmark', results };
    });
  }

  async function act(action: string, ids: readonly string[]): Promise<ActResult> {
    const root = requireBound(await workspaceView(deps.config()));
    if (action === 'read') return readItems(root, ids);
    if (action === 'deleteBookmark') return deleteBookmarks(root, ids);
    throw new FeedUltraError('unsupported-action', `unsupported action: ${JSON.stringify(action)}`);
  }

  /**
   * Fetch releases the source queue before translation takes the day gate; the two never nest.
   * The trigger is host-owned; the client can only ask for today or name a backfill day.
   */
  async function fetch(sourceId: string, trigger: FetchTrigger = 'manual', requestedDay?: string): Promise<FetchResult> {
    const config = deps.config();
    const root = requireBound(await workspaceView(config));
    const source = deps.sources[sourceId];
    if (!source) throw new FeedUltraError('unknown-source', `unknown source: ${JSON.stringify(sourceId)}`);

    const now = deps.now();
    const today = dayKeyOf(now);
    const day = requestedDay ?? today;
    assertDay(day);
    if (day > today) throw new FeedUltraError('invalid-date', `date is in the future: ${day}`);
    if (day !== today) {
      if (!source.capabilities.backfill) {
        throw new FeedUltraError('unsupported-action', `source ${JSON.stringify(sourceId)} does not support backfill`);
      }
      const oldest = shiftDay(today, 1 - config.retentionDays);
      if (day < oldest) {
        throw new FeedUltraError(
          'invalid-date',
          `date is outside the ${config.retentionDays}-day retention window: ${day}`,
        );
      }
    }

    const l = layout(root);
    const manual = source.cadence === 'manual';
    const accumulating = source.adapter.writeMode === 'accumulate';
    const summary = await fetchGate.run(sourceId, async () => {
      // Exclusion and snapshot write share the queue, so two quick clicks cannot read the same set.
      const excludeKeys = accumulating
        ? await readWindowKeys(l, sourceId, windowDays(today, config.retentionDays))
        : new Set<string>();
      const feeds = source.pooled === true ? orderedFeeds(await readLibrary(l)) : undefined;
      return deps.runFetch({
        root,
        adapter: source.adapter,
        source: source.descriptor,
        day,
        retentionDays: config.retentionDays,
        trigger,
        locale: channelConfig(config, sourceId).locale,
        excludeKeys,
        batchSize: manual ? channelConfig(config, sourceId).batchSize : 0,
        ...(feeds === undefined ? {} : { feeds }),
        browserPath: channelConfig(config, sourceId).egoBrowserPath,
        ...(manual ? { log: adapterLog(sourceId) } : {}),
        now,
      });
    });

    if (summary.status === 'error') return { sourceId, day, status: 'error', error: summary.error };
    if (summary.status === 'pending') return { sourceId, day, status: 'pending' };
    if (summary.status === 'notPublished') return { sourceId, day, status: 'notPublished' };

    const flags = {
      added: summary.added,
      ...(summary.scanned === undefined ? {} : { scanned: summary.scanned }),
      ...(summary.exhausted === undefined ? {} : { exhausted: summary.exhausted }),
      ...(summary.truncated === undefined ? {} : { truncated: summary.truncated }),
    };

    let fact: DayFactResult;
    try {
      fact = await readDayItemsSafe(l, day, sourceId);
    } catch (error) {
      return {
        sourceId,
        day,
        status: 'ok',
        count: summary.count,
        ...flags,
        translated: 0,
        translationError: errorText(error),
      };
    }
    if (source.pooled === true && day === today && fact.kind === 'ok') {
      await writeBackFeedNames(l, fact.fact);
    }
    if (
      day !== today ||
      !source.capabilities.translation ||
      deps.llm === undefined ||
      !channelConfig(config, sourceId).translationEnabled ||
      fact.kind !== 'ok' ||
      fact.fact.items.length === 0
    ) {
      return {
        sourceId,
        day,
        status: 'ok',
        count: summary.count,
        ...flags,
        translated: 0,
        translationError: '',
      };
    }

    const result = await translateSafely(sourceId, day, l, fact.fact.items, config);
    return {
      sourceId,
      day,
      status: 'ok',
      count: summary.count,
      ...flags,
      translated: result.translated,
      translationError: result.error,
    };
  }

  async function rssPreview(url: string): Promise<RssPreview> {
    const workspace = await workspaceView(deps.config());
    if (workspace.status !== 'ok') throw new FeedUltraError('invalid-workspace', 'no workspace is bound');
    if (typeof url !== 'string') throw new FeedUltraError('invalid-input', 'url must be a string');
    const normalized = normalizeFeedUrl(url);
    if (normalized === null) throw new FeedUltraError('invalid-input', `invalid feed URL: ${JSON.stringify(url)}`);
    const library = await readLibrary(layout(workspace.path));
    const feed = library.feeds.find(candidate => candidate.url === normalized);
    if (feed === undefined) throw new FeedUltraError('invalid-input', 'feed is not in the library');
    return runPreview(feed.url, feed.name, deps.now().toISOString());
  }

  async function translate(sourceId: string, day: string): Promise<TranslateResult> {
    const config = deps.config();
    const root = requireBound(await workspaceView(config));
    const source = deps.sources[sourceId];
    if (!source) throw new FeedUltraError('unknown-source', `unknown source: ${JSON.stringify(sourceId)}`);
    if (!source.capabilities.translation) {
      throw new FeedUltraError('unsupported-action', `source ${JSON.stringify(sourceId)} does not support translation`);
    }
    assertDay(day);
    if (day > dayKeyOf(deps.now())) throw new FeedUltraError('future-date', `date is in the future: ${day}`);

    if (!channelConfig(config, sourceId).translationEnabled) {
      return { sourceId, day, translated: 0, skipped: 0, failed: 0, error: '' };
    }

    const l = layout(root);
    const fact = await readDayItemsSafe(l, day, sourceId);
    if (fact.kind !== 'ok' || fact.fact.items.length === 0) {
      return { sourceId, day, translated: 0, skipped: 0, failed: 0, error: '' };
    }

    return translateSafely(sourceId, day, l, fact.fact.items, config);
  }

  return { status, bindWorkspace, sources, day, calendar, act, fetch, translate, rssLibrary, rssLibraryMutate, rssPreview };
}
