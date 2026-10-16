import { contextualFrame, contextualMate } from './contextual-mate-identity.js';
import { store } from './store.js';
import { openMateWorkspace, returnFromClay } from './project-mate-navigation.js';
import { takeComposerDraft, restoreComposerDraft, autoResize } from './input.js';
import { showToast } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { getHomeMateName } from './home-mate-selection.js';

function bridge(mateId, sessionId) {
  var surface = document.getElementById('contextual-clay');
  var frame = contextualFrame(mateId, sessionId);
  var connection = surface && frame && frame.conversation;
  if (!connection || !contextualMate(frame.dataset.mateId) || connection.source !== frame.contentWindow) return null;
  var identity = connection.identity();
  return identity.ownerId === store.get('myUserId') && identity.mateId === frame.dataset.mateId ? connection : null;
}
function lockNative(value) {
  ['messages', 'input-wrapper'].forEach(function (id) { var element = document.getElementById(id); if (element) element.inert = value; });
}
// A direct/native Mate entry also lends its composer to one pane at a time.
export function beginContextualNativeOrigin(mate) {
  if (store.get('currentSlug') !== 'mate-' + mate.id) return true;
  var existing = contextualFrame(mate.id);
  if (existing && existing.dataset.sessionId && Number(existing.dataset.sessionId) !== store.get('activeSessionId')) return true;
  if (existing && existing.conversation && existing.conversation.identity().sessionId !== store.get('activeSessionId')) return true;
  try {
    var draft = takeComposerDraft();
    store.set({ contextualNativeOrigin: { mateId: mate.id, slug: store.get('currentSlug'), sessionId: store.get('activeSessionId'), draft: draft, stage: 'waiting' } });
    lockNative(true); return true;
  } catch (error) { showToast(error.message, 'error'); return false; }
}
export function syncContextualNativeOrigin() {
  var origin = store.get('contextualNativeOrigin'); var connection = origin && bridge(origin.mateId, origin.sessionId);
  if (!origin || origin.stage !== 'waiting' || !connection || !connection.identity().ready || connection.identity().mateId !== origin.mateId || connection.identity().sessionId !== origin.sessionId) return;
  store.set({ contextualNativeOrigin: Object.assign({}, origin, { draft: null, stage: 'pane' }) });
  connection.suspend(false); connection.restore(origin.draft);
}
export function abandonContextualNativeOrigin(mateId) {
  var origin = store.get('contextualNativeOrigin');
  if (!origin || origin.mateId !== mateId) return;
  // A removed/revoked identity cannot receive a draft or trap later navigation.
  store.set({ contextualNativeOrigin: null }); lockNative(false);
  showToast('This Mate conversation is no longer available.', 'warn');
}
export function finishContextualNativeOrigin() {
  var origin = store.get('contextualNativeOrigin');
  if (!origin) return true;
  try {
    var connection = bridge(origin.mateId, origin.sessionId);
    var draft = origin.stage === 'waiting' ? origin.draft : connection && connection.take();
    if (!draft) throw new Error('Wait for this Mate conversation to reconnect.');
    if (connection) connection.suspend(true);
    restoreComposerDraft(draft); store.set({ contextualNativeOrigin: null }); lockNative(false); return true;
  } catch (error) { showToast(error.message, 'error'); return false; }
}
export function openContextualWorkspace(clay) {
  var connection = bridge();
  var identity = connection && connection.identity();
  if (!contextualMate(clay.id) || !identity || identity.mateId !== clay.id || !identity.ready) { showToast('Wait for this Mate conversation to reconnect.', 'error'); return; }
  var origin = store.get('contextualNativeOrigin');
  if (origin && origin.mateId === clay.id && origin.sessionId === identity.sessionId) {
    if (!finishContextualNativeOrigin()) return;
    var existingHandoff = store.get('contextualWorkspace');
    if (existingHandoff && existingHandoff.slug === origin.slug && existingHandoff.sessionId === origin.sessionId) { store.set({ contextualClay: { mode: 'workspace', mateId: clay.id, sessionId: origin.sessionId } }); return; }
    var target = store.get('clayReturnTarget');
    store.set({ contextualWorkspace: { slug: origin.slug, sessionId: origin.sessionId, stage: 'workspace', projectDraft: null, returnSlug: target && target.projectSlug, returnSessionId: target && target.sessionId }, contextualClay: { mode: 'workspace', mateId: clay.id } });
    return;
  }
  if (origin && !finishContextualNativeOrigin()) return;
  try {
    var projectDraft = takeComposerDraft();
    var draft;
    try { draft = connection.take(); } catch (error) { restoreComposerDraft(projectDraft); throw error; }
    connection.suspend(true);
    store.set({ contextualWorkspace: { slug: 'mate-' + clay.id, sessionId: identity.sessionId, draft: draft, projectDraft: projectDraft, stage: 'opening', returnSlug: store.get('currentSlug'), returnSessionId: store.get('activeSessionId'), returnWorkspace: store.get('contextualWorkspace') }, contextualClay: { mode: 'opening', mateId: clay.id } });
    lockNative(true);
    openMateWorkspace(clay.id, identity.sessionId);
  } catch (error) { showToast(error.message, 'error'); }
}

