// Account, connection, and project correlation around the Issues workbench.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { openIssues, closeIssues, handleIssuesMessage } from './issues.js';

var updatingRequests = false;

function accountKey(state) {
  return state.isMultiUserMode ? 'user:' + String(state.myUserId || '') : 'single';
}

function context(state) {
  return { accountKey: accountKey(state), projectSlug: state.currentSlug || null, epoch: state.issuesEpoch || 0 };
}

function sameContext(item, state) {
  var current = context(state);
  return !!item && item.accountKey === current.accountKey && item.projectSlug === current.projectSlug && item.epoch === current.epoch;
}

function enableActions() {
  var panel = document.getElementById('issues-panel');
  if (!panel) return;
  panel.querySelectorAll('#issue-form [type="submit"], [data-issue-work]').forEach(function (button) { button.disabled = false; });
}

function resetState(closePanel) {
  var timer = store.get('issuesSearchTimer');
  if (timer) clearTimeout(timer);
  if (closePanel) closeIssues();
  store.set({ issuesRequests: {}, issuesSelected: null, issuesRows: [], issuesCache: {}, issuesViewRequest: null, issuesMutationRequest: null,
    issuesSearchTimer: null, issueLinkRequests: {}, issueLinkOpenRef: null, issuesEpoch: (store.get('issuesEpoch') || 0) + 1 });
  enableActions();
}

function annotateRequests(state) {
  if (updatingRequests) return;
  var requests = state.issuesRequests || {};
  var ids = Object.keys(requests);
  var next = null;
  var current = context(state);
  for (var i = 0; i < ids.length; i++) {
    var item = requests[ids[i]];
    if (item.accountKey !== undefined) continue;
    if (!next) next = Object.assign({}, requests);
    next[ids[i]] = Object.assign({}, item, current);
  }
  if (!next) return;
  updatingRequests = true;
  store.set({ issuesRequests: next });
  updatingRequests = false;
}

function sendOpenSession(target) {
  var ws = getWs();
  var entry = store.get('issuesSelected');
  if (!entry || !ws || ws.readyState !== 1) { showToast('Reconnect to open issue work', 'warn'); return; }
  var id = 'issues-' + crypto.randomUUID();
  var current = context(store.snap());
  var pending = Object.assign({}, store.get('issuesRequests') || {});
  pending[id] = Object.assign({ action: 'issue_open_work', intent: 'work', slug: current.projectSlug }, current);
  store.set({ issuesRequests: pending });
  ws.send(JSON.stringify({ type: 'issue_open_work', requestId: id,
    args: { ref: entry.ref, expectedRevision: entry.revision, sessionOriginId: target.dataset.issueSession } }));
}

export function initIssuesContext() {
  var initial = new URLSearchParams(window.location.search).get('issue');
  var initialOpened = false;
  function tryInitial(state) {
    if (initialOpened || !initial || !/^issue:[A-Za-z0-9_-]{24}$/.test(initial)) return;
    if (!state.connected || !state.currentSlug || (state.isMultiUserMode && !state.myUserId)) return;
    if (state.issuesOpen && state.issuesViewRequest) { initialOpened = true; return; }
    initialOpened = true;
    openIssues(initial);
  }
  store.subscribe(function (state, previous) {
    var accountChanged = state.myUserId !== previous.myUserId || state.isMultiUserMode !== previous.isMultiUserMode;
    if (state.currentSlug !== previous.currentSlug || accountChanged || (previous.connected && !state.connected)) resetState(true);
    else annotateRequests(state);
    if (!previous.connected && state.connected) enableActions();
    tryInitial(state);
  });
  document.addEventListener('click', function (event) {
    var target = event.target.closest && event.target.closest('[data-issue-session], [data-issue-work]');
    if (!target) return;
    if (target.dataset.issueSession) {
      event.preventDefault(); event.stopImmediatePropagation(); sendOpenSession(target); return;
    }
    var ws = getWs();
    if (!ws || ws.readyState !== 1) {
      event.preventDefault(); event.stopImmediatePropagation(); target.disabled = false;
      showToast('Reconnect to start issue work', 'warn');
    }
  }, true);
  document.addEventListener('submit', function (event) {
    if (!event.target || event.target.id !== 'issue-form') return;
    var ws = getWs();
    if (ws && ws.readyState === 1) return;
    event.preventDefault(); event.stopImmediatePropagation(); enableActions();
    showToast('Reconnect to save this issue', 'warn');
  }, true);
  tryInitial(store.snap());
}

export function handleIssuesMessageInContext(msg) {
  var state = store.snap();
  if (msg.type === 'issue_updated' || msg.type === 'issue_commented' || msg.type === 'issue_deleted') {
    if (!msg.projectSlug || msg.projectSlug !== state.currentSlug || (state.isMultiUserMode && !state.myUserId)) return true;
  } else if (msg.type === 'issues_result') {
    var item = (state.issuesRequests || {})[msg.requestId];
    if (!sameContext(item, state)) return true;
  }
  return handleIssuesMessage(msg);
}
