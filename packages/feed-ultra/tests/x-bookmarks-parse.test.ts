import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ARTICLE_PLACEHOLDER,
  MEDIA_PLACEHOLDER,
  parseBookmarkEntries,
  parseEntry,
} from '../src/sources/x-bookmarks/parse.ts';

const NOW = '2026-11-11T06:42:00.000Z';
const FIXTURE = fileURLToPath(
  new URL('../src/sources/x-bookmarks/fixtures/bookmarks-2026-11-11.json', import.meta.url),
);

interface TweetOverrides {
  typename?: string;
  id?: string;
  text?: string;
  fullText?: string;
  handle?: string;
  author?: string;
  createdAt?: string;
  article?: boolean;
  views?: unknown;
  favorite?: number;
}

function tweet(overrides: TweetOverrides = {}): Record<string, unknown> {
  const id = overrides.id ?? '1001';
  const fullText = overrides.fullText ?? 'full text';
  return {
    __typename: overrides.typename ?? 'Tweet',
    rest_id: id,
    core: {
      user_results: {
        result: {
          core: {
            name: overrides.author ?? 'Author',
            screen_name: overrides.handle ?? 'author',
          },
        },
      },
    },
    legacy: {
      id_str: id,
      created_at: overrides.createdAt ?? 'Tue Nov 10 07:07:00 +0000 2026',
      full_text: fullText,
      lang: 'zh',
      favorite_count: overrides.favorite ?? 12,
      retweet_count: 3,
      reply_count: 2,
      quote_count: 1,
    },
    ...(overrides.text === undefined ? {} : { note_tweet: { note_tweet_results: { result: { text: overrides.text } } } }),
    ...(overrides.article === true ? { article: { article_results: { result: {} } } } : {}),
    ...(overrides.views === undefined ? {} : { views: { count: overrides.views } }),
  };
}

function entry(result: Record<string, unknown>, id = '1001'): Record<string, unknown> {
  return { entryId: `tweet-${id}`, content: { itemContent: { tweet_results: { result } } } };
}

test('maps real GraphQL entries to raw items with the full contract fields', () => {
  const entries = JSON.parse(readFileSync(FIXTURE, 'utf8')) as unknown[];
  const parsed = parseBookmarkEntries(entries, NOW);

  assert.equal(parsed.dropped, 0);
  assert.equal(parsed.items.length, 2);
  const [first, second] = parsed.items;
  assert.ok(first);
  assert.ok(second);

  assert.equal(first.naturalKey, '2120050574448025797');
  assert.equal(first.title, '最近在 GitHub 上翻了不少 DeepSeek Harness（DSH）的社区插件， 挑出 7 个我觉得比较值得装的。');
  assert.equal(first.description.length, 526);
  assert.equal(first.url, 'https://x.com/star_flow_ai/status/2120050574448025797');
  assert.equal(first.publishedAt, '2026-11-10T07:07:00.000Z');
  assert.deepEqual(first.extra, {
    author: '星川 ✨ StarFlow',
    handle: 'star_flow_ai',
    lang: 'zh',
    favorites: 216,
    retweets: 24,
    replies: 19,
    quoteCount: 0,
    views: 18158,
  });

  assert.equal(second.naturalKey, '2120348886426603825');
  assert.equal(second.extra.views, 4613);
});

test('prefers the note_tweet body and falls back to full_text', () => {
  const long = parseEntry(entry(tweet({ text: 'note body\nsecond line', fullText: 'legacy body' })), NOW);
  assert.ok(long.ok);
  assert.equal(long.item.description, 'note body\nsecond line');
  assert.equal(long.item.title, 'note body');

  const short = parseEntry(entry(tweet({ fullText: 'legacy only' })), NOW);
  assert.ok(short.ok);
  assert.equal(short.item.description, 'legacy only');
});

