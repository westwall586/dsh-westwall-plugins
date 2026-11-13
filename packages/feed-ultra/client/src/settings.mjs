/**
 * The settings surface: the shared nav, the 通用设置 and channel panes, and the
 * two-pane model picker. It calls only the settings facade, the workspace
 * picker, and the ports the panel hands it; it never knows the feedUltra RPC.
 */

import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ChevronLeftIcon } from './icons.mjs';
import {
  BATCH_SIZE_MAX,
  BATCH_SIZE_MIN,
  channelOf,
  isScheduleAt,
  setOperation,
} from './settings-api.mjs';
import {
  batchSizeOutcome,
  catalogFailed,
  catalogLoading,
  catalogReady,
  channelIntent,
  currentSelection,
  effortKey,
  effortPickIntent,
  followModelIntent,
  formatNextFetch,
  localeIntent,
  modelSummary,
  navItems,
  paneTitle,
  pickerReducer,
  pickerView,
  popoverPosition,
  resolvePane,
  retentionChange,
  scheduleAtOutcome,
  selectModelIntent,
  translationProgress,
} from './settings-model.mjs';
import { channelName, channelStatusLine } from './view-model.mjs';
import { RssPane } from './rss-settings.mjs';

const h = createElement;
const RETENTION_OPTIONS = [7, 14, 30, 60, 90, 180, 365];
const NOTICE_MS = 1800;

const initialState = {
  phase: 'loading',
  error: '',
  writable: false,
  revision: 0,
  value: null,
  saving: false,
  saveError: '',
  conflict: '',
  confirm: null,
  notice: '',
  channels: null,
  models: null,
  efforts: {},
  picker: null,
};

function messageOf(error, text) {
  return error && typeof error.message === 'string' && error.message
    ? error.message
    : text('error.unknown');
}

function settingsReducer(state, action) {
  switch (action.type) {
    case 'loading':
      return {
        ...state,
        phase: 'loading',
        error: '',
        saveError: '',
        conflict: '',
        confirm: null,
        picker: null,
      };
    case 'ready':
      return {
        ...state,
        phase: 'ready',
        writable: action.writable,
        revision: action.revision,
        value: action.value,
        error: '',
      };
    case 'error':
      return {
        ...state,
        phase: 'error',
        error: action.error,
        saving: false,
        confirm: null,
        picker: null,
      };
    case 'write-start':
      return { ...state, saving: true, saveError: '', conflict: '', confirm: null, picker: null };
    case 'write-cancel':
      return { ...state, saving: false };
    case 'write-ok':
      return {
        ...state,
        saving: false,
        writable: action.writable ?? state.writable,
        revision: action.revision,
        value: action.value,
        saveError: '',
        conflict: '',
      };
    case 'write-fail':
      return { ...state, saving: false, saveError: action.message };
    case 'conflict':
      return {
        ...state,
        saving: false,
        writable: action.writable,
        revision: action.revision,
        value: action.value,
        saveError: '',
        conflict: action.message,
      };
    case 'refresh':
      return {
        ...state,
        writable: action.writable ?? state.writable,
        revision: action.revision,
        value: action.value,
      };
    case 'confirm':
      return { ...state, confirm: action.confirm };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'channels-start':
      return {
        ...state,
        channels: state.channels?.status === 'ready' ? state.channels : { status: 'loading' },
      };
    case 'channels-ok':
      return { ...state, channels: { status: 'ready', value: action.value } };
    case 'channels-fail':
      return {
        ...state,
        channels: state.channels?.status === 'ready'
          ? state.channels
          : { status: 'error', message: action.message },
      };
    case 'models-start':
      return { ...state, models: catalogLoading(state.models, action.requestId) };
    case 'models-ok': {
      const models = catalogReady(state.models, action.requestId, action.value);
      return models === state.models ? state : { ...state, models };
    }
    case 'models-fail': {
      const models = catalogFailed(state.models, action.requestId, action.message);
      return models === state.models ? state : { ...state, models };
    }
    case 'efforts-start':
      return {
        ...state,
        efforts: {
          ...state.efforts,
          [action.key]: {
            requestId: action.requestId,
            status: 'loading',
            efforts: [],
            defaultEffort: '',
            error: '',
          },
        },
      };
    case 'efforts-ok': {
      const entry = state.efforts[action.key];
      if (entry && entry.requestId !== action.requestId) return state;
      return {
        ...state,
        efforts: {
          ...state.efforts,
          [action.key]: {
            requestId: action.requestId,
            status: 'ready',
            efforts: Array.isArray(action.result?.efforts) ? action.result.efforts : [],
            defaultEffort: typeof action.result?.default === 'string' ? action.result.default : '',
            error: typeof action.result?.error === 'string' ? action.result.error : '',
          },
        },
      };
    }
    case 'efforts-fail': {
      const entry = state.efforts[action.key];
      if (entry && entry.requestId !== action.requestId) return state;
      return {
        ...state,
        efforts: {
          ...state.efforts,
          [action.key]: {
            requestId: action.requestId,
            status: 'error',
            efforts: [],
            defaultEffort: '',
            error: action.message,
          },
        },
      };
    }
    case 'picker':
      return { ...state, picker: pickerReducer(state.picker, action.event) };
    default:
      return state;
  }
}

function retentionOptions(current) {
  const values = new Set(RETENTION_OPTIONS);
  if (Number.isFinite(current)) values.add(current);
  return [...values].sort((left, right) => left - right);
}

function batchSizeOptions() {
  return Array.from({ length: BATCH_SIZE_MAX - BATCH_SIZE_MIN + 1 }, (_, index) => BATCH_SIZE_MIN + index);
}

function SettingRow({ label, hint, children }) {
  return h('div', { className: 'dl-set-row' },
    h('div', { className: 'dl-set-label-block' },
      h('span', { className: 'dl-set-label' }, label),
      hint ? h('span', { className: 'dl-set-hint' }, hint) : null,
    ),
    h('div', { className: 'dl-set-value' }, children),
  );
}

