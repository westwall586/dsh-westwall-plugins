/** Wire contract shared by the host service and the client panel. */

import type {
  AutoAttempts,
  FetchStatus,
  HealthRecord,
  ItemRecord,
  ItemState,
  ModelChoice,
  SourceCapabilities,
  SourceDescriptor,
} from './types.ts';
import type { RssChannel, RssFeed } from './rss-library.ts';

export type SourceCadence = 'daily' | 'manual';

/** Who started a fetch: scheduled ticks count against the daily budget, manual clicks never do. */
export type FetchTrigger = 'auto' | 'manual';

export interface WorkspaceView {
  status: 'unbound' | 'ok' | 'invalid';
  path: string;
}

export interface StatusView {
  workspace: WorkspaceView;
  today: string;
  retentionDays: number;
  /** Legacy global switch, kept for one iteration; the client no longer renders it. */
  autoFetch: boolean;
  sourceCount: number;
}

type SourceHealthFields = Pick<
  HealthRecord,
  'lastAttemptAt' | 'lastSuccessAt' | 'consecutiveFailures' | 'lastOutcome' | 'pendingAttempts'
>;

export interface ChannelScheduleView {
  enabled: boolean;
  /** Local wall-clock `HH:mm`. */
  at: string;
}

export interface TranslationView {
  enabled: boolean;
  /** Items that still need a translation; an already-Chinese description never counts. */
  missing: number;
  /** Empty when nothing failed. */
  error: string;
}

export interface SourceTranslationView extends TranslationView {
  /** The explicitly selected model, or `null` while following the DSH default. */
  model: ModelChoice | null;
}

export interface SourceHealth extends SourceDescriptor, SourceHealthFields {
  cadence: SourceCadence;
  status: 'ok' | 'error' | 'idle';
  error: string;
  todayCount: number;
  unread: number;
  schedule: ChannelScheduleView;
  /** Next automatic fetch, or `null` when the channel schedule is off. */
  nextFetchAt: string | null;
  /** Automatic attempts already spent today; manual fetches never count. */
  autoAttempts: AutoAttempts;
  /** What this channel can do, resolved from the registry. */
  capabilities: SourceCapabilities;
  /** Requested pull size for a manual channel; absent for daily channels. */
  batchSize?: number;
  translation: SourceTranslationView;
}

export interface SourcesView {
  workspace: WorkspaceView;
  today: string;
  sources: SourceHealth[];
  /** One entry per channel; empty when unbound or the library has no channels. */
  rssChannels: RssChannelView[];
}

export interface RssChannelView {
  id: string;
  name: string;
  feedCount: number;
  todayCount: number;
  unread: number;
  status: 'ok' | 'error' | 'idle';
  /** The first failing feed's reason, or the pool error when no fact exists. */
  error: string;
}

export interface RssLibraryView {
  version: number;
  updatedAt: string;
  channels: RssChannel[];
  feeds: RssFeed[];
  counts: { feeds: number; channels: number; inbox: number };
  recoveredFrom?: string;
  unbound?: boolean;
  /** Present only on the mutate response that ran an import. */
  lastImport?: { added: number; skipped: number };
}

export type RssLibraryOp =
  | { op: 'addFeed'; url: string; channel?: string }
  | { op: 'removeFeed'; url: string }
  | { op: 'setFeedNote'; url: string; note: string }
  | { op: 'moveFeed'; url: string; channel: string }
  | { op: 'addChannel'; name: string }
  | { op: 'renameChannel'; id: string; name: string }
  | { op: 'removeChannel'; id: string }
  | { op: 'reorderChannels'; ids: string[] }
  | { op: 'importOpml'; text: string };

export interface ItemView extends ItemRecord, ItemState {
  /** `readAt` is the empty string for an unread item; `read` is the derived flag the UI branches on. */
  read: boolean;
  /** Present only when a translation matches the current description hash. */
  descriptionTranslated?: string;
  descriptionLang?: 'zh-CN';
}

export interface Section {
  source: SourceDescriptor;
  cadence: SourceCadence;
  status: 'ok' | 'error' | 'missing' | 'corrupt' | 'pending' | 'notPublished' | 'empty';
  fetch: FetchStatus;
  items: ItemView[];
  count: number;
  unread: number;
  translation: TranslationView;
  /** Channel-owned snapshot facts; `{}` when the fact file carries none. */
  meta: Record<string, unknown>;
  capabilities: SourceCapabilities;
  /** Set on a section projected from one view of a pooled source; absent otherwise. */
  channelId?: string;
  /** Requested pull size for a manual channel; absent for daily channels. */
  batchSize?: number;
}

export interface DayView {
  date: string;
  today: string;
  workspace: WorkspaceView;
  sections: Section[];
  total: number;
  read: number;
  unread: number;
}

export interface CalendarDay {
  day: string;
  state: 'present' | 'read' | 'missing';
  total: number;
  unread: number;
}

export interface CalendarView {
  from: string;
  to: string;
  today: string;
  days: CalendarDay[];
}

export interface ActItemResult {
  id: string;
  status: 'ok' | 'error';
  error?: string;
  /** When a bookmark was deleted on the remote side, the local write-back instant. */
  deletedAt?: string;
}

export interface ActResult {
  action: string;
  results: ActItemResult[];
}

export interface FetchResult {
  sourceId: string;
  day: string;
  status: 'ok' | 'error' | 'pending' | 'notPublished';
  count?: number;
  error?: string;
  /** Natural keys this fetch actually added to the snapshot. */
  added?: number;
  /** Entries the adapter examined, including ones it skipped. */
  scanned?: number;
  /** Every bookmark older than this batch was already seen. */
  exhausted?: boolean;
  /** The adapter stopped at its scan or time cap before reaching the end. */
  truncated?: boolean;
  /** Items the fetch translated, or 0 when translation is off / everything was cached. */
  translated?: number;
  /** Translation failure kept separate from fetch failure: the snapshot still landed. */
  translationError?: string;
}

export interface BindResult {
  workspace: WorkspaceView;
  created: boolean;
}

export interface ModelProviderView {
  id: string;
  name: string;
}

export interface ModelEntryView {
  id: string;
  name: string;
}

export interface ModelEffortView {
  id: string;
  name: string;
  description?: string;
}

/**
 * One call for the whole model picker: catalog plus the effective selection.
 * The client cannot read `agentDefaultModel` remotely, so the host resolves it here.
 */
export interface ModelsView {
  providers: ModelProviderView[];
  models: Record<string, ModelEntryView[]>;
  /** Resolved selection currently in effect; `null` when it cannot be read. */
  selected: ModelChoice | null;
  /** True when the config follows the DSH default instead of an explicit choice. */
  following: boolean;
  error: string;
}

export interface ModelEffortsView {
  efforts: ModelEffortView[];
  default?: string;
  error: string;
}

export interface TranslateResult {
  sourceId: string;
  day: string;
  translated: number;
  skipped: number;
  failed: number;
  error: string;
}
