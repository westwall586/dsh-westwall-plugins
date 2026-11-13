export interface FetchScriptArgs {
  space: string;
  count: number;
  excludeKeys: readonly string[];
}

export interface DeleteScriptArgs {
  space: string;
  url: string;
}

const FETCH_BODY = String.raw`
const MARK = '@@FEEDULTRA@@ ';
const started = Date.now();
const emit = (value) => console.log(MARK + JSON.stringify(value));
const stage = (name, fields) =>
  emit(Object.assign({ type: 'stage', stage: name, ms: Date.now() - started }, fields || {}));

class ScriptFailure extends Error {
  constructor(kind, message, evidencePath) {
    super(message);
    this.kind = kind;
    this.evidencePath = evidencePath;
  }
}

let task = null;
let page = null;
let evidence = null;

async function captureEvidence() {
  if (evidence) return evidence;
  try {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-feed-ultra-x-'));
    try {
      const shot = await page.screenshot({ path: path.join(dir, 'evidence.png') });
      if (shot) evidence = shot;
    } catch (_) {}
    try {
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      const file = path.join(dir, 'evidence.html');
      await fs.writeFile(file, typeof html === 'string' ? html : String(html), 'utf8');
      evidence = file;
    } catch (_) {}
  } catch (_) {}
  return evidence;
}

try {
  stage('start', { requested: ARGS.count, excludeCount: ARGS.excludeKeys.length, space: ARGS.space });
  task = await taskSpace(ARGS.space);
  page = task.page('p1');
  await page.cdp('Network.enable');

  let gotoMs = 0;
  let gotoTimeout = false;
  const gotoStarted = Date.now();
  try {
    await page.goto('https://x.com/i/history', { timeout: 45000 });
  } catch (_) {
    gotoTimeout = true;
  }
  gotoMs = Date.now() - gotoStarted;

  let finalUrl = '';
  try {
    finalUrl = await page.url();
  } catch (_) {}
  let loginForm = false;
  try {
    loginForm = await page.evaluate(() => !!document.querySelector('input[autocomplete="username"]'));
  } catch (_) {}
  stage('goto', { ms: gotoMs, timeout: gotoTimeout, login: finalUrl.includes('/login') || loginForm });
  if (finalUrl.includes('/login') || loginForm) {
    throw new ScriptFailure('auth', 'X 登录态失效，请在 Ego Browser 登录 x.com 后重试');
  }

  let netUrl = null;
  const captureDeadline = Date.now() + 20000;
  while (netUrl === null && Date.now() < captureDeadline) {
    let events = [];
    try {
      events = await page.events();
    } catch (_) {}
    const urls = (events || [])
      .map((event) => event && event.params && event.params.request && event.params.request.url)
      .filter((url) => typeof url === 'string' && /\/i\/api\/graphql\/[^/]+\/Bookmarks\?/.test(url));
    if (urls.length > 0) netUrl = urls[urls.length - 1];
    else await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (netUrl === null) {
    stage('capture', { captured: false });
    throw new ScriptFailure(
      'drift',
      '未捕获到页面自身的 /i/api/graphql/*/Bookmarks 请求，接口路径可能已变化',
      await captureEvidence(),
    );
  }
  const queryId = (netUrl.match(/\/i\/api\/graphql\/([^/]+)\/Bookmarks/) || [])[1] || 'unknown';
  const features = new URL(netUrl).searchParams.get('features');
  stage('capture', { captured: true, queryId: queryId, features: features ? 'present' : 'missing' });

  const replayed = await page.evaluate(async (input) => {
    const ct0Cookie = document.cookie.split('; ').find((cookie) => cookie.startsWith('ct0='));
    const csrf = ct0Cookie ? ct0Cookie.slice(4) : '';
    if (!csrf) return { error: { kind: 'auth', message: 'cookie 里没有 ct0，登录态异常' } };

    const mainJs = Array.from(document.querySelectorAll('link[href*="abs.twimg.com"]'))
      .map((link) => link.href)
      .find((href) => /\/main\.[a-z0-9]+\.js(?:\?|$)/.test(href));
    if (!mainJs) return { error: { kind: 'drift', message: '页面里找不到 main.*.js 引用，无法提取 bearer' } };

    let bundle = '';
    try {
      bundle = await (await fetch(mainJs)).text();
    } catch (_) {
      return { error: { kind: 'drift', message: '读取 main.*.js 失败' } };
    }
    const bearer = bundle.match(/AAAAAAAAAAAAAAAAAAAAANRILg[^"']+/);
    if (!bearer) return { error: { kind: 'drift', message: 'main.*.js 里没提取到 bearer token' } };

    const headers = {
      authorization: 'Bearer ' + bearer[0],
      'x-csrf-token': csrf,
      'x-twitter-auth-type': 'OAuth2Session',
    };
    const excluded = new Set(input.excludeKeys);
    const entries = [];
    const seen = new Set();
    let cursor = null;
    let scanned = 0;
    let exhausted = false;
    let truncated = false;

    while (entries.length < input.count) {
      if (Date.now() >= input.deadlineMs) {
        truncated = true;
        break;
      }
      if (scanned >= input.maxScan) {
        truncated = true;
        break;
      }
      const url = new URL(input.netUrl);
      const variables = cursor === null
        ? { count: input.perPageMax, includePromotedContent: true }
        : { count: input.perPageMax, cursor: cursor, includePromotedContent: true };
      url.searchParams.set('variables', JSON.stringify(variables));

      let response;
      try {
        response = await fetch(url, { credentials: 'include', headers: headers });
      } catch (error) {
        return {
          error: {
            kind: 'network',
            message: '重放 Bookmarks 接口失败：' + String(error && error.message ? error.message : error),
          },
        };
      }
      if (response.status === 401 || response.status === 403) {
        return { error: { kind: 'auth', message: 'X 登录态失效（Bookmarks 接口返回 ' + response.status + '）' } };
      }
      if (!response.ok) {
        return { error: { kind: 'drift', message: 'Bookmarks 接口返回 HTTP ' + response.status } };
      }
      let body;
      try {
        body = await response.json();
      } catch (_) {
        return { error: { kind: 'drift', message: 'Bookmarks 响应不是 JSON' } };
      }
      const timeline = body && body.data && body.data.bookmark_timeline_v2 && body.data.bookmark_timeline_v2.timeline;
      const instructions = timeline && timeline.instructions;
      if (!Array.isArray(instructions)) {
        return { error: { kind: 'drift', message: 'Bookmarks 响应缺少 timeline.instructions' } };
      }

      const pageEntries = [];
      for (const instruction of instructions) {
        if (instruction && Array.isArray(instruction.entries)) {
          for (const entry of instruction.entries) pageEntries.push(entry);
        }
      }

      let bottom = null;
      for (const entry of pageEntries) {
        if (!entry || typeof entry.entryId !== 'string') continue;
        if (entry.entryId.startsWith('cursor-bottom-')) {
          bottom = entry.content && entry.content.value ? entry.content.value : null;
          continue;
        }
        if (!entry.entryId.startsWith('tweet-')) continue;
        scanned += 1;
        const result =
          entry.content &&
          entry.content.itemContent &&
          entry.content.itemContent.tweet_results &&
          entry.content.itemContent.tweet_results.result;
        const legacy = result && result.legacy;
        const id = (legacy && legacy.id_str) || (result && result.rest_id) || '';
        if (!id || excluded.has(id) || seen.has(id)) continue;
        seen.add(id);
        entries.push(entry);
        if (entries.length >= input.count) break;
      }

      if (entries.length >= input.count) {
        exhausted = bottom === null;
        break;
      }
      if (bottom === null) {
        exhausted = true;
        break;
      }
      cursor = bottom;
    }

    return { entries: entries, scanned: scanned, exhausted: exhausted, truncated: truncated };
  }, {
    netUrl: netUrl,
    count: ARGS.count,
    excludeKeys: ARGS.excludeKeys,
    maxScan: 1000,
    deadlineMs: started + 85000,
    perPageMax: 100,
  });

  if (replayed && replayed.error) {
    throw new ScriptFailure(
      replayed.error.kind || 'drift',
      replayed.error.message || 'Bookmarks 重放失败',
      await captureEvidence(),
    );
  }
  stage('parse', {
    scanned: replayed.scanned,
    collected: replayed.entries.length,
    exhausted: replayed.exhausted,
    truncated: replayed.truncated,
  });
  emit({
    type: 'result',
    ok: true,
    value: {
      entries: replayed.entries,
      scanned: replayed.scanned,
      exhausted: replayed.exhausted,
      truncated: replayed.truncated,
    },
  });
} catch (error) {
  emit({
    type: 'result',
    ok: false,
    kind: error && error.kind ? error.kind : 'drift',
    error: String(error && error.message ? error.message : error),
    evidencePath: error && error.evidencePath ? error.evidencePath : undefined,
  });
} finally {
  try {
    if (task) await task.finish({ keep: [] });
  } catch (_) {}
}
`;

