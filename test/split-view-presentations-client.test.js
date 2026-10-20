var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

function fixture() {
  var root = path.join(__dirname, "../lib/public/modules/");
  var sent = [], socket = { readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } };
  var sessions = [
    { id: 1, sessionOriginId: "origin-1", sessionRole: "driver" },
    { id: 2, sessionOriginId: "origin-2", sessionRole: "driver" },
    { id: 3, sessionOriginId: "origin-3", sessionRole: "driver" },
  ];
  var context = vm.createContext({
    getWs: function () { return socket; }, getCachedSessions: function () { return sessions; },
    preserveReconnectingPresentation: function () { return false; }, renderPresentationView: function () {}, initPresentationRenderer: function () {}, hidePresentationView: function () {}, closePresentationArrange: function () {},
    initPresentationDrag: function () {}, restorePresentationDrag: function () {}, detachTuiView: function () {}, checkComposerDeparture: function () {},
    showToast: function () {}, groupedSessionIds: function () { return new Set(); },
    exactDriverForOrigin: function (origin, items) { return (items || []).find(function (session) { return session.sessionOriginId === origin && session.sessionRole !== "worker" && !session.isMate && !session.isTui; }) || null; },
    currentSingletonPresentation: function (state, items) { var key = [state.currentSlug || "", state.currentProjectOwnerId || "", state.myUserId || "", state.projectSplitViewSocketGeneration || 0].join("|"); var session = (items || []).find(function (item) { return item.id === state.activeSessionId; }); return state.projectSplitViewContextKey === key && state.sessionListProjectSlug === state.currentSlug && session ? { origin: session.sessionOriginId, session: session, view: { id: "single:" + session.sessionOriginId, sessions: [session], activeSessionOriginId: session.sessionOriginId } } : null; },
    document: { body: { classList: { remove: function () {} } }, documentElement: { hasPointerCapture: function () { return false; } } },
  });
  var storeSource = fs.readFileSync(path.join(root, "store.js"), "utf8").replace(/^export \{[^}]+\};?$/gm, "");
  vm.runInContext(storeSource, context, { filename: "store.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "split-view-layout-scope.js"), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, ""), context);
  var layoutSource = fs.readFileSync(path.join(root, "split-view-layout-client.js"), "utf8").replace(/^export function /gm, "function ");
  vm.runInContext(layoutSource, context, { filename: "split-view-layout-client.js" });
  var lookupSource = fs.readFileSync(path.join(root, "split-view-presentation-lookup.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/^export function /gm, "function ");
  vm.runInContext(lookupSource, context, { filename: "split-view-presentation-lookup.js" });
  var dropSource = fs.readFileSync(path.join(root, "split-view-presentation-drop.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/^export function /gm, "function ");
  vm.runInContext(dropSource, context, { filename: "split-view-presentation-drop.js" });
  var source = fs.readFileSync(path.join(root, "split-view-presentations.js"), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/^export function /gm, "function ");
  vm.runInContext(source, context, { filename: "split-view-presentations.js" });
  context.replaceSocket = function (nextSocket) { socket = nextSocket; };
  context.createStore({ currentSlug: "proj", activeProjectSlug: "proj", sessionListProjectSlug: "proj", currentProjectOwnerId: "owner",
    myUserId: "owner", projectSplitViewSocketGeneration: 4, authIdentityLoaded: true, connected: true,
    paneMode: false, dmMode: false, splitPanes: null, splitGroups: [], activeSessionId: 1,
    projectSplitViewContextKey: null, projectSplitViewHydrated: false, projectSplitViewPending: null,
    projectSplitViews: [], projectSplitViewRevision: 0, projectSplitViewActiveId: null, projectSplitViewDrag: null,
    projectSplitViewDividerDrag: null, projectSplitViewRequestSocket: null, projectSplitViewRequestGeneration: null,
    projectSplitViewRequestOwnerId: null, projectSplitViewRequestSlug: null });
  return { context: context, store: context.store, socket: socket, sent: sent, sessions: sessions };
}

function view(tree, sessions) {
  return { id: "view-a", name: "Split view", revision: 1, layout: "balanced", activeSessionOriginId: "origin-1", tree: tree,
    sessions: sessions.map(function (session) { return { id: session.id, sessionOriginId: session.sessionOriginId }; }) };
}

test("client hydration binds the owner, project and exact live socket before accepting state", function () {
  var f = fixture(), api = f.context;
  assert.equal(api.requestProjectSplitViews(), true);
  assert.equal(f.sent[0].type, "project_split_views_request");
  var tree = api.preset(["origin-1", "origin-2"], "balanced");
  assert.equal(api.handleProjectSplitViews({ projectSlug: "proj", revision: 1, views: [view(tree, f.sessions.slice(0, 2))] }), true);
  assert.equal(f.store.get("projectSplitViewHydrated"), true);
  assert.equal(f.store.get("projectSplitViews")[0].id, "view-a");
  api.replaceSocket({ readyState: 1, send: function () {} });
  assert.equal(api.handleProjectSplitViews({ projectSlug: "proj", revision: 2, views: [] }), false);
  assert.equal(f.store.get("projectSplitViewRevision"), 1);
});

test("stale owner revisions and unavailable session references fail closed", function () {
  var f = fixture(), api = f.context;
  api.requestProjectSplitViews();
  var original = view(api.preset(["origin-1", "origin-2"], "balanced"), f.sessions.slice(0, 2));
  api.handleProjectSplitViews({ projectSlug: "proj", revision: 2, views: [original] });
  api.handleProjectSplitViews({ projectSlug: "proj", revision: 1, views: [] });
  assert.equal(f.store.get("projectSplitViews").length, 1);
  api.handleProjectSplitViews({ projectSlug: "proj", revision: 3, views: [view(api.preset(["origin-1", "origin-missing"], "balanced"), f.sessions.slice(0, 2))] });
  assert.equal(f.store.get("projectSplitViewHydrated"), false);
  assert.match(f.store.get("projectSplitViewError"), /references are unavailable/);
  f.store.set({ myUserId: "other" });
  assert.equal(api.handleProjectSplitViews({ projectSlug: "proj", revision: 4, views: [] }), false);
});

test("mutation result stays pending until its correlated authoritative broadcast arrives", function () {
  var f = fixture(), api = f.context;
  api.requestProjectSplitViews();
  var first = view(api.preset(["origin-1", "origin-2"], "balanced"), f.sessions.slice(0, 2));
  api.handleProjectSplitViews({ projectSlug: "proj", revision: 2, views: [first] });
  var pending = { requestId: "request-1", socket: f.socket, contextKey: f.store.get("projectSplitViewContextKey"), expectedRevision: 2,
    meta: null, awaitingBroadcast: false, resultRevision: null };
  f.store.set({ projectSplitViewPending: pending });
  assert.equal(api.handleProjectSplitViewResult({ requestId: "wrong", ok: true, revision: 3 }), false);
  assert.equal(api.handleProjectSplitViewResult({ requestId: "request-1", ok: true, revision: 3, view: { id: "view-a" } }), true);
  assert.equal(f.store.get("projectSplitViewPending").awaitingBroadcast, true);
  var changed = view(api.preset(["origin-1", "origin-2"], "columns"), f.sessions.slice(0, 2));
  changed.layout = "columns";
  api.handleProjectSplitViews({ projectSlug: "proj", revision: 3, views: [changed] });
  assert.equal(f.store.get("projectSplitViewPending"), null);
  assert.equal(f.store.get("projectSplitViews")[0].layout, "columns");
});

test("conflicts disable further writes and request fresh authoritative state without replay", function () {
  var f = fixture(), api = f.context;
  api.requestProjectSplitViews();
  var saved = view(api.preset(["origin-1", "origin-2"], "balanced"), f.sessions.slice(0, 2));
  api.handleProjectSplitViews({ projectSlug: "proj", revision: 2, views: [saved] });
  var pending = { requestId: "request-conflict", socket: f.socket, contextKey: f.store.get("projectSplitViewContextKey"), expectedRevision: 2,
    meta: null, awaitingBroadcast: false, resultRevision: null };
  f.store.set({ projectSplitViewPending: pending });
  assert.equal(api.handleProjectSplitViewResult({ requestId: pending.requestId, ok: false, code: "conflict", error: "Reload required" }), true);
  assert.equal(f.store.get("projectSplitViewHydrated"), false);
  assert.equal(f.sent.filter(function (message) { return message.type === "project_split_views_request"; }).length, 2);
  assert.equal(f.sent.some(function (message) { return message.type === "project_split_view_update"; }), false);
});

test("sidebar drops create views, append to existing views and ignore existing members", function () {
  var f = fixture(), api = f.context, calls = [];
  function mutate(type, body, meta) { calls.push({ type: type, body: body, meta: meta }); }
  api.applyPresentationDrop({ origin: 'origin-2', sessionId: 2, sourceViewId: null },
    { origin: 'origin-1', viewId: null, side: 'right', sidebar: true }, mutate, function () {});
  assert.equal(calls[0].type, 'project_split_view_create');
  assert.deepEqual(Array.from(calls[0].body.sessionOrigins), ['origin-1', 'origin-2']);
  var saved = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  f.store.set({ projectSplitViews: [saved] });
  api.applyPresentationDrop({ origin: 'origin-3', sessionId: 3, sourceViewId: null },
    { origin: 'origin-2', viewId: saved.id, side: 'right', sidebar: true }, mutate, function () {});
  assert.equal(calls[1].type, 'project_split_view_update');
  assert.deepEqual(Array.from(calls[1].body.sessionOrigins), ['origin-1', 'origin-2', 'origin-3']);
  assert.equal(calls[1].meta.createdViewId, saved.id);
  assert.equal(calls[1].meta.activateCreatedView, true);
  api.applyPresentationDrop({ origin: 'origin-1', sessionId: 1, sourceViewId: saved.id },
    { origin: 'origin-2', viewId: saved.id, side: 'right', sidebar: true }, mutate, function () {});
  assert.equal(calls.length, 2);
  api.applyPresentationDrop({ origin: 'origin-foreign', sessionId: 3, sourceViewId: null },
    { origin: 'origin-2', viewId: saved.id, side: 'right', sidebar: true }, mutate, function () {});
  assert.equal(calls.length, 2);
});

test("group context menu opens only for a live project heading and preserves row menus", function () {
  var f = fixture(), api = f.context, opened = 0, focused = 0;
  var saved = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  f.store.set({ projectSplitViews: [saved] });
  var anchor = { setAttribute: function () {}, getBoundingClientRect: function () { return { right: 200, bottom: 100 }; } };
  var menu = { hidden: true, style: {}, querySelector: function () { return { focus: function () { focused++; } }; } };
  var group = { dataset: { splitViewId: saved.id }, querySelector: function (selector) { return selector === '.split-view-menu' ? menu : anchor; } };
  var heading = { closest: function () { return group; } };
  var target = { closest: function (selector) { return selector === '.split-view-group-heading' ? heading : null; } };
  api.document.querySelectorAll = function () { return []; };
  api.window = { innerWidth: 1000, innerHeight: 700 };
  api.closeSessionContextMenu = function () {};
  api.openSplitViewMenu = function (_group, _anchor, point) {
    menu.hidden = false; menu.style.left = point.x + 'px'; menu.style.top = point.y + 'px'; focused++;
  };
  function event() { return { target: target, clientX: 50, clientY: 60, preventDefault: function () { opened++; }, stopImmediatePropagation: function () {} }; }
  api.onContextMenu(event());
  assert.equal(menu.hidden, false); assert.equal(menu.style.left, '50px'); assert.equal(menu.style.top, '60px'); assert.equal(focused, 1);
  heading.closest = function () { return null; };
  api.onContextMenu(event()); assert.equal(opened, 1);
  heading.closest = function () { return group; };
  f.store.set({ connected: false });
  api.onContextMenu(event()); assert.equal(opened, 1);
  f.store.set({ connected: true, projectSplitViews: [] });
  api.onContextMenu(event()); assert.equal(opened, 1);
});

test("fresh hydration restores the full saved view for the selected member without sending mutations", function () {
  var f = fixture(), api = f.context;
  f.sessions.forEach(function (session) { session.ownerId = 'owner'; });
  f.store.set({ activeSessionId: 2, sessionOriginId: 'origin-2', sessionActivatedProjectSlug: 'proj' });
  api.requestProjectSplitViews();
  var saved = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 7, views: [saved] });
  assert.equal(f.store.get('projectSplitViewActiveId'), saved.id);
  assert.equal(f.store.get('activeSessionId'), 2);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'project_split_views_request');
});

test("late session activation restores membership while stale identities and explicit Worker controls do not", function () {
  var f = fixture(), api = f.context;
  f.sessions.forEach(function (session) { session.ownerId = 'owner'; });
  api.requestProjectSplitViews();
  var saved = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 2, views: [saved] });
  assert.equal(f.store.get('projectSplitViewActiveId'), null);
  api.host = {}; api.nativeApp = {};
  f.store.set({ activeSessionId: 2, sessionOriginId: 'origin-2', sessionActivatedProjectSlug: 'proj' });
  api.renderActive();
  assert.equal(f.store.get('projectSplitViewActiveId'), saved.id);
  var good = f.store.snap();
  [ { splitPanes: { groupId: 'execution-pair' } }, { myUserId: 'foreign' }, { sessionOriginId: 'replaced-origin' },
    { sessionActivatedProjectSlug: 'other' }, { paneMode: true }, { dmMode: true }, { connected: false } ].forEach(function (change) {
    assert.equal(api.restorablePresentation(Object.assign({}, good, change), [saved], f.sessions), null);
  });
  assert.equal(api.restorablePresentation(good, [saved, Object.assign({}, saved, { id: 'duplicate' })], f.sessions), null);
});

