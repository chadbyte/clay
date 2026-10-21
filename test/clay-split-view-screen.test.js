var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function load(context, name) { vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context); }
function fixture() {
  var values = { connected: true, myUserId: 'owner', currentSlug: 'alpha', projectSplitViewActiveId: 'view', projectSplitViewFocusedOrigin: null, activeSessionId: 1,
    paneBindingSessions: [{ id: 1, sessionOriginId: 'a', ownerId: 'owner' }, { id: 2, sessionOriginId: 'b', ownerId: 'owner' }],
    projectSplitViews: [{ id: 'view', revision: 2, tree: { axis: 'horizontal', ratio: 0.5, left: { id: 'a' }, right: { id: 'b' } }, sessions: [{ id: 1, sessionOriginId: 'a' }, { id: 2, sessionOriginId: 'b' }] }] };
  var panels = {};
  var sent = [], callbacks = new Map(), timers = [], sequence = 0, handlers = {}, applied = 0;
  var socket = { readyState: 1, send: function (text) { sent.push(JSON.parse(text)); } };
  var frames = values.paneBindingSessions.map(function (session) {
    var frame = { dataset: { sessionOriginId: session.sessionOriginId, sessionId: String(session.id) }, contentDocument: {}, contentWindow: {}, shown: true, cached: false };
    var binding = { projectSlug: 'alpha', viewerId: 'owner', ownerId: 'owner', sessionId: session.id, sessionOriginId: session.sessionOriginId, role: 'driver', workerGeneration: null, parentSessionOriginId: null, groupStamp: null, requestId: 'binding-' + session.id, generation: 1 };
    var live = { ready: true, projectSlug: 'alpha', ownerId: 'owner', sessionId: session.id, binding: binding };
    frame.closest = function () { return frame.cached; };
    frame.live = live; frame.clayPane = { source: frame.contentWindow, document: frame.contentDocument, identity: function () { return live; } }; return frame;
  });
  var context = vm.createContext({ store: { snap: function () { return values; }, get: function (key) { return values[key]; } }, getWs: function () { return socket; },
    paneOwner: function (pane) { return pane.kind === 'file' ? 'file-' + pane.instanceId : pane.kind; }, filePaneState: function (id) { return (values.filePaneInstances || {})[id]; },
    document: { getElementById: function (id) { return panels[id]; }, hidden: false, querySelectorAll: function () { return frames; }, addEventListener: function (name, callback) { handlers[name] = callback; }, removeEventListener: function (name) { delete handlers[name]; } },
    visible: function (frame) { return frame.shown; }, applyReviewedSplitView: function () { applied++; return true; },
    requestAnimationFrame: function (callback) { var id = ++sequence; callbacks.set(id, callback); return id; }, cancelAnimationFrame: function (id) { callbacks.delete(id); },
    setTimeout: function (callback) { timers.push(callback); return timers.length; }, clearTimeout: function () {} });
  load(context, 'pane-binding'); load(context, 'clay-tool-pane-screen'); load(context, 'clay-split-view-screen');
  function tick() { var pending = Array.from(callbacks.values()); callbacks.clear(); pending.forEach(function (callback) { callback(); }); }
  return { panels: panels, api: context, values: values, frames: frames, socket: socket, sent: sent, tick: tick, timers: timers, handlers: handlers, applied: function () { return applied; } };
}
test('screen probe reports actual live bindings separately from hidden and cached panes after two stable frames', function () {
  var f = fixture(); f.frames[1].cached = true; f.frames[1].shown = false;
  f.api.handleSplitViewProbe({ type: 'clay_view_probe', probeId: 'probe' }); f.tick(); assert.equal(f.sent.length, 0); f.tick();
  var snap = f.sent[0].snapshot; assert.equal(snap.panes[0].visible, true); assert.equal(snap.panes[0].ready, true);
  assert.equal(snap.panes[1].visible, false); assert.equal(snap.panes[1].cached, true); assert.equal(snap.panes[1].ready, false);
});
test('render acknowledgement waits for late binding readiness and two identical binding generations', function () {
  var f = fixture(), view = f.values.projectSplitViews[0]; f.frames[1].live.ready = false;
  f.api.observeSplitViewRendering({ deliveryId: 'd', renderToken: 'token', renderDeadline: Date.now() + 5000, target: { view: view, focusOrigin: null } }, f.socket);
  f.tick(); f.tick(); assert.equal(f.sent.length, 0);
  f.frames[1].live.ready = true; f.tick(); f.frames[1].live.binding.generation++; f.tick(); assert.equal(f.sent.length, 0); f.tick();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].visible, true); assert.equal(f.sent[0].snapshot.panes[1].binding.generation, 2);
  f.timers[0](); assert.equal(f.sent.length, 1);
});
test('replaced documents, cached frames, Stop and timeout cannot claim rendered success', function () {
  for (var mode of ['document', 'cached', 'stop', 'timeout']) {
    var f = fixture();
    if (mode === 'document') f.frames[0].contentDocument = {};
    if (mode === 'cached') f.frames[0].cached = true;
    f.api.observeSplitViewRendering({ deliveryId: 'd', renderToken: 'token', renderDeadline: Date.now() + 5000, target: { view: f.values.projectSplitViews[0], focusOrigin: null } }, f.socket);
    if (mode === 'stop') f.handlers.click({ target: { closest: function () { return true; } } });
    else { f.tick(); if (mode !== 'timeout') f.tick(); f.timers[0](); }
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].visible, false, mode);
  }
});
test('changed contextual screen refuses reviewed open before invoking the shared human action', function () {
  var f = fixture(), target = { expectedScreen: f.api.splitViewScreenSnapshot(), view: f.values.projectSplitViews[0] };
  f.values.projectSplitViewFocusedOrigin = 'a'; assert.equal(f.api.applySplitViewNavigation(target), false); assert.equal(f.applied(), 0);
  f.values.projectSplitViewFocusedOrigin = null; assert.equal(f.api.applySplitViewNavigation(target), true); assert.equal(f.applied(), 1);
});

