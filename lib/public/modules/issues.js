import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { refreshIcons } from './icons.js';
import { renderIssueList, renderIssueDetail, renderIssueForm, renderIssueHistory, statusLabel } from './issues-render.js';
function panel() { return document.getElementById('issues-panel'); }
function content() { return panel().querySelector('.issues-content'); }
function bumpViewGeneration() { store.set({ issuesViewGeneration: (store.get('issuesViewGeneration') || 0) + 1 }); }
function request(action, args, intent) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { showToast('Reconnect to use Issues', 'warn'); return; }
  var id = 'issues-' + crypto.randomUUID();
  var pending = Object.assign({}, store.get('issuesRequests') || {});
  pending[id] = { action: action, intent: intent, slug: store.get('currentSlug'), sourceRef: entryRef(), view: store.get('issuesView'), viewGeneration: store.get('issuesViewGeneration') || 0 };
  store.set({ issuesRequests: pending });
  ws.send(JSON.stringify({ type: action, args: args || {}, requestId: id }));
  return id;
}
function markMutation(id, details) {
  if (!id) return;
  var pending = Object.assign({}, store.get('issuesRequests') || {});
  if (!pending[id]) return;
  pending[id] = Object.assign({}, pending[id], details || {});
  store.set({ issuesRequests: pending });
}
function listing(cursor) {
  var args = { limit: 50, query: panel().querySelector('[name="query"]').value };
  ['status', 'type'].forEach(function (key) { var value = panel().querySelector('[name="filter-' + key + '"]').value; if (value) args[key] = value; });
  if (cursor) args.cursor = cursor;
  bumpViewGeneration(); store.set({ issuesView: 'list', issuesSelected: null });
  panel().querySelector('.issues-filters').hidden = false;
  panel().querySelector('[data-issues-back]').classList.add('hidden');
  store.set({ issuesViewRequest: request('issues_list', args, cursor ? 'more' : 'list') });
}
function detail(entry) {
  panel().querySelector('.issues-notice').textContent = '';
  bumpViewGeneration(); store.set({ issuesSelected: entry, issuesView: 'detail' });
  panel().querySelector('.issues-filters').hidden = true;
  panel().querySelector('[data-issues-back]').classList.remove('hidden');
  content().innerHTML = renderIssueDetail(entry);
  refreshIcons();
}
function entryRef() {
  var entry = store.get('issuesSelected');
  return entry && entry.ref;
}
function closeDeleteDialog() {
  var dialog = panel().querySelector('.issues-delete-dialog');
  if (dialog) dialog.classList.add('hidden');
}
function deleteDialogKeydown(event) {
  var dialog = panel().querySelector('.issues-delete-dialog');
  if (!dialog || dialog.classList.contains('hidden')) return;
  var buttons = dialog.querySelectorAll('button:not(:disabled)');
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDeleteDialog(); return; }
  if (event.key !== 'Tab' || !buttons.length) return;
  var index = Array.prototype.indexOf.call(buttons, document.activeElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
  else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0].focus(); }
}
function openDeleteDialog(entry) {
  if (!entry || !entry.canDelete) return;
  var dialog = panel().querySelector('.issues-delete-dialog');
  dialog.querySelector('.issues-delete-title').textContent = entry.title;
  dialog.querySelector('.issues-delete-status').textContent = '';
  dialog.querySelector('[data-issue-delete-confirm]').disabled = false;
  dialog.classList.remove('hidden');
  dialog.querySelector('[data-issue-delete-cancel]').focus();
}
function confirmDelete() {
  var entry = store.get('issuesSelected');
  if (!entry) return;
  var dialog = panel().querySelector('.issues-delete-dialog');
  dialog.querySelector('.issues-delete-status').textContent = 'Deleting...';
  dialog.querySelector('[data-issue-delete-confirm]').disabled = true;
  store.set({ issuesMutationRequest: request('issue_delete', { ref: entry.ref, expectedRevision: entry.revision }, 'delete') });
}
export function closeIssues() {
  releaseRightWorkbench("issues");
  bumpViewGeneration();
  if (panel()) panel().classList.add('hidden');
  store.set({ issuesOpen: false });
  var button = document.getElementById('issues-btn');
  if (button) button.classList.remove('active');
}
export function openIssues(ref) {
  if (!panel() || store.get('isMate')) return;
  panel().querySelector('.issues-notice').textContent = '';
  bumpViewGeneration();
  claimRightWorkbench("issues");
  panel().classList.remove('hidden');
  store.set({ issuesOpen: true });
  var button = document.getElementById('issues-btn');
  if (button) button.classList.add('active');
  if (ref) { store.set({ issuesView: 'detail', issuesSelected: null, issuesViewRequest: request('issue_read', { ref: ref }, 'detail') }); }
  else listing();
}
export function initIssues() {
  var host = document.getElementById('main-panels');
  if (!host || panel()) return;
  registerRightWorkbench("issues", closeIssues);
  var el = document.createElement('section');
  el.id = 'issues-panel'; el.className = 'hidden'; el.setAttribute('aria-label', 'Project Issues');
  el.innerHTML = '<header class="issues-topbar"><button class="issues-icon-btn" data-issues-back aria-label="Back to issues" title="Back to issue list"><i data-lucide="arrow-left"></i></button><span class="issues-title"><i data-lucide="circle-dot"></i>Issues</span><span class="issues-subtitle">Manage issues through Driver chat.</span><div class="issues-window-actions"><button class="issues-icon-btn" data-issues-wide aria-label="Widen Issues" title="Widen Issues" aria-pressed="false"><i data-lucide="chevrons-left-right"></i></button><button class="issues-icon-btn" data-issues-full aria-label="Toggle Issues fullscreen" title="Toggle fullscreen" aria-pressed="false"><i data-lucide="maximize-2"></i></button><button class="issues-icon-btn" data-issues-close aria-label="Close Issues" title="Close Issues"><i data-lucide="x"></i></button></div></header><div class="issues-filters"><label class="issues-search"><i data-lucide="search"></i><input name="query" type="search" placeholder="Search issues" aria-label="Search issues"></label><select name="filter-status" aria-label="Filter status"><option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><select name="filter-type" aria-label="Filter type"><option value="">All types</option><option>bug</option><option>feature</option><option>plan</option></select></div><p class="issues-notice" role="status"></p><main class="issues-content" role="region" aria-live="polite"></main><div class="issues-delete-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="issues-delete-heading"><div class="issues-delete-card"><h2 id="issues-delete-heading">Delete this issue?</h2><p>This removes the issue from the board but preserves its history.</p><p class="issues-delete-title"></p><p class="issues-delete-status" role="status"></p><div><button type="button" data-issue-delete-cancel>Cancel</button><button type="button" data-issue-delete-confirm>Delete issue</button></div></div></div>';
  host.appendChild(el);
  var button = document.getElementById('issues-btn');
  if (button) button.addEventListener('click', function () { if (store.get('issuesOpen')) closeIssues(); else openIssues(); });
  el.addEventListener('change', function (event) { if (event.target.closest('.issues-filters')) listing(); });
  el.querySelector('[name="query"]').addEventListener('input', function () { clearTimeout(store.get('issuesSearchTimer')); store.set({ issuesSearchTimer: setTimeout(function () { listing(); }, 200) }); });
  el.addEventListener('click', function (event) {
    var target = event.target.closest('button'); if (!target) return;
    var entry = store.get('issuesSelected');
    if (target.hasAttribute('data-issues-close')) closeIssues();
    else if (target.hasAttribute('data-issues-back')) listing();
    else if (target.hasAttribute('data-issue-delete')) openDeleteDialog(entry);
    else if (target.hasAttribute('data-issue-delete-cancel')) closeDeleteDialog();
    else if (target.hasAttribute('data-issue-delete-confirm')) confirmDelete();
    else if (target.hasAttribute('data-issue-edit')) showIssueEdit(entry);
    else if (target.hasAttribute('data-issue-cancel')) detail(entry);
    else if (target.dataset.openIssue) openIssues(target.dataset.openIssue);
    else if (target.hasAttribute('data-issues-more')) listing(target.dataset.issuesMore);
    else if (target.hasAttribute('data-issue-history')) { bumpViewGeneration(); store.set({ issuesView: 'history', issuesViewRequest: request('issue_history', { ref: entry.ref }, 'history') }); }
    else if (target.dataset.issueRevision) { bumpViewGeneration(); store.set({ issuesView: 'revision', issuesViewRequest: request('issue_revision', { ref: entry.ref, revision: Number(target.dataset.issueRevision) }, 'revision') }); }
    else if (target.hasAttribute('data-issue-copy')) navigator.clipboard.writeText(entry.ref).catch(function () { showToast(entry.ref); });
    else if (target.hasAttribute('data-issue-work')) { target.disabled = true; request('issue_start_work', { ref: entry.ref, expectedRevision: entry.revision }, 'work'); }
    else if (target.dataset.issueSession) request('issue_open_work', { ref: entry.ref, sessionOriginId: target.dataset.issueSession }, 'work');
    else if (target.hasAttribute('data-issues-wide') || target.hasAttribute('data-issues-full')) { var name = target.hasAttribute('data-issues-wide') ? 'issues-wide' : 'panel-fullscreen'; var active = el.classList.toggle(name); target.setAttribute('aria-pressed', String(active)); }
  });
  refreshIcons();
  el.addEventListener('submit', function (event) {
    if (event.target.id === 'issue-comment-form') {
      event.preventDefault(); var input = event.target.querySelector('#issue-comment-input'); var status = event.target.querySelector('.issue-comment-status');
      if (!input.value.trim()) { status.textContent = 'A comment cannot be empty.'; return; }
      var commentRef = entryRef(); var commentBody = input.value.trim(); var commentRequest = request('issue_comment', { ref: commentRef, body: commentBody }, 'comment');
      markMutation(commentRequest, { ref: commentRef, view: store.get('issuesView'), body: commentBody });
      status.textContent = 'Posting...'; store.set({ issuesMutationRequest: commentRequest }); return;
    }
    if (event.target.id !== 'issue-form') return;
    event.preventDefault();
    var data = Object.fromEntries(new FormData(event.target));
    if (data.status !== 'closed') delete data.closeReason;
    if (data.status !== 'resolved') { delete data.commitSha; delete data.resolutionSummary; }
    var entry = store.get('issuesSelected');
    if (!entry) return;
    data.ref = entry.ref; data.expectedRevision = entry.revision;
    event.target.querySelector('[type="submit"]').disabled = true;
    var saveRequest = request('issue_update', data, 'save');
    markMutation(saveRequest, { ref: entry.ref });
    store.set({ issuesViewRequest: saveRequest });
  });
  el.addEventListener('input', function (event) {
    if (event.target.id === 'issue-comment-input' || event.target.closest('#issue-form')) bumpViewGeneration();
  });
  store.subscribe(function (state, previous) {
    if (state.currentSlug !== previous.currentSlug || (previous.connected && !state.connected)) { closeIssues(); store.set({ issuesRequests: {}, issuesSelected: null, issuesCache: {}, issuesMutationRequest: null }); }
    if (state.issuesOpen && (state.projectLogsOpen || state.scheduledTasksOpen)) closeIssues();
  });
  document.addEventListener('keydown', function (event) { if (store.get('issuesOpen')) { deleteDialogKeydown(event); if (!event.defaultPrevented && event.key === 'Escape') closeIssues(); } });
}
function showIssueEdit(entry) {
  if (!entry) return;
  var detailEl = content();
  panel().querySelector('.issues-filters').hidden = true;
  panel().querySelector('[data-issues-back]').classList.remove('hidden');
  bumpViewGeneration(); store.set({ issuesView: 'edit', issuesSelected: entry, issuesViewRequest: null });
  detailEl.innerHTML = '<p class="issues-edit-note">Update an existing Driver-authored issue. New issues must be discussed and created by the Project Driver.</p>' + renderIssueForm(entry);
  var formEl = document.getElementById('issue-form');
  function syncFields() {
    var status = formEl.elements.status.value;
    formEl.querySelector('[data-resolution-fields]').hidden = status !== 'resolved';
    formEl.querySelector('[data-close-fields]').hidden = status !== 'closed';
  }
  formEl.addEventListener('change', syncFields);
  syncFields();
}
export function handleIssuesMessage(msg) {
  if (msg.type === 'issue_commented') {
    var selected = store.get('issuesSelected');
    var mutationId = store.get('issuesMutationRequest');
    var mutation = mutationId && (store.get('issuesRequests') || {})[mutationId];
    if (mutation && mutation.intent === 'comment' && mutation.action === 'issue_comment') {
      panel().querySelector('.issues-notice').textContent = 'Comment submitted.';
    } else if (store.get('issuesOpen') && selected && selected.ref === msg.ref && store.get('issuesView') === 'detail') {
      var commentInput = panel().querySelector('#issue-comment-input');
      if (commentInput && commentInput.value) panel().querySelector('.issues-notice').textContent = 'An issue comment changed. Your draft is preserved.';
      else store.set({ issuesViewRequest: request('issue_read', { ref: msg.ref }, 'detail') });
    } else if (store.get('issuesOpen') && selected && selected.ref === msg.ref) {
      panel().querySelector('.issues-notice').textContent = 'An issue comment changed. Return to the detail view to refresh it.';
    } else if (store.get('issuesOpen') && store.get('issuesView') === 'list') listing();
    return true;
  }
  if (msg.type === 'issue_deleted') {
    var cache = Object.assign({}, store.get('issuesCache') || {});
    delete cache[msg.ref];
    store.set({ issuesCache: cache });
    document.querySelectorAll('[data-issue-ref]').forEach(function (node) { if (node.dataset.issueRef === msg.ref) { node.textContent = 'Issue unavailable'; node.title = 'This issue was deleted'; node.dataset.status = 'deleted'; } });
    if (store.get('issuesSelected') && store.get('issuesSelected').ref === msg.ref) {
      closeDeleteDialog(); listing();
    } else if (store.get('issuesOpen')) listing();
    return true;
  }
  if (msg.type === 'issue_updated') {
    var cache = Object.assign({}, store.get('issuesCache') || {}); cache[msg.ref] = Object.assign({}, cache[msg.ref] || {}, msg, { projectSlug: store.get('currentSlug') }); store.set({ issuesCache: cache });
    document.querySelectorAll('[data-issue-ref]').forEach(function (node) { if (node.dataset.issueRef === msg.ref) { node.textContent = statusLabel(msg.status) + ' · ' + msg.title; node.dataset.status = msg.status; } });
    if (store.get('issuesOpen')) panel().querySelector('.issues-notice').textContent = 'An issue changed. Back returns to the latest list; reopening an issue loads its latest revision.';
    return true;
  }
  if (msg.type !== 'issues_result') return false;
  var pending = store.get('issuesRequests') || {}; var item = pending[msg.requestId];
  if (!item || item.slug !== store.get('currentSlug')) return true;
  var next = Object.assign({}, pending); delete next[msg.requestId]; store.set({ issuesRequests: next });
  if (item.intent === 'comment' || item.intent === 'delete') {
    if (msg.requestId !== store.get('issuesMutationRequest')) return true;
    store.set({ issuesMutationRequest: null });
  } else if (item.intent !== 'work' && msg.requestId !== store.get('issuesViewRequest')) return true;
  var mutationIntent = item.intent === 'comment' || item.intent === 'delete' || item.intent === 'save';
  var currentEntry = store.get('issuesSelected');
  if (mutationIntent && (item.viewGeneration !== (store.get('issuesViewGeneration') || 0) ||
      item.sourceRef !== (currentEntry && currentEntry.ref) || item.view !== store.get('issuesView'))) {
    if (!msg.error && item.intent !== 'delete' && msg.result && msg.result.ref) {
      var preservedCache = Object.assign({}, store.get('issuesCache') || {});
      preservedCache[msg.result.ref] = Object.assign({}, msg.result, { canDelete: msg.canDelete === true, projectSlug: store.get('currentSlug') });
      store.set({ issuesCache: preservedCache });
    }
    return true;
  }
  if (msg.error) {
    panel().querySelector('.issues-notice').textContent = msg.error;
    if (item.intent === 'comment') {
      var commentStatus = panel().querySelector('.issue-comment-status');
      if (commentStatus) commentStatus.textContent = msg.error;
    }
    if (item.intent === 'delete') {
      var deleteStatus = panel().querySelector('.issues-delete-status');
      if (deleteStatus) deleteStatus.textContent = msg.error;
    }
    panel().querySelectorAll('button:disabled').forEach(function (button) { button.disabled = false; });
    return true;
  }
  panel().querySelector('.issues-notice').textContent = '';
  if (item.intent === 'work') { closeIssues(); return true; }
  if (item.intent === 'comment') {
    var commented = Object.assign({}, msg.result, { canDelete: msg.canDelete === true });
    var currentSelected = store.get('issuesSelected');
    var currentCommentInput = panel().querySelector('#issue-comment-input');
    var sameView = store.get('issuesView') === item.view && currentSelected && currentSelected.ref === item.ref && item.viewGeneration === (store.get('issuesViewGeneration') || 0);
    var unchangedDraft = !currentCommentInput || !currentCommentInput.value || currentCommentInput.value.trim() === item.body;
    if (!sameView || !unchangedDraft) {
      panel().querySelector('.issues-notice').textContent = 'Comment added. Your current view or draft was preserved.';
      return true;
    }
    detail(commented);
    panel().querySelector('.issues-notice').textContent = 'Comment added.';
    return true;
  }
  if (item.intent === 'delete') { closeDeleteDialog(); listing(); return true; }
  if (item.intent === 'list' || item.intent === 'more') {
    var result = msg.result;
    if (item.intent === 'more') result.issues = (store.get('issuesRows') || []).concat(result.issues);
    result = Object.assign({}, result, { query: panel().querySelector('[name="query"]').value,
      status: panel().querySelector('[name="filter-status"]').value, type: panel().querySelector('[name="filter-type"]').value });
    store.set({ issuesRows: result.issues }); content().innerHTML = renderIssueList(result); refreshIcons();
  } else if (item.intent === 'history') { content().innerHTML = renderIssueHistory(msg.result); refreshIcons(); }
  else if (item.intent === 'revision') { content().innerHTML = '<p class="issues-history-note">Historical revision · use Back to return to current issues</p>' + renderIssueDetail(msg.result); content().querySelectorAll('.issue-actions, [data-issue-session]').forEach(function (node) { node.remove(); }); refreshIcons(); }
  else detail(Object.assign({}, msg.result, { canDelete: msg.canDelete === true }));
  return true;
}
