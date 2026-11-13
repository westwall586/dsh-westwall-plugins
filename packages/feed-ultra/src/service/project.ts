import type {
  FetchStatus,
  HealthRecord,
  ItemState,
  SourceCapabilities,
  SourceDescriptor,
} from '../contract/types.ts';
import type {
  ChannelScheduleView,
  DayView,
  ItemView,
  Section,
  SourceCadence,
  SourceHealth,
  SourceTranslationView,
  TranslationView,
  WorkspaceView,
} from '../contract/views.ts';
import { computeNextFetchAt } from '../engine/schedule.ts';
import { dayKeyOf } from '../store/paths.ts';
import { countUnread, type DayFactResult } from '../store/read.ts';

export interface ProjectedSource {
  source: SourceDescriptor;
  cadence: SourceCadence;
  capabilities: SourceCapabilities;
  /** Set on a section projected from one view of a pooled source. */
  channelId?: string;
  /** How this view's own feeds fared in the attempt that wrote the fact. */
  feedOutcome?: FeedOutcome;
  fact: DayFactResult;
  health: HealthRecord | null;
  translation: TranslationView;
  /** Requested pull size for a manual channel; absent for daily channels. */
  batchSize?: number;
  /** Decided translation text per item id; only records matching the current hash are here. */
  texts?: ReadonlyMap<string, string>;
}

export interface FeedOutcome {
  total: number;
  failed: number;
  error: string;
}

export interface SectionInput {
  date: string;
  today: string;
  state: Record<string, ItemState>;
  source: ProjectedSource;
}
export interface DayInput {
  date: string;
  today: string;
  workspace: WorkspaceView;
  state: Record<string, ItemState>;
  sources: readonly ProjectedSource[];
}

export interface SourceHealthInput {
  source: SourceDescriptor;
  cadence: SourceCadence;
  capabilities: SourceCapabilities;
  health: HealthRecord | null;
  todayFact: DayFactResult;
  state: Record<string, ItemState>;
  schedule: ChannelScheduleView;
  translation: SourceTranslationView;
  /** Requested pull size for a manual channel; absent for daily channels. */
  batchSize?: number;
  now: Date;
}

function sameLocalDay(value: string, day: string): boolean {
  if (value === '') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && dayKeyOf(date) === day;
}

function sectionStatus(input: SectionInput): Section['status'] {
  const { fact, health, cadence, capabilities, feedOutcome } = input.source;
  if (fact.kind === 'corrupt') return 'corrupt';
  const current = input.date === input.today;
  const failures = health?.consecutiveFailures ?? 0;
  // A written snapshot outranks pending, but today's failure still outranks the snapshot.
  if (current && fact.kind === 'ok' && failures > 0) return 'error';
  // No snapshot for the viewed day. Only today's latest attempt may describe it; a leftover
  // attempt from today must not paint a historical day as pending or failed.
  if (current && fact.kind !== 'ok' && sameLocalDay(health?.lastAttemptAt ?? '', input.today)) {
    if (health?.lastOutcome === 'pending') return 'pending';
    if (health?.lastOutcome === 'error') return 'error';
    // Health files written before iteration three have no lastOutcome. Keep their
    // failure visible instead of downgrading the section to missing after upgrade.
    if ((health?.lastOutcome ?? '') === '' && failures > 0) return 'error';
  }
  if (fact.kind === 'ok') {
    if (fact.fact.meta?.notPublished === true) return 'notPublished';
    // A channel can fail while the pool succeeds; its own feeds decide.
    if (feedOutcome !== undefined && feedOutcome.total > 0 && feedOutcome.failed === feedOutcome.total) {
      return 'error';
    }
    if (fact.fact.items.length === 0) {
      if (cadence === 'manual') return 'empty';
      return capabilities.emptyState === 'empty' ? 'empty' : 'notPublished';
    }
    return 'ok';
  }
  return 'missing';
}

