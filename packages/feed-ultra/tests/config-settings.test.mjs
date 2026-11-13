import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isVolatilePath,
  projectForm,
  volatileForm,
} from '../node_modules/@deepseek-ai/dsh-settings/lib/types/schema.js';
import { Config } from '../src/settings.ts';

/**
 * The channel subtree is stored as `sources.<sourceId>.<field>`, so the settings service must
 * accept that exact path even though the source id is a dict key rather than a declared field.
 * If this regresses, `remote.settings.mutate` would reject every channel toggle (PRD v4 D4).
 */
test('the settings service accepts nested channel paths under the volatile subtree', () => {
  assert.equal(isVolatilePath(Config, ['sources', 'github_trending', 'scheduleEnabled']), true);
  assert.equal(isVolatilePath(Config, ['sources', 'github_trending', 'scheduleAt']), true);
  assert.equal(isVolatilePath(Config, ['sources', 'github_trending', 'translationEnabled']), true);
  assert.equal(isVolatilePath(Config, ['sources', 'future_source', 'scheduleAt']), true);
});

test('the other live leaves stay editable, and unknown paths do not', () => {
  assert.equal(isVolatilePath(Config, ['workspacePath']), true);
  assert.equal(isVolatilePath(Config, ['retentionDays']), true);
  assert.equal(isVolatilePath(Config, ['model', 'provider']), true);
  assert.equal(isVolatilePath(Config, ['autoFetch']), true);
  assert.equal(isVolatilePath(Config, ['nonsense']), false);
});

test('the projected form exposes the channel subtree instead of flattening it', () => {
  const form = volatileForm(Config);
  assert.ok(form, 'the config exposes at least one live field');
  assert.deepEqual(Object.keys(form.dict).sort(), [
    'autoFetch',
    'model',
    'retentionDays',
    'sources',
    'workspacePath',
  ]);

  const value = {
    workspacePath: '/workspace',
    retentionDays: 14,
    sources: { github_trending: { scheduleEnabled: false, scheduleAt: '21:30', translationEnabled: true } },
    model: { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' },
    undeclared: 'dropped',
  };
  const projected = projectForm(form, value);

  assert.deepEqual(projected.sources, value.sources);
  assert.deepEqual(projected.model, value.model);
  assert.equal(projected.retentionDays, 14);
  assert.equal(Object.hasOwn(projected, 'undeclared'), false);
});

test('the stored config keeps the legacy switch, live but hidden from generic forms', () => {
  const autoFetch = Config.dict.autoFetch;
  assert.ok(autoFetch, 'autoFetch is still declared for migration');
  assert.equal(autoFetch.meta.volatile, true, 'it stays editable so migration can read it live');
  assert.equal(autoFetch.meta.hidden, true, 'the global switch must not come back as a form row');
  assert.equal(Config.dict.sources.meta.volatile, true);
  assert.equal(Config.dict.model.meta.volatile, true);
});
