// The owner's You workbench reuses the Logs reading surfaces.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { renderList, renderDetail, categoryLabel } from './project-logs-render.js';
import { registerRightWorkbench, claimRightWorkbench, releaseRightWorkbench } from './right-workbench.js';

var deleteDialog = null;
var deleteDialogFocus = null;
function state() { return store.get('you') || {}; }
function put(values) { store.set({ you: Object.assign({}, state(), values) }); }
function element(id) { return document.getElementById(id); }

export function sendYou(type, values) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return null;
  var sequence = (store.get('youSequence') || 0) + 1;
  store.set({ youSequence: sequence });
  var requestId = 'you-' + sequence;
  ws.send(JSON.stringify(Object.assign({}, values || {}, { type: type, requestId: requestId })));
  return requestId;
}

function requestAttention() { put({ attentionId: sendYou('you_attention') }); }
function showAttention(result) {
  if (result.version < (state().attentionVersion || 0)) return;
  put({ unread: result.unread, attentionVersion: result.version });
  var badge = element('me-unread-badge');
  badge.hidden = !result.unread;
  badge.textContent = result.unread > 99 ? '99+' : String(result.unread);
  var label = 'Me — what Clay knows about me' + (result.unread ? ', ' + result.unread + (result.unread === 1 ? ' unread memory' : ' unread memories') : '');
  element('you-button').setAttribute('aria-label', label);
  element('you-button').title = label;
}
function acknowledgeVisible() {
  var s = state();
  if (!s.open || document.visibilityState !== 'visible' || s.selected !== s.renderedRef || !s.renderedRevision || s.seenId) return;
  var key = s.renderedRef + ':' + s.renderedRevision;
  if (s.acknowledged === key) return;
  put({ seenId: sendYou('you_seen', { ref: s.renderedRef, revision: s.renderedRevision }), acknowledging: key });
}
function unreadRows(entries) {
  element('you-list').querySelectorAll('.project-log-row').forEach(function (row) {
    var entry = entries.find(function (item) { return item.ref === row.dataset.ref; });
    if (!entry || !entry.unread) return;
    var badge = document.createElement('span');
    badge.className = 'me-new-badge'; badge.textContent = entry.revisions > 1 ? 'Updated' : 'New';
    row.querySelector('.project-log-row-head').appendChild(badge);
  });
}