test('server render proof rejects hidden, cached, wrong active session and changed layout evidence', function () {
  var f = fixture(), proof = require('../lib/clay-split-view-render-proof'), view = f.values.projectSplitViews[0];
  view.activeSessionOriginId = 'a';
  var target = { projectSlug: 'alpha', view: view, focusOrigin: null, expectedScreen: { ownerId: 'owner' } };
  var current = { ws: f.socket, slug: 'alpha', sessionId: 1 };
  var snapshot = JSON.parse(JSON.stringify(f.api.splitViewScreenSnapshot()));
  assert.doesNotThrow(function () { proof.validate(target, { snapshot: snapshot, visible: true, surface: 'split_view' }, current, f.socket); });
  for (var mode of ['hidden', 'cached', 'binding', 'active', 'layout', 'owner']) {
    var changed = JSON.parse(JSON.stringify(snapshot));
    if (mode === 'hidden') changed.hidden = true;
    if (mode === 'cached') changed.panes[0].cached = true;
    if (mode === 'binding') changed.panes[0].binding.sessionOriginId = 'replaced';
    if (mode === 'active') changed.activeSessionId = 2;
    if (mode === 'layout') changed.tree.ratio = 0.7;
    if (mode === 'owner') changed.ownerId = 'foreign';
    assert.throws(function () { proof.validate(target, { snapshot: changed, visible: true, surface: 'split_view' }, current, f.socket); }, undefined, mode);
  }
});


