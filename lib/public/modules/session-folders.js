// Client state and server round trips for sidebar session folders. The
// server owns the data (per user and project); this module mirrors the latest
// snapshot into the store and sends operations the server validates again.
// Snapshots and requests are both tagged with the project so a stale one can
// never be applied to, or mutate, another project.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { defaultFolderState } from './session-folder-layout.js';

export function handleSessionFoldersState(msg) {
  var slug = store.get('currentSlug');
  if (msg.slug && slug && msg.slug !== slug) return;
  var create = store.get('sessionFolderCreate');
  if (msg.state) store.set({ sessionFolders: msg.state, sessionFoldersSlug: msg.slug || slug || null });
  var correlated = !!(create && create.pendingId && msg.requestId === create.pendingId);
  if (msg.error && !correlated) showToast(msg.error, "warn");
  if (!correlated) return;
  if (msg.error) {
    // The creation was refused: keep the row open with the server's reason.
    store.set({ sessionFolderCreate: Object.assign({}, create, { pendingId: null, error: msg.error, focus: true }) });
    return;
  }
  store.set({ sessionFolderCreate: null });
  if (create.sessionId !== null && msg.folderId) sendFolderOp({ op: "place_session", sessionId: create.sessionId, folderId: msg.folderId });
}

export function currentFolderState() {
  var state = store.get('sessionFolders');
  if (!state || store.get('sessionFoldersSlug') !== store.get('currentSlug')) return defaultFolderState();
  return state;
}

export function sendFolderOp(op, requestId) {
  var ws = getWs();
  if (!ws || !store.get('connected')) return false;
  var payload = { type: "session_folders_op", slug: store.get('currentSlug'), op: op };
  if (requestId) payload.requestId = requestId;
  ws.send(JSON.stringify(payload));
  return true;
}

// --- Inline folder creation (the row itself lives in session-folder-toolbar.js) ---
// A creation is closed only by the server's acknowledgement; when it was started
// from a session's Move picker, that session is filed after a successful ack.

export function openFolderCreate(sessionId) {
  var current = store.get('sessionFolderCreate');
  if (current) {
    store.set({ sessionFolderCreate: Object.assign({}, current, { focus: true, scroll: true, sessionId: sessionId === undefined ? current.sessionId : sessionId }) });
    return;
  }
  store.set({ sessionFolderCreate: { draft: "", error: "", pendingId: null, sessionId: sessionId === undefined ? null : sessionId, focus: true, scroll: true, selStart: 0, selEnd: 0 } });
}

export function cancelFolderCreate() {
  if (store.get('sessionFolderCreate')) store.set({ sessionFolderCreate: null });
}

export function updateFolderCreateDraft(patch) {
  var current = store.get('sessionFolderCreate');
  if (current) store.set({ sessionFolderCreate: Object.assign({}, current, patch) });
}

export function submitFolderCreate(name) {
  var current = store.get('sessionFolderCreate');
  if (!current || current.pendingId) return false;
  var requestId = "folder-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  store.set({ sessionFolderCreate: Object.assign({}, current, { pendingId: requestId, error: "", focus: true }) });
  if (!sendFolderOp({ op: "create_folder", name: name }, requestId)) {
    store.set({ sessionFolderCreate: Object.assign({}, current, { pendingId: null, error: "Not connected. Try again.", focus: true }) });
    return false;
  }
  return true;
}

store.subscribe(function (state, previous) {
  var create = state.sessionFolderCreate;
  if (create && create.pendingId && previous.connected && !state.connected) {
    store.set({ sessionFolderCreate: Object.assign({}, create, { pendingId: null, error: "Connection lost. Try again." }) });
  }
});

export function resetSessionFolders() {
  store.set({ sessionFolders: null, sessionFoldersSlug: null });
}

export function requestFolderState() {
  var ws = getWs();
  if (ws && store.get('connected')) ws.send(JSON.stringify({ type: "session_folders_get" }));
}
