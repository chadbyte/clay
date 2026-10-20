import { layoutScope } from '/p/reuse/modules/split-view-layout-scope.js';
// Visible fixture only. Uses ordinary UI actions and production layout geometry.
import { store } from '/p/reuse/modules/store.js';
import { getCachedSessions } from '/p/reuse/modules/sidebar-sessions.js';
import { rectangles, listIds } from '/p/reuse/modules/split-view-layout-client.js';
function assert(value, text) { if (!value) throw new Error(text); }
function waitFor(check, label) {
  var start = performance.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      try { if (check()) { resolve(); return; } } catch (error) { reject(error); return; }
      if (performance.now() - start > 20000) { reject(new Error('Timed out: ' + label)); return; }
      setTimeout(poll, 40);
    }
    poll();
  });
}
function view() { return (store.get('projectSplitViews') || []).find(function (item) { return item.id === store.get('projectSplitViewActiveId'); }); }
function panes() { return Array.from(document.querySelectorAll('#split-host > .split-pane')); }
function ready() { return panes().length === (view() ? view().sessions.length : 1) && panes().every(function (pane) { var frame = pane.querySelector('iframe'), live = frame.clayPane && frame.clayPane.identity(); return live && live.ready && !frame.dataset.requestedSessionId && live.binding.sessionOriginId === pane.dataset.presentationOrigin; }); }
function open(id) {
  var root = Array.from(document.querySelectorAll('.split-view-group')).find(function (item) { return item.dataset.splitViewId === id; });
  assert(root, 'Saved view row missing'); root.querySelector('.split-view-group-open').click();
}
function checkGeometry(expected) {
  var host = document.getElementById('split-host'), box = host.getBoundingClientRect(), css = getComputedStyle(host);
  var left = parseFloat(css.paddingLeft) || 0, top = parseFloat(css.paddingTop) || 0;
  var geometry = rectangles(expected.tree, host.clientWidth-left-(parseFloat(css.paddingRight)||0), host.clientHeight-top-(parseFloat(css.paddingBottom)||0),7);
  assert(panes().length === listIds(expected.tree).length, 'Wrong active pane count');
  panes().forEach(function (pane) {
    var target = geometry.panes[pane.dataset.presentationOrigin], actual = pane.getBoundingClientRect();
    assert(target, 'Pane has no destination rectangle');
    assert(Math.abs(actual.left-box.left-left-target.x)<2 && Math.abs(actual.top-box.top-top-target.y)<2 && Math.abs(actual.width-target.width)<2 && Math.abs(actual.height-target.height)<2, 'Saved-view geometry mixed at '+pane.dataset.presentationOrigin);
  });
}
async function create(origins, preset, custom) {
  var first = getCachedSessions().find(function (item) { return item.sessionOriginId === origins[0]; });
  assert(first, 'Standalone source missing');
  document.querySelector('.session-item[data-session-id="'+first.id+'"]').click();
  await waitFor(function () { return !view() && store.get('activeSessionId')===first.id && ready(); }, 'standalone before create');
  var previous = (store.get('projectSplitViews') || []).map(function (item) { return item.id; });
  document.dispatchEvent(new CustomEvent('clay-split-view-create',{detail:{origins:origins}}));
  await waitFor(function () { return view() && !previous.includes(view().id) && !store.get('projectSplitViewPending') && ready(); },'create geometry view');
  document.dispatchEvent(new CustomEvent('clay-split-view-arrange',{detail:{preset:preset,sessionOriginId:origins[0]}}));
  await waitFor(function () { return !store.get('projectSplitViewPending') && !store.get('projectSplitViewPreviewTree'); },'save arrangement');
  if (custom) {
    document.dispatchEvent(new CustomEvent('clay-split-view-resize',{detail:{viewId:view().id,tree:custom,ids:origins,scope:layoutScope(view())}}));
    await waitFor(function () { return !store.get('projectSplitViewPending') && JSON.stringify(view().tree)===JSON.stringify(custom); },'save asymmetric tree');
  }
  return JSON.parse(JSON.stringify(view()));
}
window.runSplitViewGeometryChecks = async function () {
  button.disabled=true; var result={checks:[],errors:[]};
  try {
    var sessions=Array.from({length:8},function (_,index) { return getCachedSessions().find(function (item) { return item.title==='Standalone '+index; }); });
    assert(sessions.every(Boolean),'Eight standalone fixture Drivers required');
    var ids=sessions.map(function (item) { return item.sessionOriginId; });
    var asymmetric={axis:'horizontal',ratio:.371,left:{id:ids[2]},right:{axis:'vertical',ratio:.623,left:{axis:'horizontal',ratio:.417,left:{id:ids[1]},right:{id:ids[0]}},right:{id:ids[3]}}};
    var a=await create(ids.slice(0,4),'main-right',asymmetric);
    checkGeometry(a);
    var originals=new Map(Array.from(document.querySelectorAll('#split-host iframe')).map(function (frame) { return [frame,frame.contentDocument]; }));
    var b=await create(ids.slice(4,8),'balanced'); checkGeometry(b);
    open(a.id); await waitFor(function () { return view() && view().id===a.id && panes().length===4 && ready(); },'simple A4 return');
    checkGeometry(a);
    originals.forEach(function (doc,frame) { assert(frame.isConnected && frame.contentDocument===doc,'Simple A4/B4 hop recreated a retained document'); });
    assert(JSON.stringify(view().tree)===JSON.stringify(a.tree),'Simple hop changed A saved tree');
    result.checks.push('Ordinary asymmetric A4 → standalone4 → disjoint balanced B4 → mature ready A4 preserves all rectangles/tree/documents');
    var extra = ['Benchmark 4 pane 0', 'Benchmark 4 pane 1'].map(function (title) {
      return getCachedSessions().find(function (item) { return item.title === title; });
    });
    assert(extra.every(Boolean), 'Two additional Benchmark Drivers required');
    var cOrigins = extra.map(function (item) { return item.sessionOriginId; });
    assert(cOrigins.every(function (origin) { return !ids.includes(origin); }), 'C must be disjoint from A and B');
    var c=await create(cOrigins,'columns');
    var saved=JSON.stringify([a.tree,b.tree,c.tree]);
    for(var i=0;i<9;i++) {
      var target=[a,b,c][i%3]; open(target.id);
      await waitFor(function () { return view() && view().id===target.id && ready(); },'hop '+i);
      checkGeometry(target);
      Array.from(document.querySelectorAll('#split-host iframe')).forEach(function (frame) { if(originals.has(frame)) assert(originals.get(frame)===frame.contentDocument,'Retained document was recreated'); else originals.set(frame,frame.contentDocument); });
      assert(document.querySelectorAll('#split-host iframe').length<=8,'Context pool exceeded eight documents');
    }
    open(a.id); open(b.id); open(a.id);
    await waitFor(function () { return view() && view().id===a.id && ready(); },'rapid return'); checkGeometry(a);
    var actual=[a,b,c].map(function (item) { return store.get('projectSplitViews').find(function (entry) { return entry.id===item.id; }).tree; });
    assert(JSON.stringify(actual)===saved,'Hopping mutated persisted trees');
    result.checks.push('Nested/order/disjoint/count and rapid hops retain destination rectangles, saved trees and retained documents');
  } catch(error) { result.errors.push(error.stack || String(error)); }
  button.disabled=false; output.textContent=JSON.stringify(result,null,2); window.__splitViewGeometryResult=result; return result;
};
var button=document.createElement('button'); button.type='button'; button.textContent='Run saved-view geometry checks';
var output=document.createElement('pre'); output.setAttribute('role','status');
button.addEventListener('click',function () { window.runSplitViewGeometryChecks(); });
var panel=document.querySelector('aside[aria-label="Split view production fixture"]');
if(panel) panel.append(button,output);
