import type { RawItem, SourceDescriptor } from '../../contract/types.ts';
import { dumpResponse } from '../dump.ts';
import { SourceFetchError, type FetchContext, type FetchOutcome, type SourceAdapter } from '../types.ts';
import { parse } from './parse.ts';

const DEFAULT_BASE_URL = 'https://github.com';
const USER_AGENT = 'dsh-feed-ultra/0.0.0';
const TIMEOUT_MS = 10_000;

export interface GithubTrendingOptions {
  /** Overridable so tests can serve the fixture from a local server. */
  baseUrl?: string;
}

export const descriptor: SourceDescriptor = {
  id: 'github_trending',
  name: 'GitHub Trending',
  type: 'github-trending',
};

async function driftError(url: string, html: string, reason: string, cause?: unknown): Promise<SourceFetchError> {
  const snapshot = await dumpResponse(html, 'trending.html').then(
    (file) => `html snapshot: ${file}`,
    () => 'html snapshot unavailable',
  );
  return new SourceFetchError('drift', `GET ${url} returned HTML the parser cannot read (${reason}); ${snapshot}`, { cause });
}

export function createAdapter(options: GithubTrendingOptions = {}): SourceAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  return {
    type: descriptor.type,
    label: 'GitHub Trending',
    writeMode: 'replace',
    async fetch({ now }: FetchContext): Promise<FetchOutcome> {
      const url = `${baseUrl}/trending?since=daily`;
      let html: string;
      try {
        const response = await fetch(url, {
          headers: { accept: 'text/html', 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new SourceFetchError('http', `GET ${url} returned ${response.status}`, { status: response.status });
        }
        html = await response.text();
      } catch (error) {
        if (error instanceof SourceFetchError) throw error;
        throw new SourceFetchError('network', `GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }

      let items: RawItem[];
      try {
        items = parse(html, now);
      } catch (error) {
        throw await driftError(url, html, error instanceof Error ? error.message : String(error), error);
      }
      if (items.length === 0) throw await driftError(url, html, 'no trending rows');
      return { status: 'ok', items };
    },
  };
}

export const adapter = createAdapter();
