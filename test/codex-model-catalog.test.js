var test = require('node:test');
var assert = require('node:assert/strict');
var catalog = require('../lib/yoke/codex-model-catalog');

test('catalog uses runtime model IDs, efforts and pagination without hidden duplicates', async function () {
  var calls = [];
  var models = await catalog.load({ send: async function (method, params) {
    calls.push(params.cursor);
    return params.cursor ? { data: [{ model: 'new-model', supportedReasoningEfforts: [{ reasoningEffort: 'ultra' }] }] } : {
      data: [{ model: 'hidden', hidden: true }, { model: 'other', displayName: 'Other' }, { model: 'other' }], nextCursor: 'next'
    };
  } });
  assert.deepEqual(calls, [null, 'next']);
  assert.deepEqual(models.map(function (model) { return model.value; }), ['other', 'new-model']);
  assert.deepEqual(models[1].supportedEffortLevels, ['ultra']);
});

test('offline and malformed catalogs retain a fresh fallback containing GPT-6.1 Sol', async function () {
  for (var response of [null, {}, { data: [] }]) {
    assert.deepEqual(await catalog.load({ send: async function () { return response; } }), catalog.fallback());
  }
  assert.deepEqual(await catalog.load({ send: async function () { throw new Error('offline'); } }), catalog.fallback());
  var initial = catalog.fallback();
  initial.pop();
  assert.ok(catalog.fallback().includes('gpt-6.1-sol'));
  assert.notDeepEqual(initial, catalog.fallback());
});

test('adapter catalogs remain isolated and preserve the configured default', async function () {
  var createAdapter = require('../lib/yoke/adapters/codex').createCodexAdapter;
  function adapterFor(model) {
    return createAdapter({ cwd: process.cwd(), createAppServer: function () {
      return { started: false, start: async function () { this.started = true; }, notify: function () {},
        send: async function (method) { return method === 'model/list' ? { data: [{ model: model, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] } : { data: [] }; }
      };
    } });
  }
  var first = adapterFor('account-one-model');
  var second = adapterFor('account-two-model');
  assert.ok((await first.supportedModels()).includes('gpt-6.1-sol'));
  var ready = await first.init({});
  await second.init({});
  assert.equal(ready.defaultModel, 'gpt-6-astra');
  assert.equal((await first.supportedModels())[0].value, 'account-one-model');
  assert.equal((await second.supportedModels())[0].value, 'account-two-model');
});
