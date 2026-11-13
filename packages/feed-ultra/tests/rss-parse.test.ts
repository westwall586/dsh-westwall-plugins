import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { normalizeLink, parseFeedText, parseOpmlText, toInstant } from '../src/sources/rss/parse.ts';

const NOW = '2026-11-12T09:00:00.000Z';
const FEED_URL = 'https://example.com/feeds/rss.xml';

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../src/sources/rss/fixtures/${name}`, import.meta.url), 'utf8');
}

test('RSS 2.0 maps the full field set', async () => {
  const parsed = parseFeedText(await fixture('rss2-full.xml'), FEED_URL, NOW);

  assert.equal(parsed.title, 'Example Engineering');
  assert.equal(parsed.scanned, 2);
  assert.deepEqual(parsed.dropped, { noLink: 0, noKey: 0, dupKey: 0 });
  assert.equal(parsed.items.length, 2);

  const first = parsed.items[0];
  assert.equal(first.naturalKey, '01M742VWRK37TPYYPMXERSCWKN');
  assert.equal(first.title, 'Choosing QuePaxa');
  assert.equal(first.description, 'Cloudflare is building & testing a new consensus algorithm.');
  assert.equal(first.url, 'https://blog.example.com/quepaxa');
  assert.equal(first.publishedAt, '2026-11-11T14:24:46.000Z');
  assert.deepEqual(first.extra, {
    guid: '01M742VWRK37TPYYPMXERSCWKN',
    feedUrl: FEED_URL,
    feedTitle: 'Example Engineering',
    hasContent: true,
    author: 'João Pedro Leite',
    categories: ['Engineering', 'Consensus'],
    attachments: [{ url: 'https://blog.example.com/quepaxa.mp3', type: 'audio/mpeg', length: 12345 }],
  });

  const second = parsed.items[1];
  assert.equal(second.naturalKey, 'https://blog.example.com/permalink');
  assert.equal(second.title, 'Permalink item with & entities');
  assert.equal(second.description, 'Second item with a break.');
  assert.equal(second.publishedAt, '2026-11-12T00:22:09.000Z');
  assert.deepEqual(second.extra, {
    guid: 'https://blog.example.com/permalink',
    feedUrl: FEED_URL,
    feedTitle: 'Example Engineering',
    hasContent: false,
  });
});

test('Atom maps alternate links, object fields and updated fallback', async () => {
  const parsed = parseFeedText(await fixture('atom-full.xml'), FEED_URL, NOW);

  assert.equal(parsed.title, 'Atom Example');
  assert.equal(parsed.scanned, 3);
  assert.deepEqual(parsed.dropped, { noLink: 1, noKey: 0, dupKey: 0 });
  assert.equal(parsed.items.length, 2);

  const first = parsed.items[0];
  assert.equal(first.naturalKey, 'tag:example.com,2026:entry-1');
  assert.equal(first.title, 'Rust 1.90');
  assert.equal(first.description, 'Summary with entities.');
  assert.equal(first.url, 'https://example.com/posts/one');
  assert.equal(first.publishedAt, '2026-11-10T23:30:00.000Z');
  assert.deepEqual(first.extra, {
    guid: 'tag:example.com,2026:entry-1',
    feedUrl: FEED_URL,
    feedTitle: 'Atom Example',
    hasContent: true,
    author: 'Ann Author',
    categories: ['ai', 'rust'],
  });

  const second = parsed.items[1];
  assert.equal(second.url, 'https://example.com/posts/two');
  assert.equal(second.publishedAt, '2026-11-12T10:00:00.000Z');
  assert.equal(second.description, 'No published date.');
  assert.equal(second.extra.hasContent, false);
});

test('entries without a guid fall back to the normalized link', async () => {
  const parsed = parseFeedText(await fixture('no-guid-date.xml'), FEED_URL, NOW);

  assert.equal(parsed.scanned, 5);
  assert.deepEqual(parsed.dropped, { noLink: 1, noKey: 0, dupKey: 0 });
  assert.equal(parsed.items.length, 4);

  const [local, future, untitled, garbage] = parsed.items;
  assert.equal(local.naturalKey, 'https://sspai.example.com/posts/local');
  assert.equal(local.publishedAt, '2026-11-11T07:30:00.000Z');
  assert.equal(local.extra.guid, '');
  assert.equal(future.publishedAt, '2027-01-01T00:00:00.000Z');
  assert.equal(untitled.title, '无标题');
  assert.equal(garbage.publishedAt, NOW);
  assert.equal(garbage.extra.dateSource, 'fetch');
});

test('hostile entries are dropped or repaired without throwing', async () => {
  const parsed = parseFeedText(await fixture('hostile.xml'), FEED_URL, NOW);

  assert.equal(parsed.scanned, 6);
  assert.deepEqual(parsed.dropped, { noLink: 2, noKey: 0, dupKey: 1 });
  assert.equal(parsed.items.length, 3);

  assert.equal(parsed.items[0].title, 'Double escaped');
  assert.equal(parsed.items[0].description, '<p>Literal markup & text</p>');
  assert.equal(parsed.items[1].title, 'Relative link');
  assert.equal(parsed.items[1].url, 'https://example.com/posts/relative');
  assert.equal(parsed.items[2].title, 'Garbage date');
  assert.equal(parsed.items[2].extra.dateSource, 'fetch');
});

test('a description is clamped to 400 code points', () => {
  const long = 'é'.repeat(450);
  const parsed = parseFeedText(
    `<rss version="2.0"><channel><title>T</title><item><title>x</title><link>https://example.com/x</link><guid>x</guid><description>${long}</description></item></channel></rss>`,
    FEED_URL,
    NOW,
  );
  assert.equal([...parsed.items[0].description].length, 400);
});

