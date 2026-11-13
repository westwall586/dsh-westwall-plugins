/**
 * Value-level facade over `remote.settings` for this plugin's own entry. The
 * host projects one namespace per profile plugin entry, so the panel edits the
 * leaves of `dsh-feed-ultra` and never parses a raw settings document.
 */

import { unwrap } from './api.mjs';

export const SETTINGS_NS = 'dsh-feed-ultra';
export const DEFAULT_SCHEDULE_AT = '08:00';
export const DEFAULT_BATCH_SIZE = 3;
export const BATCH_SIZE_MIN = 1;
export const BATCH_SIZE_MAX = 20;

const RETENTION_DEFAULT = 30;
const SCHEDULE_AT_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function recordOf(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function isScheduleAt(value) {
  return typeof value === 'string' && SCHEDULE_AT_PATTERN.test(value);
}

/** A wire model choice, or `null` for "follow the DSH default". */
export function normalizeModelChoice(raw) {
  const source = recordOf(raw);
  if (!source) return null;
  const provider = typeof source.provider === 'string' ? source.provider.trim() : '';
  const model = typeof source.model === 'string' ? source.model.trim() : '';
  if (provider === '' || model === '') return null;
  const effort = typeof source.reasoningEffort === 'string' ? source.reasoningEffort.trim() : '';
  return effort === '' ? { provider, model } : { provider, model, reasoningEffort: effort };
}

/** One channel's per-pull batch size: an integer in 1..20, else the product default. */
export function normalizeBatchSize(raw) {
  const value = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < BATCH_SIZE_MIN || value > BATCH_SIZE_MAX) {
    return DEFAULT_BATCH_SIZE;
  }
  return value;
}

function normalizeChannelSettings(raw) {
  const source = recordOf(raw) ?? {};
  return {
    scheduleEnabled: typeof source.scheduleEnabled === 'boolean' ? source.scheduleEnabled : true,
    scheduleAt: isScheduleAt(source.scheduleAt) ? source.scheduleAt : DEFAULT_SCHEDULE_AT,
    translationEnabled: typeof source.translationEnabled === 'boolean' ? source.translationEnabled : true,
    locale: source.locale === 'en' ? 'en' : 'zh',
    batchSize: normalizeBatchSize(source.batchSize),
  };
}

/** One channel's leaves, with product defaults for a missing or corrupt entry. */
export function channelOf(value, sourceId) {
  const sources = recordOf(value)?.sources;
  return normalizeChannelSettings(recordOf(sources)?.[sourceId]);
}

/**
 * The client's settings shape. `autoFetch` is deliberately absent: the host
 * migrates it, the UI never renders it, and carrying it would invite a second
 * global switch.
 */
export function normalizeValue(value) {
  const source = recordOf(value) ?? {};
  const rawSources = recordOf(source.sources) ?? {};
  const sources = {};
  for (const [sourceId, channel] of Object.entries(rawSources)) {
    sources[sourceId] = normalizeChannelSettings(channel);
  }
  return {
    workspacePath: typeof source.workspacePath === 'string' ? source.workspacePath : '',
    retentionDays: Number.isFinite(source.retentionDays) ? source.retentionDays : RETENTION_DEFAULT,
    model: normalizeModelChoice(source.model),
    sources,
  };
}

/**
 * Exactly one `set` op, with a copied path. The host accepts nested paths, and
 * the copy keeps the caller's descriptor array out of the wire payload.
 */
export function setOperation(path, value) {
  return { op: 'set', path: [...path], value };
}

function revisionOf(view) {
  return Number.isInteger(view?.revision) ? view.revision : 0;
}

function missingNamespace() {
  const error = new Error(`settings.describe: namespace ${SETTINGS_NS} is not registered`);
  error.code = 'settings/missing';
  return error;
}

/**
 * Normalize the wire describe view to `{ writable, revision, value }`. A
 * namespace that is absent is an error, never a set of default controls.
 */
export function createSettingsApi(remote) {
  return {
    async describe() {
      const view = unwrap(await remote.describe(), 'settings.describe');
      const namespace = (view?.namespaces ?? []).find(row => row?.ns === SETTINGS_NS);
      if (!namespace) throw missingNamespace();
      return {
        writable: view?.writable === true,
        revision: revisionOf(namespace),
        value: normalizeValue(namespace.value),
      };
    },

    async mutate(ops, revision) {
      const view = unwrap(await remote.mutate(SETTINGS_NS, ops, revision), 'settings.mutate');
      return { revision: revisionOf(view), value: normalizeValue(view?.value) };
    },
  };
}
