import { workerCursorKey, workerCursorAdvances, shouldLoadWorkerPage, captureWorkerAnchor, restoreWorkerAnchor } from './split-view-worker-scroll.js';
import { workerTranscriptRows, appendWorkerMessage } from './split-view-worker-transcript.js';
// Read-only Worker conversation chips attached to a Driver's presentation pane.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { iconHtml, refreshIcons } from './icons.js';
import { splitGroupRoles } from './split-group-helpers.js';
import { livePaneBinding, samePaneBinding } from './pane-binding.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';

function sessions() { return getCachedSessions() || []; }
function exactDriver(origin) {
  return sessions().find(function (session) { return session.sessionOriginId === origin && session.sessionRole === "driver"; }) || null;
}
function exactWorker(driver, origin, generation) {
  if (!driver) return null;
  return sessions().find(function (session) { return session.sessionOriginId === origin && session.sessionRole === "worker" &&
    session.parentAvailable === true && session.parentSessionId === driver.id && (session.ownerId || null) === (driver.ownerId || null) &&
    session.workerGeneration === generation; }) || null;
}
function workersFor(driver) {
  var all = sessions().filter(function (session) { return session.sessionRole === "worker" && session.parentAvailable === true && session.parentSessionId === driver.id &&
    (session.ownerId || null) === (driver.ownerId || null); });
  var currentIds = new Set();
  (store.get('splitGroups') || []).forEach(function (group) {
    var roles = splitGroupRoles(group);
    if (roles && roles.driverId === driver.id) roles.workerIds.forEach(function (id) { currentIds.add(id); });
  });
  all.sort(function (a, b) { return (currentIds.has(b.id) ? 1 : 0) - (currentIds.has(a.id) ? 1 : 0) ||
    (Number(b.workerGeneration) || 0) - (Number(a.workerGeneration) || 0); });
  return { items: all, currentIds: currentIds };
}
function configuredGroup(driver) {
  if (!driver) return null;
  var groups = store.get('splitGroups') || [];
  for (var i = 0; i < groups.length; i++) {
    var roles = splitGroupRoles(groups[i]);
    if (roles && roles.version === 2 && roles.driverId === driver.id && roles.workerIds.length) return groups[i];
  }
  return null;
}
function presentationSource(container, driver) {
  var frame = container && container.querySelector('.split-pane-frame'), live = frame && frame.clayPane && frame.clayPane.identity();
  if (!driver || !frame || !live || !live.ready || !livePaneBinding(frame) || frame.dataset.sessionId !== String(driver.id) ||
      frame.dataset.sessionOriginId !== driver.sessionOriginId || live.sessionId !== driver.id ||
      live.binding.sessionOriginId !== driver.sessionOriginId || live.ownerId !== (store.get('myUserId') || null) ||
      live.projectSlug !== store.get('currentSlug')) return null;
  var view = (store.get('projectSplitViews') || []).find(function (item) { return item.id === store.get('projectSplitViewActiveId'); });
  var inView = !!(view && view.sessions.some(function (session) { return session.id === driver.id && session.sessionOriginId === driver.sessionOriginId; }));
  var inSingleton = !view && store.get('projectSplitViewSingletonOrigin') === driver.sessionOriginId;
  return inView || inSingleton ? { frame: frame, live: live, view: view, singleton: inSingleton } : null;
}
function popover() { return document.getElementById("split-view-worker-popover"); }
function close(returnFocus) {
  var state = store.get('splitViewWorkerConversation');
  if (!state) return;
  if (state.fillTimer) clearTimeout(state.fillTimer);
  if (state.requestTimer) clearTimeout(state.requestTimer);
  store.set({ splitViewWorkerConversation: null });
  var element = popover(); if (element) element.remove();
  if (returnFocus) {
    var chip = document.querySelector('.split-pane[data-session-origin="' + CSS.escape(state.driverOriginId) + '"] [data-worker-origin="' + CSS.escape(state.workerOriginId) + '"]');
    if (chip && chip.isConnected && !chip.closest('.split-pane').hidden) chip.focus();
  }
}
function position(element, anchor) {
  if (!element || !anchor || !anchor.isConnected) return;
  var rect = anchor.getBoundingClientRect(), width = Math.min(430, window.innerWidth - 20), height = Math.min(440, window.innerHeight - 24);
  element.style.width = width + "px"; element.style.height = height + "px";
  element.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)) + "px";
  element.style.top = Math.max(10, Math.min(rect.bottom + 6, window.innerHeight - height - 10)) + "px";
}
function requestPage(state, before, append) {
  var current = store.get('splitViewWorkerConversation');
  if (!state || !current || state.requestId !== current.requestId || current.inFlight || workerCursorKey(before) === null || !ensurePopover()) return;
  state = store.get('splitViewWorkerConversation');
  if (append && workerCursorKey(before) !== workerCursorKey(state.nextBefore)) return;
  if (state.fillTimer) clearTimeout(state.fillTimer);
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    store.set({ splitViewWorkerConversation: Object.assign({}, state, { status: "error", error: "Worker conversation is unavailable while disconnected.", append: false }) });
    renderContent(); return;
  }
  var requestId = "worker-read-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  var pending = Object.assign({}, state, { requestId: requestId, socket: ws, projectSlug: store.get('currentSlug'), ownerId: store.get('myUserId') || null,
    socketGeneration: store.get('projectSplitViewSocketGeneration') || 0, status: "loading", error: null, inFlight: true, fillTimer: null, requestedBefore: before == null ? null : before, append: append === true });
  pending.requestTimer = setTimeout(function () {
    var current = store.get('splitViewWorkerConversation');
    if (!current || current.requestId !== requestId || !current.inFlight) return;
    store.set({ splitViewWorkerConversation: Object.assign({}, current, { status: 'error', inFlight: false, append: false,
      requestTimer: null, error: 'Worker conversation request timed out. Scroll up or retry to load it again.' }) });
    renderContent();
  }, 15000);
  store.set({ splitViewWorkerConversation: pending }); renderContent();
  try {
    ws.send(JSON.stringify({ type: "split_worker_conversation_request", requestId: requestId,
      parentSessionOriginId: state.driverOriginId, workerSessionOriginId: state.workerOriginId,
      generation: state.generation, before: before }));
  } catch (_error) {
    var current = store.get('splitViewWorkerConversation');
    if (current && current.requestId === requestId) {
      clearTimeout(current.requestTimer);
      store.set({ splitViewWorkerConversation: Object.assign({}, current, { status: "error", error: "Worker conversation request could not be sent.", inFlight: false, append: false }) });
      renderContent();
    }
  }
}
function open(chip, driver, worker) {
  var existing = store.get('splitViewWorkerConversation');
  if (existing && existing.driverOriginId === driver.sessionOriginId && existing.workerOriginId === worker.sessionOriginId && existing.generation === worker.workerGeneration) { close(true); return; }
  if (existing) close(false);
  var state = { requestId: null, driverOriginId: driver.sessionOriginId, workerOriginId: worker.sessionOriginId,
    generation: worker.workerGeneration, driverTitle: driver.title || "Driver session", workerTitle: worker.title || "Worker",
    sourceBinding: chip.closest('.split-pane').querySelector('.split-pane-frame').clayPane.identity().binding,
    status: "loading", messages: [], hasMore: false, nextBefore: null, append: false, inFlight: false, initialPage: true };
  store.set({ splitViewWorkerConversation: state }); ensurePopover(); renderContent();
  var element = popover(); position(element, chip);
  requestPage(state, undefined, false);
  var closeButton = element && element.querySelector('[aria-label="Close Worker conversation"]'); if (closeButton) closeButton.focus();
}
function ensurePopover() {
  var state = store.get('splitViewWorkerConversation');
  var element = popover();
  if (!state) { if (element) element.remove(); return; }
  var driver = exactDriver(state.driverOriginId), worker = exactWorker(driver, state.workerOriginId, state.generation);
  var sourcePane = document.querySelector('.split-pane[data-session-origin="' + CSS.escape(state.driverOriginId) + '"]');
  var source = presentationSource(sourcePane, driver);
  if (!driver || !worker || !source || sourcePane.hidden || !state.sourceBinding || !samePaneBinding(source.live.binding, state.sourceBinding) ||
      source.view && store.get('projectSplitViewFocusedOrigin') && store.get('projectSplitViewFocusedOrigin') !== state.driverOriginId) {
    close(false); return;
  }
  if (!element) {
    element = document.createElement("section"); element.id = "split-view-worker-popover"; element.className = "split-view-worker-popover";
    element.setAttribute("role", "dialog"); element.setAttribute("aria-label", "Read-only Worker conversation"); document.body.appendChild(element);
    var header = document.createElement("header"); header.className = "split-view-worker-popover-header";
    var title = document.createElement("strong"); title.className = "worker-popover-title"; header.appendChild(title);
    var closeButton = document.createElement("button"); closeButton.type = "button"; closeButton.setAttribute("aria-label", "Close Worker conversation"); closeButton.innerHTML = iconHtml("x");
    closeButton.addEventListener("click", function () { close(true); }); header.appendChild(closeButton); element.appendChild(header);
    var source = document.createElement("div"); source.className = "split-view-worker-popover-source"; element.appendChild(source);
    var body = document.createElement("div"); body.className = "split-view-worker-popover-body"; body.tabIndex = 0; body.setAttribute("aria-label", "Read-only Worker transcript"); element.appendChild(body);
    body.addEventListener('scroll', function () { loadEarlier(body, true); }, { passive: true });
    body.addEventListener('wheel', function (event) { if (event.deltaY < 0) loadEarlier(body, true); }, { passive: true });
    var footer = document.createElement("footer"); footer.className = "split-view-worker-popover-footer"; element.appendChild(footer);
  }
  return element;
}
function renderContent() {
  var state = store.get('splitViewWorkerConversation'), element = ensurePopover();
  if (!state || !element) return;
  var title = element.querySelector('.worker-popover-title'), source = element.querySelector('.split-view-worker-popover-source');
  var body = element.querySelector('.split-view-worker-popover-body'), footer = element.querySelector('.split-view-worker-popover-footer');
  if (title) title.textContent = state.workerTitle;
  if (source) source.textContent = state.driverTitle + " · " + state.workerTitle + " · Gen " + state.generation;
  var footerFocused = footer && footer.contains(document.activeElement);
  if (body && (state.renderedMessages !== state.messages || !state.messages.length)) {
    var anchor = state.prepend ? captureWorkerAnchor(body) : null;
    var expanded = Array.from(body.querySelectorAll('article[data-record-index] details[open]')).map(function (item) { return item.closest('article').dataset.recordIndex; });
    var focusedRecord = document.activeElement && document.activeElement.closest('article[data-record-index]');
    var focusedIndex = focusedRecord && body.contains(focusedRecord) ? focusedRecord.dataset.recordIndex : null;
    var oldTop = body.scrollTop, wasFocused = document.activeElement === body;
    body.textContent = "";
    if (state.status === "loading" && !state.messages.length) body.textContent = "Loading conversation…";
    else if (state.status === "error" && !state.messages.length) body.textContent = state.error || "Conversation is unavailable.";
    else if (!state.messages.length) body.textContent = "No recorded conversation.";
    workerTranscriptRows(state.messages).forEach(function (message) { appendWorkerMessage(body, message); });
    Array.from(body.querySelectorAll('article[data-record-index]')).forEach(function (article) {
      var details = article.querySelector('details');
      if (details && expanded.indexOf(article.dataset.recordIndex) >= 0) details.open = true;
      if (focusedIndex === article.dataset.recordIndex) { var summary = article.querySelector('summary'); if (summary) summary.focus({ preventScroll: true }); }
    });
    if (state.initialPage && state.status === 'ready') body.scrollTop = body.scrollHeight;
    else if (anchor) restoreWorkerAnchor(body, anchor);
    else body.scrollTop = oldTop;
    if (wasFocused) body.focus({ preventScroll: true });
  }
  if (body) store.set({ splitViewWorkerConversation: Object.assign({}, state, { renderedMessages: state.messages, prepend: false,
    initialPage: state.status === 'ready' ? false : state.initialPage }) });
  if (footer) {
    footer.textContent = "Read-only conversation";
    if (state.status === "error") { var status = document.createElement('span'); status.setAttribute('role', 'status'); status.textContent = state.error || "Conversation is unavailable."; footer.appendChild(status); }
    var status = document.createElement('span'); status.className = 'split-view-worker-page-status'; status.setAttribute('role', 'status');
    status.textContent = state.inFlight ? (state.messages.length ? 'Loading earlier messages…' : 'Loading conversation…') : state.hasMore ? 'Scroll up for earlier messages' : state.messages.length ? 'Beginning of conversation' : '';
    footer.appendChild(status);
    if (state.status === 'error') {
      var retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry loading conversation';
      retry.addEventListener('click', function () { var current = store.get('splitViewWorkerConversation'); if (current) requestPage(current, current.requestedBefore, current.messages.length > 0); });
      footer.appendChild(retry);
    }
  }
  if (footerFocused) { var nextFocus = footer.querySelector('button') || body; if (nextFocus) nextFocus.focus({ preventScroll: true }); }
  refreshIcons();
  scheduleWorkerFill(body);
}
function loadEarlier(body, intentional) {
  var state = store.get('splitViewWorkerConversation');
  if (!shouldLoadWorkerPage(state, body, intentional)) return;
  requestPage(state, state.nextBefore, true);
}
function scheduleWorkerFill(body) {
  var state = store.get('splitViewWorkerConversation');
  if (!shouldLoadWorkerPage(state, body, false) || state.fillTimer) return;
  var requestId = state.requestId;
  var timer = setTimeout(function () {
    var current = store.get('splitViewWorkerConversation');
    if (!current || current.requestId !== requestId || current.fillTimer !== timer || !body.isConnected) return;
    store.set({ splitViewWorkerConversation: Object.assign({}, current, { fillTimer: null }) });
    loadEarlier(body, false);
  }, 120);
  store.set({ splitViewWorkerConversation: Object.assign({}, state, { fillTimer: timer }) });
}
function anchorChip(state) {
  if (!state) return null;
  return document.querySelector('.split-pane[data-session-origin="' + CSS.escape(state.driverOriginId) + '"] [data-worker-origin="' + CSS.escape(state.workerOriginId) + '"]');
}
function reanchorPopover() {
  var state = store.get('splitViewWorkerConversation');
  if (state) position(popover(), anchorChip(state));
}
export function handleSplitWorkerConversation(message) {
  var state = store.get('splitViewWorkerConversation');
  if (!state || !store.get('connected') || !message || message.type !== "split_worker_conversation" || state.socket !== getWs() || state.projectSlug !== store.get('currentSlug') ||
      state.ownerId !== (store.get('myUserId') || null) || state.socketGeneration !== (store.get('projectSplitViewSocketGeneration') || 0) || message.requestId !== state.requestId ||
      message.parentSessionOriginId !== state.driverOriginId || message.workerSessionOriginId !== state.workerOriginId || message.generation !== state.generation) return false;
  var driver = exactDriver(state.driverOriginId), sourcePane = document.querySelector('.split-pane[data-session-origin="' + CSS.escape(state.driverOriginId) + '"]');
  var source = presentationSource(sourcePane, driver);
  if (!exactWorker(driver, state.workerOriginId, state.generation) || !source || !state.sourceBinding || !samePaneBinding(source.live.binding, state.sourceBinding)) { close(false); return true; }
  if (!state.inFlight || state.status !== 'loading' || !Object.prototype.hasOwnProperty.call(message, 'pageBefore') || workerCursorKey(message.pageBefore) !== workerCursorKey(state.requestedBefore)) return false;
  clearTimeout(state.requestTimer);
  var error = message.error || null;
  if (!error && (!Array.isArray(message.messages) || message.hasMore && !workerCursorAdvances(state.requestedBefore, message.nextBefore))) error = 'Worker history page did not advance. Retry loading conversation.';
  var incoming = error ? [] : message.messages;
  var messages = error ? state.messages : state.append ? incoming.concat(state.messages || []) : incoming.slice();
  store.set({ splitViewWorkerConversation: Object.assign({}, state, { status: error ? 'error' : 'ready', error: error,
    messages: messages, inFlight: false, requestTimer: null, hasMore: error ? state.hasMore : message.hasMore === true,
    nextBefore: error ? state.nextBefore : message.nextBefore, prepend: !error && state.append, append: false }) });
  renderContent(); return true;
}
export function renderPaneWorkers(container, driver) {
  if (!container || !driver) return;
  var root = container.querySelector('.split-view-workers');
  var data = workersFor(driver);
  if (!root) { root = document.createElement("div"); root.className = "split-view-workers"; root.setAttribute("aria-label", "Worker conversations");
    var frame = container.querySelector('.split-pane-frame'); if (frame) container.insertBefore(root, frame); else container.appendChild(root); }
  var source = presentationSource(container, driver);
  root.hidden = !source || data.items.length === 0;
  if (!source) { if (store.get('splitViewWorkerConversation') && store.get('splitViewWorkerConversation').driverOriginId === driver.sessionOriginId) close(false); return; }
  root.textContent = "";
  data.items.forEach(function (worker) {
    var button = document.createElement("button"); button.type = "button"; button.className = "split-view-worker-chip";
    button.dataset.workerOrigin = worker.sessionOriginId; button.dataset.workerGeneration = String(worker.workerGeneration);
    var current = data.currentIds.has(worker.id);
    var modelLabel = worker.model || "Default model";
    button.title = (VENDOR_NAMES[worker.vendor] || worker.vendor || "Unknown vendor") + " · " + modelLabel + " · Split Worker #" + worker.id +
      (current ? "" : " · Archived · Gen " + worker.workerGeneration) + " · " + (worker.title || "Worker");
    button.setAttribute("aria-label", button.title + " conversation");
    var dot = document.createElement("span"); dot.className = "split-view-worker-dot"; dot.dataset.state = current && worker.isProcessing ? "working" : "ready";
    if (VENDOR_AVATARS[worker.vendor]) {
      var vendorIcon = document.createElement("img"); vendorIcon.className = "split-view-worker-vendor";
      vendorIcon.src = VENDOR_AVATARS[worker.vendor]; vendorIcon.alt = ""; vendorIcon.setAttribute("aria-hidden", "true"); button.appendChild(vendorIcon);
    }
    var name = document.createElement("span"); name.className = "split-view-worker-name"; name.textContent = modelLabel; button.appendChild(name);
    var identity = document.createElement("span"); identity.className = "split-view-worker-identity";
    identity.textContent = "Split Worker #" + worker.id; button.appendChild(identity);
    if (!current) {
      var generation = document.createElement("span"); generation.className = "split-view-worker-generation";
      generation.textContent = "Gen " + worker.workerGeneration; button.appendChild(generation);
    }
    button.appendChild(dot);
    var state = store.get('splitViewWorkerConversation');
    button.setAttribute("aria-expanded", state && state.driverOriginId === driver.sessionOriginId && state.workerOriginId === worker.sessionOriginId ? "true" : "false");
    button.addEventListener("click", function () { if (presentationSource(container, exactDriver(driver.sessionOriginId))) open(button, driver, worker); }); root.appendChild(button);
  });
  var activeView = (store.get('projectSplitViews') || []).find(function (view) { return view.id === store.get('projectSplitViewActiveId'); });
  var group = configuredGroup(driver);
  if ((activeView && activeView.sessions.some(function (session) { return session.sessionOriginId === driver.sessionOriginId; }) || source.singleton) && group) {
    var controls = document.createElement('button'); controls.type = 'button'; controls.className = 'split-view-worker-controls';
    controls.textContent = 'Controls'; controls.setAttribute('aria-label', 'Open Worker controls for ' + (driver.title || 'Driver session'));
    controls.dataset.driverOrigin = driver.sessionOriginId; controls.dataset.groupId = String(group.id);
    controls.addEventListener('click', function (event) {
      event.preventDefault(); event.stopPropagation();
      var frame = container.querySelector('.split-pane-frame'), live = frame && frame.clayPane && frame.clayPane.identity();
      var currentSource = presentationSource(container, exactDriver(driver.sessionOriginId));
      if (!frame || !live || !live.ready || !currentSource || !frame.isConnected || frame.dataset.sessionOriginId !== driver.sessionOriginId ||
          Number(frame.dataset.sessionId) !== driver.id || live.sessionId !== driver.id || live.binding.sessionOriginId !== driver.sessionOriginId ||
          frame.dataset.projectSlug !== store.get('currentSlug') || configuredGroup(exactDriver(driver.sessionOriginId)) !== group) return;
      document.dispatchEvent(new CustomEvent('clay-split-view-open-worker-controls', { detail: {
        driverOriginId: driver.sessionOriginId, driverId: driver.id, groupId: group.id, projectSlug: store.get('currentSlug'),
        ownerId: driver.ownerId || null, workerOrigins: group.members.map(function (id) {
          var member = sessions().find(function (session) { return session.id === id; }); return member && member.sessionRole === 'worker' ? member.sessionOriginId : null;
        })
      } }));
    });
    root.appendChild(controls);
  }
  var conversation = store.get('splitViewWorkerConversation');
  if (conversation && !presentationSource(document.querySelector('.split-pane[data-session-origin="' + CSS.escape(conversation.driverOriginId) + '"]'), exactDriver(conversation.driverOriginId))) close(false);
}
document.addEventListener("keydown", function (event) { if (event.key === "Escape" && store.get('splitViewWorkerConversation')) { event.preventDefault(); event.stopImmediatePropagation(); close(true); } }, true);
document.addEventListener("click", function (event) {
  if (!store.get('splitViewWorkerConversation')) return;
  var element = popover(); if (element && element.contains(event.target)) return;
  if (event.target.closest && event.target.closest('.split-view-worker-chip')) return;
  var interactive = event.target.closest && event.target.closest('button, a, input, textarea, select, [contenteditable="true"], [tabindex]:not([tabindex="-1"])');
  close(!interactive);
}, true);
window.addEventListener("resize", reanchorPopover);
window.addEventListener("scroll", function (event) {
  var element = popover();
  if (element && event.target && (event.target === element || event.target.nodeType && element.contains(event.target))) return;
  reanchorPopover();
}, true);
store.subscribe(function (state, previous) {
  if (state.splitViewWorkerConversation && (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId ||
      state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration)) {
    close(false);
    return;
  }
  if (state.splitViewWorkerConversation && (state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.projectSplitViews !== previous.projectSplitViews ||
      state.projectSplitViewSingletonOrigin !== previous.projectSplitViewSingletonOrigin || state.splitPanes !== previous.splitPanes ||
      state.projectSplitViewFocusedOrigin !== previous.projectSplitViewFocusedOrigin || state.paneBindingSessions !== previous.paneBindingSessions)) {
    if (state.projectSplitViewActiveId !== previous.projectSplitViewActiveId || state.projectSplitViewFocusedOrigin !== previous.projectSplitViewFocusedOrigin ||
        state.paneBindingSessions !== previous.paneBindingSessions) ensurePopover();
    else renderContent();
  }
  if (state.connected !== previous.connected && state.connected === false) {
    var conversation = state.splitViewWorkerConversation;
    if (conversation) {
      if (conversation.requestTimer) clearTimeout(conversation.requestTimer);
      if (conversation.fillTimer) clearTimeout(conversation.fillTimer);
      store.set({ splitViewWorkerConversation: Object.assign({}, conversation, { status: "error", error: "Worker conversation connection was lost.", inFlight: false, append: false }) });
      renderContent();
    }
  }
});
