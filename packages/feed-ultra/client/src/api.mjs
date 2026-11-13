/**
 * The hand-written Remote descriptors for the feedUltra service. 0.2.2's Client
 * Gateway rejects every parameter without a strict codec, so each descriptor
 * carries one and names its wire field exactly as the host SRC does.
 */

export const JSON_CODEC = {
  mode: 'strict',
  typeSymbol: 'json',
  create: () => ({ parse: value => value }),
};

const PARAM = name => ({ name, wire: name, source: 'json', codec: JSON_CODEC });

export const DESCRIPTORS = [
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.status',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'status',
    invocation: { kind: 'direct' },
    parameters: [],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.bindWorkspace',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'bindWorkspace',
    invocation: { kind: 'direct' },
    parameters: [PARAM('path')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.sources',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'sources',
    invocation: { kind: 'direct' },
    parameters: [],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.day',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'day',
    invocation: { kind: 'direct' },
    parameters: [PARAM('date')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.calendar',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'calendar',
    invocation: { kind: 'direct' },
    parameters: [PARAM('from'), PARAM('to')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.act',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'act',
    invocation: { kind: 'direct' },
    parameters: [PARAM('action'), PARAM('ids')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.fetch',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'fetch',
    invocation: { kind: 'direct' },
    parameters: [PARAM('sourceId')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.backfill',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'backfill',
    invocation: { kind: 'direct' },
    parameters: [PARAM('sourceId'), PARAM('day')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.translate',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'translate',
    invocation: { kind: 'direct' },
    parameters: [PARAM('sourceId'), PARAM('day')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.models',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'models',
    invocation: { kind: 'direct' },
    parameters: [],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.modelEfforts',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'modelEfforts',
    invocation: { kind: 'direct' },
    parameters: [PARAM('provider'), PARAM('model')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.rssLibrary',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'rssLibrary',
    invocation: { kind: 'direct' },
    parameters: [],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.rssLibraryMutate',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'rssLibraryMutate',
    invocation: { kind: 'direct' },
    parameters: [PARAM('ops')],
    result: JSON_CODEC,
  },
  {
    version: 1,
    id: 'dsh-feed-ultra/feedUltra.rssPreview',
    service: 'feedUltra',
    namespace: 'feedUltra',
    method: 'rssPreview',
    invocation: { kind: 'direct' },
    parameters: [PARAM('url')],
    result: JSON_CODEC,
  },
];

export const CLIENT_CONTRIBUTION = { package: 'dsh-feed-ultra', descriptors: DESCRIPTORS };

/** Turn a Remote result into its value, or throw an Error that keeps the host code. */
export function unwrap(result, what = 'feedUltra') {
  if (result && result.ok === true) return result.value;
  const message = result?.error?.message || 'unknown error';
  const error = new Error(`${what}: ${message}`);
  error.code = result?.error?.code;
  throw error;
}

async function call(feedUltra, method, args, what) {
  return unwrap(await feedUltra[method](...args), what);
}

/**
 * Thin value-level facade over the mounted `remote.feedUltra` namespace. The
 * namespace must be read through an injected context (`ctx.inject(['remote.feedUltra'])`),
 * so the caller passes the namespace object, never the parent context.
 */
export function createApi(feedUltra) {
  return {
    status: () => call(feedUltra, 'status', [], 'feedUltra.status'),
    bindWorkspace: path => call(feedUltra, 'bindWorkspace', [path], 'feedUltra.bindWorkspace'),
    sources: () => call(feedUltra, 'sources', [], 'feedUltra.sources'),
    day: date => call(feedUltra, 'day', [date], 'feedUltra.day'),
    calendar: (from, to) => call(feedUltra, 'calendar', [from, to], 'feedUltra.calendar'),
    act: (action, ids) => call(feedUltra, 'act', [action, ids], 'feedUltra.act'),
    fetch: sourceId => call(feedUltra, 'fetch', [sourceId], 'feedUltra.fetch'),
    backfill: (sourceId, day) => call(feedUltra, 'backfill', [sourceId, day], 'feedUltra.backfill'),
    translate: (sourceId, day) => call(feedUltra, 'translate', [sourceId, day], 'feedUltra.translate'),
    models: () => call(feedUltra, 'models', [], 'feedUltra.models'),
    modelEfforts: (provider, model) => call(feedUltra, 'modelEfforts', [provider, model], 'feedUltra.modelEfforts'),
    rssLibrary: () => call(feedUltra, 'rssLibrary', [], 'feedUltra.rssLibrary'),
    rssLibraryMutate: ops => call(feedUltra, 'rssLibraryMutate', [ops], 'feedUltra.rssLibraryMutate'),
    rssPreview: url => call(feedUltra, 'rssPreview', [url], 'feedUltra.rssPreview'),
  };
}
