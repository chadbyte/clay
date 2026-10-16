// Human citation clicks leave the pinned pane intact and use the parent viewer's
// existing authenticated reference resolver, never a project label as a target.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { contextualFrame, contextualMate, contextualMateStamp } from './contextual-mate-identity.js';
import { parseClaySessionReference } from './clay-log-links.js';
import { requestClayRecordLink } from './command-palette.js';

function capture() {
  var frame = contextualFrame(), state = store.get('contextualClay') || {}, mate = contextualMate(state.mateId);
  var identity = frame && frame.conversation && frame.conversation.identity();
  if (!mate || state.mode !== 'popover' || !frame || frame.hidden || frame.inert || !identity || !identity.ready || frame.conversation.source !== frame.contentWindow || identity.ownerId !== store.get('myUserId') || identity.mateId !== mate.id || frame.dataset.identityStamp !== contextualMateStamp(mate)) return null;
  var surface = document.getElementById('contextual-clay');
  return { mateId: mate.id, stamp: contextualMateStamp(mate), sessionId: identity.sessionId, originId: identity.sessionOriginId, ownerId: identity.ownerId, view: surface.dataset.screenReference, socket: getWs() };
}
export function validContextualCitation(context) {
  var live = capture();
  return !!(context && live && live.socket === context.socket && live.mateId === context.mateId && live.stamp === context.stamp && live.sessionId === context.sessionId && live.originId === context.originId && live.ownerId === context.ownerId && live.view === context.view);
}
export function contextualCitationLink(context, requestId) {
  var frames = Array.from(document.querySelectorAll('#contextual-clay iframe'));
  for (var frame of frames) {
    var mate = contextualMate(frame.dataset.mateId), identity = frame.conversation && frame.conversation.identity();
    if (!mate || !identity || identity.ownerId !== store.get('myUserId') || frame.dataset.identityStamp !== contextualMateStamp(mate)) continue;
    if (context && (identity.mateId !== context.mateId || identity.sessionId !== context.sessionId || identity.sessionOriginId !== context.originId || context.ownerId !== identity.ownerId)) continue;
    var link = Array.from(frame.contentDocument.querySelectorAll('.clayos-session-link')).find(function (item) { return item.dataset.sessionRequest === requestId; });
    if (link) return link;
  }
  return null;
}
export function attachContextualSessionCitations(surface) {
  surface.resolveSessionCitation = function (source, link) {
    var context = capture(), frame = contextualFrame();
    if (!context || !frame || frame.contentWindow !== source || !link || link.ownerDocument !== frame.contentDocument || !link.closest('.msg-assistant') || !parseClaySessionReference(link.dataset.sessionRef || '')) return false;
    context.ref = link.dataset.sessionRef;
    return requestClayRecordLink(link, context);
  };
}
export function forwardContextualSessionCitation(link) {
  if (!store.get('paneMode') || new URLSearchParams(location.search).get('contextual') !== '1') return false;
  try {
    var surface = window.parent.document.getElementById('contextual-clay');
    if (surface && surface.resolveSessionCitation && surface.resolveSessionCitation(window, link)) return true;
  } catch (error) { /* A changed authentication document cannot receive clicks. */ }
  if (link.classList.contains('is-error')) return true;
  link.classList.add('is-error'); link.title = 'This conversation or view changed. Reopen it before navigating.';
  return true;
}
// Project transport replacement may discard an old reply before the palette
// sees it. Retire that pending UI receipt at the context change itself.
store.subscribe(function (value) {
  var pending = value.sessionNavigationRequestContext;
  if (value.paneMode || !pending || !pending.citation) return;
  if (pending.projectSlug === value.currentSlug && pending.sessionId === value.activeSessionId && validContextualCitation(pending.citation)) return;
  var link = contextualCitationLink(pending.citation, value.sessionNavigationRequestId);
  if (link) { link.classList.remove('is-loading'); link.classList.add('is-error'); link.title = 'The view changed. Click again from the current conversation.'; delete link.dataset.sessionRequest; }
  store.set({ sessionNavigationRequestId: null, sessionNavigationRequestContext: null });
});
