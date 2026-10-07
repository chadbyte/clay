import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { refreshIcons } from './icons.js';
import { linearIconMarkup } from './session-github.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';

function esc(value) { return escapeHtml(String(value || '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function panel() { return document.getElementById('linear-panel'); }
function content() { return panel().querySelector('.linear-content'); }
function notice(text) { panel().querySelector('[role="status"]').textContent = text; }
function updateExternalLink(issue) {
  var link = panel() && panel().querySelector('[data-linear-external]');
  if (!link) return;
  var heading = panel().querySelector('[data-linear-window-title]');
  var identifier = panel().querySelector('[data-linear-window-id]');
  heading.textContent = issue ? issue.title || 'Linear issue' : 'Linear';
  heading.title = heading.textContent;
  identifier.textContent = issue ? issue.identifier || '' : '';
  var url = issue && issue.url;
  var valid = /^https:\/\/linear\.app\/[a-zA-Z0-9_-]+\/issue\/[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(url || '');
  link.hidden = !valid;
  if (valid) link.setAttribute('href', url); else link.removeAttribute('href');
}
function request(action, args) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { notice('Reconnect to use Linear.'); return; }
  if (action === 'linear_read' && !args.cursor) {
    store.set({ linearIssue: null, linearMatches: [] }); content().textContent = '';
    updateExternalLink(null);
  }
  var id = crypto.randomUUID();
  store.set({ linearRequest: { id: id, action: action, args: args, project: store.get('currentSlug'), socket: ws } });
  notice('Loading…');
  ws.send(JSON.stringify({ type: action, args: args, requestId: id }));
  return id;
}
var SAFE_CLASS = /^(hljs[a-z0-9-]*|language-[a-z0-9+#-]+|task-list-item|contains-task-list)$/;
function keepSafeClasses(node) {
  if (!node.getAttribute || !node.hasAttribute('class')) return;
  var kept = node.getAttribute('class').split(/\s+/).filter(function (name) { return SAFE_CLASS.test(name); });
  if (kept.length) node.setAttribute('class', kept.join(' ')); else node.removeAttribute('class');
}
function prose(text) {
  var element = document.createElement('template');
  element.innerHTML = renderMarkdown(text || '');
  // Private Linear attachments need authenticated delivery; keep them as links for now.
  element.content.querySelectorAll('img').forEach(function (image) {
    var link = document.createElement('a');
    link.textContent = image.alt || 'View attachment in Linear';
    link.href = (store.get('linearIssue') || {}).url || 'https://linear.app'; link.target = '_blank'; link.rel = 'noopener noreferrer';
    image.replaceWith(link);
  });
  // Task-list checkboxes are inputs (forbidden below); keep their state as text.
  element.content.querySelectorAll('input[type="checkbox"]').forEach(function (box) { box.replaceWith(document.createTextNode(box.checked ? '\u2611 ' : '\u2610 ')); });
  // Typography needs only code-highlight and task-list classes; ids and inline styles stay stripped.
  DOMPurify.addHook('afterSanitizeAttributes', keepSafeClasses);
  try {
    return '<div class="md-content">' + DOMPurify.sanitize(element.innerHTML, { ALLOW_DATA_ATTR: false, FORBID_TAGS: ['form', 'button', 'input', 'select', 'textarea', 'iframe', 'video', 'audio', 'style'], FORBID_ATTR: ['id', 'style'] }) + '</div>';
  } finally { DOMPurify.removeHook('afterSanitizeAttributes'); }
}
function chronologicalComments(comments) {
  return (comments || []).slice().sort(function (a, b) {
    var first = Date.parse(a.createdAt), second = Date.parse(b.createdAt);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return 0;
    return first - second;
  });
}
function commentMarkup(comment) {
  var date = new Date(comment.createdAt);
  var timestamp = Number.isFinite(date.getTime()) ? '<time datetime="' + esc(date.toISOString()) + '" title="' + esc(date.toLocaleString()) + '">' + esc(date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) + '</time>' : '';
  return '<article class="linear-comment"><header><strong>' + esc(comment.author) + '</strong>' + timestamp + '</header><div class="issue-doc-body">' + prose(comment.body) + '</div></article>';
}
function renderIssue() {
  var issue = store.get('linearIssue'), sessions = store.get('linearMatches') || [];
  if (!issue) return;
  updateExternalLink(issue);
  var active = (store.get('githubWorkSessions') || []).find(function (item) { return item.id === store.get('activeSessionId'); });
  var linked = !!(active && (active.linearLinks || []).some(function (item) { return item.url === issue.url; }));
  var prs = active && linked ? (active.githubLinks || []).filter(function (item) { return item.kind === 'pr' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(item.url); }) : [];
  content().innerHTML = '<article class="issue-detail"><div class="linear-issue-meta"><span class="linear-issue-id" aria-label="Issue identifier">' + esc(issue.identifier) + '</span>' + (issue.stateName ? '<span class="linear-issue-status" aria-label="Status">' + esc(issue.stateName) + '</span>' : '') + '</div><h2 class="issue-doc-title">' + esc(issue.title) + '</h2>' +
    '<section class="linear-conversations"><h3>Linked conversations</h3><div class="linear-session-pills">' +
    sessions.map(function (item) { return '<button type="button" class="linear-session-pill" data-linear-session="' + esc(item.sessionId) + '"><i data-lucide="message-square"></i><span>' + esc(item.title || 'Open conversation') + '</span></button>'; }).join('') +
    '<button type="button" class="linear-session-pill linear-action-chip" data-linear-link' + (!store.get('activeSessionId') ? ' disabled' : '') + '><i data-lucide="' + (linked ? 'unlink' : 'plus') + '"></i><span>' + (linked ? 'Unlink this conversation' : 'Link this conversation') + '</span></button>' +
    (!sessions.length ? '<button type="button" class="linear-session-pill linear-action-chip" data-linear-start><i data-lucide="plus"></i><span>Start work</span></button>' : '') +
    '</div><p class="linear-sharing-hint">Linked issue titles and status are visible to conversation viewers.</p></section>' +
    (prs.length ? '<section><h3>GitHub pull requests</h3>' + prs.map(function (pr) { return '<a target="_blank" rel="noopener noreferrer" href="' + esc(pr.url) + '">PR #' + esc(pr.number) + ' · ' + esc(pr.title) + '</a>'; }).join('<br>') + '</section>' : '') +
    '<div class="issue-doc-body">' + prose(issue.description) + '</div><section class="issue-discussion"><h3>Comments</h3>' +
    (issue.comments.length ? chronologicalComments(issue.comments).map(commentMarkup).join('') : '<p>No comments yet.</p>') +
    (issue.pageInfo && issue.pageInfo.hasNextPage ? '<button type="button" data-linear-more>More comments</button>' : '') + '</section></article>';
  refreshIcons(content());
}
function showEmpty() {
  updateExternalLink(null);
  store.set({ linearIssue: null, linearRequest: null, linearMatches: [] });
  content().innerHTML = '<div class="linear-empty"><strong>No issue selected</strong><p>Open a linked Linear issue from a conversation badge, or ask the Driver to find and link one. Manage your connection in Settings \u2192 Integrations.</p></div>';
  notice('');
}
export function closeLinear() {
  updateExternalLink(null);
  if (panel()) panel().classList.add('hidden');
  store.set({ linearOpen: false, linearRequest: null, linearIssue: null, linearMatches: [] });
  releaseRightWorkbench('linear');
}
export function openLinear(url) {
  initLinearPanel();
  if (!panel() || store.get('isMate')) return;
  claimRightWorkbench('linear');
  panel().classList.remove('hidden'); store.set({ linearOpen: true });
  updateExternalLink(null);
  if (url) { content().textContent = ''; request('linear_read', { url: url }); }
  else showEmpty();
}
export function handleLinearResult(msg) {
  var pending = store.get('linearRequest');
  if (!pending || !store.get('linearOpen') || pending.id !== msg.requestId || pending.project !== store.get('currentSlug') || msg.projectSlug !== pending.project || pending.socket !== getWs()) return;
  store.set({ linearRequest: null });
  panel().querySelectorAll('button').forEach(function (button) { button.disabled = false; });
  if (msg.error) { notice(msg.error); return; }
  notice('');
  var result = msg.result || {};
  if (msg.action === 'linear_read') {
    var issue = result.issue, old = store.get('linearIssue');
    if (pending.args.cursor && old && old.url === issue.url) issue.comments = old.comments.concat(issue.comments).filter(function (item, index, all) { return all.findIndex(function (other) { return item.id === other.id; }) === index; });
    store.set({ linearIssue: issue, linearMatches: result.matchingSessions }); renderIssue();
  } else if (msg.action === 'linear_link' || msg.action === 'linear_unlink') request('linear_read', { url: pending.args.url });
  else if (msg.action === 'linear_start_work' || msg.action === 'linear_open_work') { request('linear_read', { url: pending.args.url }); }
}
export function initLinearPanel() {
  var host = document.getElementById('main-panels');
  if (!host || panel()) return;
  var el = document.createElement('section'); el.id = 'linear-panel'; el.className = 'hidden'; el.setAttribute('aria-label', 'Linear issues');
  el.innerHTML = '<header class="linear-topbar"><div class="linear-title">' + linearIconMarkup() + '<a class="linear-header-issue" data-linear-external hidden target="_blank" rel="noopener noreferrer" aria-label="Open issue in Linear" title="Open in Linear"><span data-linear-window-id></span><i data-lucide="external-link"></i></a><span class="linear-window-title" data-linear-window-title>Linear</span></div><div class="linear-window-actions"><button type="button" class="linear-icon-btn" data-linear-close aria-label="Close Linear" title="Close Linear"><i data-lucide="x"></i></button></div></header><p class="linear-notice" role="status"></p><div class="linear-content"></div>';
  host.appendChild(el); registerRightWorkbench('linear', closeLinear); refreshIcons(el);
  el.addEventListener('click', function (event) {
    var button = event.target.closest('button'); if (!button) return;
    var issue = store.get('linearIssue');
    if (button.hasAttribute('data-linear-close')) closeLinear();
    else if (issue && button.hasAttribute('data-linear-link')) {
      var active = (store.get('githubWorkSessions') || []).find(function (item) { return item.id === store.get('activeSessionId'); });
      var linked = active && (active.linearLinks || []).some(function (item) { return item.url === issue.url; });
      button.disabled = true; request(linked ? 'linear_unlink' : 'linear_link', { url: issue.url, sessionId: store.get('activeSessionId') });
    } else if (issue && button.dataset.linearSession) { button.disabled = true; request('linear_open_work', { url: issue.url, sessionId: Number(button.dataset.linearSession) }); }
    else if (issue && button.hasAttribute('data-linear-start')) { button.disabled = true; request('linear_start_work', { url: issue.url }); }
    else if (issue && button.hasAttribute('data-linear-more')) { button.disabled = true; request('linear_read', { url: issue.url, cursor: issue.pageInfo.endCursor }); }
  });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && store.get('linearOpen')) closeLinear(); });
  store.subscribe(function (state, previous) {
    if (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.dmMode !== previous.dmMode || (previous.connected && !state.connected)) closeLinear();
    else if (state.linearOpen && (state.githubWorkSessions !== previous.githubWorkSessions || state.activeSessionId !== previous.activeSessionId) && state.linearIssue) renderIssue();
  });
}
