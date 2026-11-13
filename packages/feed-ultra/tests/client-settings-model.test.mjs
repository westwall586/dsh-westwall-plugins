import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  batchSizeOutcome,
  catalogFailed,
  catalogLoading,
  catalogReady,
  channelIntent,
  channelSubline,
  currentSelection,
  effectiveEffort,
  effortKey,
  effortLabel,
  effortName,
  effortPickIntent,
  followModelIntent,
  formatNextFetch,
  initialPicker,
  localeIntent,
  modelGroups,
  modelSummary,
  navItems,
  orderProviders,
  paneTitle,
  pickerReducer,
  pickerView,
  popoverPosition,
  resolvePane,
  retentionChange,
  scheduleAtOutcome,
  selectEffortIntent,
  selectModelIntent,
  translationProgress,
} from '../client/src/settings-model.mjs';
import { createModelPicker } from '../client/src/model-picker.mjs';

const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'));

function t(key, params) {
  let value = zh[key] ?? key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
  }
  return value;
}

const catalog = {
  status: 'ready',
  value: {
    providers: [
      { id: 'other', name: 'Other' },
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'deepseek-account', name: 'DeepSeek 账号' },
    ],
    models: {
      other: [{ id: 'other-one', name: 'Other One' }],
      'deepseek-official': [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ],
      'deepseek-account': [{ id: 'account-chat', name: 'Account Chat' }],
    },
    selected: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' },
    following: true,
    error: '',
  },
};

const fiveModelCatalog = {
  status: 'ready',
  value: {
    ...catalog.value,
    models: {
      ...catalog.value.models,
      other: [...catalog.value.models.other, { id: 'other-two', name: 'Other Two' }],
    },
  },
};

function effortsFor(options = {}) {
  return {
    status: 'ready',
    requestId: 1,
    efforts: [
      { id: 'low', name: '低' },
      { id: 'high', name: '高' },
    ],
    defaultEffort: 'high',
    error: '',
    ...options,
  };
}

function effortsMap(provider, model, options) {
  return { [effortKey(provider, model)]: effortsFor(options) };
}

const chatEfforts = effortsMap('deepseek-official', 'deepseek-chat');

test('a pane falls back to general only when the catalog no longer lists it', () => {
  assert.equal(resolvePane('general', ['github_trending']), 'general');
  assert.equal(resolvePane('github_trending', ['github_trending']), 'github_trending');
  assert.equal(resolvePane('gone', ['github_trending']), 'general');
  assert.equal(resolvePane('github_trending', null), 'github_trending');
});

test('nav items list general first, then every channel with its schedule subline', () => {
  const channels = [
    { id: 'github_trending', name: 'GitHub Trending' },
    { id: 'rss', name: 'RSS' },
  ];
  const value = {
    sources: {
      github_trending: { scheduleEnabled: true, scheduleAt: '08:00', translationEnabled: true },
      rss: { scheduleEnabled: false, scheduleAt: '08:00', translationEnabled: true },
    },
  };
  assert.deepEqual(navItems('github_trending', channels, value, t), [
    { key: 'general', label: '通用设置', sub: '', active: false },
    { key: 'github_trending', label: 'GitHub Trending', sub: '08:00 自动', active: true },
    { key: 'rss', label: 'RSS', sub: '定时关闭', active: false },
  ]);
  assert.equal(navItems('general', channels, null, t)[0].active, true);
  assert.deepEqual(navItems('general', null, null, t).map(item => item.key), ['general']);
});

test('pane titles and sublines come from the catalog and the document', () => {
  const channels = [{ id: 'github_trending', name: 'GitHub Trending' }];
  assert.equal(paneTitle('general', channels, t), '通用设置');
  assert.equal(paneTitle('github_trending', channels, t), 'GitHub Trending');
  assert.equal(paneTitle('gone', channels, t), 'gone');
  assert.equal(channelSubline({ scheduleEnabled: true, scheduleAt: '09:30' }, t), '09:30 自动');
  assert.equal(channelSubline({ scheduleEnabled: false, scheduleAt: '09:30' }, t), '定时关闭');
  assert.equal(
    channelSubline({ scheduleEnabled: true, scheduleAt: '09:30' }, t, { cadence: 'manual' }),
    '手动拉取',
    'a manual channel names how it runs, not its schedule',
  );
});

