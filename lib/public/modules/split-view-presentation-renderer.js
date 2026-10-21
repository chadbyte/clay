import { paintLegacyToolPanes, clearToolPaneWindows } from './tool-pane-legacy.js';
import { toolPaneLayoutTree, paintToolPaneWindows, bindWorkspaceDivider, dockedToolPanes } from './tool-pane-layout.js';
import { afterPaneMotion } from './split-view-drag-preview.js';
import { layoutScope, currentLayoutScope, presentationTree, bindingMatches } from './split-view-layout-scope.js';
// Flat, stable pane presentation for persisted binary trees. Geometry is
// applied to existing direct-child .split-pane nodes; iframes are never moved
// below a nested layout wrapper.
import { paneRetention, clearRetainedPanes, releaseRetainedPanes } from './split-pane-retention.js';
import { store } from './store.js';
import { currentSingletonPresentation } from './split-view-singleton.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { livePaneBinding } from './pane-binding.js';
import { bindPresentationClose } from './split-view-presentation-close.js';
import { splitPaneForSession, reconcileSplitPanes } from './split-pane-reconciler.js';
import { createSplitPane, updateSplitPaneMetadata, updateSplitPaneCloseVisibility } from './split-pane-renderer.js';
import { syncPaneHeaderState } from './split-pane-header-state.js';
import { rectangles, resize, validateTree, listIds } from './split-view-layout-client.js';
import { iconHtml, refreshIcons } from './icons.js';
import { appendLayoutOption } from './split-view-layout-icons.js';
import { reserveEmptySplit, clearEmptySplit } from './split-session-empty-pane.js';

var host = null;
var app = null;
var menuTrigger = null;
var resizeObserver = null;
var geometryToken = 0;
var stickyStatusOrigins = null;
function relocateStickyStatus(enabled) {
  var ids = ['todo-sticky', 'ralph-sticky', 'debate-sticky'];
  var main = document.getElementById('main-panels'), appElement = document.getElementById('app');
  if (!main || !appElement) return;
  if (enabled) {
    if (!stickyStatusOrigins) stickyStatusOrigins = ids.map(function (id) {
      var element = document.getElementById(id);
      return { element: element, parent: element && element.parentNode, next: element && element.nextSibling };
    });
    stickyStatusOrigins.forEach(function (entry) { if (entry.element && entry.element.parentNode !== main) main.insertBefore(entry.element, appElement); });
  } else if (stickyStatusOrigins) {
    stickyStatusOrigins.forEach(function (entry) {
      if (entry.element && entry.parent && entry.element.parentNode !== entry.parent) {
        if (entry.next && entry.next.parentNode === entry.parent) entry.parent.insertBefore(entry.element, entry.next);
        else entry.parent.appendChild(entry.element);
      }
    });
  }
}
function dispatch(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail: detail }));
}

export function initPresentationRenderer(hostElement) {
  host = hostElement;
  app = document.getElementById("app");
  ensureArrangeMenu();
  document.addEventListener('clay-split-picker-layout', renderCurrentGeometry);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  document.addEventListener("lostpointercapture", onPointerCancel, true);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("resize", function () { renderCurrentGeometry(); });
  window.addEventListener("scroll", closePresentationArrange, true);
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(function () { renderCurrentGeometry(); });
    resizeObserver.observe(host);
  }
}

