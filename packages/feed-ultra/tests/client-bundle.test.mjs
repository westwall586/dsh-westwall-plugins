import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const SERVICES = ['slots', 'layout', 'sidebarRight', 'remote', 'locale', 'uiWorkspace', 'theme'];

const reactStub = {
  __esModule: true,
  createElement: () => null,
  Fragment: Symbol('Fragment'),
  useState: () => [],
  useEffect: () => {},
  useReducer: () => [],
  useRef: () => ({}),
  useCallback: fn => fn,
  useMemo: fn => fn(),
  useLayoutEffect: () => {},
};

function loadBundle() {
  let captured;
  const window = {
    __ModuleLoader__: {
      load(registration) {
        captured = registration;
      },
    },
  };
  const context = vm.createContext({ window, console, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(SOURCE, context, { filename: 'client.js' });
  assert.ok(captured, 'the bundle registered through window.__ModuleLoader__');
  return captured;
}

test('the generated bundle registers the dsh-feed-ultra plugin contract', () => {
  assert.match(SOURCE, /id: '@westwall\/dsh-feed-ultra'/);
  assert.match(SOURCE, /return DshFeedUltraClient\.default;/);

  const registration = loadBundle();
  assert.equal(registration.id, '@westwall/dsh-feed-ultra');
  assert.equal(typeof registration.factory, 'function');

  const plugin = registration.factory((name) => {
    assert.equal(name, 'react');
    return reactStub;
  });
  assert.ok(Array.isArray(plugin.inject));
  for (const service of SERVICES) assert.ok(plugin.inject.includes(service), `injects ${service}`);
  assert.equal(typeof plugin.apply, 'function');
});

test('a second factory evaluation keeps the same module shape', () => {
  const registration = loadBundle();
  const first = registration.factory(() => reactStub);
  const second = registration.factory(() => reactStub);

  assert.deepEqual(second.inject, first.inject);
  assert.equal(typeof second.apply, typeof first.apply);
  assert.equal(second.apply.length, first.apply.length);
});
