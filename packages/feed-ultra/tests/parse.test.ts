import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeItemId, parseItemId } from '../src/contract/ids.ts';
import { githubTrendingExtraSchema, parse } from '../src/sources/github-trending/parse.ts';

const FIXTURE = fileURLToPath(new URL('../src/sources/github-trending/fixtures/trending-2026-11-10.html', import.meta.url));
const FETCHED_AT = '2026-11-10T08:00:00+08:00';

const TRENDING_ROW = (description: string): string => `<article class="Box-row">
  <h2><a href="/owner/repo">owner/repo</a></h2>
  <p class="col-9">${description}</p>
  <div class="f6">
    <span itemprop="programmingLanguage">Go</span>
    <a href="/owner/repo/stargazers">1,234</a>
    <a href="/owner/repo/forks">56</a>
    <span>78 stars today</span>
  </div>
</article>`;

async function parseFixture() {
  return parse(await readFile(FIXTURE, 'utf8'), FETCHED_AT);
}

test('reads every trending row in page order', async () => {
  const items = await parseFixture();
  assert.equal(items.length, 11);
  assert.deepEqual(
    items.map((item) => item.naturalKey),
    [
      'anthropics/skills',
      'meta/astryx',
      'sherlock-project/sherlock',
      'google-deepmind/mujoco',
      'anthropics/claude-quickstarts',
      'garrytan/gbrain',
      'vercel-labs/agent-browser',
      'ruvnet/RuView',
      'ZhuLinsen/daily_stock_analysis',
      'homeassistant-ai/ha-mcp',
      'milind-soni/OpenMausBot',
    ],
  );
  assert.deepEqual(
    items.map((item) => githubTrendingExtraSchema.parse(item.extra).rank),
    Array.from({ length: 11 }, (_unused, index) => index + 1),
  );
});

test('keeps the fields the panel renders', async () => {
  const [first] = await parseFixture();
  assert.ok(first);
  assert.equal(first.title, 'anthropics/skills');
  assert.equal(first.description, 'Public repository for Agent Skills');
  assert.equal(first.url, 'https://github.com/anthropics/skills');
  assert.equal(first.publishedAt, '2026-11-10T00:00:00.000Z');
  assert.deepEqual(githubTrendingExtraSchema.parse(first.extra), {
    rank: 1,
    stars: 191428,
    starsToday: 1038,
    forks: 22473,
    language: 'Python',
  });
});

test('composes the contract item id from the natural key', async () => {
  const [first] = await parseFixture();
  assert.ok(first);
  const id = composeItemId('github_trending', first.naturalKey);
  assert.equal(id, 'github_trending__anthropics%2Fskills');
  assert.deepEqual(parseItemId(id), { sourceId: 'github_trending', naturalKey: 'anthropics/skills' });
});

test('decodes entities in descriptions', () => {
  const [item] = parse(TRENDING_ROW('A &amp; B'), FETCHED_AT);
  assert.ok(item);
  assert.equal(item.description, 'A & B');
});

test('returns nothing for a page with no trending rows', () => {
  assert.deepEqual(parse('<html><body><p>nothing here</p></body></html>', FETCHED_AT), []);
});

test('throws when a row lost its counters instead of reporting zeros', () => {
  const html = `<article class="Box-row">
    <h2><a href="/owner/repo">owner/repo</a></h2>
    <p class="col-9">No counters</p>
    <div class="f6"><a href="/owner/repo/forks">56</a><span>78 stars today</span></div>
  </article>`;
  assert.throws(() => parse(html, FETCHED_AT), /cannot read stars/);
});
