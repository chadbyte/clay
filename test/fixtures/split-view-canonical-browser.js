import { store } from '/p/reuse/modules/store.js';
import { showContextualAsk } from '/p/reuse/modules/contextual-clay.js';
import { preset } from '/p/reuse/modules/split-view-layout-client.js';
import { getCachedSessions } from '/p/reuse/modules/sidebar-sessions.js';
var panel = document.createElement('details'); panel.id = 'canonical-view-fixture';
panel.innerHTML = '<summary>Canonical Split view controls</summary><p>Isolated production tools. Changes require the actual Clay review card. Open Clay review first.</p><button data-view-fixture="review">Open Clay review</button><button data-view-fixture="read">Inspect saved views and screen</button><button data-view-fixture="create">Create from two unused Drivers</button><button data-view-fixture="open">Open first saved view</button><button data-view-fixture="rows">Arrange active view in rows</button><button data-view-fixture="focus">Toggle first-member focus</button><button data-view-fixture="favorite">Toggle active Favorite</button><pre aria-live="polite"></pre>';
document.body.appendChild(panel);
var output = panel.querySelector('pre');
async function call(kind, args) {
  var response = await fetch('/fixture/view-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kind, args: args }) });
  var result = await response.json(); output.textContent = JSON.stringify(result, null, 2); return result;
}
panel.addEventListener('click', async function (event) {
  var button = event.target.closest('[data-view-fixture]'); if (!button) return;
  try {
    var action = button.dataset.viewFixture;
    if (action === 'review') { var info = await (await fetch('/fixture/view-control-info')).json(); showContextualAsk(info.mate, 'fixture-view-review', info.sessionId); return; }
    var viewerRef = store.get('clayControlViewerRef'), projectSlug = store.get('currentSlug');
    var read = await call('read', { action: 'split_views', viewerRef: viewerRef, projectSlug: projectSlug });
    if (action === 'read' || read.status === 'failed') return;
    var view = read.views.find(function (item) { return item.id === store.get('projectSplitViewActiveId'); }) || read.views[0];
    var op = { action: 'split_view', viewerRef: viewerRef, projectSlug: projectSlug, accountId: store.get('myUserId') || null, expectedRevision: read.revision };
    if (action === 'create') {
      var used = read.views.flatMap(function (item) { return item.sessions.map(function (session) { return session.sessionOriginId; }); });
      var ids = getCachedSessions().filter(function (session) { return session.sessionRole !== 'worker' && session.ownerId === store.get('myUserId') && used.indexOf(session.sessionOriginId) < 0; }).slice(0, 2).map(function (session) { return session.sessionOriginId; });
      if (ids.length !== 2) throw new Error('Two unused Drivers are required.');
      Object.assign(op, { change: 'create', name: 'Split view', sessionOrigins: ids, layout: 'columns', tree: preset(ids, 'columns'), activeSessionOriginId: ids[0] });
    } else {
      if (!view) throw new Error('Create a view first.');
      Object.assign(op, { id: view.id, expectedViewRevision: view.revision });
      if (action === 'open' || action === 'focus') Object.assign(op, { change: action, focusOrigin: action === 'focus' && !store.get('projectSplitViewFocusedOrigin') ? view.sessions[0].sessionOriginId : null });
      if (action === 'favorite') Object.assign(op, { change: 'organize', favorite: !view.favorite, folderId: view.folderId });
      if (action === 'rows') { var origins = view.sessions.map(function (session) { return session.sessionOriginId; }); Object.assign(op, { change: 'update', sessionOrigins: origins, layout: 'rows', tree: preset(origins, 'rows'), activeSessionOriginId: view.activeSessionOriginId }); }
    }
    var inspected = await call('inspect', { operation: op }); if (!inspected.targetToken) return;
    output.textContent = 'Awaiting the authenticated Clay review card. No fixture auto-approval.';
    var result = await call('apply', { targetToken: inspected.targetToken, requestId: 'fixture-view-' + crypto.randomUUID(), why: 'Verify the selected isolated view through production controls.' });
    if (result.deliveryId) await call('read', { action: 'delivery', deliveryId: result.deliveryId });
  } catch (error) { output.textContent = error.message; }
});
