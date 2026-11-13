import type { SourceDescriptor } from '../../contract/types.ts';
import { dumpResponse } from '../dump.ts';
import { SourceFetchError, type FetchContext, type FetchOutcome, type SourceAdapter } from '../types.ts';
import {
  batchMetaResponseSchema,
  briefResponseSchema,
  briefMeta,
  mapBriefItems,
  notPublishedMeta,
  type BatchMetaItem,
  type BriefData,
} from './parse.ts';

const DEFAULT_BASE_URL = 'https://www.bestblogs.dev';
const USER_AGENT = 'dsh-feed-ultra/0.1.0';
const TIMEOUT_MS = 10_000;

export interface BestblogsBriefOptions {
  /** Overridable so tests can serve fixtures from a local server. */
  baseUrl?: string;
  timeoutMs?: number;
}

export const descriptor: SourceDescriptor = {
  id: 'bestblogs_brief',
  name: 'BestBlogs Daily Brief',
  type: 'bestblogs-brief',
};

async function driftError(url: string, raw: string, reason: string, cause?: unknown): Promise<SourceFetchError> {
  const snapshot = await dumpResponse(raw, 'brief.json').then(
    (file) => `json snapshot: ${file}`,
    () => 'json snapshot unavailable',
  );
  return new SourceFetchError('drift', `GET ${url} returned JSON the parser cannot read (${reason}); ${snapshot}`, {
    cause,
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestText(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
  const method = init.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SourceFetchError('network', `${method} ${url} failed: ${messageOf(error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new SourceFetchError('http', `${method} ${url} returned ${response.status}`, { status: response.status });
  }
  return response.text();
}

interface BriefResponse {
  data: BriefData | null;
  raw: string;
  url: string;
}

async function fetchBrief(baseUrl: string, timeoutMs: number, day: string, locale: string): Promise<BriefResponse> {
  const url = `${baseUrl}/api/proxy/briefs/public/${day}?locale=${encodeURIComponent(locale)}`;
  const raw = await requestText(url, { headers: { accept: 'application/json' } }, timeoutMs);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw await driftError(url, raw, 'invalid JSON', error);
  }

  const parsed = briefResponseSchema.safeParse(json);
  if (!parsed.success) throw await driftError(url, raw, parsed.error.message);
  return { data: parsed.data.data, raw, url };
}

interface BatchMetaResult {
  items: BatchMetaItem[];
  degraded: boolean;
}

function hasMissingDetail(ids: readonly string[], items: readonly BatchMetaItem[]): boolean {
  const received = new Set(items.map((item) => item.id));
  return ids.some((id) => !received.has(id));
}

/** Retries once on network, HTTP or parse failure, then degrades instead of failing the day. */
async function fetchDetails(
  baseUrl: string,
  timeoutMs: number,
  ids: readonly string[],
  locale: string,
): Promise<BatchMetaResult> {
  const url = `${baseUrl}/api/proxy/resources/batch-meta`;
  const body = JSON.stringify({ ids, uiLang: locale });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await requestText(
        url,
        {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body,
        },
        timeoutMs,
      );
      const parsed = batchMetaResponseSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error(`unexpected batch-meta payload: ${parsed.error.message}`);
      return { items: parsed.data.data, degraded: hasMissingDetail(ids, parsed.data.data) };
    } catch {
      if (attempt === 1) return { items: [], degraded: true };
    }
  }
  return { items: [], degraded: true };
}

export function createAdapter(options: BestblogsBriefOptions = {}): SourceAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return {
    type: descriptor.type,
    label: 'BestBlogs Daily Brief',
    writeMode: 'replace',
    async fetch({ day, today, locale }: FetchContext): Promise<FetchOutcome> {
      const brief = await fetchBrief(baseUrl, timeoutMs, day, locale);
      const data = brief.data;

      if (data === null || (typeof data.status === 'string' && data.status !== 'COMPLETED')) {
        if (day === today) return { status: 'pending' };
        return { status: 'notPublished', meta: notPublishedMeta(data, day, locale) };
      }

      if (data.contentItems.length === 0) {
        throw await driftError(brief.url, brief.raw, 'completed brief has no content items');
      }

      const ids = data.contentItems
        .map((item) => item.resourceId)
        .filter((id): id is string => typeof id === 'string' && id !== '');
      if (ids.length === 0) {
        throw await driftError(brief.url, brief.raw, 'no content item carries a resourceId');
      }

      const details = await fetchDetails(baseUrl, timeoutMs, ids, locale);
      const { items, dropped } = mapBriefItems(data, details.items, day);
      return {
        status: 'ok',
        items,
        meta: briefMeta({
          data,
          day,
          locale,
          detailStatus: details.degraded ? 'degraded' : 'ok',
          dropped,
        }),
      };
    },
  };
}

export const adapter = createAdapter();
