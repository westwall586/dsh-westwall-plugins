import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  EgoBridgeError,
  parseMarkers,
  resolveEgoBrowser,
  runEgoScript,
} from '../src/sources/x-bookmarks/bridge.ts';

type FakeMode = 'success' | 'empty-stdout' | 'auth' | 'crash' | 'timeout';

const FAKE = String.raw`#!/usr/bin/env node
const mode = process.env.FAKE_EGO_MODE || 'success';
if (process.argv[2] === '--version') {
  process.stderr.write('ego-browser fake 0.1\n');
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const mark = (value) => process.stderr.write('@@FEEDULTRA@@ ' + JSON.stringify(value) + '\n');
  if (mode === 'timeout') {
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'crash') {
    process.stderr.write('boom from fake\n');
    process.exit(2);
  }
  mark({ type: 'stage', stage: 'goto', ms: 5, login: false });
  if (mode === 'auth') {
    mark({ type: 'result', ok: false, kind: 'auth', error: 'login expired', evidencePath: '/tmp/evidence.html' });
    return;
  }
  if (mode !== 'empty-stdout') process.stdout.write('stdout junk that must be ignored\n');
  mark({ type: 'result', ok: true, value: { receivedScript: input.includes('const ARGS'), mode: mode } });
});
`;

async function fakeEgo(t: TestContext, mode: FakeMode): Promise<{ executable: string; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-fake-ego-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'ego-browser');
  await writeFile(executable, FAKE, 'utf8');
  await chmod(executable, 0o755);
  process.env.FAKE_EGO_MODE = mode;
  t.after(() => {
    delete process.env.FAKE_EGO_MODE;
  });
  return { executable, dir };
}

test('the bridge reads the result from stderr and ignores stdout', async (t) => {
  const { executable } = await fakeEgo(t, 'success');
  const stages: string[] = [];

  const result = await runEgoScript({
    script: 'const ARGS = {"count":3};',
    browserPath: executable,
    timeoutMs: 5000,
    log: (message) => stages.push(message),
  });

  assert.deepEqual(result.value, { receivedScript: true, mode: 'success' });
  assert.deepEqual(
    result.stages.map((stage) => stage.stage),
    ['goto'],
  );
  assert.match(result.version, /ego-browser fake 0.1/);
  assert.equal(result.executable, executable);
  assert.ok(stages.includes('browser'));
  assert.ok(stages.includes('goto'));
});

test('an empty stdout still yields the stderr result', async (t) => {
  const { executable } = await fakeEgo(t, 'empty-stdout');
  const result = await runEgoScript({ script: 'const ARGS = {};', browserPath: executable, timeoutMs: 5000 });
  assert.deepEqual(result.value, { receivedScript: true, mode: 'empty-stdout' });
});

test('a non-zero exit without a result marker is a drift error with the stderr tail', async (t) => {
  const { executable } = await fakeEgo(t, 'crash');

  await assert.rejects(
    runEgoScript({ script: 'const ARGS = {};', browserPath: executable, timeoutMs: 5000 }),
    (error: unknown) =>
      error instanceof EgoBridgeError && error.kind === 'drift' && /boom from fake/.test(error.message),
  );
});

test('the bridge SIGKILLs a timed-out child and reports timeout', async (t) => {
  const { executable } = await fakeEgo(t, 'timeout');
  const started = Date.now();

  await assert.rejects(
    runEgoScript({ script: 'const ARGS = {};', browserPath: executable, timeoutMs: 150 }),
    (error: unknown) => error instanceof EgoBridgeError && error.kind === 'timeout',
  );
  assert.ok(Date.now() - started < 3000, 'the timeout returns instead of waiting for the child');
});

test('a failure result carries its kind and evidence path', async (t) => {
  const { executable } = await fakeEgo(t, 'auth');

  await assert.rejects(
    runEgoScript({ script: 'const ARGS = {};', browserPath: executable, timeoutMs: 5000 }),
    (error: unknown) =>
      error instanceof EgoBridgeError &&
      error.kind === 'auth' &&
      error.message === 'login expired' &&
      error.evidencePath === '/tmp/evidence.html',
  );
});

test('resolveEgoBrowser prefers the explicit path, then EGO_BROWSER_PATH', async (t) => {
  const { executable, dir } = await fakeEgo(t, 'success');
  const envExecutable = path.join(dir, 'env-ego-browser');
  await writeFile(envExecutable, FAKE, 'utf8');
  await chmod(envExecutable, 0o755);

  assert.equal(await resolveEgoBrowser(executable), executable);

  const previous = process.env.EGO_BROWSER_PATH;
  process.env.EGO_BROWSER_PATH = envExecutable;
  t.after(() => {
    if (previous === undefined) delete process.env.EGO_BROWSER_PATH;
    else process.env.EGO_BROWSER_PATH = previous;
  });
  assert.equal(await resolveEgoBrowser(), envExecutable);
});

test('an absent executable is reported as install, not as a generic failure', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-feed-ultra-empty-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));

  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  const previousEnv = process.env.EGO_BROWSER_PATH;
  process.env.HOME = home;
  process.env.PATH = '';
  delete process.env.EGO_BROWSER_PATH;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousEnv === undefined) delete process.env.EGO_BROWSER_PATH;
    else process.env.EGO_BROWSER_PATH = previousEnv;
  });

  await assert.rejects(
    resolveEgoBrowser(),
    (error: unknown) => error instanceof EgoBridgeError && error.kind === 'install' && /Ego Browser/.test(error.message),
  );
});

test('parseMarkers ignores malformed and non-marker lines', () => {
  const markers = parseMarkers(
    [
      'ordinary stderr',
      '@@FEEDULTRA@@ not json',
      '@@FEEDULTRA@@ {"type":"stage","stage":"goto","ms":3}',
      '@@FEEDULTRA@@ {"type":"result","ok":true,"value":{"scanned":2}}',
    ].join('\n'),
  );

  assert.equal(markers.stages.length, 1);
  assert.deepEqual(markers.result, { type: 'result', ok: true, value: { scanned: 2 } });
});