export function hidePresentationView() {
  if (!host) return;
  clearEmptySplit(host);
  var legacySplit = store.get('splitPanes');
  if (legacySplit) releaseRetainedPanes(host);
  else clearRetainedPanes(host);
  relocateStickyStatus(false);
  var scrollToken = 'split-view-layout-' + geometryToken;
  Array.from(host.querySelectorAll(':scope > .split-pane > .split-pane-frame')).forEach(function (frame) {
    var live = frame.clayPane && frame.clayPane.identity();
    if (live && live.ready && live.binding && frame.contentWindow) frame.contentWindow.postMessage({ type: 'clay-pane-layout-resize', phase: 'end', token: scrollToken, paneBinding: live.binding }, window.location.origin);
  });
  store.set({ projectSplitViewTranscriptScroll: {} });
  restoreDividerFrames(store.get('projectSplitViewDividerDrag'));
  store.set({ projectSplitViewDividerDrag: null });
  document.body.classList.remove("split-view-resizing");
  host.classList.remove("split-view-canvas");
  delete host.dataset.positioned;
  delete host.dataset.singlePane;
  if (!legacySplit) {
    clearToolPaneWindows();
    host.classList.remove("visible");
    if (app) app.classList.remove("split-native-hidden");
  }
  var panes = host.querySelectorAll(':scope > .split-pane');
  for (var pi = 0; pi < panes.length; pi++) {
    panes[pi].hidden = false;
    panes[pi].style.display = "";
    panes[pi].style.visibility = "";
    panes[pi].style.left = ""; panes[pi].style.top = ""; panes[pi].style.width = "";
    panes[pi].style.height = ""; panes[pi].style.order = "";
  }
  if (legacySplit) {
    Array.from(host.querySelectorAll(':scope > .split-view-divider, :scope > .split-view-drop-preview')).forEach(function (item) { item.remove(); });
    Array.from(host.querySelectorAll('.split-view-arrange-trigger')).forEach(function (trigger) { trigger.remove(); });
    closePresentationArrange(false); paintLegacyToolPanes(host);
    return;
  }
  var frames = host.querySelectorAll('.split-pane-frame');
  for (var i = 0; i < frames.length; i++) if (frames[i].clayPane) frames[i].clayPane.suspend();
  Array.from(host.querySelectorAll(':scope > .split-view-divider')).forEach(function (divider) { divider.remove(); });
  Array.from(host.querySelectorAll(':scope > .split-view-drop-preview')).forEach(function (preview) { preview.remove(); });
  Array.from(host.querySelectorAll('.split-view-arrange-trigger')).forEach(function (trigger) { trigger.remove(); });
  closePresentationArrange(false);
}

export function renderPresentationView(view, tree, sessions) {
  if (!host || !view || !Array.isArray(sessions)) return;
  var drag = store.get('projectSplitViewDividerDrag');
  if (drag && !currentLayoutScope(drag.scope)) onWindowBlur();
  var ids = listIds(tree);
  var singleton = ids.length === 1 && sessions.length === 1 && ids[0] === sessions[0].sessionOriginId;
  if ((!singleton && !validateTree(tree, ids).ok) || ids.length !== sessions.length) return;
  var byOrigin = new Map();
  sessions.forEach(function (session) { byOrigin.set(session.sessionOriginId, session); });
  var panes = [];
  for (var i = 0; i < ids.length; i++) {
    var session = byOrigin.get(ids[i]);
    if (!session) return;
    panes.push(splitPaneForSession(session.id, store.get('currentSlug'), sessions));
  }
  host.classList.add("split-view-canvas", "visible");
  relocateStickyStatus(true);
  host.dataset.singlePane = singleton ? "true" : "false";
  host.dataset.positioned = "true";
  if (app) app.classList.add("split-native-hidden");
  reconcileSplitPanes(host, panes, function (pane) { return createSplitPane(pane, function (sessionId) { dispatch("clay-split-view-close-pane", { sessionId: sessionId }); }); }, updateSplitPaneMetadata, paneRetention(host));
  Array.from(host.querySelectorAll(':scope > .split-pane .split-pane-header')).forEach(function (header) { ensureArrangeTrigger(header); });
  ensureArrangeMenu();
  Array.from(host.querySelectorAll(':scope > .split-pane')).forEach(function (node) {
    var target = panes.find(function (pane) { return node.dataset.splitPaneKey === pane.slug + '#' + pane.sessionId; });
    var session = target && sessions.find(function (item) { return item.id === target.sessionId; });
    node.dataset.presentationOrigin = session ? session.sessionOriginId : '';
  });
  applyGeometry(view, tree);
  Array.from(host.querySelectorAll(':scope > .split-pane')).forEach(function (paneEl) {
    updateSplitPaneCloseVisibility(paneEl, paneEl.dataset.sessionId);
    bindPresentationClose(paneEl);
  });
  refreshIcons();
}