test('a manual channel says it pulls by hand in the settings nav', () => {
  const channels = [
    { id: 'github_trending', name: 'GitHub Trending' },
    { id: 'x_bookmarks', name: 'X Bookmarks', cadence: 'manual' },
  ];
  const value = {
    sources: {
      github_trending: { scheduleEnabled: true, scheduleAt: '08:00' },
      x_bookmarks: { scheduleEnabled: true, scheduleAt: '08:00', batchSize: 5 },
    },
  };
  assert.deepEqual(navItems('x_bookmarks', channels, value, t), [
    { key: 'general', label: '通用设置', sub: '', active: false },
    { key: 'github_trending', label: 'GitHub Trending', sub: '08:00 自动', active: false },
    { key: 'x_bookmarks', label: 'X 书签', sub: '手动拉取', active: true },
  ]);
});

test('channel labels follow the interface locale, not the descriptor name', () => {
  const channels = [
    { id: 'github_trending', name: 'GitHub Trending' },
    { id: 'bestblogs_brief', name: 'BestBlogs Daily Brief' },
  ];
  const value = {
    sources: {
      github_trending: { scheduleEnabled: true, scheduleAt: '08:00' },
      bestblogs_brief: { scheduleEnabled: true, scheduleAt: '08:00' },
    },
  };
  assert.deepEqual(navItems('bestblogs_brief', channels, value, t), [
    { key: 'general', label: '通用设置', sub: '', active: false },
    { key: 'github_trending', label: 'GitHub Trending', sub: '08:00 自动', active: false },
    { key: 'bestblogs_brief', label: 'BestBlogs 每日早报', sub: '08:00 自动', active: true },
  ]);
  assert.equal(paneTitle('bestblogs_brief', channels, t), 'BestBlogs 每日早报');
});

test('write intents address one leaf and each model pane has its own shape', () => {
  assert.deepEqual(channelIntent('github_trending', 'scheduleAt', '09:30'), {
    path: ['sources', 'github_trending', 'scheduleAt'],
    value: '09:30',
  });

  assert.deepEqual(followModelIntent(), { path: ['model'], value: null });
  assert.deepEqual(selectModelIntent('deepseek-official', 'deepseek-reasoner'), {
    path: ['model'],
    value: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
  });
  assert.equal(
    'reasoningEffort' in selectModelIntent('deepseek-official', 'deepseek-reasoner').value,
    false,
    'picking a model drops the effort so the model keeps its own default',
  );
  assert.deepEqual(
    selectEffortIntent({ provider: 'deepseek-official', model: 'deepseek-chat' }, 'low'),
    {
      path: ['model'],
      value: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'low' },
    },
  );

  assert.equal(retentionChange(30, 30), null);
  assert.deepEqual(retentionChange(30, 7), { kind: 'confirm', next: 7 });
  assert.deepEqual(retentionChange(30, 60), { kind: 'write', next: 60 });
  assert.equal(retentionChange(30, Number.NaN), null);
});

test('the locale intent writes the channel edition and nothing else', () => {
  assert.deepEqual(localeIntent('bestblogs_brief', 'en'), {
    path: ['sources', 'bestblogs_brief', 'locale'],
    value: 'en',
  });
  assert.deepEqual(localeIntent('bestblogs_brief', 'zh'), {
    path: ['sources', 'bestblogs_brief', 'locale'],
    value: 'zh',
  });
  assert.deepEqual(localeIntent('bestblogs_brief', 'ja'), {
    path: ['sources', 'bestblogs_brief', 'locale'],
    value: 'zh',
  });
});

test('a time earlier than the channel floor is refused before the write', () => {
  assert.deepEqual(scheduleAtOutcome('06:59', '08:00', '07:00'), { kind: 'tooEarly' });
  assert.deepEqual(scheduleAtOutcome('00:00', '08:00', '07:00'), { kind: 'tooEarly' });
  assert.deepEqual(scheduleAtOutcome('07:00', '08:00', '07:00'), { kind: 'write', value: '07:00' });
  assert.deepEqual(scheduleAtOutcome('08:00', '08:00', '07:00'), { kind: 'same' });
  assert.deepEqual(scheduleAtOutcome('06:00', '08:00', ''), { kind: 'write', value: '06:00' });
  assert.deepEqual(scheduleAtOutcome('06:00', '08:00', 'not-a-time'), { kind: 'write', value: '06:00' });
  assert.deepEqual(scheduleAtOutcome('6:00', '08:00', '07:00'), { kind: 'invalid' });
  assert.deepEqual(scheduleAtOutcome('', '08:00', ''), { kind: 'invalid' });
});