test('toInstant guards a missing timezone and rejects garbage', () => {
  assert.equal(toInstant('Wed, 11 Nov 2026 14:24:46 GMT'), '2026-11-11T14:24:46.000Z');
  assert.equal(toInstant('Thu, 12 Nov 2026 08:22:09 +0800'), '2026-11-12T00:22:09.000Z');
  assert.equal(toInstant('Tue, 11 Nov 2026 07:30:00 EST'), '2026-11-11T12:30:00.000Z');
  assert.equal(toInstant('Tue, 11 Nov 26 07:30:00 GMT'), '2026-11-11T07:30:00.000Z');
  assert.equal(toInstant('11 Nov 2026 07:30:00 +0000'), '2026-11-11T07:30:00.000Z');
  assert.equal(toInstant('Wed, 11 Nov 2026 14:24:46 UT'), '2026-11-11T14:24:46.000Z');
  assert.equal(toInstant('Tue, 11 Nov 2026 14:24:46 -0000'), '2026-11-11T14:24:46.000Z');
  assert.equal(toInstant('2026-11-11 07:30:00'), '2026-11-11T07:30:00.000Z');
  assert.equal(toInstant('Nov 11, 2026'), '2026-11-11T00:00:00.000Z');
  assert.equal(toInstant('2026-11-11T07:30:00'), '2026-11-11T07:30:00.000Z');
  assert.equal(toInstant('garbage'), null);
  assert.equal(toInstant('   '), null);
});

test('normalizeLink removes tracking, fragments and trailing slashes', () => {
  assert.equal(
    normalizeLink('HTTPS://Example.COM/Path/?b=2&utm_source=x&a=1#frag'),
    'https://example.com/Path?a=1&b=2',
  );
  assert.equal(normalizeLink('https://example.com/'), 'https://example.com/');
  assert.equal(normalizeLink('https://example.com/post/?fbclid=1&gclid=2'), 'https://example.com/post');
  assert.equal(normalizeLink('not a url'), 'not a url');
});