function currentView() {
  var views = store.get('projectSplitViews') || [], activeId = store.get('projectSplitViewActiveId');
  for (var i = 0; i < views.length; i++) if (views[i].id === activeId) return views[i];
  return null;
}

function activeTree() {
  return presentationTree(currentView()) || null;
}

function currentSingletonGeometry() {
  if (!host || host.hidden || !host.isConnected || host.dataset.singlePane !== 'true' ||
      !host.classList.contains('visible') || !host.classList.contains('split-view-canvas') || store.get('projectSplitViewActiveId')) return null;
  var singleton = currentSingletonPresentation(store.snap(), getCachedSessions());
  if (!singleton || singleton.origin !== store.get('projectSplitViewSingletonOrigin')) return null;
  var panes = host.querySelectorAll(':scope > .split-pane');
  if (panes.length !== 1 || panes[0].hidden) return null;
  var frame = panes[0].querySelector('.split-pane-frame');
  if (!frame || !frame.isConnected || frame.dataset.sessionOriginId !== singleton.origin ||
      Number(frame.dataset.sessionId) !== singleton.session.id || !livePaneBinding(frame)) return null;
  return singleton;
}

function renderCurrentGeometry() {
  if (paintLegacyToolPanes(host)) return;
  var view = currentView(), tree = activeTree();
  if (view && (tree || !view.sessions.length)) { applyGeometry(view, tree); return; }
  var singleton = currentSingletonGeometry();
  if (singleton) applyGeometry(singleton.view, { id: singleton.origin }, function () {
    var current = currentSingletonGeometry();
    return current && current.origin === singleton.origin && current.session.id === singleton.session.id;
  });
}