test('a batch-size edit clamps into one through twenty before writing', () => {
  assert.deepEqual(batchSizeOutcome('5', 3), { kind: 'write', value: 5 });
  assert.deepEqual(batchSizeOutcome(1, 3), { kind: 'write', value: 1 });
  assert.deepEqual(batchSizeOutcome(20, 3), { kind: 'write', value: 20 });
  assert.deepEqual(batchSizeOutcome(0, 3), { kind: 'write', value: 1 });
  assert.deepEqual(batchSizeOutcome(25, 3), { kind: 'write', value: 20 });
  assert.deepEqual(batchSizeOutcome(4.6, 3), { kind: 'write', value: 5 });
  assert.deepEqual(batchSizeOutcome(3, 3), { kind: 'same' });
  assert.deepEqual(batchSizeOutcome('abc', 3), { kind: 'invalid' });
  assert.deepEqual(batchSizeOutcome('', 3), { kind: 'invalid' });
  assert.deepEqual(batchSizeOutcome(Number.NaN, 3), { kind: 'invalid' });
});

test('translation progress shows the missing count, never a done number', () => {
  assert.equal(translationProgress(true, 2, t), '缺译 2');
  assert.equal(translationProgress(true, 0, t), '全部已翻译');
  assert.equal(translationProgress(true, -1, t), '全部已翻译');
  assert.equal(translationProgress(false, 3, t), '已关闭；已缓存的译文仍会显示');
  assert.doesNotMatch(translationProgress(true, 2, t), /已翻译\s*\d/);
});

test('next-fetch text names today, tomorrow, and a later date', () => {
  const now = new Date(2026, 10, 10, 12, 0);
  assert.equal(formatNextFetch('2026-11-10T18:30:00', now, t), '今天 18:30');
  assert.equal(formatNextFetch('2026-11-11T08:00:00', now, t), '明天 08:00');
  assert.equal(formatNextFetch('2026-11-15T09:05:00', now, t), '11月15日 09:05');
  assert.equal(formatNextFetch(null, now, t), '—');
  assert.equal(formatNextFetch('', now, t), '—');
  assert.equal(formatNextFetch('not-a-date', now, t), '—');
});

test('providers list the account and official catalogs first, then catalog order', () => {
  const providers = [
    { id: 'zeta', name: 'Zeta' },
    { id: 'deepseek-official', name: 'DeepSeek' },
    { id: 'alpha', name: 'Alpha' },
    { id: 'deepseek-account', name: 'DeepSeek 账号' },
  ];
  assert.deepEqual(
    orderProviders(providers).map(provider => provider.id),
    ['deepseek-account', 'deepseek-official', 'zeta', 'alpha'],
    'the rest keep catalog order',
  );
  assert.deepEqual(orderProviders(undefined), []);
});

test('model groups filter by a case-insensitive name match and drop unmatched groups', () => {
  const all = modelGroups(catalog.value, '');
  assert.deepEqual(all.map(group => [group.id, group.models.length]), [
    ['deepseek-account', 1],
    ['deepseek-official', 2],
    ['other', 1],
  ]);

  const searched = modelGroups(catalog.value, 'reason');
  assert.deepEqual(searched.map(group => group.id), ['deepseek-official']);
  assert.deepEqual(searched[0].models.map(model => model.id), ['deepseek-reasoner']);

  assert.deepEqual(modelGroups(catalog.value, 'REASON').map(group => group.id), ['deepseek-official']);
  assert.deepEqual(modelGroups(catalog.value, '  chat ').map(group => group.id), [
    'deepseek-account',
    'deepseek-official',
  ]);
  assert.deepEqual(modelGroups(catalog.value, 'nothing'), []);
});

test('the picker opens on the root pane and every pane switch clears the query', () => {
  let picker = initialPicker(null);
  assert.deepEqual(picker, { pane: 'root', current: null, query: '' });

  picker = pickerReducer(picker, { type: 'pane', pane: 'model' });
  picker = pickerReducer(picker, { type: 'query', query: 'reason' });
  assert.equal(picker.query, 'reason');
  assert.equal(pickerReducer(picker, { type: 'query', query: '' }).query, '');

  picker = pickerReducer(picker, { type: 'pane', pane: 'effort' });
  assert.equal(picker.pane, 'effort');
  assert.equal(picker.query, '', 'leaving the search pane clears the query');

  assert.equal(pickerReducer(picker, { type: 'close' }), null);
  assert.deepEqual(
    pickerReducer(picker, { type: 'open', current: { provider: 'other', model: 'other-one' } }),
    { pane: 'root', current: { provider: 'other', model: 'other-one' }, query: '' },
    'reopening returns to the root pane',
  );
});

