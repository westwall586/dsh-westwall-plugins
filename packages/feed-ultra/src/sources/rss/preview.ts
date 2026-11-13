import {
  RSS_PREVIEW_LIMIT,
  type RssPreview,
  type RssPreviewItem,
} from '../../contract/rss-preview.ts';
import { fetchPublicFeed } from './http.ts';
import { parseFeedText } from './parse.ts';

export interface PreviewFeedDeps {
  fetchPublic?: typeof fetchPublicFeed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function previewItems(items: readonly { title: string; url: string; publishedAt: string; description: string }[]): RssPreviewItem[] {
  return items.slice(0, RSS_PREVIEW_LIMIT).map(item => ({
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    description: item.description,
  }));
}

/**
 * A read-only sibling of the pool adapter. It shares the parser but never
 * touches the library, facts, health or cursor.
 */
export async function previewFeed(
  url: string,
  name: string,
  now: string,
  deps: PreviewFeedDeps = {},
): Promise<RssPreview> {
  const base = { ok: false, url, name, title: name, items: [], scanned: 0, truncated: false, error: '' };
  try {
    const document = await (deps.fetchPublic ?? fetchPublicFeed)(url);
    const parsed = parseFeedText(document.text, url, now);
    const latest = [...parsed.items].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
    return {
      ...base,
      ok: true,
      title: parsed.title,
      items: previewItems(latest),
      scanned: parsed.scanned,
      truncated: parsed.items.length > RSS_PREVIEW_LIMIT,
    };
  } catch (error) {
    return { ...base, error: messageOf(error) };
  }
}