const DELETE_BODY = String.raw`
const MARK = '@@FEEDULTRA@@ ';
const started = Date.now();
const emit = (value) => console.log(MARK + JSON.stringify(value));
const stage = (name, fields) =>
  emit(Object.assign({ type: 'stage', stage: name, ms: Date.now() - started }, fields || {}));

class ScriptFailure extends Error {
  constructor(kind, message, evidencePath) {
    super(message);
    this.kind = kind;
    this.evidencePath = evidencePath;
  }
}

let task = null;
let page = null;
let evidence = null;

async function captureEvidence() {
  if (evidence) return evidence;
  try {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-feed-ultra-x-'));
    try {
      const shot = await page.screenshot({ path: path.join(dir, 'evidence.png') });
      if (shot) evidence = shot;
    } catch (_) {}
    try {
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      const file = path.join(dir, 'evidence.html');
      await fs.writeFile(file, typeof html === 'string' ? html : String(html), 'utf8');
      evidence = file;
    } catch (_) {}
  } catch (_) {}
  return evidence;
}

try {
  stage('start', { space: ARGS.space });
  task = await taskSpace(ARGS.space);
  page = task.page('p1');

  let gotoMs = 0;
  let gotoTimeout = false;
  const gotoStarted = Date.now();
  try {
    await page.goto(ARGS.url, { timeout: 45000 });
  } catch (_) {
    gotoTimeout = true;
  }
  gotoMs = Date.now() - gotoStarted;

  let finalUrl = '';
  try {
    finalUrl = await page.url();
  } catch (_) {}
  let loginForm = false;
  try {
    loginForm = await page.evaluate(() => !!document.querySelector('input[autocomplete="username"]'));
  } catch (_) {}
  stage('goto', { ms: gotoMs, timeout: gotoTimeout, login: finalUrl.includes('/login') || loginForm });
  if (finalUrl.includes('/login') || loginForm) {
    throw new ScriptFailure('auth', 'X 登录态失效，请在 Ego Browser 登录 x.com 后重试');
  }

  try {
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
  } catch (_) {
    throw new ScriptFailure('drift', '推文详情页没有加载出主推文', await captureEvidence());
  }

  const toggled = await page.evaluate(async (url) => {
    // A reply permalink renders its ancestors above the focal tweet, so the first
    // article can be a different tweet. Pin the focal article by its status id.
    const focusId = (String(url).match(/\/status\/(\d+)/) || [])[1] || '';
    const findArticle = () => {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if (focusId === '') return articles[0] || null;
      const hit = articles.find((node) =>
        node.querySelector('a[href*="/status/' + focusId + '"]') !== null);
      return hit || null;
    };
    const control = (article) => article === null
      ? null
      : article.querySelector('[data-testid="removeBookmark"]') || article.querySelector('[data-testid="bookmark"]');
    let article = findArticle();
    const controlDeadline = Date.now() + 10000;
    while (control(article) === null && Date.now() < controlDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      article = findArticle();
    }
    if (article === null) return { outcome: 'drift', reason: 'no-article' };
    if (control(article) === null) return { outcome: 'drift', reason: 'no-bookmark-button' };

    const clickRemove = () => {
      const remove = article.querySelector('[data-testid="removeBookmark"]');
      if (remove !== null) remove.click();
      return remove !== null;
    };
    if (!clickRemove()) {
      // A bookmarked tweet can render the add control before hydration swaps in
      // the remove control; only declare "already" after that grace period.
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!clickRemove()) return { outcome: 'already' };
    }
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const stillRemove = article.querySelector('[data-testid="removeBookmark"]');
      const nowAdd = article.querySelector('[data-testid="bookmark"]');
      const label = (nowAdd && nowAdd.getAttribute('aria-label')) || '';
      if (!stillRemove && nowAdd && label.indexOf('已加入书签') === -1) {
        return { outcome: 'deleted' };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { outcome: 'drift', reason: 'toggle-timeout' };
  }, ARGS.url);

  if (toggled.outcome !== 'deleted' && toggled.outcome !== 'already') {
    throw new ScriptFailure(
      'drift',
      '删除书签失败（' + (toggled.reason || 'unknown') + '）',
      await captureEvidence(),
    );
  }
  stage('delete', { outcome: toggled.outcome });
  emit({ type: 'result', ok: true, value: { outcome: toggled.outcome } });
} catch (error) {
  emit({
    type: 'result',
    ok: false,
    kind: error && error.kind ? error.kind : 'drift',
    error: String(error && error.message ? error.message : error),
    evidencePath: error && error.evidencePath ? error.evidencePath : undefined,
  });
} finally {
  try {
    if (task) await task.finish({ keep: [] });
  } catch (_) {}
}
`;

function prelude(args: Record<string, unknown>): string {
  return `const ARGS = ${JSON.stringify(args)};`;
}

/** Self-contained plain JS; `ego-browser nodejs` receives it on stdin. */
export function buildFetchScript(args: FetchScriptArgs): string {
  return `${prelude({ space: args.space, count: args.count, excludeKeys: args.excludeKeys })}\n${FETCH_BODY}`;
}

export function buildDeleteScript(args: DeleteScriptArgs): string {
  return `${prelude({ space: args.space, url: args.url })}\n${DELETE_BODY}`;
}