function SettingsState({ title, sub, action }) {
  return h('div', { className: 'dl-state' },
    h('h3', { className: 'dl-state-title' }, title),
    sub ? h('p', { className: 'dl-state-sub' }, sub) : null,
    action ? h('div', { className: 'dl-state-actions' }, action) : null,
  );
}

function SettingsNav({ items, onSelect, onBackToday, text }) {
  return h('aside', { className: 'dl-rail' },
    h('div', { className: 'dl-rail-brand' },
      h('span', { className: 'dl-brand-mark', 'aria-hidden': true }),
      h('span', { className: 'dl-brand-name' }, text('entry')),
    ),
    h('div', { className: 'dl-rail-scroll' },
      h('div', { className: 'dl-set-nav' },
        ...items.map(item => h('button', {
          key: item.key,
          type: 'button',
          className: 'dl-set-nav-item',
          'aria-current': item.active ? 'page' : undefined,
          onClick: () => onSelect(item.key),
        },
          h('span', { className: 'dl-set-nav-label' }, item.label),
          item.sub ? h('span', { className: 'dl-set-nav-sub' }, item.sub) : null,
        )),
      ),
    ),
    h('div', { className: 'dl-rail-foot' },
      h('button', {
        type: 'button',
        className: 'dl-rail-link',
        onClick: onBackToday,
      },
        h(ChevronLeftIcon, { size: 12 }),
        text('rail.backToday'),
      ),
    ),
  );
}

function SettingsTabs({ items, onSelect, onBackToday, text }) {
  return h('div', { className: 'dl-set-tabs', role: 'tablist' },
    ...items.map(item => h('button', {
      key: item.key,
      type: 'button',
      role: 'tab',
      className: 'dl-set-tab',
      'aria-selected': item.active,
      onClick: () => onSelect(item.key),
    }, item.label)),
    h('span', { className: 'dl-spacer' }),
    h('button', {
      type: 'button',
      className: 'dl-set-tab dl-set-tab--back',
      onClick: onBackToday,
    }, h(ChevronLeftIcon, { size: 12 }), text('rail.backToday')),
  );
}

function ModelRow({ summary, locked, onOpen, text }) {
  return h('div', { className: 'dl-set-model' },
    h('span', { className: 'dl-set-model-text' },
      h('span', { className: 'dl-set-model-line' },
        summary.badge ? h('span', { className: 'dl-set-badge' }, summary.badge) : null,
        h('span', {
          className: `dl-set-model-name${summary.unavailable ? ' is-muted' : ''}`,
        }, summary.primary),
      ),
      summary.secondary ? h('span', { className: 'dl-set-model-sub' }, summary.secondary) : null,
      summary.note ? h('span', { className: 'dl-set-model-note' }, summary.note) : null,
    ),
    h('button', {
      type: 'button',
      className: 'dl-btn',
      disabled: locked,
      onClick: event => onOpen(event.currentTarget),
    }, text('settings.model.change')),
  );
}

function GeneralPane({ value, workspace, models, efforts, locked, actions, text }) {
  const workspaceStatus = workspace?.status ?? 'unbound';
  const bound = workspaceStatus === 'ok';
  const workspacePath = bound ? (workspace?.path || value.workspacePath) : '';
  const workspaceLabel = bound
    ? (workspacePath || text('time.none'))
    : workspaceStatus === 'invalid'
      ? text('settings.workspace.invalid')
      : text('settings.workspace.unbound');
  const workspaceAction = bound
    ? text('settings.workspace.change')
    : text('settings.workspace.pick');
  const summary = modelSummary(value.model, models, efforts, text);

  return h('div', null,
    h('div', { className: 'dl-set-panel', 'aria-busy': locked ? 'true' : undefined },
      h(SettingRow, { label: text('settings.workspace') },
        h('span', {
          className: `dl-set-path${bound ? '' : ' is-muted'}`,
          title: bound ? workspacePath : workspaceLabel,
        }, workspaceLabel),
        h('button', {
          type: 'button',
          className: 'dl-btn',
          disabled: locked,
          onClick: actions.changeWorkspace,
        }, workspaceAction),
      ),
      h(SettingRow, { label: text('settings.retention'), hint: text('settings.retention.hint') },
        h('select', {
          className: 'dl-select',
          value: String(value.retentionDays),
          'aria-label': text('settings.retention'),
          disabled: locked,
          onChange: actions.changeRetention,
        }, ...retentionOptions(value.retentionDays).map(days => h('option', {
          key: days,
          value: String(days),
        }, text('settings.retentionOption', { days })))),
      ),
      h(SettingRow, { label: text('settings.model'), hint: text('settings.model.hint') },
        h(ModelRow, {
          summary,
          locked,
          onOpen: actions.openPicker,
          text,
        }),
      ),
    ),
    h('p', { className: 'dl-set-note' }, text('settings.model.privacy')),
  );
}

