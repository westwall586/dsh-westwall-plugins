import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import FeedUltra from '../src/index.ts';
import { shiftDay } from '../src/store/paths.ts';
import type { FeedUltraConfig } from '../src/settings.ts';

interface SettingsWrite {
  ns: string;
  patch: Record<string, unknown>;
}

function mountSettings(ctx: Context, writes: SettingsWrite[]) {
  return ctx.plugin({
    name: 'fake-settings',
    apply(plugin: Context) {
      plugin.provide('settings', {
        update: async (ns: string, patch: object) => {
          writes.push({ ns, patch: patch as Record<string, unknown> });
        },
      });
    },
  });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function mount(t: TestContext, config: Partial<FeedUltraConfig>): Promise<FeedUltra> {
  const ctx = new Context();
  ctx.plugin(FeedUltra, { workspacePath: '', retentionDays: 30, autoFetch: false, ...config });
  t.after(async () => {
    await ctx.fiber.dispose();
  });
  await settle();
  const service = ctx.get('feedUltra');
  assert.ok(service, 'the plugin registered its service');
  return service;
}

async function workspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-shell-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return realpath(root);
}

function rejectsRemote(promise: Promise<unknown>, code: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => error instanceof RemoteError && error.code === code);
}

test('the plugin registers the feedUltra service and reads its Config', async (t) => {
  const service = await mount(t, { retentionDays: 2, autoFetch: false });
  const status = await service.status();

  assert.equal(status.workspace.status, 'unbound');
  assert.equal(status.retentionDays, 2);
  assert.equal(status.autoFetch, false);
  assert.equal(status.sourceCount, 4);
});

test('reads degrade to empty views while unbound and writes are refused', async (t) => {
  const service = await mount(t, {});

  const day = await service.day('2026-11-10');
  assert.equal(day.workspace.status, 'unbound');
  assert.deepEqual(day.sections, []);
  assert.equal(day.total, 0);

  const sources = await service.sources();
  assert.equal(sources.workspace.status, 'unbound');
  assert.equal(sources.sources[0]?.id, 'github_trending');
  assert.equal(sources.sources[0]?.status, 'idle');

  const calendar = await service.calendar('2026-11-10', '2026-11-10');
  assert.deepEqual(calendar.days, []);

  await rejectsRemote(service.fetch('github_trending'), 'feedUltra/workspace-unavailable');
});

test('the shell exposes projected views and translates domain failures into Remote codes', async (t) => {
  const root = await workspace(t);
  const service = await mount(t, { workspacePath: root, autoFetch: false });

  const status = await service.status();
  assert.equal(status.workspace.status, 'ok');
  assert.equal(status.workspace.path, root);

  const day = await service.day('2026-11-10');
  assert.equal(day.sections.length, 3);
  assert.deepEqual(
    day.sections.map((section) => section.status),
    ['missing', 'missing', 'missing'],
  );

  // Derived from the service's own today: a hardcoded date silently becomes valid once the clock reaches it.
  await rejectsRemote(service.day(shiftDay(status.today, 1)), 'feedUltra/invalid-request');
  await rejectsRemote(service.day('not-a-day'), 'feedUltra/invalid-request');
  await rejectsRemote(service.calendar('2026-11-10', '2026-11-09'), 'feedUltra/invalid-request');
  await rejectsRemote(service.act('archive', ['github_trending__a%2Fb']), 'feedUltra/unsupported-action');
  await rejectsRemote(service.fetch('nope'), 'feedUltra/source-unknown');
});

test('binding without a settings service refuses to pretend the binding was saved', async (t) => {
  const root = await workspace(t);
  const service = await mount(t, {});

  await rejectsRemote(service.bindWorkspace(root), 'feedUltra/workspace-unavailable');
});

test('the autoFetch migration persists once the settings service mounts', async (t) => {
  const ctx = new Context();
  ctx.plugin(FeedUltra, { workspacePath: '', retentionDays: 30, autoFetch: false });
  t.after(async () => {
    await ctx.fiber.dispose();
  });
  await settle();

  const writes: SettingsWrite[] = [];
  const first = mountSettings(ctx, writes);
  await settle();
  assert.equal(writes.length, 1, 'the migration runs when settings arrives, not at construction');
  assert.equal(writes[0]?.ns, 'dsh-feed-ultra');
  assert.deepEqual(writes[0]?.patch, {
    sources: {
      github_trending: {
        scheduleEnabled: false,
        scheduleAt: '08:00',
        translationEnabled: true,
        locale: 'zh',
        batchSize: 3,
        egoBrowserPath: '',
      },
      bestblogs_brief: {
        scheduleEnabled: false,
        scheduleAt: '08:00',
        translationEnabled: true,
        locale: 'zh',
        batchSize: 3,
        egoBrowserPath: '',
      },
      x_bookmarks: {
        scheduleEnabled: false,
        scheduleAt: '08:00',
        translationEnabled: true,
        locale: 'zh',
        batchSize: 3,
        egoBrowserPath: '',
      },
      rss: {
        scheduleEnabled: false,
        scheduleAt: '08:00',
        translationEnabled: true,
        locale: 'zh',
        batchSize: 3,
        egoBrowserPath: '',
      },
    },
  });

  await first.dispose();
  mountSettings(ctx, writes);
  await settle();
  assert.equal(writes.length, 1, 'a settings remount does not retry the migration');
});

test('an existing sources subtree is never rewritten by the migration', async (t) => {
  const ctx = new Context();
  ctx.plugin(FeedUltra, {
    workspacePath: '',
    retentionDays: 30,
    autoFetch: false,
    sources: {
      github_trending: { scheduleEnabled: true, scheduleAt: '21:30', translationEnabled: false },
    },
  });
  t.after(async () => {
    await ctx.fiber.dispose();
  });
  await settle();

  const writes: SettingsWrite[] = [];
  mountSettings(ctx, writes);
  await settle();

  assert.equal(writes.length, 0);
});