function status(text) { var el = element('you-status'); if (el) el.textContent = text; }
function showList() {
  var wasReading = !!state().selected;
  put({ selected: null, readId: null });
  element('you-detail').classList.add('hidden');
  element('you-list').classList.remove('hidden');
  element('you-toolbar').classList.remove('hidden');
  element('me-introduction').classList.remove('hidden');
  element('you-back').classList.add('hidden');
  element('you-more').classList.toggle('hidden', state().nextOffset == null);
  element('you-list').scrollTop = state().scroll || 0;
  if (wasReading && state().open) requestList();
}
function requestList(more) {
  var s = state();
  var requestId = sendYou('you_list', { query: s.query || '', category: s.category || '', offset: more ? s.nextOffset : 0 });
  put({ listId: requestId, append: !!more });
  status(requestId ? 'Loading…' : 'Reconnect to load what Clay knows about you.');
}
function requestEntry(ref) {
  put({ readId: sendYou('you_read', { ref: ref }), selected: ref, scroll: element('you-list').scrollTop });
  status(state().readId ? 'Loading…' : 'Reconnect to read this memory.');
}
function closeDeleteDialog(force) {
  if (!deleteDialog) return;
  if (!force && state().deleteId) return;
  deleteDialog.classList.add('hidden');
  put({ deleteId: null, deleteEntry: null });
  if (deleteDialogFocus && deleteDialogFocus.isConnected) deleteDialogFocus.focus();
  deleteDialogFocus = null;
}
function sendDelete() {
  var entry = state().deleteEntry;
  if (!entry || state().deleteId) return;
  var requestId = sendYou('you_delete', { ref: entry.ref, expectedRevision: entry.revisions });
  put({ deleteId: requestId });
  var confirm = deleteDialog.querySelector('[data-action="delete"]');
  var cancel = deleteDialog.querySelector('[data-action="cancel"]');
  confirm.disabled = true; cancel.disabled = true;
  deleteDialog.querySelector('.you-delete-dialog-status').textContent = requestId ? 'Deleting memory… Stored audit history remains.' : 'Reconnect to delete this memory.';
  if (requestId) { deleteDialog.tabIndex = -1; deleteDialog.focus(); }
  if (!requestId) { put({ deleteId: null }); confirm.disabled = false; cancel.disabled = false; }
}
function deleteEntry(entry) {
  if (!entry || state().deleteId || !deleteDialog) return;
  put({ deleteEntry: entry });
  deleteDialogFocus = document.activeElement;
  deleteDialog.querySelector('.you-delete-dialog-title').textContent = entry.title || 'Untitled memory';
  deleteDialog.querySelector('.you-delete-dialog-status').textContent = '';
  deleteDialog.querySelector('[data-action="delete"]').disabled = false;
  deleteDialog.querySelector('[data-action="cancel"]').disabled = false;
  deleteDialog.classList.remove('hidden');
  deleteDialog.querySelector('[data-action="cancel"]').focus();
}
function windowState(wide, fullscreen) {
  put({ wide: wide, fullscreen: fullscreen });
  element('you-panel').classList.toggle('project-logs-wide', wide && !fullscreen);
  element('you-panel').classList.toggle('panel-fullscreen', fullscreen);
  element('you-wide').setAttribute('aria-pressed', String(!!wide));
  element('you-fullscreen').setAttribute('aria-pressed', String(!!fullscreen));
  element('you-wide').disabled = !!fullscreen;
}
function filter(categories) {
  var host = element('you-categories');
  host.replaceChildren();
  var summary = document.createElement('summary');
  summary.className = 'project-logs-filter';
  summary.textContent = state().category ? categoryLabel(state().category) : 'All categories';
  host.appendChild(summary);
  var menu = document.createElement('div');
  menu.className = 'you-category-options';
  [''].concat(categories).forEach(function (category) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = category ? categoryLabel(category) : 'All categories';
    button.setAttribute('aria-pressed', String(category === (state().category || '')));
    button.addEventListener('click', function () { put({ category: category }); host.open = false; requestList(); });
    menu.appendChild(button);
  });
  host.appendChild(menu);
}
function ensurePanel() {
  if (element('you-panel')) return;
  var panel = document.createElement('section');
  panel.id = 'you-panel';
  panel.className = 'project-logs-panel hidden';
  panel.setAttribute('aria-label', 'Me — what Clay knows about me');
  panel.innerHTML = '<header class="project-logs-topbar">' +
    '<button id="you-back" class="project-logs-icon-btn hidden" aria-label="Back to memories"><i data-lucide="arrow-left"></i></button>' +
    '<span class="project-logs-title"><span class="me-mark" aria-hidden="true"><i data-lucide="user-round"></i></span>Me</span>' +
    '<span class="project-logs-subtitle">What Clay knows about me</span>' +
    '<div class="project-logs-window-actions"><button id="you-wide" class="project-logs-icon-btn" aria-label="Widen Me" aria-pressed="false"><i data-lucide="chevrons-left-right"></i></button>' +
    '<button id="you-fullscreen" class="project-logs-icon-btn" aria-label="Toggle Me fullscreen" aria-pressed="false"><i data-lucide="maximize-2"></i></button>' +
    '<button id="you-close" class="project-logs-icon-btn" aria-label="Close Me"><i data-lucide="x"></i></button></div></header>' +
    '<p id="me-introduction" class="me-introduction">Clay remembers your preferences, working style, and what matters to you, so you don’t have to explain them again in every project or to every Mate. Here you can review what Clay knows about you and leave comments to refine it.</p>' +
    '<div id="you-toolbar" class="project-logs-toolbar"><label class="project-logs-search"><i data-lucide="search"></i><input id="you-search" type="search" aria-label="Search memories" placeholder="Search what Clay knows" autocomplete="off"></label><details id="you-categories" class="you-categories"></details></div>' +
    '<p id="you-status" class="you-status" role="status"></p>' +
    '<div id="you-pending" class="you-pending hidden"><span></span><button id="you-retry" type="button">Ask Clay to review</button></div>' +
    '<div id="you-list" class="project-logs-list" role="list"></div><main id="you-detail" class="project-logs-detail hidden"></main>' +
    '<button id="you-more" type="button" class="you-more hidden">Load more</button>';
  document.getElementById('main-panels').appendChild(panel);
  var dialog = document.createElement('div');
  dialog.className = 'project-log-delete-dialog you-delete-dialog hidden';
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'you-delete-heading'); dialog.tabIndex = -1;
  dialog.innerHTML = '<div class="project-log-delete-dialog-card"><h2 id="you-delete-heading">Delete this memory?</h2><p>This removes the memory from Me immediately. Clay’s audit history will retain that it was deleted.</p><p class="project-log-delete-dialog-title you-delete-dialog-title"></p><p class="project-log-delete-dialog-status you-delete-dialog-status" role="status"></p><div class="project-log-delete-dialog-actions"><button type="button" data-action="cancel">Cancel</button><button type="button" class="danger" data-action="delete">Delete memory</button></div></div>';
  panel.appendChild(dialog); deleteDialog = dialog;
  dialog.querySelector('[data-action="cancel"]').addEventListener('click', function () { closeDeleteDialog(false); });
  dialog.querySelector('[data-action="delete"]').addEventListener('click', sendDelete);
  dialog.addEventListener('keydown', function (event) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); closeDeleteDialog(false); return; }
    if (event.key === 'Tab') {
      var buttons = Array.from(dialog.querySelectorAll('button:not(:disabled)'));
      if (!buttons.length) { event.preventDefault(); dialog.focus(); return; }
      var first = buttons[0]; var last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDeleteDialog(false); });
  element('you-close').addEventListener('click', closeYou);
  element('you-back').addEventListener('click', showList);
  element('you-wide').addEventListener('click', function () { windowState(!state().wide, false); });
  element('you-fullscreen').addEventListener('click', function () { windowState(state().wide, !state().fullscreen); });
  element('you-more').addEventListener('click', function () { requestList(true); });
  element('you-search').addEventListener('input', function () {
    clearTimeout(state().searchTimer);
    put({ query: this.value, searchTimer: setTimeout(function () { requestList(); }, 180) });
  });
  element('you-retry').addEventListener('click', function () {
    put({ retryId: sendYou('you_retry') });
    status(state().retryId ? 'Asked Clay to review pending observations.' : 'Reconnect to request a review.');
  });
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.stopPropagation(); closeYou(); }
    if (event.key === 'Tab' && window.matchMedia('(max-width: 1023px)').matches) {
      var nodes = Array.from(panel.querySelectorAll('button:not(:disabled),input,textarea,summary')).filter(function (node) { return node.getClientRects().length; });
      var first = nodes[0]; var last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  filter([]);
  refreshIcons();
}

