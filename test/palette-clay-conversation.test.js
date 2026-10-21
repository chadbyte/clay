var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
// Reuse the inspected DOM/clock bootstrap without registering its hint tests.
var bootstrap = fs.readFileSync('test/search-hints.test.js', 'utf8').split("test('twelve quiet hints")[0];
var base = { AbortController: AbortController, require: function (name) { return name === './fixtures/popup-tool-dom.cjs' ? require('./fixtures/popup-tool-dom.cjs') : require(name); } };
vm.runInNewContext(bootstrap, base);
function load(api, name, exports) {
  var source = fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  vm.runInContext('(function () {\n' + source + '\nObject.assign(globalThis, {' + exports.join(',') + '});\n})()', api);
}
function fixture() {
  var item = { isMate: true, mateId: 'canonical', projectSlug: 'mate-canonical', sessionId: 7, sessionOriginId: 'origin-seven', sessionTitle: 'Past review' };
  var f = base.fixture({ results: [item] }), api = f.api, sent = [], opened = [], notices = [], entries = [], switched = [];
  var socket = { readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } }, frame = null;
  var surface = f.document.createElement('div'); surface.setAttribute('id', 'contextual-clay'); f.document.body.appendChild(surface);
  api.crypto = crypto; api.getWs = function () { return socket; }; api.showToast = function (text) { notices.push(text); };
  api.pauseContextualSearchForSelection = function () {}; api.contextualTrigger = function () { return f.trigger; }; api.enterComposer = function () {};
  api.store.set({ connected: true, cachedMatesList: [{ id: 'canonical', builtinKey: 'clay', createdBy: 'owner', createdAt: 10 }], contextualClay: { mode: 'closed' } });
  load(api, 'contextual-mate-identity', ['contextualMate', 'contextualMateStamp']);
  api.contextualFrame = function () { return frame; };
  api.selectContextualConversation = function (mate, id, origin) {
    opened.push([mate.id, id, origin]); api.store.set({ contextualClay: { mode: 'popover', mateId: mate.id, sessionId: id } });
    var source = {};
    frame = { contentWindow: source, conversation: { source: source, checkDraft: function () {}, identity: function () { return { mateId: mate.id, ownerId: 'owner', sessionId: id, sessionOriginId: origin, ready: true, connected: true, available: true }; }, navigateEntry: function (request) { entries.push([request.sessionId, request.entryIndex, request.query]); return true; } } };
    return true;
  };
  load(api, 'palette-clay-conversation', ['openPaletteClayConversation', 'handlePaletteClayConversation']);
  f.setup.switchProject = function (slug) { switched.push(slug); };
  f.choose = function (item, query, index) { api.activateItem({ type: 'session', data: Object.assign({}, item, { entryIndex: index }), query: query }); };
  f.receipt = function (patch) { var msg = sent[sent.length - 1]; return api.handlePaletteClayConversation(Object.assign({ type: 'contextual_mate_sessions_result', requestId: msg.requestId, mateId: msg.mateId, mateStamp: msg.mateStamp, ok: true, sessionId: 7, sessionOriginId: 'origin-seven' }, patch)); };
  return Object.assign(f, { item: item, sent: sent, opened: opened, notices: notices, entries: entries, switched: switched, disconnect: function () { socket = { readyState: 1 }; }, frame: function (value) { frame = value; } });
}
async function flush() { for (var i = 0; i < 6; i++) await Promise.resolve(); }
['click', 'Enter'].forEach(function (action) {
  test('production palette ' + action + ' opens exact canonical recent/search popup without changing parent', async function () {
    var f = fixture(); f.api.openCommandPalette(); await flush();
    if (action === 'Enter') { f.input.value = 'review'; f.event(f.input, 'input'); f.tick(300); await flush(); f.event(f.input, 'keydown', { key: 'ArrowDown' }); f.event(f.input, 'keydown', { key: 'Enter' }); }
    else f.api.resultsEl.querySelector('.cmd-palette-item').click();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'home_mate_session_open'); assert.equal(f.sent[0].sessionId, 'local:7'); assert.equal(f.sent[0].sessionOriginId, 'origin-seven');
    assert.deepEqual(f.opened, []); f.receipt(); assert.deepEqual(f.opened, [['canonical', 7, 'origin-seven']]);
    assert.equal(f.api.store.get('currentSlug'), 'alpha'); assert.equal(f.api.store.get('activeSessionId'), 1); assert.deepEqual(f.switched, []); assert.equal(f.selected.length, 0); assert.equal(f.asked.length, 0);
    assert.equal(f.api.store.get('paletteClayConversation'), null); assert.equal(f.api.isCommandPaletteOpen(), false);
    if (action === 'Enter') assert.deepEqual(f.entries, [[7, null, 'review']]);
  });
});
test('exact entry index is delivered only to the verified child controller', function () {
  var f = fixture(); f.choose(f.item, null, 22); f.receipt(); assert.deepEqual(f.entries, [[7, 22, null]]);
  assert.equal(f.api.store.get('pendingSessionEntryNavigation'), undefined);
});
['owner', 'removed', 'replaced', 'deleted', 'parent', 'selection', 'socket', 'origin', 'denied'].forEach(function (kind) {
  test('pending palette open fails closed for ' + kind, function () {
    var f = fixture(); f.choose(f.item);
    if (kind === 'owner') f.api.store.set({ myUserId: 'other' });
    if (kind === 'removed') f.api.store.set({ cachedMatesList: [] });
    if (kind === 'replaced') f.api.store.set({ cachedMatesList: [{ id: 'canonical', builtinKey: 'clay', createdBy: 'owner', createdAt: 20 }] });
    if (kind === 'deleted') f.api.store.get('cachedMatesList')[0].lifecycleDeletion = true;
    if (kind === 'parent') f.api.store.set({ activeSessionId: 2 });
    if (kind === 'selection') f.api.store.set({ contextualClay: { mode: 'popover', sessionId: 8 } });
    if (kind === 'socket') f.disconnect();
    f.receipt(kind === 'origin' ? { sessionOriginId: 'replacement' } : kind === 'denied' ? { ok: false } : {});
    assert.deepEqual(f.opened, []); assert.deepEqual(f.switched, []); assert.ok(f.notices.length); assert.equal(f.api.store.get('paletteClayConversation'), null);
  });
});
test('missing, foreign and malformed metadata never fall back; ordinary Mate and project still navigate natively', function () {
  for (var mode of ['missing', 'foreign', 'origin', 'mismatch']) {
    var f = fixture();
    if (mode === 'missing') f.api.store.set({ cachedMatesList: [] });
    if (mode === 'foreign') f.api.store.get('cachedMatesList')[0].createdBy = 'other';
    if (mode === 'origin') delete f.item.sessionOriginId;
    if (mode === 'mismatch') f.item.mateId = 'wrong';
    f.choose(f.item); assert.equal(f.sent.length, 0); assert.deepEqual(f.switched, []); assert.ok(f.notices.length);
  }
  var ordinary = fixture(); ordinary.api.store.get('cachedMatesList')[0].builtinKey = null;
  ordinary.choose(ordinary.item); assert.deepEqual(ordinary.switched, ['mate-canonical']); assert.equal(ordinary.sent.length, 0);
  ordinary.choose({ projectSlug: 'alpha', sessionId: 3 }); assert.deepEqual(Array.from(ordinary.selected), [3]);
});
test('busy/draft refusals, one receipt, timeout and wrong reply never open a default conversation', function () {
  var f = fixture(); f.api.store.set({ contextualClay: { mode: 'opening', startingAsk: 'pending' } }); f.choose(f.item); assert.equal(f.sent.length, 0);
  f.api.store.set({ contextualClay: { mode: 'closed' } }); f.frame({ conversation: { checkDraft: function () { throw new Error('Uploading'); } } }); f.choose(f.item); assert.equal(f.sent.length, 0);
  f.frame(null); f.choose(f.item); f.choose(f.item); assert.equal(f.sent.length, 1);
  f.receipt({ requestId: 'unrelated' }); assert.deepEqual(f.opened, []); f.tick(15000); f.receipt(); assert.deepEqual(f.opened, []); assert.equal(f.api.store.get('paletteClayConversation'), null);
});
test('server palette projects origins for recent/title/content and preserves permissions', function () {
  var attach = require('../lib/server-palette').attachPalette;
  var sessions = new Map([[7, { localId: 7, ownerId: 'owner', sessionOriginId: 'origin-seven', title: 'Review', history: [{ type: 'user_message', text: 'specificword' }] }], [8, { localId: 8, ownerId: 'foreign', title: 'Review' }]]);
  var service = attach({ users: { isMultiUser: function () { return true; }, canAccessSession: function (id, session) { return id === session.ownerId; } }, getMultiUserFromReq: function () { return { id: 'owner' }; }, canUserAccessSlug: function () { return true; }, projects: new Map([['mate-canonical', { getStatus: function () { return { isMate: true, mateId: 'canonical', projectOwnerId: 'owner' }; }, sm: { sessions: sessions } }]]) });
  ['', 'Review', 'specificword'].forEach(function (query) {
    var data; service.handleRequest({ method: 'GET', url: '/api/palette/search?q=' + query }, { writeHead: function (status) { assert.equal(status, 200); }, end: function (body) { data = JSON.parse(body); } }, '/api/palette/search');
    assert.equal(data.results.length, 1); assert.equal(data.results[0].sessionId, 7); assert.equal(data.results[0].sessionOriginId, 'origin-seven'); assert.equal(data.results[0].mateId, 'canonical');
  });
});