test('canonical browser fixture imports the production project module graph', function () {
  var source = fs.readFileSync('test/fixtures/split-view-canonical-browser.js', 'utf8');
  for (var name of ['store', 'contextual-clay', 'split-view-layout-client', 'sidebar-sessions']) assert.ok(source.includes("from '/p/reuse/modules/" + name + ".js'"));
  assert.doesNotMatch(source, /from ['"]\/modules\//);
});

test('empty, single-session, tool-only and mixed observations preserve exact tool identities', function () {
  for (var mode of ['empty', 'single', 'tools', 'mixed']) {
    var f = fixture(), view = f.values.projectSplitViews[0];
    view.sessions = mode === 'single' || mode === 'mixed' ? [view.sessions[0]] : []; f.frames.splice(view.sessions.length);
    view.tree = view.sessions.length ? { id: 'a' } : null; view.activeSessionOriginId = view.sessions.length ? 'a' : null;
    view.workspace = { version: 1, panes: [], tree: null, activePaneId: null };
    if (mode === 'tools' || mode === 'mixed') {
      view.workspace.panes.push({ instanceId: 'file-a', kind: 'file', open: true, placement: 'docked', resource: { path: 'a.md', mode: 'pin', rendered: true } });
      f.values.filePaneInstances = { 'file-a': { content: 'alpha', resource: { path: 'a.md', mode: 'pin', rendered: true } } };
      f.panels['file-file-a'] = { dataset: { workbenchPlacement: 'docked' }, shown: true, getBoundingClientRect: function () { return { x: 1, y: 2, width: 300, height: 400 }; } };
    }
    var snap = f.api.splitViewScreenSnapshot(); assert.equal(snap.tools.length, mode === 'tools' || mode === 'mixed' ? 1 : 0);
    var proof = require('../lib/clay-split-view-render-proof');
    assert.doesNotThrow(function () { proof.validate({ projectSlug: 'alpha', view: view, focusOrigin: null, expectedScreen: { ownerId: 'owner' } }, { snapshot: snap, visible: true, surface: 'split_view' }, { ws: f.socket, slug: 'alpha', sessionId: 1 }, f.socket); });
    f.api.observeSplitViewRendering({ deliveryId: mode, renderToken: 'token', renderDeadline: Date.now() + 5000, target: { view: view, focusOrigin: null } }, f.socket); f.tick(); f.tick(); assert.equal(f.sent[0].visible, true, mode);
  }
});
test('unavailable tools cannot claim readiness or rendered success and malformed geometry is rejected', function () {
  var f = fixture(), view = f.values.projectSplitViews[0];
  view.workspace = { panes: [{ instanceId: 'file-a', kind: 'file', open: true, resource: { path: 'a.md', mode: 'pin', rendered: true } }] };
  f.values.filePaneInstances = { 'file-a': { error: 'Access denied' } };
  f.panels['file-file-a'] = { dataset: { workbenchPlacement: 'docked' }, shown: true, getBoundingClientRect: function () { return { x: 0, y: 0, width: 300, height: 400 }; } };
  var snapshot = JSON.parse(JSON.stringify(f.api.splitViewScreenSnapshot())), proof = require('../lib/clay-split-view-render-proof');
  assert.equal(snapshot.tools[0].unavailable, true); assert.equal(snapshot.tools[0].ready, false);
  assert.throws(function () { proof.validate({ projectSlug: 'alpha', view: view, focusOrigin: null, expectedScreen: { ownerId: 'owner' } }, { snapshot: snapshot, visible: true, surface: 'split_view' }, { ws: f.socket, slug: 'alpha', sessionId: 1 }, f.socket); });
  snapshot.tools[0].geometry.width = 100001; assert.equal(proof.snapshotSchema.safeParse(snapshot).success, false);
  snapshot.tools[0].geometry.width = 300; snapshot.tools.push(snapshot.tools[0]); assert.equal(proof.snapshotSchema.safeParse(snapshot).success, false);
});

test('expanded tool render evidence matches the exact persisted presentation and excludes obscured sessions',function(){
  var f=fixture(),view=f.values.projectSplitViews[0];view.activeSessionOriginId='a';
  view.workspace={version:1,panes:[{instanceId:'file-a',kind:'file',open:true,placement:'docked',resource:{path:'a.md',mode:'pin',rendered:true}}],presentation:{focusedSessionOriginId:null,expandedPaneId:'file-a'}};
  f.frames.forEach(function(frame){frame.shown=false;});f.values.filePaneInstances={'file-a':{content:'alpha',resource:{path:'a.md',mode:'pin',rendered:true}}};
  f.panels['file-file-a']={classList:{contains:function(name){return name==='panel-fullscreen';}},dataset:{workbenchPlacement:'docked'},shown:true,getBoundingClientRect:function(){return{x:7,y:7,width:900,height:700};}};
  var snap=f.api.splitViewScreenSnapshot(),proof=require('../lib/clay-split-view-render-proof');assert.equal(snap.expandedPaneId,'file-a');
  var target={projectSlug:'alpha',view:view,focusOrigin:null,expectedScreen:{ownerId:'owner'}};
  assert.doesNotThrow(function(){proof.validate(target,{snapshot:snap,visible:true,surface:'split_view'},{ws:f.socket,slug:'alpha',sessionId:1},f.socket);});
  snap.expandedPaneId='foreign';assert.equal(proof.snapshotSchema.safeParse(snap).success,false);
});
