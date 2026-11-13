/**
 * Pure decisions behind the settings surface: pane routes, write intents, the
 * model row summary, and the two-pane picker. Rendering and I/O stay in
 * `settings.mjs`, so every rule here is testable without a DOM.
 */

import {
  BATCH_SIZE_MAX,
  BATCH_SIZE_MIN,
  channelOf,
  isScheduleAt,
} from './settings-api.mjs';
import { channelName, dayKeyOf, formatDateTitle, shiftDayKey } from './view-model.mjs';

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * A channel pane survives a catalog reload only while that source is still
 * registered. `null` means the catalog has not loaded yet, so keep the pane.
 */
export function resolvePane(pane, channelIds) {
  if (pane === 'general' || !Array.isArray(channelIds)) return pane;
  return channelIds.includes(pane) ? pane : 'general';
}

export function paneTitle(pane, channels, t) {
  if (pane === 'general') return t('settings.nav');
  const channel = (channels ?? []).find(entry => entry?.id === pane);
  return channel ? channelName(channel, t) : pane;
}

/**
 * The channel subline in the settings nav. A manual channel has no schedule to
 * name, so it says how it runs instead of whether its switch is on.
 */
export function channelSubline(settings, t, channel) {
  if (channel?.cadence === 'manual') return t('settings.nav.manual');
  if (!settings.scheduleEnabled) return t('settings.nav.scheduleOff');
  return t('settings.nav.scheduleOn', { at: settings.scheduleAt });
}

/** Flat nav: 通用设置 first, then every registered source in catalog order. */
export function navItems(pane, channels, value, t) {
  return [
    { key: 'general', label: t('settings.nav'), sub: '', active: pane === 'general' },
    ...(channels ?? []).map((channel) => {
      const settings = channelOf(value, channel.id);
      return {
        key: channel.id,
        label: channelName(channel, t),
        sub: channelSubline(settings, t, channel),
        active: pane === channel.id,
      };
    }),
  ];
}

export function channelIntent(sourceId, field, value) {
  return { path: ['sources', sourceId, field], value };
}

/** The language-edition row writes the channel's `locale` leaf (`zh` or `en`). */
export function localeIntent(sourceId, locale) {
  return channelIntent(sourceId, 'locale', locale === 'en' ? 'en' : 'zh');
}

/**
 * What a time edit should do. A channel that publishes at a fixed hour declares
 * `minScheduleAt`; an earlier time is refused before any write, so the input can
 * snap back to the saved value and show the one-line hint.
 */
export function scheduleAtOutcome(raw, saved, minScheduleAt) {
  if (!isScheduleAt(raw)) return { kind: 'invalid' };
  if (raw === saved) return { kind: 'same' };
  if (isScheduleAt(minScheduleAt) && raw < minScheduleAt) return { kind: 'tooEarly' };
  return { kind: 'write', value: raw };
}

/**
 * What a batch-size edit should do. The picker only offers 1..20, but a value
 * arriving from anywhere else is clamped before the write instead of repeating
 * the host's schema error in the pane.
 */
export function batchSizeOutcome(raw, saved) {
  const value = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return { kind: 'invalid' };
  const next = Math.min(BATCH_SIZE_MAX, Math.max(BATCH_SIZE_MIN, Math.round(value)));
  if (next === saved) return { kind: 'same' };
  return { kind: 'write', value: next };
}

/** The follow row: one op writing `null`, the config truth for "follow the DSH default". */
export function followModelIntent() {
  return { path: ['model'], value: null };
}

/**
 * A model pick: one op with provider and model and no effort, so the new model
 * falls back to its own default effort instead of inheriting the old one.
 */
export function selectModelIntent(provider, model) {
  return { path: ['model'], value: { provider, model } };
}

/** An effort pick: one op pinning the current provider and model to the chosen effort. */
export function selectEffortIntent(selection, effortId) {
  return {
    path: ['model'],
    value: { provider: selection.provider, model: selection.model, reasoningEffort: effortId },
  };
}

/**
 * The write an effort pick produces, or `null` when that effort is already in
 * effect. The synthetic `Default` row carries no effort id, so it writes the
 * provider and model only and lets the Host resolve its own default.
 */
