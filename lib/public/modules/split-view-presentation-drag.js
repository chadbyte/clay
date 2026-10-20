// Pointer drag controller for presentation views. Captured gestures are
// source-bound by pointerId and always recompute the release target.
import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { showToast } from './utils.js';

var host = null;
var commitDrop = null;

function viewForOrigin(origin) {
  var views = store.get('projectSplitViews') || [];
  for (var i = 0; i < views.length; i++) if (views[i].sessions.some(function (session) { return session.sessionOriginId === origin; })) return views[i];
  return null;
}

function sessionById(id) {
  var sessions = getCachedSessions() || [];
  for (var i = 0; i < sessions.length; i++) if (sessions[i].id === id) return sessions[i];
  return null;
}

function validSession(session) {
  return !!session && !!session.sessionOriginId && session.sessionRole !== "worker" && session.isMate !== true && session.isTui !== true &&
    !!store.get('currentSlug') && store.get('sessionListProjectSlug') === store.get('currentSlug');
}

function legacyMember(session) { return !!session && session.sessionRole === "worker"; }

function onPointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || store.get('projectSplitViewDrag')) return;
  if (!event.target || !event.target.closest) return;
  var paneHeader = event.target.closest(".split-pane-header");
  var row = event.target.closest(".session-item[data-session-id], .session-loop-child[data-session-id]");
  if (!paneHeader && !row) return;
  var button = event.target.closest("button");
  if ((paneHeader && button) || (button && button !== row) || event.target.closest("a, input, textarea, select, [contenteditable='true'], .workbench, .split-view-menu, .split-view-arrange, .session-row-actions, .session-close-btn, .session-more-btn")) return;
  var pane = paneHeader && paneHeader.closest('.split-pane');
  var id = pane ? Number(pane.dataset.sessionId) : row ? Number(row.dataset.sessionId) : 0;
  var source = sessionById(id);
  if (!validSession(source) || legacyMember(source)) return;
  var group = row && row.closest('.split-view-group[data-split-view-id]');
  var view = viewForOrigin(source.sessionOriginId);
  store.set({ projectSplitViewDrag: { pointerId: event.pointerId, sessionId: source.id, origin: source.sessionOriginId,
    sourceViewId: group ? group.dataset.splitViewId : view && view.id || null, sourceElement: row || paneHeader, startX: event.clientX, startY: event.clientY,
    moved: false, target: null, pointerType: event.pointerType, frames: [] } });
}

function targetAt(x, y) {
  var element = document.elementFromPoint(x, y);
  if (!element || !element.closest || element.closest(".workbench, .split-view-menu, .split-view-arrange, [role='dialog'], .session-folder-view-menu, .session-context-menu, .session-folder-menu")) return null;
  var sidebar = sidebarTargetAt(element);
  if (sidebar) return sidebar;
  var pane = element.closest('.split-pane');
  if (!pane || !host.contains(pane) || !pane.isConnected) return null;
  return paneTargetAt(pane, x, y);
}

function sidebarTargetAt(element) {
  if (element.closest(".session-row-actions, .session-close-btn, .session-more-btn, .split-view-group-more, a, input, textarea")) return null;
  var row = element.closest('.session-item[data-session-id], .session-loop-child[data-session-id]');
  var heading = element.closest('.split-view-group-heading');
  var group = (row || heading) && element.closest('.split-view-group[data-split-view-id]');
  var view = group && (store.get('projectSplitViews') || []).find(function (item) { return item.id === group.dataset.splitViewId; });
  var session = row ? sessionById(Number(row.dataset.sessionId)) : view && view.sessions.length ? sessionById(view.sessions[view.sessions.length - 1].id) : null;
  if (!validSession(session) || (group && (!view || !view.sessions.some(function (ref) { return ref.id === session.id && ref.sessionOriginId === session.sessionOriginId; })))) return null;
  var membership = viewForOrigin(session.sessionOriginId);
  if (group && (!membership || membership.id !== view.id)) return null;
  var targetElement = heading || row, bounds = targetElement.getBoundingClientRect();
  if (!targetElement.isConnected || !bounds.width || !bounds.height) return null;
  return { sessionId: session.id, origin: session.sessionOriginId, viewId: membership && membership.id || null,
    side: 'right', sidebar: true, element: targetElement,
    rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } };
}

function paneTargetAt(pane, x, y) {
  var id = Number(pane.dataset.sessionId), session = sessionById(id), frame = pane.querySelector('.split-pane-frame');
  if (!validSession(session) || legacyMember(session) || !frame || frame.dataset.projectSlug !== store.get('currentSlug') ||
      frame.dataset.sessionId !== String(id) || frame.dataset.sessionOriginId !== session.sessionOriginId) return null;
  var bounds = pane.getBoundingClientRect(), dx = (x - bounds.left) / Math.max(1, bounds.width), dy = (y - bounds.top) / Math.max(1, bounds.height);
  var edge = Math.min(dx, 1 - dx, dy, 1 - dy), side = "center";
  if (edge < 0.25) side = edge === dx ? "left" : edge === 1 - dx ? "right" : edge === dy ? "top" : "bottom";
  var view = viewForOrigin(session.sessionOriginId);
  return { sessionId: id, origin: session.sessionOriginId, viewId: view && view.id || null, side: side,
    rect: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } };
}

