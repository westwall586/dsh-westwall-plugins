/** The feedUltra panel: today view (rail, day column, progress rail) and settings view. */

import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Calendar } from './calendar.mjs';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  OpenIcon,
  PlayIcon,
  RefreshIcon,
  SelectIcon,
  SettingsIcon,
  TrashIcon,
} from './icons.mjs';
import { createModelPicker } from './model-picker.mjs';
import { SettingsView } from './settings.mjs';
import { resolvePane } from './settings-model.mjs';
import {
  readingScrollKey,
  resolveReadingChannel,
  resolveReadingDay,
} from './reading-memory.mjs';
import {
  briefItemMeta,
  briefMeta,
  briefRowOf,
  calendarWithDay,
  channelName,
  channelStatusLine,
  countsLabel,
  descriptionOf,
  fetchableSourceIds,
  filterItems,
  formatDateTitle,
  formatRelativeTime,
  formatWeekday,
  isFutureDay,
  isManualSection,
  itemMeta,
  itemsForChannel,
  manualEmptyCopy,
  monthGridRange,
  monthKeyOf,
  oldestDayKey,
  percentRead,
  pullControl,
  pullLabel,
  pullSummary,
  rssSectionMeta,
  rowOf,
  sectionEmptyState,
  sectionHead,
  sectionKey,
  sectionKeyOf,
  sectionVisible,
  shiftDayKey,
  shiftMonthKey,
  translateOutcome,
  unreadCount,
  withToggledExpanded,
} from './view-model.mjs';

const h = createElement;
const RING_RADIUS = 30;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

const BASE_INITIAL_STATE = {
  view: 'today',
  phase: 'loading',
  status: null,
  guide: 'unbound',
  error: null,
  dayError: null,
  date: '',
  today: '',
  retentionDays: 30,
  day: null,
  sources: null,
  dayLoading: false,
  busy: [],
  translating: [],
  deleting: [],
  fetchErrors: {},
  deleteErrors: {},
  translateErrors: {},
  channel: 'all',
  filter: 'all',
  selectMode: false,
  selected: new Set(),
  expanded: new Set(),
  month: '',
  calendar: new Map(),
  calendarMonth: '',
  calendarLoading: false,
  settingsPane: 'general',
};

/**
 * Expanded descriptions are kept across channel, filter, view and day switches
 * so a reader who comes back finds the rows they opened. One panel holds one
 * day's items, so the set is cleared whenever the day changes, and it is capped
 * as a backstop against a set that never shrinks while the day stays put.
 */
const EXPANDED_LIMIT = 200;

function createInitialState(memory) {
  const selection = memory.readSelection();
  return {
    ...BASE_INITIAL_STATE,
    channel: selection.channel,
    filter: selection.filter,
    date: selection.day,
    selected: new Set(),
    calendar: new Map(),
  };
}

function messageOf(error, text) {
  return error && typeof error.message === 'string' && error.message
    ? error.message
    : text('error.unknown');
}

function sourceIdsOf(sources) {
  return (sources?.sources ?? []).map(source => source.id);
}

function markReadInDay(day, ids, readAt) {
  const target = new Set(ids);
  const sections = day.sections.map((section) => {
    const items = section.items.map((item) =>
      target.has(item.id) && !item.read ? { ...item, read: true, readAt } : item);
    const unread = items.filter(item => !item.read).length;
    return { ...section, items, unread };
  });
  const total = sections.reduce((sum, section) => sum + section.count, 0);
  const unread = sections.reduce((sum, section) => sum + section.unread, 0);
  return { ...day, sections, total, read: total - unread, unread };
}

function dotClass(status) {
  if (status === 'ok') return 'dl-dot--ok';
  if (status === 'error') return 'dl-dot--warn';
  return 'dl-dot--idle';
}

function sectionDotClass(section, fetchError) {
  if (fetchError || section.status === 'error' || section.status === 'corrupt') return 'dl-dot--warn';
  if (section.status === 'ok') return 'dl-dot--ok';
  return 'dl-dot--idle';
}

function panelReducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...state, phase: 'loading', error: null, dayError: null };
    case 'status':
      return {
        ...state,
        status: action.status,
        today: action.status.today,
        retentionDays: action.status.retentionDays,
        date: state.date || action.status.today,
      };
    case 'guide':
      return { ...state, phase: 'guide', guide: action.kind, error: null };
    case 'error':
      return { ...state, phase: 'error', error: action.error };
    case 'ready':
      return {
        ...state,
        phase: 'ready',
        day: action.day,
        sources: action.sources,
        channel: resolveReadingChannel(state.channel, action.sources),
        date: action.day.date,
        today: action.day.today,
        month: monthKeyOf(action.day.date),
        dayLoading: false,
        dayError: null,
        fetchErrors: {},
        deleteErrors: {},
        settingsPane: resolvePane(state.settingsPane, sourceIdsOf(action.sources)),
      };
    case 'date':
      return {
        ...state,
        date: action.date,
        month: monthKeyOf(action.date),
        selected: new Set(),
        expanded: new Set(),
        day: null,
        dayLoading: true,
        dayError: null,
        fetchErrors: {},
        deleteErrors: {},
        translateErrors: {},
      };
    case 'day':
      return {
        ...state,
        day: action.day,
        sources: action.sources,
        channel: resolveReadingChannel(state.channel, action.sources),
        expanded: action.day.date === state.date ? state.expanded : new Set(),
        dayLoading: false,
        dayError: null,
        settingsPane: resolvePane(state.settingsPane, sourceIdsOf(action.sources)),
      };
    case 'day-error':
      return { ...state, dayLoading: false, dayError: action.error };
    case 'busy': {
      const busy = action.on
        ? [...new Set([...state.busy, action.id])]
        : state.busy.filter(id => id !== action.id);
      return { ...state, busy };
    }
    case 'busy-all':
      return { ...state, busy: action.ids };
    case 'translating': {
      const translating = action.on
        ? [...new Set([...state.translating, action.id])]
        : state.translating.filter(id => id !== action.id);
      return { ...state, translating };
    }
    case 'deleting': {
      const deleting = action.on
        ? [...new Set([...state.deleting, action.id])]
        : state.deleting.filter(id => id !== action.id);
      return { ...state, deleting };
    }
    case 'delete-error': {
      const deleteErrors = { ...state.deleteErrors };
      if (action.error === null) delete deleteErrors[action.id];
      else deleteErrors[action.id] = action.error;
      return { ...state, deleteErrors };
    }
    case 'delete-mark': {
      if (!state.day) return state;
      const sections = state.day.sections.map((section) => {
        if (!section.items.some(item => item.id === action.id)) return section;
        const items = section.items.map(item => (item.id === action.id
          ? { ...item, extra: { ...(item.extra ?? {}), xDeletedAt: action.deletedAt } }
          : item));
        return { ...section, items };
      });
      // The card stays and keeps its read state; only `extra.xDeletedAt` moves.
      return { ...state, day: { ...state.day, sections } };
    }
    case 'fetch-error': {
      const fetchErrors = { ...state.fetchErrors };
      if (action.error === null) delete fetchErrors[action.id];
      else fetchErrors[action.id] = action.error;
      return { ...state, fetchErrors };
    }
    case 'translate-error': {
      const translateErrors = { ...state.translateErrors };
      if (action.error === null) delete translateErrors[action.id];
      else translateErrors[action.id] = { day: action.day, message: action.error };
      return { ...state, translateErrors };
    }
    case 'settings-pane':
      return { ...state, settingsPane: resolvePane(action.pane, sourceIdsOf(state.sources)) };
    case 'mark-read': {
      if (!state.day) return state;
      const day = markReadInDay(state.day, action.ids, action.readAt);
      const calendar = state.month && state.calendarMonth === state.month
        ? calendarWithDay(state.calendar, state.date, day.total, day.unread)
        : state.calendar;
      return { ...state, day, calendar };
    }
    case 'channel':
      return { ...state, channel: action.channel, selected: new Set() };
    case 'toggle-expanded':
      return { ...state, expanded: withToggledExpanded(state.expanded, action.id, EXPANDED_LIMIT) };
    case 'view':
      return { ...state, view: action.view, selectMode: false, selected: new Set() };
    case 'filter':
      return { ...state, filter: action.filter, selected: new Set() };
    case 'select-mode':
      return { ...state, selectMode: action.on, selected: action.on ? state.selected : new Set() };
    case 'select': {
      const selected = new Set(state.selected);
      if (selected.has(action.id)) selected.delete(action.id);
      else selected.add(action.id);
      return { ...state, selected };
    }
    case 'month':
      return {
        ...state,
        month: action.month,
        calendar: state.calendarMonth === action.month ? state.calendar : new Map(),
        calendarMonth: state.calendarMonth === action.month ? state.calendarMonth : '',
        selected: new Set(),
      };
    case 'calendar-reset':
      return { ...state, calendar: new Map(), calendarMonth: '', calendarLoading: false };
    case 'calendar-start':
      return {
        ...state,
        calendarLoading: true,
        calendarMonth: action.month === state.calendarMonth ? state.calendarMonth : '',
        calendar: action.month === state.calendarMonth ? state.calendar : new Map(),
      };
    case 'calendar':
      return { ...state, calendar: action.days, calendarMonth: action.month, calendarLoading: false };
    case 'calendar-error':
      return {
        ...state,
        calendar: action.month === state.month ? state.calendar : new Map(),
        calendarMonth: action.month,
        calendarLoading: false,
      };
    default:
      return state;
  }
}

