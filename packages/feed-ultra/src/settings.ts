import z from '@deepseek-ai/schemastery';

import type { ModelChoice } from './contract/types.ts';

export type { ModelChoice };

/** Fallback for a channel whose schedule time is missing or malformed. */
export const DEFAULT_SCHEDULE_AT = '08:00';

/** Channel edition default; zh and en can be separate selections, not translations. */
export const DEFAULT_LOCALE = 'zh';

/** Manual channels pull this many new items unless the channel settings say otherwise. */
export const DEFAULT_BATCH_SIZE = 3;

export const MAX_BATCH_SIZE = 20;

export type ChannelLocale = 'zh' | 'en';

const SCHEDULE_AT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// `locale` is a plain string at the schema boundary so a corrupt stored value falls back
// to zh in `configSnapshot` instead of invalidating the whole config.
const ChannelSettings = z.object({
  scheduleEnabled: z.boolean().default(true),
  scheduleAt: z.string().default(DEFAULT_SCHEDULE_AT),
  translationEnabled: z.boolean().default(true),
  locale: z.string().default(DEFAULT_LOCALE),
  batchSize: z.number().min(1).max(MAX_BATCH_SIZE).step(1).default(DEFAULT_BATCH_SIZE),
  egoBrowserPath: z.string().default(''),
});

const ModelChoiceSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
});

/** Live, machine-local leaves; the host Settings service edits them without reloading the plugin. */
export const Config = z.object({
  workspacePath: z.string().default('').volatile(),
  retentionDays: z.number().min(1).max(365).default(30).volatile(),
  /** Whole subtree volatile: one channel leaf is edited at a time and the plugin stays mounted. */
  sources: z.dict(ChannelSettings).default({}).volatile(),
  /** Explicit model choice; `null` means "follow the DSH default selection". */
  model: z.union([ModelChoiceSchema, z.const(null)]).default(null).volatile(),
  /** Legacy global switch: read once for migration, hidden from the settings form. */
  autoFetch: z.boolean().default(true).volatile().hidden(),
});

export interface ChannelSettingsConfig {
  scheduleEnabled: boolean;
  scheduleAt: string;
  translationEnabled: boolean;
  locale: ChannelLocale;
  /** Manual pull size; 1..20. */
  batchSize: number;
  /** Browser executable override for channels that drive Ego Browser. */
  egoBrowserPath: string;
}

export interface FeedUltraConfig {
  workspacePath: string;
  retentionDays: number;
  /** Keyed by registered source id; unknown ids are never read or surfaced. */
  sources: Record<string, ChannelSettingsConfig>;
  model: ModelChoice | null;
  /** Kept one iteration for migration only; the scheduler no longer reads it. */
  autoFetch: boolean;
}

export interface SnapshotOptions {
  /** Registered source ids, in registry order. Unknown configured ids are dropped. */
  sourceIds: readonly string[];
}

const CHANNEL_DEFAULTS: ChannelSettingsConfig = {
  scheduleEnabled: true,
  scheduleAt: DEFAULT_SCHEDULE_AT,
  translationEnabled: true,
  locale: DEFAULT_LOCALE,
  batchSize: DEFAULT_BATCH_SIZE,
  egoBrowserPath: '',
};

function deref(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { get?: unknown };
    if (typeof candidate.get === 'function') return (candidate.get as () => unknown)();
  }
  return value;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  const node = deref(value);
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
  return node as Record<string, unknown>;
}

/** `HH:mm` in `[00:00, 23:59]`, otherwise the fallback; a corrupt value must not break the panel. */
export function scheduleAtOrDefault(value: unknown, fallback: string = DEFAULT_SCHEDULE_AT): string {
  if (typeof value === 'string' && SCHEDULE_AT_PATTERN.test(value)) return value;
  return fallback;
}

function localeOrDefault(value: unknown): ChannelLocale {
  const raw = deref(value);
  return raw === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** A stored value outside 1..20, a float, or a non-number falls back without failing the config. */
export function batchSizeOrDefault(value: unknown, fallback: number = DEFAULT_BATCH_SIZE): number {
  const raw = deref(value);
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_BATCH_SIZE ? raw : fallback;
}

function pathOrDefault(value: unknown): string {
  const raw = deref(value);
  return typeof raw === 'string' ? raw : '';
}

function normalizeChannel(value: unknown, scheduleEnabledFallback: boolean): ChannelSettingsConfig {
  const node = recordOf(value);
  const enabled = node === null ? undefined : deref(node.scheduleEnabled);
  const at = node === null ? undefined : deref(node.scheduleAt);
  const translation = node === null ? undefined : deref(node.translationEnabled);
  const locale = node === null ? undefined : node.locale;
  const batchSize = node === null ? undefined : deref(node.batchSize);
  const egoBrowserPath = node === null ? undefined : node.egoBrowserPath;

  return {
    scheduleEnabled: typeof enabled === 'boolean' ? enabled : scheduleEnabledFallback,
    scheduleAt: scheduleAtOrDefault(at),
    translationEnabled: typeof translation === 'boolean' ? translation : true,
    locale: localeOrDefault(locale),
    batchSize: batchSizeOrDefault(batchSize),
    egoBrowserPath: pathOrDefault(egoBrowserPath),
  };
}

function modelOf(value: unknown): ModelChoice | null {
  const node = recordOf(value);
  if (node === null) return null;

  const provider = deref(node.provider);
  const model = deref(node.model);
  if (typeof provider !== 'string' || provider === '') return null;
  if (typeof model !== 'string' || model === '') return null;

  const effort = deref(node.reasoningEffort);
  return typeof effort === 'string' && effort !== ''
    ? { provider, model, reasoningEffort: effort }
    : { provider, model };
}

/** Whether the stored config already carries the per-channel subtree (i.e. migration is done). */
export function hasChannelSettings(raw: unknown): boolean {
  const source = recordOf(raw);
  return source !== null && recordOf(source.sources) !== null;
}

/**
 * Read a fresh snapshot every call: volatile leaves change while the plugin stays loaded.
 * This is also the migration point: without a `sources` subtree every registered channel
 * inherits the legacy global `autoFetch` switch.
 */
export function configSnapshot(raw: unknown, options: SnapshotOptions): FeedUltraConfig {
  const source = recordOf(raw) ?? {};

  const workspacePath = deref(source.workspacePath);
  const retentionDays = deref(source.retentionDays);
  const autoFetchRaw = deref(source.autoFetch);
  const autoFetch = typeof autoFetchRaw === 'boolean' ? autoFetchRaw : true;
  const sourcesNode = recordOf(source.sources);
  // Migration only applies while no subtree exists: an existing subtree ignores `autoFetch` entirely,
  // so a newly registered channel starts from the product default instead of inheriting a dead switch.
  const fallbackEnabled = sourcesNode === null ? autoFetch : CHANNEL_DEFAULTS.scheduleEnabled;

  const sources: Record<string, ChannelSettingsConfig> = {};
  for (const sourceId of options.sourceIds) {
    sources[sourceId] = normalizeChannel(sourcesNode?.[sourceId], fallbackEnabled);
  }

  return {
    workspacePath: typeof workspacePath === 'string' ? workspacePath : '',
    retentionDays:
      typeof retentionDays === 'number' && Number.isFinite(retentionDays) ? retentionDays : 30,
    sources,
    model: modelOf(source.model),
    autoFetch,
  };
}

/** Channel settings for one source; missing entries fall back to the product defaults. */
export function channelConfig(config: FeedUltraConfig, sourceId: string): ChannelSettingsConfig {
  return config.sources[sourceId] ?? CHANNEL_DEFAULTS;
}