function applyGeometry(view, tree, stillCurrent) {
  var scope = layoutScope(view);
  var focusedDividerPath = document.activeElement && document.activeElement.classList.contains("split-view-divider") ? document.activeElement.dataset.path : null;
  var scrollState = Object.assign({}, store.get('projectSplitViewTranscriptScroll') || {}), resizeToken = 'split-view-layout-' + (++geometryToken), resizeFrames = [];
  Array.from(host.querySelectorAll(':scope > .split-pane > .split-pane-frame')).forEach(function (frame) {
    var doc = frame.contentDocument, transcript = doc && doc.getElementById("messages");
    if (transcript) {
      var live = frame.clayPane && frame.clayPane.identity(), binding = live && live.binding;
      var key = frame.dataset.sessionOriginId + ':' + (binding && binding.generation || 0) + ':' + (binding && binding.requestId || '');
      if (!transcript.__splitViewScrollTracker) {
        transcript.__splitViewScrollKey = key;
        transcript.__splitViewScrollTracker = function () {
          var current = Object.assign({}, store.get('projectSplitViewTranscriptScroll') || {});
          current[transcript.__splitViewScrollKey] = { scrollTop: transcript.scrollTop };
          store.set({ projectSplitViewTranscriptScroll: current });
        };
        transcript.addEventListener('scroll', transcript.__splitViewScrollTracker, { passive: true });
      }
      transcript.__splitViewScrollKey = key;
      if (!scrollState[key]) scrollState[key] = { scrollTop: transcript.scrollTop };
      resizeFrames.push({ frame: frame, doc: doc, transcript: transcript, key: key, binding: binding, scrollTop: scrollState[key].scrollTop });
    }
  });
  var allowedKeys = new Set(resizeFrames.map(function (item) { return item.key; }));
  Object.keys(scrollState).forEach(function (key) { if (!allowedKeys.has(key)) delete scrollState[key]; });
  store.set({ projectSplitViewTranscriptScroll: scrollState });
  resizeFrames.forEach(function (item) {
    var live = item.frame.clayPane && item.frame.clayPane.identity();
    if (!live || !live.ready || !bindingMatches(live.binding, item.binding) || item.frame.contentDocument !== item.doc) return;
    item.frame.contentWindow.postMessage({ type: 'clay-pane-layout-resize', phase: 'begin', token: resizeToken, scrollTop: item.scrollTop, paneBinding: item.binding }, window.location.origin);
  });
  var style = window.getComputedStyle(host), left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
  var right = parseFloat(style.paddingRight) || 0, bottom = parseFloat(style.paddingBottom) || 0;
  var windowTree = toolPaneLayoutTree(view, tree);
  var geometry = rectangles(windowTree, Math.max(0, host.clientWidth - left - right), Math.max(0, host.clientHeight - top - bottom), 7);
  paintToolPaneWindows(host, view, tree, windowTree, geometry, { left: left, top: top });
  var reserving = reserveEmptySplit(host, geometry, { left: left, top: top });
  var focused = store.get('projectSplitViewFocusedOrigin');
  var panes = host.querySelectorAll(':scope > .split-pane');
  for (var i = 0; i < panes.length; i++) {
    var frame = panes[i].querySelector('.split-pane-frame'), origin = panes[i].dataset.presentationOrigin || frame && frame.dataset.sessionOriginId;
    var rect = !reserving && host.dataset.singlePane === 'true' && panes.length === 1 && !dockedToolPanes().length ?
      { x: 0, y: 0, width: Math.max(0, host.clientWidth - left - right), height: Math.max(0, host.clientHeight - top - bottom) } : geometry.panes[origin];
    if (!rect) continue;
    if (focused && geometry.panes[focused]) {
      panes[i].hidden = origin !== focused;
      panes[i].style.display = origin === focused ? "" : "none";
      if (origin === focused) rect = { x: 0, y: 0, width: host.clientWidth - left - right, height: host.clientHeight - top - bottom };
    } else { panes[i].hidden = false; panes[i].style.display = ""; }
    panes[i].style.left = (left + rect.x) + "px"; panes[i].style.top = (top + rect.y) + "px";
    panes[i].style.width = rect.width + "px"; panes[i].style.height = rect.height + "px";
    panes[i].style.order = String(i);
    panes[i].dataset.active = origin === view.activeSessionOriginId ? "true" : "false";
    var sidebarButton = panes[i].querySelector('.split-pane-sidebar');
    if (sidebarButton) sidebarButton.hidden = host.dataset.singlePane !== 'true' && origin !== view.activeSessionOriginId;
    ensureArrangeTrigger(panes[i].querySelector('.split-pane-header'));
  }
  Array.from(host.querySelectorAll(':scope > .split-view-divider')).forEach(function (divider) { divider.remove(); });
  for (var di = 0; !focused && di < geometry.dividers.length; di++) {
    var entry = geometry.dividers[di], divider = document.createElement("div");
    divider.className = "split-view-divider"; divider.dataset.axis = entry.axis; divider.dataset.path = JSON.stringify(entry.path);
    divider.setAttribute("role", "separator"); divider.setAttribute("tabindex", "0");
    divider.setAttribute("aria-orientation", entry.axis === "horizontal" ? "vertical" : "horizontal");
    divider.setAttribute("aria-label", "Resize Split view panels");
    if (reserving) { divider.inert = true; divider.tabIndex = -1; divider.setAttribute('aria-disabled', 'true'); }
    divider.style.left = (left + entry.rect.x) + "px"; divider.style.top = (top + entry.rect.y) + "px";
    divider.style.width = entry.rect.width + "px"; divider.style.height = entry.rect.height + "px";
    if (dockedToolPanes().length) bindWorkspaceDivider(divider, entry, windowTree);
    else bindDivider(divider, entry, tree, listIds(tree), scope); host.appendChild(divider);
    if (focusedDividerPath && divider.dataset.path === focusedDividerPath) divider.focus();
  }
  ensureDropPreview();
  afterPaneMotion(host, function () {
    if (resizeToken !== 'split-view-layout-' + geometryToken || (stillCurrent ? !stillCurrent() : !currentLayoutScope(scope))) return;
    resizeFrames.forEach(function (item) {
      var live = item.frame.clayPane && item.frame.clayPane.identity();
      if (!live || !live.ready || !bindingMatches(live.binding, item.binding) || item.frame.contentDocument !== item.doc || !item.transcript.isConnected) return;
      item.frame.contentWindow.postMessage({ type: 'clay-pane-layout-resize', phase: 'end', token: resizeToken, paneBinding: item.binding }, window.location.origin);
    });
  });
}
export function ensureArrangeTrigger(header) {
  if (!header) return;
  if (!header.querySelector('[data-action="arrange"]')) {
    var trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "split-view-arrange-trigger";
    trigger.dataset.action = "arrange"; trigger.setAttribute("aria-label", "Split view options");
    trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", "split-view-arrange-menu");
    trigger.innerHTML = iconHtml("columns-2");
    var close = header.querySelector(".split-pane-close"); header.insertBefore(trigger, close || null);
  }
  var pane = header.closest('.split-pane');
  if (pane) syncPaneHeaderState(pane);
}

