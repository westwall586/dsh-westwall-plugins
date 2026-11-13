/**
 * A read-only look at one feed, used by the settings page before a source is subscribed.
 * It is never persisted, never joins `meta.feeds`, and never consumes the daily budget.
 */
export const RSS_PREVIEW_LIMIT = 20;

export interface RssPreviewItem {
  title: string;
  url: string;
  publishedAt: string;
  description: string;
}

export interface RssPreview {
  ok: boolean;
  /** Normalized URL as stored in the library. */
  url: string;
  /** The library name, which may be empty. */
  name: string;
  /** The feed document title, or `name` when the fetch failed. */
  title: string;
  items: RssPreviewItem[];
  scanned: number;
  truncated: boolean;
  /** Empty on success. */
  error: string;
}
