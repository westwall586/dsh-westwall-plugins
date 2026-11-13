/** Domain shapes of the on-disk contract. `schema.ts` validates every file against these. */

export interface SourceDescriptor {
  id: string;
  name: string;
  type: string;
}

/** A write action a channel exposes to the panel besides marking an item read. */
export type SourceAction = 'deleteBookmark';

/** What one channel can do. The source registry owns the only source-id to capability mapping. */
export interface SourceCapabilities {
  backfill: boolean;
  translation: boolean;
  locales?: readonly string[];
  minScheduleAt?: string;
  actions?: readonly SourceAction[];
  /** Manual channels pull a small batch from their own section header. */
  manualBatch?: boolean;
  /** What a daily source's zero-item fact means; manual sources always read as empty. */
  emptyState?: 'empty' | 'notPublished';
}

export interface FetchStatus {
  lastAttemptAt: string;
  lastSuccessAt: string;
  status: 'ok' | 'error';
  error: string;
}

export interface ItemRecord {
  id: string;
  naturalKey: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  dayKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  extra: Record<string, unknown>;
}

/** One source's facts for one day: `data/items/<day>/<sourceId>.json`. */
export interface FactFile {
  version: 1;
  source: SourceDescriptor;
  day: string;
  fetch: FetchStatus;
  /** Channel-owned facts about the snapshot (episode header, degradation, empty day). */
  meta?: Record<string, unknown>;
  items: ItemRecord[];
}

export interface ItemState {
  readAt: string;
}

/** One write day of state: `data/state/<day>.json`. */
export interface StateFile {
  version: 1;
  day: string;
  items: Record<string, ItemState>;
}

/** An explicitly selected AI model; absent means "follow the DSH default selection". */
export interface ModelChoice {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** One translated description. `hash` is the only key that authorizes display. */
export interface TranslationRecord {
  hash: string;
  lang: 'zh-CN';
  text: string;
  /** `provider/model` at call time. Provenance, never a validity key. */
  model: string;
  promptVersion: string;
  /** When the model produced the text; a cross-day reuse copies it verbatim. */
  at: string;
}

/** One write day of model products: `data/cache/<day>.json`, keyed by item id. */
export interface CacheFile {
  version: 1;
  day: string;
  items: Record<string, TranslationRecord>;
}

/** Automatic fetch attempts already spent on one local day. Manual fetches never count. */
export interface AutoAttempts {
  /** Local day key the counter belongs to; a different day resets the budget. */
  day: string;
  count: number;
}

/**
 * The outcome of the latest attempt. `pending` is not a failure: the channel simply has
 * nothing published yet, so it gets its own retry interval and budget.
 */
export type FetchOutcomeKind = 'ok' | 'error' | 'pending' | '';

/** Per-source cursor and health: `health/<sourceId>.json`. */
export interface HealthRecord {
  version: 1;
  lastAttemptAt: string;
  lastSuccessAt: string;
  consecutiveFailures: number;
  lastError: string;
  cursor: Record<string, unknown>;
  autoAttempts: AutoAttempts;
  lastOutcome: FetchOutcomeKind;
  pendingAttempts: AutoAttempts;
}

/** What an adapter produces before the engine assigns ids and day keys. */
export interface RawItem {
  naturalKey: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  extra: Record<string, unknown>;
}
