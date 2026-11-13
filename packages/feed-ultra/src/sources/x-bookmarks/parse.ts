import type { RawItem } from '../../contract/types.ts';

/** Shown when a tweet carries no text at all: the panel renders the placeholder instead. */
export const MEDIA_PLACEHOLDER = '（图片/视频，请在原文查看）';
export const ARTICLE_PLACEHOLDER = '（长文，请在原文查看）';

const TITLE_MAX = 120;

type Fields = Record<string, unknown>;

function record(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : null;
}

function nested(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    const node = record(current);
    if (node === null) return undefined;
    current = node[key];
  }
  return current;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function publishedAtOf(createdAt: unknown, fallback: string): string {
  if (typeof createdAt !== 'string' || createdAt.trim() === '') return fallback;
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/** `TweetWithVisibilityResults` wraps the real tweet; tombstones carry no readable tweet. */
function unwrap(result: Fields): { tweet: Fields } | { skipped: string } {
  const typename = stringOrEmpty(result.__typename);
  if (typename === 'TweetTombstone' || typename === 'TweetUnavailable') return { skipped: typename };
  if (typename === 'TweetWithVisibilityResults') {
    const inner = record(result.tweet);
    return inner === null ? { skipped: 'empty visibility wrapper' } : { tweet: inner };
  }
  return { tweet: result };
}

function titleOf(text: string, article: boolean): string {
  if (text.trim() === '') return article ? ARTICLE_PLACEHOLDER : MEDIA_PLACEHOLDER;
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '');
  if (firstLine === undefined) return article ? ARTICLE_PLACEHOLDER : MEDIA_PLACEHOLDER;
  return firstLine.slice(0, TITLE_MAX);
}

function authorOf(tweet: Fields): { author: string; handle: string } {
  const core = record(nested(tweet, 'core', 'user_results', 'result', 'core'));
  return {
    author: stringOrEmpty(core?.name),
    handle: stringOrEmpty(core?.screen_name),
  };
}

export type EntryParse = { ok: true; item: RawItem } | { ok: false; reason: string };

/** One GraphQL `tweet-*` entry to one raw item; pure so fixtures cover the mapping. */
export function parseEntry(entry: unknown, now: string): EntryParse {
  const result = record(nested(entry, 'content', 'itemContent', 'tweet_results', 'result'));
  if (result === null) return { ok: false, reason: 'no tweet_results.result' };

  const unwrapped = unwrap(result);
  if ('skipped' in unwrapped) return { ok: false, reason: unwrapped.skipped };
  const tweet = unwrapped.tweet;

  const legacy = record(tweet.legacy) ?? {};
  const id = stringOrEmpty(legacy.id_str) || stringOrEmpty(tweet.rest_id);
  if (id === '') return { ok: false, reason: 'no tweet id' };

  const fullText =
    stringOrEmpty(nested(tweet, 'note_tweet', 'note_tweet_results', 'result', 'text')) ||
    stringOrEmpty(legacy.full_text);
  const article = record(tweet.article) !== null;
  const { author, handle } = authorOf(tweet);

  return {
    ok: true,
    item: {
      naturalKey: id,
      title: titleOf(fullText, article),
      description: fullText.trim() === '' ? '' : fullText,
      url: handle === '' ? `https://x.com/i/status/${id}` : `https://x.com/${handle}/status/${id}`,
      publishedAt: publishedAtOf(legacy.created_at, now),
      extra: {
        author,
        handle,
        lang: stringOrEmpty(legacy.lang),
        favorites: numberOrNull(legacy.favorite_count),
        retweets: numberOrNull(legacy.retweet_count),
        replies: numberOrNull(legacy.reply_count),
        quoteCount: numberOrNull(legacy.quote_count),
        views: numberOrNull(nested(tweet, 'views', 'count')),
      },
    },
  };
}

export interface ParsedEntries {
  items: RawItem[];
  /** Entries skipped as tombstones, unreadable, or a duplicate key. */
  dropped: number;
}

/** Maps one batch, preserving X order and keeping the first occurrence of a duplicate key. */
export function parseBookmarkEntries(entries: readonly unknown[], now: string): ParsedEntries {
  const items: RawItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const entry of entries) {
    const parsed = parseEntry(entry, now);
    if (!parsed.ok) {
      dropped += 1;
      continue;
    }
    if (seen.has(parsed.item.naturalKey)) {
      dropped += 1;
      continue;
    }
    seen.add(parsed.item.naturalKey);
    items.push(parsed.item);
  }

  return { items, dropped };
}