function ensureArrangeMenu() {
  var menu = document.getElementById("split-view-arrange-menu");
  if (menu) return menu;
  menu = document.createElement("div"); menu.id = "split-view-arrange-menu"; menu.className = "split-view-arrange";
  menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "Arrange Split view"); menu.hidden = true;
  var header = document.createElement("div"); header.className = "split-view-arrange-header";
  var title = document.createElement("strong"); title.textContent = "Arrange Split view"; header.appendChild(title);
  var close = document.createElement("button"); close.type = "button"; close.setAttribute("aria-label", "Close arrangement menu"); close.innerHTML = iconHtml("x"); header.appendChild(close);
  close.addEventListener("click", function () { closePresentationArrange(); }); menu.appendChild(header);
  var presets = [["balanced", "Balanced"], ["columns", "Columns"], ["rows", "Rows"], ["grid", "Grid"], ["main-left", "Main left"], ["main-right", "Main right"]];
  var presetGrid = document.createElement("div"); presetGrid.className = "split-view-arrange-grid";
  presets.forEach(function (item) { var button = document.createElement("button"); button.type = "button"; button.dataset.preset = item[0]; appendLayoutOption(button, item[1], "preset", item[0]); presetGrid.appendChild(button); });
  menu.appendChild(presetGrid);
  var positions = [["left", "Left half"], ["right", "Right half"], ["top", "Top half"], ["bottom", "Bottom half"], ["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"], ["left-third", "Left third"], ["right-third", "Right third"]];
  var positionGrid = document.createElement("div"); positionGrid.className = "split-view-arrange-grid split-view-arrange-positions";
  positions.forEach(function (item) { var button = document.createElement("button"); button.type = "button"; button.dataset.position = item[0]; appendLayoutOption(button, item[1], "position", item[0]); positionGrid.appendChild(button); });
  menu.appendChild(positionGrid);
  var focusButton = document.createElement("button"); focusButton.type = "button"; focusButton.dataset.focusLayout = "true"; menu.appendChild(focusButton);
  var membership = document.createElement("button"); membership.type = "button"; membership.dataset.arrangeMembership = "true";
  membership.textContent = "Choose sessions"; menu.appendChild(membership);
  var context = document.createElement("div"); context.className = "split-view-arrange-context";
  var contextButton = document.createElement("button"); contextButton.type = "button"; contextButton.dataset.arrangeContext = "true";
  contextButton.setAttribute("aria-expanded", "false"); contextButton.setAttribute("aria-controls", "split-view-arrange-context-list");
  var contextTitle = document.createElement("span"); contextTitle.dataset.arrangeContextTitle = "true"; contextButton.appendChild(contextTitle); context.appendChild(contextButton);
  var contextList = document.createElement("div"); contextList.id = "split-view-arrange-context-list"; contextList.hidden = true; contextList.setAttribute("role", "listbox");
  context.appendChild(contextList); menu.insertBefore(context, presetGrid);
  document.body.appendChild(menu); return menu;
}