function ChannelPane({ sourceId, value, status, now, locked, actions, text }) {
  const channel = channelOf(value, sourceId);
  const name = channelName(status ?? { id: sourceId }, text);
  const manual = status?.cadence === 'manual';
  const daily = !manual;
  const capabilities = status?.capabilities ?? null;
  const canTranslate = !capabilities || capabilities.translation !== false;
  const locales = Array.isArray(capabilities?.locales)
    ? capabilities.locales.filter(locale => locale === 'zh' || locale === 'en')
    : [];
  const localeOptions = ['zh', 'en'].filter(locale => locales.includes(locale));
  const showLocale = localeOptions.length > 0;
  const minScheduleAt = typeof capabilities?.minScheduleAt === 'string'
    && isScheduleAt(capabilities.minScheduleAt)
    ? capabilities.minScheduleAt
    : '';
  const missing = Number(status?.translation?.missing) || 0;
  const progress = status
    ? translationProgress(channel.translationEnabled, missing, text)
    : channel.translationEnabled ? '' : text('settings.channel.translationOff');
  const statusLine = status ? channelStatusLine(status, now, text) : null;
  const nextLabel = channel.scheduleEnabled
    ? text('settings.channel.next', { when: formatNextFetch(status?.nextFetchAt ?? null, now, text) })
    : text('settings.channel.nextOff');
  // The design puts the runtime note on the schedule row, not in a paragraph
  // below the pane. GitHub keeps its iteration-two footnote; BestBlogs does not.
  const scheduleHint = canTranslate ? nextLabel : `${nextLabel} · ${text('settings.channel.runtimeOff')}`;
  const dotClassFor = tone => (tone === 'ok' ? 'dl-dot--ok' : tone === 'error' ? 'dl-dot--warn' : 'dl-dot--idle');
  // The input stays controlled by the saved time. A refused edit bumps this
  // counter, which re-renders the saved value back into the field and shows the
  // floor hint; a successful write clears it.
  const [earlyReject, setEarlyReject] = useState(0);

  const commitTime = (raw) => {
    const outcome = actions.changeScheduleAt(sourceId, raw);
    if (outcome === 'tooEarly') setEarlyReject(count => count + 1);
    else if (outcome === 'write') setEarlyReject(0);
  };

  return h('div', null,
    h('div', { className: 'dl-set-panel', 'aria-busy': locked ? 'true' : undefined },
      h('div', { className: 'dl-set-pane-head' },
        h('span', { className: 'dl-set-pane-title' }, name),
        channel.scheduleEnabled && daily
          ? h('span', { className: 'dl-set-pill' }, text('settings.channel.pill', { at: channel.scheduleAt }))
          : null,
        manual ? h('span', { className: 'dl-set-pill' }, text('settings.nav.manual')) : null,
        statusLine
          ? h('span', { className: `dl-set-status is-${statusLine.tone}` },
            h('span', { className: `dl-status-dot ${dotClassFor(statusLine.tone)}` }),
            statusLine.text,
          )
          : null,
      ),
      showLocale
        ? h(SettingRow, {
          label: text('settings.bestblogs.locale'),
          hint: text('settings.bestblogs.localeHint'),
        },
          h('select', {
            className: 'dl-select',
            value: channel.locale,
            'aria-label': text('settings.bestblogs.locale'),
            disabled: locked,
            onChange: event => actions.changeLocale(sourceId, event.target.value),
          }, ...localeOptions.map(locale => h('option', {
            key: locale,
            value: locale,
          }, text(`settings.bestblogs.locale.${locale}`)))),
        )
        : null,
      daily
        ? h(SettingRow, { label: text('settings.channel.schedule'), hint: scheduleHint },
          h('button', {
            type: 'button',
            className: 'dl-switch',
            role: 'switch',
            'aria-checked': channel.scheduleEnabled,
            'aria-label': text('settings.channel.scheduleLabel', { name }),
            disabled: locked,
            onClick: () => actions.toggle(sourceId, 'scheduleEnabled', !channel.scheduleEnabled),
          }, h('i', { 'aria-hidden': true })),
        )
        : null,
      daily
        ? h(SettingRow, {
          label: text('settings.channel.at'),
          hint: minScheduleAt
            ? text('settings.bestblogs.atHint', { min: minScheduleAt })
            : text('settings.channel.atHint'),
        },
          h('div', { className: 'dl-set-field' },
            h('input', {
              type: 'time',
              className: 'dl-set-time',
              step: 300,
              min: minScheduleAt || undefined,
              value: channel.scheduleAt,
              'aria-label': text('settings.channel.atLabel', { name }),
              disabled: locked,
              onChange: event => commitTime(event.target.value),
            }),
            earlyReject > 0 ? h('span', { className: 'dl-set-field-hint' }, text('settings.bestblogs.earlyTime')) : null,
          ),
        )
        : null,
      manual
        ? h(SettingRow, { label: text('settings.x.batch'), hint: text('settings.x.batchHint') },
          h('select', {
            className: 'dl-select',
            value: String(channel.batchSize),
            'aria-label': text('settings.x.batch'),
            disabled: locked,
            onChange: event => actions.changeBatchSize(sourceId, event.target.value),
          }, ...batchSizeOptions().map(size => h('option', {
            key: size,
            value: String(size),
          }, text('settings.x.batchOption', { n: size })))),
        )
        : null,
      canTranslate
        ? h(SettingRow, { label: text('settings.channel.translation'), hint: progress },
          h('button', {
            type: 'button',
            className: 'dl-switch',
            role: 'switch',
            'aria-checked': channel.translationEnabled,
            'aria-label': text('settings.channel.translationLabel', { name }),
            disabled: locked,
            onClick: () => actions.toggle(sourceId, 'translationEnabled', !channel.translationEnabled),
          }, h('i', { 'aria-hidden': true })),
        )
        : null,
    ),
    manual
      ? h('p', { className: 'dl-set-note' }, text('settings.x.egoNote'))
      : canTranslate ? h('p', { className: 'dl-set-note' }, text('settings.channel.footnote')) : null,
  );
}

/**
 * `react-dom` is a platform module the client module table seeds, not a bundle
 * dependency: the loader hands the factory a `require`, so the portal is asked
 * for at runtime instead of bundling a second React DOM (two copies cannot
 * render each other's portals). A plain node import gets `null` and renders in
 * place.
 */
let portalRenderer;
function portalOf() {
  if (portalRenderer === undefined) {
    let dom = null;
    try {
      dom = typeof require === 'function' ? require('react-dom') : null;
    } catch {
      dom = null;
    }
    portalRenderer = dom && typeof dom.createPortal === 'function' ? dom.createPortal : null;
  }
  return portalRenderer;
}

