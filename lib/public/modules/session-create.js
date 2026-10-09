// Inline session creation for the project sidebar.
//
// Every real folder header (custom folders and Unfiled, not the Favorites tag) has a quiet
// "+ New session" button that opens one draft row directly under that header:
// provider icon, a compact provider picker and icon Cancel; the same header
// action that opened the draft becomes Create. Only the
// provider is chosen; the model and effort stay whatever that provider's
// existing defaults produce. The installed providers and the project default
// come from the server; the saved project default is preselected, and a
// default changes only through the explicit action beside an available
// provider. All mutable state lives in the store (sessionCreate,
// sessionCreateOptions, sessionCreateLocks, sessionCreateReveal); the DOM is
// built in session-create-form.js.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { resolvePreferredVendor } from './default-vendor.js';
import { sendFolderOp, currentFolderState } from './session-folders.js';
import { queueSidebarCreationEffect } from './sidebar-creation-effect.js';
import { isMateWorkspace } from './project-mate-navigation.js';

// Ids are unique without any module-level counter.
function nextId(prefix) {
  return prefix + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

var PENDING_TIMEOUT_MS = 30000;

function send(message) {
  var ws = getWs();
  if (!ws || !store.get('connected')) return false;
  try {
    ws.send(JSON.stringify(Object.assign({ slug: store.get('currentSlug') }, message)));
  } catch (e) {
    return false;
  }
  return true;
}

export function createState() {
  return store.get('sessionCreate') || null;
}

function patch(change) {
  var current = createState();
  if (current) store.set({ sessionCreate: Object.assign({}, current, change) });
}

export function createOptions() {
  return store.get('sessionCreateOptions') || { loaded: false, vendors: [], projectDefault: null, canSetProjectDefault: false, error: "", requestId: null };
}

export function installedVendorIds() {
  return createOptions().vendors.filter(function (v) { return v.installed; }).map(function (v) { return v.id; });
}

// --- Opening and closing ---

export function openSessionCreate(folderId) {
  var current = createState();
  // A creation in flight keeps its row: its outcome must always find it.
  if (current && current.phase === "pending") return;
  if (current && current.folderId === folderId) {
    patch({ wantFocus: true, focusKey: "vendor", scroll: true });
    return;
  }
  var options = createOptions();
  store.set({ sessionCreate: {
    mode: "provider", folderId: folderId, vendor: options.loaded ? preferredVendor(options) : "", phase: "ready", requestId: null, timer: null, error: "", notice: "",
    defaultRequestId: null, defaultSaving: false, defaultVendor: null, focusKey: "vendor", wantFocus: false, scroll: true, restoreFocusKey: null,
    openedAt: Date.now(),
  } });
  requestOptions();
}

export function beginSessionCreate(folderId) {
  if (!isMateWorkspace(store.snap())) {
    openSessionCreate(folderId);
    return true;
  }
  var current = createState();
  if (current && current.phase === "pending") return false;
  if (!current || current.mode !== "mate-direct" || current.folderId !== folderId) {
    store.set({ sessionCreate: {
      mode: "mate-direct", folderId: folderId, phase: "ready", requestId: null, timer: null,
      error: "", notice: "", focusKey: "retry", wantFocus: false, scroll: true, openedAt: Date.now(),
    } });
  }
  return submitMateSessionCreate();
}

export function closeSessionCreate() {
  var current = createState();
  if (!current || current.phase === "pending") return;
  store.set({ sessionCreate: null });
}

// --- Providers ---

function requestOptions() {
  var requestId = nextId("sco-");
  store.set({ sessionCreateOptions: Object.assign({}, createOptions(), { requestId: requestId, error: "" }) });
  if (!send({ type: "new_session_options_get", requestId: requestId })) {
    store.set({ sessionCreateOptions: Object.assign({}, createOptions(), { requestId: null, error: "Not connected. Reconnect to choose a provider." }) });
  }
}

export function retryOptions() {
  requestOptions();
}

function preferredVendor(options) {
  var installed = options.vendors.filter(function (v) { return v.installed; }).map(function (v) { return v.id; });
  if (options.projectDefault && installed.indexOf(options.projectDefault) !== -1) return options.projectDefault;
  return resolvePreferredVendor(installed) || "";
}

function handleOptions(msg) {
  var current = createOptions();
  // Only the newest outstanding request is accepted; anything older or
  // unsolicited is ignored.
  if (!msg.requestId || msg.requestId !== current.requestId) return;
  if (msg.slug && msg.slug !== store.get('currentSlug')) return;
  var next = Object.assign({}, current, {
    loaded: true, requestId: null, error: msg.error || "",
    vendors: Array.isArray(msg.vendors) ? msg.vendors : current.vendors,
    projectDefault: msg.projectDefault || null,
    canSetProjectDefault: msg.canSetProjectDefault === true,
  });
  store.set({ sessionCreateOptions: next });
  var form = createState();
  if (form && (!form.vendor || installedVendorIds().indexOf(form.vendor) === -1)) patch({ vendor: preferredVendor(next) });
}

export function chooseVendor(vendor) {
  var form = createState();
  if (!form || form.phase === "pending") return;
  if (installedVendorIds().indexOf(vendor) === -1) return;
  patch({ vendor: vendor, notice: "", error: "", menuOpen: false });
}

// The provider dropdown's open state and highlighted item live in the store.
export function setCreateMenu(open, index) {
  var form = createState();
  if (!form || form.phase === "pending") return;
  patch({ menuOpen: open === true, menuIndex: typeof index === "number" ? index : (form.menuIndex || 0), menuFocus: open === true });
}

// --- Create ---

var LOCKED_KEYS = ["lastVendor", "currentVendor", "currentModel", "currentModels", "vendorSelectionLocked", "sessionVendorBound"];
var MAX_LOCKS = 4;

// The composer state a creation overwrote optimistically, kept in the store so
// a failed creation can put it back. Bounded, and dropped on disconnect, close
// and project or DM switches.
function rememberLock(requestId, optimisticVendor) {
  var saved = { activeSessionId: store.get('activeSessionId'), optimisticVendor: optimisticVendor, values: {} };
  for (var i = 0; i < LOCKED_KEYS.length; i++) saved.values[LOCKED_KEYS[i]] = store.get(LOCKED_KEYS[i]);
  var locks = Object.assign({}, store.get('sessionCreateLocks') || {});
  var ids = Object.keys(locks);
  while (ids.length >= MAX_LOCKS) delete locks[ids.shift()];
  locks[requestId] = saved;
  store.set({ sessionCreateLocks: locks });
}

function forgetLock(requestId) {
  var locks = Object.assign({}, store.get('sessionCreateLocks') || {});
  if (!locks[requestId]) return null;
  var saved = locks[requestId];
  delete locks[requestId];
  store.set({ sessionCreateLocks: locks });
  return saved;
}

export function submitSessionCreate(startNewSession) {
  var form = createState();
  if (!form || form.phase === "pending") return false;
  if (!form.vendor || installedVendorIds().indexOf(form.vendor) === -1) {
    patch({ error: "Choose an installed provider first.", focusKey: "vendor", wantFocus: true });
    return false;
  }
  var requestId = nextId("scn-");
  var extra = { forceNew: true, requestId: requestId, folderSlug: store.get('currentSlug'), folderId: form.folderId === "unfiled" ? null : form.folderId };
  rememberLock(requestId, form.vendor);
  var timer = setTimeout(function () { onPendingTimeout(requestId); }, PENDING_TIMEOUT_MS);
  patch({ phase: "pending", requestId: requestId, error: "", notice: "", timer: timer });
  if (!startNewSession(form.vendor, extra)) {
    clearTimeout(timer);
    forgetLock(requestId);
    patch({ phase: "ready", requestId: null, timer: null, error: "Not connected. Reconnect and try again." });
    return false;
  }
  return true;
}

export function submitMateSessionCreate() {
  var form = createState();
  if (!form || form.mode !== "mate-direct" || form.phase === "pending" || form.phase === "uncertain") return false;
  var requestId = nextId("scm-");
  var timer = setTimeout(function () { onPendingTimeout(requestId); }, PENDING_TIMEOUT_MS);
  patch({ phase: "pending", requestId: requestId, error: "", notice: "", timer: timer, wantFocus: false });
  if (!send({
    type: "new_session",
    mateDefaults: true,
    forceNew: true,
    requestId: requestId,
    folderSlug: store.get('currentSlug'),
    folderId: form.folderId === "unfiled" ? null : form.folderId,
  })) {
    clearTimeout(timer);
    patch({ phase: "ready", requestId: null, timer: null, error: "Not connected. Reconnect and try again.", focusKey: "retry", wantFocus: true });
    return false;
  }
  return true;
}

function onPendingTimeout(requestId) {
  var form = createState();
  if (!form || form.requestId !== requestId || form.phase !== "pending") return;
  forgetLock(requestId);
  if (form.mode === "mate-direct") {
    patch({ phase: "uncertain", timer: null, error: "No response yet. The session may already have been created; check the list before trying again." });
    return;
  }
  patch({ phase: "ready", requestId: null, timer: null, error: "No response yet. The session may already have been created; check the list first." });
}

// Puts the composer back only while it still reflects this creation; if the
// user has since moved to another session, that session's state wins.
function restoreLock(requestId) {
  var saved = forgetLock(requestId);
  if (!saved) return;
  if (store.get('activeSessionId') !== saved.activeSessionId || store.get('currentVendor') !== saved.optimisticVendor) return;
  store.set(saved.values);
}

export function handleNewSessionResult(msg) {
  var form = createState();
  if (!form || !msg.requestId || msg.requestId !== form.requestId) return false;
  clearTimeout(form.timer);
  if (!msg.ok) {
    restoreLock(msg.requestId);
    patch({ phase: "ready", requestId: null, timer: null, error: msg.error || "The session could not be created.", focusKey: form.mode === "mate-direct" ? "retry" : "create", wantFocus: true });
    return true;
  }
  forgetLock(msg.requestId);
  // When filing failed the session really is in Unfiled, so that is what to reveal.
  var destination = msg.folderPlaced === false ? "unfiled" : (msg.folderId || form.folderId || "unfiled");
  if (msg.folderPlaced === false) showToast("The session was created but could not be filed in that folder. It is in Unfiled.", "warn");
  store.set({ sessionCreate: null });
  queueSidebarCreationEffect('session', msg.requestId, msg.sessionId, destination);
  revealCreatedSession(destination, msg.sessionId);
  return true;
}

// --- Revealing the new session ---

// Called for every project-sidebar creation (including ones without a folder,
// such as the /clear command): the destination is expanded and the new session
// scrolled into view once the server acknowledges it or it becomes active.
export function expectCreatedSession(folderId) {
  store.set({ sessionCreateReveal: { folderId: folderId || "unfiled", sessionId: null, until: Date.now() + 15000, attempts: 0 } });
}

export function revealCreatedSession(folderId, sessionId) {
  var reveal = store.get('sessionCreateReveal') || {};
  store.set({ sessionCreateReveal: { folderId: folderId || reveal.folderId || "unfiled", sessionId: sessionId, until: Date.now() + 15000, attempts: 0 } });
  expandDestination(folderId || reveal.folderId || "unfiled");
  scheduleReveal();
}

function expandDestination(folderId) {
  var state = currentFolderState();
  if (state.collapsed && state.collapsed[folderId] === true) sendFolderOp({ op: "set_collapsed", containerKey: folderId, collapsed: false });
}

function visibleRow(sessionId) {
  var rows = document.querySelectorAll('.session-item[data-session-id="' + sessionId + '"]');
  for (var i = 0; i < rows.length; i++) if (rows[i].getClientRects().length) return rows[i];
  return null;
}

function scheduleReveal() {
  setTimeout(tryReveal, 0);
}

function tryReveal() {
  var reveal = store.get('sessionCreateReveal');
  if (!reveal || !reveal.sessionId) return;
  if (Date.now() > reveal.until || reveal.attempts > 40) { store.set({ sessionCreateReveal: null }); return; }
  var row = visibleRow(reveal.sessionId);
  if (row) {
    if (row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    store.set({ sessionCreateReveal: null });
    return;
  }
  store.set({ sessionCreateReveal: Object.assign({}, reveal, { attempts: reveal.attempts + 1 }) });
  setTimeout(tryReveal, 60);
}

// --- Project default (provider only) ---

export function saveProjectDefault(vendor) {
  var form = createState();
  if (!form || form.phase === "pending" || form.defaultSaving || installedVendorIds().indexOf(vendor) === -1) return false;
  var requestId = nextId("scd-");
  patch({ defaultSaving: true, defaultRequestId: requestId, defaultVendor: vendor, error: "", notice: "" });
  if (!send({ type: "new_session_default_set", requestId: requestId, vendor: vendor })) {
    patch({ defaultSaving: false, defaultRequestId: null, defaultVendor: null, error: "Not connected. Reconnect and try again." });
    return false;
  }
  return true;
}

function handleDefaultResult(msg) {
  var form = createState();
  if (!form || !msg.requestId || msg.requestId !== form.defaultRequestId) return;
  if (!msg.ok) { patch({ defaultSaving: false, defaultRequestId: null, defaultVendor: null, error: msg.error || "The project default could not be saved." }); return; }
  store.set({ sessionCreateOptions: Object.assign({}, createOptions(), { projectDefault: msg.projectDefault || null }) });
  patch({ defaultSaving: false, defaultRequestId: null, defaultVendor: null, error: "", notice: "Saved as this project's default." });
}

// --- Messages and lifecycle ---

export function handleSessionCreateMessage(msg) {
  if (msg.type === "new_session_options") { handleOptions(msg); return true; }
  if (msg.type === "new_session_default_result") { handleDefaultResult(msg); return true; }
  if (msg.type === "new_session_project_default") {
    if (!msg.slug || msg.slug === store.get('currentSlug')) store.set({ sessionCreateOptions: Object.assign({}, createOptions(), { projectDefault: msg.projectDefault || null }) });
    return true;
  }
  return false;
}

// Requests that were in flight are gone; nothing may stay waiting forever.
function onDisconnect(form) {
  store.set({ sessionCreateLocks: {} });
  var options = createOptions();
  if (options.requestId) store.set({ sessionCreateOptions: Object.assign({}, options, { requestId: null, error: "Connection lost. Reconnect to load providers." }) });
  if (!form) return;
  if (form.timer) clearTimeout(form.timer);
  if (form.phase === "pending") {
    if (form.mode === "mate-direct") patch({ phase: "uncertain", timer: null, error: "Connection lost. The session may already have been created; check the list before trying again." });
    else patch({ phase: "ready", requestId: null, timer: null, error: "Connection lost. The session may already have been created; check the list first." });
  }
  if (form.defaultSaving) patch({ defaultSaving: false, defaultRequestId: null, defaultVendor: null, error: "Connection lost before the project default was confirmed." });
}

function clearAll() {
  var form = createState();
  if (form && form.timer) clearTimeout(form.timer);
  store.set({ sessionCreateLocks: {}, sessionCreate: null, sessionCreateOptions: null, sessionCreateReveal: null });
}

store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.dmMode !== previous.dmMode) {
    if (state.sessionCreate || state.sessionCreateOptions || state.sessionCreateReveal) clearAll();
    return;
  }
  var form = state.sessionCreate;
  if (previous.connected && !state.connected) onDisconnect(form);
  // The providers are requested again after a reconnect.
  if (!previous.connected && state.connected && form && form.mode !== "mate-direct") requestOptions();
  // Folder removed while its row was open: say so instead of letting a later
  // create fail, and never silently file the session elsewhere.
  if (form && state.sessionFolders !== previous.sessionFolders && form.folderId !== "unfiled") {
    var folders = currentFolderState().folders;
    var known = false;
    for (var i = 0; i < folders.length; i++) if (folders[i].id === form.folderId) known = true;
    if (!known && state.sessionFolders && form.phase !== "pending") {
      store.set({ sessionCreate: null });
      showToast("That folder was removed, so the new session row was closed.", "warn");
    }
  }
  var reveal = state.sessionCreateReveal;
  if (reveal && !reveal.sessionId && state.activeSessionId !== previous.activeSessionId && state.activeSessionId != null && Date.now() < reveal.until) {
    revealCreatedSession(reveal.folderId, state.activeSessionId);
  } else if (reveal && reveal.sessionId && state.sessionFolderLayouts !== previous.sessionFolderLayouts) {
    scheduleReveal();
  }
});