test('production child controller validates exact readiness before existing passage navigation', function () {
  var source = fs.readFileSync('test/contextual-popup-observer.test.js', 'utf8').split("test('production parent/child")[0];
  var sandbox = { URL: URL, URLSearchParams: URLSearchParams, require: base.require };
  vm.runInNewContext(source, sandbox);
  var f = sandbox.fixture(), navigations = [];
  f.child.navigateToSession = function (item, query, index) { navigations.push([item.sessionId, query, index]); };
  var target = { ownerId: 'owner', mateId: 'mate', sessionId: 7, sessionOriginId: 'origin', entryIndex: 12, query: 'review' };
  assert.equal(f.frame.conversation.navigateEntry(target), false);
  f.child.handleContextualSessionMessage({ type: 'history_done' }); f.drain();
  for (var patch of [{ ownerId: 'foreign' }, { mateId: 'other' }, { sessionId: 8 }, { sessionOriginId: 'stale' }]) assert.equal(f.frame.conversation.navigateEntry(Object.assign({}, target, patch)), false);
  assert.equal(navigations.length, 0); assert.equal(f.frame.conversation.navigateEntry(target), true); assert.deepEqual(navigations, [[7, 'review', 12]]);
});

test('Escape or Stop cancels resolution and a late receipt cannot reopen the popup', function () {
  for (var action of ['Escape', 'Stop']) {
    var f = fixture(); f.api.openCommandPalette(); f.choose(f.item);
    if (action === 'Escape') f.event(f.input, 'keydown', { key: 'Escape' });
    else f.event(f.document.getElementById('contextual-clay'), 'contextual-ask-stopped');
    assert.equal(f.api.store.get('paletteClayConversation'), null); f.receipt(); assert.equal(f.opened.length, 0);
    assert.equal(f.document.getElementById('contextual-clay').listeners['contextual-ask-stopped'].length, 0);
  }
});