function ChevronRightIcon() {
  return h('svg', {
    className: 'dl-picker-cell-chevron',
    viewBox: '0 0 12 12',
    width: 12,
    height: 12,
    'aria-hidden': true,
    focusable: 'false',
  }, h('path', {
    d: 'M4.25 2.5 7.75 6l-3.5 3.5',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }));
}

function CheckIcon() {
  return h('svg', {
    viewBox: '0 0 16 16',
    width: 14,
    height: 14,
    'aria-hidden': true,
    focusable: 'false',
  }, h('path', {
    d: 'M3.5 8.75 6.5 11.75 12.5 4.75',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }));
}

function PickerCheck({ checked }) {
  return h('span', { className: 'dl-picker-check' }, checked ? h(CheckIcon) : null);
}

function effortOption(key, label, checked, onClick, setNode) {
  return h('button', {
    key,
    type: 'button',
    role: 'option',
    'aria-selected': checked,
    ref: setNode,
    className: 'dl-picker-option',
    onClick,
  },
    h('span', { className: 'dl-picker-option-text' }, label),
    h(PickerCheck, { checked }),
  );
}

/**
 * A model-pane row carries no CSS hover. Its highlight is this active class,
 * set by pointer move and focus, so exactly one row is filled at a time and the
 * keyboard position and the pointer position stay the same thing. With the
 * search field showing, rows stay out of the tab order and the input keeps
 * focus, matching the reference.
 */
function modelOption(key, content, checked, active, focusable, onActivate, onClick, setNode) {
  return h('button', {
    key,
    type: 'button',
    role: 'option',
    'aria-selected': checked,
    tabIndex: focusable ? 0 : -1,
    ref: setNode,
    className: `dl-picker-option dl-picker-option--model${active ? ' is-active' : ''}`,
    onPointerMove: onActivate,
    onFocus: onActivate,
    onClick,
  }, ...content, h(PickerCheck, { checked }));
}

/** The row keys a pane walks, in DOM order. */
function rowOrder(frame) {
  if (frame.pane === 'root') return frame.effort.show ? ['cell:model', 'cell:effort'] : ['cell:model'];
  if (frame.pane === 'model') return frame.model.keys;
  return frame.effort.rows.map(row => row.key);
}

/** Enter or Tab in the search field chooses the highlighted model row. */
function pickModelKey(frame, key, actions) {
  for (const row of frame.model.rows) {
    if (row.kind === 'follow' && row.key === key) {
      actions.follow();
      return;
    }
    if (row.kind !== 'group') continue;
    const model = row.models.find(entry => entry.key === key);
    if (model) {
      actions.pickModel(row.key, model.id);
      return;
    }
  }
}

function pickerStatus(status, reloadLabel, onRetry) {
  if (status.phase === 'ready') return null;
  return h('div', {
    className: `dl-picker-status${status.phase === 'error' ? ' is-error' : ''}`,
    role: 'status',
  },
    h('span', { className: 'dl-picker-status-text' }, status.text),
    status.retry
      ? h('button', { type: 'button', className: 'dl-picker-retry', onClick: onRetry }, reloadLabel)
      : null,
  );
}

