import { forwardDocumentSource } from './clay-studio-document.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { contextualMateStamp } from './contextual-mate-identity.js';
import { visibleTarget } from './clay-control-target-visibility.js';

function validEvidence(evidence) {
  var uuid = /^[a-f0-9-]{36}$/;
  return evidence && evidence.version === 1 && uuid.test(evidence.id) && uuid.test(evidence.token) && /^activity:[a-f0-9-]{36}$/.test(evidence.activityId) && Number.isSafeInteger(evidence.deadline) &&
    evidence.target && ['document', 'sketch', 'browser'].indexOf(evidence.target.surface) >= 0 && typeof evidence.target.key === 'string' && evidence.target.key.length <= 400 && /^[a-f0-9]{64}$/.test(evidence.target.revision);
}
function source(evidence, state) {
  return validEvidence(evidence) && evidence.mateId === state.activeProjectMateId && evidence.sourceSlug === 'mate-' + evidence.mateId && evidence.ownerId === (state.myUserId || null) && evidence.runtimeId === state.controlRuntimeId && evidence.sourceSlug === state.currentSlug && evidence.sourceSessionId === state.activeSessionId && evidence.sourceSessionOriginId === state.sessionOriginId &&
    (state.cachedMatesList || []).some(function (mate) { return mate.id === evidence.mateId && mate.builtinKey === 'clay' && !mate.archived && !mate.lifecycleDeletion && contextualMateStamp(mate) === evidence.sourceMateStamp; });
}
function currentActivity(evidence) {
  var activity = store.get('clayControlActivity'), forwarded = store.get('clayControlForwarded');
  var message = store.get('paneMode') ? forwarded : activity && activity.message;
  return message && message.id === evidence.activityId && message.mateId === evidence.mateId && message.sourceSlug === evidence.sourceSlug && message.sourceSessionId === evidence.sourceSessionId && message.sourceSessionOriginId === evidence.sourceSessionOriginId && message.sourceMateStamp === evidence.sourceMateStamp && message.sourceQueryGeneration === evidence.sourceQueryGeneration && message.phase !== 'clear' && !(store.get('clayControlReceipts') || []).some(function (receipt) { return receipt.id === evidence.activityId && receipt.stopped; });
}
function binding() {
  return { window: window, document: document, identity: function () { var s = store.snap(); return { ownerId: s.myUserId || null, slug: s.currentSlug, sessionId: s.activeSessionId, origin: s.sessionOriginId, connected: s.connected, runtime: s.controlRuntimeId, mateId: s.activeProjectMateId }; } };
}
export function forwardStudioPresentation(message, type) {
  if (!store.get('paneMode') || window.parent === window) return false;
  var frame = window.frameElement;
  if (!frame) return false;
  frame.clayStudioSource = binding();
  var evidence = message.controlPresentation;
  if (evidence && (!source(evidence, store.snap()) || !currentActivity(evidence))) return true;
  if (type === 'clay-pane-present-markdown') message = forwardDocumentSource(message);
  var receipts = Object.assign({}, store.get('clayStudioRelays') || {});
  Object.keys(receipts).forEach(function (id) { if (Date.now() > receipts[id].evidence.deadline) delete receipts[id]; });
  if (Object.keys(receipts).length >= 100) return true;
  if (evidence) receipts[evidence.id] = { evidence: evidence, socket: getWs() };
  store.set({ clayStudioRelays: receipts });
  window.parent.postMessage({ type: type, message: message, studioSource: frame.clayStudioSource.identity() }, location.origin);
  return true;
}
export function trustedStudioFrame(event, data) {
  if (event.origin !== location.origin || !data || !data.studioSource) return null;
  var frame = Array.from(document.querySelectorAll('#contextual-clay iframe, .split-pane-frame')).find(function (item) { return item.contentWindow === event.source; });
  var bridge = frame && frame.clayStudioSource, live = bridge && bridge.window === frame.contentWindow && bridge.document === frame.contentDocument && bridge.identity();
  var expected = data.studioSource;
  if (!live || !live.connected || live.ownerId !== (store.get('myUserId') || null) || live.ownerId !== expected.ownerId || live.slug !== expected.slug || live.sessionId !== expected.sessionId || live.origin !== expected.origin || live.runtime !== expected.runtime) return null;
  if (new URL(frame.src, location.href).pathname !== '/p/' + encodeURIComponent(live.slug) + '/') return null;
  if (frame.classList.contains('split-pane-frame')) {
    var split = store.get('splitPanes');
    if (!split || !split.panes.some(function (pane) { return pane.slug === live.slug && String(pane.sessionId) === String(live.sessionId); })) return null;
  } else {
    var conversation = frame.conversation, identity = conversation && conversation.document === frame.contentDocument && conversation.source === frame.contentWindow && conversation.identity();
    if (!identity || !identity.connected || !identity.available || identity.ownerId !== live.ownerId || identity.sessionId !== live.sessionId || identity.sessionOriginId !== live.origin) return null;
  }
  var evidence = data.message && data.message.controlPresentation;
  if (evidence && (!validEvidence(evidence) || evidence.sourceSlug !== 'mate-' + evidence.mateId || evidence.mateId !== live.mateId || !(store.get('cachedMatesList') || []).some(function (mate) { return mate.id === evidence.mateId && mate.builtinKey === 'clay' && !mate.archived && !mate.lifecycleDeletion && contextualMateStamp(mate) === evidence.sourceMateStamp; }) || evidence.sourceSlug !== live.slug || evidence.sourceSessionId !== live.sessionId || evidence.sourceSessionOriginId !== live.origin || evidence.ownerId !== live.ownerId || evidence.runtimeId !== live.runtime)) return null;
  return frame;
}
export function acceptStudioForward(event, data) {
  var frame = trustedStudioFrame(event, data), evidence = data.message && data.message.controlPresentation;
  if (!frame || !evidence || !currentActivity(evidence) || Date.now() > evidence.deadline) return false;
  var entries = Object.assign({}, store.get('clayStudioForwarded') || {});
  Object.keys(entries).forEach(function (id) { if (Date.now() > entries[id].evidence.deadline) delete entries[id]; });
  if (Object.keys(entries).length >= 100) return false;
  entries[evidence.id] = { frame: frame, document: frame.contentDocument, window: event.source, data: data, evidence: evidence };
  store.set({ clayStudioForwarded: entries });
  return true;
}
function delivery(evidence) {
  var socket = getWs(), owner = store.get('myUserId'), slug = store.get('currentSlug');
  var relay = (store.get('clayStudioForwarded') || {})[evidence.id];
  return {
    valid: function () {
      if (Date.now() > evidence.deadline || !currentActivity(evidence) || !store.get('connected') || owner !== store.get('myUserId') || slug !== store.get('currentSlug') || getWs() !== socket) return false;
      return relay ? relay.document === relay.frame.contentDocument && relay.window === relay.frame.contentWindow && !!trustedStudioFrame({ origin: location.origin, source: relay.window }, relay.data) : source(evidence, store.snap());
    },
    send: function (visible) {
      var message = { type: 'clay_studio_rendered', id: evidence.id, token: evidence.token, sessionOriginId: evidence.sourceSessionOriginId, revision: evidence.target.revision, visible: visible };
      if (relay) { if (relay.document === relay.frame.contentDocument) relay.window.postMessage({ type: 'clay-studio-receipt', message: message }, location.origin); }
      else if (getWs() === socket && socket && socket.readyState === 1) socket.send(JSON.stringify(message));
    }
  };
}
async function digest(value) {
  var hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
}
// Called only by the actual renderer after content has reached its real product surface.
export function registerStudioPaint(message, element, ready, contentElement) {
  if (!element) return;
  delete element.dataset.controlSurface;
  var evidence = message.controlPresentation;
  if (!validEvidence(evidence)) return;
  var receipt = delivery(evidence), settled = false, frame, timer, stable = 0;
  var entry = { painted: false, evidence: evidence, target: evidence.target, element: element, valid: receipt.valid };
  element.dataset.controlSurface = evidence.id;
  var surfaces = Object.assign({}, store.get('clayStudioSurfaces') || {});
  Object.keys(surfaces).forEach(function (id) { if (!surfaces[id].element.isConnected || surfaces[id].element === element || Date.now() > surfaces[id].evidence.deadline + 6000) delete surfaces[id]; });
  surfaces[evidence.id] = entry; store.set({ clayStudioSurfaces: surfaces });
  function finish(visible) { if (settled) return; settled = true; clearTimeout(timer); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', hidden); receipt.send(visible); }
  entry.cancel = function () { finish(false); };
  function hidden() { if (document.hidden) finish(false); }
  document.addEventListener('visibilitychange', hidden);
  timer = setTimeout(function () { finish(false); }, Math.max(0, evidence.deadline - Date.now()));
  var content = evidence.target.surface === 'document' ? { content: message.content, exists: message.exists, size: message.size } : evidence.target.surface === 'sketch' ? message.source : message.data;
  Promise.all([Promise.resolve(ready), digest(content)]).then(function (values) {
    if (values[1] !== evidence.target.revision) { finish(false); return; }
    function inspect() {
      if (settled) return;
      if (!receipt.valid() || document.hidden || element.dataset.controlSurface !== evidence.id) { finish(false); return; }
      stable = painted(contentElement || element) ? stable + 1 : 0;
      if (stable >= 2) { entry.painted = true; finish(true); } else frame = requestAnimationFrame(inspect);
    }
    frame = requestAnimationFrame(inspect);
  }).catch(function () { finish(false); });
}
function painted(element) {
  if (!element || !element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  var rect = element.getBoundingClientRect(), style = getComputedStyle(element);
  if (style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
  for (var parent = element.parentElement; parent; parent = parent.parentElement) {
    var ancestorStyle = getComputedStyle(parent);
    if (ancestorStyle.visibility !== 'visible' || Number(ancestorStyle.opacity) === 0) return false;
  }
  var left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right), top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return false;
  return [0.2, 0.5, 0.8].some(function (x) { return [0.2, 0.5, 0.8].some(function (y) { var hit = document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y); return hit && element.contains(hit); }); });
}
export function studioControlTarget(target) {
  var entries = store.get('clayStudioSurfaces') || {};
  var entry = Object.values(entries).find(function (item) { return item.painted && item.target.surface === target.surface && item.target.key === target.key && item.target.revision === target.revision && item.target.runtimeId === target.runtimeId && item.target.sourceSessionOriginId === target.sourceSessionOriginId && item.target.sourceSessionId === target.sourceSessionId && item.target.sourceSlug === target.sourceSlug && item.element.dataset.controlSurface === item.evidence.id && item.valid(); });
  return entry && entry.element;
}
export function initStudioReceipts() {
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== window.parent || !event.data || event.data.type !== 'clay-studio-receipt') return;
    var message = event.data.message, entries = Object.assign({}, store.get('clayStudioRelays') || {}), entry = message && entries[message.id];
    if (!entry || entry.evidence.token !== message.token || !source(entry.evidence, store.snap()) || getWs() !== entry.socket || entry.socket.readyState !== 1 || Date.now() > entry.evidence.deadline) return;
    delete entries[message.id]; store.set({ clayStudioRelays: entries }); entry.socket.send(JSON.stringify(message));
  });
  function stop() { Object.values(store.get('clayStudioSurfaces') || {}).forEach(function (entry) { delete entry.element.dataset.controlSurface; if (entry.cancel) entry.cancel(); }); store.set({ clayStudioRelays: {}, clayStudioForwarded: {}, clayStudioSurfaces: {} }); }
  document.addEventListener('contextual-ask-stopped', stop, true);
  document.addEventListener('click', function (event) { if (event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) stop(); }, true);
  store.subscribe(function (state, prior) { if (!state.connected && prior.connected || state.currentSlug !== prior.currentSlug || state.activeSessionId !== prior.activeSessionId || state.myUserId !== prior.myUserId) stop(); });
}
