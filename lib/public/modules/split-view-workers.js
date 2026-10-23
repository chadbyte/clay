import { appendWorkerStopControls, syncWorkerForceStop } from './worker-stop-controls.js';
import { syncWorkerMessagePreviews } from './worker-message-previews.js';
import { appendWorkerRemoval, reconcileWorkerRemoval } from './split-view-worker-removal.js';
import { workerCursorKey, workerCursorAdvances, shouldLoadWorkerPage, captureWorkerAnchor, restoreWorkerAnchor } from './split-view-worker-scroll.js';
import { appendWorkerTranscript } from './split-view-worker-transcript.js';
import { captureWorkerDisclosures, restoreWorkerDisclosures } from './split-view-worker-activity.js';
// Read-only Worker conversation chips attached to a Driver's presentation pane.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { iconHtml, refreshIcons } from './icons.js';
import { splitGroupRoles } from './split-group-helpers.js';
import { livePaneBinding, samePaneBinding, paneTarget, samePaneTarget } from './pane-binding.js';
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
function presentationSource(container, driver, connectionErrorBinding) {
  var frame = container && container.querySelector('.split-pane-frame'), live = frame && frame.clayPane && frame.clayPane.identity();
  // A read-only connection error may outlive the child's committed binding.
  // Validate the recorded source against current metadata and the attached
  // document, without granting it action authority or accepting new replies.
  var unavailable = connectionErrorBinding && !store.get('connected') && container && !container.hidden && driver &&
    frame && frame.clayPane && frame.clayPane.source === frame.contentWindow && frame.clayPane.document === frame.contentDocument &&
    samePaneTarget(connectionErrorBinding, paneTarget(store.snap(), sessions(), driver.id));
  var binding = unavailable ? connectionErrorBinding : live && live.binding;
  if (!driver || !frame || !binding || (!unavailable && (!live || !live.ready || !livePaneBinding(frame) ||
      live.sessionId !== driver.id || live.ownerId !== (store.get('myUserId') || null) || live.projectSlug !== store.get('currentSlug'))) ||
      frame.dataset.sessionId !== String(driver.id) || frame.dataset.sessionOriginId !== driver.sessionOriginId ||
      binding.sessionOriginId !== driver.sessionOriginId) return null;
  var view = (store.get('projectSplitViews') || []).find(function (item) { return item.id === store.get('projectSplitViewActiveId'); });
  var inView = !!(view && view.sessions.some(function (session) { return session.id === driver.id && session.sessionOriginId === driver.sessionOriginId; }));
  var inSingleton = !view && store.get('projectSplitViewSingletonOrigin') === driver.sessionOriginId;
  return inView || inSingleton ? { frame: frame, live: live, binding: binding, view: view, singleton: inSingleton } : null;
}
export function workerRemovalTarget(container, driverOrigin, workerOrigin, generation, stopping) {
  var driver = exactDriver(driverOrigin), worker = exactWorker(driver, workerOrigin, generation);
  var source = presentationSource(container, driver);
  if (!worker || worker.hidden || !driver || driver.hidden || (driver.ownerId || null) !== (store.get('myUserId') || null) ||
      document.hidden || !source || !store.get('connected') || !container.isConnected || container.hidden || container.inert ||
      source.frame.hidden || source.frame.inert || !stopping && store.get('permissions') && store.get('permissions').sessionDelete === false) return null;
  return { projectSlug: store.get('currentSlug'), ownerId: store.get('myUserId') || null, driverId: driver.id,
    driverOriginId: driverOrigin, workerId: worker.id, workerOriginId: workerOrigin, generation: generation, forceTermination: worker.forceTermination,
    bindingGeneration: source.binding.generation, bindingRequestId: source.binding.requestId,
    viewRevision: store.get('projectSplitViewRevision'), socketGeneration: store.get('projectSplitViewSocketGeneration') };
}
// One introduction per Driver in this page, independent of transcript refreshes.
export function showCreatedWorkerViewer(group) {
  var state = store.snap(), roles = splitGroupRoles(group);
  if (!roles || state.paneMode || state.dmMode || state.replayingHistory || !state.connected ||
      state.activeSessionId !== roles.driverId || document.hidden) return;
  var workerId = roles.workerIds[roles.workerIds.length - 1];
  var worker = sessions().find(function (item) { return item.id === workerId; });
  var anchors = group.pairAnchors, anchor = anchors && (anchors.workers || [anchors.worker])[roles.workerIds.length - 1];
  var origin = worker && worker.sessionOriginId || anchor && anchor.origin;
  if (!origin) return;
  var driverIdentity = sessions().find(function (item) { return item.id === roles.driverId; });
  var driverOrigin = driverIdentity && driverIdentity.sessionOriginId || anchors && anchors.driver && anchors.driver.origin;
  if (!driverOrigin) return;
  var key = JSON.stringify([state.myUserId, state.currentSlug, driverOrigin]);
  var seen = state.introducedWorkerDrivers || [];
  if (seen.indexOf(key) >= 0) return;
  store.set({ introducedWorkerDrivers: seen.concat(key).slice(-64) });
  if (state.createdWorkerViewer || state.splitViewWorkerConversation) return;
  store.set({ createdWorkerViewer: { driverId: roles.driverId, driverOrigin: driverOrigin, workerId: workerId, workerOrigin: origin,
    generation: worker ? worker.workerGeneration : null,
    ownerId: state.myUserId, slug: state.currentSlug, socketGeneration: state.projectSplitViewSocketGeneration } });
  var driver = sessions().find(function (item) { return item.id === roles.driverId; });
  var pane = driver && document.querySelector('.split-pane[data-session-origin="' + CSS.escape(driver.sessionOriginId) + '"]');
  if (pane) renderPaneWorkers(pane, driver);
}
function introduceWorkerViewer(container, driver) {
  var pending = store.get('createdWorkerViewer'), state = store.snap();
  if (!pending || pending.driverId !== driver.id) return;
  var worker = sessions().find(function (item) { return item.id === pending.workerId; });
  if (!worker) return;
  store.set({ createdWorkerViewer: null });
  var group = (state.splitGroups || []).find(function (item) {
    var roles = splitGroupRoles(item);
    return roles && roles.driverId === driver.id && roles.workerIds.indexOf(worker.id) >= 0;
  });
  if (!group || driver.sessionOriginId !== pending.driverOrigin || worker.sessionOriginId !== pending.workerOrigin || pending.generation !== null && worker.workerGeneration !== pending.generation ||
      state.splitViewWorkerConversation || document.hidden || !container.isConnected || container.hidden || container.inert ||
      driver.hidden || worker.hidden || exactWorker(driver, worker.sessionOriginId, worker.workerGeneration) !== worker) return;
  var chip = Array.from(container.querySelectorAll('.split-view-worker-chip')).find(function (item) { return item.dataset.workerOrigin === worker.sessionOriginId; });
  if (chip) open(chip, driver, worker, false);
}
function syncWorkerSelection() {
  var state = store.get('splitViewWorkerConversation');
  document.querySelectorAll('.split-view-worker-chip').forEach(function (chip) {
    chip.setAttribute('aria-expanded', String(!!state && chip.dataset.workerOrigin === state.workerOriginId &&
      chip.dataset.workerGeneration === String(state.generation)));
  });
}
function popover() { return document.getElementById("split-view-worker-popover"); }
function close(returnFocus) {
  var state = store.get('splitViewWorkerConversation');
  if (!state) return;
  var socket = getWs();
  if (state.subscriptionId && socket && socket === state.socket && socket.readyState === 1) {
    try { socket.send(JSON.stringify({ type: 'split_worker_conversation_request', watch: false,
      requestId: state.subscriptionId, parentSessionOriginId: state.driverOriginId,
      workerSessionOriginId: state.workerOriginId, generation: state.generation })); } catch (_error) {}
  }
  if (state.requestTimer) clearTimeout(state.requestTimer);
  store.set({ splitViewWorkerConversation: null });
  syncWorkerSelection();
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
function requestPage(state, before, append, refresh) {
  var current = store.get('splitViewWorkerConversation');
  if (!state || !current || state.requestId !== current.requestId || current.inFlight || workerCursorKey(before) === null || !ensurePopover()) return;
  state = store.get('splitViewWorkerConversation');
  if (append && workerCursorKey(before) !== workerCursorKey(state.nextBefore)) return;
  var ws = getWs();
  if (!store.get('connected') || !ws || ws.readyState !== 1) {
    store.set({ splitViewWorkerConversation: Object.assign({}, state, { status: "error", error: "Worker conversation is unavailable while disconnected.", append: false }) });
    renderContent(); return;
  }
  var requestId = "worker-read-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  var subscribe = !state.subscriptionId || !state.subscriptionConfirmed;
  var pending = Object.assign({}, state, { subscriptionId: subscribe ? requestId : state.subscriptionId, requestId: requestId, socket: ws, projectSlug: store.get('currentSlug'), ownerId: store.get('myUserId') || null,
    socketGeneration: store.get('projectSplitViewSocketGeneration') || 0, status: "loading", error: null, inFlight: true, requestedBefore: before == null ? null : before, append: append === true, refreshing: refresh === true, refreshPending: false });
  pending.requestTimer = setTimeout(function () {
    var current = store.get('splitViewWorkerConversation');
    if (!current || current.requestId !== requestId || !current.inFlight) return;
    store.set({ splitViewWorkerConversation: Object.assign({}, current, { status: 'error', inFlight: false, append: false,
      requestTimer: null, error: 'Worker conversation request timed out. Scroll up or retry to load it again.' }) });
    renderContent();
  }, 15000);
  store.set({ splitViewWorkerConversation: pending }); renderContent();
  var last = refresh && state.messages[state.messages.length - 1];
  var after = last && Number.isInteger(last.recordIndex) && Number.isInteger(last.end) ? { index: last.recordIndex, offset: last.end } : undefined;
  try {
    ws.send(JSON.stringify({ type: "split_worker_conversation_request", requestId: requestId,
      parentSessionOriginId: state.driverOriginId, workerSessionOriginId: state.workerOriginId,
      generation: state.generation, before: before, after: after, watch: subscribe ? true : undefined }));
  } catch (_error) {
    var current = store.get('splitViewWorkerConversation');
    if (current && current.requestId === requestId) {
      clearTimeout(current.requestTimer);
      store.set({ splitViewWorkerConversation: Object.assign({}, current, { status: "error", error: "Worker conversation request could not be sent.", inFlight: false, append: false }) });
      renderContent();
    }
  }
}
function open(chip, driver, worker, takeFocus) {
  var existing = store.get('splitViewWorkerConversation');
  if (existing && existing.driverOriginId === driver.sessionOriginId && existing.workerOriginId === worker.sessionOriginId && existing.generation === worker.workerGeneration) { close(true); return; }
  if (existing) close(false);
  var state = { requestId: null, driverOriginId: driver.sessionOriginId, workerOriginId: worker.sessionOriginId,
    generation: worker.workerGeneration, workerVendor: worker.vendor, driverTitle: driver.title || "Driver session", workerTitle: worker.title || "Worker",
    sourceBinding: chip.closest('.split-pane').querySelector('.split-pane-frame').clayPane.identity().binding,
    status: "loading", messages: [], hasMore: false, nextBefore: null, append: false, inFlight: false, initialPage: true };
  store.set({ splitViewWorkerConversation: state }); ensurePopover(); renderContent();
  var element = popover(); position(element, chip);
  requestPage(state, undefined, false);
  syncWorkerSelection();
  var closeButton = element && element.querySelector('[aria-label="Close Worker conversation"]'); if (closeButton && takeFocus !== false) closeButton.focus();
}
function ensurePopover() {
  var state = store.get('splitViewWorkerConversation');
  var element = popover();
  if (!state) { if (element) element.remove(); return; }
  var driver = exactDriver(state.driverOriginId), worker = exactWorker(driver, state.workerOriginId, state.generation);
  var sourcePane = document.querySelector('.split-pane[data-session-origin="' + CSS.escape(state.driverOriginId) + '"]');
  var source = presentationSource(sourcePane, driver, state.status === 'error' && state.sourceBinding);
  if (!driver || !worker || !source || sourcePane.hidden || !state.sourceBinding || !samePaneBinding(source.binding || source.live && source.live.binding, state.sourceBinding) ||
      source.view && store.get('projectSplitViewFocusedOrigin') && store.get('projectSplitViewFocusedOrigin') !== state.driverOriginId) {
    close(false); return;
  }
  if (!element) {
    element = document.createElement("section"); element.id = "split-view-worker-popover"; element.className = "split-view-worker-popover";
    element.setAttribute("role", "dialog"); element.setAttribute("aria-label", "Read-only Worker conversation"); document.body.appendChild(element);
    var header = document.createElement("header"); header.className = "split-view-worker-popover-header";
    var title = document.createElement("strong"); title.className = "worker-popover-title"; header.appendChild(title);
    appendWorkerStopControls(header, function () {
      var state = store.get('splitViewWorkerConversation');
      if (!state || state.status === 'error') return null;
      var pane = document.querySelector('.split-pane[data-session-origin="' + CSS.escape(state.driverOriginId) + '"]');
      return workerRemovalTarget(pane, state.driverOriginId, state.workerOriginId, state.generation, true);
    });
    var closeButton = document.createElement("button"); closeButton.type = "button"; closeButton.setAttribute("aria-label", "Close Worker conversation"); closeButton.innerHTML = iconHtml("x");
    closeButton.addEventListener("click", function () { close(true); }); header.appendChild(closeButton); element.appendChild(header);
    var source = document.createElement("div"); source.className = "split-view-worker-popover-source"; element.appendChild(source);
    var body = document.createElement("div"); body.className = "split-view-worker-popover-body readonly-session-transcript"; body.tabIndex = 0; body.setAttribute("aria-label", "Read-only Worker transcript"); element.appendChild(body);
    body.addEventListener('scroll', function () {
      var state = store.get('splitViewWorkerConversation');
      if (!state) return;
      var upward = body.scrollTop < state.scrollTop;
      store.set({ splitViewWorkerConversation: Object.assign({}, state, { scrollTop: body.scrollTop }) });
      if (upward && state.scrollIntentUntil > Date.now()) loadEarlier(body, true);
    }, { passive: true });
    function scrollIntent() {
      var state = store.get('splitViewWorkerConversation');
      if (state) store.set({ splitViewWorkerConversation: Object.assign({}, state, { scrollIntentUntil: Date.now() + 1500 }) });
    }
    body.addEventListener('wheel', function (event) { if (event.deltaY < 0) { scrollIntent(); loadEarlier(body, true); } }, { passive: true });
    body.addEventListener('keydown', function (event) {
      if (['ArrowUp', 'PageUp', 'Home'].indexOf(event.key) >= 0 || event.key === ' ' && event.shiftKey) scrollIntent();
    });
    body.addEventListener('pointerdown', function (event) { if (event.target === body) scrollIntent(); }, { passive: true });
    body.addEventListener('touchstart', scrollIntent, { passive: true });
    var footer = document.createElement("footer"); footer.className = "split-view-worker-popover-footer"; element.appendChild(footer);
  }
  syncWorkerForceStop(element, worker);
  var stopButtons = element.querySelectorAll('.worker-conversation-stop');
  for (var i = 0; i < stopButtons.length; i++) stopButtons[i].disabled = stopButtons[i].dataset.workerForceStop === 'true' && stopButtons[i].disabled || !store.get('connected') || state.status === 'error';
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
    var disclosures = captureWorkerDisclosures(body);
    var followTail = body.scrollHeight - body.clientHeight - body.scrollTop < 48;
    var oldTop = body.scrollTop, wasFocused = document.activeElement === body;
    body.textContent = "";
    if (state.status === "loading" && !state.messages.length) body.textContent = "Loading conversation…";
    else if (state.status === "error" && !state.messages.length) body.textContent = state.error || "Conversation is unavailable.";
    else if (!state.messages.length) body.textContent = "No recorded conversation.";
    appendWorkerTranscript(body, state.messages, { vendor: state.workerVendor, assistantName: state.workerTitle });
    restoreWorkerDisclosures(body, disclosures);
    if ((state.initialPage || state.liveRefresh && followTail) && state.status === 'ready') body.scrollTop = body.scrollHeight;
    else if (anchor) restoreWorkerAnchor(body, anchor);
    else body.scrollTop = oldTop;
    if (wasFocused) body.focus({ preventScroll: true });
  }
  if (body) store.set({ splitViewWorkerConversation: Object.assign({}, state, { renderedMessages: state.messages, scrollTop: body.scrollTop, scrollIntentUntil: 0, prepend: false, liveRefresh: false,
    initialPage: state.status === 'ready' ? false : state.initialPage }) });
  if (footer) {
    footer.textContent = state.status === 'error' ? 'Read-only conversation' : state.refreshing ? 'Updating live conversation…' : state.subscriptionConfirmed ? 'Read-only · Live updates' : 'Read-only conversation';
    if (state.status === "error") { var status = document.createElement('span'); status.setAttribute('role', 'status'); status.textContent = state.error || "Conversation is unavailable."; footer.appendChild(status); }
    var status = document.createElement('span'); status.className = 'split-view-worker-page-status'; status.setAttribute('role', 'status');
    status.textContent = state.inFlight ? (state.refreshing ? 'Receiving Worker activity…' : state.messages.length ? 'Loading earlier messages…' : 'Loading conversation…') : state.hasMore ? 'Scroll up for earlier messages' : state.messages.length ? 'Beginning of conversation' : '';
    footer.appendChild(status);
    if (state.status === 'error') {
      var retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry loading conversation';
      retry.addEventListener('click', function () { var current = store.get('splitViewWorkerConversation'); if (current) requestPage(current, current.requestedBefore, current.messages.length > 0); });
      footer.appendChild(retry);
    }
  }
  if (footerFocused) { var nextFocus = footer.querySelector('button') || body; if (nextFocus) nextFocus.focus({ preventScroll: true }); }
  refreshIcons();

}
function loadEarlier(body, intentional) {
  var state = store.get('splitViewWorkerConversation');
  if (!shouldLoadWorkerPage(state, body, intentional)) return;
  requestPage(state, state.nextBefore, true);
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
  if (!error && state.refreshing && incoming.length) {
    var first = incoming[0];
    messages = state.messages.filter(function (item) {
      return item.recordIndex < first.recordIndex || item.recordIndex === first.recordIndex && item.end <= first.start;
    }).concat(incoming);
  }
  if (!error && state.refreshing && !incoming.length) messages = state.messages;
  var refreshAgain = state.refreshPending || message.moreRecent === true;
  store.set({ splitViewWorkerConversation: Object.assign({}, state, { status: error ? 'error' : 'ready', error: error,
    messages: messages, subscriptionConfirmed: !error || state.subscriptionConfirmed, inFlight: false, requestTimer: null, nextBefore: error || state.refreshing && state.messages.length ? state.nextBefore : message.nextBefore,
    hasMore: error || state.refreshing && state.messages.length ? state.hasMore : message.hasMore === true,
    liveRefresh: !error && state.refreshing, refreshing: false, refreshPending: false, prepend: !error && state.append, append: false }) });
  renderContent();
  if (refreshAgain && !error) refreshWorkerConversation();
  return true;
}
function refreshWorkerConversation() {
  var state = store.get('splitViewWorkerConversation');
  if (!state || !store.get('connected') || !ensurePopover()) return;
  if (state.inFlight) {
    if (!state.refreshPending) store.set({ splitViewWorkerConversation: Object.assign({}, state, { refreshPending: true }) });
    return;
  }
  requestPage(state, undefined, false, true);
}
export function handleWorkerConversationChanged(message) {
  var state = store.get('splitViewWorkerConversation');
  if (!state || !store.get('connected') || state.socket !== getWs() || state.projectSlug !== store.get('currentSlug') ||
      state.ownerId !== (store.get('myUserId') || null) || state.socketGeneration !== (store.get('projectSplitViewSocketGeneration') || 0) ||
      message.subscriptionId !== state.subscriptionId || message.parentSessionOriginId !== state.driverOriginId ||
      message.workerSessionOriginId !== state.workerOriginId || message.generation !== state.generation || !ensurePopover()) return false;
  document.querySelectorAll('.split-view-worker-chip').forEach(function (chip) {
    if (chip.dataset.workerOrigin === state.workerOriginId) {
      var dot = chip.querySelector('.split-view-worker-dot');
      if (dot) dot.dataset.state = message.isProcessing ? 'working' : 'ready';
    }
  });
  refreshWorkerConversation();
  return true;
}
export function handleWorkerSessionActivity(message) {
  var worker = sessions().find(function (item) { return item.id === message.id && item.sessionRole === 'worker'; });
  if (!worker || !store.get('connected')) return;
  document.querySelectorAll('.split-view-worker-chip').forEach(function (chip) {
    if (chip.dataset.workerOrigin !== worker.sessionOriginId) return;
    var dot = chip.querySelector('.split-view-worker-dot');
    if (dot) { dot.dataset.state = 'working'; dot.setAttribute('aria-label', 'Worker activity received'); }
  });
  var state = store.get('splitViewWorkerConversation');
  if (state && state.workerOriginId === worker.sessionOriginId && state.generation === worker.workerGeneration) refreshWorkerConversation();
}
export function renderPaneWorkers(container, driver) {
  if (!container || !driver) return;
  reconcileWorkerRemoval(container);
  var root = container.querySelector('.split-view-workers');
  var data = workersFor(driver);
  if (!root) { root = document.createElement("div"); root.className = "split-view-workers"; root.setAttribute("aria-label", "Worker conversations");
    var frame = container.querySelector('.split-pane-frame'); if (frame) container.insertBefore(root, frame); else container.appendChild(root); }
  var source = presentationSource(container, driver);
  root.hidden = !source || data.items.length === 0;
  if (!source) { if (store.get('splitViewWorkerConversation') && store.get('splitViewWorkerConversation').driverOriginId === driver.sessionOriginId) ensurePopover(); return; }
  root.textContent = "";
  data.items.forEach(function (worker) {
    var pill = document.createElement("span"); pill.className = "split-view-worker-pill";
    var button = document.createElement("button"); button.type = "button"; button.className = "split-view-worker-chip";
    button.dataset.workerParent = driver.sessionOriginId; button.dataset.workerOrigin = worker.sessionOriginId; button.dataset.workerGeneration = String(worker.workerGeneration);
    var current = data.currentIds.has(worker.id);
    var modelLabel = worker.model || "Default model";
    button.title = (VENDOR_NAMES[worker.vendor] || worker.vendor || "Unknown vendor") + " · " + modelLabel + " · Split Worker #" + worker.id +
      (current ? "" : " · Archived · Gen " + worker.workerGeneration) + " · " + (worker.title || "Worker");
    button.setAttribute("aria-label", button.title + " conversation");
    var dot = document.createElement("span"); dot.className = "split-view-worker-dot"; dot.dataset.state = !store.get('connected') ? 'disconnected' : worker.isProcessing ? 'working' : 'ready';
    dot.setAttribute('aria-label', !store.get('connected') ? 'Disconnected' : worker.isProcessing ? 'Worker is working' : 'Worker is idle');
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
    button.dataset.workerSessionId = String(worker.id);
    button.appendChild(dot);
    var state = store.get('splitViewWorkerConversation');
    button.setAttribute("aria-expanded", state && state.driverOriginId === driver.sessionOriginId && state.workerOriginId === worker.sessionOriginId ? "true" : "false");
    button.addEventListener("click", function () { if (presentationSource(container, exactDriver(driver.sessionOriginId))) open(button, driver, worker); }); pill.appendChild(button); root.appendChild(pill);
    appendWorkerRemoval(pill, button, container, driver, worker);
  });
  introduceWorkerViewer(container, driver);
  syncWorkerMessagePreviews();
  var conversation = store.get('splitViewWorkerConversation');
  if (conversation) ensurePopover();
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
  var introduction = state.createdWorkerViewer;
  if (introduction && (!state.connected || introduction.slug !== state.currentSlug || introduction.ownerId !== state.myUserId ||
      introduction.socketGeneration !== state.projectSplitViewSocketGeneration || introduction.driverId !== state.activeSessionId)) {
    store.set({ createdWorkerViewer: null });
  }
  if (state.paneBindingSessions !== previous.paneBindingSessions || state.connected !== previous.connected) {
    document.querySelectorAll('.split-view-worker-chip').forEach(function (chip) {
      var worker = sessions().find(function (item) { return item.sessionOriginId === chip.dataset.workerOrigin; });
      var dot = chip.querySelector('.split-view-worker-dot');
      if (dot) dot.dataset.state = !state.connected ? 'disconnected' : worker && worker.isProcessing ? 'working' : 'ready';
    });
    if (state.connected && state.splitViewWorkerConversation) refreshWorkerConversation();
  }
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
      store.set({ splitViewWorkerConversation: Object.assign({}, conversation, { status: "error", error: "Worker conversation connection was lost.", inFlight: false, append: false }) });
      renderContent();
    }
  }
});
