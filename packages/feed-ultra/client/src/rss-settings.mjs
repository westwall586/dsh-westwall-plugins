/**
 * The RSS settings page: one workspace-scoped library on the left, the
 * selected collection's feeds on the right, and the pool's schedule at the
 * bottom of the left column. It talks to the host through the port the panel
 * hands it, never through the feedUltra RPC directly.
 */

import { createElement, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { popoverPosition } from './settings-model.mjs';
import {
  EMPTY_LIBRARY_VIEW,
  MAX_CHANNEL_NAME,
  channelIdsAfterMove,
  channelNameProblem,
  clampPage,
  collectionFeeds,
  feedHost,
  feedLabel,
  nextCollection,
  normalizeFeedInput,
  ops,
  pageForUrl,
  paginate,
  swappedChannelIds,
  visibleFeeds,
} from './rss-model.mjs';

const h = createElement;
const NOTICE_MS = 2400;
const MAX_OPML_BYTES = 2_000_000;
const PREVIEW_TTL_MS = 5 * 60_000;
const PREVIEW_SKELETONS = 3;

const initialState = {
  phase: 'loading',
  view: null,
  error: '',
  notice: '',
  busy: false,
  selected: 'inbox',
  query: '',
  page: 1,
  editing: null,
  confirm: null,
  picker: null,
  naming: null,
  preview: null,
};

function messageOf(error, text) {
  return error && typeof error.message === 'string' && error.message ? error.message : text('error.unknown');
}

function openInBrowser(event, url) {
  event.preventDefault();
  window.open(url, '_blank', 'noopener,noreferrer');
}

function clockOf(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function reducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...state, phase: 'loading', error: '' };
    case 'ready':
      return { ...state, phase: 'ready', view: action.view, error: '' };
    case 'failed':
      return { ...state, phase: 'error', error: action.error };
    case 'select':
      return {
        ...state,
        selected: action.selected,
        page: 1,
        editing: null,
        confirm: null,
        picker: null,
        naming: null,
      };
    case 'query':
      return { ...state, query: action.query, page: 1 };
    case 'page':
      return { ...state, page: action.page };
    case 'editing':
      return { ...state, editing: action.editing };
    case 'editing-value':
      return { ...state, editing: { ...state.editing, value: action.value } };
    case 'confirm':
      return { ...state, confirm: action.confirm, picker: null };
    case 'picker':
      return { ...state, picker: action.picker, confirm: null };
    case 'preview-open':
      return {
        ...state,
        preview: {
          url: action.url,
          feedName: action.feedName,
          status: action.cached ? 'ok' : 'loading',
          data: action.cached ?? null,
          error: '',
        },
      };
    case 'preview-result':
      if (state.preview === null || state.preview.url !== action.url) return state;
      return {
        ...state,
        preview: {
          ...state.preview,
          status: action.status,
          data: action.data,
          error: action.error,
        },
      };
    case 'preview-close':
      return { ...state, preview: null };
    case 'naming':
      return { ...state, naming: action.naming, picker: null, confirm: null };
    case 'naming-value':
      return { ...state, naming: { ...state.naming, value: action.value } };
    case 'busy':
      return { ...state, busy: action.busy };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'error':
      return { ...state, error: action.error };
    case 'applied':
      return {
        ...state,
        phase: 'ready',
        view: action.view,
        busy: false,
        error: '',
        editing: null,
        confirm: null,
        picker: null,
        naming: null,
        selected: action.selected ?? state.selected,
        page: action.page ?? state.page,
      };
    default:
      return state;
  }
}