test('both activation hydration orders preserve asymmetric four-pane saved composition', function () {
  [true, false].forEach(function (activateFirst) {
    var f = fixture(), api = f.context;
    f.sessions.push({ id: 4, sessionOriginId: 'origin-4', sessionRole: 'driver' });
    f.sessions.forEach(function (item) { item.ownerId = 'owner'; });
    var ordered = [f.sessions[3], f.sessions[1], f.sessions[0], f.sessions[2]];
    var custom = { axis: 'horizontal', ratio: 0.371, left: { id: 'origin-4' }, right: { axis: 'vertical', ratio: 0.623,
      left: { axis: 'horizontal', ratio: 0.417, left: { id: 'origin-2' }, right: { id: 'origin-1' } }, right: { id: 'origin-3' } } };
    var saved = view(custom, ordered); saved.layout = 'main-right'; saved.activeSessionOriginId = 'origin-2';
    var original = JSON.stringify(saved);
    var activation = { activeSessionId: 2, sessionOriginId: 'origin-2', sessionActivatedProjectSlug: 'proj' };
    if (activateFirst) f.store.set(activation);
    api.requestProjectSplitViews(); api.handleProjectSplitViews({ projectSlug: 'proj', revision: 17, views: [saved] });
    api.host = {}; api.nativeApp = {};
    if (!activateFirst) f.store.set(activation);
    api.renderActive();
    assert.equal(f.store.get('projectSplitViewActiveId'), saved.id);
    assert.equal(JSON.stringify(f.store.get('projectSplitViews')[0]), original);
    assert.equal(f.store.get('projectSplitViewRevision'), 17);
    assert.equal(f.sent.length, 1);
  });
});