test('the selection in effect is the saved choice, else the resolved default', () => {
  assert.deepEqual(currentSelection(null, catalog.value), {
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    reasoningEffort: 'high',
  });
  assert.deepEqual(currentSelection({ provider: 'other', model: 'other-one' }, catalog.value), {
    provider: 'other',
    model: 'other-one',
  });
  assert.equal(currentSelection(null, { selected: null }), null);
  assert.equal(currentSelection({ provider: '', model: 'x' }, null), null);
});

test('the effort in effect is the saved one, else the catalog default', () => {
  const entry = effortsFor();
  assert.equal(effectiveEffort({ provider: 'p', model: 'm', reasoningEffort: 'low' }, entry), 'low');
  assert.equal(effectiveEffort({ provider: 'p', model: 'm' }, entry), 'high');
  assert.equal(effectiveEffort({ provider: 'p', model: 'm' }, { status: 'loading' }), '');
  assert.equal(effectiveEffort(null, entry), '');
  assert.equal(effortName({ provider: 'p', model: 'm' }, { [effortKey('p', 'm')]: entry }), '高');
  assert.equal(
    effortName({ provider: 'p', model: 'm', reasoningEffort: 'max' }, { [effortKey('p', 'm')]: entry }),
    'max',
    'an effort the catalog does not know shows its id',
  );
});

test('the model pane lists the follow row first and checks it while following', () => {
  const picker = pickerReducer(initialPicker(null), { type: 'pane', pane: 'model' });
  const frame = pickerView(picker, catalog, chatEfforts, t);

  assert.equal(frame.pane, 'model');
  assert.equal(frame.model.status.phase, 'ready');
  assert.equal(frame.model.rows[0].kind, 'follow');
  assert.equal(frame.model.rows[0].label, '跟随 DSH 默认');
  assert.equal(frame.model.rows[0].checked, true);
  assert.equal(frame.model.rows[0].hint, 'DeepSeek · DeepSeek Chat');
  assert.deepEqual(frame.model.rows.slice(1).map(row => row.key), [
    'deepseek-account',
    'deepseek-official',
    'other',
  ]);
  const checked = frame.model.rows
    .flatMap(row => row.models)
    .filter(model => model.checked)
    .map(model => model.id);
  assert.deepEqual(checked, ['deepseek-chat'], 'the resolved model carries the check');

  const explicit = pickerView(
    pickerReducer(initialPicker({ provider: 'other', model: 'other-one' }), { type: 'pane', pane: 'model' }),
    catalog,
    chatEfforts,
    t,
  );
  assert.equal(explicit.model.rows[0].checked, false);
});

test('the root pane names the current model and effort and hides the effort row without any', () => {
  const frame = pickerView(initialPicker(null), catalog, chatEfforts, t);
  assert.equal(frame.pane, 'root');
  assert.equal(frame.model.label, '模型');
  assert.equal(frame.model.value, 'DeepSeek Chat');
  assert.equal(frame.effort.label, '推理等级');
  assert.equal(frame.effort.value, '高');
  assert.equal(frame.effort.show, true);

  const none = effortsMap('other', 'other-one', { efforts: [], defaultEffort: '' });
  const plain = pickerView(initialPicker({ provider: 'other', model: 'other-one' }), catalog, none, t);
  assert.equal(plain.effort.show, false);
  assert.equal(plain.effort.value, '');
});

test('the effort pane checks the effort in effect and reports a model without any', () => {
  const picker = pickerReducer(initialPicker(null), { type: 'pane', pane: 'effort' });
  const frame = pickerView(picker, catalog, chatEfforts, t);
  assert.deepEqual(frame.effort.rows, [
    { key: 'effort:low', effort: 'low', label: '低', checked: false },
    { key: 'effort:high', effort: 'high', label: '高', checked: true },
  ]);
  assert.equal(frame.effort.status.phase, 'ready');
  assert.equal(frame.model.retryLabel, '重试');
  assert.equal(frame.effort.retryLabel, '重新加载');

  const none = effortsMap('other', 'other-one', { efforts: [], defaultEffort: '' });
  const empty = pickerView(
    pickerReducer(initialPicker({ provider: 'other', model: 'other-one' }), { type: 'pane', pane: 'effort' }),
    catalog,
    none,
    t,
  );
  assert.equal(empty.effort.status.phase, 'empty');
  assert.equal(empty.effort.status.text, '当前模型未提供推理等级。');
  assert.deepEqual(empty.effort.rows, []);
});

