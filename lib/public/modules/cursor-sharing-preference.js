// Client state and server synchronization for the cursor sharing preference.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';

export function handleCursorSharingMessage(msg) {
  if (!msg || msg.type !== "cursor_sharing_state") return false;
  function clearPresence() {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "cursor_leave" }));
      ws.send(JSON.stringify({ type: "text_select", ranges: [] }));
    }
  }
  if (msg.ready !== true || msg.accountAvailable === false || typeof msg.cursorSharing !== "boolean") {
    if (store.get("cursorSharingHydrated") && store.get("cursorSharingEnabled")) clearPresence();
    store.set({ cursorSharingEnabled: false, cursorSharingHydrated: false, cursorSharingAccountId: null });
    showToast(msg.error || "Cursor sharing is unavailable.", "warn");
    return true;
  }
  var knownUserId = store.get("myUserId");
  if (knownUserId && msg.accountId && knownUserId !== msg.accountId) {
    if (store.get("cursorSharingHydrated") && store.get("cursorSharingEnabled")) clearPresence();
    store.set({ cursorSharingEnabled: false, cursorSharingHydrated: false, cursorSharingAccountId: null });
    return true;
  }
  var wasEnabled = store.get("cursorSharingHydrated") && store.get("cursorSharingEnabled");
  store.set({ cursorSharingEnabled: msg.cursorSharing, cursorSharingHydrated: true, cursorSharingAccountId: msg.accountId || null });
  if (wasEnabled && !msg.cursorSharing) {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "cursor_leave" }));
      ws.send(JSON.stringify({ type: "text_select", ranges: [] }));
    }
  }
  return true;
}
