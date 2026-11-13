import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { buildDeleteScript, buildFetchScript } from '../src/sources/x-bookmarks/script.ts';

async function check(t: TestContext, name: string, script: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-script-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, `${name}.mjs`);
  await writeFile(file, script, 'utf8');
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('the fetch script is valid plain JS with every input baked in', async (t) => {
  const script = buildFetchScript({ space: 'dsh-feed-ultra-x-bookmarks-1', count: 3, excludeKeys: ['a', 'b'] });

  assert.match(script, /^const ARGS = \{/);
  assert.match(script, /"count":3/);
  assert.match(script, /"excludeKeys":\["a","b"\]/);
  assert.match(script, /@@FEEDULTRA@@/);
  assert.match(script, /task\.finish\(\{ keep: \[\] \}\)/);
  assert.match(script, /cursor-bottom-/);
  assert.match(script, /includePromotedContent: true/);
  assert.doesNotMatch(script, /^\s*import\s/m, 'the script has no static imports');
  await check(t, 'fetch', script);
});

test('the delete script is valid plain JS and never uses page.click', async (t) => {
  const script = buildDeleteScript({ space: 'dsh-feed-ultra-x-delete-1', url: 'https://x.com/author/status/1' });

  assert.match(script, /^const ARGS = \{/);
  assert.match(script, /"url":"https:\/\/x.com\/author\/status\/1"/);
  assert.match(script, /removeBookmark/);
  assert.match(script, /article\.querySelector/);
  assert.match(script, /\.click\(\)/);
  assert.doesNotMatch(script, /page\.click\(/, 'the off-screen click must go through evaluate');
  assert.match(script, /task\.finish\(\{ keep: \[\] \}\)/);
  assert.doesNotMatch(script, /^\s*import\s/m, 'the script has no static imports');
  await check(t, 'delete', script);
});

test('the delete script pins the focal tweet, not the first rendered article', async (t) => {
  const script = buildDeleteScript({ space: 'dsh-feed-ultra-x-delete-2', url: 'https://x.com/author/status/123' });

  // A reply permalink renders ancestors above the focal tweet, so the article must
  // be chosen by its status id from the URL rather than by DOM order.
  assert.match(script, /const focusId = /);
  assert.ok(script.includes("a[href*=\"/status/' + focusId + '\"]"), 'the article is located by status id');
  assert.ok(script.includes('}, ARGS.url);'), 'the url reaches the page callback');

  // The action bar hydrates after the article; deciding before a control exists
  // would report a false drift or a false "already deleted".
  assert.ok(script.includes('controlDeadline'), 'the script waits for a bookmark control');
  assert.ok(script.includes("if (!clickRemove())"), 'remove is retried after the hydration grace period');
  assert.ok(script.includes('setTimeout(resolve, 800)'), 'the already decision waits one grace period');
  await check(t, 'delete-focus', script);
});