test('a model without a default effort starts its list with the synthetic Default row', () => {
  const noDefault = effortsMap('deepseek-official', 'deepseek-chat', { defaultEffort: '' });
  const selection = { provider: 'deepseek-official', model: 'deepseek-chat' };
  const frame = pickerView(
    pickerReducer(initialPicker(selection), { type: 'pane', pane: 'effort' }),
    catalog,
    noDefault,
    t,
  );
  assert.deepEqual(frame.effort.rows, [
    { key: 'provider-default', effort: null, label: 'Default', checked: true },
    { key: 'effort:low', effort: 'low', label: '低', checked: false },
    { key: 'effort:high', effort: 'high', label: '高', checked: false },
  ]);
  assert.equal(frame.effort.value, 'Default', 'the root cell names the default that is in effect');

  const explicit = { ...selection, reasoningEffort: 'low' };
  const entry = noDefault[effortKey(selection.provider, selection.model)];
  const defaultIntent = effortPickIntent(explicit, entry, null);
  assert.deepEqual(defaultIntent, {
    path: ['model'],
    value: { provider: 'deepseek-official', model: 'deepseek-chat' },
  });
  assert.equal(
    'reasoningEffort' in defaultIntent.value,
    false,
    'Default writes no effort so the Host applies its own',
  );
  assert.equal(effortPickIntent(selection, entry, null), null, 'Default already in effect is a no-op');

  const withDefault = pickerView(
    pickerReducer(initialPicker(selection), { type: 'pane', pane: 'effort' }),
    catalog,
    chatEfforts,
    t,
  );
  assert.deepEqual(withDefault.effort.rows.map(row => row.label), ['低', '高'], 'no synthetic row when a default exists');
});

test('the summary names the synthetic Default effort the picker shows', () => {
  const selection = { provider: 'deepseek-official', model: 'deepseek-chat' };
  const explicitCatalog = {
    status: 'ready',
    value: { ...catalog.value, selected: selection },
  };
  const noDefault = effortsMap('deepseek-official', 'deepseek-chat', { defaultEffort: '' });
  assert.equal(effortLabel(selection, noDefault, t), 'Default');
  assert.equal(effortLabel(selection, chatEfforts, t), '高');
  assert.equal(
    effortLabel(selection, effortsMap('deepseek-official', 'deepseek-chat', { efforts: [], defaultEffort: '' }), t),
    '',
    'a model with no efforts has no label',
  );
  assert.equal(
    modelSummary(selection, explicitCatalog, noDefault, t).secondary,
    'DeepSeek · 推理等级 Default',
    'an explicit choice reports the effort the root cell reports',
  );
  assert.equal(
    modelSummary(null, explicitCatalog, noDefault, t).secondary,
    'DeepSeek Chat · 推理等级 Default',
    'the followed default reports the same effort',
  );
  const frame = pickerView(initialPicker(selection), explicitCatalog, noDefault, t);
  assert.equal(frame.effort.value, 'Default', 'the root cell and the summary name the same effort');
  const none = effortsMap('deepseek-official', 'deepseek-chat', { efforts: [], defaultEffort: '' });
  assert.equal(modelSummary(selection, explicitCatalog, none, t).secondary, 'DeepSeek', 'no efforts, no effort line');
});

test('backing out of a drilled pane returns to the root pane and names the cell to refocus', () => {
  const selection = { provider: 'other', model: 'other-one' };
  const modelPane = pickerReducer(initialPicker(selection), { type: 'pane', pane: 'model' });
  const back = pickerReducer(modelPane, { type: 'back' });
  assert.deepEqual(back, {
    pane: 'root',
    current: selection,
    query: '',
    highlight: null,
    focusCell: 'model',
  });
  assert.equal(pickerReducer(back, { type: 'focus-handled' }).focusCell, null);

  const effortPane = pickerReducer(initialPicker(selection), { type: 'pane', pane: 'effort' });
  const effortBack = pickerReducer(effortPane, { type: 'back' });
  assert.equal(effortBack.pane, 'root');
  assert.equal(effortBack.focusCell, 'effort');

  const root = initialPicker(selection);
  assert.equal(pickerReducer(root, { type: 'back' }), root, 'the root pane has nowhere to back out to');
});