/** The latest attempt from health wins over the snapshot's own fetch record, so a retry error is visible. */
function sectionFetch(input: SectionInput): FetchStatus {
  const { fact, health, feedOutcome } = input.source;
  const factFetch = fact.kind === 'ok' ? fact.fact.fetch : null;
  // Health is source-scoped and describes today. A historical day must read its own
  // snapshot's attempt, or an unread past day borrows today's success time.
  const current = input.date === input.today;
  const failed = current && (health?.consecutiveFailures ?? 0) > 0;
  const feedFailed = feedOutcome !== undefined && feedOutcome.total > 0 && feedOutcome.failed === feedOutcome.total;

  return {
    lastAttemptAt: (current ? health?.lastAttemptAt : '') || factFetch?.lastAttemptAt || '',
    lastSuccessAt: (current ? health?.lastSuccessAt : '') || factFetch?.lastSuccessAt || '',
    status: failed || feedFailed ? 'error' : fact.kind === 'ok' ? 'ok' : 'error',
    error: failed
      ? (health?.lastError ?? '')
      : fact.kind === 'corrupt'
        ? fact.error
        : feedFailed
          ? feedOutcome.error
          : (factFetch?.error ?? ''),
  };
}

/** The one status decision, shared by the day projection and the channel views. */
export function sectionState(input: SectionInput): Pick<Section, 'status' | 'fetch'> {
  return { status: sectionStatus(input), fetch: sectionFetch(input) };
}

export function projectSection(input: SectionInput): Section {
  const { source, cadence, fact } = input.source;
  const rawItems = fact.kind === 'ok' ? fact.fact.items : [];
  const items: ItemView[] = rawItems.map((item) => {
    const readAt = input.state[item.id]?.readAt ?? '';
    const translated = input.source.texts?.get(item.id);
    if (translated === undefined) return { ...item, readAt, read: readAt !== '' };
    return {
      ...item,
      readAt,
      read: readAt !== '',
      descriptionTranslated: translated,
      descriptionLang: 'zh-CN',
    };
  });

  const state = sectionState(input);
  return {
    source,
    cadence,
    status: state.status,
    fetch: state.fetch,
    items,
    count: items.length,
    unread: countUnread(rawItems, input.state).unread,
    translation: input.source.translation,
    meta: fact.kind === 'ok' ? (fact.fact.meta ?? {}) : {},
    capabilities: input.source.capabilities,
    ...(input.source.channelId === undefined ? {} : { channelId: input.source.channelId }),
    ...(cadence === 'manual' && input.source.batchSize !== undefined
      ? { batchSize: input.source.batchSize }
      : {}),
  };
}

export function projectDay(input: DayInput): DayView {
  const sections = input.sources.map((source) =>
    projectSection({ date: input.date, today: input.today, state: input.state, source }),
  );
  const total = sections.reduce((sum, section) => sum + section.count, 0);
  const read = sections.reduce((sum, section) => sum + (section.count - section.unread), 0);

  return {
    date: input.date,
    today: input.today,
    workspace: input.workspace,
    sections,
    total,
    read,
    unread: total - read,
  };
}

export function sourceHealthView(input: SourceHealthInput): SourceHealth {
  const { source, cadence, capabilities, health, todayFact, state, schedule, translation, batchSize, now } = input;
  const failures = health?.consecutiveFailures ?? 0;
  const status = failures > 0 ? 'error' : !health || !health.lastSuccessAt ? 'idle' : 'ok';
  const items = todayFact.kind === 'ok' ? todayFact.fact.items : [];
  const manual = cadence !== 'daily';

  return {
    ...source,
    cadence,
    capabilities,
    status,
    lastAttemptAt: health?.lastAttemptAt ?? '',
    lastSuccessAt: health?.lastSuccessAt ?? '',
    consecutiveFailures: failures,
    lastOutcome: health?.lastOutcome ?? '',
    pendingAttempts: health?.pendingAttempts ?? { day: '', count: 0 },
    error: health?.lastError ?? '',
    todayCount: items.length,
    unread: countUnread(items, state).unread,
    // A manual channel has no timer, whatever its stored schedule defaults say.
    schedule: manual ? { ...schedule, enabled: false } : schedule,
    nextFetchAt: manual ? null : computeNextFetchAt({ health, schedule, now }),
    autoAttempts: health?.autoAttempts ?? { day: '', count: 0 },
    ...(manual && batchSize !== undefined ? { batchSize } : {}),
    translation,
  };
}