function ModelPicker({ anchor, scheme, frame, actions }) {
  const cardRef = useRef(null);
  const searchRef = useRef(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const rowRefs = useRef(new Map());
  const [position, setPosition] = useState(null);

  // Rows unmount and remount as panes and filters change, so the map is the
  // stable look-up for focus, arrow walks, and scroll-into-view.
  const registerRow = key => (node) => {
    if (node) rowRefs.current.set(key, node);
    else rowRefs.current.delete(key);
  };

  const dismiss = () => {
    actionsRef.current.close();
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
  };

  const moveRowFocus = (current, step) => {
    const nodes = rowOrder(current)
      .map(key => rowRefs.current.get(key))
      .filter(node => node !== undefined && !node.disabled);
    if (nodes.length === 0) return;
    const active = nodes.indexOf(document.activeElement);
    // Focus outside the rows enters at the end the step comes from: the first
    // row forward, the last row backward.
    const next = active === -1
      ? (step > 0 ? 0 : nodes.length - 1)
      : (active + step + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  // Keys reach the card from the trigger subtree too, because focus starts on
  // the 更换 button and the card is portaled outside it.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.isComposing) return;
      const target = event.target;
      if (!cardRef.current?.contains(target) && !anchor?.contains?.(target)) return;
      const current = frameRef.current;
      const act = actionsRef.current;
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (current.pane !== 'root') act.back();
        else dismiss();
        return;
      }

      const search = searchRef.current;
      const inSearch = search !== null && target === search;

      // With the search field showing, the arrows move only the highlight and
      // focus stays in the input.
      if (current.pane === 'model' && current.showSearch && step !== 0) {
        event.preventDefault();
        if (current.model.keys.length > 0) {
          act.move(step, current.model.keys, current.model.activeKey);
          search?.focus();
        }
        return;
      }

      if (current.pane === 'model' && current.showSearch && inSearch
        && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))) {
        if (event.key === 'Tab' && current.model.keys.length === 0) return;
        event.preventDefault();
        pickModelKey(current, current.model.activeKey, act);
        return;
      }

      // Shift+Tab backs out of a drilled pane and closes from the root. Plain
      // Tab stays native on rows: this is a settings page, not the composer, so
      // consuming it would trap focus in the card.
      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        if (current.pane !== 'root') act.back();
        else dismiss();
        return;
      }

      if (step !== 0) {
        event.preventDefault();
        moveRowFocus(current, step);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [anchor]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !anchor || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const size = card.getBoundingClientRect();
    setPosition(popoverPosition(rect, { height: size.height }, {
      width: window.innerWidth,
      height: window.innerHeight,
    }));
  }, [
    anchor,
    frame.pane,
    frame.query,
    frame.showSearch,
    frame.model.status.phase,
    frame.effort.status.phase,
    frame.model.rows.length,
    frame.effort.rows.length,
  ]);

  useEffect(() => {
    const outside = (event) => {
      const target = event.target;
      if (cardRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      actionsRef.current.close();
    };
    // The settings body scrolls its own container; a scroll anywhere outside the
    // card would move the anchor, so the card closes instead of drifting.
    const scrolled = (event) => {
      if (cardRef.current?.contains(event.target)) return;
      actionsRef.current.close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scrolled, true);
    };
  }, [anchor]);

  // A pane opens on its value in use: the search field when it is shown,
  // otherwise the checked row, otherwise the first row, otherwise the trigger
  // so the card's keys still reach it.
  useEffect(() => {
    if (frame.pane === 'root') return;
    if (frame.pane === 'model' && frame.showSearch) {
      searchRef.current?.focus();
      return;
    }
    const current = frameRef.current;
    const key = current.pane === 'model'
      ? current.model.activeKey
      : current.effort.rows.find(row => row.checked)?.key ?? current.effort.rows[0]?.key ?? null;
    const target = key === null ? null : rowRefs.current.get(key);
    (target ?? anchor)?.focus({ preventScroll: true });
  }, [anchor, frame.pane, frame.showSearch]);

  // The one highlighted model row scrolls into view when it changes, without
  // moving focus out of the search field.
  useLayoutEffect(() => {
    if (frame.pane !== 'model' || frame.model.activeKey === null) return;
    rowRefs.current.get(frame.model.activeKey)?.scrollIntoView({ block: 'nearest' });
  }, [frame.pane, frame.model.activeKey]);

  // Backing out leaves focus on the cell that drilled in. The reducer names the
  // cell, and this effect consumes that intent once the root pane is mounted.
  useLayoutEffect(() => {
    if (frame.pane !== 'root' || frame.focusCell === null) return;
    const key = frame.focusCell === 'effort' ? 'cell:effort' : 'cell:model';
    (rowRefs.current.get(key) ?? anchor)?.focus({ preventScroll: true });
    actionsRef.current.focusHandled();
  }, [anchor, frame.pane, frame.focusCell]);

  useEffect(() => () => {
    // Only reclaim focus the card itself was holding; an outside click moves it
    // somewhere the user chose.
    if (anchor?.isConnected && document.activeElement === document.body) {
      anchor.focus({ preventScroll: true });
    }
  }, [anchor]);

  const activateModel = (key) => {
    if (key !== frameRef.current.model.activeKey) actionsRef.current.highlight(key);
  };

  const rootPane = h('div', { className: 'dl-picker-root' },
    h('button', {
      type: 'button',
      className: 'dl-picker-cell',
      ref: registerRow('cell:model'),
      onClick: () => actions.pane('model'),
    },
      h('span', { className: 'dl-picker-cell-label' }, frame.model.label),
      h('span', { className: 'dl-picker-cell-value' }, frame.model.value),
      h(ChevronRightIcon),
    ),
    frame.effort.show
      ? h('button', {
        type: 'button',
        className: 'dl-picker-cell',
        ref: registerRow('cell:effort'),
        onClick: () => actions.pane('effort'),
      },
        h('span', { className: 'dl-picker-cell-label' }, frame.effort.label),
        h('span', { className: 'dl-picker-cell-value' }, frame.effort.value),
        h(ChevronRightIcon),
      )
      : null,
  );

  const modelPane = [
    ...(frame.showSearch
      ? [h('div', { className: 'dl-picker-search-row', key: 'search' },
        h('input', {
          ref: searchRef,
          type: 'text',
          role: 'searchbox',
          className: `dl-picker-search${frame.query === '' ? '' : ' is-clearable'}`,
          'aria-label': frame.searchPlaceholder,
          placeholder: frame.searchPlaceholder,
          value: frame.query,
          onChange: event => actions.query(event.target.value),
        }),
        frame.query === ''
          ? null
          : h('button', {
            type: 'button',
            className: 'dl-picker-search-clear',
            'aria-label': frame.searchClear,
            onClick: actions.clearQuery,
          }, '×'),
      )]
      : []),
    pickerStatus(frame.model.status, frame.model.retryLabel, actions.retryModels),
    frame.model.rows.length === 0
      ? null
      : h('div', {
        className: 'dl-picker-groups',
        role: 'listbox',
        'aria-label': frame.model.label,
        key: 'rows',
      },
        ...frame.model.rows.map(row => (row.kind === 'follow'
          ? modelOption(
            row.key,
            [
              h('span', { className: 'dl-set-badge' }, row.label),
              h('span', { className: 'dl-picker-option-hint' }, row.hint),
            ],
            row.checked,
            frame.model.activeKey === row.key,
            !frame.showSearch,
            () => activateModel(row.key),
            actions.follow,
            registerRow(row.key),
          )
          : h('div', {
            key: row.key,
            className: 'dl-picker-group',
            role: 'group',
            'aria-label': row.label,
          },
            h('div', { className: 'dl-picker-group-label' }, row.label),
            row.warning
              ? h('div', { className: 'dl-picker-warning', role: 'status' },
                h('span', { className: 'dl-picker-warning-text' }, row.warning),
                h('button', {
                  type: 'button',
                  className: 'dl-picker-retry',
                  onClick: actions.retryModels,
                }, frame.model.retryLabel))
              : null,
            ...row.models.map(model => modelOption(
              model.key,
              [h('span', { className: 'dl-picker-option-text' }, model.name)],
              model.checked,
              frame.model.activeKey === model.key,
              !frame.showSearch,
              () => activateModel(model.key),
              () => actions.pickModel(row.key, model.id),
              registerRow(model.key),
            )),
          ))),
      ),
  ];

  const effortPane = [
    pickerStatus(frame.effort.status, frame.effort.retryLabel, actions.retryEfforts),
    frame.effort.rows.length === 0
      ? null
      : h('div', {
        className: 'dl-picker-groups',
        role: 'listbox',
        'aria-label': frame.effort.label,
        key: 'rows',
      },
        ...frame.effort.rows.map(row => effortOption(
          row.key,
          row.label,
          row.checked,
          () => actions.pickEffort(row.effort),
          registerRow(row.key),
        )),
      ),
  ];

  const card = h('div', {
    ref: cardRef,
    className: 'dl-popover',
    'data-dl-scheme': scheme ?? 'light',
    style: position === null
      ? { visibility: 'hidden', top: '0px', right: '0px' }
      : { top: `${position.top}px`, right: `${position.right}px`, maxHeight: `${position.maxHeight}px` },
    role: 'dialog',
    'aria-label': frame.title,
  },
    frame.pane === 'root' ? rootPane : null,
    frame.pane === 'model' ? modelPane : null,
    frame.pane === 'effort' ? effortPane : null,
  );

  const portal = portalOf();
  return portal ? portal(card, document.body) : card;
}

