import { z } from 'zod';
import type { RawItem } from '../../contract/types.ts';

const briefContentItemSchema = z.object({
  resourceId: z.string().optional(),
  contentType: z.string().nullish(),
  language: z.string().nullish(),
  title: z.string().nullish(),
  matchReason: z.string().nullish(),
  sourceName: z.string().nullish(),
  totalScore: z.number().nullish(),
  editorialRole: z.string().nullish(),
});

const briefDataSchema = z.object({
  briefDate: z.string().nullish(),
  status: z.string().nullish(),
  contentItems: z.array(briefContentItemSchema),
  keywords: z.array(z.string()).nullish(),
  podcastCoverUrl: z.string().nullish(),
  podcastTitle: z.string().nullish(),
  editorIntro: z.string().nullish(),
});

export const briefResponseSchema = z.object({
  success: z.boolean().nullish(),
  data: briefDataSchema.nullable(),
});

export const batchMetaItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().nullish(),
  oneSentenceSummary: z.string().nullish(),
  url: z.string().nullish(),
  readUrl: z.string().nullish(),
  cover: z.string().nullish(),
  sourceName: z.string().nullish(),
  resourceType: z.string().nullish(),
  language: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  wordCount: z.number().nullish(),
  readTime: z.number().nullish(),
  publishTimeStamp: z.number().nullish(),
  score: z.number().nullish(),
});

export const batchMetaResponseSchema = z.object({
  success: z.boolean().nullish(),
  data: z.array(batchMetaItemSchema),
});

export type BriefData = z.infer<typeof briefDataSchema>;
export type BatchMetaItem = z.infer<typeof batchMetaItemSchema>;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const value of values) if (typeof value === 'string' && value !== '') return value;
  return '';
}

function localMidnight(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toISOString();
}

function fallbackDayOf(data: BriefData, day: string): string {
  return typeof data.briefDate === 'string' && DAY_PATTERN.test(data.briefDate) ? data.briefDate : day;
}

/** `publishTimeStamp` is milliseconds; a missing or unreadable value falls back to the brief's local midnight. */
function publishedAtOf(publishTimeStamp: number | null | undefined, fallbackDay: string): string {
  if (typeof publishTimeStamp === 'number' && Number.isFinite(publishTimeStamp)) {
    const date = new Date(publishTimeStamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return localMidnight(fallbackDay);
}

export function deriveReadUrl(resourceId: string, contentType: string | null | undefined): string {
  const bare = resourceId.replace(/^RAW_/, '');
  const route = contentType?.toUpperCase() === 'VIDEO' ? 'video' : 'article';
  return `https://www.bestblogs.dev/${route}/${bare}`;
}

function kindOf(resourceType: string | null | undefined): 'article' | 'video' {
  return resourceType?.toUpperCase() === 'VIDEO' ? 'video' : 'article';
}

export interface MappedItems {
  items: RawItem[];
  /** Content items discarded because they carry no `resourceId`. */
  dropped: number;
}

/**
 * Maps one brief plus its batch-meta details into raw items, preserving the source order.
 * A detail item missing from the response (or a fully failed request) uses content-item fallbacks.
 */
export function mapBriefItems(data: BriefData, details: readonly BatchMetaItem[], day: string): MappedItems {
  const byId = new Map<string, BatchMetaItem>();
  for (const detail of details) if (!byId.has(detail.id)) byId.set(detail.id, detail);

  const fallbackPublishedAt = fallbackDayOf(data, day);
  const items: RawItem[] = [];
  let dropped = 0;

  for (const entry of data.contentItems) {
    const naturalKey = entry.resourceId;
    if (typeof naturalKey !== 'string' || naturalKey === '') {
      dropped += 1;
      continue;
    }

    const detail = byId.get(naturalKey);
    items.push({
      naturalKey,
      title: firstNonEmpty(detail?.title, entry.title),
      description: firstNonEmpty(detail?.oneSentenceSummary, entry.matchReason),
      url: firstNonEmpty(detail?.readUrl, deriveReadUrl(naturalKey, entry.contentType)),
      publishedAt: publishedAtOf(detail?.publishTimeStamp, fallbackPublishedAt),
      extra: {
        originalUrl: detail?.url ?? '',
        cover: detail?.cover ?? '',
        source: firstNonEmpty(detail?.sourceName, entry.sourceName),
        score: detail?.score ?? entry.totalScore ?? null,
        kind: kindOf(detail?.resourceType),
        role: entry.editorialRole ?? '',
        tags: detail?.tags ?? [],
        lang: detail?.language ?? '',
        words: detail?.wordCount ?? null,
        readTime: detail?.readTime ?? null,
      },
    });
  }

  return { items, dropped };
}

export interface BriefMetaInput {
  data: BriefData;
  day: string;
  locale: string;
  detailStatus: 'ok' | 'degraded';
  dropped: number;
}

export function briefMeta(input: BriefMetaInput): Record<string, unknown> {
  const { data, day, locale, detailStatus, dropped } = input;
  return {
    briefDate: data.briefDate ?? day,
    episodeTitle: data.podcastTitle ?? '',
    intro: data.editorIntro ?? '',
    keywords: (data.keywords ?? []).slice(0, 10),
    cover: data.podcastCoverUrl ?? '',
    webUrl: `https://www.bestblogs.dev/explore/brief/${day}`,
    locale,
    notPublished: false,
    detailStatus,
    dropped,
  };
}

/** The empty-snapshot marker for a past day that never published a brief. */
export function notPublishedMeta(data: BriefData | null, day: string, locale: string): Record<string, unknown> {
  return {
    briefDate: data?.briefDate ?? day,
    webUrl: `https://www.bestblogs.dev/explore/brief/${day}`,
    locale,
    notPublished: true,
    detailStatus: 'ok',
    dropped: 0,
  };
}