/**
 * Open one article in the right Sidebar of the feedUltra workspace's Session.
 * The Sidebar is per Session, and `openTab` acts only on the Session on screen,
 * so the app must select a Session in that Workspace first. `workspaces.create`
 * is idempotent for a path that is already registered.
 */
async function openInDataWorkspace(ctx, path, url) {
  const view = await ctx.workspaces.create({ path });
  let sessionId;
  await ctx.uiWorkspace.openWorkspace(view.workspaceId, (opened) => {
    sessionId = opened;
  });
  ctx.layout.selectPanel(null);
  if (!sessionId) throw new Error('the workspace opened without selecting a session');

  const mounted = ctx.sidebarRight.mounted;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (mounted.getSnapshot() === sessionId) {
      try {
        ctx.sidebarRight.openTab('browser', { params: { url } });
        return;
      } catch {
        // The Session is on screen; its Sidebar store mints on the next render.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the right sidebar did not become ready');
}

/**
 * Owns the panel state machine: loading -> guide | error | ready. Going back to a
 * date refetches; only the viewed day is kept.
 */
function usePanelData(ctx, api, text, readingMemory) {
  const [state, dispatch] = useReducer(panelReducer, undefined, () => createInitialState(readingMemory));
  const [binding, setBinding] = useState(false);
  const seqRef = useRef(0);
  const calSeqRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadCalendar = useCallback(async (month) => {
    if (!month) return;
    const range = monthGridRange(month);
    const seq = ++calSeqRef.current;
    dispatch({ type: 'calendar-start', month });
    try {
      const view = await api.calendar(range.from, range.to);
      if (seq !== calSeqRef.current || stateRef.current.month !== month) return;
      const days = new Map();
      for (const entry of view?.days ?? []) {
        if (entry && typeof entry.day === 'string') days.set(entry.day, entry);
      }
      dispatch({ type: 'calendar', month, days });
    } catch {
      if (seq !== calSeqRef.current || stateRef.current.month !== month) return;
      dispatch({ type: 'calendar-error', month });
    }
  }, [api]);

  const bootstrap = useCallback(async () => {
    const seq = ++seqRef.current;
    calSeqRef.current += 1;
    dispatch({ type: 'loading' });
    dispatch({ type: 'calendar-reset' });
    try {
      const status = await api.status();
      if (seq !== seqRef.current) return;
      dispatch({ type: 'status', status });
      if (status.workspace.status !== 'ok') {
        dispatch({ type: 'guide', kind: status.workspace.status });
        return;
      }
      const memory = readingMemory.readSelection();
      const target = resolveReadingDay(memory, {
        today: status.today,
        retentionDays: status.retentionDays,
        workspacePath: status.workspace.path,
      });
      const [sources, day] = await Promise.all([api.sources(), api.day(target)]);
      if (seq !== seqRef.current) return;
      dispatch({ type: 'ready', day, sources });
    } catch (error) {
      if (seq !== seqRef.current) return;
      dispatch({ type: 'error', error: messageOf(error, text) });
    }
  }, [api, text]);

  const loadDay = useCallback(async (date) => {
    const seq = ++seqRef.current;
    dispatch({ type: 'date', date });
    try {
      const [day, sources] = await Promise.all([api.day(date), api.sources()]);
      if (seq !== seqRef.current) return;
      dispatch({ type: 'ready', day, sources });
    } catch (error) {
      if (seq !== seqRef.current) return;
      dispatch({ type: 'day-error', error: messageOf(error, text) });
    }
  }, [api, text]);

  const reloadDay = useCallback(async () => {
    const date = stateRef.current.date;
    try {
      const [day, sources] = await Promise.all([api.day(date), api.sources()]);
      if (stateRef.current.date !== date) return;
      dispatch({ type: 'day', day, sources });
    } catch (error) {
      if (stateRef.current.date !== date) return;
      dispatch({ type: 'day-error', error: messageOf(error, text) });
    }
  }, [api, text]);

  /**
   * The section head refresh pulls the day being viewed: today goes through
   * `fetch`, a past day through `backfill` when the channel declares it. A past
   * day without the capability has no refresh entry at all.
   */
  const refreshSection = useCallback(async (section) => {
    const sourceId = section?.source?.id;
    if (typeof sourceId !== 'string' || sourceId === '') return;
    const key = sectionKey(section);
    const current = stateRef.current;
    const viewed = current.date;
    const past = Boolean(current.today && viewed && viewed !== current.today);
    if (past && section?.capabilities?.backfill !== true) return;
    dispatch({ type: 'busy', id: key, on: true });
    dispatch({ type: 'fetch-error', id: key, error: null });
    try {
      const result = past ? await api.backfill(sourceId, viewed) : await api.fetch(sourceId);
      if (result && result.status === 'error') {
        dispatch({ type: 'fetch-error', id: key, error: result.error || text('card.failed') });
      }
      if (result && typeof result.translationError === 'string' && result.translationError) {
        dispatch({
          type: 'translate-error',
          id: key,
          day: stateRef.current.date,
          message: result.translationError,
        });
      } else {
        dispatch({ type: 'translate-error', id: key, error: null });
      }
      await reloadDay();
    } catch (error) {
      dispatch({ type: 'fetch-error', id: key, error: messageOf(error, text) });
    } finally {
      dispatch({ type: 'busy', id: key, on: false });
      void loadCalendar(stateRef.current.month);
    }
  }, [api, loadCalendar, reloadDay, text]);

  const translateSource = useCallback(async (sourceId) => {
    const current = stateRef.current;
    const day = current.date;
    const section = (current.day?.sections ?? []).find(entry => entry.source.id === sourceId);
    if (!day || !section || section.translation?.enabled !== true) return;
    if (current.busy.includes(sourceId) || current.translating.includes(sourceId)) return;
    dispatch({ type: 'translating', id: sourceId, on: true });
    dispatch({ type: 'translate-error', id: sourceId, error: null });
    try {
      const result = await api.translate(sourceId, day);
      const message = translateOutcome(result, text);
      if (message) dispatch({ type: 'translate-error', id: sourceId, day, message });
      if (stateRef.current.date === day) await reloadDay();
    } catch (error) {
      dispatch({ type: 'translate-error', id: sourceId, day, message: messageOf(error, text) });
    } finally {
      dispatch({ type: 'translating', id: sourceId, on: false });
      if (stateRef.current.date === day) void loadCalendar(stateRef.current.month);
    }
  }, [api, loadCalendar, reloadDay, text]);

  const fetchAll = useCallback(async () => {
    const ids = fetchableSourceIds(stateRef.current.sources);
    if (ids.length === 0) return;
    dispatch({ type: 'busy-all', ids });
    try {
      for (const sourceId of ids) {
        dispatch({ type: 'fetch-error', id: sourceId, error: null });
        try {
          const result = await api.fetch(sourceId);
          if (result && result.status === 'error') {
            dispatch({ type: 'fetch-error', id: sourceId, error: result.error || text('card.failed') });
          }
          if (result && typeof result.translationError === 'string' && result.translationError) {
            dispatch({
              type: 'translate-error',
              id: sourceId,
              day: stateRef.current.date,
              message: result.translationError,
            });
          } else {
            dispatch({ type: 'translate-error', id: sourceId, error: null });
          }
        } catch (error) {
          dispatch({ type: 'fetch-error', id: sourceId, error: messageOf(error, text) });
        }
      }
      await reloadDay();
    } finally {
      dispatch({ type: 'busy-all', ids: [] });
      void loadCalendar(stateRef.current.month);
    }
  }, [api, loadCalendar, reloadDay, text]);

  const markRead = useCallback(async (ids) => {
    const target = ids.filter(Boolean);
    if (target.length === 0) return false;
    try {
      const result = await api.act('read', target);
      const failed = new Set(
        (result?.results ?? []).filter(entry => entry && entry.status !== 'ok').map(entry => entry.id),
      );
      const accepted = target.filter(id => !failed.has(id));
      if (accepted.length > 0) {
        dispatch({ type: 'mark-read', ids: accepted, readAt: new Date().toISOString() });
      }
      return accepted.length > 0;
    } catch (error) {
      console.warn('[dsh-feed-ultra] mark read failed:', messageOf(error, text));
      return false;
    }
  }, [api, text]);

  /**
   * Delete one item's bookmark on X. The local card stays and only gains
   * `extra.xDeletedAt`, so read state, counts and the calendar never move.
   */
  const deleteBookmark = useCallback(async (item) => {
    const id = item?.id;
    if (!id || stateRef.current.deleting.includes(id)) return false;
    dispatch({ type: 'deleting', id, on: true });
    dispatch({ type: 'delete-error', id, error: null });
    try {
      const result = await api.act('deleteBookmark', [id]);
      const entry = (result?.results ?? []).find(row => row?.id === id) ?? null;
      if (entry && entry.status === 'ok') {
        const deletedAt = typeof entry.deletedAt === 'string' && entry.deletedAt !== ''
          ? entry.deletedAt
          : new Date().toISOString();
        dispatch({ type: 'delete-mark', id, deletedAt });
        return true;
      }
      dispatch({ type: 'delete-error', id, error: entry?.error || text('x.deleteFailed') });
      return false;
    } catch (error) {
      dispatch({ type: 'delete-error', id, error: messageOf(error, text) });
      return false;
    } finally {
      dispatch({ type: 'deleting', id, on: false });
    }
  }, [api, text]);

  /**
   * Open one item in the Sidebar. `url` is the row's own link when the card
   * passed it, so a row whose title differs from `item.url` still opens its link.
   */
  const openItem = useCallback((item, url = item.url) => {
    void markRead([item.id]);
    if (!url) {
      ctx.layout.selectPanel(null);
      return;
    }
    // The web carrier has no Sidebar browser; keep its new-tab fallback inside
    // the click gesture. The desktop carrier opens in the data workspace.
    const canUseSidebar = Boolean(ctx.sidebarRightTabs?.get?.('browser'));
    const workspacePath = stateRef.current.status?.workspace?.path ?? '';
    if (!canUseSidebar || workspacePath === '' || !ctx.workspaces) {
      ctx.layout.selectPanel(null);
      try {
        ctx.sidebarRight.openTab('browser', { params: { url } });
      } catch (error) {
        console.warn('[dsh-feed-ultra] sidebar browser unavailable, opening externally:', error);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    void openInDataWorkspace(ctx, workspacePath, url).catch((error) => {
      console.warn('[dsh-feed-ultra] data workspace session unavailable, using the current session:', error);
      ctx.layout.selectPanel(null);
      try {
        ctx.sidebarRight.openTab('browser', { params: { url } });
      } catch (fallbackError) {
        console.warn('[dsh-feed-ultra] sidebar browser unavailable, opening externally:', fallbackError);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    });
  }, [ctx, markRead]);

  /** Open a URL in the system browser; the panel stays mounted. */
  const openUrl = useCallback((url) => {
    if (typeof url !== 'string' || url === '') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openExternal = useCallback(async (item, url) => {
    const target = typeof url === 'string' && url !== '' ? url : item.url;
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
    await markRead([item.id]);
  }, [markRead]);

  const bindWorkspace = useCallback(async () => {
    setBinding(true);
    try {
      const path = await ctx.uiWorkspace.pickDirectory();
      if (!path) return;
      await api.bindWorkspace(path);
      await bootstrap();
    } catch (error) {
      dispatch({ type: 'error', error: messageOf(error, text) });
    } finally {
      setBinding(false);
    }
  }, [api, bootstrap, ctx, text]);

  const chooseWorkspace = useCallback(async () => {
    const path = await ctx.uiWorkspace.pickDirectory();
    if (!path) return null;
    await api.bindWorkspace(path);
    const status = await api.status();
    dispatch({ type: 'status', status });
    if (status.workspace.status === 'ok') await bootstrap();
    return status;
  }, [api, bootstrap, ctx]);

  const goDate = useCallback((date) => {
    const current = stateRef.current;
    if (!current.today || current.dayLoading) return;
    if (isFutureDay(date, current.today)) return;
    if (date === current.date) return;
    void loadDay(date);
  }, [loadDay]);

  const markSelected = useCallback(async () => {
    const ids = [...stateRef.current.selected];
    if (ids.length === 0) return false;
    const accepted = await markRead(ids);
    if (accepted) dispatch({ type: 'select-mode', on: false });
    return accepted;
  }, [markRead]);

  const modelPort = useMemo(() => createModelPicker(api), [api]);
  const loadChannels = useCallback(() => api.sources(), [api]);

  const actions = {
    bootstrap,
    retry: bootstrap,
    goPrev: () => goDate(shiftDayKey(state.date, -1)),
    goNext: () => goDate(shiftDayKey(state.date, 1)),
    goToday: () => goDate(state.today),
    goDate,
    retryDay: () => void loadDay(stateRef.current.date),
    selectChannel: channel => dispatch({ type: 'channel', channel }),
    selectFilter: filter => dispatch({ type: 'filter', filter }),
    startSelect: () => dispatch({ type: 'select-mode', on: true }),
    cancelSelect: () => dispatch({ type: 'select-mode', on: false }),
    toggleSelect: id => dispatch({ type: 'select', id }),
    toggleExpanded: id => dispatch({ type: 'toggle-expanded', id }),
    markSelected,
    selectMonth: (delta) => {
      const month = stateRef.current.month;
      if (!month) return;
      const next = shiftMonthKey(month, delta);
      if (next > monthKeyOf(stateRef.current.today)) return;
      dispatch({ type: 'month', month: next });
    },
    openSettings: () => dispatch({ type: 'view', view: 'settings' }),
    openToday: () => {
      dispatch({ type: 'view', view: 'today' });
      if (stateRef.current.date) void reloadDay();
    },
    selectSettingsPane: pane => dispatch({ type: 'settings-pane', pane }),
    refreshSection,
    translateSource,
    fetchAll,
    markRead,
    deleteBookmark,
    openItem,
    openExternal,
    openUrl,
    bindWorkspace,
    chooseWorkspace,
  };

  useEffect(() => {
    void bootstrap();
    return () => {
      seqRef.current += 1;
      calSeqRef.current += 1;
    };
  }, [bootstrap]);

  useEffect(() => {
    if (state.phase !== 'ready' || !state.month) return;
    if (state.calendarMonth === state.month || state.calendarLoading) return;
    void loadCalendar(state.month);
  }, [loadCalendar, state.phase, state.month, state.calendarMonth, state.calendarLoading]);

  return { state, binding, actions, modelPort, loadChannels };
}

function RailBrand({ text }) {
  return h('div', { className: 'dl-rail-brand' },
    h('span', { className: 'dl-brand-mark', 'aria-hidden': true }),
    h('span', { className: 'dl-brand-name' }, text('entry')),
  );
}

function LeftRail({ state, text, actions }) {
  const sourceRows = state.sources?.sources
    ? state.sources.sources.filter(source => source.id !== 'rss')
    : (state.day?.sections ?? [])
      .filter(section => section.source.id !== 'rss')
      .map(section => ({
        id: section.source.id,
        name: section.source.name,
        status: section.status === 'ok' ? 'ok' : section.status === 'missing' || section.status === 'empty' ? 'idle' : 'error',
        todayCount: section.count,
      }));
  const rssChannels = (state.sources?.rssChannels ?? []).filter(channel => channel.feedCount > 0);

  const countOf = (key) => {
    if (state.day) {
      let total = 0;
      for (const section of state.day.sections) if (sectionKey(section) === key) total += section.count;
      return total;
    }
    const source = sourceRows.find(entry => entry.id === key);
    if (source) return source.todayCount;
    const channel = rssChannels.find(entry => entry.id === key);
    return channel ? channel.todayCount : 0;
  };
  const allCount = state.day
    ? state.day.total
    : sourceRows.reduce((sum, source) => sum + source.todayCount, 0)
      + rssChannels.reduce((sum, channel) => sum + channel.todayCount, 0);

  return h('aside', { className: 'dl-rail' },
    h(RailBrand, { text }),
    h('div', { className: 'dl-rail-scroll' },
      h(Calendar, {
        month: state.month,
        today: state.today,
        entries: state.calendar,
        selected: state.date,
        text,
        onSelect: actions.goDate,
        onMonth: actions.selectMonth,
      }),
      h('div', { className: 'dl-rail-block dl-rail-block--all' },
        h('button', {
          type: 'button',
          className: 'dl-channel',
          'aria-pressed': state.channel === 'all',
          onClick: () => actions.selectChannel('all'),
        },
          h('span', { className: 'dl-channel-name' }, text('channel.all')),
          h('span', { className: 'dl-channel-count' }, String(allCount)),
        ),
      ),
      h('div', { className: 'dl-rail-block' },
        h('div', { className: 'dl-rail-label' }, text('rail.channels')),
        ...sourceRows.map(source => h('button', {
          key: source.id,
          type: 'button',
          className: 'dl-channel',
          'aria-pressed': state.channel === source.id,
          onClick: () => actions.selectChannel(source.id),
        },
          h('span', {
            className: `dl-status-dot ${dotClass(source.status)}${source.status === 'error' ? ' dl-pulse' : ''}`,
            'aria-hidden': true,
          }),
          h('span', { className: 'dl-channel-name' }, channelName(source, text)),
          h('span', { className: 'dl-channel-count' }, String(countOf(source.id))),
        )),
      ),
      rssChannels.length > 0
        ? h('div', { className: 'dl-rail-block' },
          h('div', { className: 'dl-rail-label dl-rail-label--rss' }, text('rail.rss')),
          ...rssChannels.map(channel => {
            const key = sectionKeyOf('rss', channel.id);
            return h('button', {
              key,
              type: 'button',
              className: 'dl-channel',
              'aria-pressed': state.channel === key,
              onClick: () => actions.selectChannel(key),
            },
              h('span', {
                className: `dl-status-dot ${dotClass(channel.status)}${channel.status === 'error' ? ' dl-pulse' : ''}`,
                'aria-hidden': true,
              }),
              h('span', { className: 'dl-channel-name' }, channel.name),
              h('span', { className: 'dl-channel-count' }, String(countOf(key))),
            );
          }),
        )
        : null,
    ),
    h('div', { className: 'dl-rail-foot' },
      h('button', {
        type: 'button',
        className: 'dl-rail-link',
        onClick: actions.openSettings,
      },
        h(SettingsIcon, { size: 12 }),
        text('rail.settings'),
      ),
    ),
  );
}

function Topbar({ state, text, counts, actions }) {
  const isToday = state.date === state.today;
  const oldest = state.today ? oldestDayKey(state.today, state.retentionDays) : '';
  return h('header', { className: 'dl-topbar' },
    h('button', {
      type: 'button',
      className: 'dl-icon-btn',
      title: text('topbar.prevDay'),
      'aria-label': text('topbar.prevDay'),
      disabled: !oldest || state.date <= oldest,
      onClick: actions.goPrev,
    }, h(ChevronLeftIcon, { size: 14 })),
    h('button', {
      type: 'button',
      className: 'dl-icon-btn',
      title: text('topbar.nextDay'),
      'aria-label': text('topbar.nextDay'),
      disabled: state.date >= state.today,
      onClick: actions.goNext,
    }, h(ChevronRightIcon, { size: 14 })),
    h('span', { className: 'dl-day-title' }, formatDateTitle(state.date, text)),
    h('span', { className: 'dl-weekday' }, formatWeekday(state.date, text)),
    isToday
      ? h('span', { className: 'dl-today-pill' }, text('topbar.today'))
      : h('button', {
        type: 'button',
        className: 'dl-btn dl-btn--ghost',
        style: { marginLeft: 4 },
        onClick: actions.goToday,
      }, text('topbar.today')),
    h('span', { className: 'dl-spacer' }),
    h('span', { className: 'dl-counts' }, counts.total > 0 ? countsLabel(counts.unread, counts.total, text) : ''),
  );
}

function Filters({ state, unread, text, actions }) {
  return h('div', { className: 'dl-filters' },
    h('button', {
      type: 'button',
      className: 'dl-chip',
      'aria-pressed': state.filter === 'all',
      onClick: () => actions.selectFilter('all'),
    }, text('filters.all')),
    h('button', {
      type: 'button',
      className: 'dl-chip',
      'aria-pressed': state.filter === 'unread',
      onClick: () => actions.selectFilter('unread'),
    }, text('filters.unread', { n: unread })),
    h('span', { className: 'dl-spacer' }),
    state.selectMode
      ? h('div', { className: 'dl-bulk-bar' },
        h('span', { className: 'dl-bulk-count' }, text('bulk.selected', { n: state.selected.size })),
        h('button', {
          type: 'button',
          className: 'dl-btn dl-btn--sm',
          disabled: state.selected.size === 0,
          onClick: () => void actions.markSelected(),
        }, text('bulk.markRead')),
        h('button', {
          type: 'button',
          className: 'dl-btn dl-btn--ghost dl-btn--sm',
          onClick: actions.cancelSelect,
        }, text('bulk.cancel')),
      )
      : h('button', {
        type: 'button',
        className: 'dl-chip dl-chip--select',
        onClick: actions.startSelect,
      }, h(SelectIcon, { size: 12 }), text('filters.select')),
  );
}

/** The cover of one row: lazy image, letter placeholder when the image fails, video badge. */
function RowCover({ initial, cover, video }) {
  const [coverFailed, setCoverFailed] = useState(false);
  return h('div', { className: 'dl-row-cover' },
    coverFailed
      ? h('span', { className: 'dl-row-cover-fallback', 'aria-hidden': true }, initial)
      : h('img', {
        src: cover,
        alt: '',
        width: 132,
        height: 74,
        loading: 'lazy',
        decoding: 'async',
        referrerPolicy: 'no-referrer',
        onError: () => setCoverFailed(true),
      }),
    video
      ? h('span', { className: 'dl-play', 'aria-hidden': true }, h(PlayIcon, { size: 8 }))
      : null,
  );
}

function attachmentSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function attachmentLabel(attachment, text) {
  const type = typeof attachment.type === 'string' ? attachment.type : '';
  const kind = type.startsWith('audio/')
    ? text('row.audio')
    : type.startsWith('video/')
      ? text('row.video')
      : type === 'application/pdf'
        ? text('row.pdf')
        : text('row.attachment');
  const size = attachmentSize(Number(attachment.length));
  return size === '' ? kind : `${kind} · ${size}`;
}

/**
 * The body of one channel empty state. A manual channel pulls from today and
 * points back to today from history; the other channels keep their pending
 * retry and backfill entries.
 */
function SectionEmpty({ kind, section, busy, isToday, canBackfill, text, actions }) {
  const manual = isManualSection(section);
  const pooled = section.channelId !== undefined;
  const copy = manual ? manualEmptyCopy(section, isToday, text) : null;
  const pooledCopy = pooled
    ? kind === 'missing'
      ? (isToday
        ? { title: text('state.rss.missing.title'), sub: text('state.rss.missing.sub') }
        : { title: text('state.past.title'), sub: text('state.past.sub') })
      : kind === 'empty'
        ? { title: text('state.empty.title'), sub: text('state.empty.sub') }
        : null
    : null;
  const title = copy ? copy.title : pooledCopy ? pooledCopy.title : text(`state.${kind}.title`);
  const sub = copy ? copy.sub : pooledCopy ? pooledCopy.sub : text(`state.${kind}.sub`);
  let action = null;
  if (pooled) {
    if (kind === 'missing') {
      action = isToday
        ? h('button', {
          type: 'button',
          className: 'dl-btn',
          disabled: busy,
          onClick: () => void actions.refreshSection(section),
        },
          busy ? h(RefreshIcon, { size: 12, className: 'dl-spin' }) : null,
          busy ? text('section.rss.pulling') : text('section.rss.pullShort'),
        )
        : h('button', {
          type: 'button',
          className: 'dl-btn',
          onClick: actions.goToday,
        }, text('state.backToday'));
    }
  } else if (manual) {
    action = isToday
      ? h('button', {
        type: 'button',
        className: 'dl-btn',
        disabled: busy,
        onClick: () => void actions.refreshSection(section),
      }, pullLabel(section, busy, text))
      : h('button', {
        type: 'button',
        className: 'dl-btn',
        onClick: actions.goToday,
      }, text('state.backToday'));
  } else if (kind === 'pending') {
    action = h('button', {
      type: 'button',
      className: 'dl-btn',
      disabled: busy,
      onClick: () => void actions.refreshSection(section),
    },
      busy ? h(RefreshIcon, { size: 12, className: 'dl-spin' }) : null,
      text('state.pending.fetch'),
    );
  } else if (kind === 'missing' && canBackfill) {
    action = h('button', {
      type: 'button',
      className: 'dl-btn',
      disabled: busy,
      onClick: () => void actions.refreshSection(section),
    },
      busy ? h(RefreshIcon, { size: 12, className: 'dl-spin' }) : null,
      busy ? text('state.missing.backfilling') : text('state.missing.backfill'),
    );
  }
  return h('div', { className: 'dl-section-empty' },
    h('div', { className: 'dl-section-empty-text' },
      h('div', { className: 'dl-section-empty-title' }, title),
      sub ? h('div', { className: 'dl-section-empty-sub' }, sub) : null,
    ),
    action,
  );
}

function SectionCard({
  section,
  index,
  busy,
  translating,
  sourceStatus,
  rssChannel = null,
  fetchError,
  translateError,
  day,
  today,
  uiLocale,
  text,
  actions,
  selectMode,
  selected,
  deleting = [],
  deleteErrors = {},
  expanded = new Set(),
}) {
  const now = new Date();
  const manual = isManualSection(section);
  const isPooled = section.channelId !== undefined;
  const rss = isPooled ? rssSectionMeta(section) : null;
  const rssSources = rssChannel?.feedCount ?? rss?.feeds.length ?? 0;
  const rssFailed = rss?.failed ?? 0;
  const rssOverLimit = rss?.overLimit ?? 0;
  const brief = section.source?.type === 'bestblogs-brief' ? briefMeta(section) : null;
  const emptyState = sectionEmptyState(section);
  const pull = pullControl(section, { day, today, busy }, text);
  const showBrief = Boolean(brief)
    && section.status !== 'pending'
    && section.status !== 'notPublished';
  const when = section.fetch?.lastSuccessAt
    ? formatRelativeTime(section.fetch.lastSuccessAt, now, text)
    : text('card.never');
  const meta = [when];
  if (fetchError || section.status === 'error') meta.push(text('card.failed'));
  else if (section.status === 'corrupt') meta.push(text('card.corrupt'));
  else if (manual) {
    const summary = pullSummary(section, text);
    if (summary) meta.push(summary);
  }
  const isError = Boolean(fetchError) || section.status === 'error' || section.status === 'corrupt';
  const statusLine = sourceStatus ? channelStatusLine(sourceStatus, now, text) : null;
  if (statusLine?.exhausted && day === today) meta.push(statusLine.text);
  const translation = {
    ...(section.translation ?? {}),
    error: translateError || section.translation?.error || '',
  };
  const baseHead = sectionHead({ ...section, translation }, { fetch: busy, translate: translating }, text);
  const head = isPooled ? { ...baseHead, showTranslate: false, showError: false, statusText: '' } : baseHead;
  const canRefresh = day === today || section.capabilities?.backfill === true;
  const canBackfill = day !== today && section.capabilities?.backfill === true;
  const statusText = section.status === 'pending'
    ? text('state.pending.title')
    : section.status === 'notPublished'
      ? text('state.notPublished.title')
      : isPooled
        ? [
          text('section.rss.sources', { n: rssSources }),
          text('section.rss.items', { n: section.count }),
          rssFailed > 0 ? text('section.rss.failed', { n: rssFailed }) : '',
          rssOverLimit > 0 ? text('section.rss.overLimit', { n: rssOverLimit }) : '',
        ].filter(Boolean).join(' · ')
        : meta.join(' · ');
  const showDot = section.status !== 'notPublished';
  const degraded = showBrief && brief.detailStatus === 'degraded';

  // A channel is a heading followed by its cards, not a container: each row is
  // its own card on the page's ground, so no shared border turns the list into a
  // table. The heading scrolls with the rows it names.
  return h('div', { className: 'dl-group', style: { '--dl-i': index } },
    h('div', { className: 'dl-card-head' },
      h('span', { className: 'dl-ch-dot', 'aria-hidden': true }),
      h('span', { className: 'dl-card-title' }, channelName(section.source, text)),
      manual ? h('span', { className: 'dl-card-pill' }, text('x.manual')) : null,
      h('span', { className: 'dl-card-count' }, String(section.count)),
      h('span', {
        className: `dl-card-meta${isError ? ' is-error' : ''}`,
        title: fetchError || section.fetch?.error || '',
      },
        showDot
          ? h('span', { className: `dl-status-dot ${sectionDotClass(section, fetchError)}` })
          : null,
        h('span', { className: 'dl-card-meta-text' }, statusText),
      ),
      degraded ? h('span', { className: 'dl-card-hint' }, text('brief.detailsIncomplete')) : null,
      head.statusText ? h('span', { className: 'dl-card-status' }, head.statusText) : null,
      canRefresh
        ? pull.show
          ? h('button', {
            type: 'button',
            className: 'dl-btn dl-btn--sm',
            disabled: pull.disabled,
            onClick: () => void actions.refreshSection(section),
          }, pull.label)
          : h('button', {
            type: 'button',
            className: 'dl-icon-btn dl-icon-btn--sm',
            title: isPooled ? text('section.rss.pull') : text('section.refetch'),
            'aria-label': isPooled ? text('section.rss.pull') : text('section.refetch'),
            disabled: head.refetchDisabled,
            onClick: () => void actions.refreshSection(section),
          }, h(RefreshIcon, { size: 12, className: busy ? 'dl-spin' : undefined }))
        : null,
      head.showTranslate
        ? h('button', {
          type: 'button',
          className: 'dl-btn dl-btn--sm',
          disabled: head.translateDisabled,
          onClick: () => void actions.translateSource(section.source.id),
        }, head.translateLabel)
        : null,
    ),
    head.showError
      ? h('div', { className: 'dl-translate-error', role: 'status' },
        h('span', { className: 'dl-translate-error-label' }, text('section.translationFailed')),
        h('span', { className: 'dl-translate-error-text' }, head.errorMessage),
        h('span', { className: 'dl-translate-error-hint' }, text('section.translationHint')))
      : null,
    isPooled && section.status === 'error'
      ? h('div', { className: 'dl-section-error', role: 'status' },
        h('span', { className: 'dl-section-error-text' }, section.fetch?.error || rssChannel?.error || text('card.failed')),
        h('button', {
          type: 'button',
          className: 'dl-btn dl-btn--sm',
          disabled: busy,
          onClick: () => void actions.refreshSection(section),
        }, busy ? text('section.rss.pulling') : text('section.rss.pullShort')))
      : null,
    h('div', { className: 'dl-rows' },
      showBrief
        ? h(ItemRow, {
          key: `brief:${section.source?.id ?? 'channel'}`,
          fixedRow: briefRowOf(brief, section),
          uiLocale,
          text,
          actions,
        })
        : null,
      emptyState === 'none'
        ? null
        : h(SectionEmpty, {
          kind: emptyState,
          section,
          busy,
          isToday: day === today,
          canBackfill,
          text,
          actions,
        }),
      ...section.items.map(item => h(ItemRow, {
        key: item.id,
        item,
        section,
        deleting: deleting.includes(item.id),
        deleteError: deleteErrors[item.id] ?? '',
        expanded: expanded.has(item.id),
        uiLocale,
        text,
        actions,
        selectMode,
        selected: selected.has(item.id),
      })),
    ),
  );
}

/**
 * The one description slot every row uses. It clamps to three lines, and only
 * when the clamped text actually overflows does it offer 详情 / 收起 in place.
 *
 * A container width change re-renders nothing here, so each measurement also
 * subscribes to the body's own box: a window resize listener would miss the
 * two-column switch, which is decided by the panel's width, not the window's.
 */
function RowDescription({ row, expanded, toggle, text }) {
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef(null);
  const showControl = overflowing || expanded;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, row.description.text, showControl]);

  return [
    h('div', {
      key: 'text',
      ref,
      className: `dl-row-desc${expanded ? ' is-expanded' : ' is-clamped'}`,
      title: row.description.title || undefined,
      lang: row.description.lang,
    }, row.description.text),
    showControl
      ? h('button', {
        key: 'toggle',
        type: 'button',
        className: 'dl-row-more',
        'aria-expanded': expanded,
        onClick: (event) => {
          event.stopPropagation();
          toggle();
        },
      }, text(expanded ? 'row.collapse' : 'row.detail'))
      : null,
  ];
}

/**
 * The row's action icons in one fixed place and order: delete, then mark read,
 * then open. An absent action takes no room.
 */
function RowActions({ row, item, text, actions, deleting }) {
  const buttons = [];
  if (row.actions.delete) {
    buttons.push(h('button', {
      key: 'delete',
      type: 'button',
      className: 'dl-icon-btn dl-icon-btn--danger',
      title: text('x.delete'),
      'aria-label': text('x.delete'),
      disabled: deleting,
      onClick: (event) => {
        event.stopPropagation();
        void actions.deleteBookmark(item);
      },
    }, h(TrashIcon, { size: 13 })));
  }
  if (row.actions.read) {
    buttons.push(h('button', {
      key: 'read',
      type: 'button',
      className: 'dl-icon-btn',
      title: text('row.markRead'),
      'aria-label': text('row.markRead'),
      onClick: (event) => {
        event.stopPropagation();
        void actions.markRead([item.id]);
      },
    }, h(CheckIcon, { size: 13 })));
  }
  if (row.actions.open || row.actions.externalUrl !== '') {
    buttons.push(h('button', {
      key: 'open',
      type: 'button',
      className: 'dl-icon-btn',
      title: text('row.openExternal'),
      'aria-label': text('row.openExternal'),
      onClick: (event) => {
        event.stopPropagation();
        void actions.openExternal(item, row.actions.externalUrl);
      },
    }, h(OpenIcon, { size: 13 })));
  }
  return h('div', { className: 'dl-acts' }, ...buttons);
}

function selectionIntersects(node) {
  const selection = typeof window === 'undefined' ? null : window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return typeof range.intersectsNode === 'function' ? range.intersectsNode(node) : true;
}

function openTitle(event, item, actions) {
  event.preventDefault();
  event.stopPropagation();
  if (selectionIntersects(event.currentTarget)) return;
  void actions.openItem(item, event.currentTarget.href);
}

/**
 * One row, whatever its source: the four slots the card always has are the
 * title, the description, the meta line and the actions; the cover and the
 * attachments are optional. Every branch below asks whether a slot has
 * content, never which source filled it.
 */
function ItemRow({
  item = null,
  section = null,
  deleting = false,
  deleteError = '',
  uiLocale,
  text,
  actions,
  selectMode = false,
  selected = false,
  expanded = false,
  // A channel's leading card arrives already shaped, because it is built from
  // the section rather than from an item; it renders through this same row.
  fixedRow = null,
}) {
  const computed = useMemo(
    () => (fixedRow ? null : rowOf(item, section, { now: new Date(), uiLocale, t: text })),
    [fixedRow, item, section, uiLocale, text],
  );
  const row = fixedRow ?? computed;
  // A built row has no item behind it, so its identity comes from the row.
  const id = item?.id ?? row.id ?? null;
  const classes = ['dl-row'];
  if (row.read) classes.push('is-read');
  if (selectMode) classes.push('is-select');
  if (selected) classes.push('is-selected');
  const titleNode = selectMode || !row.title.url
    ? h('span', { className: 'dl-row-title', title: row.title.text }, row.title.text)
    : h('a', {
      className: 'dl-row-title dl-title-link',
      href: row.title.url,
      title: row.title.text,
      draggable: false,
      onClick: event => openTitle(event, item, actions),
      onAuxClick: event => event.preventDefault(),
    }, row.title.text);
  return h('div', {
    className: classes.join(' '),
    role: selectMode ? 'checkbox' : undefined,
    'aria-checked': selectMode ? selected : undefined,
    tabIndex: selectMode ? 0 : undefined,
    onClick: selectMode ? () => actions.toggleSelect(id) : undefined,
    onKeyDown: selectMode
      ? (event) => {
        // Keys on an inner action belong to that action, not to the row.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          actions.toggleSelect(id);
        }
      }
      : undefined,
  },
    selectMode
      ? h('span', { className: `dl-check${selected ? ' is-on' : ''}`, 'aria-hidden': true },
        selected ? h(CheckIcon, { size: 10 }) : null)
      : h('span', { className: 'dl-unread-dot', 'aria-hidden': true }),
    row.cover === ''
      ? null
      : h(RowCover, {
        initial: row.title.text.trim().charAt(0),
        cover: row.cover,
        video: item?.extra?.kind === 'video',
      }),
    h('div', { className: 'dl-row-body' },
      titleNode,
      row.description.text === ''
        ? null
        : h(RowDescription, {
          row,
          expanded,
          toggle: () => actions.toggleExpanded(id),
          text,
        }),
      row.keywords.length === 0
        ? null
        : h('div', { className: 'dl-row-keywords' },
          ...row.keywords.map((keyword, index) => h('span', {
            key: `${index}:${keyword}`,
            className: 'dl-chip dl-chip--tag',
          }, keyword))),
      row.attachments.length === 0
        ? null
        : h('div', { className: 'dl-row-attachments' },
          ...row.attachments.map((attachment, index) => h('a', {
            key: `${index}:${attachment.url}`,
            className: 'dl-attachment',
            href: attachment.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              window.open(attachment.url, '_blank', 'noopener,noreferrer');
            },
          }, h(OpenIcon, { size: 10 }), h('span', null, attachmentLabel(attachment, text))))),
      // The actions share the meta line when there is one, and stand on the
      // next line beside a meta line that is absent.
      h('div', { className: 'dl-row-foot' },
        row.meta ? h('span', { className: 'dl-row-meta-text', title: row.meta }, row.meta) : null,
        selectMode ? null : h(RowActions, { row, item, text, actions, deleting })),
      deleteError
        ? h('div', { className: 'dl-row-delete-error', role: 'status' },
          h('span', { className: 'dl-row-delete-error-text' }, deleteError),
          h('button', {
            type: 'button',
            className: 'dl-btn dl-btn--ghost dl-btn--sm',
            disabled: deleting,
            onClick: (event) => {
              event.stopPropagation();
              void actions.deleteBookmark(item);
            },
          }, text('section.retry')))
        : null,
    ),
  );
}

function rssChannelLine(channel, text) {
  if (channel.status === 'error') {
    return text('side.rss.error', {
      n: channel.feedCount,
      reason: channel.error || text('card.failed'),
    });
  }
  return text('side.rss.ok', { n: channel.feedCount });
}

function RightRail({ state, text }) {
  const now = new Date();
  const total = state.day?.total ?? 0;
  const read = state.day?.read ?? 0;
  const unread = state.day?.unread ?? 0;
  const percent = percentRead(read, total);
  const offset = total > 0 ? RING_LENGTH * (1 - read / total) : RING_LENGTH;
  const sourceRows = (state.sources?.sources ?? []).filter(source => source.id !== 'rss');
  const rssChannels = (state.sources?.rssChannels ?? []).filter(channel => channel.feedCount > 0);

  return h('aside', { className: 'dl-side' },
    h('div', null,
      h('div', { className: 'dl-side-label' }, text('side.today')),
      h('div', { className: 'dl-ring-wrap' },
        h('div', { className: 'dl-ring' },
          h('svg', { width: 72, height: 72, viewBox: '0 0 72 72', 'aria-hidden': true },
            h('circle', { className: 'dl-ring-track', cx: 36, cy: 36, r: RING_RADIUS, fill: 'none', strokeWidth: 5 }),
            h('circle', {
              className: 'dl-ring-fill',
              cx: 36,
              cy: 36,
              r: RING_RADIUS,
              fill: 'none',
              strokeWidth: 5,
              strokeDasharray: RING_LENGTH,
              strokeDashoffset: offset,
            }),
          ),
          h('div', { className: 'dl-ring-label' }, `${percent}%`),
        ),
        h('div', { className: 'dl-ring-note' },
          h('b', { className: 'dl-ring-total' }, String(total)),
          h('span', { className: 'dl-ring-sub' }, text('side.summary', { unread })),
        ),
      ),
    ),
    h('div', null,
      h('div', { className: 'dl-side-label' }, text('side.sources')),
      ...sourceRows.map(source => h('div', { key: source.id, className: 'dl-side-source' },
        h('span', { className: `dl-ch-dot dl-status-dot ${dotClass(source.status)}` }),
        h('span', { className: 'dl-side-name' }, channelName(source, text)),
        h('span', { className: 'dl-side-time' },
          source.lastSuccessAt ? formatRelativeTime(source.lastSuccessAt, now, text) : text('time.none')),
      )),
      ...rssChannels.map(channel => h('div', { key: channel.id, className: 'dl-side-source' },
        h('span', { className: `dl-ch-dot dl-status-dot ${dotClass(channel.status)}` }),
        h('span', { className: 'dl-side-name' }, channel.name),
        h('span', { className: 'dl-side-time' }, rssChannelLine(channel, text)),
      )),
    ),
  );
}

function StateBody({ title, sub, actions }) {
  return h('div', { className: 'dl-state' },
    h('h3', { className: 'dl-state-title' }, title),
    sub ? h('p', { className: 'dl-state-sub' }, sub) : null,
    actions && actions.length > 0
      ? h('div', { className: 'dl-state-actions' }, ...actions)
      : null,
  );
}

function readScheme(ctx) {
  try {
    return ctx.theme.getTheme().active.colorScheme === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * The panel follows only the host's resolved light/dark choice, never its
 * custom theme tokens.
 */
function useColorScheme(ctx) {
  const [scheme, setScheme] = useState(() => readScheme(ctx));
  useEffect(() => {
    const dispose = ctx.on('theme/change', (snapshot) => {
      setScheme(snapshot?.active?.colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, [ctx]);
  return scheme;
}

function readUiLocale(ctx) {
  try {
    const locale = ctx.locale.getLocale();
    return typeof locale?.active === 'string' ? locale.active : '';
  } catch {
    return '';
  }
}

/**
 * The active UI locale decides whether a translated description renders.
 * `bind()` carries text only, so the locale tag comes from the service and a
 * subscription re-renders rows on a language switch without a reload.
 */
function useUiLocale(ctx) {
  const [locale, setLocale] = useState(() => readUiLocale(ctx));
  useEffect(() => {
    const sync = () => setLocale(readUiLocale(ctx));
    sync();
    let dispose;
    try {
      dispose = ctx.locale.subscribe(sync);
    } catch {
      dispose = undefined;
    }
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, [ctx]);
  return locale;
}

export function FeedUltraPanel({ ctx, api, text, ensureSettings, readingMemory }) {
  const { state, binding, actions, modelPort, loadChannels } = usePanelData(ctx, api, text, readingMemory);
  const scheme = useColorScheme(ctx);
  const uiLocale = useUiLocale(ctx);
  const bodyRef = useRef(null);
  const rssPort = useMemo(() => ({
    library: () => api.rssLibrary(),
    mutate: batch => api.rssLibraryMutate(batch),
    preview: url => api.rssPreview(url),
  }), [api]);
  const workspacePath = state.status?.workspace?.path ?? '';
  const readingKey = readingScrollKey({
    workspacePath,
    day: state.date,
    channel: state.channel,
    filter: state.filter,
  });

  useLayoutEffect(() => {
    if (state.phase !== 'ready') return;
    readingMemory.rememberSelection({
      workspacePath,
      channel: state.channel,
      filter: state.filter,
      day: state.date,
      today: state.today,
    });
  }, [state.phase, workspacePath, state.channel, state.filter, state.date, state.today, readingMemory]);

  useLayoutEffect(() => {
    if (state.view !== 'today' || state.phase !== 'ready') return undefined;
    const body = bodyRef.current;
    if (!body) return undefined;
    const target = readingMemory.readScroll(readingKey);
    const apply = () => {
      body.scrollTop = target;
    };
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [state.view, state.phase, readingKey, readingMemory]);

  useEffect(() => {
    if (!state.selectMode) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') actions.cancelSelect();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.selectMode, actions]);

  if (state.view === 'settings') {
    return h('div', { className: 'dl-root', 'data-dl-scheme': scheme },
      h(SettingsView, {
        text,
        ensureSettings,
        workspace: state.status?.workspace ?? null,
        chooseWorkspace: actions.chooseWorkspace,
        pane: state.settingsPane,
        onSelectPane: actions.selectSettingsPane,
        onBackToday: actions.openToday,
        modelPort,
        rssPort,
        loadChannels,
      }),
    );
  }

  if (state.phase === 'loading') {
    return h('div', { className: 'dl-root dl-root--single', 'data-dl-scheme': scheme },
      h('div', { className: 'dl-state dl-state--center' },
        h('p', { className: 'dl-state-sub' }, text('state.loading')),
      ),
    );
  }

  if (state.phase === 'guide') {
    return h('div', { className: 'dl-root dl-root--single', 'data-dl-scheme': scheme },
      h(StateBody, {
        title: text('state.guide.title'),
        sub: state.guide === 'invalid' ? text('state.guide.invalid') : text('state.guide.unbound'),
        actions: [h('button', {
          key: 'pick',
          type: 'button',
          className: 'dl-btn dl-btn--primary',
          disabled: binding,
          onClick: () => void actions.bindWorkspace(),
        }, text('state.guide.pick'))],
      }),
    );
  }

  if (state.phase === 'error') {
    return h('div', { className: 'dl-root dl-root--single', 'data-dl-scheme': scheme },
      h(StateBody, {
        title: text('state.error.title'),
        sub: state.error,
        actions: [h('button', {
          key: 'retry',
          type: 'button',
          className: 'dl-btn dl-btn--primary',
          onClick: () => void actions.retry(),
        }, text('state.error.retry'))],
      }),
    );
  }

  const sections = state.channel === 'all'
    ? state.day?.sections ?? []
    : (state.day?.sections ?? []).filter(section => sectionKey(section) === state.channel);
  const items = itemsForChannel(state.day?.sections ?? [], state.channel);
  const total = items.length;
  const unread = unreadCount(items);
  const filtered = filterItems(items, state.filter);
  const errorOf = (section) => state.fetchErrors[sectionKey(section)]
    ?? state.fetchErrors[section.source.id]
    ?? '';
  const translateErrorOfSection = (section) => {
    const entry = state.translateErrors[sectionKey(section)] ?? state.translateErrors[section.source.id];
    return entry?.day === state.date ? entry.message : '';
  };
  const busyOf = (section) => state.busy.includes(sectionKey(section)) || state.busy.includes(section.source.id);
  const translatingOf = (section) => state.translating.includes(sectionKey(section))
    || state.translating.includes(section.source.id);
  const rssChannelOf = (section) => (state.sources?.rssChannels ?? [])
    .find(channel => channel.id === section.channelId) ?? null;
  const visibleSections = sections
    .map(section => ({ ...section, items: filterItems(section.items, state.filter) }))
    .filter(section => sectionVisible(section, errorOf(section)));
  const hasErrorCards = visibleSections.some(section =>
    section.status === 'error' || section.status === 'corrupt' || Boolean(errorOf(section)));
  const hasSectionEmpty = visibleSections.some(section => sectionEmptyState(section) !== 'none');

  let body = null;
  if (!state.day) {
    body = state.dayError
      ? h(StateBody, {
        title: text('state.error.title'),
        sub: state.dayError,
        actions: [h('button', {
          key: 'retry',
          type: 'button',
          className: 'dl-btn dl-btn--primary',
          onClick: actions.retryDay,
        }, text('state.error.retry'))],
      })
      : h('div', { className: 'dl-state dl-state--center' },
        h('p', { className: 'dl-state-sub' }, text('state.loading')));
  } else if (state.filter === 'unread'
    && filtered.length === 0
    && state.day.total > 0
    && !hasErrorCards
    && !hasSectionEmpty) {
    const isToday = state.date === state.today;
    body = h(StateBody, {
      title: isToday ? text('empty.unread.title') : text('empty.unread.pastTitle'),
      sub: text('empty.unread.sub'),
    });
  } else if (visibleSections.length === 0) {
    const isToday = state.date === state.today;
    body = isToday
      ? h(StateBody, {
        title: text('state.today.title'),
        sub: text('state.today.sub'),
        actions: [h('button', {
          key: 'fetch',
          type: 'button',
          className: 'dl-btn dl-btn--primary',
          disabled: state.busy.length > 0,
          onClick: () => void actions.fetchAll(),
        }, text('state.fetch'))],
      })
      : h(StateBody, {
        title: text('state.past.title'),
        sub: text('state.past.sub'),
        actions: [h('button', {
          key: 'today',
          type: 'button',
          className: 'dl-btn',
          onClick: actions.goToday,
        }, text('state.backToday'))],
      });
  } else {
    body = h('div', null,
      state.dayError
        ? h('div', { className: 'dl-inline-error' },
          h('span', { className: 'dl-inline-error-text' }, state.dayError),
          h('button', {
            type: 'button',
            className: 'dl-btn dl-btn--ghost',
            onClick: actions.retryDay,
          }, text('state.error.retry')),
        )
        : null,
      ...visibleSections.map((section, index) => h(SectionCard, {
        key: sectionKey(section),
        section,
        index,
        busy: busyOf(section),
        translating: translatingOf(section),
        sourceStatus: (state.sources?.sources ?? []).find(entry => entry.id === section.source.id) ?? null,
        rssChannel: rssChannelOf(section),
        fetchError: errorOf(section),
        translateError: translateErrorOfSection(section),
        day: state.date,
        today: state.today,
        uiLocale,
        text,
        actions,
        selectMode: state.selectMode,
        selected: state.selected,
        deleting: state.deleting,
        deleteErrors: state.deleteErrors,
        expanded: state.expanded,
      })),
    );
  }

  return h('div', { className: 'dl-root', 'data-dl-scheme': scheme },
    h(LeftRail, { state, text, actions }),
    h('main', { className: 'dl-main' },
      h(Topbar, { state, text, counts: { total, unread }, actions }),
      h(Filters, { state, unread, text, actions }),
      h('div', {
        className: 'dl-body',
        ref: bodyRef,
        onScroll: event => readingMemory.rememberScroll(readingKey, event.currentTarget.scrollTop),
      }, body),
    ),
    h(RightRail, { state, text }),
  );
}
