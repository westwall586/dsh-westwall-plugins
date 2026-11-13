import type { Context } from '@deepseek-ai/cordis';
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {} from '@deepseek-ai/cordis-plugin-loader';
import type {} from '@deepseek-ai/cordis-plugin-timer';
import type {} from '@deepseek-ai/dsh-settings';
import type {
  ActResult,
  BindResult,
  CalendarView,
  DayView,
  FetchResult,
  ModelEffortsView,
  ModelsView,
  RssLibraryOp,
  RssLibraryView,
  SourcesView,
  StatusView,
  TranslateResult,
} from './contract/views.ts';
import type { ModelChoice } from './contract/types.ts';
import type { RssPreview } from './contract/rss-preview.ts';
import { runFetch } from './engine/fetch.ts';
import { collectModelEfforts, collectModels, type DefaultModelLike, type LlmLike } from './engine/models.ts';
import { fetchDecision } from './engine/schedule.ts';
import { createFeedUltraService, type FeedUltraService } from './service/index.ts';
import { FeedUltraError, type FeedUltraErrorCode } from './service/errors.ts';
import { Config, configSnapshot, hasChannelSettings, type FeedUltraConfig } from './settings.ts';
import { SOURCES } from './sources/registry.ts';
import { deleteBookmarkOnX } from './sources/x-bookmarks/index.ts';
import type { LlmTranslateService } from './translate/model.ts';

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'feedUltra/invalid-request': {};
    'feedUltra/workspace-unavailable': {};
    'feedUltra/source-unknown': {};
    'feedUltra/unsupported-action': {};
  }
}

type FeedUltraRemoteCode =
  | 'feedUltra/invalid-request'
  | 'feedUltra/workspace-unavailable'
  | 'feedUltra/source-unknown'
  | 'feedUltra/unsupported-action';

const REMOTE_CODES: Record<FeedUltraErrorCode, FeedUltraRemoteCode> = {
  unbound: 'feedUltra/workspace-unavailable',
  'invalid-workspace': 'feedUltra/workspace-unavailable',
  'invalid-date': 'feedUltra/invalid-request',
  'future-date': 'feedUltra/invalid-request',
  'invalid-range': 'feedUltra/invalid-request',
  'invalid-request': 'feedUltra/invalid-request',
  'invalid-input': 'feedUltra/invalid-request',
  'unknown-source': 'feedUltra/source-unknown',
  'unsupported-action': 'feedUltra/unsupported-action',
};