test('arrow movement steps the highlight one row and wraps across groups', () => {
  const order = ['follow', 'a\u0000one', 'a\u0000two', 'b\u0000three'];
  const start = pickerReducer(initialPicker(null), { type: 'highlight', key: order[1] });
  const move = (activeKey, delta) => pickerReducer(start, { type: 'move', order, delta, activeKey }).highlight;
  assert.equal(move(order[1], 1), order[2], 'steps forward into the next provider group');
  assert.equal(move(order[2], -1), order[1]);
  assert.equal(move(order[3], 1), order[0], 'wraps forward to the first row');
  assert.equal(move(order[0], -1), order[3], 'wraps backward to the last row');
  assert.equal(move(null, 1), order[0], 'from outside the rows ArrowDown enters at the first');
  assert.equal(move(null, -1), order[3], 'from outside the rows ArrowUp enters at the last');
  assert.equal(
    pickerReducer(start, { type: 'move', order: [], delta: 1, activeKey: null }),
    start,
    'no rows, no movement',
  );
});

test('the model pane highlights exactly one row, the checked row by default', () => {
  const modelPane = pickerReducer(initialPicker(null), { type: 'pane', pane: 'model' });
  const frame = pickerView(modelPane, catalog, chatEfforts, t);
  assert.deepEqual(frame.model.keys, [
    'follow',
    'deepseek-account\u0000account-chat',
    'deepseek-official\u0000deepseek-chat',
    'deepseek-official\u0000deepseek-reasoner',
    'other\u0000other-one',
  ]);
  assert.equal(frame.model.activeKey, 'follow', 'the first checked row is the default highlight');

  const explicit = pickerView(
    pickerReducer(initialPicker({ provider: 'other', model: 'other-one' }), { type: 'pane', pane: 'model' }),
    catalog,
    chatEfforts,
    t,
  );
  assert.equal(explicit.model.activeKey, 'other\u0000other-one');

  const moved = pickerView(
    pickerReducer(modelPane, { type: 'highlight', key: 'deepseek-official\u0000deepseek-reasoner' }),
    catalog,
    chatEfforts,
    t,
  );
  assert.equal(moved.model.activeKey, 'deepseek-official\u0000deepseek-reasoner');
  assert.equal(moved.model.keys.filter(key => key === moved.model.activeKey).length, 1, 'exactly one row is active');

  const stale = pickerView(pickerReducer(modelPane, { type: 'highlight', key: 'gone' }), catalog, chatEfforts, t);
  assert.equal(stale.model.activeKey, 'follow', 'a stale key falls back to the checked row');

  assert.equal(
    pickerView(modelPane, { status: 'loading' }, {}, t).model.activeKey,
    null,
    'no rows means no active row',
  );
});

test('picking the effort already in effect closes with no settings write', () => {
  const keyed = effortsMap('p', 'm');
  const entry = keyed[effortKey('p', 'm')];
  const selection = { provider: 'p', model: 'm' };

  assert.equal(effortPickIntent(selection, entry, 'high'), null, 'the catalog default is already in effect');
  assert.equal(effortPickIntent({ ...selection, reasoningEffort: 'low' }, entry, 'low'), null);
  assert.equal(effortPickIntent(null, entry, 'low'), null);

  assert.deepEqual(effortPickIntent({ ...selection, reasoningEffort: 'low' }, entry, 'high'), {
    path: ['model'],
    value: { provider: 'p', model: 'm', reasoningEffort: 'high' },
  });
  assert.deepEqual(
    effortPickIntent(currentSelection(null, catalog.value), chatEfforts[effortKey('deepseek-official', 'deepseek-chat')], 'low'),
    {
      path: ['model'],
      value: { provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'low' },
    },
    'the saved choice keeps its own provider and model',
  );
});