test('pane removal waits for persistence, preserves surviving branches and selects a remaining session', function () {
  var f = fixture(), api = f.context;
  api.validPresentationClose = function (detail) { return detail.valid === true; };
  api.requestProjectSplitViews();
  var saved = view(api.preset(['origin-1', 'origin-2', 'origin-3'], 'balanced'), f.sessions);
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 2, views: [saved] });
  f.store.set({ projectSplitViewActiveId: saved.id, projectSplitViewFocusedOrigin: 'origin-1' });
  api.onClosePane({ detail: { sessionId: 1 } }); assert.equal(f.sent.length, 1);
  api.onClosePane({ detail: { sessionId: 1, valid: true } });
  var mutation = f.sent[1]; assert.equal(mutation.type, 'project_split_view_update');
  assert.equal(JSON.stringify(mutation.tree), JSON.stringify(saved.tree.right));
  assert.equal(f.store.get('projectSplitViews')[0], saved);
  api.handleProjectSplitViewResult({ requestId: mutation.requestId, ok: false, code: 'storage', error: 'Disk failed' });
  assert.equal(f.store.get('projectSplitViews')[0], saved); assert.equal(f.store.get('activeSessionId'), 1);
  f.store.set({ projectSplitViewError: '' });
  api.onClosePane({ detail: { sessionId: 1, valid: true } }); mutation = f.sent[2];
  api.handleProjectSplitViewResult({ requestId: mutation.requestId, ok: true, revision: 3 });
  var changed = view(mutation.tree, f.sessions.slice(1)); changed.activeSessionOriginId = 'origin-2';
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 3, views: [changed] });
  assert.equal(f.store.get('projectSplitViewFocusedOrigin'), null);
  assert.equal(f.sent[3].type, 'switch_session'); assert.equal(f.sent[3].id, 2);
  assert.equal(f.sessions.length, 3);
});

