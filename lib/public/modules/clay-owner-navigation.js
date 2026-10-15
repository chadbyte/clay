import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { navigateToSession } from './command-palette.js';
function context() {
  return JSON.stringify([store.get('currentSlug'), store.get('activeSessionId'), store.get('dmMode'), store.get('homeShellVisible'), store.get('homeChatMateId'), store.get('homeChatSessionId'), store.get('homeSubSurface')]);
}
export function handleOwnerNavigation(msg) {
  if (msg.type !== 'clay_navigation_offer' && msg.type !== 'clay_navigation_apply') return false;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return true;
  if (msg.type === 'clay_navigation_offer') {
    if (document.hidden || store.get('paneMode')) return true;
    store.set({ clayNavigationOffer: { id: msg.deliveryId, context: context(), socket: ws } });
    ws.send(JSON.stringify({ type: 'clay_navigation_claim', deliveryId: msg.deliveryId }));
    return true;
  }
  var offer = store.get('clayNavigationOffer');
  store.set({ clayNavigationOffer: null });
  var accepted = offer && offer.id === msg.deliveryId && offer.socket === ws && offer.context === context() && !document.hidden && !store.get('paneMode');
  var status = 'refused';
  if (accepted && msg.target && typeof msg.target.projectSlug === 'string' && Number.isSafeInteger(msg.target.sessionId)) {
    try { navigateToSession(msg.target); status = 'accepted'; } catch (error) { status = 'failed'; }
  }
  // This acknowledges navigator invocation only. Rendering may finish after reconnect.
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'clay_navigation_ack', deliveryId: msg.deliveryId, status: status }));
  return true;
}
