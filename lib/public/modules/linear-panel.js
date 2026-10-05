import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { refreshIcons } from './icons.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';
import { openUserSettings } from './user-settings.js';

function esc(value) { return escapeHtml(String(value || '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function panel() { return document.getElementById('linear-panel'); }
function content() { return panel().querySelector('.linear-content'); }
function notice(text) { panel().querySelector('[role="status"]').textContent = text; }
function request(action, args) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { notice('Reconnect to use Linear.'); return; }
  if (action === 'linear_search' || (action === 'linear_read' && !args.cursor)) {
    store.set({ linearIssue: null, linearMatches: [] }); content().textContent = '';
  }
  var id = crypto.randomUUID();
  store.set({ linearRequest: { id: id, action: action, args: args, project: store.get('currentSlug'), socket: ws } });
  notice('Loading…');
  ws.send(JSON.stringify({ type: action, args: args, requestId: id }));
  return id;
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
  return DOMPurify.sanitize(element.innerHTML, { ALLOW_DATA_ATTR: false, FORBID_TAGS: ['form', 'button', 'input', 'select', 'textarea', 'iframe', 'video', 'audio'], FORBID_ATTR: ['id', 'class', 'style'] });
}
function renderIssue() {
  var issue = store.get('linearIssue'), sessions = store.get('linearMatches') || [];
  if (!issue) return;
  var active = (store.get('githubWorkSessions') || []).find(function (item) { return item.id === store.get('activeSessionId'); });
  var linked = !!(active && (active.linearLinks || []).some(function (item) { return item.url === issue.url; }));
  var prs = active && linked ? (active.githubLinks || []).filter(function (item) { return item.kind === 'pr' && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(item.url); }) : [];
  content().innerHTML = '<article class="issue-detail"><div class="issue-byline">' + esc(issue.identifier) + ' · ' + esc(issue.stateName) + '</div><h2 class="issue-doc-title">' + esc(issue.title) + '</h2>' +
    '<div class="linear-actions"><button type="button" data-linear-link>' + (linked ? 'Unlink from this conversation' : 'Link to this conversation') + '</button>' +
    (!sessions.length ? '<button type="button" data-linear-start>Start work</button>' : '') +
    '<a target="_blank" rel="noopener noreferrer" href="' + esc(issue.url) + '">Open in Linear</a></div>' +
    '<p class="settings-hint">Linking shares the issue title and status with this conversation’s viewers. Starting work adds the description and comments to a new conversation.</p>' +
    (sessions.length ? '<section><h3>Linked conversations</h3>' + sessions.map(function (item) { return '<button type="button" class="issue-row" data-linear-session="' + item.sessionId + '">' + esc(item.title || 'Open conversation') + '</button>'; }).join('') + '</section>' : '') +
    (prs.length ? '<section><h3>GitHub pull requests</h3>' + prs.map(function (pr) { return '<a target="_blank" rel="noopener noreferrer" href="' + esc(pr.url) + '">PR #' + esc(pr.number) + ' · ' + esc(pr.title) + '</a>'; }).join('<br>') + '</section>' : '') +
    '<div class="issue-doc-body">' + prose(issue.description) + '</div><section class="issue-discussion"><h3>Comments</h3>' +
    (issue.comments.length ? issue.comments.map(function (comment) { return '<article><strong>' + esc(comment.author) + '</strong><div class="issue-doc-body">' + prose(comment.body) + '</div></article>'; }).join('') : '<p>No comments yet.</p>') +
    (issue.pageInfo && issue.pageInfo.hasNextPage ? '<button type="button" data-linear-more>More comments</button>' : '') + '</section></article>';
}
function showSearch() {
  store.set({ linearIssue: null, linearRequest: null, linearMatches: [] });
  content().innerHTML = '<p class="linear-empty">Search by title or identifier, or paste a Linear issue URL.</p>';
  notice('');
  panel().querySelector('input').focus();
}
export function closeLinear() {
  if (panel()) panel().classList.add('hidden');
  store.set({ linearOpen: false, linearRequest: null, linearIssue: null, linearMatches: [] });
  releaseRightWorkbench('linear');
}
export function openLinear(url) {
  initLinearPanel();
  if (!panel() || store.get('isMate')) return;
  claimRightWorkbench('linear');
  panel().classList.remove('hidden'); store.set({ linearOpen: true });
  if (url) { content().textContent = ''; request('linear_read', { url: url }); }
  else showSearch();
}
export function handleLinearResult(msg) {
  var pending = store.get('linearRequest');
  if (!pending || !store.get('linearOpen') || pending.id !== msg.requestId || pending.project !== store.get('currentSlug') || msg.projectSlug !== pending.project || pending.socket !== getWs()) return;
  store.set({ linearRequest: null });
  panel().querySelectorAll('button').forEach(function (button) { button.disabled = false; });
  if (msg.error) { notice(msg.error); return; }
  notice('');
  var result = msg.result || {};
  if (msg.action === 'linear_search') {
    store.set({ linearIssue: null });
    content().innerHTML = (result.items || []).map(function (item) {
      return '<button type="button" class="issue-row" data-linear-url="' + esc(item.url) + '"><small>' + esc(item.identifier) + ' · ' + esc(item.stateName) + '</small><strong>' + esc(item.title) + '</strong></button>';
    }).join('') || '<p class="linear-empty">No matching issues.</p>';
  } else if (msg.action === 'linear_read') {
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
  el.innerHTML = '<header class="linear-topbar"><button type="button" data-linear-back aria-label="Back to Linear search"><i data-lucide="arrow-left"></i></button><strong>Linear</strong><button type="button" data-linear-settings>Connection</button><button type="button" data-linear-close aria-label="Close Linear"><i data-lucide="x"></i></button></header><form class="linear-search"><input type="search" aria-label="Search Linear issues" placeholder="Issue URL, identifier or title" maxlength="2048" required><button type="submit">Search</button></form><p class="linear-notice" role="status"></p><div class="linear-content"></div>';
  host.appendChild(el); registerRightWorkbench('linear', closeLinear); refreshIcons(el);
  el.querySelector('form').addEventListener('submit', function (event) { event.preventDefault(); request('linear_search', { query: el.querySelector('input').value }); });
  el.addEventListener('click', function (event) {
    var button = event.target.closest('button'); if (!button) return;
    var issue = store.get('linearIssue');
    if (button.hasAttribute('data-linear-close')) closeLinear();
    else if (button.hasAttribute('data-linear-back')) showSearch();
    else if (button.hasAttribute('data-linear-settings')) openUserSettings('us-integrations');
    else if (button.dataset.linearUrl) { content().textContent = ''; request('linear_read', { url: button.dataset.linearUrl }); }
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
    else if (state.linearOpen && state.githubWorkSessions !== previous.githubWorkSessions && state.linearIssue) renderIssue();
  });
}