export function effortPickIntent(selection, entry, effortId) {
  if (!selection) return null;
  const wanted = typeof effortId === 'string' && effortId !== '' ? effortId : null;
  const current = effectiveEffort(selection, entry) || null;
  if (current === wanted) return null;
  return wanted === null
    ? selectModelIntent(selection.provider, selection.model)
    : selectEffortIntent(selection, wanted);
}

/** Shortening retention needs a confirmation; lengthening writes immediately. */
export function retentionChange(current, next) {
  if (!Number.isFinite(next) || next === current) return null;
  return next < current ? { kind: 'confirm', next } : { kind: 'write', next };
}

/**
 * `缺译 N` while work remains, `全部已翻译` at zero, and never a done count:
 * already-Chinese and empty descriptions are excluded from `missing`.
 */
export function translationProgress(enabled, missing, t) {
  if (!enabled) return t('settings.channel.translationOff');
  const count = Number.isFinite(missing) ? Math.max(0, Math.round(missing)) : 0;
  return count > 0 ? t('settings.channel.missing', { n: count }) : t('settings.channel.translationDone');
}

/** The bare date phrase after `下次：`, or the empty-value dash. */
export function formatNextFetch(value, now, t) {
  const date = new Date(value);
  if (typeof value !== 'string' || value === '' || Number.isNaN(date.getTime())) return t('time.none');
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const today = dayKeyOf(now);
  const day = dayKeyOf(date);
  if (day === today) return t('settings.channel.nextToday', { time: clock });
  if (day === shiftDayKey(today, 1)) return t('settings.channel.nextTomorrow', { time: clock });
  return t('settings.channel.nextOn', { date: formatDateTitle(day, t), time: clock });
}

export function effortKey(provider, model) {
  return `${provider}\u0000${model}`;
}

/** A catalog entry's display name, falling back to its id. */
function displayName(entry) {
  return entry && typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry?.id ?? '';
}

function usableChoice(choice) {
  return choice
    && typeof choice.provider === 'string' && choice.provider !== ''
    && typeof choice.model === 'string' && choice.model !== ''
    ? choice
    : null;
}

/**
 * The selection in effect: the saved explicit choice, else the default the host
 * resolved. `null` means the picker cannot name a model at all.
 */
export function currentSelection(model, catalog) {
  return usableChoice(model) ?? usableChoice(catalog?.selected);
}

function effortEntry(efforts, choice) {
  return choice ? efforts?.[effortKey(choice.provider, choice.model)] ?? null : null;
}

/** The effort id in effect: the saved effort, else the model's own default effort. */
export function effectiveEffort(choice, entry) {
  if (!choice) return '';
  if (typeof choice.reasoningEffort === 'string' && choice.reasoningEffort !== '') {
    return choice.reasoningEffort;
  }
  return entry?.status === 'ready' && typeof entry.defaultEffort === 'string' ? entry.defaultEffort : '';
}

/** The effort's catalog name, falling back to the raw id; `''` when none is in effect. */
export function effortName(choice, efforts) {
  const entry = effortEntry(efforts, choice);
  const id = effectiveEffort(choice, entry);
  if (id === '') return '';
  if (entry?.status === 'ready') {
    const match = (entry.efforts ?? []).find(item => item?.id === id);
    if (match) return displayName(match);
  }
  return id;
}

/**
 * The effort label the picker shows. A model that reports efforts but no
 * default starts on the synthetic `Default` row, so its label is `Default`
 * instead of an empty effort line. The root cell and the settings summary both
 * call this, so the row and the picker cannot disagree.
 */
export function effortLabel(choice, efforts, t) {
  const name = effortName(choice, efforts);
  if (name !== '') return name;
  const entry = effortEntry(efforts, choice);
  if (entry?.status !== 'ready') return '';
  const hasEfforts = Array.isArray(entry.efforts) && entry.efforts.length > 0;
  const hasDefault = typeof entry.defaultEffort === 'string' && entry.defaultEffort !== '';
  return hasEfforts && !hasDefault ? t('model.providerDefault') : '';
}

function catalogModel(catalog, choice) {
  const list = catalog?.models?.[choice.provider];
  return Array.isArray(list) ? list.find(entry => entry?.id === choice.model) : undefined;
}

function modelName(choice, catalog) {
  const entry = catalogModel(catalog, choice);
  return entry && typeof entry.name === 'string' && entry.name !== '' ? entry.name : choice.model;
}

