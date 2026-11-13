import type { ItemRecord, ModelChoice, TranslationRecord } from '../contract/types.ts';
import type { Layout } from '../store/paths.ts';
import { windowDays } from '../store/read.ts';
import {
  readDayCache,
  readWindowCache,
  withRecords,
  writeDayCache,
  type DayCache,
  type WindowCache,
} from '../store/cache.ts';
import { startBudget, TRANSLATE_BUDGET_MS, type Budget } from './budget.ts';
import { buildDedupeIndex, lookupByHash } from './dedupe.ts';
import { callModel, resolveModelChoice, type LlmTranslateService } from './model.ts';
import { planTranslations, chunk, type PendingUnit } from './plan.ts';
import { buildRequest, MAX_BATCH, PROMPT_VERSION } from './prompt.ts';
import { parseBatch } from './response.ts';

export type TranslationStage = 'plan' | 'queue' | 'resolve' | 'call' | 'parse' | 'commit';

export interface TranslationOutcome {
  /** Item ids that gained a record produced by the model this run. */
  readonly translated: number;
  /** Item ids needing nothing, including hash reuse and already-Chinese rows. */
  readonly skipped: number;
  /** Item ids still missing when the run ended. */
  readonly failed: number;
  readonly failure: { stage: TranslationStage; error: string } | null;
  readonly reached: TranslationStage;
}

export interface TranslateDayResult {
  readonly outcome: TranslationOutcome;
  readonly modelCalls: number;
}

export interface TranslateDayInput {
  readonly l: Layout;
  readonly day: string;
  readonly today: string;
  readonly items: readonly ItemRecord[];
  readonly retentionDays: number;
  readonly llm: LlmTranslateService | null;
  readonly model: ModelChoice | null;
  readonly readDefault: () => ModelChoice | null;
  readonly now: () => Date;
  /** Fixed by the caller before the day gate, so queue time counts against it. */
  readonly budget?: Budget;
  /** Used only when no budget is supplied; the engine then owns and disposes it. */
  readonly budgetMs?: number;
}

const MAX_ERROR_LENGTH = 300;

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}

function timeoutMessage(missing: number): string {
  return `翻译超时，${missing} 条仍显示原文`;
}

function countIds(units: readonly PendingUnit[]): number {
  let count = 0;
  for (const unit of units) count += unit.itemIds.length;
  return count;
}

function countBatches(batches: readonly PendingUnit[][]): number {
  let count = 0;
  for (const batch of batches) count += countIds(batch);
  return count;
}

function recordsFor(
  units: readonly PendingUnit[],
  entries: ReadonlyMap<string, string>,
  choice: ModelChoice,
  at: string,
): Array<[string, TranslationRecord]> {
  const records: Array<[string, TranslationRecord]> = [];
  for (const unit of units) {
    const text = entries.get(unit.key);
    if (text === undefined) continue;
    const record: TranslationRecord = {
      hash: unit.hash,
      lang: 'zh-CN',
      text,
      model: `${choice.provider}/${choice.model}`,
      promptVersion: PROMPT_VERSION,
      at,
    };
    for (const id of unit.itemIds) records.push([id, record]);
  }
  return records;
}

type BatchAttempt =
  | { readonly kind: 'done'; readonly entries: ReadonlyMap<string, string>; readonly error: string; readonly calls: number }
  | { readonly kind: 'transport'; readonly error: string; readonly calls: number }
  | { readonly kind: 'timeout'; readonly calls: number };

interface BatchContext {
  readonly llm: LlmTranslateService | null;
  readonly choice: ModelChoice;
  readonly budget: Budget;
}

/** One model exchange, retried exactly once only when the reply was not structurally usable. */
async function attemptBatch(units: readonly PendingUnit[], ctx: BatchContext): Promise<BatchAttempt> {
  const keys = units.map((unit) => unit.key);
  const request = buildRequest(units);

  let raw: string;
  try {
    raw = await callModel({ llm: ctx.llm, choice: ctx.choice, request, signal: ctx.budget.signal });
  } catch (error) {
    return ctx.budget.timedOut
      ? { kind: 'timeout', calls: 1 }
      : { kind: 'transport', error: errorText(error), calls: 1 };
  }

  const parsed = parseBatch(raw, keys);
  if (parsed.error === '') return { kind: 'done', entries: parsed.entries, error: '', calls: 1 };

  try {
    const retryRequest = buildRequest(units, parsed.error);
    raw = await callModel({ llm: ctx.llm, choice: ctx.choice, request: retryRequest, signal: ctx.budget.signal });
  } catch (error) {
    return ctx.budget.timedOut
      ? { kind: 'timeout', calls: 2 }
      : { kind: 'transport', error: errorText(error), calls: 2 };
  }

  const retried = parseBatch(raw, keys);
  return { kind: 'done', entries: retried.entries, error: retried.error, calls: 2 };
}

function result(
  outcome: TranslationOutcome,
  modelCalls: number,
): TranslateDayResult {
  return { outcome, modelCalls };
}