function StatusDot({ tone }) {
  const className = tone === 'ok' ? 'dl-dot--ok' : tone === 'error' ? 'dl-dot--warn' : 'dl-dot--idle';
  return h('span', { className: `dl-status-dot ${className}`, 'aria-hidden': true });
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

function Switch({ checked, disabled, label, onChange }) {
  return h('button', {
    type: 'button',
    className: 'dl-switch',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': label,
    disabled,
    onClick: () => onChange(!checked),
  }, h('i', { 'aria-hidden': true }));
}

function PencilIcon() {
  return h('svg', {
    viewBox: '0 0 16 16',
    width: 12,
    height: 12,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.4,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': true,
  }, h('path', { d: 'M10.5 3.5 12.5 5.5 6 12H4v-2z' }), h('path', { d: 'M9.2 4.8l2 2' }));
}

function TrashIcon() {
  return h('svg', {
    viewBox: '0 0 16 16',
    width: 12,
    height: 12,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.4,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': true,
  }, h('path', { d: 'M3.5 5h9M6.5 5V3.8h3V5M5 5l.6 7.2h4.8L11 5' }));
}

function PlusIcon() {
  return h('svg', {
    viewBox: '0 0 16 16',
    width: 11,
    height: 11,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'aria-hidden': true,
  }, h('path', { d: 'M8 3.5v9M3.5 8h9' }));
}

function SearchIcon() {
  return h('svg', {
    viewBox: '0 0 16 16',
    width: 12,
    height: 12,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.5,
    'stroke-linecap': 'round',
    'aria-hidden': true,
  }, h('circle', { cx: 7, cy: 7, r: 4 }), h('path', { d: 'M10 10l3 3' }));
}

export function RssPane({ text, port, channel, statuses, locked, actions }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const noticeTimer = useRef(null);
  const fileRef = useRef(null);
  const dragId = useRef('');
  const previewCache = useRef(new Map());
  const previewSeq = useRef(0);
  const [draftUrl, setDraftUrl] = useState('');

  const flash = useCallback((message) => {
    dispatch({ type: 'notice', notice: message });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => dispatch({ type: 'notice', notice: '' }), NOTICE_MS);
  }, []);

  const closePreview = useCallback(() => {
    previewSeq.current += 1;
    dispatch({ type: 'preview-close' });
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (state.preview === null) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.preview === null, closePreview]);

  const reload = useCallback(async () => {
    dispatch({ type: 'loading' });
    try {
      dispatch({ type: 'ready', view: await port.library() });
    } catch (error) {
      dispatch({ type: 'failed', error: messageOf(error, text) });
    }
  }, [port, text]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(async (batch, options = {}) => {
    const current = stateRef.current;
    if (current.busy && options.force !== true) return null;
    dispatch({ type: 'busy', busy: true });
    dispatch({ type: 'error', error: '' });
    try {
      const view = await port.mutate(batch);
      const selected = options.select ?? nextCollection(view, current.selected);
      const page = options.pageFor ? options.pageFor(view) : undefined;
      dispatch({ type: 'applied', view, selected, ...(page === undefined ? {} : { page }) });
      if (options.notice) flash(options.notice);
      return view;
    } catch (error) {
      dispatch({ type: 'busy', busy: false });
      dispatch({ type: 'error', error: messageOf(error, text) });
      return null;
    }
  }, [flash, port, text]);

  const cachedPreview = (url) => {
    const entry = previewCache.current.get(url);
    if (!entry) return null;
    return Date.now() - entry.at < PREVIEW_TTL_MS ? entry.data : null;
  };

  const loadPreview = async (url, seq) => {
    let result;
    try {
      result = await port.preview(url);
    } catch (error) {
      if (previewSeq.current !== seq) return;
      dispatch({
        type: 'preview-result',
        url,
        status: 'error',
        data: null,
        error: messageOf(error, text),
      });
      return;
    }
    if (previewSeq.current !== seq) return;
    if (result?.ok === true) {
      previewCache.current.set(url, { at: Date.now(), data: result });
      dispatch({ type: 'preview-result', url, status: 'ok', data: result, error: '' });
      return;
    }
    dispatch({
      type: 'preview-result',
      url,
      status: 'error',
      data: result ?? null,
      error: typeof result?.error === 'string' && result.error !== ''
        ? result.error
        : text('settings.rss.preview.failed'),
    });
  };

  const openPreview = (feed) => {
    if (locked) return;
    const url = feed.url;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    const cached = cachedPreview(url);
    dispatch({ type: 'preview-open', url, feedName: feedLabel(feed), cached });
    if (cached === null) void loadPreview(url, seq);
  };

  const retryPreview = () => {
    const preview = stateRef.current.preview;
    if (preview === null) return;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    dispatch({ type: 'preview-open', url: preview.url, feedName: preview.feedName, cached: null });
    void loadPreview(preview.url, seq);
  };

  const view = state.view ?? EMPTY_LIBRARY_VIEW;
  const channels = Array.isArray(view.channels) ? view.channels : [];
  const selected = state.selected;
  const selectedChannel = channels.find(entry => entry.id === selected) ?? null;
  const selectedLabel = selected === 'inbox'
    ? text('settings.rss.inbox')
    : (selectedChannel?.name ?? text('settings.rss.inbox'));
  const feeds = visibleFeeds(view, selected, state.query);
  const page = paginate(feeds, state.page);
  const totalInCollection = collectionFeeds(view, selected).length;
  const inboxCount = view.counts?.inbox ?? 0;
  const statusById = new Map((statuses ?? []).map(entry => [entry?.id, entry]));

  const toneOf = (id) => {
    const status = statusById.get(id)?.status;
    return status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'idle';
  };

  const saveDraft = () => {
    const url = normalizeFeedInput(draftUrl);
    if (url === null) {
      dispatch({ type: 'error', error: text('settings.rss.add.invalid') });
      return;
    }
    if (view.feeds.some(feed => feed.url === url)) {
      dispatch({ type: 'error', error: text('settings.rss.add.exists') });
      return;
    }
    void run([ops.addFeed(url, selected)], {
      select: selected,
      pageFor: next => pageForUrl(visibleFeeds(next, selected, stateRef.current.query), url),
      notice: text('settings.saved'),
    }).then(result => {
      if (result !== null) setDraftUrl('');
    });
  };

  const startEdit = (feed) => {
    if (locked) return;
    dispatch({ type: 'editing', editing: { url: feed.url, value: feed.note } });
  };

  const commitNote = (feed) => {
    const editing = stateRef.current.editing;
    if (editing === null || editing.url !== feed.url) return;
    const value = editing.value.trim();
    dispatch({ type: 'editing', editing: null });
    if (value === feed.note) return;
    void run([ops.setNote(feed.url, value)], { select: stateRef.current.selected });
  };

  const confirmDeleteFeed = (feed) => {
    void run([ops.removeFeed(feed.url)], {
      select: nextCollection(view, stateRef.current.selected),
      notice: text('settings.saved'),
    });
  };

  const openPicker = (event, feed) => {
    if (locked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const position = popoverPosition(
      rect,
      { width: 248, height: 260 },
      { width: window.innerWidth, height: window.innerHeight },
    );
    dispatch({ type: 'picker', picker: { url: feed.url, top: position.top, right: position.right } });
  };

  const moveTo = (collection) => {
    const picker = stateRef.current.picker;
    if (picker === null) return;
    void run([ops.moveFeed(picker.url, collection)], { select: stateRef.current.selected });
  };

  const startRename = (entry) => {
    if (locked) return;
    dispatch({ type: 'naming', naming: { mode: 'rename', id: entry.id, value: entry.name } });
  };

  const startNewChannel = (moveUrl) => {
    if (locked) return;
    dispatch({ type: 'naming', naming: { mode: 'new', value: '', moveUrl } });
  };

  const namingProblem = () => {
    const naming = stateRef.current.naming;
    if (naming === null) return '';
    return channelNameProblem(naming.value, channels, naming.mode === 'rename' ? naming.id : '');
  };

  const commitNaming = async () => {
    const naming = stateRef.current.naming;
    if (naming === null || stateRef.current.busy) return;
    const problem = namingProblem();
    if (problem !== '') {
      dispatch({
        type: 'error',
        error: text(problem === 'duplicate'
          ? 'settings.rss.channel.duplicate'
          : problem === 'long'
            ? 'settings.rss.channel.tooLong'
            : 'settings.rss.channel.empty'),
      });
      return;
    }
    const name = naming.value.trim();
    if (naming.mode === 'rename') {
      await run([ops.renameChannel(naming.id, name)], { select: stateRef.current.selected });
      return;
    }
    const result = await run([ops.addChannel(name)], { select: stateRef.current.selected });
    const created = result?.channels?.[result.channels.length - 1];
    if (created === undefined) return;
    if (naming.moveUrl) {
      await run([ops.moveFeed(naming.moveUrl, created.id)], { select: created.id, force: true });
    } else {
      dispatch({ type: 'select', selected: created.id });
    }
  };

  const removeChannel = (entry) => {
    void run([ops.removeChannel(entry.id)], {
      select: nextCollection(view, entry.id),
      notice: text('settings.saved'),
    });
  };

  const reorderTo = (targetId) => {
    const ids = channelIdsAfterMove(channels, dragId.current, targetId);
    if (ids === null) return;
    void run([ops.reorderChannels(ids)], { select: stateRef.current.selected });
  };

  const reorderBy = (event, entry, delta) => {
    if (!event.altKey) return;
    event.preventDefault();
    const ids = swappedChannelIds(channels, entry.id, delta);
    if (ids === null) return;
    void run([ops.reorderChannels(ids)], { select: stateRef.current.selected });
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_OPML_BYTES) {
      dispatch({ type: 'error', error: text('settings.rss.import.tooLarge') });
      return;
    }
    let raw;
    try {
      raw = await file.text();
    } catch {
      dispatch({ type: 'error', error: text('settings.rss.import.unreadable') });
      return;
    }
    const result = await run([ops.importOpml(raw)], { select: 'inbox' });
    if (result?.lastImport) {
      flash(text('settings.rss.import.done', {
        added: result.lastImport.added,
        skipped: result.lastImport.skipped,
      }));
    }
  };

  const pageNumbers = () => {
    const start = Math.max(1, page.page - 2);
    const end = Math.min(page.pages, start + 4);
    const numbers = [];
    for (let index = start; index <= end; index += 1) numbers.push(index);
    return numbers;
  };

  const rowActions = (feed) => {
    const confirming = state.confirm?.kind === 'feed' && state.confirm.url === feed.url;
    if (confirming) {
      return h('div', { className: 'dl-rss-row-actions' },
        h('button', {
          type: 'button',
          className: 'dl-rss-danger',
          disabled: state.busy,
          onClick: () => confirmDeleteFeed(feed),
        }, text('settings.rss.confirm.delete')),
        h('button', {
          type: 'button',
          className: 'dl-rss-link',
          onClick: () => dispatch({ type: 'confirm', confirm: null }),
        }, text('settings.rss.confirm.cancel')),
      );
    }
    const isInbox = selected === 'inbox';
    return h('div', { className: 'dl-rss-row-actions' },
      h('button', {
        type: 'button',
        className: 'dl-rss-link dl-rss-preview',
        disabled: locked,
        onClick: () => openPreview(feed),
      }, text('settings.rss.row.preview')),
      h('button', {
        type: 'button',
        className: 'dl-rss-pick',
        disabled: locked,
        'aria-expanded': state.picker?.url === feed.url,
        onClick: event => openPicker(event, feed),
      }, isInbox ? text('settings.rss.row.file') : text('settings.rss.row.move')),
      isInbox
        ? h('button', {
          type: 'button',
          className: 'dl-rss-danger',
          disabled: locked,
          onClick: () => dispatch({ type: 'confirm', confirm: { kind: 'feed', url: feed.url } }),
        }, text('settings.rss.row.delete'))
        : null,
    );
  };

  const feedRow = (feed) => {
    const editing = state.editing?.url === feed.url;
    return h('div', { key: feed.url, className: 'dl-rss-row' },
      h('div', { className: 'dl-rss-name' },
        h(StatusDot, { tone: 'idle' }),
        h('span', { className: 'dl-rss-name-text' },
          h('span', { className: 'dl-rss-name-main' }, feedLabel(feed)),
          h('span', { className: 'dl-rss-name-host' }, feedHost(feed.url) || feed.url),
        ),
      ),
      h('div', { className: 'dl-rss-note' },
        editing
          ? h('input', {
            type: 'text',
            className: 'dl-rss-note-input',
            value: state.editing.value,
            'aria-label': text('settings.rss.note.label', { name: feedLabel(feed) }),
            maxLength: 200,
            autoFocus: true,
            disabled: state.busy,
            onChange: event => dispatch({ type: 'editing-value', value: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter') commitNote(feed);
              if (event.key === 'Escape') dispatch({ type: 'editing', editing: null });
            },
            onBlur: () => commitNote(feed),
          })
          : h('button', {
            type: 'button',
            className: `dl-rss-note-text${feed.note === '' ? ' is-empty' : ''}`,
            disabled: locked,
            onClick: () => startEdit(feed),
          }, feed.note === '' ? text('settings.rss.note.add') : feed.note),
      ),
      rowActions(feed),
    );
  };

  const channelRow = (entry) => {
    const renaming = state.naming?.mode === 'rename' && state.naming.id === entry.id;
    const confirming = state.confirm?.kind === 'channel' && state.confirm.id === entry.id;
    const active = selected === entry.id;
    return h('div', {
      key: entry.id,
      className: 'dl-rss-channel',
      draggable: !locked && !renaming,
      onDragStart: () => {
        dragId.current = entry.id;
      },
      onDragOver: event => event.preventDefault(),
      onDrop: event => {
        event.preventDefault();
        reorderTo(entry.id);
      },
    },
      h('button', {
        type: 'button',
        className: 'dl-rss-drag',
        'aria-label': text('settings.rss.channel.move', { name: entry.name }),
        disabled: locked,
        onKeyDown: event => reorderBy(event, entry, event.key === 'ArrowUp' ? -1 : 1),
      }, '⠿'),
      h(StatusDot, { tone: toneOf(entry.id) }),
      renaming
        ? h('input', {
          type: 'text',
          className: 'dl-rss-channel-input',
          value: state.naming.value,
          maxLength: MAX_CHANNEL_NAME,
          autoFocus: true,
          disabled: state.busy,
          onChange: event => dispatch({ type: 'naming-value', value: event.target.value }),
          onKeyDown: (event) => {
            if (event.key === 'Enter') void commitNaming();
            if (event.key === 'Escape') dispatch({ type: 'naming', naming: null });
          },
        })
        : h('button', {
          type: 'button',
          className: 'dl-rss-channel-name',
          'aria-pressed': active,
          onClick: () => dispatch({ type: 'select', selected: entry.id }),
        }, entry.name),
      h('span', { className: 'dl-rss-channel-count' }, String(collectionFeeds(view, entry.id).length)),
      h('div', { className: 'dl-rss-channel-actions' },
        renaming
          ? h('button', {
            type: 'button',
            className: 'dl-rss-icon',
            'aria-label': text('settings.rss.channel.save'),
            disabled: state.busy,
            onClick: () => void commitNaming(),
          }, h(PencilIcon))
          : h('button', {
            type: 'button',
            className: 'dl-rss-icon',
            'aria-label': text('settings.rss.channel.rename', { name: entry.name }),
            disabled: locked,
            onClick: () => startRename(entry),
          }, h(PencilIcon)),
        confirming
          ? h('span', { className: 'dl-rss-confirm' },
            h('button', {
              type: 'button',
              className: 'dl-rss-danger',
              disabled: state.busy,
              onClick: () => removeChannel(entry),
            }, text('settings.rss.confirm.delete')),
            h('button', {
              type: 'button',
              className: 'dl-rss-link',
              onClick: () => dispatch({ type: 'confirm', confirm: null }),
            }, text('settings.rss.confirm.cancel')),
          )
          : h('button', {
            type: 'button',
            className: 'dl-rss-icon',
            'aria-label': text('settings.rss.channel.remove', { name: entry.name }),
            disabled: locked,
            onClick: () => dispatch({ type: 'confirm', confirm: { kind: 'channel', id: entry.id } }),
          }, h(TrashIcon)),
      ),
    );
  };

  const picker = state.picker === null ? null : h('div', null,
    h('div', { className: 'dl-rss-popover-backdrop', onClick: () => dispatch({ type: 'picker', picker: null }) }),
    h('div', {
      className: 'dl-rss-popover',
      role: 'menu',
      'aria-label': text('settings.rss.picker.title'),
      style: { top: `${state.picker.top}px`, right: `${state.picker.right}px` },
    },
      h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dl-rss-pop-item',
        disabled: selected === 'inbox',
        onClick: () => moveTo('inbox'),
      },
        h(StatusDot, { tone: 'idle' }),
        h('span', { className: 'dl-rss-pop-name' }, text('settings.rss.inbox')),
        selected === 'inbox' ? h('span', { className: 'dl-rss-pop-current' }, text('settings.rss.picker.current')) : null,
      ),
      channels.length > 0 ? h('div', { className: 'dl-rss-pop-sep' }) : null,
      ...channels.map(entry => h('button', {
        key: entry.id,
        type: 'button',
        role: 'menuitem',
        className: 'dl-rss-pop-item',
        disabled: selected === entry.id,
        onClick: () => moveTo(entry.id),
      },
        h(StatusDot, { tone: toneOf(entry.id) }),
        h('span', { className: 'dl-rss-pop-name' }, entry.name),
        h('span', { className: 'dl-rss-pop-count' }, String(collectionFeeds(view, entry.id).length)),
      )),
      h('div', { className: 'dl-rss-pop-sep' }),
      h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'dl-rss-pop-new',
        onClick: () => startNewChannel(state.picker.url),
      }, h(PlusIcon), text('settings.rss.channel.new')),
    ),
  );

  const emptyText = selected === 'inbox'
    ? text('settings.rss.empty.inbox')
    : text('settings.rss.empty.channel');

  const preview = state.preview;
  const previewFeed = preview === null
    ? null
    : (view.feeds.find(entry => entry.url === preview.url) ?? { url: preview.url, name: preview.feedName });
  const previewItems = Array.isArray(preview?.data?.items) ? preview.data.items : [];
  const previewName = preview === null
    ? ''
    : (typeof preview.data?.name === 'string' && preview.data.name.trim() !== ''
      ? preview.data.name.trim()
      : preview.feedName);
  const previewTitle = typeof preview?.data?.title === 'string' ? preview.data.title.trim() : '';

  const previewItemRow = (item, index) => h('div', {
    key: `${index}:${item.url}`,
    className: 'dl-preview-item',
  },
    h('div', { className: 'dl-preview-item-head' },
      h('a', {
        className: 'dl-preview-item-title',
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: event => openInBrowser(event, item.url),
      }, item.title || item.url),
      h('a', {
        className: 'dl-preview-open',
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: event => openInBrowser(event, item.url),
      }, text('settings.rss.preview.open')),
    ),
    item.description ? h('p', { className: 'dl-preview-item-desc' }, item.description) : null,
    h('p', { className: 'dl-preview-item-meta' },
      [feedLabel(previewFeed), clockOf(item.publishedAt)].filter(Boolean).join(' \u00b7 ')),
  );

  let previewBody = null;
  if (preview !== null && preview.status === 'loading') {
    previewBody = h('div', { className: 'dl-preview-loading', role: 'status' },
      h('p', { className: 'dl-preview-loading-text' }, text('settings.rss.preview.loading')),
      ...Array.from({ length: PREVIEW_SKELETONS }, (_, index) => h('div', {
        key: index,
        className: 'dl-preview-skeleton',
      },
        h('div', { className: 'dl-preview-skeleton-bar dl-preview-skeleton-bar--title' }),
        h('div', { className: 'dl-preview-skeleton-bar dl-preview-skeleton-bar--desc' }),
        h('div', { className: 'dl-preview-skeleton-bar dl-preview-skeleton-bar--meta' }),
      )),
    );
  } else if (preview !== null && preview.status === 'error') {
    previewBody = h('div', { className: 'dl-preview-state' },
      h('p', { className: 'dl-preview-state-title' }, text('settings.rss.preview.failed')),
      h('p', { className: 'dl-preview-state-text' }, preview.error),
      h('button', {
        type: 'button',
        className: 'dl-btn dl-btn--primary dl-btn--sm',
        onClick: retryPreview,
      }, text('settings.rss.preview.retry')),
    );
  } else if (preview !== null) {
    previewBody = h('div', { className: 'dl-preview-results' },
      preview.data?.truncated === true
        ? h('p', { className: 'dl-preview-truncated' }, text('settings.rss.preview.truncated', {
          total: Number(preview.data.scanned) || 0,
          shown: previewItems.length,
        }))
        : null,
      previewItems.length === 0
        ? h('p', { className: 'dl-preview-empty' }, text('settings.rss.preview.empty'))
        : h('div', { className: 'dl-preview-list' }, ...previewItems.map(previewItemRow)),
    );
  }

  const previewModal = preview === null ? null : h('div', {
    className: 'dl-modal-overlay',
    role: 'presentation',
    onClick: closePreview,
  },
    h('div', {
      className: 'dl-modal dl-preview-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'dl-preview-title',
      onClick: event => event.stopPropagation(),
    },
      h('div', { className: 'dl-preview-head' },
        h('div', { className: 'dl-preview-heading' },
          h('h3', { id: 'dl-preview-title', className: 'dl-preview-title' }, previewName),
          previewTitle !== '' && previewTitle !== previewName
            ? h('p', { className: 'dl-preview-subtitle' }, previewTitle)
            : null,
          h('p', { className: 'dl-preview-host' }, feedHost(preview.url)),
        ),
        h('div', { className: 'dl-preview-head-side' },
          preview.status === 'ok'
            ? h('span', { className: 'dl-preview-count' },
              text('settings.rss.preview.count', { n: previewItems.length }))
            : null,
          h('button', {
            type: 'button',
            className: 'dl-preview-close',
            'aria-label': text('settings.rss.preview.close'),
            onClick: closePreview,
          }, '\u00d7'),
        ),
      ),
      h('div', { className: 'dl-preview-body' }, previewBody),
      h('p', { className: 'dl-preview-note' }, text('settings.rss.preview.note')),
    ),
  );

  return h('div', { className: 'dl-rss' },
    h('div', { className: 'dl-rss-head' },
      h('button', {
        type: 'button',
        className: 'dl-btn',
        disabled: locked || state.busy,
        onClick: () => fileRef.current?.click(),
      }, text('settings.rss.import')),
      h('input', {
        ref: fileRef,
        type: 'file',
        accept: '.opml,.xml',
        className: 'dl-rss-file',
        onChange: event => void importFile(event),
      }),
    ),

    h('div', { className: 'dl-rss-add' },
      h('span', { className: 'dl-rss-add-icon', 'aria-hidden': true }, '◔'),
      h('input', {
        type: 'url',
        className: 'dl-rss-add-input',
        placeholder: text('settings.rss.add.placeholder'),
        'aria-label': text('settings.rss.add.label'),
        value: draftUrl,
        disabled: locked || state.busy,
        onChange: event => setDraftUrl(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') saveDraft();
        },
      }),
      h('span', { className: 'dl-rss-add-target' },
        selected === 'inbox'
          ? text('settings.rss.add.toInbox')
          : text('settings.rss.add.toChannel', { name: selectedChannel?.name ?? '' })),
      h('button', {
        type: 'button',
        className: 'dl-btn dl-btn--primary',
        disabled: locked || state.busy || draftUrl.trim() === '',
        onClick: saveDraft,
      }, text('settings.rss.add.save')),
    ),

    state.error !== '' ? h('div', { className: 'dl-inline-error', role: 'status' },
      h('span', { className: 'dl-inline-error-text' }, state.error)) : null,
    state.notice !== '' ? h('div', { className: 'dl-rss-notice', role: 'status' }, state.notice) : null,

    h('div', { className: 'dl-rss-split' },
      h('aside', { className: 'dl-rss-side' },
        h('div', { className: 'dl-rss-side-label' }, text('settings.rss.channels')),
        h('button', {
          type: 'button',
          className: 'dl-rss-inbox',
          'aria-pressed': selected === 'inbox',
          onClick: () => dispatch({ type: 'select', selected: 'inbox' }),
        },
          h(StatusDot, { tone: 'idle' }),
          h('span', { className: 'dl-rss-inbox-name' }, text('settings.rss.inbox')),
          h('span', { className: 'dl-rss-inbox-count' }, String(inboxCount)),
        ),
        h('div', { className: 'dl-rss-side-sep' }),
        ...channels.map(entry => channelRow(entry)),
        state.naming?.mode === 'new'
          ? h('div', { className: 'dl-rss-new' },
            h('input', {
              type: 'text',
              className: 'dl-rss-channel-input',
              placeholder: text('settings.rss.channel.placeholder'),
              value: state.naming.value,
              maxLength: MAX_CHANNEL_NAME,
              autoFocus: true,
              disabled: state.busy,
              onChange: event => dispatch({ type: 'naming-value', value: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Enter') void commitNaming();
                if (event.key === 'Escape') dispatch({ type: 'naming', naming: null });
              },
            }),
            h('button', {
              type: 'button',
              className: 'dl-rss-icon',
              'aria-label': text('settings.rss.channel.save'),
              disabled: state.busy,
              onClick: () => void commitNaming(),
            }, h(PencilIcon)),
            h('button', {
              type: 'button',
              className: 'dl-rss-link',
              onClick: () => dispatch({ type: 'naming', naming: null }),
            }, text('settings.rss.confirm.cancel')),
          )
          : h('button', {
            type: 'button',
            className: 'dl-rss-new-btn',
            disabled: locked || channels.length >= 20,
            onClick: () => startNewChannel(null),
          }, h(PlusIcon), text('settings.rss.channel.new')),

        h('div', { className: 'dl-rss-side-sep' }),
        h('div', { className: 'dl-rss-pool' },
          SettingRow({
            label: text('settings.channel.schedule'),
            hint: channel.scheduleEnabled ? text('settings.channel.next', {
              when: channel.scheduleAt,
            }) : text('settings.channel.nextOff'),
            children: h(Switch, {
              checked: channel.scheduleEnabled,
              disabled: locked,
              label: text('settings.rss.pool.scheduleLabel'),
              onChange: value => actions.toggle('rss', 'scheduleEnabled', value),
            }),
          }),
          SettingRow({
            label: text('settings.channel.at'),
            hint: text('settings.channel.atHint'),
            children: h('input', {
              type: 'time',
              className: 'dl-set-time',
              step: 300,
              value: channel.scheduleAt,
              disabled: locked || !channel.scheduleEnabled,
              'aria-label': text('settings.rss.pool.atLabel'),
              onChange: event => actions.changeScheduleAt('rss', event.target.value),
            }),
          }),
          SettingRow({
            label: text('settings.rss.pool.translation'),
            hint: text('settings.rss.pool.translationHint'),
            children: h(Switch, {
              checked: channel.translationEnabled,
              disabled: locked,
              label: text('settings.rss.pool.translationLabel'),
              onChange: value => actions.toggle('rss', 'translationEnabled', value),
            }),
          }),
        ),
        h('p', { className: 'dl-rss-footnote' }, text('settings.rss.caps')),
        h('p', { className: 'dl-rss-footnote' }, text('settings.rss.footnote')),
      ),

      h('section', { className: 'dl-rss-main' },
        h('div', { className: 'dl-rss-main-head' },
          h('span', { className: 'dl-rss-main-title' }, selectedLabel),
          h('span', { className: 'dl-rss-main-count' },
            selected === 'inbox'
              ? text('settings.rss.count.inbox', { n: totalInCollection })
              : text('settings.rss.count.channel', { n: totalInCollection })),
          h('label', { className: 'dl-rss-search' },
            h('span', { className: 'dl-rss-search-icon', 'aria-hidden': true }, h(SearchIcon)),
            h('input', {
              type: 'search',
              className: 'dl-rss-search-input',
              placeholder: text('settings.rss.search'),
              'aria-label': text('settings.rss.search'),
              value: state.query,
              onChange: event => dispatch({ type: 'query', query: event.target.value }),
            }),
          ),
        ),

        h('div', { className: 'dl-rss-table' },
          h('div', { className: 'dl-rss-thead' },
            h('span', null, text('settings.rss.col.name')),
            h('span', null, text('settings.rss.col.note')),
            h('span', null),
          ),
          page.items.length === 0
            ? h('div', { className: 'dl-rss-empty' }, emptyText)
            : page.items.map(feedRow),
        ),

        h('div', { className: 'dl-rss-pager' },
          h('span', { className: 'dl-rss-pager-text' },
            text('settings.rss.pager', { total: page.total, from: page.from, to: page.to })),
          h('div', { className: 'dl-rss-pager-buttons', role: 'group', 'aria-label': text('settings.rss.pager.label') },
            h('button', {
              type: 'button',
              className: 'dl-rss-page',
              'aria-label': text('settings.rss.pager.prev'),
              disabled: page.page <= 1,
              onClick: () => dispatch({ type: 'page', page: clampPage(page.page - 1, page.total) }),
            }, '‹'),
            ...pageNumbers().map(number => h('button', {
              key: number,
              type: 'button',
              className: 'dl-rss-page',
              'aria-current': number === page.page ? 'page' : undefined,
              onClick: () => dispatch({ type: 'page', page: number }),
            }, String(number))),
            h('button', {
              type: 'button',
              className: 'dl-rss-page',
              'aria-label': text('settings.rss.pager.next'),
              disabled: page.page >= page.pages,
              onClick: () => dispatch({ type: 'page', page: clampPage(page.page + 1, page.total) }),
            }, '›'),
          ),
        ),
        h('p', { className: 'dl-rss-footnote' }, text('settings.rss.tableFootnote')),
      ),
    ),
    picker,
    previewModal,
  );
}