function fallbackTargetAt(x, y) {
  var element = document.elementFromPoint(x, y), app = document.getElementById("app");
  if (!element || !app || element.closest(".workbench, .split-view-menu, .split-view-arrange, [role='dialog'], .session-context-menu, .session-folder-menu")) return null;
  var inApp = app.contains(element), inHost = host && host.contains(element);
  if (!inApp && !inHost) return null;
  if (store.get('projectSplitViewActiveId') && host && host.contains(element)) {
    var panes = Array.from(host.querySelectorAll(':scope > .split-pane')), nearest = null, nearestDistance = Infinity;
    panes.forEach(function (pane) {
      if (pane.hidden) return;
      var rect = pane.getBoundingClientRect(), dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      var dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      var distance = dx * dx + dy * dy;
      if (distance < nearestDistance) { nearest = pane; nearestDistance = distance; }
    });
    if (nearest) return paneTargetAt(nearest, x, y);
  }
  if (!inApp) return null;
  var active = sessionById(Number(store.get('activeSessionId')));
  if (!validSession(active) || legacyMember(active) || viewForOrigin(active.sessionOriginId)) return null;
  var rect = app.getBoundingClientRect(), dx = (x - rect.left) / Math.max(1, rect.width), dy = (y - rect.top) / Math.max(1, rect.height);
  var side = dx < 0.25 ? "left" : dx > 0.75 ? "right" : dy < 0.25 ? "top" : dy > 0.75 ? "bottom" : "center";
  return { sessionId: active.id, origin: active.sessionOriginId, viewId: null, side: side,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
}

function resolveTarget(x, y) { return targetAt(x, y) || fallbackTargetAt(x, y); }

function onPointerMove(event) {
  var drag = store.get('projectSplitViewDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    try { document.documentElement.setPointerCapture(event.pointerId); } catch (error) {}
    drag.frames = Array.from(host.querySelectorAll('.split-pane-frame')).map(function (frame) { return { frame: frame, pointerEvents: frame.style.pointerEvents }; });
    drag.frames.forEach(function (entry) { entry.frame.style.pointerEvents = "none"; });
    document.body.classList.add("dragging", "is-dragging");
  }
  drag.target = resolveTarget(event.clientX, event.clientY);
  store.set({ projectSplitViewDrag: drag }); renderPreview(drag, event.clientX, event.clientY);
  event.preventDefault();
}

function renderPreview(drag, x, y) {
  clearSidebarPreview();
  var preview = host.querySelector(':scope > .split-view-drop-preview'), ghost = document.getElementById("split-view-drag-ghost");
  if (!ghost) { ghost = document.createElement("div"); ghost.id = "split-view-drag-ghost"; ghost.className = "split-view-drag-ghost"; ghost.hidden = true; document.body.appendChild(ghost); }
  if (!preview) {
    preview = document.createElement("div"); preview.className = "split-view-drop-preview"; preview.hidden = true;
    var label = document.createElement("span"); label.className = "drop-label"; preview.appendChild(label); host.appendChild(preview);
  }
  ghost.hidden = !drag.moved;
  if (!drag.moved) return;
  var sessions = getCachedSessions() || [], source = sessionById(drag.sessionId);
  ghost.textContent = source && source.title || "Session"; ghost.style.left = (x + 12) + "px"; ghost.style.top = (y + 12) + "px";
  var target = drag.target;
  if (!preview || !target) { if (preview) preview.hidden = true; return; }
  if (target.sidebar) {
    preview.hidden = true;
    var sameView = target.viewId && target.viewId === drag.sourceViewId;
    var view = viewForOrigin(target.origin), blocked = !sameView && view && view.sessions.length >= 8;
    target.element.dataset.splitViewDrop = blocked ? 'blocked' : 'ready';
    ghost.textContent += ' · ' + (blocked ? 'Eight sessions already open' : sameView || drag.origin === target.origin ? 'Already in this view' : view ? 'Add to Split view' : 'Create Split view');
    return;
  }
  if (!host.classList.contains("visible")) {
    if (!drag.previewHostState) {
      var app = document.getElementById("app"), appRect = app.getBoundingClientRect();
      drag.previewHostState = { background: host.style.background, pointerEvents: host.style.pointerEvents, position: host.style.position,
        left: host.style.left, top: host.style.top, width: host.style.width, height: host.style.height, zIndex: host.style.zIndex,
        panes: Array.from(host.querySelectorAll(':scope > .split-pane')).map(function (pane) { return { pane: pane, display: pane.style.display }; }) };
      host.classList.add("split-view-preview-only"); host.dataset.previewOnly = "true";
      host.style.position = "fixed"; host.style.left = appRect.left + "px"; host.style.top = appRect.top + "px";
      host.style.width = appRect.width + "px"; host.style.height = appRect.height + "px"; host.style.zIndex = "49";
      drag.previewHostState.panes.forEach(function (entry) { entry.pane.style.display = "none"; });
    }
    host.classList.add("split-view-canvas", "visible"); host.dataset.positioned = "true";
    host.style.background = "transparent"; host.style.pointerEvents = "none";
  }
  var sourceView = viewForOrigin(drag.origin), targetView = viewForOrigin(target.origin), blocked = drag.origin === target.origin && target.side !== "center";
  if (targetView && targetView.sessions.length >= 8 && !(sourceView && sourceView.id === targetView.id)) blocked = true;
  var box = Object.assign({}, target.rect);
  if (target.side === "left") box.width /= 2;
  else if (target.side === "right") { box.left += box.width / 2; box.width /= 2; }
  else if (target.side === "top") box.height /= 2;
  else if (target.side === "bottom") { box.top += box.height / 2; box.height /= 2; }
  else if (drag.origin !== target.origin) { box.left += box.width / 2; box.width /= 2; }
  var hostRect = host.getBoundingClientRect();
  preview.style.left = (box.left - hostRect.left) + "px"; preview.style.top = (box.top - hostRect.top) + "px";
  preview.style.width = box.width + "px"; preview.style.height = box.height + "px";
  preview.dataset.blocked = blocked ? "true" : "false"; preview.hidden = false;
  var label = preview.querySelector(".drop-label");
  if (label) label.textContent = blocked ? "Eight sessions already open" : drag.origin === target.origin ? "Keep this pane" :
    target.side === "center" ? (sourceView && targetView && sourceView.id === targetView.id ? "Swap panes" : "Split right") : "Split " + target.side;
}

function clearSidebarPreview() {
  document.querySelectorAll('[data-split-view-drop]').forEach(function (element) { delete element.dataset.splitViewDrop; });
}

export function restorePresentationDrag(drag) {
  if (!drag) return;
  clearSidebarPreview();
  drag.frames.forEach(function (entry) { if (entry.frame.isConnected) entry.frame.style.pointerEvents = entry.pointerEvents; });
  var preview = host.querySelector(':scope > .split-view-drop-preview'); if (preview) preview.hidden = true;
  var ghost = document.getElementById("split-view-drag-ghost"); if (ghost) ghost.hidden = true;
  document.body.classList.remove("dragging", "is-dragging");
  if (drag.previewHostState && !store.get('projectSplitViewActiveId')) {
    host.classList.remove("visible", "split-view-canvas", "split-view-preview-only"); delete host.dataset.positioned; delete host.dataset.previewOnly;
    host.style.background = drag.previewHostState.background; host.style.pointerEvents = drag.previewHostState.pointerEvents;
    host.style.position = drag.previewHostState.position; host.style.left = drag.previewHostState.left; host.style.top = drag.previewHostState.top;
    host.style.width = drag.previewHostState.width; host.style.height = drag.previewHostState.height; host.style.zIndex = drag.previewHostState.zIndex;
    drag.previewHostState.panes.forEach(function (entry) { if (entry.pane.isConnected) entry.pane.style.display = entry.display; });
  }
}

function cleanup(release, suppressClick) {
  var drag = store.get('projectSplitViewDrag');
  if (!drag) return;
  restorePresentationDrag(drag);
  if (suppressClick && drag.moved) {
    var token = { pointerId: drag.pointerId, sourceElement: drag.sourceElement, sourceSessionId: drag.sessionId,
      targetOrigin: drag.target && drag.target.origin, until: Date.now() + 250 };
    store.set({ projectSplitViewSuppressClick: token });
    setTimeout(function () { if (store.get('projectSplitViewSuppressClick') === token) store.set({ projectSplitViewSuppressClick: null }); }, 500);
  }
  if (release) try { if (document.documentElement.hasPointerCapture(drag.pointerId)) document.documentElement.releasePointerCapture(drag.pointerId); } catch (error) {}
  store.set({ projectSplitViewDrag: null });
}

function onPointerUp(event) {
  var drag = store.get('projectSplitViewDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved) { cleanup(true, false); return; }
  var target = resolveTarget(event.clientX, event.clientY);
  drag.target = target;
  if (target && target.viewId && target.viewId !== drag.sourceViewId &&
      (store.get('projectSplitViews') || []).some(function (view) { return view.id === target.viewId && view.sessions.length >= 8; })) {
    cleanup(true, true); showToast("Eight sessions are already open. Close a pane to add another.", "warn"); return;
  }
  cleanup(true, true);
  if (target && drag.origin !== target.origin && commitDrop) commitDrop(drag, target);
}

function onPointerCancel(event) {
  var drag = store.get('projectSplitViewDrag');
  if (drag && drag.pointerId === event.pointerId) cleanup(false, true);
}

function onKeyDown(event) { if (event.key === "Escape" && store.get('projectSplitViewDrag')) { event.preventDefault(); cleanup(true, true); } }
function onWindowBlur() { cleanup(false, true); }
function onNativeDragStart(event) {
  if (!store.get('projectSplitViewDrag')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function initPresentationDrag(hostElement, onDrop) {
  host = hostElement; commitDrop = onDrop;
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("lostpointercapture", onPointerCancel, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("dragstart", onNativeDragStart, true);
  window.addEventListener("blur", onWindowBlur);
}
