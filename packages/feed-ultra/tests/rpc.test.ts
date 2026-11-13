import assert from 'node:assert/strict';
import { test } from 'node:test';
import FeedUltra from '../src/index.ts';

const DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods';

const WIRE_PARAMETERS: Record<string, string[]> = {
  status: [],
  bindWorkspace: ['path'],
  sources: [],
  day: ['date'],
  calendar: ['from', 'to'],
  act: ['action', 'ids'],
  fetch: ['sourceId'],
  backfill: ['sourceId', 'day'],
  translate: ['sourceId', 'day'],
  models: [],
  modelEfforts: ['provider', 'model'],
  rssLibrary: [],
  rssLibraryMutate: ['ops'],
  rssPreview: ['url'],
};

function parameterNames(method: Function): string[] {
  const text = Function.prototype.toString.call(method);
  const open = text.indexOf('(');
  const close = text.indexOf(')', open);
  return text
    .slice(open + 1, close)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

test('the plugin declares a frozen version 1 descriptor for every endpoint', () => {
  const property = Object.getOwnPropertyDescriptor(FeedUltra.prototype, DESCRIPTOR_KEY);
  assert.ok(property, 'descriptor lives on the prototype');
  assert.equal(property.configurable, true);
  assert.equal(property.enumerable, false);
  assert.equal(property.writable, false);

  const descriptor = property.value as {
    version: number;
    methods: Array<{ method: string; invocation: { kind: string } }>;
  };
  assert.ok(Object.isFrozen(descriptor), 'descriptor cannot be mutated at runtime');
  assert.equal(descriptor.version, 1);
  assert.deepEqual(
    descriptor.methods.map((method) => method.method),
    Object.keys(WIRE_PARAMETERS),
  );
  for (const method of descriptor.methods) {
    assert.deepEqual(method.invocation, { kind: 'direct' });
  }
});

test('every declared endpoint is a prototype instance method with its wire parameter names', () => {
  for (const [name, expected] of Object.entries(WIRE_PARAMETERS)) {
    const method = (FeedUltra.prototype as unknown as Record<string, unknown>)[name];
    assert.equal(typeof method, 'function', `${name} is an instance method`);
    assert.ok(Object.hasOwn(FeedUltra.prototype, name), `${name} is declared on the prototype, not an instance field`);
    assert.deepEqual(parameterNames(method as Function), expected, `${name} wire parameters`);
    assert.equal((method as Function).length, expected.length, `${name} arity`);
  }
});

test('the plugin exposes its Config schema', () => {
  assert.ok(Object.hasOwn(FeedUltra, 'Config'));
  assert.equal(typeof FeedUltra.Config, 'function');
});