const DEFAULT_ENTRY_ID = 'dsh-feed-ultra';
const TICK_MS = 60_000;
const SOURCE_IDS = Object.freeze(Object.keys(SOURCES));

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class FeedUltra extends TypertRemoteService {
  static Config = Config;

  private readonly service: FeedUltraService;
  private readonly entryId: string;
  private migrationAttempted = false;

  constructor(ctx: Context, _validatedConfig: unknown) {
    super(ctx, 'feedUltra');
    this.entryId = ctx.fiber.entry?.options.id ?? DEFAULT_ENTRY_ID;
    this.service = createFeedUltraService({
      config: () => this.snapshot(),
      sources: SOURCES,
      now: () => new Date(),
      runFetch,
      llm: () => this.llmForTranslation(),
      readDefault: () => this.readDefaultSelection(),
      log: (message, level) => {
        if (level === 'warn') this.ctx.logger.warn(message);
        else if (level === 'error') this.ctx.logger.error(message);
        else this.ctx.logger.info(message);
      },
      deleteBookmark: (input) => deleteBookmarkOnX(input),
    });
    this.startScheduler(ctx);
    ctx.inject(['settings'], (scoped) => {
      void this.migrateConfig(scoped);
    });
  }

  /**
   * The loader's stored config, read fresh so live settings edits are visible.
   * The constructor's config is schema-validated, so its `sources` default hides
   * whether the stored document actually carries a channel subtree.
   */
  private get rawConfig(): unknown {
    return this.ctx.fiber.rawConfig;
  }

  async status(): Promise<StatusView> {
    return this.call(() => this.service.status());
  }

  async bindWorkspace(path: string): Promise<BindResult> {
    const result = await this.call(() => this.service.bindWorkspace(path));
    const settings = this.ctx.get('settings');
    if (!settings) {
      throw new RemoteError('feedUltra/workspace-unavailable', 'settings service is unavailable', {});
    }
    try {
      await settings.update(this.entryId, { workspacePath: result.workspace.path });
    } catch (error) {
      throw new RemoteError(
        'feedUltra/workspace-unavailable',
        `could not save the workspace binding: ${errorText(error)}`,
        {},
      );
    }
    return result;
  }

  async sources(): Promise<SourcesView> {
    return this.call(() => this.service.sources());
  }

  async day(date: string): Promise<DayView> {
    return this.call(() => this.service.day(date));
  }

  async calendar(from: string, to: string): Promise<CalendarView> {
    return this.call(() => this.service.calendar(from, to));
  }

  async act(action: string, ids: string[]): Promise<ActResult> {
    return this.call(() => this.service.act(action, ids));
  }

  async fetch(sourceId: string): Promise<FetchResult> {
    const result = await this.call(() => this.service.fetch(sourceId, 'manual'));
    if (result.status === 'ok') {
      const line =
        `feedUltra: fetch ${sourceId} ${result.day} translated=${result.translated}` +
        `${result.translationError ? ` translationError=${result.translationError}` : ''}`;
      if (result.translationError) this.ctx.logger.warn(line);
      else this.ctx.logger.info(line);
    }
    return result;
  }

  /** Backfill one past day; the trigger is host-owned, so the client can never spend the auto budget. */
  async backfill(sourceId: string, day: string): Promise<FetchResult> {
    const result = await this.call(() => this.service.fetch(sourceId, 'manual', day));
    const line = `feedUltra: backfill ${sourceId} ${day} status=${result.status}`;
    if (result.status === 'error') this.ctx.logger.warn(`${line} error=${result.error}`);
    else this.ctx.logger.info(`${line} count=${result.count ?? 0}`);
    return result;
  }

  async translate(sourceId: string, day: string): Promise<TranslateResult> {
    const result = await this.call(() => this.service.translate(sourceId, day));
    const line =
      `feedUltra: translate ${sourceId} ${day} translated=${result.translated} skipped=${result.skipped}` +
      ` failed=${result.failed}${result.error ? ` error=${result.error}` : ''}`;
    if (result.error) this.ctx.logger.warn(line);
    else this.ctx.logger.info(line);
    return result;
  }

  async rssLibrary(): Promise<RssLibraryView> {
    return this.call(() => this.service.rssLibrary());
  }

  async rssLibraryMutate(ops: RssLibraryOp[]): Promise<RssLibraryView> {
    return this.call(() => this.service.rssLibraryMutate(ops));
  }

  async rssPreview(url: string): Promise<RssPreview> {
    return this.call(() => this.service.rssPreview(url));
  }

  /** Catalog plus the effective selection: the client cannot read `agentDefaultModel` remotely. */
  async models(): Promise<ModelsView> {
    return this.call(() => {
      const config = this.snapshot();
      return collectModels({
        llm: this.llm(),
        following: config.model === null,
        readDefault: () => config.model ?? this.readDefaultSelection(),
      });
    });
  }

  async modelEfforts(provider: string, model: string): Promise<ModelEffortsView> {
    return this.call(() =>
      collectModelEfforts(this.llm(), String(provider ?? ''), String(model ?? '')),
    );
  }

  private snapshot(): FeedUltraConfig {
    return configSnapshot(this.rawConfig, { sourceIds: SOURCE_IDS });
  }

  private async call<T>(operation: () => Promise<T> | T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof FeedUltraError) {
        throw new RemoteError(REMOTE_CODES[error.code], error.message, {});
      }
      throw error;
    }
  }

  /**
   * Host services this plugin consumes structurally. `ctx.get` is cast once here instead of
   * augmenting the global Context: `dsh-llm` is intentionally not a package dependency.
   */
  private serviceOf<T>(name: 'llm' | 'agentDefaultModel'): T | null {
    const ctx = this.ctx as unknown as { get?: (key: string) => unknown };
    if (typeof ctx.get !== 'function') return null;
    const service = ctx.get(name);
    return service === undefined || service === null ? null : (service as T);
  }

  private llm(): LlmLike | null {
    return this.serviceOf<LlmLike>('llm');
  }

  private llmForTranslation(): LlmTranslateService | null {
    return this.serviceOf<LlmTranslateService>('llm');
  }

  private readDefaultSelection(): ModelChoice | null {
    const service = this.serviceOf<DefaultModelLike>('agentDefaultModel');
    if (service === null) return null;
    const selection = service.currentSelection();
    if (!selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
      return null;
    }
    return selection;
  }

  /**
   * One-shot persistence of the per-channel subtree, derived from the legacy global switch.
   * A failed write keeps the in-memory migration: the panel still works, the next boot retries.
   */
  private async migrateConfig(ctx: Context): Promise<void> {
    if (hasChannelSettings(this.rawConfig)) return;
    const settings = ctx.get('settings');
    if (!settings) return;
    if (this.migrationAttempted) return;
    this.migrationAttempted = true;

    const config = this.snapshot();
    try {
      await settings.update(this.entryId, { sources: config.sources });
      this.ctx.logger.info(
        `feedUltra: migrated ${Object.keys(config.sources).length} channel schedule(s) from autoFetch=${config.autoFetch}`,
      );
    } catch (error) {
      this.ctx.logger.warn(
        `feedUltra: could not persist the channel migration, using the in-memory one: ${errorText(error)}`,
      );
    }
  }

  private startScheduler(ctx: Context): void {
    const timer = ctx.get('timer');
    // Register the timer's disposer on this plugin's fiber; the TimerService alone would keep it on its own.
    if (timer) ctx.effect(() => timer.interval(() => void this.scheduleTick(), TICK_MS));
    queueMicrotask(() => void this.scheduleTick());
  }

  private async scheduleTick(): Promise<void> {
    try {
      const now = new Date();
      const status = await this.service.status();
      if (status.workspace.status !== 'ok') return;

      const view = await this.service.sources();
      for (const source of view.sources) {
        if (source.cadence !== 'daily') continue;
        const decision = fetchDecision({ health: source, schedule: source.schedule, now });
        const reason = decision.due ? '' : ` reason=${decision.reason}`;
        this.ctx.logger.info(`feedUltra: schedule ${source.id} due=${decision.due}${reason}`);
        if (!decision.due) continue;
        try {
          await this.service.fetch(source.id, 'auto');
        } catch (error) {
          this.ctx.logger.warn(`feedUltra: scheduled fetch failed for ${source.id}: ${errorText(error)}`);
        }
      }
    } catch (error) {
      this.ctx.logger.warn(`feedUltra: scheduler tick failed: ${errorText(error)}`);
    }
  }
}

const METHODS = [
  'status',
  'bindWorkspace',
  'sources',
  'day',
  'calendar',
  'act',
  'fetch',
  'backfill',
  'translate',
  'models',
  'modelEfforts',
  'rssLibrary',
  'rssLibraryMutate',
  'rssPreview',
] as const;

Object.defineProperty(FeedUltra.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  configurable: true,
  value: Object.freeze(
    structuredClone({ version: 1, methods: METHODS.map((method) => ({ method, invocation: { kind: 'direct' } })) }),
  ),
});

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 每日资讯 host service, registered by the plugin row. */
    feedUltra: FeedUltra;
  }
}