function openArrangeMenu(trigger) {
  if (!syncPaneHeaderState(trigger.closest('.split-pane'))) return;
  if (host && host.dataset.singlePane === "true") {
    dispatch("clay-split-view-open-create", { anchor: trigger });
    return;
  }
  var menu = ensureArrangeMenu();
  if (!menu.hidden && menuTrigger === trigger) { closePresentationArrange(); return; }
  closePresentationArrange(false); menuTrigger = trigger; menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  var view = currentView(), count = view && view.sessions ? view.sessions.length : 0;
  var pane = trigger.closest('.split-pane'), frame = pane && pane.querySelector('.split-pane-frame');
  var sourceOrigin = frame && frame.dataset.sessionOriginId;
  if (!view || !view.sessions.some(function (session) { return session.sessionOriginId === sourceOrigin; })) sourceOrigin = view && view.activeSessionOriginId;
  menu.dataset.sourceOrigin = sourceOrigin || "";
  var contextButton = menu.querySelector('[data-arrange-context]'), contextTitle = menu.querySelector('[data-arrange-context-title]');
  var contextList = menu.querySelector('#split-view-arrange-context-list');
  var selectedSession = view && view.sessions.find(function (session) { return session.sessionOriginId === sourceOrigin; });
  if (contextTitle) contextTitle.textContent = selectedSession && selectedSession.title || "Choose session";
  if (contextList) {
    contextList.textContent = "";
    (view && view.sessions || []).forEach(function (session) {
      var choice = document.createElement("button"); choice.type = "button"; choice.dataset.arrangeSourceOrigin = session.sessionOriginId;
      choice.setAttribute("role", "option"); choice.setAttribute("aria-selected", session.sessionOriginId === sourceOrigin ? "true" : "false");
      choice.textContent = session.title || "Session"; contextList.appendChild(choice);
    });
  }
  if (contextButton) contextButton.setAttribute("aria-expanded", "false");
  var focusButton = menu.querySelector('[data-focus-layout]');
  if (focusButton) focusButton.textContent = store.get('projectSplitViewFocusedOrigin') ? "Restore layout" : "Focus selected session";
  Array.from(menu.querySelectorAll('[data-position*="-"]:not([data-position$="-third"])')).forEach(function (button) {
    button.disabled = count < 3; button.title = count < 3 ? "Quarter layouts require at least three sessions" : "";
  });
  var rect = trigger.getBoundingClientRect(), width = Math.min(280, window.innerWidth - 16);
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)) + "px";
  var first = menu.querySelector('button[data-preset]'); if (first) first.focus();
}

export function closePresentationArrange(restoreFocus) {
  var menu = document.getElementById("split-view-arrange-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (menuTrigger && menuTrigger.isConnected) {
    menuTrigger.setAttribute("aria-expanded", "false");
    if (restoreFocus !== false) menuTrigger.focus();
  }
  menuTrigger = null;
}