test('two-pane removal keeps the exact remaining singleton while parent activation is pending', function () {
  var f = fixture(), api = f.context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/split-view-singleton.js'), 'utf8').replace(/^import .*;$/gm, '').replace(/^export function /gm, 'function '), api);
  f.sessions.forEach(function (item) { item.ownerId = 'owner'; });
  api.validPresentationClose = function () { return true; };
  api.requestProjectSplitViews();
  var saved = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 1, views: [saved] });
  f.store.set({ projectSplitViewActiveId: saved.id });
  api.onClosePane({ detail: { sessionId: 1 } });
  var request = f.sent[1]; assert.equal(request.type, 'project_split_view_separate');
  api.handleProjectSplitViewResult({ requestId: request.requestId, ok: true, revision: 2 });
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 2, views: [] });
  assert.equal(f.store.get('activeSessionId'), 1, 'parent activation is still awaiting its server response');
  assert.equal(api.currentSingletonPresentation(f.store.snap(), f.sessions).origin, 'origin-2');
  assert.equal(f.sent[2].type, 'switch_session'); assert.equal(f.sent[2].id, 2);
  assert.equal(f.sessions.length, 3);
});

test('organization waits for authoritative acknowledgement and rejects stale revisions and socket replies', function () {
  var f = fixture(), api = f.context;
  api.requestProjectSplitViews();
  var first = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2)); first.folderId = null; first.favorite = false;
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 1, views: [first] });
  assert.equal(api.organizePresentationView('view-a', 0, 'f_first1', true), false);
  assert.equal(api.organizePresentationView('view-a', 1, 'f_first1', true), true);
  assert.equal(f.store.get('projectSplitViews')[0].favorite, false);
  assert.equal(api.organizePresentationView('view-a', 1, null, false), false);
  var msg = f.sent[f.sent.length - 1]; assert.equal(msg.type, 'project_split_view_organize'); assert.equal(msg.projectSlug, 'proj'); assert.equal(msg.expectedViewRevision, 1);
  api.handleProjectSplitViewResult({ requestId: msg.requestId, ok: true, revision: 2, view: { id: first.id } });
  assert.equal(f.store.get('projectSplitViews')[0].favorite, false);
  var changed = Object.assign({}, first, { revision: 2, folderId: 'f_first1', favorite: true });
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 2, views: [changed] });
  assert.equal(f.store.get('projectSplitViews')[0].favorite, true);
  api.replaceSocket({ readyState: 1, send: function () {} });
  assert.equal(api.handleProjectSplitViews({ projectSlug: 'proj', revision: 3, views: [first] }), false);
  assert.equal(f.store.get('projectSplitViews')[0].favorite, true);
});