test('the search field appears only for a catalog of more than four models', () => {
  const modelPane = pickerReducer(initialPicker(null), { type: 'pane', pane: 'model' });
  assert.equal(pickerView(modelPane, catalog, chatEfforts, t).showSearch, false, 'four models total');

  const searched = pickerView(modelPane, fiveModelCatalog, chatEfforts, t);
  assert.equal(searched.showSearch, true);
  assert.equal(searched.searchPlaceholder, '搜索模型…');

  assert.equal(
    pickerView(initialPicker(null), fiveModelCatalog, chatEfforts, t).showSearch,
    false,
    'never in the root pane',
  );
  assert.equal(
    pickerView(
      pickerReducer(initialPicker(null), { type: 'pane', pane: 'effort' }),
      fiveModelCatalog,
      chatEfforts,
      t,
    ).showSearch,
    false,
    'never in the effort pane',
  );

  const filtered = pickerView(
    pickerReducer(modelPane, { type: 'query', query: 'nothing' }),
    fiveModelCatalog,
    chatEfforts,
    t,
  );
  assert.equal(filtered.model.status.phase, 'no-match');
  assert.equal(filtered.query, 'nothing');
});

test('a group whose catalog load failed carries the load warning instead of rows', () => {
  const failed = {
    status: 'ready',
    value: {
      ...catalog.value,
      models: { ...catalog.value.models, other: [] },
      error: 'llm unavailable',
    },
  };
  const frame = pickerView(
    pickerReducer(initialPicker(null), { type: 'pane', pane: 'model' }),
    failed,
    chatEfforts,
    t,
  );
  const group = frame.model.rows.find(row => row.key === 'other');
  assert.equal(group.warning, 'Other 加载失败：llm unavailable');
  assert.deepEqual(group.models, []);
  assert.equal(frame.model.status.phase, 'ready');
});

test('the model pane reports loading, an empty catalog, and a search with no hits', () => {
  const modelPicker = pickerReducer(initialPicker(null), { type: 'pane', pane: 'model' });
  const loading = pickerView(modelPicker, { status: 'loading' }, {}, t);
  assert.equal(loading.model.status.phase, 'loading');
  assert.equal(loading.model.status.text, '正在刷新模型列表…');
  assert.deepEqual(loading.model.rows, []);

  const emptyCatalog = { status: 'ready', value: { providers: [], models: {}, selected: null, error: '' } };
  const empty = pickerView(modelPicker, emptyCatalog, {}, t);
  assert.equal(empty.model.status.phase, 'empty');
  assert.equal(empty.model.status.text, '暂无可用模型');

  const noMatch = pickerView(
    pickerReducer(modelPicker, { type: 'query', query: 'nothing' }),
    fiveModelCatalog,
    chatEfforts,
    t,
  );
  assert.equal(noMatch.model.status.phase, 'no-match');
  assert.equal(noMatch.model.status.text, '没有匹配的模型。');
  assert.deepEqual(noMatch.model.rows.map(row => row.kind), ['follow'], 'the follow row survives a search');
});

test('the model row follows the default or shows the explicit choice', () => {
  assert.deepEqual(modelSummary(null, catalog, chatEfforts, t), {
    badge: '跟随 DSH 默认',
    primary: '',
    secondary: 'DeepSeek Chat · 推理等级 高',
    note: '',
    unavailable: false,
  });
  assert.deepEqual(
    modelSummary(
      { provider: 'deepseek-official', model: 'deepseek-reasoner' },
      catalog,
      effortsMap('deepseek-official', 'deepseek-reasoner', {
        efforts: [{ id: 'high', name: '高' }],
        defaultEffort: 'high',
      }),
      t,
    ),
    {
      badge: '',
      primary: 'DeepSeek Reasoner',
      secondary: 'DeepSeek · 推理等级 高',
      note: '',
      unavailable: false,
    },
  );
});

test('the model row falls back to the id when the catalog is missing the entry', () => {
  assert.deepEqual(
    modelSummary({ provider: 'other', model: 'vanished' }, catalog, {}, t),
    {
      badge: '',
      primary: 'vanished',
      secondary: 'Other',
      note: '',
      unavailable: false,
    },
  );
});

test('the model row explains an unreadable default and a failed catalog', () => {
  const emptyCatalog = {
    status: 'ready',
    value: { ...catalog.value, selected: null },
  };
  assert.deepEqual(modelSummary(null, emptyCatalog, {}, t), {
    badge: '跟随 DSH 默认',
    primary: '当前模型不可用',
    secondary: '无法读取 DSH 默认模型',
    note: '',
    unavailable: true,
  });
  assert.deepEqual(
    modelSummary({ provider: 'other', model: 'other-one' }, { status: 'error' }, {}, t),
    {
      badge: '',
      primary: 'other-one',
      secondary: 'other',
      note: '模型目录读取失败，仍会使用已选模型',
      unavailable: false,
    },
  );
  assert.deepEqual(modelSummary(null, { status: 'loading' }, {}, t), {
    badge: '跟随 DSH 默认',
    primary: '',
    secondary: '正在读取模型…',
    note: '',
    unavailable: false,
  });
});

