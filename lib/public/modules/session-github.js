import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { githubLinkTarget } from './github-links.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml as escapeText } from './utils.js';
import { primaryWorkPopover, handlePrimaryWorkClick } from './session-work-primary.js';

function escapeHtml(value) {
  return escapeText(String(value)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Local Linear mark (no external asset): a disc cut by three diagonal bands.
var LINEAR_MARK = '<span class="linear-work-brand" aria-hidden="true"><svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" focusable="false"><path d="M1.2 9.7a6.9 6.9 0 0 0 5.1 5.1zM1 7.2l7.8 7.8a7 7 0 0 0 1.6-.4L1.4 5.6A7 7 0 0 0 1 7.2zm1-3 9.8 9.8a7 7 0 0 0 1.2-.9L2.9 3a7 7 0 0 0-.9 1.2zM4 2.2l9.8 9.8A7 7 0 0 0 8 1a7 7 0 0 0-4 1.2z"/></svg></span>';
export function linearIconMarkup() { return LINEAR_MARK; }
function safeLinks(session) {
  return (session && Array.isArray(session.githubLinks) ? session.githubLinks : []).concat(session && Array.isArray(session.linearLinks) ? session.linearLinks : []).filter(function (link) {
    if (link.provider === 'linear') return /^https:\/\/linear\.app\/[a-zA-Z0-9_-]+\/issue\/[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(link.url);
    var target = githubLinkTarget(link.url);
    return target && (target.kind === 'issue' || target.kind === 'pull');
  });
}
function label(link) {
  return (link.kind === 'pr' ? 'PR #' : 'Issue #') + link.number;
}
function compactLinearState(state) {
  var value = String(state || '');
  if (/^in progress$/i.test(value)) return 'Active';
  if (/^cancell?ed$/i.test(value)) return 'Canceled';
  return value.length > 9 ? value.slice(0, 8) + '\u2026' : value;
}
function anchor(url, title, content, className) {
  return '<a class="' + className + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' + content + '</a>';
}
export function orderedGithubWork(session) {
  var links = safeLinks(session).slice().reverse();
  var latestIssue = links.find(function (link) { return link.kind === 'issue' || link.provider === 'linear'; });
  if (latestIssue) links = [latestIssue].concat(links.filter(function (link) { return link !== latestIssue; }));
  var primary = session && session.workPrimary || {};
  return links.filter(function (link) { return String(primary[link.provider === 'linear' ? 'linear' : link.kind] || '').toLowerCase() === link.url.toLowerCase(); }).concat(
    links.filter(function (link) { return String(primary[link.provider === 'linear' ? 'linear' : link.kind] || '').toLowerCase() !== link.url.toLowerCase(); }));
}
function compactGithubWork(links, sessionRow) {
  if (!sessionRow && !links.some(function (link) { return link.provider === 'linear'; })) return links.slice(0, 1);
  var latestLinear = links.find(function (link) { return link.provider === 'linear'; });
  var latestIssue = links.find(function (link) { return link.kind === 'issue' && link.provider !== 'linear'; });
  var latestPr = links.find(function (link) { return link.kind === 'pr'; });
  return [latestLinear, latestIssue, latestPr].filter(Boolean);
}
function personalScope() {
  return String(store.get('currentSlug') || '') + '\u0000' + String(store.get('myUserId') || 'default');
}
function ensurePersonalScope() {
  var scope = personalScope();
  if (store.get('githubPersonalReviewScope') !== scope) store.set({ githubPersonalReviewScope: scope, githubPersonalReview: {} });
  return scope;
}
function sessionIdentifier(session) {
  return String(session && (session._githubSessionId || session.id || session.localId) || '');
}
function personalReviewState(session, link) {
  var scope = ensurePersonalScope();
  var key = scope + '\u0000' + (sessionIdentifier(session) || String(link._githubSessionId || '')) + '\u0000' + String(link.url || '').toLowerCase();
  return (store.get('githubPersonalReview') || {})[key] || link.personalReviewState || '';
}
function prReviewStatus(link) {
  if (link.review === 'CHANGES_REQUESTED') return { icon: 'message-square-warning', label: 'Changes requested', className: 'github-review-changes' };
  if (link.personalReviewState === 'requested') return { icon: 'user-round-check', label: 'Review requested from you', className: 'github-review-requested' };
  if (link.review === 'APPROVED') return { icon: 'badge-check', label: 'Approved', className: 'github-review-approved' };
  return null;
}
export function githubWorkMarkup(session, detailed, expanded, sessionRow) {
  var links = orderedGithubWork(session);
  if (!links.length) return '';
  var displayed = detailed || expanded ? links : compactGithubWork(links, sessionRow);
  return '<span class="session-github-links' + (detailed ? ' github-work-details' : '') + (sessionRow ? ' session-row-github-links' : '') + '">' + displayed.map(function (link) {
    if (link.provider === 'linear') {
      var description = link.identifier + ' · ' + link.title + ' · ' + link.stateName + (link.stale ? ' · Last known status' : '');
      return anchor(link.url, description, LINEAR_MARK + '<span class="linear-work-id">' + escapeHtml(link.identifier) + '</span><span class="linear-work-title">' + escapeHtml(link.title) + '</span><span class="linear-work-state"><span class="linear-work-state-full">' + escapeHtml(link.stateName) + '</span><span class="linear-work-state-compact" aria-hidden="true">' + escapeHtml(compactLinearState(link.stateName)) + '</span></span>', 'session-github-link session-linear-link');
    }
    var state = ['open', 'closed', 'merged', 'draft'].indexOf(link.state) >= 0 ? link.state : 'unknown';
    var reviewLink = Object.assign({}, link, { personalReviewState: personalReviewState(session, link) });
    var reviewStatus = link.kind === 'pr' && state === 'open' ? prReviewStatus(reviewLink) : null;
    var icon = link.kind === 'pr' ? (state === 'merged' ? 'git-merge' : state === 'closed' ? 'git-pull-request-closed' : state === 'draft' ? 'git-pull-request-draft' : reviewStatus ? reviewStatus.icon : 'git-pull-request') : (state === 'closed' ? 'circle-check' : 'circle-dot');
    var statusLabel = reviewStatus ? reviewStatus.label : (state === 'merged' ? 'Merged' : state === 'closed' ? 'Closed' : state === 'draft' ? 'Draft' : state === 'open' ? 'Open' : 'Unknown');
    var description = link.repository + ' · ' + label(link) + ' · ' + link.title + ' · ' + statusLabel + (link.checkedAt ? ' · Checked ' + new Date(link.checkedAt).toLocaleString() : '') + (link.stale ? ' (last known status; refresh unavailable)' : '');
    var statusMarkup = '<span class="github-work-status' + (reviewStatus ? ' ' + reviewStatus.className : '') + '" title="' + escapeHtml(statusLabel) + '" aria-label="' + escapeHtml(statusLabel) + '">' + iconHtml(icon) + '</span>';
    var html = anchor(link.url, description, iconHtml('github', 'github-work-brand') + statusMarkup + '<span><span class="github-work-kind">' + (link.kind === 'pr' ? 'PR ' : 'Issue ') + '</span>#' + escapeHtml(String(link.number)) + '</span>', 'session-github-link github-kind-' + (link.kind === 'pr' ? 'pr' : 'issue') + ' github-state-' + state);
    if (expanded) html = '<span class="github-work-entry">' + html + '<span class="github-work-entry-title">' + escapeHtml(link.title || '') + '</span><span class="github-work-entry-meta">' + escapeHtml(link.repository + ' · ' + state + (link.stale ? ' · Last known status' : '')) + '</span></span>';
    if (detailed && link.kind === 'pr') {
      var actions = anchor(link.url + '/files', 'View PR changes on GitHub', 'Changes', 'github-work-action') +
        anchor(link.url + '#pullrequestreview', 'View PR reviews on GitHub', 'Reviews', 'github-work-action');
      var checks = '';
      (link.checks || []).forEach(function (check) {
        if (/^https:\/\//i.test(check.url)) checks += anchor(check.url, check.name + ': ' + check.state, '<span class="github-work-check-name">' + escapeHtml(check.name) + '</span><span class="github-work-check-state">' + escapeHtml(check.state.toLowerCase()) + '</span>', 'github-work-action github-work-check');
      });
      return '<span class="github-work-pr-group" data-github-pr="' + escapeHtml(String(link.number)) + '">' +
        '<span class="github-work-pr-header">' + html + '</span>' +
        '<span class="github-work-pr-actions">' + actions + '</span>' +
        (checks ? '<span class="github-work-pr-checks">' + checks + '</span>' : '') +
        '</span>';
    }
    return html;
  }).join('') + (!detailed && !expanded && links.length > displayed.length ? '<button type="button" class="github-work-more" aria-label="Show all ' + links.length + ' linked ' + (links.some(function (item) { return item.provider === 'linear'; }) ? 'work items' : 'GitHub items') + '" aria-haspopup="dialog" aria-expanded="false" data-work-session="' + escapeHtml(String(session.id || session.localId || '')) + '" data-work-primary="' + escapeHtml(JSON.stringify(session.workPrimary || {})) + '" data-github-links="' + escapeHtml(JSON.stringify(safeLinks(session))) + '">+' + (links.length - displayed.length) + '</button>' : '') + '</span>';
}
export function applyGithubPersonalReviewStatus(message) {
  var state = store.snap();
  if (!message || (message.projectSlug && message.projectSlug !== state.currentSlug) || (message.accountId && message.accountId !== state.myUserId)) return;
  var refresh = state.githubWorkRefresh || {};
  if (message.requestId && refresh.requestId && message.requestId !== refresh.requestId) return;
  var updates = message.personalReview || {};
  var scope = ensurePersonalScope();
  var personal = Object.assign({}, store.get('githubPersonalReview') || {});
  var sessionId = String(message.sessionId);
  Object.keys(updates).forEach(function (url) {
    var status = updates[url];
    if (status === 'requested' || status === 'clear') personal[scope + '\u0000' + sessionId + '\u0000' + url.toLowerCase()] = status;
  });
  store.set({ githubPersonalReview: personal });
  var sessions = store.get('githubWorkSessions') || [];
  sessions.forEach(function (session) {
    if (String(session.localId) !== sessionId && String(session.id) !== sessionId) return;
    document.querySelectorAll('[data-github-session-id="' + sessionIdentifier(session) + '"] .session-work-links-slot').forEach(function (slot) { slot.innerHTML = githubWorkMarkup(session, false, false, true); });
  });
  syncGithubSessions(sessions);
  refreshIcons();
}
export function appendGithubWork(row, session, title) {
  var html = githubWorkMarkup(session, false, false, true);
  bindGithubWorkPopover();
  if (!html) return;
  row.dataset.githubSessionId = session.id;
  var column = document.createElement('span');
  column.className = 'session-work-column';
  row.insertBefore(column, title);
  column.appendChild(title);
  var links = document.createElement('span');
  links.className = 'session-work-links-slot';
  links.innerHTML = html;
  links.addEventListener('click', function (event) { if (event.target.closest('a')) event.stopPropagation(); });
  links.addEventListener('contextmenu', function (event) { event.stopPropagation(); });
  row.appendChild(links);
}
export function syncGithubSessions(sessions) {
  bindGithubWorkPopover();
  ensurePersonalScope();
  store.set({ githubWorkSessions: sessions || [], githubWorkProject: store.get('currentSlug') });
  var active = (sessions || []).find(function (session) { return session.active; });
  var title = document.getElementById('header-title');
  var old = document.getElementById('header-github-links');
  var html = title && !store.get('dmMode') && !store.get('splitPanes') && active ? githubWorkMarkup(active, false) : '';
  if (!html) { if (old) old.remove(); }
  else if (!old || old.dataset.markup !== html) {
    var element = old || document.createElement('span');
    element.id = 'header-github-links';
    element.dataset.markup = html;
    element.innerHTML = html;
    if (!old) title.insertAdjacentElement('afterend', element);
  }
  refreshIcons();
  refreshGithubWork();
}
export function currentGithubWorkMarkup() {
  if (store.get('githubWorkProject') !== store.get('currentSlug')) return '';
  var session = (store.get('githubWorkSessions') || []).find(function (item) { return item.active; });
  return githubWorkMarkup(session, true);
}
export function refreshGithubWork() {
  if (document.hidden || store.get('dmMode') || !store.get('connected')) return;
  if (store.get('githubWorkProject') !== store.get('currentSlug')) return;
  var ids = [];
  document.querySelectorAll('[data-github-session-id]').forEach(function (row) {
    var rect = row.getBoundingClientRect();
    if (rect.width && rect.height && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth) ids.push(Number(row.dataset.githubSessionId));
  });
  var active = (store.get('githubWorkSessions') || []).find(function (item) { return item.active; });
  if (safeLinks(active).length) ids.unshift(active.id);
  ids = Array.from(new Set(ids)).slice(0, 100);
  if (!ids.length) return;
  var key = store.get('currentSlug') + ':' + ids.join(',');
  var previous = store.get('githubWorkRefresh') || {};
  if (previous.key === key && Date.now() - previous.at < 60000) return;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  var requestId = 'github-refresh-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  store.set({ githubWorkRefresh: { key: key, at: Date.now(), requestId: requestId } });
  ws.send(JSON.stringify({ type: 'session_github_refresh', sessionIds: ids, requestId: requestId, projectSlug: store.get('currentSlug'), accountId: store.get('myUserId') || null }));
  var linearIds = ids.filter(function (id) { return (store.get('githubWorkSessions') || []).some(function (item) { return item.id === id && (item.linearLinks || []).length; }); });
  if (linearIds.length) ws.send(JSON.stringify({ type: 'session_linear_refresh', sessionIds: linearIds }));
}

export function resetGithubWork() {
  closeGithubWorkPopover();
  store.set({ githubWorkSessions: [], githubWorkProject: null, githubWorkRefresh: null, githubPersonalReview: {}, workPrimaryPending: null });
  var header = document.getElementById('header-github-links');
  if (header) header.remove();
}

function closeGithubWorkPopover() {
  var popup = document.getElementById('github-work-popover');
  if (popup && popup._closeGithubWorkPopover) popup._closeGithubWorkPopover(false);
  else if (popup) popup.remove();
}
function mountGithubWorkPopover(popup, button) {
  var closed = false;
  var observer = new MutationObserver(function () {
    if (!button.isConnected || !popup.isConnected) dismiss(false);
  });
  function includes(target) {
    return target === popup || target === button || popup.contains(target) || button.contains(target);
  }
  function outsidePress(event) {
    if (!includes(event.target)) dismiss(false);
  }
  function keydown(event) {
    if (event.key === 'Escape') dismiss(true);
  }
  function dismiss(restoreFocus) {
    if (closed) return;
    closed = true;
    window.removeEventListener('pointerdown', outsidePress, true);
    window.removeEventListener('touchstart', outsidePress, true);
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('blur', blur);
    observer.disconnect();
    popup.removeEventListener('toggle', toggled);
    button.setAttribute('aria-expanded', 'false');
    try { popup.hidePopover(); } catch (error) {}
    popup.remove();
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
  }
  function blur() { dismiss(false); }
  function toggled(event) {
    if (event.newState === 'closed') dismiss(false);
  }
  popup._closeGithubWorkPopover = dismiss;
  popup.addEventListener('toggle', toggled);
  window.addEventListener('pointerdown', outsidePress, true);
  window.addEventListener('touchstart', outsidePress, true);
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('blur', blur);
  observer.observe(document.body, { childList: true, subtree: true });
}
function bindGithubWorkPopover() {
  if (store.get('githubWorkPopoverBound')) return;
  store.set({ githubWorkPopoverBound: true });
  document.addEventListener('click', function (event) {
    if (handlePrimaryWorkClick(event)) return;
    var linear = event.target.closest('.session-linear-link');
    if (linear && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); closeGithubWorkPopover(); import('./linear-panel.js').then(function (module) { module.openLinear(linear.href); }); return; }
    var button = event.target.closest('.github-work-more');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    var existing = document.getElementById('github-work-popover');
    var same = existing && button.getAttribute('aria-expanded') === 'true';
    if (existing && existing._closeGithubWorkPopover) existing._closeGithubWorkPopover(false);
    else if (existing) existing.remove();
    if (same) return;
    var links;
    try { links = JSON.parse(button.dataset.githubLinks); } catch (error) { return; }
    var popup = document.createElement('div');
    popup.id = 'github-work-popover';
    popup.className = 'github-work-popover';
    popup.setAttribute('popover', 'auto');
    popup.setAttribute('role', 'dialog');
    var workTitle = links.some(function (link) { return link.provider === 'linear'; }) ? 'Linked work' : 'Linked GitHub work';
    popup.setAttribute('aria-label', workTitle);
    popup.dataset.sessionId = button.dataset.workSession || '';
    var primary;
    try { primary = JSON.parse(button.dataset.workPrimary || '{}'); } catch (error) { primary = {}; }
    var popupLinks = links.map(function (link) { return Object.assign({}, link, { _githubSessionId: popup.dataset.sessionId }); });
    popup.innerHTML = '<strong>' + workTitle + '</strong>' + primaryWorkPopover(popupLinks, primary, popup.dataset.sessionId, githubWorkMarkup);
    document.body.appendChild(popup);
    mountGithubWorkPopover(popup, button);
    button.setAttribute('aria-expanded', 'true');
    try { popup.showPopover(); } catch (error) { popup._closeGithubWorkPopover(false); return; }
    var rect = button.getBoundingClientRect();
    var box = popup.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8)) + 'px';
    popup.style.top = Math.max(8, rect.bottom + box.height + 8 <= window.innerHeight ? rect.bottom + 6 : rect.top - box.height - 6) + 'px';
    var first = popup.querySelector('a');
    if (first) first.focus({ preventScroll: true });
    refreshIcons();
  }, true);
  window.addEventListener('resize', closeGithubWorkPopover);
  window.addEventListener('focus', refreshGithubWork);
  document.addEventListener('visibilitychange', refreshGithubWork);
  store.subscribe(function (state, previous) {
    if (state.currentSlug !== previous.currentSlug || state.activeSessionId !== previous.activeSessionId || state.dmMode !== previous.dmMode) closeGithubWorkPopover();
  });
}
store.subscribe(function (state, previous) {
  if (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId) {
    var scope = personalScope();
    if (state.githubPersonalReviewScope !== scope) store.set({ githubPersonalReviewScope: scope, githubPersonalReview: {} });
  }
});