function providerName(choice, catalog) {
  const entry = (catalog?.providers ?? []).find(item => item?.id === choice.provider);
  return entry && typeof entry.name === 'string' && entry.name !== '' ? entry.name : choice.provider;
}

/**
 * The two lines of the model row. `model === null` is the config truth for
 * "follows the default"; `models().following` is only a catalog hint and is not
 * used here, so an explicit choice is never relabelled as the default. While the
 * row follows, the badge replaces the model name on the first line and the
 * resolved model plus its effort read as the second.
 */
export function modelSummary(model, models, efforts, t) {
  const following = model === null || model === undefined;
  const badge = following ? t('settings.model.following') : '';
  const catalog = models?.value ?? null;
  const status = models?.status ?? 'loading';

  if (status !== 'ready' || !catalog) {
    if (status === 'error') {
      return following
        ? {
          badge,
          primary: t('settings.model.unavailable'),
          secondary: t('settings.model.unknown'),
          note: t('settings.model.catalogError'),
          unavailable: true,
        }
        : {
          badge,
          primary: model.model,
          secondary: model.provider,
          note: t('settings.model.catalogError'),
          unavailable: false,
        };
    }
    return following
      ? { badge, primary: '', secondary: t('settings.model.loading'), note: '', unavailable: false }
      : { badge, primary: model.model, secondary: t('settings.model.loading'), note: '', unavailable: false };
  }

  const effective = currentSelection(model, catalog);
  if (!effective) {
    return {
      badge,
      primary: t('settings.model.unavailable'),
      secondary: t('settings.model.unknown'),
      note: catalog.error ? t('settings.model.catalogError') : '',
      unavailable: true,
    };
  }
  const name = modelName(effective, catalog);
  const effort = effortLabel(effective, efforts, t);
  const effortLine = effort ? t('settings.model.effort', { name: effort }) : '';
  return {
    badge,
    primary: following ? '' : name,
    secondary: (following ? [name] : [providerName(effective, catalog)])
      .concat(effortLine ? [effortLine] : [])
      .join(' · '),
    note: catalog.error ? t('settings.model.catalogError') : '',
    unavailable: false,
  };
}

/** Provider ids the picker lists first, in this order. */
const PROVIDER_PRIORITY = ['deepseek-account', 'deepseek-official'];

/** Providers in display order: the account and official providers first, then catalog order. */
export function orderProviders(providers) {
  const rank = (provider) => {
    const index = PROVIDER_PRIORITY.indexOf(provider?.id);
    return index === -1 ? PROVIDER_PRIORITY.length : index;
  };
  return [...(providers ?? [])].sort((left, right) => rank(left) - rank(right));
}

/** Every model row grouped by provider, filtered by `query`; unmatched groups disappear. */
export function modelGroups(catalog, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const models = catalog?.models ?? {};
  const groups = [];
  for (const provider of orderProviders(catalog?.providers)) {
    if (!provider || typeof provider.id !== 'string' || provider.id === '') continue;
    const rows = (Array.isArray(models[provider.id]) ? models[provider.id] : [])
      .filter(entry => entry && typeof entry.id === 'string' && entry.id !== '')
      .map(entry => ({ id: entry.id, name: displayName(entry) }))
      .filter(row => needle === '' || row.name.toLowerCase().includes(needle));
    if (rows.length === 0 && needle !== '') continue;
    groups.push({ id: provider.id, name: displayName(provider), models: rows });
  }
  return groups;
}

/**
 * Two-pane picker state: which pane is open, the saved choice (`null` follows
 * the default), and the model search query.
 */
export function initialPicker(current) {
  return { pane: 'root', current: current ?? null, query: '' };
}

/**
 * Picker transitions. Choosing a model or an effort writes settings and closes
 * the card, so selection never becomes picker state: the reducer only navigates
 * panes, edits the query, and tracks the one highlighted model row. `back`
 * remembers which cell drilled in so the root pane can take focus there.
 */
