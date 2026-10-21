import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { prepareViewMutation } from './view-workspace-state.js';
function contextKey(state) { return [state.currentSlug || '', state.currentProjectOwnerId || '', state.myUserId || '', state.projectSplitViewSocketGeneration || 0].join('|'); }
function projectReady(state) { return getWs() !== state.splitIdentityBlockedSocket && !state.paneMode && !state.dmMode && state.connected && state.authIdentityLoaded && state.currentSlug === state.activeProjectSlug && state.currentSlug === state.sessionListProjectSlug; }
function sendMessage(message) { var ws = getWs(); if (!ws || ws.readyState !== 1 || !projectReady(store.snap())) return false; try { ws.send(JSON.stringify(message)); return true; } catch (error) { return false; } }
export function mutation(type, body, meta) {
  var state = store.snap();
  if (!projectReady(state) || !state.projectSplitViewHydrated || state.projectSplitViewError || state.projectSplitViewPending) return false;
  var requestId = "split-view-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  var ws = getWs();
  var message = prepareViewMutation(type, Object.assign({ type: type, requestId: requestId, expectedRevision: state.projectSplitViewRevision }, body || {}));
  if (!message) return false;
  var pending = { requestId: requestId, type: type, socket: ws, contextKey: contextKey(state), expectedRevision: state.projectSplitViewRevision, meta: meta || null,
    awaitingBroadcast: false, resultRevision: null };
  store.set({ projectSplitViewPending: pending, projectSplitViewError: "" });
  if (!sendMessage(message)) {
    store.set({ projectSplitViewPending: null, projectSplitViewError: "Split view change could not be sent. Refresh before trying again." });
    showToast("Split view change could not be sent. Refresh before trying again.", "error");
    return false;
  }
  return true;
}