// Called by the existing return service before it changes the route/session.
export function finishContextualWorkspace() {
  var handoff = store.get('contextualWorkspace');
  if (!handoff || handoff.stage === 'returning') return;
  var connection = bridge(handoff.slug.slice(5), handoff.sessionId);
  if (!connection) { store.set({ contextualWorkspace: null, contextualClay: { mode: 'closed' } }); lockNative(false); return true; }
  try {
    var draft = handoff.draft;
    if (handoff.stage === 'workspace' && store.get('currentSlug') === handoff.slug && store.get('activeSessionId') === handoff.sessionId) draft = takeComposerDraft();
    connection.restore(draft);
    connection.suspend(false);
    store.set({ contextualWorkspace: Object.assign({}, handoff, { draft: null, stage: 'returning' }), contextualClay: Object.assign({}, store.get('contextualClay'), { mode: 'closed' }) });
    lockNative(true);
    return true;
  } catch (error) { showToast(error.message, 'error'); return false; }
}

export function handleContextualWorkspaceMessage(msg) {
  var handoff = store.get('contextualWorkspace');
  if (!handoff || store.get('paneMode')) return;
  if (msg.type === 'session_switched' && handoff.stage.indexOf('workspace') === 0 && store.get('currentSlug') === handoff.slug) {
    var saved = handoff.draft;
    if (store.get('activeSessionId') === handoff.sessionId) saved = takeComposerDraft();
    var exact = msg.id === handoff.sessionId;
    store.set({ contextualWorkspace: Object.assign({}, handoff, { draft: saved, stage: exact ? 'opening' : 'workspace-other' }) });
    if (exact) lockNative(true);
    return;
  }
  if (msg.type !== 'history_done') return;
  if (handoff.stage === 'opening' && store.get('currentSlug') === handoff.slug && store.get('activeSessionId') === handoff.sessionId) {
    restoreComposerDraft(handoff.draft);
    store.set({ contextualWorkspace: Object.assign({}, handoff, { draft: null, stage: 'workspace' }), contextualClay: Object.assign({}, store.get('contextualClay'), { mode: 'workspace' }) });
    lockNative(false);
  } else if (handoff.stage === 'returning' && (store.get('currentSlug') !== handoff.slug || store.get('activeSessionId') !== handoff.sessionId)) {
    if (handoff.projectDraft && store.get('currentSlug') === handoff.returnSlug && store.get('activeSessionId') === handoff.returnSessionId) restoreComposerDraft(handoff.projectDraft);
    var restored = handoff.returnWorkspace && store.get('currentSlug') === handoff.returnSlug && store.get('activeSessionId') === handoff.returnSessionId ? handoff.returnWorkspace : null;
    store.set({ contextualWorkspace: restored, contextualClay: restored ? { mode: 'workspace', mateId: restored.slug.slice(5), sessionId: restored.sessionId } : store.get('contextualClay') });
    lockNative(false);
  }
}
export function renderContextualWorkspaceBack() {
  var handoff = store.get('contextualWorkspace');
  document.body.classList.toggle('contextual-clay-native', !!handoff && handoff.stage === 'workspace' && store.get('currentSlug') === handoff.slug);
  var button = document.getElementById('contextual-workspace-back');
  if (!button) {
    button = document.createElement('button'); button.id = 'contextual-workspace-back'; button.type = 'button';
    button.innerHTML = iconHtml('arrow-left') + '<span>Back to project</span>';
    button.addEventListener('click', returnFromClay);
    document.getElementById('header-left').prepend(button);
    refreshIcons();
  }
  var returnMate = handoff && handoff.returnSlug && handoff.returnSlug.indexOf('mate-') === 0 && contextualMate(handoff.returnSlug.slice(5));
  button.querySelector('span').textContent = returnMate ? 'Back to ' + getHomeMateName(returnMate) : 'Back to project';
  button.hidden = !handoff || handoff.stage.indexOf('workspace') !== 0 || store.get('currentSlug') !== handoff.slug;
}

export function prepareContextualWorkspaceDeparture(slug) {
  var origin = store.get('contextualNativeOrigin');
  if (origin && slug !== origin.slug && !finishContextualNativeOrigin()) return false;
  var handoff = store.get('contextualWorkspace');
  if (handoff && handoff.stage.indexOf('workspace') === 0 && slug !== handoff.slug) return finishContextualWorkspace();
}
export function initContextualWorkspace() {
  var width = 0;
  new ResizeObserver(function (entries) {
    var next = entries[0].contentRect.width;
    if (next === width || !next || !store.get('contextualWorkspace')) return;
    width = next; autoResize();
  }).observe(document.getElementById('input-textarea-wrap'));
  store.subscribe(function (value, previous) {
    var handoff = value.contextualWorkspace;
    if (!handoff || handoff.stage !== 'workspace' || !previous.connected || value.connected || value.currentSlug !== handoff.slug) return;
    var draft = takeComposerDraft();
    store.set({ contextualWorkspace: Object.assign({}, handoff, { draft: draft, stage: 'opening' }), pendingProjectSessionNavigation: { projectSlug: handoff.slug, sessionId: handoff.sessionId } });
    lockNative(true);
  });
}
