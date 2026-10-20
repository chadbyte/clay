import { mateLoadingMarkup, updateMateLoadingScene } from './mate-loading-scene.js';
import { attachContextualSessionCitations } from './contextual-session-citations.js';
import { attachContextualConversations } from './contextual-mate-sessions.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { updateMateContext, recordMateContextSubmission } from './contextual-mate-context.js';
import { contextualMate, contextualMateStamp, contextualFrame, contextualTrigger } from './contextual-mate-identity.js';
import { initContextualMateHint } from './contextual-mate-hint.js';
import { getHomeMateName } from './home-mate-selection.js';
import { attachContextualGeometry, initContextualGeometry, positionContextualClay } from './contextual-clay-geometry.js';
import { abandonContextualNativeOrigin, beginContextualNativeOrigin, syncContextualNativeOrigin, finishContextualNativeOrigin, openContextualWorkspace, renderContextualWorkspaceBack, initContextualWorkspace } from './contextual-clay-workspace.js';
import { mateAvatarUrl } from './avatar.js';
import { iconHtml, refreshIcons } from './icons.js';
import { activateContextualMate, returnFromClay } from './project-mate-navigation.js';
import { initContextualSession } from './contextual-clay-session.js';
import { initClayControlActivity, clearClayControlActivity } from './clay-control-activity.js';
// The compact pane stays mounted; native navigation transfers draft ownership.
import { store } from './store.js';

function state() { return store.get('contextualClay') || { mode: 'closed' }; }
export function contextualClayMode() { return state().mode; }
function host() { return document.getElementById('contextual-clay'); }
function trigger() { return contextualTrigger(); }
export function enterComposer() {
  var surface = host();
  if (!surface || surface.dataset.focusEntry !== 'true') return;
  var frame = contextualFrame();
  if (!frame || frame.inert || !frame.conversation || !frame.conversation.identity().ready) return;
  var input = frame.contentDocument && frame.contentDocument.getElementById('input');
  if (contextualClayMode() !== 'popover' || document.activeElement !== trigger()) { delete surface.dataset.focusEntry; return; }
  if (input && !input.closest('[inert]')) { delete surface.dataset.focusEntry; input.focus({ preventScroll: true }); }
}
function escapePopover(event) {
  // Run after native inner menus have had their own Escape handler.
  queueMicrotask(function () {
    if (event.defaultPrevented || contextualClayMode() !== 'popover') return;
    var context = host().querySelector('details[open]');
    if (context) { context.open = false; context.querySelector('summary').focus(); return; }
    var focused = document.activeElement;
    if (!host().contains(focused) && focused !== trigger()) return;
    event.preventDefault(); dismissContextualClay(true);
  });
}

export function dismissContextualClay(restoreFocus) {
  if (!finishContextualNativeOrigin()) return;
  if (contextualClayMode() === 'opening') { returnFromClay(); return; }
  var surface = host();
  var ownedFocus = surface && (surface.contains(document.activeElement) || document.activeElement === surface);
  var target = store.get('clayReturnTarget');
  var missing = target && target.projectSlug === store.get('currentSlug') && !(store.get('projectsHubList') || []).some(function (project) { return project.slug === target.projectSlug && project.contentAccess !== false; });
  store.set({ contextualClay: Object.assign({}, state(), { mode: 'closed' }) });
  if (missing) returnFromClay();
  // The return context survives a temporary popover dismissal.
  if (restoreFocus && ownedFocus && trigger()) trigger().focus({ preventScroll: true });
}