function onClick(event) {
  var trigger = event.target.closest('[data-action="arrange"]');
  if (trigger) { event.preventDefault(); event.stopImmediatePropagation(); openArrangeMenu(trigger); return; }
  var menu = event.target.closest('#split-view-arrange-menu');
  if (menu) {
    if (event.target.closest('[data-arrange-membership]')) {
      event.preventDefault(); event.stopImmediatePropagation();
      var anchor = menuTrigger; closePresentationArrange(false);
      if (anchor && anchor.isConnected) dispatch("clay-split-view-open-create", { anchor: anchor });
      return;
    }
    var contextButton = event.target.closest('[data-arrange-context]');
    if (contextButton) {
      var contextList = menu.querySelector('#split-view-arrange-context-list');
      var expanded = contextButton.getAttribute("aria-expanded") === "true";
      contextButton.setAttribute("aria-expanded", expanded ? "false" : "true"); contextList.hidden = expanded;
      if (!expanded) { var firstChoice = contextList.querySelector('button'); if (firstChoice) firstChoice.focus(); }
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    var sourceChoice = event.target.closest('[data-arrange-source-origin]');
    if (sourceChoice) {
      var sourceView = currentView(), chosen = sourceView && sourceView.sessions.find(function (session) { return session.sessionOriginId === sourceChoice.dataset.arrangeSourceOrigin; });
      if (chosen) { menu.dataset.sourceOrigin = chosen.sessionOriginId; menu.querySelector('[data-arrange-context-title]').textContent = chosen.title || "Session"; }
      var list = menu.querySelector('#split-view-arrange-context-list'); list.hidden = true; menu.querySelector('[data-arrange-context]').setAttribute("aria-expanded", "false");
      event.preventDefault(); event.stopImmediatePropagation(); var first = menu.querySelector('button[data-preset]'); if (first) first.focus(); return;
    }
    var focusButton = event.target.closest("button[data-focus-layout]");
    if (focusButton) {
      event.preventDefault(); event.stopImmediatePropagation();
      dispatch("clay-split-view-focus", { focused: !store.get('projectSplitViewFocusedOrigin'), sessionOriginId: menu.dataset.sourceOrigin });
      closePresentationArrange(); return;
    }
    var button = event.target.closest("button[data-preset], button[data-position]");
    if (button && !button.disabled) {
      event.preventDefault(); event.stopImmediatePropagation();
      dispatch("clay-split-view-arrange", { preset: button.dataset.preset || null, position: button.dataset.position || null, sessionOriginId: menu.dataset.sourceOrigin });
      closePresentationArrange();
    }
    return;
  }
  var focusable = event.target.closest("button, a, input, textarea, select, [tabindex]:not([tabindex='-1'])");
  closePresentationArrange(!focusable);
}

function onKeyDown(event) {
  var menu = document.getElementById("split-view-arrange-menu");
  if (event.key === "Escape" && menu && !menu.hidden) { event.preventDefault(); event.stopImmediatePropagation(); closePresentationArrange(); }
  var drag = store.get('projectSplitViewDividerDrag');
  if (event.key === "Escape" && drag) {
    event.preventDefault(); restoreDividerFrames(drag); document.body.classList.remove("split-view-resizing");
    try { if (document.documentElement.hasPointerCapture(drag.pointerId)) document.documentElement.releasePointerCapture(drag.pointerId); } catch (error) {}
    store.set({ projectSplitViewDividerDrag: null, projectSplitViewPreviewTree: store.get('projectSplitViewPreviewScope') === drag.scope ? null : store.get('projectSplitViewPreviewTree') }); renderCurrentGeometry();
  }
}

function ensureDropPreview() {
  if (host.querySelector(':scope > .split-view-drop-preview')) return;
  var preview = document.createElement("div"); preview.className = "split-view-drop-preview"; preview.hidden = true;
  var label = document.createElement("span"); label.className = "drop-label"; preview.appendChild(label); host.appendChild(preview);
}

function bindDivider(divider, entry, tree, ids, scope) {
  divider.addEventListener("keydown", function (event) {
    if (!currentLayoutScope(scope)) return;
    var delta = event.shiftKey ? 0.05 : 0.02, ratio = entry.ratio;
    if (entry.axis === "horizontal" && event.key === "ArrowLeft" || entry.axis === "vertical" && event.key === "ArrowUp") ratio -= delta;
    else if (entry.axis === "horizontal" && event.key === "ArrowRight" || entry.axis === "vertical" && event.key === "ArrowDown") ratio += delta;
    else return;
    event.preventDefault(); commitTreePreview(tree, entry.path, ratio, ids, scope);
  });
  divider.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || !currentLayoutScope(scope)) return;
    var branchRect = entry.branchRect;
    var frames = Array.from(host.querySelectorAll('.split-pane-frame')).map(function (frame) { return { frame: frame, pointerEvents: frame.style.pointerEvents }; });
    frames.forEach(function (item) { item.frame.style.pointerEvents = "none"; });
    document.body.classList.add("split-view-resizing");
    store.set({ projectSplitViewDividerDrag: { scope: scope, pointerId: event.pointerId, path: entry.path, axis: entry.axis,
      startX: event.clientX, startY: event.clientY,
      extent: entry.axis === "horizontal" ? branchRect.width : branchRect.height,
      originX: event.clientX, originY: event.clientY, viewId: store.get('projectSplitViewActiveId'),
      tree: tree, startTree: tree, ids: ids, frames: frames, changed: false } });
    try { document.documentElement.setPointerCapture(event.pointerId); } catch (e) {}
    event.preventDefault();
  });
}

