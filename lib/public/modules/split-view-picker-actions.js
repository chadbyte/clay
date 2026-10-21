// Exact-context session insertion through the existing View and creation services.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { activeSavedView } from './view-workspace-state.js';
import { layoutScope, currentLayoutScope } from './split-view-layout-scope.js';
import { viewForOrigin } from './split-view-presentation-lookup.js';
import { applyPresentationDrop } from './split-view-presentation-drop.js';
import { mutation } from './view-mutations.js';
import { checkComposerDeparture } from './session-rich-drafts.js';
import { createOptions } from './session-create.js';
import { showToast } from './utils.js';

export function pickerReceipt(anchor) {
  var view = activeSavedView(), pane = anchor && anchor.closest('.split-pane'), frame = pane && pane.querySelector('.split-pane-frame');
  var origin = pane && pane.dataset.presentationOrigin || frame && frame.dataset.sessionOriginId || store.get('sessionOriginId');
  return view && view.sessions.some(function (session) { return session.sessionOriginId === origin; }) ? { scope: layoutScope(view), origin: origin } : null;
}
export function pickerCurrent(receipt) {
  var picker = store.get('splitSessionPicker');
  return receipt && (!receipt.reservationId || picker && picker.receipt.reservationId === receipt.reservationId) && !store.get('paneMode') && currentLayoutScope(receipt.scope) && activeSavedView().sessions.some(function (session) { return session.sessionOriginId === receipt.origin; });
}
export function pickerCapacity() {
  var view = activeSavedView();
  return !!view && view.sessions.length + (view.workspace.linkedPair ? view.workspace.linkedPair.workerOrigins.length : 0) < 8;
}
function checkDrafts() {
  checkComposerDeparture();
  document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) .split-pane-frame').forEach(function (frame) { if (frame.clayPane) frame.clayPane.checkDraft(); });
}
export function insertPickerSession(receipt, side, id) {
  if (['left', 'right', 'top', 'bottom'].indexOf(side) < 0 || !pickerCurrent(receipt) || !pickerCapacity() || store.get('projectSplitViewPending') || store.get('projectSplitViewError')) return false;
  var view = activeSavedView(), session = (getCachedSessions() || []).find(function (item) { return item.id === id; });
  if (!session || session.sessionRole === 'worker' || session.isMate || session.isTui || (session.ownerId || null) !== (store.get('myUserId') || null) || view.sessions.some(function (ref) { return ref.sessionOriginId === session.sessionOriginId; })) return false;
  var source = viewForOrigin(session.sessionOriginId);
  return applyPresentationDrop({ origin: session.sessionOriginId, sessionId: id, sourceViewId: source && source.id },
    { origin: receipt.origin, viewId: view.id, side: side }, mutation, checkDrafts) === true;
}
export function createPickerSession(receipt, side, vendor) {
  if (['left', 'right', 'top', 'bottom'].indexOf(side) < 0 || !pickerCurrent(receipt) || !pickerCapacity() || store.get('splitSessionCreation') || store.get('projectSplitViewPending')) return false;
  if (!createOptions().vendors.some(function (item) { return item.id === vendor && item.installed; })) return false;
  try { checkDrafts(); } catch (error) { showToast(error.message, 'warn'); return false; }
  var id = 'split-create-' + (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  store.set({ splitSessionCreation: { receipt: receipt, side: side, requestId: id, createdId: null } });
  try { getWs().send(JSON.stringify({ type: 'new_session', slug: store.get('currentSlug'), requestId: id, vendor: vendor, forceNew: true, activate: false })); }
  catch (error) { store.set({ splitSessionCreation: null }); return false; }
  setTimeout(function () {
    var pending = store.get('splitSessionCreation');
    if (pending && pending.requestId === id) {
      store.set({ splitSessionCreation: null });
      showToast('Creation was not confirmed. Check recent sessions before trying again.', 'warn');
    }
  }, 30000);
  return true;
}
export function handleSplitSessionCreated(message) {
  var pending = store.get('splitSessionCreation');
  if (message.type !== 'new_session_result' || !pending || message.requestId !== pending.requestId) return false;
  if (!message.ok) { store.set({ splitSessionCreation: null }); showToast(message.error || 'The session could not be created.', 'error'); return true; }
  store.set({ splitSessionCreation: Object.assign({}, pending, { createdId: message.sessionId }) });
  finishPickerCreation(); return true;
}
export function finishPickerCreation() {
  var pending = store.get('splitSessionCreation');
  if (!pending || !pending.createdId || !getCachedSessions().some(function (session) { return session.id === pending.createdId; })) return;
  store.set({ splitSessionCreation: null });
  if (!insertPickerSession(pending.receipt, pending.side, pending.createdId)) showToast('The session was created in Unfiled. The View changed, so it was not added to the split.', 'warn');
}
store.subscribe(function (state, previous) {
  if (state.splitSessionCreation && (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.projectSplitViewSocketGeneration !== previous.projectSplitViewSocketGeneration || !state.connected)) store.set({ splitSessionCreation: null });
});