export function pickerReducer(state, action) {
  switch (action.type) {
    case 'open':
      return initialPicker(action.current ?? null);
    case 'close':
      return null;
    case 'pane':
      return state
        ? { ...state, pane: action.pane, query: '', highlight: null, focusCell: null }
        : state;
    case 'query':
      return state ? { ...state, query: action.query } : state;
    case 'highlight': {
      const key = action.key ?? null;
      return state && (state.highlight ?? null) !== key ? { ...state, highlight: key } : state;
    }
    case 'move': {
      if (!state) return state;
      const order = Array.isArray(action.order) ? action.order : [];
      if (order.length === 0 || action.delta === 0) return state;
      const step = action.delta > 0 ? 1 : -1;
      // A key outside the current rows (none highlighted, or a stale one after
      // filtering) enters at the end the step comes from: first forward, last
      // backward. Everything else steps one row and wraps across groups.
      const from = order.indexOf(action.activeKey);
      const start = from === -1 ? (step > 0 ? -1 : 0) : from;
      return { ...state, highlight: order[(start + step + order.length) % order.length] };
    }
    case 'back': {
      if (!state || state.pane === 'root') return state;
      return { ...state, pane: 'root', query: '', highlight: null, focusCell: state.pane };
    }
    case 'focus-handled':
      return state?.focusCell ? { ...state, focusCell: null } : state;
    default:
      return state;
  }
}

function paneStatus(phase, text, retry = false) {
  return { phase, text, retry };
}

/** The one state the model pane is in: a state machine, not four booleans. */
function modelPaneStatus(status, message, groups, total, searched, t) {
  if (status === 'loading') return paneStatus('loading', t('model.loadingList'));
  if (status === 'error') return paneStatus('error', message || t('model.error'), true);
  if (groups.length === 0 && total === 0) return paneStatus('empty', t('model.emptyAll'));
  if (groups.length === 0 && searched) return paneStatus('no-match', t('model.searchEmpty'));
  return paneStatus('ready', '');
}

function countModels(catalog) {
  return (catalog?.providers ?? []).reduce((total, provider) => {
    const list = Array.isArray(catalog?.models?.[provider?.id]) ? catalog.models[provider.id] : [];
    return total + list.length;
  }, 0);
}

/**
 * The provider groups the model pane lists. A provider whose catalog load failed
 * has no models left, so that group carries the load warning instead of rows.
 */
function pickerGroups(catalog, query, t) {
  return modelGroups(catalog, query)
    .map(group => ({
      ...group,
      warning: group.models.length === 0 && catalog?.error
        ? t('model.groupFailed', { name: group.name, message: catalog.error })
        : '',
    }))
    .filter(group => group.models.length > 0 || group.warning !== '');
}

/**
 * The catalog load's reply guard. A load captures the newest request id; a
 * reply carrying an older id is dropped before it can write state. The effort
 * loads keep their own ids, so the two never invalidate each other.
 */
export function catalogLoading(previous, requestId) {
  if (previous?.status === 'ready') return { ...previous, requestId };
  return { status: 'loading', requestId };
}

export function catalogReady(current, requestId, value) {
  if (current?.requestId !== requestId) return current;
  return { status: 'ready', requestId, value };
}

export function catalogFailed(current, requestId, message) {
  if (current?.requestId !== requestId) return current;
  if (current?.status === 'ready') return current;
  return { status: 'error', requestId, message };
}

/**
 * What the picker shows. A pane state is data, not a set of booleans: `phase`
 * names exactly one state, and `text` carries the message that state shows.
 */