export function openYou(ref) {
  ensurePanel();
  put({ returnFocus: document.activeElement, open: true });
  claimRightWorkbench('you');
  element('you-button').classList.add('active');
  element('you-button').setAttribute('aria-pressed', 'true');
  element('you-panel').classList.remove('hidden');
  element('you-panel').setAttribute('role', 'dialog');
  element('you-panel').setAttribute('aria-modal', String(window.matchMedia('(max-width: 1023px)').matches));
  windowState(state().wide, false);
  showList();
  requestList();
  if (ref) requestEntry(ref);
  if (ref) element('you-close').focus(); else element('you-search').focus();
}
export function closeYou() {
  closeDeleteDialog(true);
  releaseRightWorkbench('you');
  if (!state().open) return;
  element('you-panel').classList.add('hidden');
  element('you-button').classList.remove('active');
  element('you-button').setAttribute('aria-pressed', 'false');
  windowState(state().wide, false);
  var focus = state().returnFocus;
  put({ open: false });
  if (focus && focus.isConnected) focus.focus();
}
export function handleYouMessage(msg) {
  if (msg.type === 'you_reviewed') { if (state().open) { requestList(); if (state().selected) requestEntry(state().selected); } return; }
  if (msg.type === 'you_changed') {
    if (msg.activity && msg.activity.deleted) {
      requestAttention();
      if (state().selected === msg.activity.ref) {
        if (state().deleteEntry && state().deleteEntry.ref === msg.activity.ref) closeDeleteDialog(true);
        put({ readId: null, renderedRef: null, renderedRevision: null });
        showList();
        element('you-search').focus();
        status('This memory was deleted and is no longer available.');
      } else if (state().open) requestList();
      return;
    }
    requestAttention();
    if (msg.activity && msg.activity.seen) { if (state().open && !state().selected) requestList(); return; }
    if (msg.activity && msg.activity.error) { status(msg.activity.error); return; }
    if (state().open) { requestList(); if (state().selected) requestEntry(state().selected); }
    return;
  }
  var s = state();
  var key = { you_attention: 'attentionId', you_seen: 'seenId', you_list: 'listId', you_read: 'readId', you_comment: 'commentId', you_retry: 'retryId', you_delete: 'deleteId' }[msg.operation];
  if (!key || !s[key] || s[key] !== msg.requestId) return;
  var cleared = {}; cleared[key] = null; put(cleared);
  if (msg.operation === 'you_comment' && element('you-comment-input')) element('you-comment-input').form.querySelector('button').disabled = false;
  if (msg.operation === 'you_attention') { if (msg.ok) showAttention(msg.result); return; }
  if (msg.operation === 'you_seen') {
    if (msg.ok) { put({ acknowledged: s.acknowledging }); showAttention(msg.result); acknowledgeVisible(); }
    return;
  }
  if (!state().open && msg.operation === 'you_read') return;
  if (!msg.ok) {
    if (msg.operation === 'you_read') showList();
    if (msg.operation === 'you_delete' && deleteDialog) {
      deleteDialog.querySelector('[data-action="delete"]').disabled = false;
      deleteDialog.querySelector('[data-action="cancel"]').disabled = false;
      deleteDialog.querySelector('.you-delete-dialog-status').textContent = msg.error || 'The memory could not be deleted. Try again.';
    }
    status(msg.error || 'Clay could not complete this request.'); return;
  }
  status('');
  var result = msg.result;
  if (msg.operation === 'you_delete') {
    closeDeleteDialog(true);
    put({ deleteEntry: null });
    showList();
    element('you-search').focus();
    requestAttention();
    status('Memory deleted. Stored audit history remains.');
  } else if (msg.operation === 'you_list') {
    var entries = s.append ? (s.entries || []).concat(result.items) : result.items;
    put({ entries: entries, nextOffset: result.nextOffset });
    var emptyMessage = state().query || state().category
      ? 'No memories match this search. Try another keyword or category.'
      : 'No memories yet. They’ll appear here as Clay gets to know you.';
    renderList(element('you-list'), entries, requestEntry, emptyMessage);
    unreadRows(entries);
    filter(result.categories);
    element('you-more').classList.toggle('hidden', result.nextOffset == null || !!state().selected);
    element('you-pending').classList.toggle('hidden', !result.pending);
    element('you-pending').querySelector('span').textContent = result.pending + (result.pending === 1 ? ' observation awaiting Clay’s review' : ' observations awaiting Clay’s review');
  } else if (msg.operation === 'you_read') {
    element('me-introduction').classList.add('hidden');
    element('you-list').classList.add('hidden'); element('you-toolbar').classList.add('hidden'); element('you-more').classList.add('hidden');
    element('you-detail').classList.remove('hidden'); element('you-back').classList.remove('hidden');
    var previousInput = element('you-comment-input');
    var draft = previousInput && previousInput.dataset.ref === result.ref ? previousInput.value : '';
    renderDetail(element('you-detail'), result, { commentPrefix: 'you', commentReviewer: 'Clay', canDelete: !result.deleted, deleteLabel: 'Delete memory', onDelete: deleteEntry, onComment: function (ref, body, feedback, input) {
      if (state().commentId) return;
      put({ commentId: sendYou('you_comment', { ref: ref, body: body }), commentRef: ref });
      input.form.querySelector('button').disabled = !!state().commentId;
      feedback.textContent = state().commentId ? 'Sending to Clay for review…' : 'Reconnect to post your comment.';
    } });
    element('you-comment-input').value = draft;
    element('you-comment-input').dataset.ref = result.ref;
    element('you-comment-input').form.querySelector('button').disabled = !!state().commentId;
    var evidence = document.createElement('p'); evidence.className = 'you-evidence';
    evidence.textContent = (result.evidenceType === 'inferred' ? 'Inferred from: ' : 'You said: ') + (result.evidence || '') + '\nClay’s decision: ' + result.reason;
    element('you-detail').querySelector('.project-log-markdown').after(evidence);
    put({ renderedRef: result.ref, renderedRevision: result.revisions });
    requestAnimationFrame(acknowledgeVisible);
  } else if (msg.operation === 'you_comment') {
    if (element('you-comment-input') && element('you-comment-input').dataset.ref === s.commentRef) element('you-comment-input').value = '';
    if (state().selected) requestEntry(state().selected);
  }
}
export function initYou() {
  registerRightWorkbench('you', closeYou);
  document.addEventListener('visibilitychange', acknowledgeVisible);
  if (store.get('connected')) requestAttention();
  element('you-button').addEventListener('click', function () { openYou(); });
  store.subscribe(function (next, previous) {
    if (next.currentSlug !== previous.currentSlug || next.myUserId !== previous.myUserId) {
      closeDeleteDialog(true); closeYou(); clearTimeout(state().searchTimer);
      if (next.myUserId !== previous.myUserId) { if (element('you-panel')) element('you-panel').remove(); put({ entries: [], query: '', category: '', attentionVersion: 0, acknowledged: null, attentionId: null, seenId: null }); showAttention({ unread: 0, version: 0 }); }
      put({ listId: null, readId: null, commentId: null, retryId: null, seenId: null, deleteId: null, deleteEntry: null });
      if (element('you-comment-input')) element('you-comment-input').form.querySelector('button').disabled = false;
    }
    if (previous.connected && !next.connected) {
      put({ commentId: null, seenId: null, attentionId: null });
      if (state().deleteId && deleteDialog) {
        put({ deleteId: null });
        deleteDialog.querySelector('[data-action="delete"]').disabled = false;
        deleteDialog.querySelector('[data-action="cancel"]').disabled = false;
        deleteDialog.querySelector('.you-delete-dialog-status').textContent = 'Disconnected. Reconnect before deleting. Stored audit history remains.';
      }
      if (element('you-comment-input')) element('you-comment-input').form.querySelector('button').disabled = false;
      if (state().open) status('Disconnected. Reconnect before sending or refreshing.');
    }
    if ((!previous.connected && next.connected) || (next.myUserId !== previous.myUserId && next.connected)) { requestAttention(); if (state().open) { requestList(); acknowledgeVisible(); } }
  });
}
