import { handleSplitViewProbe, splitViewScreenSnapshot, applySplitViewNavigation, observeSplitViewRendering } from './clay-split-view-screen.js';
import { observeNavigationRendering } from './clay-navigation-render.js';
import { showClayNavigationActivity, clearClayControlActivity } from './clay-control-activity.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { navigateToSession } from './command-palette.js';
var offerSocket = null;
function context() {
  return JSON.stringify([store.get('currentSlug'), store.get('activeSessionId'), store.get('dmMode'), store.get('homeShellVisible'), store.get('homeChatMateId'), store.get('homeChatSessionId'), store.get('homeSubSurface'), (store.get('contextualClay') || {}).mode, splitViewScreenSnapshot()]);
}
export function handleOwnerNavigation(msg) {
  if (handleSplitViewProbe(msg)) return true;
  if (msg.type !== 'clay_navigation_offer' && msg.type !== 'clay_navigation_apply') return false;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return true;
  if (msg.type === 'clay_navigation_offer') {
    if (document.hidden || store.get('paneMode')) return true;
    offerSocket = ws;
    store.set({ clayNavigationOffer: { id: msg.deliveryId, context: context() } });
    ws.send(JSON.stringify({ type: 'clay_navigation_claim', deliveryId: msg.deliveryId }));
    return true;
  }
  var offer = store.get('clayNavigationOffer');
  store.set({ clayNavigationOffer: null });
  var accepted = offer && offer.id === msg.deliveryId && offerSocket === ws && offer.context === context() && !document.hidden && !store.get('paneMode');
  offerSocket = null;
  var status = 'refused';
  if (accepted && msg.target && msg.target.surface === 'split_view') {
    try { status = applySplitViewNavigation(msg.target) ? 'accepted' : 'refused'; } catch (error) { status = 'failed'; }
  }
  if (accepted && msg.target && msg.target.surface !== 'split_view' && typeof msg.target.projectSlug === 'string' && Number.isSafeInteger(msg.target.sessionId)) {
    try {
      showClayNavigationActivity(msg.target, false); navigateToSession(msg.target, null, msg.target.entryIndex); status = 'accepted';
    } catch (error) { showClayNavigationActivity(msg.target, true); status = 'failed'; }
  }
  if (status === 'refused') clearClayControlActivity();
  // This acknowledges navigator invocation only. Rendering may finish after reconnect.
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'clay_navigation_ack', deliveryId: msg.deliveryId, status: status }));
  if (status === 'accepted') {
    if (msg.target.surface === 'split_view') observeSplitViewRendering(msg, ws); else observeNavigationRendering(msg, ws);
  }
  return true;
}
