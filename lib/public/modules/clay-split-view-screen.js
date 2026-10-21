import { toolPaneScreen, toolPaneRendering } from './clay-tool-pane-screen.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { livePaneBinding } from './pane-binding.js';
import { applyReviewedSplitView } from './split-view-presentations.js';
import { visible } from './clay-navigation-render.js';

var attempts = new Map();
export function splitViewScreenSnapshot() {
  var state = store.snap();
  var view = (state.projectSplitViews || []).find(function (item) { return item.id === state.projectSplitViewActiveId; });
  var hidden = !!(document.hidden || state.paneMode || !state.connected || state.dmMode || state.homeShellVisible);
  return { projectSlug: state.currentSlug || null, ownerId: state.myUserId || null, hidden: hidden,
    viewId: view ? view.id : null, revision: view ? view.revision : 0, tree: view ? view.tree : null,
    focusOrigin: state.projectSplitViewFocusedOrigin || null, singletonOrigin: state.projectSplitViewSingletonOrigin || null,
    activeSessionId: state.activeSessionId || null,
    tools: toolPaneScreen(view, hidden),
    expandedPaneId: (toolPaneScreen(view, hidden).find(function (tool) { return tool.expanded; }) || {}).instanceId || null,
    panes: Array.from(document.querySelectorAll('.split-pane-frame')).slice(0, 32).map(function (frame) {
      var live = frame.clayPane && frame.clayPane.identity(), binding = live && live.binding;
      var ready = !!livePaneBinding(frame), cached = !!frame.closest('.split-pane-cached');
      return { origin: frame.dataset.sessionOriginId || '', sessionId: Number(frame.dataset.sessionId) || 0,
        visible: !hidden && !cached && visible(frame), cached: cached, ready: ready,
        binding: ready && binding ? { requestId: binding.requestId, generation: binding.generation, sessionId: binding.sessionId, sessionOriginId: binding.sessionOriginId } : null };
    }) };
}
function stableObservation(key, socket, deadline, complete, ready) {
  if (attempts.has(key)) return;
  if (attempts.size >= 32) return;
  var animation, timer, previous, stable = 0, owner = store.get('myUserId'), slug = store.get('currentSlug'), ended = false;
  function finish(snapshot) {
    if (ended) return;
    ended = true; clearTimeout(timer); cancelAnimationFrame(animation); attempts.delete(key);
    document.removeEventListener('click', stop, true); document.removeEventListener('visibilitychange', hidden);
    if (getWs() === socket && socket.readyState === 1) complete(snapshot);
  }
  function stop(event) { if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) finish(null); }
  function hidden() { if (document.hidden) finish(null); }
  document.addEventListener('click', stop, true); document.addEventListener('visibilitychange', hidden);
  attempts.set(key, finish);
  timer = setTimeout(function () { finish(null); }, Math.max(0, Math.min(5000, deadline - Date.now())));
  function inspect() {
    if (ended) return;
    if (getWs() !== socket || !store.get('connected') || store.get('myUserId') !== owner || store.get('currentSlug') !== slug) { finish(null); return; }
    var snapshot = splitViewScreenSnapshot(), serialized = JSON.stringify(snapshot);
    stable = previous === serialized ? stable + 1 : 1; previous = serialized;
    if (stable >= 2 && (!ready || ready(snapshot))) finish(snapshot); else animation = requestAnimationFrame(inspect);
  }
  animation = requestAnimationFrame(inspect);
}
export function handleSplitViewProbe(msg) {
  if (msg.type !== 'clay_view_probe') return false;
  var socket = getWs();
  if (!socket || socket.readyState !== 1 || store.get('paneMode')) return true;
  stableObservation(msg.probeId, socket, Date.now() + 4500, function (snapshot) {
    socket.send(JSON.stringify({ type: 'clay_view_observed', probeId: msg.probeId, snapshot: snapshot }));
  });
  return true;
}
export function applySplitViewNavigation(target) {
  if (JSON.stringify(splitViewScreenSnapshot()) !== JSON.stringify(target.expectedScreen)) return false;
  return applyReviewedSplitView(target);
}
function renderedTarget(snapshot, target) {
  var exact = snapshot && !snapshot.hidden && snapshot.viewId === target.view.id && snapshot.revision === target.view.revision &&
    snapshot.focusOrigin === target.focusOrigin && (snapshot.expandedPaneId || null) === (target.view.workspace && target.view.workspace.presentation && target.view.workspace.presentation.expandedPaneId || null) && JSON.stringify(snapshot.tree) === JSON.stringify(target.view.tree);
  var expected = target.view.sessions.filter(function (session) { return snapshot && !snapshot.expandedPaneId && (!target.focusOrigin || session.sessionOriginId === target.focusOrigin); });
  var shown = snapshot ? snapshot.panes.filter(function (pane) { return pane.visible; }) : [];
  return !!(exact && toolPaneRendering(snapshot, target.view) && shown.length === expected.length && expected.every(function (session) { return shown.some(function (pane) { return pane.origin === session.sessionOriginId && pane.sessionId === session.id && pane.ready && !pane.cached; }); }));
}
export function observeSplitViewRendering(msg, socket) {
  var target = msg.target;
  stableObservation(msg.deliveryId, socket, msg.renderDeadline, function (snapshot) {
    socket.send(JSON.stringify({ type: 'clay_navigation_rendered', deliveryId: msg.deliveryId, renderToken: msg.renderToken,
      surface: 'split_view', visible: renderedTarget(snapshot, target), snapshot: snapshot || splitViewScreenSnapshot() }));
  }, function (snapshot) { return renderedTarget(snapshot, target); });
}