function render() {
  var surface = host();
  var mode = contextualClayMode();
  renderContextualWorkspaceBack();
  if (!surface) return;
  surface.hidden = mode === 'closed' || mode === 'workspace';
  if (surface.dataset.mode !== mode) surface.dataset.mode = mode;
  positionContextualClay();
  surface.querySelector('[data-clay-expand]').hidden = mode !== 'popover';
  surface.querySelector('[data-clay-close]').hidden = mode !== 'popover' && mode !== 'opening';
  var mate = contextualMate(state().mateId);
  if (mate) {
    var name = getHomeMateName(mate);
    updateMateLoadingScene(surface.querySelector('[data-clay-loading]'), name, mateAvatarUrl(mate, 96));
    surface.setAttribute('aria-label', name + ' conversation');
    surface.querySelector('strong').textContent = name;
    var header = surface.querySelector('header');
    var mobile = window.matchMedia('(max-width: 768px)').matches;
    header.tabIndex = mobile ? -1 : 0;
    header.setAttribute('aria-label', mobile ? name + ' conversation' : 'Move ' + name + ' conversation. Use arrow keys; hold Shift for larger steps.');
    header.title = mobile ? name : 'Drag to move · Arrow keys when focused';
    surface.querySelectorAll('[data-clay-resize]').forEach(function (handle) { handle.setAttribute('aria-label', 'Resize ' + name + ' conversation. Use arrow keys; hold Shift for larger steps.'); });
    surface.querySelector('.contextual-clay-avatar').src = mateAvatarUrl(mate, 28);
    var expand = surface.querySelector('[data-clay-expand]');
    expand.querySelector('span').textContent = 'Open ' + name;
    expand.setAttribute('aria-label', 'Open ' + name); expand.title = 'Open ' + name + ' workspace';
    surface.querySelector('[data-clay-close]').setAttribute('aria-label', 'Close ' + name + ' conversation');

  }
  var projectContext = (store.get('projectsHubList') || []).find(function (item) { return item.slug === store.get('currentSlug'); });
  var contextSession = getCachedSessions().find(function (item) { return item.id === store.get('activeSessionId'); });
  var screen = store.get('homeShellVisible') || store.get('projectsHubVisible') ? 'Home' : store.get('dmMode') ? 'Direct message' : 'Project';
  var projectView = screen === 'Project';
  var parentReady = store.get('activeProjectSlug') === store.get('currentSlug') && store.get('sessionActivatedProjectSlug') === store.get('currentSlug') && !store.get('replayingHistory');
  updateMateContext(surface, mate, contextualFrame(), {
    projectTitle: projectView ? projectContext && (projectContext.title || projectContext.project || projectContext.slug) : store.get('projectsHubVisible') ? 'Projects' : screen,
    conversationTitle: projectView && parentReady && contextSession ? contextSession.title : null,
    projectSlug: projectView && parentReady ? store.get('currentSlug') : null,
    sessionId: projectView && parentReady ? store.get('activeSessionId') : null,
    screen: screen, ownerId: store.get('myUserId') || null
  });
  if (trigger()) trigger().setAttribute('aria-expanded', String(mode === 'popover'));
  var selectedFrame = contextualFrame();
  var connection = selectedFrame && selectedFrame.conversation;
  surface.querySelector('[data-clay-loading]').hidden = !!(connection && connection.identity().ready) || surface.dataset.askPending === 'true';
  surface.querySelectorAll('iframe').forEach(function (frame) {
    var hidden = frame !== selectedFrame;
    if (frame.hidden !== hidden) frame.hidden = hidden;
  });
}