test('resize receipt cannot authorize another view or a replaced revision', function () {
  var f = fixture(), api = f.context;
  api.requestProjectSplitViews();
  var a = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  f.sessions.push({ id: 4, sessionOriginId: 'origin-4', sessionRole: 'driver' });
  var b = Object.assign({}, view(api.preset(['origin-3', 'origin-4'], 'balanced'), f.sessions.slice(2)), { id: 'view-b', activeSessionOriginId: 'origin-3' });
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 1, views: [a, b] });
  f.store.set({ projectSplitViewActiveId: a.id });
  var scope = api.layoutScope(a), before = f.sent.length;
  api.onResize({ detail: { viewId: b.id, scope: scope, tree: b.tree, ids: ['origin-3', 'origin-4'] } });
  assert.equal(f.sent.length, before, 'A receipt must not write B');
  var revised = Object.assign({}, a, { revision: 2 });
  f.store.set({ projectSplitViews: [revised, b] });
  api.onResize({ detail: { viewId: a.id, scope: scope, tree: a.tree, ids: ['origin-1', 'origin-2'] } });
  assert.equal(f.sent.length, before, 'stale revision must not write');
  api.onResize({ detail: { viewId: a.id, scope: api.layoutScope(revised), tree: a.tree, ids: ['origin-1', 'origin-2'] } });
  assert.equal(f.sent.length, before + 1);
  assert.equal(f.sent[before].id, a.id);
});

