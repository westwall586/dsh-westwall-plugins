import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { CONTRACT_VERSION } from '../src/contract/schema.ts';
import type { ItemState } from '../src/contract/types.ts';
import { writeJsonAtomic } from '../src/store/atomic.ts';
import { layout, stateFile, type Layout } from '../src/store/paths.ts';
import { readMergedState } from '../src/store/window.ts';

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-window-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeState(l: Layout, day: string, items: Record<string, ItemState>): Promise<void> {
  await writeJsonAtomic(stateFile(l, day), { version: CONTRACT_VERSION, day, items });
}

test('merges state written after the viewed day', async (t) => {
  const l = layout(await workspace(t));
  await writeState(l, '2026-11-08', {
    'github_trending__a%2Fb': { readAt: '2026-11-08T10:00:00Z' },
    'github_trending__c%2Fd': { readAt: '2026-11-08T11:00:00Z' },
  });
  await writeState(l, '2026-11-10', {
    'github_trending__c%2Fd': { readAt: '2026-11-10T09:00:00Z' },
    'github_trending__e%2Ff': { readAt: '2026-11-10T09:30:00Z' },
  });

  const merged = await readMergedState(l, ['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(merged, {
    'github_trending__a%2Fb': { readAt: '2026-11-08T10:00:00Z' },
    'github_trending__c%2Fd': { readAt: '2026-11-10T09:00:00Z' },
    'github_trending__e%2Ff': { readAt: '2026-11-10T09:30:00Z' },
  });
});

test('the latest write day wins regardless of range order', async (t) => {
  const l = layout(await workspace(t));
  await writeState(l, '2026-11-08', { 'github_trending__a%2Fb': { readAt: '2026-11-08T10:00:00Z' } });
  await writeState(l, '2026-11-10', { 'github_trending__a%2Fb': { readAt: '2026-11-10T10:00:00Z' } });

  const merged = await readMergedState(l, ['2026-11-10', '2026-11-08']);
  assert.deepEqual(merged['github_trending__a%2Fb'], { readAt: '2026-11-10T10:00:00Z' });
});

test('a corrupt day file does not poison the window', async (t) => {
  const l = layout(await workspace(t));
  await writeState(l, '2026-11-08', { 'github_trending__a%2Fb': { readAt: '2026-11-08T10:00:00Z' } });
  await writeJsonAtomic(stateFile(l, '2026-11-09'), { version: CONTRACT_VERSION, day: '2026-11-09', items: 'nope' });
  await writeState(l, '2026-11-10', { 'github_trending__c%2Fd': { readAt: '2026-11-10T10:00:00Z' } });

  const merged = await readMergedState(l, ['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepEqual(Object.keys(merged).sort(), ['github_trending__a%2Fb', 'github_trending__c%2Fd']);
});

test('an empty window merges to an empty map', async (t) => {
  const l = layout(await workspace(t));
  assert.deepEqual(await readMergedState(l, []), {});
});

test('the cache merge helper is gone from the window module', async () => {
  const window = await import('../src/store/window.ts');
  assert.equal('readMergedCache' in window, false);
});