function createFrame(mate, sessionId) {
  var surface = host();
  var frame = document.createElement('iframe');
  frame.title = getHomeMateName(mate) + ' conversation';
  frame.dataset.mateId = mate.id;
  frame.dataset.ownerId = store.get('myUserId') || '';
  frame.dataset.identityStamp = contextualMateStamp(mate);
  frame.dataset.canonical = String(mate.builtinKey === 'clay');
  frame.hidden = true;
  if (sessionId) frame.dataset.sessionId = String(sessionId);
  var origin = store.get('contextualNativeOrigin');
  frame.src = '/p/' + encodeURIComponent('mate-' + mate.id) + '/?pane=1&contextual=1' + (sessionId ? '&session=' + sessionId : origin && origin.mateId === mate.id ? '&session=' + origin.sessionId : '');
  frame.addEventListener('load', function () {

    try {
      if (frame.contentWindow.location.pathname !== '/p/' + encodeURIComponent('mate-' + mate.id) + '/') return;
      frame.contentDocument.addEventListener('click', function (event) {
        if (frame === contextualFrame() && event.target.closest('#generation-stop, #autonomous-run-stop, #send-btn.stop')) clearClayControlActivity();
      }, true);
    } catch (error) { /* Authentication owns its document. */ }
    if (frame === contextualFrame()) enterComposer();
  });
  surface.querySelector('.contextual-clay-body').appendChild(frame);
  return frame;
}
function ensureSurface() {
  if (!host()) {
    var surface = document.createElement('section');
    surface.id = 'contextual-clay'; surface.setAttribute('role', 'dialog');
    surface.innerHTML = '<header><img class="contextual-clay-avatar" alt=""><div class="contextual-clay-identity"><strong></strong><div class="contextual-context-line"><span data-clay-context></span><details class="contextual-clay-context"><summary aria-label="What this Mate can see" title="What this Mate can see">' + iconHtml('circle-help') + '</summary><p></p></details></div></div><div class="contextual-clay-actions"><button type="button" data-clay-expand>' + iconHtml('arrow-up-right') + '<span></span></button><button type="button" data-clay-close title="Close">' + iconHtml('x') + '</button></div></header><p class="contextual-capabilities" role="note" aria-label="Conversation capabilities"></p><div class="contextual-clay-body">' + mateLoadingMarkup() + '</div>';
    surface.addEventListener('contextual-clay-keydown', function (event) {
      var detail = event.detail; var frame = contextualFrame();
      if (!detail || !frame || detail.source !== frame.contentWindow) return;
      if (detail.keyboardEvent.key === 'Escape' && !detail.keyboardEvent.defaultPrevented && contextualClayMode() === 'popover') escapePopover(detail.keyboardEvent);
    });
    surface.addEventListener('contextual-clay-ready', function () {
      var frame = contextualFrame(), current = state();
      var identity = frame && frame.conversation && frame.conversation.identity();
      if (identity && identity.ready && identity.ownerId === store.get('myUserId') && identity.mateId === current.mateId && !current.sessionId && !current.startingAsk) {
        var selections = Object.assign({}, store.get('contextualSessionSelection')); selections[current.mateId] = identity.sessionId;
        store.set({ contextualSessionSelection: selections, contextualClay: Object.assign({}, current, { sessionId: identity.sessionId }) });
      }
      syncContextualNativeOrigin(); render();
    });
    surface.addEventListener('contextual-clay-availability', render);
    surface.addEventListener('contextual-context-submitted', function (event) { recordMateContextSubmission(surface, event); });
    document.body.appendChild(surface); attachContextualConversations(surface); attachContextualSessionCitations(surface); attachContextualGeometry(surface); refreshIcons();
    surface.querySelector('[data-clay-close]').addEventListener('click', function () { dismissContextualClay(true); });
    surface.querySelector('[data-clay-expand]').addEventListener('click', function () { var mate = contextualMate(state().mateId); if (mate) openContextualWorkspace(mate); });
  }
}

export function showContextualAsk(mate, requestId, sessionId) {
  if (!mate || !contextualMate(mate.id) || store.get('paneMode') || !finishContextualNativeOrigin()) return false;
  ensureSurface();
  if (sessionId && !contextualFrame(mate.id, sessionId)) createFrame(mate, sessionId);
  var selections = Object.assign({}, store.get('contextualSessionSelection'));
  if (sessionId) selections[mate.id] = sessionId;
  store.set({ contextualSessionSelection: selections, contextualClay: { mode: 'popover', mateId: mate.id, sessionId: sessionId || null, startingAsk: sessionId ? null : requestId } });
  host().querySelector('[data-clay-loading]').hidden = !!sessionId;
  if (sessionId && contextualFrame()) contextualFrame().hidden = false;
  return true;
}

export function selectContextualConversation(mate, sessionId, sessionOriginId) {
  var existing = contextualFrame(mate.id, sessionId);
  if (existing && existing.conversation && existing.conversation.identity().sessionOriginId !== sessionOriginId) return false;
  var previous = state(), selections = store.get('contextualSessionSelection');
  if (!showContextualAsk(mate, 'conversation-selection', sessionId)) return false;
  var frame = contextualFrame(mate.id, sessionId);
  if (!frame) return false;
  frame.dataset.expectedSessionOrigin = sessionOriginId;
  if (!beginContextualNativeOrigin(mate)) { store.set({ contextualClay: previous, contextualSessionSelection: selections }); return false; }
  if (frame.conversation) frame.conversation.suspend(false);
  syncContextualNativeOrigin();
  return true;
}

