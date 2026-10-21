import { workspaceChanged } from './view-workspace-state.js';
import { restoreViewPair } from './view-pair-presentation.js';
import { repaintLegacySplit } from './split-view.js';
import { validWorkspaceView } from './view-workspace-validation.js';
import { mutation } from './view-mutations.js';
import { initSavedWorkspace } from './view-workspace-controller.js';
import { preserveReconnectingPresentation } from './split-pane-retention.js';
import { layoutScope, currentLayoutScope, presentationTree } from './split-view-layout-scope.js';
import { validPresentationClose } from './split-view-presentation-close.js';
import { applyPresentationDrop } from './split-view-presentation-drop.js';
import { closeSessionContextMenu } from './session-context-menu.js';
import { openSplitViewMenu, closeSplitViewMenu as closeGroupMenus } from './split-view-sidebar-menu.js';
import { store } from './store.js';
import { organizeViewAction } from './split-view-organization.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { renderPresentationView, initPresentationRenderer, hidePresentationView, closePresentationArrange } from './split-view-presentation-renderer.js';
import { initPresentationDrag, restorePresentationDrag } from './split-view-presentation-drag.js';
import { detachTuiView } from './session-tui-view.js';
import { checkComposerDeparture } from './session-rich-drafts.js';
import { showToast } from './utils.js';
import { preset, listIds, validateTree, remove, arrangeRegion } from './split-view-layout-client.js';
import { viewIdForOrigin, updateActiveSession, exactDriverForOrigin, restorablePresentation } from './split-view-presentation-lookup.js';
import { groupedSessionIds } from './split-group-helpers.js';
import { handleSplitViewCreateEvent } from './split-view-create-action.js';
import { initSplitViewCreateMenu } from './split-view-create-menu.js';
import { currentSingletonPresentation } from './split-view-singleton.js';
var host = null;
var nativeApp = null;
var mainPanels = null;
var stickyContainer = null;
var stickyHome = null;
var stickyAnchor = null;function contextKey(state) {
  return [state.currentSlug || "", state.currentProjectOwnerId || "", state.myUserId || "", state.projectSplitViewSocketGeneration || 0].join("|");
}
function projectReady(state) {
  return getWs() !== state.splitIdentityBlockedSocket && !state.paneMode && !state.dmMode && state.currentSlug && state.activeProjectSlug === state.currentSlug &&
    state.sessionListProjectSlug === state.currentSlug && state.authIdentityLoaded && state.connected;
}
function resetForContext() {
  var state = store.snap();
  var key = contextKey(state);
  if (state.projectSplitViewContextKey === key) return false;
  var uncertain = state.projectSplitViewPending ? "Connection or project changed during a Split view change. Refreshing saved state before another change." : "";
  cleanupTransientInteractions(state);
  store.set({ projectSplitViews: [], projectSplitViewRevision: 0, projectSplitViewContextKey: key,
    projectSplitViewHydrated: false, projectSplitViewPending: null, projectSplitViewError: uncertain,
    projectSplitViewActiveId: null, projectSplitViewFocusedOrigin: null, projectSplitViewPreviewTree: null, projectSplitViewStandaloneTarget: null,
    projectSplitViewDrag: null, projectSplitViewDividerDrag: null, projectSplitViewRequestSocket: null,
    projectSplitViewRequestGeneration: null, projectSplitViewRequestOwnerId: null, projectSplitViewRequestSlug: null });
  return true;
}
function cleanupTransientInteractions(state) {
  var drag = state.projectSplitViewDrag, divider = state.projectSplitViewDividerDrag;
  if (drag) restorePresentationDrag(drag);
  if (divider && divider.frames) divider.frames.forEach(function (item) { if (item.frame.isConnected) item.frame.style.pointerEvents = item.pointerEvents; });
  if (drag || divider) {
    document.body.classList.remove("split-view-resizing");
    var pointerId = drag ? drag.pointerId : divider.pointerId;
    try { if (document.documentElement.hasPointerCapture(pointerId)) document.documentElement.releasePointerCapture(pointerId); } catch (error) {}
  }
}
function sendMessage(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1 || !projectReady(store.snap())) return false;
  try { ws.send(JSON.stringify(message)); return true; } catch (error) { return false; }
}
export function requestProjectSplitViews() {
  var state = store.snap();
  if (!projectReady(state)) return false;
  resetForContext();
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  store.set({ projectSplitViewRequestSocket: ws, projectSplitViewRequestGeneration: state.projectSplitViewSocketGeneration,
    projectSplitViewRequestOwnerId: state.myUserId || null, projectSplitViewRequestSlug: state.currentSlug });
  try { ws.send(JSON.stringify({ type: "project_split_views_request" })); return true; } catch (error) { return false; }
}
function exactProjectMessage(msg) {
  var state = store.snap();
  return !!msg && msg.projectSlug === state.currentSlug && projectReady(state) &&
    state.projectSplitViewRequestSlug === state.currentSlug && state.projectSplitViewRequestGeneration === state.projectSplitViewSocketGeneration &&
    state.projectSplitViewRequestOwnerId === (state.myUserId || null) && state.projectSplitViewRequestSocket === getWs();
}
function viewExists(views, id) {
  for (var i = 0; i < (views || []).length; i++) if (views[i].id === id) return views[i];
  return null;
}
function viewSessions(view) {
  if (!view || !Array.isArray(view.sessions)) return [];
  var sessions = getCachedSessions() || [], mapped = [];
  for (var i = 0; i < view.sessions.length; i++) {
    var ref = view.sessions[i];
    var session = ref && exactDriverForOrigin(ref.sessionOriginId, sessions);
    if (!session || session.id !== ref.id || !session.sessionOriginId) return [];
    mapped.push(session);
  }
  return mapped;
}
export function handleProjectSplitViews(msg) {
  if (!exactProjectMessage(msg)) return false;
  if (!Number.isInteger(msg.revision) || msg.revision < 0 || !Array.isArray(msg.views)) return true;
  var state = store.snap();
  if (state.projectSplitViewHydrated && msg.revision < state.projectSplitViewRevision) return true;
  var nextViews = [];
  var invalidView = false;
  msg.views.forEach(function (view) {
    var ids = view && Array.isArray(view.sessions) ? view.sessions.map(function (session) { return session.sessionOriginId; }) : [];
    if (ids.length > 8 || viewSessions(view).length !== ids.length || !validateTree(view.tree, ids).ok || !validWorkspaceView(view)) invalidView = true;
    else nextViews.push(view);
  });
  if (invalidView) {
    store.set({ projectSplitViews: [], projectSplitViewHydrated: false, projectSplitViewError: "Saved Split view references are unavailable. Refresh the session list before changing layouts.",
      projectSplitViewPending: null, projectSplitViewPreviewTree: null, projectSplitViewActiveId: null });
    renderActive();
    return true;
  }
  // A repeated read must not cancel a captured gesture in an unchanged view.
  if (state.projectSplitViewHydrated && !state.projectSplitViewPending && !msg.error && !state.projectSplitViewError &&
      msg.revision === state.projectSplitViewRevision && JSON.stringify(nextViews) === JSON.stringify(state.projectSplitViews)) return true;
  var pending = state.projectSplitViewPending;
  if (state.projectSplitViewDrag || state.projectSplitViewDividerDrag) cleanupTransientInteractions(state);
  var activeId = state.projectSplitViewActiveId;
  if (!viewExists(nextViews, activeId)) {
    var restored = nextViews.find(function (view) { return view.id === msg.activeViewId && !view.sessions.length; }) || restorablePresentation(state, nextViews, getCachedSessions());
    if (restored) activeId = restored.id;
  }
  var removedActive = activeId && !viewExists(nextViews, activeId) ? activeId : null;
  var completedPending = pending && pending.awaitingBroadcast && msg.revision >= pending.resultRevision ? pending : null;
  var readyPending = completedPending ? null : pending;
  var standaloneTarget = state.projectSplitViewStandaloneTarget || null;
  if (removedActive && completedPending && completedPending.meta && completedPending.meta.separateViewId === removedActive) {
    var survivor = exactDriverForOrigin(completedPending.meta.activeOrigin, getCachedSessions());
    if (survivor) standaloneTarget = { id: survivor.id, origin: survivor.sessionOriginId, previousSessionId: state.activeSessionId, contextKey: contextKey(state) };
  }
  store.set({ projectSplitViews: nextViews, projectSplitViewRevision: msg.revision, projectSplitViewSavedActiveId: msg.activeViewId || null, projectSplitViewHydrated: true,
    projectSplitViewError: msg.error || "", projectSplitViewStandaloneTarget: standaloneTarget, projectSplitViewActiveId: viewExists(nextViews, activeId) ? activeId : null,
    projectSplitViewFocusedOrigin: viewExists(nextViews, activeId) ? state.projectSplitViewFocusedOrigin : null,
    projectSplitViewPending: readyPending, projectSplitViewPreviewTree: readyPending ? state.projectSplitViewPreviewTree : null,
    projectSplitViewDrag: null });
  if (removedActive && completedPending && completedPending.meta && completedPending.meta.separateViewId === removedActive) {
    var target = exactDriverForOrigin(completedPending.meta.activeOrigin, getCachedSessions());
    if (target) switchToStandalone(target.id);
  }
  if (completedPending && completedPending.meta && completedPending.meta.activateCreatedView && completedPending.meta.createdViewId &&
      viewExists(nextViews, completedPending.meta.createdViewId)) setActiveView(completedPending.meta.createdViewId);
  if (completedPending && completedPending.meta && completedPending.meta.closedOrigin) {
    var meta = completedPending.meta;
    if (store.get('projectSplitViewFocusedOrigin') === meta.closedOrigin) store.set({ projectSplitViewFocusedOrigin: null });
    var selected = exactDriverForOrigin(meta.closedOrigin, getCachedSessions());
    var remaining = exactDriverForOrigin(meta.activeOrigin, getCachedSessions());
    if (selected && remaining && store.get('activeSessionId') === selected.id && !sendMessage({ type: "switch_session", id: remaining.id })) {
      showToast("Pane removed, but the remaining session could not be selected. Reconnect before continuing.", "error");
    }
  }
  renderActive();
  return true;
}
export function handleProjectSplitViewResult(msg) {
  var state = store.snap(), pending = state.projectSplitViewPending;
  if (!pending || !msg || msg.requestId !== pending.requestId ||
      pending.contextKey !== contextKey(state) || pending.socket !== getWs()) return false;
  if (!msg.ok) {
    store.set({ projectSplitViewPending: null, projectSplitViewPreviewTree: null,
      projectSplitViewError: msg.error || "Split view change was not saved" });
    showToast(msg.error || "Split view change was not saved", "error");
    if (msg.code === "conflict" || msg.code === "session" || msg.code === "identity" || msg.code === "folder") {
      store.set({ projectSplitViewHydrated: false });
      requestProjectSplitViews();
    }
    renderActive();
    return true;
  }
  if (!Number.isInteger(msg.revision) || msg.revision < pending.expectedRevision) {
    store.set({ projectSplitViewPending: null, projectSplitViewPreviewTree: null,
      projectSplitViewHydrated: false, projectSplitViewError: "Split view confirmation was incomplete. Refreshing saved state." });
    requestProjectSplitViews();
    renderActive();
    return true;
  }
  var nextMeta = pending.meta;
  if (nextMeta && nextMeta.activateCreatedView && msg.view && msg.view.id) nextMeta = Object.assign({}, nextMeta, { createdViewId: msg.view.id });
  store.set({ projectSplitViewPending: Object.assign({}, pending, { awaitingBroadcast: true, resultRevision: msg.revision, meta: nextMeta }),
    projectSplitViewError: "" });
  return true;
}
export function organizePresentationView(id, revision, folderId, favorite) {
  var view = viewExists(store.get('projectSplitViews'), id);
  if (!view || view.revision !== revision) return false;
  return mutation('project_split_view_organize', { id: id, expectedViewRevision: revision, projectSlug: store.get('currentSlug'), folderId: folderId, favorite: favorite });
}
export function setActiveView(id, preferredOrigin) {
  var state = store.snap(), view = viewExists(state.projectSplitViews, id);
  if (!view) return false;
  try {
    if (state.splitPanes || state.projectSplitViewActiveId) checkMountedPaneDrafts();
    else checkComposerDeparture();
  } catch (error) { showToast(error.message, "warn"); return false; }
  if (!state.splitPanes && !state.projectSplitViewActiveId) detachTuiView();
  var activeOrigin = preferredOrigin && view.sessions.some(function (session) { return session.sessionOriginId === preferredOrigin; }) ? preferredOrigin : view.activeSessionOriginId;
  var activeSession = viewSessions(view).filter(function (session) { return session.sessionOriginId === activeOrigin; })[0];
  if (activeSession && store.get('activeSessionId') !== activeSession.id) {
    store.set({ projectSplitViewSwitching: true });
    if (!sendMessage({ type: "switch_session", id: activeSession.id })) { store.set({ projectSplitViewSwitching: false }); return false; }
  }
  store.set({ projectSplitViewActiveId: id, projectSplitViewFocusedOrigin: null, projectSplitViewPreviewTree: null, splitPanes: null });
  renderActive();
  return true;
}
function checkMountedPaneDrafts() {
  if (!host) return;
  Array.from(host.querySelectorAll('.split-pane-frame')).forEach(function (frame) { if (frame.clayPane) frame.clayPane.checkDraft(); });
}
export function switchToStandalone(sessionId) {
  var state = store.snap();
  try {
    if (state.projectSplitViewActiveId || state.splitPanes) checkMountedPaneDrafts();
    else checkComposerDeparture();
  } catch (error) { showToast(error.message, "warn"); return false; }
  if (!sendMessage({ type: "switch_session", id: sessionId })) {
    showToast("Session switch could not be sent. The current Split view is still open.", "error");
    return false;
  }
  store.set({ projectSplitViewActiveId: null, projectSplitViewFocusedOrigin: null, projectSplitViewPreviewTree: null, projectSplitViewSwitching: false, splitPanes: null });
  renderActive();
  return true;
}
function renderActive() {
  if (store.get('splitPanes')) { repaintLegacySplit(); return; }
  if (!host || !nativeApp || preserveReconnectingPresentation(host)) return;
  var state = store.snap(), view = viewExists(state.projectSplitViews, state.projectSplitViewActiveId);
  if (state.splitIdentityBlockedSocket === getWs()) { hidePresentationView(); return; }
  if (!view) {
    var restored = state.projectSplitViewHydrated && restorablePresentation(state, state.projectSplitViews, getCachedSessions());
    if (restored) {
      store.set({ projectSplitViewActiveId: restored.id, projectSplitViewSingletonOrigin: null, projectSplitViewFocusedOrigin: null });
      return;
    }
    var singleton = currentSingletonPresentation(state, getCachedSessions());
    if (singleton) {
      if (state.projectSplitViewHydrated && !state.projectSplitViewPending && !state.projectSplitViewError) mutation("project_split_view_create", { name: "View", sessionOrigins: [singleton.origin], tree: { id: singleton.origin }, layout: "balanced", activeSessionOriginId: singleton.origin }, { activateCreatedView: true });
      return;
    }
    if (state.projectSplitViewHydrated && projectReady(state) && !(getCachedSessions() || []).length && !state.projectSplitViewPending && !state.projectSplitViewError) {
      mutation('project_split_view_create', { name: 'View', sessionOrigins: [], tree: null, layout: 'balanced', activeSessionOriginId: null }, { activateCreatedView: true });
      return;
    }
    if (state.projectSplitViewSingletonOrigin) store.set({ projectSplitViewSingletonOrigin: null });
    hidePresentationView();
    if (stickyContainer && stickyHome) stickyHome.insertBefore(stickyContainer, stickyAnchor && stickyAnchor.parentNode === stickyHome ? stickyAnchor : null);
    return;
  }
  if (state.projectSplitViewSingletonOrigin) store.set({ projectSplitViewSingletonOrigin: null });
  if (restoreViewPair(view)) return;
  var sessions = viewSessions(view);
  var tree = presentationTree(view);
  var ids = listIds(tree);
  if (sessions.length !== view.sessions.length || ids.length > 8 || !validateTree(tree, ids).ok) return;
  if (stickyContainer && mainPanels) mainPanels.appendChild(stickyContainer);
  renderPresentationView(view, tree, sessions);
}
function onClick(event) {
  var target = event.target;
  if (target.closest('.split-view-menu')) return;
  var suppressed = store.get('projectSplitViewSuppressClick');
  if (suppressed && Date.now() <= suppressed.until && event.pointerId === suppressed.pointerId) {
    var clickedRow = target.closest(".session-item[data-session-id], .session-loop-child[data-session-id]"), clickedPane = target.closest(".split-pane");
    var matchesSource = suppressed.sourceElement && (target === suppressed.sourceElement || suppressed.sourceElement.contains(target)) ||
      clickedRow && Number(clickedRow.dataset.sessionId) === suppressed.sourceSessionId ||
      clickedPane && clickedPane.querySelector('.split-pane-frame') && clickedPane.querySelector('.split-pane-frame').dataset.sessionOriginId === suppressed.targetOrigin;
    if (matchesSource) { event.preventDefault(); event.stopImmediatePropagation(); store.set({ projectSplitViewSuppressClick: null }); return; }
  }
  var menu = target.closest(".split-view-arrange"); if (menu) return;
  var splitGroup = target.closest(".split-view-group[data-split-view-id]");
  if (splitGroup) {
    var view = viewExists(store.get('projectSplitViews'), splitGroup.dataset.splitViewId); if (!view) return;
    var more = target.closest(".split-view-group-more");
    if (more) { event.preventDefault(); event.stopImmediatePropagation(); toggleGroupMenu(splitGroup, more); return; }
    var option = target.closest("[data-split-view-action]");
    if (option) { event.preventDefault(); event.stopImmediatePropagation(); runGroupAction(view, option.dataset.splitViewAction, splitGroup); return; }
    var child = target.closest(".session-item[data-session-id], .session-loop-child[data-session-id]");
    if (child && target.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
    var open = target.closest(".split-view-group-open");
    if (open || child) {
      event.preventDefault(); event.stopImmediatePropagation();
      var session = child && exactDriverForOrigin(child.dataset.controlSessionOrigin, getCachedSessions());
      if (child && !session) session = (getCachedSessions() || []).find(function (item) { return item.id === Number(child.dataset.sessionId); });
      if (!setActiveView(view.id, session && session.sessionOriginId)) return;
      if (session && session.sessionOriginId !== view.activeSessionOriginId) updateActiveSession(view, session.sessionOriginId, mutation);
      return;
    }
  }
  if (store.get('projectSplitViewActiveId') && target.closest('.split-group-item[data-split-group-id]')) {
    store.set({ projectSplitViewActiveId: null, projectSplitViewFocusedOrigin: null }); return;
  }
  var row = target.closest(".session-item[data-session-id], .session-loop-child[data-session-id]"); if (row && store.get('projectSplitViewActiveId')) {
    var session = (getCachedSessions() || []).find(function (item) { return item.id === Number(row.dataset.sessionId); });
    var membershipViewId = session && viewIdForOrigin(session.sessionOriginId); if (membershipViewId) {
      event.preventDefault(); event.stopImmediatePropagation(); var membershipView = viewExists(store.get('projectSplitViews'), membershipViewId);
      if (membershipView && setActiveView(membershipView.id, session.sessionOriginId) && session.sessionOriginId !== membershipView.activeSessionOriginId) updateActiveSession(membershipView, session.sessionOriginId, mutation);
      return;
    }
    if (session && (session.sessionRole === "worker" || groupedSessionIds(store.get('splitGroups') || []).has(session.id))) {
      store.set({ projectSplitViewActiveId: null, projectSplitViewFocusedOrigin: null });
      return;
    }
    if (session) { event.preventDefault(); event.stopImmediatePropagation(); switchToStandalone(session.id); }
  }
  if (!target.closest(".split-view-group-more")) {
    var groupFocusTarget = target.closest("button, a, input, textarea, select, [tabindex]:not([tabindex='-1'])");
    closeGroupMenus(!groupFocusTarget);
  }
  if (!menu) {
    var arrangeFocusTarget = target.closest("button, a, input, textarea, select, [tabindex]:not([tabindex='-1'])");
    closePresentationArrange(!arrangeFocusTarget);
  }
}
function onContextMenu(event) {
  var target = event.target;
  if (!target || !target.closest) return;
  var heading = target.closest('.split-view-group-heading'), group = heading && heading.closest('.split-view-group[data-split-view-id]');
  if (!group || target.closest('input, textarea, [contenteditable="true"]') ||
      !projectReady(store.snap()) || !viewExists(store.get('projectSplitViews'), group.dataset.splitViewId)) return;
  var anchor = group.querySelector('.split-view-group-more');
  if (!anchor) return;
  event.preventDefault(); event.stopImmediatePropagation();
  closeSessionContextMenu(false); closePresentationArrange(false);
  toggleGroupMenu(group, anchor, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);
}
function toggleGroupMenu(group, anchor, point) {
  openSplitViewMenu(group, anchor, point, runGroupAction);
}
function runGroupAction(view, action, root) {
  closeGroupMenus(false);
  if (action === 'favorite' || action === 'folder') { organizeViewAction(view, action); return; }
  if (action === "rename") { startRename(root, view); return; }
  if (action === "separate") {
    if (view.id === store.get('projectSplitViewActiveId')) {
      try { checkMountedPaneDrafts(); } catch (error) { showToast(error.message, "warn"); return; }
    }
    var selectedOrigin = view.activeSessionOriginId;
    mutation("project_split_view_separate", { id: view.id }, { separateViewId: view.id, activeOrigin: selectedOrigin });
  }
}
function startRename(root, view) {
  var name = root.querySelector('.split-view-group-name'), heading = root.querySelector('.split-view-group-heading');
  if (!name || !heading || root.querySelector('.split-view-group-name-input')) return;
  var input = document.createElement("input"); input.type = "text"; input.className = "split-view-group-name-input"; input.maxLength = 80;
  input.value = view.name; input.setAttribute("aria-label", "Rename Split view"); name.replaceWith(input); input.focus(); input.select();
  var finished = false;
  function restore(returnFocus) {
    if (finished) return;
    finished = true;
    if (!input.isConnected) return;
    var span = document.createElement("span"); span.className = "split-view-group-name"; span.textContent = view.name; input.replaceWith(span);
    if (returnFocus) { var trigger = root.querySelector('.split-view-group-open'); if (trigger) trigger.focus(); }
  }
  function showInlineError(message) {
    var error = root.querySelector('.split-view-group-error');
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.removeAttribute("aria-describedby");
  }
  input.addEventListener("click", function (event) { event.stopPropagation(); });
  var inlineError = root.querySelector('.split-view-group-error');
  if (inlineError) inlineError.hidden = true;
  input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { event.preventDefault(); restore(true); return; }
    if (event.key === "Enter") {
      event.preventDefault(); var next = input.value.trim();
      if (!next || next.length > 80) { showInlineError("Use a name from 1 to 80 characters."); return; }
      input.removeAttribute("aria-invalid");
      var currentError = root.querySelector('.split-view-group-error'); if (currentError) currentError.hidden = true;
      if (!mutation("project_split_view_rename", { id: view.id, name: next })) { showInlineError(store.get('projectSplitViewError') || "Rename could not be saved."); return; }
      restore();
    }
  });
  input.addEventListener("blur", restore);
}
function onKeyDown(event) {
  if (event.key === "Escape") closePresentationArrange();
}
function onArrangement(event) {
  var view = viewExists(store.get('projectSplitViews'), store.get('projectSplitViewActiveId'));
  if (!view || !event.detail) return;
  var source = view.sessions.find(function (session) { return session.sessionOriginId === event.detail.sessionOriginId; });
  if (!source || !exactDriverForOrigin(source.sessionOriginId, getCachedSessions())) return;
  var nextTree = null, nextLayout = view.layout;
  if (event.detail.preset) {
    nextLayout = event.detail.preset;
    var orderedIds = [source.sessionOriginId].concat(listIds(view.tree).filter(function (origin) { return origin !== source.sessionOriginId; }));
    nextTree = preset(orderedIds, nextLayout);
  }
  else if (event.detail.position) {
    var arranged = arrangeRegion(view.tree, source.sessionOriginId, event.detail.position);
    if (!arranged.ok) { showToast(arranged.reason === "quarter-requires-three" ? "Quarter layouts require at least three sessions." : "This arrangement is unavailable.", "warn"); return; }
    nextTree = arranged.tree;
  }
  if (!nextTree || !validateTree(nextTree, view.sessions.map(function (session) { return session.sessionOriginId; })).ok) return;
  store.set({ projectSplitViewPreviewTree: nextTree, projectSplitViewPreviewScope: layoutScope(view), projectSplitViewFocusedOrigin: null }); renderActive();
  if (!mutation("project_split_view_update", { id: view.id, sessionOrigins: listIds(nextTree), tree: nextTree,
    layout: nextLayout, activeSessionOriginId: source.sessionOriginId })) {
    store.set({ projectSplitViewPreviewTree: null }); renderActive();
  }
}
function onResize(event) {
  if (!event.detail || !currentLayoutScope(event.detail.scope) || event.detail.viewId !== event.detail.scope.viewId) return;
  var view = viewExists(store.get('projectSplitViews'), event.detail.viewId);
  if (!view) return;
  if (store.get('projectSplitViewPending') || !mutation("project_split_view_update", { id: view.id, sessionOrigins: event.detail.ids, tree: event.detail.tree,
    layout: view.layout, activeSessionOriginId: view.activeSessionOriginId })) { store.set({ projectSplitViewPreviewTree: null }); renderActive(); }
}
function onClosePane(event) {
  var view = viewExists(store.get('projectSplitViews'), store.get('projectSplitViewActiveId'));
  if (!view || !event.detail || !validPresentationClose(event.detail)) return;
  var session = (getCachedSessions() || []).find(function (item) { return item.id === Number(event.detail.sessionId); });
  if (!session || !view.sessions.some(function (item) { return item.sessionOriginId === session.sessionOriginId; })) return;
  try { checkMountedPaneDrafts(); } catch (error) { showToast(error.message, "warn"); return; }
  var origins = view.sessions.map(function (item) { return item.sessionOriginId; }).filter(function (origin) { return origin !== session.sessionOriginId; });
  var nextTree = remove(view.tree, session.sessionOriginId);
  if (!validateTree(nextTree, origins).ok) return;
  var nextActive = view.activeSessionOriginId === session.sessionOriginId ? origins[0] || null : view.activeSessionOriginId;
  mutation("project_split_view_update", { id: view.id, sessionOrigins: origins, tree: nextTree,
    layout: view.layout, activeSessionOriginId: nextActive }, { closedOrigin: session.sessionOriginId, activeOrigin: nextActive });
}
function onFocus(event) {
  var view = viewExists(store.get('projectSplitViews'), store.get('projectSplitViewActiveId'));
  if (!view) return;
  var source = event.detail && view.sessions.find(function (session) { return session.sessionOriginId === event.detail.sessionOriginId; });
  if (event.detail && event.detail.focused && !source) return;
  store.set({ projectSplitViewFocusedOrigin: event.detail && event.detail.focused ? source.sessionOriginId : null });
  renderActive();
  if (!store.get('savedWorkspaceApplying')) workspaceChanged();
}
function init(hostElement) {
  host = hostElement; nativeApp = document.getElementById("app"); mainPanels = document.getElementById("main-panels");
  stickyContainer = document.getElementById("sticky-notes-container");
  if (stickyContainer) { stickyHome = stickyContainer.parentNode; stickyAnchor = stickyContainer.nextSibling; }
  initPresentationRenderer(host);
  initSavedWorkspace();
  initPresentationDrag(host, function (drag, target) { return applyPresentationDrop(drag, target, mutation, checkMountedPaneDrafts); });
  initSplitViewCreateMenu();
  document.addEventListener('clay-split-view-create', function (event) { handleSplitViewCreateEvent(event, mutation, checkMountedPaneDrafts); });
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  document.addEventListener("clay-split-view-arrange", onArrangement);
  document.addEventListener("clay-split-view-resize", onResize);
  document.addEventListener("clay-split-view-focus", onFocus);
  document.addEventListener("clay-split-view-close-pane", onClosePane);
  document.addEventListener("keydown", onKeyDown, true);
  store.subscribe(function (state, previous) {
    if ((previous.projectSplitViewDrag && !state.projectSplitViewDrag) ||
        (previous.projectSplitViewDividerDrag && !state.projectSplitViewDividerDrag)) cleanupTransientInteractions(previous);
    if (state.projectSplitViewStandaloneTarget && state.activeSessionId !== previous.activeSessionId) store.set({ projectSplitViewStandaloneTarget: null });
    var contextChanged = resetForContext();
    if (previous.connected && !state.connected) {
      var pending = state.projectSplitViewPending;
      store.set({ projectSplitViews: [], projectSplitViewRevision: 0, projectSplitViewHydrated: false,
        projectSplitViewPending: null, projectSplitViewError: pending ? "Connection changed during a Split view change. Saved state will be refreshed after reconnect." : "",
        projectSplitViewActiveId: null, projectSplitViewFocusedOrigin: null, projectSplitViewPreviewTree: null, projectSplitViewRequestSocket: null });
    }
    var becameReady = projectReady(state) && (!projectReady(previous) || contextChanged);
    if (becameReady) requestProjectSplitViews();
    if (state.projectSplitViews !== previous.projectSplitViews || state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.activeSessionId !== previous.activeSessionId || state.sessionOriginId !== previous.sessionOriginId || state.splitPanes !== previous.splitPanes ||
        state.projectSplitViewPreviewTree !== previous.projectSplitViewPreviewTree || state.currentSlug !== previous.currentSlug ||
        state.paneBindingSessions !== previous.paneBindingSessions || state.sessionActivatedProjectSlug !== previous.sessionActivatedProjectSlug) renderActive();
    if (state.activeSessionId !== previous.activeSessionId && state.projectSplitViewActiveId) {
      var activeView = viewExists(state.projectSplitViews, state.projectSplitViewActiveId);
      if (activeView && activeView.sessions.length && !activeView.sessions.some(function (session) { return session.id === state.activeSessionId; })) {
        store.set({ projectSplitViewActiveId: null, projectSplitViewPreviewTree: null });
      }
    }
  });
  var changed = resetForContext();
  if (changed && projectReady(store.snap())) requestProjectSplitViews();
}
export function initSplitViewPresentations(hostElement) { init(hostElement); }
export function renderPresentationSplitView() { renderActive(); }
export function presentationViewForSidebar(viewId) { return viewExists(store.get('projectSplitViews'), viewId); }

// Canonical navigation uses the same draft guard and view renderer as human entry.
export function applyReviewedSplitView(target) {
  var view = viewExists(store.get('projectSplitViews'), target.view.id);
  if (!projectReady(store.snap()) || store.get('projectSplitViewPending') || !view || JSON.stringify(view) !== JSON.stringify(target.view)) return false;
  if (!setActiveView(view.id, view.activeSessionOriginId)) return false;
  store.set({ savedWorkspaceApplying: true });
  try { onFocus({ detail: { focused: !!target.focusOrigin, sessionOriginId: target.focusOrigin } }); } finally { store.set({ savedWorkspaceApplying: false }); }
  return true;
}