function commitTreePreview(tree, path, ratio, ids, scope) {
  if (!currentLayoutScope(scope)) return;
  var next = resize(tree, path, Math.max(0.05, Math.min(0.95, ratio)));
  if (!next || !validateTree(next, ids).ok) return;
  store.set({ projectSplitViewPreviewTree: next, projectSplitViewPreviewScope: scope }); renderCurrentGeometry();
  var view = currentView();
  if (view) dispatch("clay-split-view-resize", { viewId: view.id, tree: next, ids: ids, scope: scope });
}

function nodeAtPath(tree, path) { var node = tree; for (var i = 0; i < path.length; i++) node = node && node[path[i]]; return node; }

function onPointerMove(event) {
  var drag = store.get('projectSplitViewDividerDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!currentLayoutScope(drag.scope)) { onWindowBlur(); return; }
  var node = nodeAtPath(drag.startTree, drag.path), coordinate = drag.axis === "horizontal" ? event.clientX : event.clientY;
    var origin = drag.axis === "horizontal" ? drag.originX : drag.originY;
  var ratio = node ? node.ratio + (coordinate - origin) / Math.max(1, drag.extent) : 0.5;
  var next = resize(drag.tree, drag.path, Math.max(0.05, Math.min(0.95, ratio)));
  if (!next) return;
  drag.tree = next; drag.changed = true; store.set({ projectSplitViewDividerDrag: drag, projectSplitViewPreviewTree: next, projectSplitViewPreviewScope: drag.scope }); renderCurrentGeometry();
  event.preventDefault();
}

function onPointerUp(event) {
  var drag = store.get('projectSplitViewDividerDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!currentLayoutScope(drag.scope)) { onWindowBlur(); return; }
  drag.frames.forEach(function (entry) { if (entry.frame.isConnected) entry.frame.style.pointerEvents = entry.pointerEvents; });
  document.body.classList.remove("split-view-resizing");
  store.set({ projectSplitViewDividerDrag: null });
  try { if (document.documentElement.hasPointerCapture(event.pointerId)) document.documentElement.releasePointerCapture(event.pointerId); } catch (e) {}
  if (drag.changed && currentLayoutScope(drag.scope)) dispatch("clay-split-view-resize", { viewId: drag.viewId, tree: drag.tree, ids: drag.ids, scope: drag.scope });
}

function onPointerCancel(event) {
  var drag = store.get('projectSplitViewDividerDrag');
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.frames.forEach(function (entry) { if (entry.frame.isConnected) entry.frame.style.pointerEvents = entry.pointerEvents; });
  document.body.classList.remove("split-view-resizing");
  store.set({ projectSplitViewDividerDrag: null, projectSplitViewPreviewTree: store.get('projectSplitViewPreviewScope') === drag.scope ? null : store.get('projectSplitViewPreviewTree') }); renderCurrentGeometry();
}

function restoreDividerFrames(drag) {
  if (drag && drag.frames) drag.frames.forEach(function (entry) { if (entry.frame.isConnected) entry.frame.style.pointerEvents = entry.pointerEvents; });
}

function onWindowBlur() {
  var drag = store.get('projectSplitViewDividerDrag');
  if (!drag) return;
  restoreDividerFrames(drag); document.body.classList.remove("split-view-resizing");
  try { if (document.documentElement.hasPointerCapture(drag.pointerId)) document.documentElement.releasePointerCapture(drag.pointerId); } catch (error) {}
  store.set({ projectSplitViewDividerDrag: null, projectSplitViewPreviewTree: store.get('projectSplitViewPreviewScope') === drag.scope ? null : store.get('projectSplitViewPreviewTree') }); renderCurrentGeometry();
}
