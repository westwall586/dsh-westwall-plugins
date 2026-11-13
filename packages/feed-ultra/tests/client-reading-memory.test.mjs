import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createReadingMemory,
  readingScrollKey,
  resolveReadingChannel,
  resolveReadingDay,
} from '../client/src/reading-memory.mjs';

const WORKSPACE = '/workspace/feedUltra';

test('a stored today follows the new today, a historical day stays inside retention', () => {
  const today = '2026-11-11';
  assert.equal(
    resolveReadingDay({ day: '2026-11-10', today: '2026-11-10' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    today,
    'a day that was today follows the new day',
  );
  assert.equal(
    resolveReadingDay({ day: '2026-11-01', today: '2026-11-11' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    '2026-11-01',
    'a historical day stays',
  );
  assert.equal(
    resolveReadingDay({ day: '2026-09-01', today: '2026-11-11' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    today,
    'a day outside retention falls back',
  );
  assert.equal(
    resolveReadingDay({ day: '2026-11-30', today: '2026-11-11' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    today,
    'a future day falls back',
  );
  assert.equal(
    resolveReadingDay(
      { day: '2026-11-10', today: '2026-11-10', workspacePath: '/workspace/old' },
      { today, retentionDays: 30, workspacePath: WORKSPACE },
    ),
    today,
    'a different workspace does not restore the old day',
  );
  assert.equal(
    resolveReadingDay({ day: 'not-a-day', today: 'not-a-day' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    today,
    'a corrupt day falls back',
  );
  assert.equal(
    resolveReadingDay({ day: '2026-10-13', today: '2026-11-11' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    '2026-10-13',
    'the oldest retained day is inclusive',
  );
  assert.equal(
    resolveReadingDay({ day: '2026-10-12', today: '2026-11-11' }, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    today,
    'one day older than retention falls back',
  );
  assert.equal(
    resolveReadingDay({ day: '2026-11-01', today: '2026-11-11' }, { today, retentionDays: undefined, workspacePath: WORKSPACE }),
    '2026-11-01',
    'a missing retention window falls back to 30 days',
  );
  assert.equal(
    resolveReadingDay({}, { today, retentionDays: 30, workspacePath: WORKSPACE }),
    today,
    'no memory falls back',
  );
});

test('a remembered channel survives only while the source still exists', () => {
  const memory = createReadingMemory();
  memory.rememberSelection({ workspacePath: WORKSPACE, channel: 'x_bookmarks', filter: 'unread', day: '2026-11-11', today: '2026-11-11' });
  assert.deepEqual(memory.readSelection(), {
    workspacePath: WORKSPACE,
    channel: 'x_bookmarks',
    filter: 'unread',
    day: '2026-11-11',
    today: '2026-11-11',
  });

  const sources = { sources: [{ id: 'github_trending' }, { id: 'bestblogs_brief' }, { id: 'x_bookmarks' }] };
  assert.equal(resolveReadingChannel('x_bookmarks', sources), 'x_bookmarks');
  assert.equal(resolveReadingChannel('all', sources), 'all');
  assert.equal(resolveReadingChannel('removed_source', sources), 'all');
  assert.equal(resolveReadingChannel('x_bookmarks', null), 'all');
  assert.equal(resolveReadingChannel('', sources), 'all');

  memory.rememberSelection({ filter: 'all' });
  assert.equal(memory.readSelection().channel, 'x_bookmarks', 'a partial write keeps the other fields');
  assert.equal(memory.readSelection().filter, 'all');
});

test('scroll positions live per workspace, day, channel, and filter', () => {
  const memory = createReadingMemory();
  const base = { workspacePath: WORKSPACE, day: '2026-11-11', channel: 'x_bookmarks', filter: 'all' };
  const xKey = readingScrollKey(base);
  const githubKey = readingScrollKey({ ...base, channel: 'github_trending' });
  const otherDayKey = readingScrollKey({ ...base, day: '2026-11-10' });
  const otherWorkspaceKey = readingScrollKey({ ...base, workspacePath: '/workspace/other' });
  const otherFilterKey = readingScrollKey({ ...base, filter: 'unread' });

  assert.notEqual(xKey, githubKey);
  assert.notEqual(xKey, otherDayKey);
  assert.notEqual(xKey, otherWorkspaceKey);
  assert.notEqual(xKey, otherFilterKey);

  memory.rememberScroll(xKey, 420.4);
  memory.rememberScroll(githubKey, 88);
  assert.equal(memory.readScroll(xKey), 420);
  assert.equal(memory.readScroll(githubKey), 88);
  assert.equal(memory.readScroll(otherDayKey), 0);
  assert.equal(memory.readScroll('missing'), 0);

  memory.rememberScroll(xKey, -10);
  assert.equal(memory.readScroll(xKey), 420, 'a negative top is ignored');
  memory.rememberScroll(xKey, 500.7);
  assert.equal(memory.readScroll(xKey), 501);
});

test('the scroll memory keeps a bounded recent set', () => {
  const memory = createReadingMemory();
  for (let index = 0; index < 130; index += 1) {
    memory.rememberScroll(`key-${index}`, index);
  }
  assert.equal(memory.readScroll('key-0'), 0, 'the oldest key is evicted');
  assert.equal(memory.readScroll('key-129'), 129);

  memory.rememberScroll('key-129', 500);
  for (let index = 130; index < 140; index += 1) {
    memory.rememberScroll(`key-${index}`, index);
  }
  assert.equal(memory.readScroll('key-129'), 500, 'a touched key survives eviction');
});

test('reset clears both the selection and the scroll memory', () => {
  const memory = createReadingMemory();
  memory.rememberSelection({ channel: 'x_bookmarks', filter: 'unread', day: '2026-11-11', today: '2026-11-11', workspacePath: WORKSPACE });
  memory.rememberScroll('a', 12);
  memory.reset();
  assert.deepEqual(memory.readSelection(), {
    workspacePath: '',
    channel: 'all',
    filter: 'all',
    day: '',
    today: '',
  });
  assert.equal(memory.readScroll('a'), 0);
});