test('active-session persistence uses only the exact view current preview', function () {
  var f = fixture(), api = f.context, writes = [];
  var a = view(api.preset(['origin-1', 'origin-2'], 'balanced'), f.sessions.slice(0, 2));
  f.sessions.push({ id: 4, sessionOriginId: 'origin-4', sessionRole: 'driver' });
  var b = Object.assign({}, view(api.preset(['origin-3', 'origin-4'], 'balanced'), f.sessions.slice(2)), { id: 'view-b', activeSessionOriginId: 'origin-3' });
  f.store.set({ projectSplitViews: [a, b], projectSplitViewActiveId: a.id });
  var preview = api.resize(a.tree, [], .7);
  f.store.set({ projectSplitViewPreviewTree: preview, projectSplitViewPreviewScope: api.layoutScope(a) });
  function submit(type, body) { writes.push(body); }
  api.updateActiveSession(a, 'origin-2', submit);
  assert.equal(writes.pop().tree, preview);
  assert.equal(api.presentationTree(b), b.tree, 'explicit B lookup must reject valid active A preview');
  assert.equal(api.presentationTree(Object.assign({}, a, { revision: 2 })), a.tree, 'preview must match passed revision');
  api.updateActiveSession(b, 'origin-3', submit);
  assert.equal(writes.pop().tree, b.tree, 'current A preview cannot become B tree');
  f.store.set({ projectSplitViewActiveId: b.id });
  api.updateActiveSession(b, 'origin-3', submit);
  assert.equal(writes.pop().tree, b.tree);
  f.store.set({ projectSplitViewActiveId: a.id });
  api.updateActiveSession(a, 'origin-1', submit);
  assert.equal(writes.pop().tree, a.tree, 'returning to A must not revive an old preview');
});


test('singleton presentation refuses the blocked old identity socket', function () {
  var f = fixture(), api = f.context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/split-view-singleton.js'), 'utf8').replace(/^import .*;$/gm, '').replace(/^export function /gm, 'function '), api);
  var state = Object.assign({}, f.store.snap());
  state.splitIdentityBlockedSocket = api.getWs();
  assert.equal(api.currentSingletonPresentation(state, f.sessions), null);
  assert.equal(api.requestProjectSplitViews(), true);
  f.store.set({ splitIdentityBlockedSocket: api.getWs() });
  var count = f.sent.length;
  assert.equal(api.requestProjectSplitViews(), false);
  assert.equal(f.sent.length, count, 'the revoked connection cannot request another saved view');
});

test('unchanged authenticated view refresh preserves a captured drag; real revision changes cancel it', function () {
  var f = fixture(), api = f.context;
  api.requestProjectSplitViews();
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 1, views: [] });
  var drag = { pointerId: 7, frames: [], moved: true };
  f.store.set({ projectSplitViewDrag: drag });
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 1, views: [] });
  assert.equal(f.store.get('projectSplitViewDrag'), drag);
  api.handleProjectSplitViews({ projectSlug: 'proj', revision: 2, views: [] });
  assert.equal(f.store.get('projectSplitViewDrag'), null);
});
