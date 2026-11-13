import type { RawItem } from '../contract/types.ts';

export type WriteMode = 'accumulate' | 'replace';

/** Structured stage log line; adapters never put credentials or item text in `fields`. */
export type FetchLog = (message: string, fields?: Record<string, unknown>) => void;

/** One feed a pooled adapter may pull, in pull order. */
export interface RssFeedRef {
  url: string;
  name: string;
  channel: string;
}

export interface FetchContext {
  /** RFC3339 instant the fetch attempt started; adapters date their items with it. */
  now: string;
  /** Target local day, `YYYY-MM-DD`; the day being fetched. */
  day: string;
  /** Host local day at fetch time; only `day === today` may touch source health. */
  today: string;
  /** Channel edition, `zh` or `en`; not the UI language. */
  locale: string;
  /** Natural keys already present in the local retention window; manual channels use this to skip. */
  excludeKeys: ReadonlySet<string>;
  /** How many new items a manual pull asks for; 0 for channels that do not batch. */
  batchSize: number;
  /** Validators from the last successful attempt; only a pooled adapter reads it. */
  cursor?: Record<string, unknown>;
  /** Feeds to pull, in pull order; only a pooled adapter reads it. */
  feeds?: readonly RssFeedRef[];
  /** Explicit browser executable override; only the browser-backed adapter reads it. */
  browserPath?: string;
  log?: FetchLog;
}

export type FetchOutcome =
  | { status: 'ok'; items: RawItem[]; meta?: Record<string, unknown>; cursor?: Record<string, unknown> }
  | { status: 'pending' }
  | { status: 'notPublished'; meta?: Record<string, unknown> };

export interface SourceAdapter {
  type: string;
  label: string;
  writeMode: WriteMode;
  fetch(ctx: FetchContext): Promise<FetchOutcome>;
}

export type SourceFetchErrorKind = 'network' | 'http' | 'drift' | 'auth' | 'install' | 'timeout';

/** A fetch failure the UI can explain, as opposed to a bug in the engine. */
export class SourceFetchError extends Error {
  readonly kind: SourceFetchErrorKind;
  readonly status: number | undefined;

  constructor(kind: SourceFetchErrorKind, message: string, options: { cause?: unknown; status?: number } = {}) {
    super(message, { cause: options.cause });
    this.name = 'SourceFetchError';
    this.kind = kind;
    this.status = options.status;
  }
}

export interface DeleteBookmarkInput {
  url: string;
  browserPath?: string;
  log?: FetchLog;
}

export interface DeleteBookmarkOutcome {
  ok: boolean;
  alreadyDeleted: boolean;
  error?: string;
  kind?: string;
  evidencePath?: string;
}