export function pickerView(picker, models, efforts, t) {
  if (!picker) return null;
  const status = models?.status ?? 'loading';
  const catalog = status === 'ready' ? models?.value ?? null : null;
  const selection = currentSelection(picker.current, catalog);
  const entry = effortEntry(efforts, selection);
  const effort = effortLabel(selection, efforts, t);
  const effortIds = entry?.status === 'ready' ? entry.efforts ?? [] : [];
  const defaultEffort = entry?.status === 'ready' && typeof entry.defaultEffort === 'string'
    ? entry.defaultEffort
    : '';
  const showEffort = Boolean(selection && entry?.status === 'ready' && (effortIds.length > 0 || defaultEffort !== ''));

  // Search belongs to a model list with more than four rows in total, and to no
  // other pane. A hidden field also stops filtering, so a refresh that shrinks
  // the catalog cannot leave a stale query hiding rows.
  const total = countModels(catalog);
  const showSearch = picker.pane === 'model' && total > 4;
  const query = showSearch ? picker.query : '';
  const groups = catalog ? pickerGroups(catalog, query, t) : [];
  const searched = query.trim() !== '';
  const modelStatus = modelPaneStatus(status, models?.message, groups, total, searched, t);

  // A model that reports efforts without a catalog default starts with the
  // synthetic Default row: it stands for "leave reasoningEffort unset".
  const effective = effectiveEffort(selection, entry);
  const effortRows = entry?.status === 'ready'
    ? [
      ...(defaultEffort === '' && effortIds.length > 0
        ? [{
          key: 'provider-default',
          effort: null,
          label: t('model.providerDefault'),
          checked: effective === '',
        }]
        : []),
      ...effortIds.map(item => ({
        key: `effort:${item.id}`,
        effort: item.id,
        label: displayName(item),
        checked: item.id === effective,
      })),
    ]
    : [];
  const effortStatus = entry?.status === 'error'
    ? paneStatus('error', entry.error || t('model.error'), true)
    : !entry || entry.status === 'loading'
      ? paneStatus('loading', t('model.loading'))
      : effortRows.length === 0
        ? paneStatus('empty', t('model.effortsEmpty'))
        : paneStatus('ready', '');

  // The pane's rows in render order: the follow row first, then one block per
  // provider. Blocks are data so "follow comes first" is not a renderer detail.
  const rows = catalog === null ? [] : [
    {
      kind: 'follow',
      key: 'follow',
      label: t('model.follow'),
      hint: selection
        ? t('model.followHint', { provider: providerName(selection, catalog), model: modelName(selection, catalog) })
        : '',
      checked: picker.current === null,
      warning: '',
      models: [],
    },
    ...groups.map(group => ({
      kind: 'group',
      key: group.id,
      label: group.name,
      hint: '',
      checked: false,
      warning: group.warning,
      models: group.models.map(model => ({
        key: `${group.id}\u0000${model.id}`,
        id: model.id,
        name: model.name,
        checked: selection !== null && selection.provider === group.id && selection.model === model.id,
      })),
    })),
  ];

  // Exactly one highlighted model row. An explicit highlight wins while its key
  // is still visible; otherwise the checked row, else the first row. A stale key
  // after filtering falls back the same way instead of leaving no row active.
  const keys = rows.flatMap(row => (row.kind === 'follow'
    ? [row.key]
    : row.models.map(model => model.key)));
  const checkedKey = rows.flatMap(row => (row.kind === 'follow'
    ? [{ key: row.key, checked: row.checked }]
    : row.models.map(model => ({ key: model.key, checked: model.checked }))))
    .find(row => row.checked)?.key ?? null;
  const activeKey = picker.highlight && keys.includes(picker.highlight)
    ? picker.highlight
    : checkedKey ?? keys[0] ?? null;

  return {
    pane: picker.pane,
    query,
    showSearch,
    focusCell: picker.focusCell ?? null,
    title: t('model.title'),
    searchPlaceholder: t('model.search'),
    searchClear: t('model.searchClear'),
    model: {
      label: t('settings.model'),
      value: selection
        ? modelName(selection, catalog)
        : status === 'loading' ? t('settings.model.loading') : t('settings.model.unavailable'),
      rows,
      keys,
      activeKey,
      status: modelStatus,
      retryLabel: t('model.retry'),
    },
    effort: {
      label: t('model.effort'),
      value: effort,
      show: showEffort,
      rows: effortRows,
      status: effortStatus,
      retryLabel: t('model.reload'),
    },
  };
}

/**
 * Where the portaled card sits: right-aligned to the trigger, below it when it
 * fits, above it when the trigger sits near the bottom, clamped to the viewport.
 */
export function popoverPosition(anchor, size, viewport) {
  const margin = 12;
  const gap = 8;
  const maxHeight = Math.min(360, Math.max(0, viewport.height - margin * 2));
  const height = Math.min(size.height, maxHeight);
  const fitsBelow = anchor.bottom + gap + height <= viewport.height - margin;
  const fitsAbove = anchor.top - gap - height >= margin;
  const top = fitsBelow || !fitsAbove
    ? Math.max(margin, Math.min(anchor.bottom + gap, viewport.height - margin - height))
    : anchor.top - gap - height;
  // The card is content-width (240..420), so its minimum width is what the left
  // edge protects; anchoring the right edge keeps it beside a right-hand trigger.
  const right = Math.max(margin, Math.min(viewport.width - anchor.right, viewport.width - margin - 240));
  return { top, right, maxHeight };
}