export function SettingsView({
  text,
  ensureSettings,
  workspace,
  chooseWorkspace,
  pane,
  onSelectPane,
  onBackToday,
  modelPort,
  rssPort,
  loadChannels,
}) {
  const [state, dispatch] = useReducer(settingsReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const apiRef = useRef(null);
  const noticeTimer = useRef(null);
  // Catalog generations are their own counter; effort replies carry the port's
  // request ids, so the two load paths can never invalidate each other.
  const catalogSequence = useRef(0);

  const flash = useCallback((message) => {
    dispatch({ type: 'notice', notice: message });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => dispatch({ type: 'notice', notice: '' }), NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const load = useCallback(async () => {
    dispatch({ type: 'loading' });
    try {
      const api = await ensureSettings();
      if (!api) {
        dispatch({ type: 'error', error: text('settings.unavailable.sub') });
        return;
      }
      apiRef.current = api;
      const view = await api.describe();
      dispatch({ type: 'ready', ...view });
    } catch (error) {
      dispatch({ type: 'error', error: messageOf(error, text) });
    }
  }, [ensureSettings, text]);

  const refreshChannels = useCallback(async () => {
    dispatch({ type: 'channels-start' });
    try {
      dispatch({ type: 'channels-ok', value: await loadChannels() });
    } catch (error) {
      dispatch({ type: 'channels-fail', message: messageOf(error, text) });
    }
  }, [loadChannels, text]);

  // A library mutation renames or deletes a channel, so the nav catalog is refreshed too.
  const rssPortForPane = useMemo(() => {
    if (!rssPort) return rssPort;
    return {
      library: rssPort.library,
      preview: rssPort.preview,
      mutate: async (ops) => {
        const view = await rssPort.mutate(ops);
        void refreshChannels();
        return view;
      },
    };
  }, [refreshChannels, rssPort]);

  const refreshModels = useCallback(async () => {
    if (!modelPort) return;
    const requestId = ++catalogSequence.current;
    dispatch({ type: 'models-start', requestId });
    try {
      const value = await modelPort.models();
      dispatch({ type: 'models-ok', requestId, value });
    } catch (error) {
      dispatch({ type: 'models-fail', requestId, message: messageOf(error, text) });
    }
  }, [modelPort, text]);

  useEffect(() => {
    void load();
    void refreshChannels();
    void refreshModels();
  }, [load, refreshChannels, refreshModels]);

  const write = useCallback(async (intent) => {
    const api = apiRef.current;
    const current = stateRef.current;
    if (!api || !current.value || current.saving || !current.writable) return false;
    dispatch({ type: 'write-start' });
    try {
      const next = await api.mutate([setOperation(intent.path, intent.value)], current.revision);
      dispatch({ type: 'write-ok', value: next.value, revision: next.revision });
      flash(text('settings.saved'));
      if (intent.path[0] === 'sources') void refreshChannels();
      return true;
    } catch (error) {
      if (error?.code === 'settings/conflict') {
        try {
          const fresh = await api.describe();
          dispatch({ type: 'conflict', ...fresh, message: text('settings.conflict') });
        } catch (reloadError) {
          dispatch({ type: 'error', error: messageOf(reloadError, text) });
        }
        return false;
      }
      dispatch({
        type: 'write-fail',
        message: text('settings.saveError', { message: messageOf(error, text) }),
      });
      return false;
    }
  }, [flash, refreshChannels, text]);

  const pickWorkspace = useCallback(async () => {
    const current = stateRef.current;
    if (current.saving || !current.writable) return;
    dispatch({ type: 'write-start' });
    try {
      const status = await chooseWorkspace();
      if (!status) {
        dispatch({ type: 'write-cancel' });
        return;
      }
      const api = apiRef.current;
      if (api) {
        const view = await api.describe();
        dispatch({ type: 'write-ok', ...view });
      }
      void refreshChannels();
      flash(text('settings.saved'));
    } catch (error) {
      dispatch({
        type: 'write-fail',
        message: text('settings.saveError', { message: messageOf(error, text) }),
      });
    }
  }, [chooseWorkspace, flash, refreshChannels, text]);

  const pickerAnchor = useRef(null);
  const pickerScheme = useRef(null);

  const closePicker = useCallback(() => {
    dispatch({ type: 'picker', event: { type: 'close' } });
  }, []);

  /**
   * One effort list per provider/model, at most one request per key. The key's
   * request sequence in state drops a reply that lost a race.
   */
  const resolveEfforts = useCallback((providerId, modelId) => {
    if (!modelPort || !providerId || !modelId) return;
    const key = effortKey(providerId, modelId);
    const request = modelPort.efforts(providerId, modelId);
    dispatch({ type: 'efforts-start', key, requestId: request.requestId });
    void request.done.then((outcome) => {
      if (outcome.error) {
        dispatch({
          type: 'efforts-fail',
          key,
          requestId: request.requestId,
          message: messageOf(outcome.error, text),
        });
        return;
      }
      dispatch({ type: 'efforts-ok', key, requestId: request.requestId, result: outcome.result ?? {} });
    });
  }, [modelPort, text]);

  const ensureEfforts = useCallback((providerId, modelId) => {
    if (!providerId || !modelId) return;
    if (stateRef.current.efforts[effortKey(providerId, modelId)]) return;
    resolveEfforts(providerId, modelId);
  }, [resolveEfforts]);

  const catalogValue = state.models?.status === 'ready' ? state.models.value : null;
  const activeSelection = currentSelection(state.value?.model ?? null, catalogValue);
  const activeProvider = activeSelection?.provider ?? '';
  const activeModel = activeSelection?.model ?? '';

  // The row must name the effort before the picker ever opens, so the pane load
  // resolves it for whichever model is in effect, including the followed default.
  useEffect(() => {
    ensureEfforts(activeProvider, activeModel);
  }, [ensureEfforts, activeProvider, activeModel]);

  const openPicker = (element) => {
    const current = stateRef.current;
    if (!current.value || current.saving || !current.writable) return;
    if (current.picker) {
      closePicker();
      return;
    }
    pickerAnchor.current = element ?? null;
    pickerScheme.current = element?.closest?.('[data-dl-scheme]')?.getAttribute('data-dl-scheme') ?? 'light';
    dispatch({ type: 'picker', event: { type: 'open', current: current.value.model } });
    void refreshModels();
  };

  const chooseModel = (providerId, modelId) => {
    const current = stateRef.current;
    const saved = current.value?.model ?? null;
    closePicker();
    if (saved && saved.provider === providerId && saved.model === modelId) return;
    void write(selectModelIntent(providerId, modelId));
  };

  const chooseFollow = () => {
    const current = stateRef.current;
    closePicker();
    if ((current.value?.model ?? null) === null) return;
    void write(followModelIntent());
  };

  const chooseEffort = (effortId) => {
    const current = stateRef.current;
    const catalog = current.models?.status === 'ready' ? current.models.value : null;
    const selection = currentSelection(current.value?.model ?? null, catalog);
    closePicker();
    if (!selection) return;
    const entry = current.efforts[effortKey(selection.provider, selection.model)] ?? null;
    const intent = effortPickIntent(selection, entry, effortId);
    if (!intent) return;
    void write(intent);
  };

  const retryModels = () => {
    void refreshModels();
  };

  const retryEfforts = () => {
    const current = stateRef.current;
    const catalog = current.models?.status === 'ready' ? current.models.value : null;
    const selection = currentSelection(current.value?.model ?? null, catalog);
    if (selection) resolveEfforts(selection.provider, selection.model);
  };

  // The confirmation dialog is the only window-level Escape. The picker handles
  // its own Escape and Shift+Tab on the card and the trigger, where it knows
  // which pane is open.
  useEffect(() => {
    if (!state.confirm) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      dispatch({ type: 'confirm', confirm: null });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.confirm]);

  const changeWorkspace = () => void pickWorkspace();

  const changeRetention = (event) => {
    const current = stateRef.current;
    const next = Number(event.target.value);
    if (!current.value || current.saving || !current.writable) return;
    const change = retentionChange(current.value.retentionDays, next);
    if (!change) return;
    if (change.kind === 'confirm') {
      dispatch({ type: 'confirm', confirm: { days: change.next } });
      return;
    }
    void write({ path: ['retentionDays'], value: change.next });
  };

  const confirmRetention = () => {
    const days = stateRef.current.confirm ? stateRef.current.confirm.days : null;
    if (!Number.isFinite(days)) return;
    dispatch({ type: 'confirm', confirm: null });
    void write({ path: ['retentionDays'], value: days });
  };

  const toggleChannel = (sourceId, field, value) => {
    const current = stateRef.current;
    if (!current.value || current.saving || !current.writable) return;
    void write(channelIntent(sourceId, field, value));
  };

  const channelStatusOf = (sourceId) => {
    const current = stateRef.current;
    if (current.channels?.status !== 'ready') return null;
    return (current.channels.value?.sources ?? []).find(entry => entry?.id === sourceId) ?? null;
  };

  /** `tooEarly` is refused locally: no write, and the pane keeps the saved time. */
  const changeScheduleAt = (sourceId, raw) => {
    const current = stateRef.current;
    if (!current.value || current.saving || !current.writable) return 'locked';
    const saved = channelOf(current.value, sourceId).scheduleAt;
    const outcome = scheduleAtOutcome(raw, saved, channelStatusOf(sourceId)?.capabilities?.minScheduleAt);
    if (outcome.kind === 'write') {
      void write(channelIntent(sourceId, 'scheduleAt', outcome.value));
      return 'write';
    }
    return outcome.kind;
  };

  const changeLocale = (sourceId, locale) => {
    const current = stateRef.current;
    if (!current.value || current.saving || !current.writable) return;
    if (channelOf(current.value, sourceId).locale === locale) return;
    void write(localeIntent(sourceId, locale));
  };

  const changeBatchSize = (sourceId, raw) => {
    const current = stateRef.current;
    if (!current.value || current.saving || !current.writable) return;
    const outcome = batchSizeOutcome(raw, channelOf(current.value, sourceId).batchSize);
    if (outcome.kind === 'write') {
      void write(channelIntent(sourceId, 'batchSize', outcome.value));
    }
  };

  const retryAll = () => {
    void load();
    void refreshChannels();
    void refreshModels();
  };

  const channels = state.channels?.status === 'ready' ? state.channels.value?.sources ?? [] : [];
  const rssChannels = state.channels?.status === 'ready' ? state.channels.value?.rssChannels ?? [] : [];
  const channelIds = state.channels
    ? state.channels.status === 'ready' ? channels.map(entry => entry.id) : state.channels.status === 'error' ? [] : null
    : null;
  const paneId = resolvePane(pane, channelIds);
  const items = navItems(paneId, channels, state.value, text);
  const title = paneTitle(paneId, channels, text);
  const now = new Date();
  const ready = state.phase === 'ready' && Boolean(state.value);
  const locked = !state.writable || state.saving;
  const banner = state.conflict || state.saveError;

  // The picker anchors to a row inside 通用设置; leaving that pane retires it.
  useEffect(() => {
    if (paneId !== 'general' && stateRef.current.picker) closePicker();
  }, [closePicker, paneId]);

  let body = null;
  if (state.phase === 'loading') {
    body = h('div', { className: 'dl-state dl-state--center' },
      h('p', { className: 'dl-state-sub' }, text('settings.loading')),
    );
  } else if (state.phase === 'error' || !state.value) {
    body = h(SettingsState, {
      title: text('settings.unavailable.title'),
      sub: state.error || text('settings.unavailable.sub'),
      action: h('button', {
        type: 'button',
        className: 'dl-btn dl-btn--primary',
        onClick: retryAll,
      }, text('settings.retry')),
    });
  } else if (paneId === 'general') {
    body = h(GeneralPane, {
      value: state.value,
      workspace,
      models: state.models,
      efforts: state.efforts,
      locked,
      actions: {
        changeWorkspace,
        changeRetention,
        openPicker,
      },
      text,
    });
  } else if (paneId === 'rss') {
    body = h(RssPane, {
      text,
      port: rssPortForPane,
      channel: channelOf(state.value, 'rss'),
      statuses: rssChannels,
      locked,
      actions: { toggle: toggleChannel, changeScheduleAt },
    });
  } else {
    body = h(ChannelPane, {
      key: paneId,
      sourceId: paneId,
      value: state.value,
      status: channels.find(entry => entry.id === paneId) ?? null,
      now,
      locked,
      actions: { toggle: toggleChannel, changeScheduleAt, changeLocale, changeBatchSize },
      text,
    });
  }

  const frame = pickerView(state.picker, state.models, state.efforts, text);

  return h('div', { className: 'dl-set-shell' },
    ready
      ? h(SettingsNav, { items, onSelect: onSelectPane, onBackToday, text })
      : null,
    h('main', { className: 'dl-main' },
      h('header', { className: 'dl-topbar' },
        h('span', { className: 'dl-day-title' }, title),
      ),
      h('div', { className: 'dl-body dl-body--settings' },
        h('div', { className: `dl-settings${paneId === 'rss' ? ' dl-settings--rss' : ''}` },
          ready
            ? h(SettingsTabs, { items, onSelect: onSelectPane, onBackToday, text })
            : null,
          ready && (state.writable === false || state.notice)
            ? h('div', { className: 'dl-set-head' },
              state.writable === false
                ? h('p', { className: 'dl-set-readonly' }, text('settings.readonly'))
                : null,
              state.notice ? h('span', { className: 'dl-set-notice', role: 'status' }, state.notice) : null,
            )
            : null,
          ready && banner
            ? h('div', { className: 'dl-inline-error' },
              h('span', { className: 'dl-inline-error-text' }, banner))
            : null,
          ready && state.channels?.status === 'error'
            ? h('div', { className: 'dl-inline-error' },
              h('span', { className: 'dl-inline-error-text' }, text('settings.nav.catalogError')),
              h('button', {
                type: 'button',
                className: 'dl-btn dl-btn--ghost dl-btn--sm',
                onClick: () => void refreshChannels(),
              }, text('settings.retry')))
            : null,
          body,
        ),
      ),
    ),
    state.confirm
      ? h('div', {
        className: 'dl-modal-overlay',
        role: 'presentation',
        onClick: () => dispatch({ type: 'confirm', confirm: null }),
      },
        h('div', {
          className: 'dl-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dl-retention-confirm-title',
          onClick: event => event.stopPropagation(),
        },
          h('h3', { id: 'dl-retention-confirm-title', className: 'dl-modal-title' },
            text('settings.confirm.title')),
          h('p', { className: 'dl-modal-body' },
            text('settings.confirm.body', { days: state.confirm.days })),
          h('div', { className: 'dl-modal-actions' },
            h('button', {
              type: 'button',
              className: 'dl-btn',
              onClick: () => dispatch({ type: 'confirm', confirm: null }),
            }, text('settings.confirm.cancel')),
            h('button', {
              type: 'button',
              className: 'dl-btn dl-btn--primary',
              onClick: confirmRetention,
            }, text('settings.confirm.ok')),
          ),
        ),
      )
      : null,
    frame && paneId === 'general' && pickerAnchor.current
      ? h(ModelPicker, {
        anchor: pickerAnchor.current,
        scheme: pickerScheme.current,
        frame,
        actions: {
          pane: next => dispatch({ type: 'picker', event: { type: 'pane', pane: next } }),
          query: value => dispatch({ type: 'picker', event: { type: 'query', query: value } }),
          clearQuery: () => dispatch({ type: 'picker', event: { type: 'query', query: '' } }),
          highlight: key => dispatch({ type: 'picker', event: { type: 'highlight', key } }),
          move: (delta, order, activeKey) => dispatch({
            type: 'picker',
            event: { type: 'move', delta, order, activeKey },
          }),
          back: () => dispatch({ type: 'picker', event: { type: 'back' } }),
          focusHandled: () => dispatch({ type: 'picker', event: { type: 'focus-handled' } }),
          close: closePicker,
          follow: chooseFollow,
          pickModel: chooseModel,
          pickEffort: chooseEffort,
          retryModels,
          retryEfforts,
        },
      })
      : null,
  );
}
