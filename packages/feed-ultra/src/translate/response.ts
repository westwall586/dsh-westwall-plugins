export interface ParsedBatch {
  /** key -> zh, already trimmed. Only requested keys can appear. */
  readonly entries: ReadonlyMap<string, string>;
  readonly missingKeys: readonly string[];
  /** Entries that produced no answer: malformed, empty, extra key, overwritten duplicate. */
  readonly ignored: number;
  /** '' when the payload was structurally usable, even if some keys were unanswered. */
  readonly error: string;
}

type JsonResult = { ok: true; value: unknown } | { ok: false };

function tryJson(text: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/);
  const body = match?.[1];
  return body === undefined ? text : body.trim();
}

function sliceArray(text: string): string | undefined {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  return start === -1 || end <= start ? undefined : text.slice(start, end + 1);
}

function arrayOf(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? items : undefined;
}

/**
 * Parse one model reply with partial salvage: answerable keys are kept, extra
 * keys never reach the cache, and a structurally unusable payload is retried by
 * the caller exactly once.
 */
export function parseBatch(raw: string, requested: readonly string[]): ParsedBatch {
  const text = stripCodeFence(raw.trim());
  const direct = tryJson(text);
  let value: unknown;
  let found = false;
  if (direct.ok) {
    value = direct.value;
    found = true;
  } else {
    const sliced = sliceArray(text);
    const fallback = sliced === undefined ? undefined : tryJson(sliced);
    if (fallback?.ok === true) {
      value = fallback.value;
      found = true;
    }
  }
  const list = found ? arrayOf(value) : undefined;

  if (list === undefined) {
    return {
      entries: new Map(),
      missingKeys: [...requested],
      ignored: 0,
      error: found ? 'expected an array of {key, zh}' : 'no JSON array in the response',
    };
  }

  const entries = new Map<string, string>();
  const requestedSet = new Set(requested);
  let ignored = 0;

  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      ignored += 1;
      continue;
    }
    const keyValue = (entry as { key?: unknown }).key;
    const zhValue = (entry as { zh?: unknown }).zh;
    if (typeof keyValue !== 'string' || typeof zhValue !== 'string') {
      ignored += 1;
      continue;
    }
    const key = keyValue.trim();
    const zh = zhValue.trim();
    if (key === '' || zh === '') {
      ignored += 1;
      continue;
    }
    if (!requestedSet.has(key)) {
      ignored += 1;
      continue;
    }
    if (entries.has(key)) ignored += 1;
    entries.set(key, zh);
  }

  return {
    entries,
    missingKeys: requested.filter((key) => !entries.has(key)),
    ignored,
    error: '',
  };
}