test('title is the first non-empty line, trimmed and capped at 120 chars', () => {
  const firstLine = parseEntry(entry(tweet({ text: '\n  first line  \nsecond line' })), NOW);
  assert.ok(firstLine.ok);
  assert.equal(firstLine.item.title, 'first line');
  assert.equal(firstLine.item.description, '\n  first line  \nsecond line');

  const long = 'x'.repeat(200);
  const capped = parseEntry(entry(tweet({ text: long })), NOW);
  assert.ok(capped.ok);
  assert.equal(capped.item.title.length, 120);
  assert.equal(capped.item.description.length, 200);
});

test('unwraps TweetWithVisibilityResults and skips tombstones and unavailable tweets', () => {
  const wrapped = parseEntry(
    entry({
      __typename: 'TweetWithVisibilityResults',
      tweet: tweet({ text: 'visible body' }),
    }),
    NOW,
  );
  assert.ok(wrapped.ok);
  assert.equal(wrapped.item.naturalKey, '1001');
  assert.equal(wrapped.item.description, 'visible body');

  for (const typename of ['TweetTombstone', 'TweetUnavailable']) {
    const parsed = parseEntry(entry({ __typename: typename, rest_id: '9' }), NOW);
    assert.equal(parsed.ok, false);
  }

  const batch = parseBookmarkEntries(
    [
      entry({ __typename: 'TweetTombstone', rest_id: '1' }, '1'),
      entry(tweet({ id: '2' }), '2'),
      entry({ __typename: 'TweetUnavailable', rest_id: '3' }, '3'),
    ],
    NOW,
  );
  assert.equal(batch.items.length, 1);
  assert.equal(batch.dropped, 2);
});

test('empty text becomes an article or media placeholder with no description', () => {
  const article = parseEntry(entry(tweet({ fullText: '', article: true })), NOW);
  assert.ok(article.ok);
  assert.equal(article.item.title, ARTICLE_PLACEHOLDER);
  assert.equal(article.item.description, '');

  const media = parseEntry(entry(tweet({ fullText: '' })), NOW);
  assert.ok(media.ok);
  assert.equal(media.item.title, MEDIA_PLACEHOLDER);
  assert.equal(media.item.description, '');
});

test('a missing handle degrades the url and keeps the id as the key', () => {
  const noHandle = parseEntry(entry(tweet({ id: '777', handle: '' })), NOW);
  assert.ok(noHandle.ok);
  assert.equal(noHandle.item.naturalKey, '777');
  assert.equal(noHandle.item.url, 'https://x.com/i/status/777');
  assert.equal(noHandle.item.extra.handle, '');
});

test('one batch keeps the first duplicate key and counts the rest as dropped', () => {
  const batch = parseBookmarkEntries(
    [
      entry(tweet({ id: '5', text: 'first' }), '5'),
      entry(tweet({ id: '6', text: 'other' }), '6'),
      entry(tweet({ id: '5', text: 'second' }), '5'),
    ],
    NOW,
  );

  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[0]?.description, 'first');
  assert.equal(batch.dropped, 1);
});

test('views convert from string while unreadable counts become null', () => {
  const withViews = parseEntry(entry(tweet({ views: '18158' })), NOW);
  assert.ok(withViews.ok);
  assert.equal(withViews.item.extra.views, 18158);

  const badViews = parseEntry(entry(tweet({ views: 'many' })), NOW);
  assert.ok(badViews.ok);
  assert.equal(badViews.item.extra.views, null);

  const noViews = parseEntry(entry(tweet()), NOW);
  assert.ok(noViews.ok);
  assert.equal(noViews.item.extra.views, null);
});

test('an entry without a tweet result or an id is dropped', () => {
  assert.equal(parseEntry({ entryId: 'tweet-1', content: {} }, NOW).ok, false);
  assert.equal(parseEntry(entry({ __typename: 'Tweet' }), NOW).ok, false);

  const fallbackDate = parseEntry(entry(tweet({ createdAt: 'not a date' })), NOW);
  assert.ok(fallbackDate.ok);
  assert.equal(fallbackDate.item.publishedAt, NOW, 'an unreadable created_at falls back to the fetch instant');

  const batch = parseBookmarkEntries([{ entryId: 'cursor-top-1' }, null, entry(tweet())], NOW);
  assert.equal(batch.items.length, 1);
  assert.equal(batch.dropped, 2);
});
