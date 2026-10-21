var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
var sandbox = { AbortController: AbortController, require: function (name) { return name === './fixtures/popup-tool-dom.cjs' ? require('./fixtures/popup-tool-dom.cjs') : require(name); } };
vm.runInNewContext(fs.readFileSync('test/search-hints.test.js', 'utf8').split("test('twelve quiet hints")[0], sandbox);
function fixture() { return sandbox.fixture({ results: [{ projectSlug: 'alpha', sessionId: 2, sessionTitle: 'Review plan' }] }); }
async function flush() { for (var i = 0; i < 6; i++) await Promise.resolve(); }
function type(f, text) { f.input.value = text; f.event(f.input, 'input'); }
test('typed query defaults to Ask first, then actual results; Enter and click submit only the exact query', async function () {
  for (var action of ['Enter', 'click']) {
    var f = fixture(); f.api.openCommandPalette(); await flush(); type(f, '  Review plan?  ');
    assert.equal(f.api.items[0].type, 'ask-clay'); assert.equal(f.api.activeIndex, 0); assert.equal(f.asked.length, 0);
    f.tick(250); await flush();
    assert.equal(f.api.items[0].query, 'Review plan?'); assert.equal(f.api.items[1].data.sessionId, 2); assert.equal(f.api.activeIndex, 0);
    var rows = f.api.resultsEl.querySelectorAll('.cmd-palette-item'); assert.ok(rows[0].classList.contains('active')); assert.ok(rows[0].textContent.includes('Ask Clay about'));
    if (action === 'Enter') f.event(f.input, 'keydown', { key: 'Enter' }); else rows[0].click();
    assert.deepEqual(Array.from(f.asked), ['Review plan?']); assert.equal(f.selected.length, 0);
  }
});
test('async result arrival preserves deliberately selected result by identity and arrow navigation still works', async function () {
  var f = fixture(); f.api.openCommandPalette(); await flush(); type(f, 'Review');
  f.event(f.input, 'keydown', { key: 'ArrowDown' }); assert.equal(f.api.items[f.api.activeIndex].data.sessionId, 2);
  f.api.fetch = function () { return Promise.resolve({ json: function () { return Promise.resolve({ results: [{ projectSlug: 'alpha', sessionId: 3, sessionTitle: 'Review older' }] }); } }); };
  f.tick(250); await flush();
  assert.equal(f.api.items.length, 3); assert.equal(f.api.items[f.api.activeIndex].data.sessionId, 2);
  f.event(f.input, 'keydown', { key: 'Enter' }); assert.deepEqual(Array.from(f.selected), [2]); assert.equal(f.asked.length, 0);
  f.api.openCommandPalette(); type(f, 'different'); assert.equal(f.api.activeIndex, 0);
  f.event(f.input, 'keydown', { key: 'Escape' }); assert.equal(f.api.isCommandPaletteOpen(), false);
});
test('empty/whitespace show recent without Ask; retry retains its explicit action', async function () {
  var f = fixture(); f.api.openCommandPalette(); await flush();
  for (var query of ['', '   ']) { type(f, query); assert.equal(f.api.items.some(function (item) { return item.type === 'ask-clay'; }), false); assert.equal(f.api.items[0].data.sessionId, 2); }
  f.api.store.set({ contextualSearchAsk: { ownerId: 'owner', status: 'stopped', text: 'Retained question' } });
  type(f, ''); assert.equal(f.api.items[0].type, 'retry-clay-ask'); assert.equal(f.api.activeIndex, -1);
  f.event(f.input, 'keydown', { key: 'ArrowDown' }); f.event(f.input, 'keydown', { key: 'Enter' }); assert.equal(f.retried(), 1); assert.equal(f.asked.length, 0);
});
test('out-of-order same-query replies and late errors cannot overwrite results or deliberate selection', async function () {
  var f = fixture(); f.api.openCommandPalette(); await flush();
  var requests = [];
  f.api.fetch = function () { return new Promise(function (resolve, reject) { requests.push({ resolve: resolve, reject: reject }); }); };
  type(f, 'Review'); f.tick(250); type(f, 'other'); f.tick(250); type(f, 'Review'); f.tick(250);
  requests[2].resolve({ json: function () { return Promise.resolve({ results: [{ projectSlug: 'alpha', sessionId: 4, sessionTitle: 'Review four' }] }); } }); await flush();
  f.event(f.input, 'keydown', { key: 'ArrowDown' }); f.event(f.input, 'keydown', { key: 'ArrowDown' }); assert.equal(f.api.items[f.api.activeIndex].data.sessionId, 4);
  requests[0].resolve({ json: function () { return Promise.resolve({ results: [{ projectSlug: 'alpha', sessionId: 9, sessionTitle: 'Stale' }] }); } }); requests[1].reject(new Error('late failure')); await flush();
  assert.equal(f.api.items[f.api.activeIndex].data.sessionId, 4); assert.equal(f.api.items.some(function (item) { return item.data && item.data.sessionId === 9; }), false);
  type(f, 'Review changed'); f.tick(250); f.api.closeCommandPalette(); requests[3].resolve({ json: function () { return Promise.resolve({ results: [] }); } }); await flush(); assert.equal(f.api.isCommandPaletteOpen(), false); assert.equal(f.asked.length, 0);
});
