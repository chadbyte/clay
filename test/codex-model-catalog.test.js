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

test('runtime default flags and default efforts are authoritative over the static default', async function () {
  var models = await catalog.load({ send: async function () {
    return { data: [
      { model: 'account-model', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'ultra' }], defaultReasoningEffort: 'low', isDefault: true },
      { model: 'other-model', defaultReasoningEffort: '', isDefault: false },
    ] };
  } });
  assert.deepEqual(models[0], { value: 'account-model', displayName: 'account-model', description: '', defaultReasoningEffort: 'low', isDefault: true, supportedEffortLevels: ['low', 'ultra'] });
  assert.equal(models[1].isDefault, undefined);
  assert.equal(models[1].defaultReasoningEffort, undefined);
  assert.equal(catalog.defaultModel(models), 'account-model');
  assert.equal(catalog.defaultModel(catalog.fallback()), 'gpt-6.1-sol');
  assert.equal(catalog.defaultModel([{ value: 'x', isDefault: 'true' }]), 'x', 'only a boolean flag counts; unflagged lists use their first valid row');
  assert.equal(catalog.defaultModel([null, { value: '' }, { value: 'custom-a' }, 'custom-b']), 'custom-a');
  assert.equal(catalog.defaultModel([{ value: 'custom-a' }, { value: 'gpt-6.1-sol' }]), 'gpt-6.1-sol', 'the static default is kept when listed');
  assert.equal(catalog.defaultModel([]), 'gpt-6.1-sol', 'an empty offline catalog keeps the static default');
  var createAdapter = require('../lib/yoke/adapters/codex').createCodexAdapter;
  var adapter = createAdapter({ cwd: process.cwd(), createAppServer: function () {
    return { started: false, start: async function () { this.started = true; }, notify: function () {},
      send: async function (method) { return method === 'model/list' ? { data: [{ model: 'plain' }, { model: 'flagged', isDefault: true }] } : { data: [] }; } };
  } });
  assert.equal((await adapter.init({})).defaultModel, 'flagged');
});

test('the offline fallback mirrors installed picker presets without retired models', function () {
  // @openai/codex 0.162.1 picker-visible presets by priority; gpt-5.5 retired for
  // ChatGPT sign-in on 2026-10-14 and gpt-5.2 is deprecated (learn.chatgpt.com/docs/models).
  assert.deepEqual(catalog.fallback(), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.equal(catalog.selectTitleModel(catalog.fallback()).model, 'gpt-6-luna');
  assert.equal(catalog.selectTitleModel(['gpt-5.6-luna', 'gpt-6.1-sol']).model, 'gpt-5.6-luna');
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
  assert.equal(ready.defaultModel, 'account-one-model', 'an unflagged runtime list never names an unlisted static default');
  assert.equal((await first.supportedModels())[0].value, 'account-one-model');
  assert.equal((await second.supportedModels())[0].value, 'account-two-model');
});

test('a runtime default effort reaches Default AI through the shared vendor catalog', async function () {
  var createAdapter = require('../lib/yoke/adapters/codex').createCodexAdapter;
  var adapter = createAdapter({ cwd: process.cwd(), createAppServer: function () {
    return { started: false, start: async function () { this.started = true; }, notify: function () {},
      send: async function (method) {
        return method === 'model/list' ? { data: [
          { model: 'custom-a', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
          { model: 'custom-b', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
        ] } : { data: [] };
      } };
  } });
  var sm = { sessions: new Map(), defaultModelByVendor: {}, modelsByVendor: {}, capabilitiesByVendor: {}, availableVendors: ['codex'], installedVendors: ['codex'] };
  var models = require('../lib/project-models').attachModels({ cwd: process.cwd(), slug: 'catalog-default', sm: sm, sdk: {}, adapters: { codex: adapter },
    sendTo: function () {}, getSessionForWs: function () { return null; }, getLinuxUserForWs: function () { return null; }, serverPort: 2633, serverTls: false, serverAuthToken: null });
  var vendorCatalog = await models.getVendorCatalog({}, 'codex');
  assert.equal(vendorCatalog.defaultModel, 'custom-b');
  var resolved = await require('../lib/default-ai-runtime').resolveDefaultAiRuntime({
    getPreference: function () { return { preference: { vendor: 'codex' } }; },
    getAvailability: function () { return ['codex']; },
    getCatalog: function () { return vendorCatalog; },
  });
  assert.equal(resolved.ready, true);
  assert.equal(resolved.model, 'custom-b');
  assert.equal(resolved.effort, 'high', 'the runtime default effort applies when no effort is saved');
  var explicit = await require('../lib/default-ai-runtime').resolveDefaultAiRuntime({
    getPreference: function () { return { preference: { vendor: 'codex', model: 'custom-a', effort: 'high' } }; },
    getAvailability: function () { return ['codex']; },
    getCatalog: function () { return vendorCatalog; },
  });
  assert.equal(explicit.effort, 'high', 'a saved effort still wins over the runtime default');
});
