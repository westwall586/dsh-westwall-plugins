import { z } from 'zod';
import type { CacheFile, FactFile, HealthRecord, StateFile, TranslationRecord } from './types.ts';

export const CONTRACT_VERSION = 1;

const rfc3339 = z.iso.datetime({ offset: true });
const timestampOrEmpty = z.union([rfc3339, z.literal('')]);
const version = z.literal(CONTRACT_VERSION);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const sourceDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
});

export const itemRecordSchema = z.object({
  id: z.string().min(1),
  naturalKey: z.string().min(1),
  title: z.string(),
  description: z.string(),
  url: z.url(),
  publishedAt: rfc3339,
  dayKey,
  firstSeenAt: rfc3339,
  lastSeenAt: rfc3339,
  extra: z.record(z.string(), z.unknown()),
});

const fetchStatusSchema = z.object({
  lastAttemptAt: rfc3339,
  lastSuccessAt: rfc3339,
  status: z.enum(['ok', 'error']),
  error: z.string(),
});

export const factFileSchema = z.object({
  version,
  source: sourceDescriptorSchema,
  day: dayKey,
  fetch: fetchStatusSchema,
  meta: z.record(z.string(), z.unknown()).optional(),
  items: z.array(itemRecordSchema),
});

const itemStateSchema = z.object({ readAt: rfc3339 });

export const stateFileSchema = z.object({
  version,
  day: dayKey,
  items: z.record(z.string(), itemStateSchema),
});

/**
 * One cache record. Provenance fields are optional so a record written by an
 * older build keeps its text; content fields are required.
 */
export const cacheEntrySchema = z.object({
  hash: z.string().min(1),
  lang: z.literal('zh-CN'),
  text: z.string().min(1),
  model: z.string().default(''),
  promptVersion: z.string().default(''),
  at: z.string().default(''),
});

export const cacheFileSchema = z.object({
  version,
  day: dayKey,
  items: z.record(z.string(), z.unknown()),
});

const autoAttemptsSchema = z
  .object({
    day: z.string(),
    count: z.number().int().min(0),
  })
  .default({ day: '', count: 0 });

export const healthRecordSchema = z.object({
  version,
  lastAttemptAt: timestampOrEmpty,
  lastSuccessAt: timestampOrEmpty,
  consecutiveFailures: z.number().int().min(0),
  lastError: z.string(),
  cursor: z.record(z.string(), z.unknown()),
  autoAttempts: autoAttemptsSchema,
  lastOutcome: z.enum(['ok', 'error', 'pending', '']).default(''),
  pendingAttempts: autoAttemptsSchema,
});

export function parseFactFile(input: unknown): FactFile {
  return factFileSchema.parse(input);
}

export function parseStateFile(input: unknown): StateFile {
  return stateFileSchema.parse(input);
}

/** Parse the envelope, then drop only the records this build cannot read. */
export function parseCacheFile(input: unknown): CacheFile {
  const envelope = cacheFileSchema.parse(input);
  const items: Record<string, TranslationRecord> = {};
  for (const [id, value] of Object.entries(envelope.items)) {
    const parsed = cacheEntrySchema.safeParse(value);
    if (parsed.success) items[id] = parsed.data;
  }
  return { version: CONTRACT_VERSION, day: envelope.day, items };
}

export function parseHealth(input: unknown): HealthRecord {
  return healthRecordSchema.parse(input);
}
