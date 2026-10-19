import { rectangles } from '/p/reuse/modules/split-view-layout-client.js';
import { store } from '/p/reuse/modules/store.js';
import { getCachedSessions } from '/p/reuse/modules/sidebar-sessions.js';

function waitFor(check, label) {
  var started = performance.now();
  return new Promise(function (resolve, reject) {
    function tick() {
      if (check()) { resolve(); return; }
      if (performance.now() - started > 20000) { reject(new Error(label + ' timed out')); return; }
      requestAnimationFrame(tick);
    }
    tick();
  });
}
function view() { return (store.get('projectSplitViews') || []).find(function (item) { return item.id === store.get('projectSplitViewActiveId'); }); }
function ready() {
  var current = view(), panes = Array.from(document.querySelectorAll('#split-host > .split-pane'));
  return current && panes.length === current.sessions.length && panes.every(function (pane) {
    var frame = pane.querySelector('.split-pane-frame'), live = frame && frame.clayPane && frame.clayPane.identity();
    return live && live.ready && !frame.dataset.requestedSessionId;
  });
}
function checkGeometry() {
  var host = document.getElementById('split-host'), style = getComputedStyle(host);
  var left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
  var width = host.clientWidth - left - (parseFloat(style.paddingRight) || 0);
  var height = host.clientHeight - top - (parseFloat(style.paddingBottom) || 0);
  var expected = rectangles(view().tree, width, height, 7).panes;
  Array.from(host.querySelectorAll(':scope > .split-pane')).forEach(function (pane) {
    var rect = expected[pane.querySelector('.split-pane-frame').dataset.sessionOriginId];
    if (!rect || pane.hidden) throw new Error('A restored pane is absent or hidden');
    [['left', rect.x + left], ['top', rect.y + top], ['width', rect.width], ['height', rect.height]].forEach(function (entry) {
      if (Math.abs(parseFloat(pane.style[entry[0]]) - entry[1]) > 0.1) throw new Error('Restored pane geometry differs: ' + entry[0]);
    });
  });
}
async function prepare() {
  await waitFor(function () { return store.get('projectSplitViewHydrated') && getCachedSessions().length; }, 'project hydration');
  var sessions = ['Standalone 3', 'Standalone 1', 'Standalone 0', 'Standalone 2'].map(function (title) { return getCachedSessions().find(function (item) { return item.title === title; }); });
  document.querySelector('.session-item[data-session-id="' + sessions[0].id + '"]').click();
  await waitFor(function () { return store.get('activeSessionId') === sessions[0].id; }, 'initial selection');
  document.dispatchEvent(new CustomEvent('clay-split-view-create', { detail: { origins: sessions.map(function (item) { return item.sessionOriginId; }) } }));
  await waitFor(function () { return ready() && !store.get('projectSplitViewPending'); }, 'view creation');
  var ids = sessions.map(function (item) { return item.sessionOriginId; });
  document.dispatchEvent(new CustomEvent('clay-split-view-arrange', { detail: { preset: 'main-right', sessionOriginId: ids[2] } }));
  await waitFor(function () { return ready() && !store.get('projectSplitViewPending') && view().layout === 'main-right'; }, 'preset persistence');
  var custom = { axis: 'horizontal', ratio: 0.371, left: { id: ids[3] }, right: { axis: 'vertical', ratio: 0.623,
    left: { axis: 'horizontal', ratio: 0.417, left: { id: ids[1] }, right: { id: ids[2] } }, right: { id: ids[0] } } };
  document.dispatchEvent(new CustomEvent('clay-split-view-resize', { detail: { viewId: view().id, tree: custom, ids: ids } }));
  await waitFor(function () { return ready() && !store.get('projectSplitViewPending') && JSON.stringify(view().tree) === JSON.stringify(custom); }, 'custom nested layout persistence');
  document.querySelector('.session-item[data-session-id="' + sessions[1].id + '"]').click();
  await waitFor(function () { return ready() && store.get('activeSessionId') === sessions[1].id && view().activeSessionOriginId === sessions[1].sessionOriginId && !store.get('projectSplitViewPending'); }, 'second member selection');
  checkGeometry();
  var receipt = { layout: view().layout, activeOrigin: view().activeSessionOriginId, viewport: [innerWidth, innerHeight], hostSize: [document.getElementById('split-host').clientWidth, document.getElementById('split-host').clientHeight], viewId: view().id, tree: view().tree, origins: view().sessions.map(function (item) { return item.sessionOriginId; }),
    selectedId: sessions[1].id, selectedOrigin: sessions[1].sessionOriginId, revision: store.get('projectSplitViewRevision'), pairs: store.get('splitGroups') };
  var response = await fetch('/fixture/refresh-receipt', { method: 'POST', body: JSON.stringify(receipt) });
  if (!response.ok) throw new Error('Could not store refresh receipt');
  return { prepared: true, receipt: receipt };
}
async function verify() {
  var receipt = await (await fetch('/fixture/refresh-receipt')).json();
  if (!receipt) throw new Error('Prepare the refresh check first');
  await waitFor(function () { return ready() && view().id === receipt.viewId; }, 'full Split view restoration');
  checkGeometry();
  var host = document.getElementById('split-host');
  if (JSON.stringify([innerWidth, innerHeight]) === JSON.stringify(receipt.viewport) && JSON.stringify([host.clientWidth, host.clientHeight]) !== JSON.stringify(receipt.hostSize)) throw new Error('Refresh changed the workspace viewport at the same browser size');
  if (view().layout !== receipt.layout || view().activeSessionOriginId !== receipt.activeOrigin) throw new Error('Refresh changed preset or active origin');
  if (JSON.stringify(view().sessions.map(function (item) { return item.sessionOriginId; })) !== JSON.stringify(receipt.origins)) throw new Error('Refresh changed saved membership order');
  if (JSON.stringify(view().tree) !== JSON.stringify(receipt.tree)) throw new Error('Refresh changed the layout tree');
  if (store.get('projectSplitViewRevision') !== receipt.revision) throw new Error('Refresh wrote presentation state');
  if (store.get('projectSplitViewSingletonOrigin')) throw new Error('Refresh left a singleton presentation');
  if (JSON.stringify(store.get('splitGroups')) !== JSON.stringify(receipt.pairs)) throw new Error('Refresh changed Worker execution groups');
  if (store.get('activeSessionId') !== receipt.selectedId) throw new Error('Refresh lost the selected member');
  return { verified: true, viewId: view().id, paneCount: view().sessions.length, selectedId: store.get('activeSessionId'), revision: receipt.revision };
}
var panel = document.createElement('aside'); panel.setAttribute('aria-label', 'Split view refresh fixture');
panel.style.cssText = 'position:fixed;right:12px;top:12px;z-index:99999;width:330px;padding:9px;background:#f5f3ee;color:#252525;border:1px solid #9c9a94;border-radius:8px;font:12px sans-serif';
var output = document.createElement('pre'); output.setAttribute('role', 'status'); output.style.whiteSpace = 'pre-wrap';
[['Prepare refresh check', prepare], ['Verify restored Split view', verify]].forEach(function (entry) {
  var button = document.createElement('button'); button.textContent = entry[0];
  button.addEventListener('click', async function () {
    button.disabled = true; output.textContent = 'Checking…';
    try { output.textContent = JSON.stringify(await entry[1](), null, 2); }
    catch (error) { output.textContent = JSON.stringify({ error: error.message }); }
    button.disabled = false;
  });
  panel.appendChild(button);
});
panel.appendChild(output); document.body.appendChild(panel);
