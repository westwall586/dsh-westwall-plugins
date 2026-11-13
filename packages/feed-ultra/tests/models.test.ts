import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectModelEfforts, collectModels, type LlmLike } from '../src/engine/models.ts';

function llm(overrides: Partial<LlmLike> = {}): LlmLike {
  return {
    listProviders: () => [
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'broken', name: 'Broken' },
    ],
    async listModels(provider: string) {
      if (provider === 'broken') throw new Error('catalog unavailable');
      return [{ provider, id: 'flash', name: 'Flash' }];
    },
    async resolveModelInfo(provider: string, model: string) {
      if (model === 'rejecting') throw new Error('unsupported model');
      return {
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: 'low', name: '低' },
            { id: 'high', name: '高', description: '更慢更准' },
          ],
          defaultEffort: 'low',
        },
      };
    },
    ...overrides,
  };
}

function healthyLlm(): LlmLike {
  return llm({ listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }] });
}

test('models() returns the catalog plus the resolved selection', async () => {
  const view = await collectModels({
    llm: healthyLlm(),
    following: true,
    readDefault: () => ({ provider: 'deepseek', model: 'flash' }),
  });

  assert.deepEqual(view.providers, [{ id: 'deepseek', name: 'DeepSeek' }]);
  assert.deepEqual(view.models.deepseek, [{ id: 'flash', name: 'Flash' }]);
  assert.deepEqual(view.selected, { provider: 'deepseek', model: 'flash' });
  assert.equal(view.following, true);
  assert.equal(view.error, '');
});

test('an explicit choice is reported as not following', async () => {
  const view = await collectModels({
    llm: llm(),
    following: false,
    readDefault: () => ({ provider: 'deepseek', model: 'flash', reasoningEffort: 'high' }),
  });

  assert.equal(view.following, false);
  assert.deepEqual(view.selected, { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' });
});

test('one provider catalog failing does not blank the others', async () => {
  const view = await collectModels({ llm: llm(), following: true, readDefault: () => null });

  assert.deepEqual(view.models.deepseek, [{ id: 'flash', name: 'Flash' }]);
  assert.deepEqual(view.models.broken, []);
  assert.match(view.error, /catalog unavailable/);
});

test('a missing llm service degrades to an explained empty catalog', async () => {
  const view = await collectModels({
    llm: null,
    following: true,
    readDefault: () => ({ provider: 'deepseek', model: 'flash' }),
  });

  assert.deepEqual(view.providers, []);
  assert.deepEqual(view.selected, { provider: 'deepseek', model: 'flash' });
  assert.match(view.error, /unavailable/);
});

test('an unreadable default selection is reported instead of thrown', async () => {
  const view = await collectModels({
    llm: llm(),
    following: true,
    readDefault: () => {
      throw new Error('no default configured');
    },
  });

  assert.equal(view.selected, null);
  assert.match(view.error, /no default configured/);
});

test('a provider list that throws surfaces as an empty catalog with the reason', async () => {
  const view = await collectModels({
    llm: llm({
      listProviders: () => {
        throw new Error('registry down');
      },
    }),
    following: true,
    readDefault: () => null,
  });

  assert.deepEqual(view.providers, []);
  assert.match(view.error, /registry down/);
});

test('modelEfforts() returns the third-level options and the default', async () => {
  const view = await collectModelEfforts(llm(), 'deepseek', 'flash');

  assert.deepEqual(view.efforts, [
    { id: 'low', name: '低' },
    { id: 'high', name: '高', description: '更慢更准' },
  ]);
  assert.equal(view.default, 'low');
  assert.equal(view.error, '');
});

test('a model without reasoning metadata reports no efforts', async () => {
  const view = await collectModelEfforts(
    llm({
      async resolveModelInfo(provider: string, model: string) {
        return { provider, id: model, name: model };
      },
    }),
    'deepseek',
    'flash',
  );

  assert.deepEqual(view.efforts, []);
  assert.equal(view.default, undefined);
  assert.equal(view.error, '');
});

test('a rejected model surfaces as an error instead of silently following the default', async () => {
  const view = await collectModelEfforts(llm(), 'deepseek', 'rejecting');

  assert.deepEqual(view.efforts, []);
  assert.match(view.error, /unsupported model/);
});

test('modelEfforts() without an llm service explains itself', async () => {
  const view = await collectModelEfforts(null, 'deepseek', 'flash');
  assert.match(view.error, /unavailable/);
});