test('the popover sits below its trigger, flips above it, and clamps to the viewport', () => {
  const viewport = { width: 1000, height: 800 };
  assert.deepEqual(
    popoverPosition({ top: 400, bottom: 430, right: 900 }, { height: 300 }, viewport),
    { top: 438, right: 100, maxHeight: 360 },
  );
  assert.equal(
    popoverPosition({ top: 700, bottom: 730, right: 900 }, { height: 300 }, viewport).top,
    392,
    'a card that does not fit below flips above the trigger',
  );
  assert.equal(
    popoverPosition({ top: 400, bottom: 430, right: 900 }, { height: 900 }, viewport).maxHeight,
    360,
  );
});

test('the picker copy ships verbatim in both locales', () => {
  const strings = {
    'model.effort': ['推理等级', 'Effort'],
    'model.search': ['搜索模型…', 'Search models…'],
    'model.searchClear': ['清除搜索', 'Clear search'],
    'model.searchEmpty': ['没有匹配的模型。', 'No matching models.'],
    'model.emptyAll': ['暂无可用模型', 'No models available.'],
    'model.effortsEmpty': ['当前模型未提供推理等级。', 'This model provides no reasoning effort levels.'],
    'model.loadingList': ['正在刷新模型列表…', 'Refreshing model list…'],
    'model.groupFailed': ['{name} 加载失败：{message}', '{name} failed to load: {message}'],
    'model.reload': ['重新加载', 'Reload'],
    'model.retry': ['重试', 'Retry'],
    'model.providerDefault': ['Default', 'Default'],
    'settings.model.effort': ['推理等级 {name}', 'Effort {name}'],
  };
  for (const [key, [zhText, enText]] of Object.entries(strings)) {
    assert.equal(zh[key], zhText, `zh-CN ${key}`);
    assert.equal(en[key], enText, `en-US ${key}`);
  }
});

test('the model port numbers requests so a late effort response is identifiable', async () => {
  const remote = {
    models: async () => ({ providers: [], models: {}, selected: null, following: true, error: '' }),
    modelEfforts: async (provider, model) => ({
      efforts: [{ id: `${provider}:${model}`, name: model }],
      error: '',
    }),
  };
  const port = createModelPicker(remote);
  const first = port.efforts('deepseek', 'deepseek-flash');
  const second = port.efforts('deepseek', 'deepseek-reasoner');
  assert.equal(first.requestId, 1);
  assert.equal(second.requestId, 2);

  const [one, two] = await Promise.all([first.done, second.done]);
  assert.equal(one.requestId, 1);
  assert.equal(one.result.efforts[0].id, 'deepseek:deepseek-flash');
  assert.equal(two.requestId, 2);
  assert.equal(two.result.efforts[0].id, 'deepseek:deepseek-reasoner');
});

test('a failed effort call keeps its requestId on the rejection outcome', async () => {
  const failure = new Error('llm unavailable');
  const port = createModelPicker({
    models: async () => ({}),
    modelEfforts: async () => {
      throw failure;
    },
  });
  const request = port.efforts('deepseek', 'deepseek-flash');
  const outcome = await request.done;
  assert.equal(outcome.requestId, request.requestId);
  assert.equal(outcome.error, failure);
});

test('a catalog reply is dropped once a newer load takes its generation', () => {
  let models = catalogLoading(null, 1);
  assert.deepEqual(models, { status: 'loading', requestId: 1 });

  models = catalogLoading(models, 2);
  assert.equal(models.requestId, 2);
  assert.equal(catalogReady(models, 1, catalog.value), models, 'a stale success writes nothing');
  assert.equal(catalogFailed(models, 1, 'late failure'), models, 'a stale failure writes nothing');

  const ready = catalogReady(models, 2, catalog.value);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.value, catalog.value);

  const refreshing = catalogLoading(ready, 3);
  assert.equal(refreshing.status, 'ready', 'a refresh keeps the rows visible');
  assert.equal(refreshing.value, catalog.value);
  assert.equal(catalogFailed(refreshing, 3, 'boom').status, 'ready', 'a failed refresh keeps the last catalog');
});
