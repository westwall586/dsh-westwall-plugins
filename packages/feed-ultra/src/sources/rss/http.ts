import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { dumpResponse } from '../dump.ts';
import { SourceFetchError } from '../types.ts';
import { assertPublicHttpUrl, createPinnedLookup } from './guard.ts';

const USER_AGENT = 'dsh-feed-ultra/0.0.0';
const ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.8, */*;q=0.5';
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const PINNED_AGENT = new Agent({
  connect: { lookup: createPinnedLookup() as unknown as LookupFunction },
});

type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

export type FeedTransport = (url: string, init: UndiciInit) => Promise<Response>;

const pinnedTransport: FeedTransport = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: PINNED_AGENT }) as unknown as Promise<Response>;

/** Validators stored in `health.cursor.feeds[url]`. */
export interface FeedWatermark {
  /** Natural key of the newest accepted item, used as the primary newness check. */
  id: string;
  /** Publication time of that item, used when the id has rolled out of the feed. */
  at: string;
}

export interface FeedCursor {
  etag?: string;
  lastModified?: string;
  lastOkAt?: string;
  lastItems?: number;
  watermark?: FeedWatermark;
}

export interface FeedDocument {
  notModified: boolean;
  httpStatus: number;
  text: string;
  etag: string;
  lastModified: string;
}

export interface FeedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Test seams. Production uses a pinned undici agent and the public URL guard. */
  transport?: FeedTransport;
  guard?: (url: string) => Promise<URL>;
}

export interface PublicFetchOptions extends FeedFetchOptions {
  /** Older preview tests injected fetch directly; map it onto the transport seam. */
  fetchImpl?: typeof fetch;
}

interface RequestOptions extends FeedFetchOptions {
  headers: Record<string, string>;
  allow304: boolean;
  dumpHtml: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function charsetOf(contentType: string | null): string | null {
  const match = /charset=["']?([^;"'\s]+)/i.exec(contentType ?? '');
  return match?.[1] ?? null;
}

function declaredEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 200));
  const match = /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(head);
  return match?.[1] ?? null;
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  const label = charsetOf(contentType) ?? declaredEncoding(bytes) ?? 'utf-8';
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function timeoutError(url: string, error: unknown): SourceFetchError {
  const name = error instanceof Error ? error.name : '';
  const kind = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
  return new SourceFetchError(kind, `GET ${url} failed: ${messageOf(error)}`, { cause: error });
}

async function readFeedBody(
  response: Response,
  url: string,
  options: FeedFetchOptions,
  dumpHtml: boolean,
): Promise<string> {
  const contentType = response.headers.get('content-type');
  if (contentType !== null && contentType.toLowerCase().includes('text/html')) {
    if (!dumpHtml) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceFetchError('drift', `GET ${url} returned HTML, not a feed`);
    }
    const body = await response.text().catch(() => '');
    const snapshot = await dumpResponse(body, 'feed.html').then(
      (file) => `html snapshot: ${file}`,
      () => 'html snapshot unavailable',
    );
    throw new SourceFetchError('drift', `GET ${url} returned HTML, not a feed; ${snapshot}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  if (bytes.byteLength > maxBytes) {
    throw new SourceFetchError('drift', `GET ${url} returned ${bytes.byteLength} bytes, over the ${maxBytes} byte cap`);
  }
  return decode(bytes, contentType);
}

/**
 * One guarded fetch for both the daily pool and the settings preview.
 * Every hop is checked, and the pinned transport resolves the socket target
 * through the same private-address guard.
 */
async function requestFeed(url: string, options: RequestOptions): Promise<FeedDocument> {
  const guard = options.guard ?? ((value: string) => assertPublicHttpUrl(value));
  const transport = options.transport ?? pinnedTransport;
  const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await guard(current);
    let response: Response;
    try {
      response = await transport(current, {
        headers: options.headers,
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      throw timeoutError(current, error);
    }

    if (response.status === 304) {
      if (!options.allow304) throw new SourceFetchError('http', `GET ${current} returned an unexpected 304`);
      return {
        notModified: true,
        httpStatus: 304,
        text: '',
        etag: response.headers.get('etag') ?? options.headers['if-none-match'] ?? '',
        lastModified: response.headers.get('last-modified') ?? options.headers['if-modified-since'] ?? '',
      };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location === null) throw new SourceFetchError('http', `GET ${current} redirected without a location`);
      await response.body?.cancel().catch(() => undefined);
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceFetchError('auth', `GET ${current} returned ${response.status}`, { status: response.status });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SourceFetchError('http', `GET ${current} returned ${response.status}`, { status: response.status });
    }

    const text = await readFeedBody(response, current, options, options.dumpHtml);
    return {
      notModified: false,
      httpStatus: response.status,
      text,
      etag: response.headers.get('etag') ?? options.headers['if-none-match'] ?? '',
      lastModified: response.headers.get('last-modified') ?? options.headers['if-modified-since'] ?? '',
    };
  }

  throw new SourceFetchError('http', `GET ${url} exceeded ${MAX_REDIRECTS} redirects`);
}

export async function fetchFeed(
  url: string,
  cursor: FeedCursor | undefined,
  options: FeedFetchOptions = {},
): Promise<FeedDocument> {
  const headers: Record<string, string> = { accept: ACCEPT, 'user-agent': USER_AGENT };
  if (cursor?.etag) headers['if-none-match'] = cursor.etag;
  if (cursor?.lastModified) headers['if-modified-since'] = cursor.lastModified;

  return requestFeed(url, { ...options, headers, allow304: true, dumpHtml: true });
}

export async function fetchPublicFeed(url: string, options: PublicFetchOptions = {}): Promise<FeedDocument> {
  const transport = options.transport
    ?? (options.fetchImpl === undefined
      ? undefined
      : ((value: string, init: UndiciInit) => options.fetchImpl!(value, init) as Promise<Response>));
  const headers = { accept: ACCEPT, 'user-agent': USER_AGENT };
  return requestFeed(url, { ...options, headers, allow304: false, dumpHtml: false, ...(transport === undefined ? {} : { transport }) });
}
