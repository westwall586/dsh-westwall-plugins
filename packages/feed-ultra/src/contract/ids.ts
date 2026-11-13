const SEPARATOR = '__';

const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ParsedItemId {
  sourceId: string;
  naturalKey: string;
}

/** `github_trending__openai%2Fdot`. The separator must never appear in a source id. */
export function composeItemId(sourceId: string, naturalKey: string): string {
  if (!SOURCE_ID_PATTERN.test(sourceId) || sourceId.includes(SEPARATOR)) {
    throw new Error(`invalid source id: ${JSON.stringify(sourceId)}`);
  }
  if (naturalKey.length === 0) throw new Error('natural key must not be empty');
  return `${sourceId}${SEPARATOR}${encodeURIComponent(naturalKey)}`;
}

export function parseItemId(id: string): ParsedItemId {
  const at = id.indexOf(SEPARATOR);
  if (at <= 0) throw new Error(`invalid item id: ${JSON.stringify(id)}`);
  const sourceId = id.slice(0, at);
  const encoded = id.slice(at + SEPARATOR.length);
  if (encoded.length === 0) throw new Error(`invalid item id: ${JSON.stringify(id)}`);
  try {
    return { sourceId, naturalKey: decodeURIComponent(encoded) };
  } catch {
    throw new Error(`invalid item id: ${JSON.stringify(id)}`);
  }
}
