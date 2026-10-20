var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var callbacks = [], events = [], panes = [], dividers = [];
  function element() { return { dataset: {}, style: {}, handlers: {}, classList: { contains: function () { return false; }, add: function () {}, remove: function () {} },
    addEventListener: function (name, fn) { this.handlers[name] = fn; }, setAttribute: function () {}, remove: function () {}, focus: function () {} }; }
  var host = Object.assign(element(), { clientWidth: 1000, clientHeight: 700, isConnected: true,
    querySelectorAll: function (selector) { if (selector.includes('divider')) return []; if (selector.includes('frame')) return panes.map(function (p) { return p.frame; }); return panes; },
    appendChild: function (node) { dividers.push(node); } });
  var api = vm.createContext({ getWs: function () { return socket; },
    document: { activeElement: null, createElement: element, dispatchEvent: function (event) { events.push(event); }, body: element(), documentElement: { hasPointerCapture: function () { return false; }, setPointerCapture: function () {} } },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    window: { location: { origin: 'http://fixture' }, getComputedStyle: function () { return {}; }, requestAnimationFrame: function (fn) { callbacks.push(fn); } } });
  var socket = {};
  ['store', 'split-view-layout-client', 'split-view-layout-scope', 'split-view-drag-preview', 'split-view-presentation-renderer'].forEach(function (name) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + name + '.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '').replace(/^export /gm, ''), api);
  });
  api.host = host; api.ensureArrangeTrigger = function () {}; api.ensureDropPreview = function () {};
  var a = { id: 'A', revision: 1, tree: { axis: 'horizontal', ratio: .25, left: { id: 'one' }, right: { axis: 'vertical', ratio: .7, left: { id: 'two' }, right: { id: 'three' } } } };
  var b = { id: 'B', revision: 1, tree: { axis: 'vertical', ratio: .6, left: { id: 'three' }, right: { axis: 'horizontal', ratio: .8, left: { id: 'four' }, right: { id: 'one' } } } };
  api.createStore({ currentSlug: 'p', myUserId: 'owner', currentProjectOwnerId: 'owner', projectSplitViewContextKey: 'context', connected: true,
    projectSplitViewPreviewTree: null, projectSplitViewSocketGeneration: 1, projectSplitViews: [a,b], projectSplitViewActiveId: 'A' });
  function pane(target, actual) {
    var frame = Object.assign(element(), { dataset: { sessionOriginId: actual, projectSlug: 'p' }, contentDocument: { getElementById: function () { return null; } } });
    var p = Object.assign(element(), { dataset: { splitPaneKey: 'p#' + target, sessionOrigin: target }, frame: frame,
      querySelector: function (selector) { return selector === '.split-pane-frame' ? frame : null; } });
    panes.push(p); return p;
  }
  return { api: api, a: a, b: b, pane: pane, panes: panes, host: host, events: events, dividers: dividers, callbacks: callbacks,
    switchTo: function (view) { api.store.set({ projectSplitViewActiveId: view.id, projectSplitViewPreviewTree: null }); } };
}
test('pending retarget geometry belongs to reconciled destination, not iframe previous conversation', function () {
  var f = fixture(); f.switchTo(f.b);
  var p = f.pane('four', 'two'); p.dataset.presentationOrigin = 'four';
  f.api.applyGeometry(f.b, f.b.tree);
  var expected = f.api.rectangles(f.b.tree, 1000, 700, 7).panes.four;
  assert.equal(p.style.left, expected.x + 'px'); assert.equal(p.style.top, expected.y + 'px'); assert.equal(p.style.width, expected.width + 'px');
});
test('captured A divider cannot resize B after a view hop', function () {
  var f = fixture(); f.pane('one', 'one'); f.api.applyGeometry(f.a, f.a.tree);
  var divider = f.dividers[0]; f.switchTo(f.b);
  divider.handlers.keydown({ key: 'ArrowRight', preventDefault: function () {} });
  assert.equal(f.events.length, 0); assert.equal(f.api.store.get('projectSplitViewPreviewTree'), null);
});
test('pointer preview cancels across view, revision and connection changes', function () {
  ['view', 'revision', 'socket'].forEach(function (change) {
    var f = fixture(); f.pane('one', 'one'); f.api.applyGeometry(f.a, f.a.tree);
    f.dividers[0].handlers.pointerdown({ button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault: function () {} });
    if (change === 'view') f.switchTo(f.b);
    if (change === 'revision') f.api.store.set({ projectSplitViews: [Object.assign({}, f.a, { revision: 2 }), f.b] });
    if (change === 'socket') f.api.store.set({ projectSplitViewSocketGeneration: 2 });
    f.api.onPointerMove({ pointerId: 1, clientX: 300, clientY: 100, preventDefault: function () {} });
    f.api.onPointerUp({ pointerId: 1 });
    assert.equal(f.events.length, 0, change); assert.equal(f.api.store.get('projectSplitViewPreviewTree'), null, change);
    assert.equal(f.api.store.get('projectSplitViewDividerDrag'), null, change);
  });
});
test('returning to A does not revive an old divider or preview receipt', function () {
  var f = fixture(); f.pane('one', 'one'); f.api.applyGeometry(f.a, f.a.tree);
  var old = f.dividers[0], scope = f.api.layoutScope(f.a);
  f.api.store.set({ projectSplitViewPreviewTree: f.api.resize(f.a.tree, [], .8), projectSplitViewPreviewScope: scope });
  f.switchTo(f.b); f.switchTo(f.a);
  f.api.store.set({ projectSplitViewPreviewTree: f.b.tree });
  assert.equal(f.api.presentationTree(f.a), f.a.tree);
  old.handlers.keydown({ key: 'ArrowRight', preventDefault: function () {} }); assert.equal(f.events.length, 0);
});
test('repeated nested/order/count changes use destination rectangles without changing retained documents or saved trees', function () {
  var f = fixture(), p = f.pane('one', 'one'), q = f.pane('two', 'two'), r = f.pane('three', 'three');
  var docs = f.panes.map(function (item) { return item.frame.contentDocument; }), saved = JSON.stringify([f.a, f.b]);
  var small = { id: 'small', revision: 1, tree: { axis: 'horizontal', ratio: .7, left: { id: 'four' }, right: { id: 'three' } } };
  f.api.store.set({ projectSplitViews: [f.a,f.b,small] });
  [f.a,f.b,f.a,f.b,small,f.a].forEach(function (view) {
    f.switchTo(view); var ids = f.api.listIds(view.tree);
    f.panes.length = 0; [p,q,r].slice(0,ids.length).forEach(function (item, index) { item.dataset.presentationOrigin = ids[index]; f.panes.push(item); });
    f.api.applyGeometry(view, view.tree); var geometry = f.api.rectangles(view.tree,1000,700,7);
    f.panes.forEach(function (item) { var rect = geometry.panes[item.dataset.presentationOrigin]; assert.equal(item.style.left,rect.x+'px'); assert.equal(item.style.top,rect.y+'px'); assert.equal(item.style.width,rect.width+'px'); assert.equal(item.style.height,rect.height+'px'); });
  });
  [p,q,r].forEach(function (item,index) { assert.equal(item.frame.contentDocument,docs[index]); });
  assert.equal(JSON.stringify([f.a,f.b]),saved);
});
test('queued geometry end cannot act after context hop even when frame binding is unchanged', function () {
  var f = fixture(), p = f.pane('one','one'), sent = [];
  var transcript = { scrollTop: 14, isConnected: true, addEventListener: function () {} };
  var binding = { sessionId: 1, sessionOriginId: 'one', generation: 1, requestId: 'x' };
  p.frame.contentDocument.getElementById = function () { return transcript; };
  p.frame.contentWindow = { postMessage: function (msg) { sent.push(msg); } };
  p.frame.clayPane = { identity: function () { return { ready: true, binding: binding }; } };
  f.api.applyGeometry(f.a,f.a.tree); assert.equal(sent.length,1);
  f.switchTo(f.b); f.switchTo(f.a); f.callbacks.forEach(function (fn) { fn(); });
  assert.equal(sent.length,1); assert.equal(transcript.scrollTop,14);
});
test('a current divider changes only its own immutable tree and cancelled drag never persists', function () {
  var f = fixture(), saved = JSON.stringify(f.a.tree); f.pane('one','one'); f.api.applyGeometry(f.a,f.a.tree);
  f.dividers[0].handlers.keydown({ key:'ArrowRight', preventDefault:function () {} });
  assert.equal(f.events.length,1); assert.equal(f.events[0].detail.viewId,'A'); assert.equal(f.api.currentLayoutScope(f.events[0].detail.scope),true);
  assert.equal(JSON.stringify(f.a.tree),saved);
  var divider=f.dividers[f.dividers.length-2];
  divider.handlers.pointerdown({ button:0,pointerId:3,clientX:100,clientY:100,preventDefault:function () {} });
  f.api.onPointerMove({pointerId:3,clientX:130,clientY:100,preventDefault:function () {}});
  f.api.onPointerCancel({pointerId:3}); assert.equal(f.events.length,1); assert.equal(f.api.store.get('projectSplitViewPreviewTree'),null);
});
test('production render assigns destination origins from reconciled keys before pending frame activation', function () {
  var f=fixture(), p=f.pane('four','two'), q=f.pane('one','three'), activations=[];
  var target={id:'target',revision:1,tree:{axis:'horizontal',ratio:.7,left:{id:'four'},right:{id:'one'}}};
  f.api.store.set({projectSplitViews:[target],projectSplitViewActiveId:'target'});
  p.dataset.splitPaneKey='p#2'; q.dataset.splitPaneKey='p#3'; p.parentNode=f.host; q.parentNode=f.host;
  vm.runInContext(fs.readFileSync('lib/public/modules/split-pane-reconciler.js','utf8').replace(/^export /gm,''),f.api);
  f.api.paneRetention=function () { return null; };
  var metadata=fs.readFileSync('lib/public/modules/split-pane-renderer.js','utf8');
  metadata=metadata.slice(metadata.indexOf('export function updateSplitPaneMetadata'),metadata.indexOf('export function updateSplitPaneCloseVisibility')).replace('export ','');
  vm.runInContext(metadata,f.api);
  var sessions=[{id:4,sessionOriginId:'four'},{id:1,sessionOriginId:'one'}];
  f.api.clearPanePairChrome=function () {};
  f.api.sessionById=function (id) { return sessions.find(function (item) { return item.id===id; }); };
  f.api.getCachedSessions=function () { return sessions; };
  f.api.paneTarget=function (state,items,id) { return items.find(function (item) { return item.id===id; }); };
  [p,q].forEach(function (pane,index) {
    var frame=pane.frame; frame.contentWindow={}; frame.dataset.sessionId=String(index+2);
    var live={ready:true,sessionId:index+2,binding:{sessionOriginId:frame.dataset.sessionOriginId}};
    frame.clayPane={source:frame.contentWindow,document:frame.contentDocument,identity:function () { return live; },
      activate:function (id,force,target) { activations.push([id,target.sessionOriginId]); live.ready=false; return true; }};
  });
  f.api.createSplitPane=function () { throw new Error('Unexpected remount'); };
  f.api.relocateStickyStatus=function () {}; f.api.ensureArrangeMenu=function () {}; f.api.updateSplitPaneCloseVisibility=function () {};
  f.api.bindPresentationClose=function () {}; f.api.refreshIcons=function () {};
  f.api.renderPresentationView(target,target.tree,[{id:4,sessionOriginId:'four'},{id:1,sessionOriginId:'one'}]);
  assert.deepEqual(activations,[[4,'four'],[1,'one']]);
  assert.equal(p.frame.dataset.requestedSessionId,'4'); assert.equal(p.frame.dataset.sessionId,'2');
  assert.equal(q.frame.dataset.sessionOriginId,'three'); assert.equal(q.frame.dataset.sessionId,'3');
  assert.equal(p.dataset.presentationOrigin,'four'); assert.equal(p.frame.dataset.sessionOriginId,'two');
  assert.equal(p.style.width,(993*.7)+'px'); assert.equal(q.style.left,(993*.7+7)+'px');
});
test('ordinary disjoint asymmetric A4 to balanced B4 to mature ready A4 retains exact rectangles without a later render', function () {
  var f=fixture(), sessions=[], activations=[], original=[];
  for(var i=1;i<=8;i++) sessions.push({id:i,sessionOriginId:'s'+i});
  var a={id:'four-A',revision:1,tree:{axis:'horizontal',ratio:.371,left:{id:'s3'},right:{axis:'vertical',ratio:.623,left:{axis:'horizontal',ratio:.417,left:{id:'s2'},right:{id:'s1'}},right:{id:'s4'}}}};
  var b={id:'four-B',revision:1,tree:f.api.preset(['s5','s6','s7','s8'],'balanced')};
  f.api.store.set({projectSplitViews:[a,b],projectSplitViewActiveId:a.id});
  vm.runInContext(fs.readFileSync('lib/public/modules/split-pane-reconciler.js','utf8').replace(/^export /gm,''),f.api);
  var metadata=fs.readFileSync('lib/public/modules/split-pane-renderer.js','utf8');
  vm.runInContext(metadata.slice(metadata.indexOf('export function updateSplitPaneMetadata'),metadata.indexOf('export function updateSplitPaneCloseVisibility')).replace('export ',''),f.api);
  f.api.paneRetention=function () { return null; }; f.api.clearPanePairChrome=function () {};
  f.api.getCachedSessions=function () { return sessions; }; f.api.sessionById=function (id) { return sessions.find(function (item) { return item.id===id; }); };
  f.api.paneTarget=function (state,items,id) { return f.api.sessionById(id); };
  f.api.createSplitPane=function () { throw new Error('Unexpected remount'); };
  f.api.relocateStickyStatus=function () {}; f.api.ensureArrangeMenu=function () {}; f.api.updateSplitPaneCloseVisibility=function () {};
  f.api.bindPresentationClose=function () {}; f.api.refreshIcons=function () {};
  for(var index=0;index<4;index++) {
    var pane=f.pane('s'+(index+1),'s'+(index+1)); pane.parentNode=f.host; pane.dataset.splitPaneKey='p#'+(index+1);
    pane.dataset.presentationOrigin='s'+(index+1); pane.frame.dataset.sessionId=String(index+1); pane.frame.contentWindow={};
    (function (frame) {
      var live={ready:true}; frame.clayPane={source:frame.contentWindow,document:frame.contentDocument,identity:function () { return live; },
        activate:function (id,force,target) { activations.push(id); live.ready=false; frame.pending=target; return true; }};
      frame.settle=function () { frame.dataset.sessionId=String(frame.pending.id); frame.dataset.sessionOriginId=frame.pending.sessionOriginId; delete frame.dataset.requestedSessionId; live.ready=true; };
    })(pane.frame);
    original.push(pane.frame.contentDocument);
  }
  f.api.applyGeometry(a,a.tree); var saved=JSON.stringify([a,b]);
  [b,a].forEach(function (target) {
    f.switchTo(target); var ids=f.api.listIds(target.tree);
    f.api.renderPresentationView(target,target.tree,sessions.filter(function (item) { return ids.includes(item.sessionOriginId); }));
    f.panes.forEach(function (pane) { assert.notEqual(pane.frame.dataset.sessionOriginId,pane.dataset.presentationOrigin); pane.frame.settle(); });
    var expected=f.api.rectangles(target.tree,1000,700,7).panes;
    f.panes.forEach(function (pane,index) { var rect=expected[pane.frame.dataset.sessionOriginId];
      assert.equal(pane.style.left,rect.x+'px'); assert.equal(pane.style.top,rect.y+'px'); assert.equal(pane.style.width,rect.width+'px'); assert.equal(pane.style.height,rect.height+'px');
      assert.equal(pane.frame.contentDocument,original[index]); assert.equal(pane.frame.clayPane.identity().ready,true);
    });
  });
  assert.equal(activations.length,8); assert.equal(JSON.stringify([a,b]),saved);
});