/**
 * Translate one day's snapshot under the caller's day gate. Each finished batch
 * is committed before the next is sent, so a later timeout cannot uncommit it.
 */
export async function translateDay(input: TranslateDayInput): Promise<TranslateDayResult> {
  if (input.budget !== undefined) return translateWithBudget(input, input.budget);
  const budget = startBudget(input.budgetMs ?? TRANSLATE_BUDGET_MS);
  try {
    return await translateWithBudget(input, budget);
  } finally {
    budget.dispose();
  }
}

async function translateWithBudget(input: TranslateDayInput, budget: Budget): Promise<TranslateDayResult> {
  const { l, day, today, items, retentionDays, llm, model, readDefault, now } = input;
  const at = now().toISOString();
  let modelCalls = 0;

  let existing: DayCache;
  try {
    existing = await readDayCache(l, day);
  } catch (error) {
    return result(
      { translated: 0, skipped: 0, failed: items.length, failure: { stage: 'plan', error: errorText(error) }, reached: 'plan' },
      modelCalls,
    );
  }

  const plan = planTranslations(existing, items);
  if (budget.timedOut) {
    return result(
      {
        translated: 0,
        skipped: plan.skipped,
        failed: plan.missing,
        failure: plan.missing === 0 ? null : { stage: 'queue', error: timeoutMessage(plan.missing) },
        reached: 'queue',
      },
      modelCalls,
    );
  }

  let window: WindowCache;
  try {
    window = await readWindowCache(l, windowDays(today, retentionDays));
  } catch {
    // The index only makes reuse cheaper; losing it costs at most one duplicate call.
    window = { caches: [], unreadable: [] };
  }
  const index = buildDedupeIndex({ caches: window.caches, unreadable: window.unreadable, builtAt: at });

  let current = existing;
  let translated = 0;
  let skipped = plan.skipped;
  let reusedCount = 0;
  const reusedHashes = new Set<string>();
  const reuseRecords: Array<[string, TranslationRecord]> = [];

  for (const unit of plan.units) {
    const hit = lookupByHash(index, unit.hash);
    if (hit === null) continue;
    reusedHashes.add(unit.hash);
    reusedCount += unit.itemIds.length;
    for (const id of unit.itemIds) reuseRecords.push([id, hit]);
  }

  if (reuseRecords.length > 0) {
    const next = withRecords(current, reuseRecords);
    try {
      await writeDayCache(l, next);
      current = next;
      skipped += reusedCount;
    } catch (error) {
      return result(
        {
          translated: 0,
          skipped: plan.skipped,
          failed: plan.missing,
          failure: { stage: 'commit', error: errorText(error) },
          reached: 'commit',
        },
        modelCalls,
      );
    }
  }

  const toSend = plan.units.filter((unit) => !reusedHashes.has(unit.hash));
  if (toSend.length === 0) {
    return result(
      {
        translated: 0,
        skipped,
        failed: 0,
        failure: null,
        reached: reuseRecords.length > 0 ? 'commit' : 'plan',
      },
      modelCalls,
    );
  }

  const resolved = resolveModelChoice(model, readDefault);
  if ('error' in resolved) {
    return result(
      {
        translated: 0,
        skipped,
        failed: plan.missing - reusedCount,
        failure: { stage: 'resolve', error: resolved.error },
        reached: 'resolve',
      },
      modelCalls,
    );
  }

  const batches = chunk(toSend, MAX_BATCH);
  let failed = plan.missing - reusedCount;
  let failure: TranslationOutcome['failure'] = null;
  let reached: TranslationStage = 'call';

  for (const [index, batch] of batches.entries()) {
    if (budget.timedOut) {
      failure = { stage: 'call', error: timeoutMessage(failed) };
      reached = 'call';
      break;
    }

    const attempt = await attemptBatch(batch, { llm, choice: resolved.choice, budget });
    modelCalls += attempt.calls;

    if (attempt.kind === 'timeout') {
      failure = { stage: 'call', error: timeoutMessage(failed) };
      reached = 'call';
      break;
    }
    if (attempt.kind === 'transport') {
      failure = { stage: 'call', error: attempt.error };
      reached = 'call';
      break;
    }

    const records = recordsFor(batch, attempt.entries, resolved.choice, at);
    if (records.length > 0) {
      const next = withRecords(current, records);
      try {
        await writeDayCache(l, next);
        current = next;
        translated += records.length;
      } catch (error) {
        failure = { stage: 'commit', error: errorText(error) };
        reached = 'commit';
        failed = countIds(batch) + countBatches(batches.slice(index + 1));
        break;
      }
    }

    failed = countIds(batch.filter((unit) => !attempt.entries.has(unit.key))) + countBatches(batches.slice(index + 1));
    if (attempt.error !== '') {
      failure = { stage: 'parse', error: attempt.error };
      reached = 'parse';
    } else {
      reached = 'commit';
    }
  }

  return result(
    {
      translated,
      skipped,
      failed,
      failure,
      reached: failure === null ? 'commit' : reached,
    },
    modelCalls,
  );
}
