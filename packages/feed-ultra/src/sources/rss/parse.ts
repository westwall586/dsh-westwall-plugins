import { parse as parseHtml } from 'node-html-parser';
import { parseFeed, parseOpml } from 'feedsmith';
import type { RawItem } from '../../contract/types.ts';
import { clampText } from '../../translate/text.ts';

const MAX_DESCRIPTION = 400;
const MAX_CATEGORIES = 5;
const MAX_CATEGORY_LENGTH = 40;
const MAX_ATTACHMENTS = 3;
const UNTITLED = '无标题';
const TIMEZONE = /(Z|[+-]\d{2}:?\d{2}|GMT|UTC|UT|[ECMP][SD]T)/;
const TAGGED_HTML = /<\/?(?:p|div|li|br|h[1-6]|tr|td|blockquote|pre)\b[^>]*>/gi;

export interface ParsedDrop {
  noLink: number;
  noKey: number;
  dupKey: number;
}

export interface ParsedFeed {
  /** Feed document title, or the URL host when the document has none. */
  title: string;
  items: RawItem[];
  /** Entries the document contained, before drops. */
  scanned: number;
  dropped: ParsedDrop;
}

export interface OpmlFeed {
  url: string;
  name: string;
}

/** A Requirable string is a bare string when strict parsing is off. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return '';
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return '';
  }
}

function plainText(raw: string): string {
  const value = raw.trim();
  if (value === '') return '';
  const spaced = value.replace(TAGGED_HTML, ' ');
  return parseHtml(spaced).textContent.replace(/\s+/g, ' ').trim();
}

function description(raw: string): string {
  return clampText(plainText(raw), MAX_DESCRIPTION);
}

function categoriesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const name = clampText(plainText(value), MAX_CATEGORY_LENGTH);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length === MAX_CATEGORIES) break;
  }
  return out;
}

function absoluteUrl(raw: string, base: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toInstant(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  // `2026-11-11T07:30:00` and `Nov 11, 2026` are parsed in the host zone without a marker.
  const guarded = TIMEZONE.test(value) ? value : `${value}Z`;
  const date = new Date(guarded);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeLink(raw: string): string {
  const value = raw.trim();
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') url.searchParams.delete(key);
    }
    const params = [...url.searchParams.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    url.search = '';
    for (const [key, item] of params) url.searchParams.append(key, item);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return value;
  }
}

function feedTitleOf(raw: unknown, feedUrl: string): string {
  const title = plainText(textOf(raw));
  return title === '' ? hostOf(feedUrl) : title;
}

export interface ParsedAttachment {
  url: string;
  type: string;
  length?: number;
}

interface MediaContentLike {
  url?: unknown;
  type?: unknown;
  medium?: unknown;
  fileSize?: unknown;
}

interface MediaLike {
  thumbnails?: Array<{ url?: unknown }>;
  contents?: MediaContentLike[];
  groups?: Array<{ contents?: MediaContentLike[] }>;
}

interface MediaInput {
  media?: MediaLike;
  enclosures?: Array<{ url?: unknown; type?: unknown; length?: unknown }>;
  links?: Array<{ href?: unknown; rel?: unknown; type?: unknown; length?: unknown }>;
  jsonImage?: unknown;
  jsonAttachments?: Array<{ url?: unknown; mime_type?: unknown; size_in_bytes?: unknown }>;
}

function attachmentType(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase().slice(0, 100);
}

function isAttachmentType(type: string): boolean {
  return type.startsWith('audio/') || type.startsWith('video/') || type === 'application/pdf';
}

function mediaOf(input: MediaInput, base: string): { imageUrl?: string; attachments?: ParsedAttachment[] } {
  let imageUrl: string | undefined;
  const attachments: ParsedAttachment[] = [];
  const seen = new Set<string>();

  const addImage = (raw: unknown): void => {
    const url = absoluteUrl(typeof raw === 'string' ? raw : '', base);
    if (url !== null && imageUrl === undefined) imageUrl = url;
  };

  const addAttachment = (raw: unknown, rawType: unknown, rawLength: unknown): void => {
    const url = absoluteUrl(typeof raw === 'string' ? raw : '', base);
    const type = attachmentType(rawType);
    if (url === null || seen.has(url) || !isAttachmentType(type) || attachments.length >= MAX_ATTACHMENTS) return;
    const length = Number(rawLength);
    seen.add(url);
    attachments.push({
      url,
      type,
      ...(Number.isFinite(length) && length > 0 ? { length: Math.floor(length) } : {}),
    });
  };

  addImage(input.jsonImage);
  for (const thumbnail of input.media?.thumbnails ?? []) addImage(thumbnail.url);
  const contents = [
    ...(input.media?.contents ?? []),
    ...(input.media?.groups ?? []).flatMap(group => group.contents ?? []),
  ];
  for (const content of contents) {
    const type = attachmentType(content.type);
    if (type.startsWith('image/') || attachmentType(content.medium) === 'image') addImage(content.url);
    addAttachment(content.url, type, content.fileSize);
  }
  for (const enclosure of input.enclosures ?? []) {
    const type = attachmentType(enclosure.type);
    if (type.startsWith('image/')) addImage(enclosure.url);
    else addAttachment(enclosure.url, type, enclosure.length);
  }
  for (const link of input.links ?? []) {
    if (link.rel !== 'enclosure') continue;
    const type = attachmentType(link.type);
    if (type.startsWith('image/')) addImage(link.href);
    else addAttachment(link.href, type, link.length);
  }
  for (const attachment of input.jsonAttachments ?? []) {
    addAttachment(attachment.url, attachment.mime_type, attachment.size_in_bytes);
  }

  return {
    ...(imageUrl === undefined ? {} : { imageUrl }),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

function itemExtra(input: {
  guid: string;
  feedUrl: string;
  feedTitle: string;
  hasContent: boolean;
  author: string;
  categories: readonly string[];
  dateSource: boolean;
  imageUrl?: string;
  attachments?: readonly ParsedAttachment[];
}): Record<string, unknown> {
  const extra: Record<string, unknown> = {
    guid: input.guid,
    feedUrl: input.feedUrl,
    feedTitle: input.feedTitle,
    hasContent: input.hasContent,
  };
  if (input.author !== '') extra.author = input.author;
  if (input.categories.length > 0) extra.categories = [...input.categories];
  if (input.imageUrl !== undefined) extra.imageUrl = input.imageUrl;
  if (input.attachments !== undefined && input.attachments.length > 0) extra.attachments = [...input.attachments];
  if (input.dateSource) extra.dateSource = 'fetch';
  return extra;
}

interface Draft {
  naturalKey: string;
  title: string;
  url: string;
  description: string;
  publishedAt: string;
  extra: Record<string, unknown>;
}

function collect(
  drafts: readonly Draft[],
  scanned: number,
  dropped: ParsedDrop,
  title: string,
): ParsedFeed {
  const seen = new Set<string>();
  const items: RawItem[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.naturalKey)) {
      dropped.dupKey += 1;
      continue;
    }
    seen.add(draft.naturalKey);
    items.push({
      naturalKey: draft.naturalKey,
      title: draft.title,
      description: draft.description,
      url: draft.url,
      publishedAt: draft.publishedAt,
      extra: draft.extra,
    });
  }
  return { title, items, scanned, dropped };
}

function rssFeed(feed: {
  title?: unknown;
  items?: readonly unknown[];
}, feedUrl: string, now: string): ParsedFeed {
  const title = feedTitleOf(feed.title, feedUrl);
  const dropped: ParsedDrop = { noLink: 0, noKey: 0, dupKey: 0 };
  const drafts: Draft[] = [];
  let scanned = 0;

  for (const raw of feed.items ?? []) {
    scanned += 1;
    const item = raw as {
      title?: unknown;
      link?: unknown;
      description?: string;
      pubDate?: unknown;
      guid?: { value?: unknown; isPermaLink?: boolean };
      rdf?: { about?: string };
      dc?: { creators?: string[]; dates?: unknown[]; descriptions?: string[] };
      atom?: { published?: unknown; updated?: unknown };
      content?: { encoded?: string };
      authors?: Array<{ name?: string }>;
      categories?: Array<{ name?: unknown }>;
      enclosures?: Array<{ url?: unknown; type?: unknown; length?: unknown }>;
      media?: MediaLike;
    };
    const url = absoluteUrl(textOf(item.link), feedUrl);
    if (url === null) {
      dropped.noLink += 1;
      continue;
    }
    const guid = textOf(item.guid?.value).trim() || String(item.rdf?.about ?? '').trim();
    const naturalKey = guid === '' ? normalizeLink(url) : guid;
    if (naturalKey === '') {
      dropped.noKey += 1;
      continue;
    }
    const published = toInstant(String(item.pubDate ?? item.atom?.published ?? item.dc?.dates?.[0] ?? ''));
    const itemTitle = plainText(textOf(item.title)) || UNTITLED;
    const content = textOf(item.content?.encoded);
    drafts.push({
      naturalKey,
      title: itemTitle,
      description: description(textOf(item.description) || item.dc?.descriptions?.[0] || content),
      url,
      publishedAt: published ?? now,
      extra: itemExtra({
        guid,
        feedUrl,
        feedTitle: title,
        hasContent: content.trim() !== '',
        author: String(item.dc?.creators?.[0] ?? item.authors?.[0]?.name ?? '').trim(),
        categories: categoriesOf((item.categories ?? []).map((category) => textOf(category.name))),
        dateSource: published === null,
        ...mediaOf({ media: item.media, enclosures: item.enclosures }, feedUrl),
      }),
    });
  }

  return collect(drafts, scanned, dropped, title);
}

function atomFeed(feed: {
  title?: unknown;
  entries?: readonly unknown[];
}, feedUrl: string, now: string): ParsedFeed {
  const title = feedTitleOf(feed.title, feedUrl);
  const dropped: ParsedDrop = { noLink: 0, noKey: 0, dupKey: 0 };
  const drafts: Draft[] = [];
  let scanned = 0;

  for (const raw of feed.entries ?? []) {
    scanned += 1;
    const entry = raw as {
      id?: unknown;
      title?: unknown;
      summary?: unknown;
      content?: unknown;
      published?: unknown;
      updated?: unknown;
      links?: Array<{ href?: string; rel?: string; type?: string; length?: number }>;
      authors?: Array<{ name?: string }>;
      categories?: Array<{ term?: unknown }>;
      media?: MediaLike;
    };
    const links = (entry.links ?? []).filter((link) => typeof link.href === 'string' && link.href !== '');
    const alternate = links.find((link) => link.rel === 'alternate') ?? links[0];
    const url = absoluteUrl(alternate?.href ?? '', feedUrl);
    if (url === null) {
      dropped.noLink += 1;
      continue;
    }
    const guid = textOf(entry.id).trim();
    const naturalKey = guid === '' ? normalizeLink(url) : guid;
    if (naturalKey === '') {
      dropped.noKey += 1;
      continue;
    }
    const published = toInstant(String(entry.published ?? entry.updated ?? ''));
    const content = textOf(entry.content);
    drafts.push({
      naturalKey,
      title: plainText(textOf(entry.title)) || UNTITLED,
      description: description(textOf(entry.summary) || content),
      url,
      publishedAt: published ?? now,
      extra: itemExtra({
        guid,
        feedUrl,
        feedTitle: title,
        hasContent: content.trim() !== '',
        author: String(entry.authors?.[0]?.name ?? '').trim(),
        categories: categoriesOf((entry.categories ?? []).map((category) => textOf(category.term))),
        dateSource: published === null,
        ...mediaOf({ media: entry.media, links }, feedUrl),
      }),
    });
  }

  return collect(drafts, scanned, dropped, title);
}

function jsonFeed(feed: {
  title?: unknown;
  items?: readonly unknown[];
}, feedUrl: string, now: string): ParsedFeed {
  const title = feedTitleOf(feed.title, feedUrl);
  const dropped: ParsedDrop = { noLink: 0, noKey: 0, dupKey: 0 };
  const drafts: Draft[] = [];
  let scanned = 0;

  for (const raw of feed.items ?? []) {
    scanned += 1;
    const item = raw as {
      id?: unknown;
      title?: string;
      url?: string;
      external_url?: string;
      content_text?: string;
      content_html?: string;
      summary?: string;
      date_published?: unknown;
      date_modified?: unknown;
      authors?: Array<{ name?: string }>;
      tags?: string[];
      image?: unknown;
      attachments?: Array<{ url?: unknown; mime_type?: unknown; size_in_bytes?: unknown }>;
    };
    const url = absoluteUrl(item.url ?? item.external_url ?? '', feedUrl);
    if (url === null) {
      dropped.noLink += 1;
      continue;
    }
    const guid = textOf(item.id).trim();
    const naturalKey = guid === '' ? normalizeLink(url) : guid;
    if (naturalKey === '') {
      dropped.noKey += 1;
      continue;
    }
    const published = toInstant(String(item.date_published ?? item.date_modified ?? ''));
    const content = item.content_html ?? '';
    drafts.push({
      naturalKey,
      title: plainText(item.title ?? '') || UNTITLED,
      description: description(item.content_text ?? item.summary ?? content),
      url,
      publishedAt: published ?? now,
      extra: itemExtra({
        guid,
        feedUrl,
        feedTitle: title,
        hasContent: content.trim() !== '' || (item.content_text ?? '').trim() !== '',
        author: String(item.authors?.[0]?.name ?? '').trim(),
        categories: categoriesOf(item.tags ?? []),
        dateSource: published === null,
        ...mediaOf({ jsonImage: item.image, jsonAttachments: item.attachments }, feedUrl),
      }),
    });
  }

  return collect(drafts, scanned, dropped, title);
}

export function parseFeedText(text: string, feedUrl: string, now: string): ParsedFeed {
  const parsed = parseFeed(text);
  switch (parsed.format) {
    case 'rss':
    case 'rdf':
      return rssFeed(parsed.feed as Parameters<typeof rssFeed>[0], feedUrl, now);
    case 'atom':
      return atomFeed(parsed.feed as Parameters<typeof atomFeed>[0], feedUrl, now);
    case 'json':
      return jsonFeed(parsed.feed as Parameters<typeof jsonFeed>[0], feedUrl, now);
  }
}

export function parseOpmlText(text: string): OpmlFeed[] {
  const document = parseOpml(text);
  const feeds: OpmlFeed[] = [];

  const walk = (outlines: readonly { xmlUrl?: string; text?: string; title?: string; outlines?: readonly unknown[] }[] | undefined): void => {
    for (const outline of outlines ?? []) {
      const url = String(outline.xmlUrl ?? '').trim();
      if (url !== '') {
        feeds.push({
          url,
          name: plainText(outline.text ?? '') || plainText(outline.title ?? '') || hostOf(url),
        });
      }
      walk(outline.outlines as typeof outlines);
    }
  };

  walk(document.body?.outlines);
  return feeds;
}