export function cycleContextualClay(mate) {
  if (store.get('paneMode') || !mate || !contextualMate(mate.id)) return;
  var current = state();
  if (current.mode === 'opening') return;
  if (current.mode === 'closed') store.set({ contextualPrepared: null });
  if (current.mode === 'popover' && current.mateId === mate.id) { openContextualWorkspace(mate); return; }
  if (store.get('contextualNativeOrigin') && current.mateId !== mate.id && !finishContextualNativeOrigin()) return;
  if (!store.get('contextualNativeOrigin') && !beginContextualNativeOrigin(mate)) return;
  ensureSurface();
  var frame = contextualFrame(mate.id) || createFrame(mate);
  store.set({ contextualClay: { mode: 'popover', mateId: mate.id, sessionId: frame.dataset.sessionId ? Number(frame.dataset.sessionId) : null } });
  if (frame.conversation) frame.conversation.suspend(false);
  host().dataset.focusEntry = 'true'; syncContextualNativeOrigin(); enterComposer();
}

export function initContextualClay() {
  if (store.get('paneMode')) {
    initContextualSession();
    return;
  }
  initContextualMateHint(activateContextualMate);
  initContextualGeometry();
  initClayControlActivity();
  initContextualWorkspace();
  document.addEventListener('pointerdown', function (event) {
    if (host() && !host().contains(event.target)) host().querySelectorAll('details[open]').forEach(function (menu) { menu.open = false; });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !event.defaultPrevented && contextualClayMode() === 'popover') {
      escapePopover(event);
    }
  });
  // Keep the same trigger accessible when the desktop rail is hidden.
  var entry = document.querySelector('.icon-strip-brand');
  var rail = entry && entry.parentNode;
  var next = entry && entry.nextSibling;
  var mobile = window.matchMedia('(max-width: 768px)');
  function placeTrigger() {
    if (!entry) return;
    document.body.classList.toggle('contextual-clay-mobile', mobile.matches);
    entry.classList.toggle('contextual-clay-mobile-trigger', mobile.matches);
    if (mobile.matches) document.body.prepend(entry);
    else rail.insertBefore(entry, next && next.parentNode === rail ? next : rail.firstChild);
    render();
  }
  mobile.addEventListener('change', placeTrigger);
  window.addEventListener('resize', function () { if (host()) positionContextualClay(); });
  placeTrigger();
  store.subscribe(function (value, previous) {
    var current = state();
    if (host()) host().querySelectorAll('iframe').forEach(function (frame) {
      var mate = contextualMate(frame.dataset.mateId);
      if (frame.dataset.discarding === 'true') return;
      if (frame.dataset.ownerId !== (value.myUserId || '') || !mate || frame.dataset.identityStamp !== contextualMateStamp(mate)) { frame.dataset.discarding = 'true'; frame.remove(); abandonContextualNativeOrigin(frame.dataset.mateId); }
      else frame.title = getHomeMateName(mate) + ' conversation';
    });
    if (current.mateId && !current.startingAsk && !contextualFrame(current.mateId)) {
      store.set({ contextualClay: { mode: 'closed', mateId: null } }); render(); return;
    }
    if (value.contextualMatePending && !value.contextualWorkspace && !value.pendingProjectSessionNavigation) {
      var pending = value.contextualMatePending;
      store.set({ contextualMatePending: null }); activateContextualMate(pending); return;
    }
    // Ordinary navigation refreshes context without replacing the conversation.
    // Direct navigation into a native Mate workspace ends the floating surface.
    if (current.mode === 'popover' && value.currentSlug !== previous.currentSlug && (value.currentSlug || '').indexOf('mate-') === 0) dismissContextualClay(false);
    render();
  });
}