test('parseOpmlText flattens nested outlines', () => {
  const feeds = parseOpmlText(`<opml version="2.0"><head><title>Subs</title></head><body>
    <outline text="Tech">
      <outline text="Blog" xmlUrl="https://b.example/rss" htmlUrl="https://b.example/"/>
      <outline title="Site" type="rss" xmlUrl="https://c.example/feed"/>
    </outline>
    <outline text="No feed"/>
  </body></opml>`);

  assert.deepEqual(feeds, [
    { url: 'https://b.example/rss', name: 'Blog' },
    { url: 'https://c.example/feed', name: 'Site' },
  ]);
});

test('RSS enclosures and media fill imageUrl and attachments, not inline images', () => {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <title>Media Feed</title>
        <link>https://example.com/</link>
        <description>d</description>
        <item>
          <title>Media item</title>
          <link>https://example.com/media</link>
          <guid>media-1</guid>
          <pubDate>Thu, 12 Nov 2026 00:00:00 GMT</pubDate>
          <description><![CDATA[<p>Body</p><img src="https://tracker.example/pixel.gif">]]></description>
          <media:thumbnail url="https://cdn.example.com/thumb.jpg"/>
          <enclosure url="https://cdn.example.com/cover.jpg" length="0" type="image/jpeg"/>
          <enclosure url="https://cdn.example.com/audio.mp3" length="1234" type="audio/mpeg"/>
          <enclosure url="https://cdn.example.com/doc.pdf" type="application/pdf"/>
        </item>
      </channel>
    </rss>`;
  const parsed = parseFeedText(xml, FEED_URL, NOW);
  const item = parsed.items[0];
  assert.equal(item.description, 'Body');
  assert.equal(item.extra.imageUrl, 'https://cdn.example.com/thumb.jpg');
  assert.deepEqual(item.extra.attachments, [
    { url: 'https://cdn.example.com/audio.mp3', type: 'audio/mpeg', length: 1234 },
    { url: 'https://cdn.example.com/doc.pdf', type: 'application/pdf' },
  ]);
});

test('Atom enclosure links and JSON attachments map to the same extras', () => {
  const atom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Media</title>
      <id>tag:example.com,2026:feed</id>
      <updated>2026-11-12T00:00:00Z</updated>
      <entry>
        <title>Atom item</title>
        <id>tag:example.com,2026:entry-media</id>
        <link rel="alternate" href="https://example.com/atom-item"/>
        <link rel="enclosure" type="audio/mpeg" length="99" href="https://cdn.example.com/atom.mp3"/>
        <updated>2026-11-12T00:00:00Z</updated>
      </entry>
    </feed>`;
  const parsedAtom = parseFeedText(atom, FEED_URL, NOW);
  const atomAttachments = parsedAtom.items[0].extra.attachments as Array<{ url: string }>;
  assert.equal(atomAttachments[0]?.url, 'https://cdn.example.com/atom.mp3');
  assert.equal(parsedAtom.items[0].extra.imageUrl, undefined);

  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JSON Media',
    items: [{
      id: 'json-media',
      url: 'https://example.com/json-item',
      content_text: 'Body',
      image: 'https://cdn.example.com/json.jpg',
      attachments: [
        { url: 'https://cdn.example.com/json.pdf', mime_type: 'application/pdf', size_in_bytes: 42 },
        { url: 'https://cdn.example.com/json.mp3', mime_type: 'audio/mpeg' },
      ],
    }],
  });
  const parsedJson = parseFeedText(json, FEED_URL, NOW);
  assert.equal(parsedJson.items[0].extra.imageUrl, 'https://cdn.example.com/json.jpg');
  assert.deepEqual(parsedJson.items[0].extra.attachments, [
    { url: 'https://cdn.example.com/json.pdf', type: 'application/pdf', length: 42 },
    { url: 'https://cdn.example.com/json.mp3', type: 'audio/mpeg' },
  ]);
});
