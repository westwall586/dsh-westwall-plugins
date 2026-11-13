import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { FetchLog } from '../types.ts';

export type BridgeKind = 'install' | 'auth' | 'drift' | 'timeout' | 'network';

const MARKER = '@@FEEDULTRA@@ ';
const DEFAULT_TIMEOUT_MS = 90_000;
const VERSION_TIMEOUT_MS = 5_000;
const TAIL_LENGTH = 500;

export class EgoBridgeError extends Error {
  readonly kind: BridgeKind;
  readonly evidencePath: string | undefined;

  constructor(kind: BridgeKind, message: string, options: { evidencePath?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'EgoBridgeError';
    this.kind = kind;
    this.evidencePath = options.evidencePath;
  }
}

interface StageMarker {
  type: 'stage';
  stage: string;
  ms?: number;
  [key: string]: unknown;
}

type ResultMarker =
  | { type: 'result'; ok: true; value: unknown }
  | { type: 'result'; ok: false; kind: string; error: string; evidencePath?: string };

interface Markers {
  stages: StageMarker[];
  result: ResultMarker | undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isStage(value: Record<string, unknown>): value is StageMarker & Record<string, unknown> {
  return value.type === 'stage' && typeof value.stage === 'string';
}

function isResult(value: Record<string, unknown>): value is ResultMarker & Record<string, unknown> {
  return value.type === 'result' && typeof value.ok === 'boolean';
}

/** Only `@@FEEDULTRA@@` lines matter; stdout is empty and everything else on stderr is noise. */
export function parseMarkers(stderr: string): Markers {
  const stages: StageMarker[] = [];
  let result: ResultMarker | undefined;

  for (const line of stderr.split(/\r?\n/)) {
    if (!line.startsWith(MARKER)) continue;
    let value: unknown;
    try {
      value = JSON.parse(line.slice(MARKER.length));
    } catch {
      continue;
    }
    const node = record(value);
    if (node === null) continue;
    if (isStage(node)) {
      stages.push(node);
    } else if (isResult(node)) {
      if (node.ok === true) {
        result = { type: 'result', ok: true, value: node.value };
      } else {
        result = {
          type: 'result',
          ok: false,
          kind: typeof node.kind === 'string' ? node.kind : 'drift',
          error: typeof node.error === 'string' ? node.error : 'ego-browser 失败',
          ...(typeof node.evidencePath === 'string' ? { evidencePath: node.evidencePath } : {}),
        };
      }
    }
  }

  return { stages, result };
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `egoBrowserPath` → `EGO_BROWSER_PATH` → PATH → `~/.local/bin`, matching how M0 launched
 * the helper from a GUI-like environment.
 */
export async function resolveEgoBrowser(browserPath?: string): Promise<string> {
  const candidates: string[] = [];
  if (browserPath !== undefined && browserPath.trim() !== '') candidates.push(browserPath.trim());
  const fromEnv = process.env.EGO_BROWSER_PATH;
  if (fromEnv !== undefined && fromEnv.trim() !== '') candidates.push(fromEnv.trim());
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir !== '') candidates.push(path.join(dir, 'ego-browser'));
  }
  candidates.push(path.join(homedir(), '.local', 'bin', 'ego-browser'));

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  throw new EgoBridgeError(
    'install',
    '未检测到 Ego Browser（ego-browser）；请先安装，或在渠道设置里配置 egoBrowserPath',
  );
}

function probeVersion(executable: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(executable, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let text = '';
    let settled = false;
    const finish = (value: string): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish('unknown');
    }, VERSION_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      text += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      text += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish('unknown');
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish(text.split(/\r?\n/).find((line) => line.trim() !== '') ?? 'unknown');
    });
  });
}

interface Collected {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
}

function spawnAndCollect(executable: string, script: string, timeoutMs: number): Promise<Collected> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['nodejs'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new EgoBridgeError('install', `无法启动 ego-browser：${error.message}`, { cause: error }));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal, timedOut });
    });
    // The child can die before consuming stdin; an EPIPE is not the failure worth reporting.
    child.stdin?.on('error', () => {});
    child.stdin?.end(script);
  });
}

/** Failure messages may carry the stderr tail, but marker lines contain entries and are dropped. */
function stderrTail(stderr: string): string {
  const text = stderr
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(MARKER))
    .join('\n')
    .trim();
  return text.slice(-TAIL_LENGTH);
}

export interface RunScriptOptions {
  script: string;
  timeoutMs?: number;
  browserPath?: string;
  log?: FetchLog;
}

export interface ScriptRun {
  value: unknown;
  stages: StageMarker[];
  stderr: string;
  elapsedMs: number;
  executable: string;
  version: string;
}

export async function runEgoScript(options: RunScriptOptions): Promise<ScriptRun> {
  const started = Date.now();
  const executable = await resolveEgoBrowser(options.browserPath);
  const version = await probeVersion(executable);
  options.log?.('browser', { path: executable, version, ms: Date.now() - started });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const collected = await spawnAndCollect(executable, options.script, timeoutMs);
  const elapsedMs = Date.now() - started;
  const { stages, result } = parseMarkers(collected.stderr);
  for (const stage of stages) {
    const { type: _type, stage: name, ...fields } = stage;
    options.log?.(name, fields);
  }

  if (collected.timedOut) {
    throw new EgoBridgeError('timeout', `ego-browser 超过 ${timeoutMs}ms 被强制终止`);
  }
  if (result !== undefined) {
    if (!result.ok) {
      throw new EgoBridgeError(result.kind as BridgeKind, result.error, { evidencePath: result.evidencePath });
    }
    return { value: result.value, stages, stderr: collected.stderr, elapsedMs, executable, version };
  }

  const tail = stderrTail(collected.stderr);
  const suffix = tail === '' ? '' : `：${tail}`;
  if (collected.code !== 0) {
    throw new EgoBridgeError(
      'drift',
      `ego-browser 退出码 ${String(collected.code)}${collected.signal === null ? '' : `（${collected.signal}）`}${suffix}`,
    );
  }
  throw new EgoBridgeError('drift', `ego-browser 没有返回结果标记${suffix}`);
}
