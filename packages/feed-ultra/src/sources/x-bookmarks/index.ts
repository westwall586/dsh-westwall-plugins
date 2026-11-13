import type { SourceDescriptor } from '../../contract/types.ts';
import {
  SourceFetchError,
  type DeleteBookmarkInput,
  type DeleteBookmarkOutcome,
  type FetchContext,
  type FetchOutcome,
  type FetchLog,
  type SourceAdapter,
  type SourceFetchErrorKind,
} from '../types.ts';
import { EgoBridgeError, runEgoScript, type RunScriptOptions, type ScriptRun } from './bridge.ts';
import { parseBookmarkEntries } from './parse.ts';
import { buildDeleteScript, buildFetchScript } from './script.ts';

const FETCH_TIMEOUT_MS = 90_000;
/** goto 45s + detail wait 15s + toggle 5s must all fit, so the child needs the same headroom as fetch. */
const DELETE_TIMEOUT_MS = 90_000;
const DEFAULT_BATCH_SIZE = 3;

export const descriptor: SourceDescriptor = {
  id: 'x_bookmarks',
  name: 'X Bookmarks',
  type: 'x-bookmarks',
};

type RunScript = (options: RunScriptOptions) => Promise<ScriptRun>;

export interface XBookmarksOptions {
  /** Test seam: replaces the real `ego-browser` process. */
  run?: RunScript;
}

const KIND_MAP: Record<string, SourceFetchErrorKind> = {
  auth: 'auth',
  install: 'install',
  drift: 'drift',
  timeout: 'timeout',
  network: 'network',
  http: 'http',
};

function fetchKind(error: unknown): SourceFetchErrorKind {
  if (error instanceof SourceFetchError) return error.kind;
  if (error instanceof EgoBridgeError) return KIND_MAP[error.kind] ?? 'drift';
  return 'drift';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function evidenceOf(error: unknown): string | undefined {
  return error instanceof EgoBridgeError ? error.evidencePath : undefined;
}

interface ReplayValue {
  entries: unknown[];
  scanned: number;
  exhausted: boolean;
  truncated: boolean;
}

function replayValueOf(value: unknown): ReplayValue {
  if (typeof value !== 'object' || value === null) {
    throw new SourceFetchError('drift', 'ego-browser 返回的结果不是对象');
  }
  const node = value as Record<string, unknown>;
  if (!Array.isArray(node.entries)) {
    throw new SourceFetchError('drift', 'ego-browser 返回的 entries 不是数组');
  }
  return {
    entries: node.entries,
    scanned: typeof node.scanned === 'number' ? node.scanned : node.entries.length,
    exhausted: node.exhausted === true,
    truncated: node.truncated === true,
  };
}

export function createAdapter(options: XBookmarksOptions = {}): SourceAdapter {
  const run = options.run ?? runEgoScript;

  return {
    type: descriptor.type,
    label: 'X Bookmarks',
    writeMode: 'accumulate',
    async fetch(ctx: FetchContext): Promise<FetchOutcome> {
      const requested = ctx.batchSize > 0 ? ctx.batchSize : DEFAULT_BATCH_SIZE;
      const excludeKeys = [...ctx.excludeKeys];
      const space = `dsh-feed-ultra-x-bookmarks-${Date.now()}`;
      const started = Date.now();
      ctx.log?.('start', { requested, excludeCount: excludeKeys.length, day: ctx.day, space });

      try {
        const script = buildFetchScript({ space, count: requested, excludeKeys });
        const runResult = await run({ script, timeoutMs: FETCH_TIMEOUT_MS, browserPath: ctx.browserPath, log: ctx.log });
        const replayed = replayValueOf(runResult.value);
        const parsed = parseBookmarkEntries(replayed.entries, ctx.now);
        ctx.log?.('parse', {
          scanned: replayed.scanned,
          dropped: parsed.dropped,
          added: parsed.items.length,
          exhausted: replayed.exhausted,
          truncated: replayed.truncated,
        });

        if (parsed.items.length === 0 && replayed.entries.length > 0) {
          throw new SourceFetchError('drift', `X 书签全部无法解析（dropped ${parsed.dropped}）`);
        }
        if (parsed.items.length === 0 && !replayed.exhausted && !replayed.truncated) {
          throw new SourceFetchError('drift', 'X 书签接口返回 0 条，但没有确认已经到末尾');
        }

        ctx.log?.('done', { kind: 'ok', added: parsed.items.length, ms: Date.now() - started });
        return {
          status: 'ok',
          items: parsed.items,
          meta: {
            lastPull: {
              at: ctx.now,
              requested,
              added: parsed.items.length,
              scanned: replayed.scanned,
              exhausted: replayed.exhausted,
              truncated: replayed.truncated,
            },
          },
        };
      } catch (error) {
        ctx.log?.('error', {
          kind: fetchKind(error),
          evidencePath: evidenceOf(error),
          ms: Date.now() - started,
        });
        if (error instanceof SourceFetchError) throw error;
        throw new SourceFetchError(fetchKind(error), messageOf(error), { cause: error });
      }
    },
  };
}

export const adapter = createAdapter();

/** The service delete dependency; failures come back as outcomes so one item cannot abort the batch. */
export async function deleteBookmarkOnX(
  input: DeleteBookmarkInput,
  options: XBookmarksOptions = {},
): Promise<DeleteBookmarkOutcome> {
  const run = options.run ?? runEgoScript;
  const started = Date.now();
  const space = `dsh-feed-ultra-x-delete-${Date.now()}`;
  const log: FetchLog = input.log ?? (() => {});

  try {
    const script = buildDeleteScript({ space, url: input.url });
    const result = await run({ script, timeoutMs: DELETE_TIMEOUT_MS, browserPath: input.browserPath, log });
    const value = typeof result.value === 'object' && result.value !== null ? (result.value as Record<string, unknown>) : {};
    if (value.outcome !== 'deleted' && value.outcome !== 'already') {
      throw new EgoBridgeError('drift', '删除脚本返回了未知结果');
    }
    log('done', { outcome: value.outcome, kind: 'ok', ms: Date.now() - started });
    return { ok: true, alreadyDeleted: value.outcome === 'already' };
  } catch (error) {
    const kind = error instanceof EgoBridgeError ? error.kind : 'drift';
    const evidencePath = evidenceOf(error);
    log('error', { kind, evidencePath, ms: Date.now() - started });
    return {
      ok: false,
      alreadyDeleted: false,
      error: messageOf(error),
      kind,
      ...(evidencePath === undefined ? {} : { evidencePath }),
    };
  }
}
