import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPublicHttpUrl, createPinnedLookup, type GuardAddress } from '../src/sources/rss/guard.ts';
import { SourceFetchError } from '../src/sources/types.ts';

const PUBLIC = async () => [{ address: '93.184.216.34', family: 4 }];

async function rejects(raw: string, options = {}): Promise<SourceFetchError> {
  try {
    await assertPublicHttpUrl(raw, options);
  } catch (error) {
    assert.ok(error instanceof SourceFetchError, `expected SourceFetchError for ${raw}`);
    return error;
  }
  assert.fail(`expected ${raw} to be rejected`);
}

test('public http and https URLs pass with a public DNS answer', async () => {
  assert.equal((await assertPublicHttpUrl('https://example.com/feed', { lookup: PUBLIC })).hostname, 'example.com');
  assert.equal((await assertPublicHttpUrl('http://example.com/feed', { lookup: PUBLIC })).hostname, 'example.com');
  assert.equal((await assertPublicHttpUrl('http://93.184.216.34/feed')).hostname, '93.184.216.34');
  assert.equal((await assertPublicHttpUrl('http://[2606:4700:4700::1111]/feed')).hostname, '[2606:4700:4700::1111]');
});

test('only absolute http and https URLs with no credentials are allowed', async () => {
  await rejects('file:///etc/passwd');
  await rejects('ftp://example.com/feed');
  await rejects('/relative/feed');
  await rejects('https://user:secret@example.com/feed', { lookup: PUBLIC });
});

test('loopback, private and reserved IPv4 literals are rejected', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://127.1.2.3/',
    'http://10.0.0.1/',
    'http://172.16.5.4/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://224.0.0.1/',
  ]) {
    await rejects(url);
  }
});

test('loopback, unique-local and IPv4-mapped IPv6 literals are rejected', async () => {
  for (const url of [
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/',
  ]) {
    await rejects(url);
  }
});

test('local host names are rejected before DNS', async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return [{ address: '93.184.216.34', family: 4 }];
  };
  for (const url of [
    'http://localhost/feed',
    'http://app.localhost/feed',
    'http://printer.local/feed',
    'http://metadata.google.internal/feed',
  ]) {
    await rejects(url, { lookup });
  }
  assert.equal(calls, 0);
});

test('DNS answers are all checked, and one private address blocks the URL', async () => {
  const mixed = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.7', family: 4 },
  ];
  const privateV6 = async () => [{ address: 'fd00::1', family: 6 }];
  assert.match((await rejects('https://example.com/feed', { lookup: mixed })).message, /10\.0\.0\.7/);
  assert.match((await rejects('https://example.com/feed', { lookup: privateV6 })).message, /fd00::1/);
});

test('a resolver failure is a network error, not a blocked URL', async () => {
  const lookup = async () => {
    throw new Error('ENOTFOUND');
  };
  const error = await rejects('https://missing.example/feed', { lookup });
  assert.equal(error.kind, 'network');
  assert.match(error.message, /ENOTFOUND/);
});


type Resolved = { address: string | GuardAddress[]; family?: number };

function runLookup(
  lookup: ReturnType<typeof createPinnedLookup>,
  options: { all?: boolean } = {},
): Promise<Resolved> {
  return new Promise((resolve, reject) => {
    lookup('example.com', options, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

test('the pinned lookup returns the checked address and family', async () => {
  const lookup = createPinnedLookup(async () => [{ address: '93.184.216.34', family: 4 }]);
  assert.deepEqual(await runLookup(lookup), { address: '93.184.216.34', family: 4 });
});

test('the pinned lookup refuses private and mixed answers', async () => {
  const privateLookup = createPinnedLookup(async () => [{ address: '10.0.0.7', family: 4 }]);
  const mixedLookup = createPinnedLookup(async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.7', family: 4 },
  ]);
  await assert.rejects(runLookup(privateLookup), /blocked address/);
  await assert.rejects(runLookup(mixedLookup), /blocked address/);
});

test('the pinned lookup blocks a rebinding second answer', async () => {
  let calls = 0;
  const lookup = createPinnedLookup(async () => {
    calls += 1;
    return calls === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }];
  });
  assert.deepEqual(await runLookup(lookup), { address: '93.184.216.34', family: 4 });
  await assert.rejects(runLookup(lookup), /blocked address/);
});

test('the pinned lookup returns every checked address when all is requested', async () => {
  const lookup = createPinnedLookup(async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
  const resolved = await runLookup(lookup, { all: true });
  assert.deepEqual(resolved.address, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);
});
