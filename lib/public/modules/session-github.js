import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { githubLinkTarget } from './github-links.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml as escapeText } from './utils.js';

function escapeHtml(value) {
  return escapeText(String(value)).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeLinks(session) {
  return (session && Array.isArray(session.githubLinks) ? session.githubLinks : []).filter(function (link) {
    var target = githubLinkTarget(link.url);
    return target && (target.kind === 'issue' || target.kind === 'pull');
  });
}
function label(link) {
  return (link.kind === 'pr' ? 'PR #' : 'Issue #') + link.number;
}
function anchor(url, title, content, className) {
  return '<a class="' + className + '" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' + content + '</a>';
}
export function orderedGithubWork(session) {
  var links = safeLinks(session).slice().reverse();
  var latestIssue = links.find(function (link) { return link.kind === 'issue'; });
  if (latestIssue) links = [latestIssue].concat(links.filter(function (link) { return link !== latestIssue; }));
  return links;
}
export function githubWorkMarkup(session, detailed, expanded) {
  var links = orderedGithubWork(session);
  if (!links.length) return '';
  return '<span class="session-github-links' + (detailed ? ' github-work-details' : '') + '">' + (detailed || expanded ? links : links.slice(0, 1)).map(function (link) {
    var state = ['open', 'closed', 'merged', 'draft'].indexOf(link.state) >= 0 ? link.state : 'unknown';
    var icon = link.kind === 'pr' ? (state === 'merged' ? 'git-merge' : state === 'closed' ? 'git-pull-request-closed' : state === 'draft' ? 'git-pull-request-draft' : 'git-pull-request') : (state === 'closed' ? 'circle-check' : 'circle-dot');
    var description = link.repository + ' · ' + label(link) + ' · ' + link.title + ' · ' + state + (link.checkedAt ? ' · Checked ' + new Date(link.checkedAt).toLocaleString() : '') + (link.stale ? ' (last known status; refresh unavailable)' : '');
    var html = anchor(link.url, description, iconHtml('github', 'github-work-brand') + iconHtml(icon, 'github-work-status') + '<span><span class="github-work-kind">' + (link.kind === 'pr' ? 'PR ' : 'Issue ') + '</span>#' + escapeHtml(String(link.number)) + '</span>', 'session-github-link github-kind-' + (link.kind === 'pr' ? 'pr' : 'issue') + ' github-state-' + (link.stale ? 'unknown' : state));
    if (expanded) html = '<span class="github-work-entry">' + html + '<span class="github-work-entry-title">' + escapeHtml(link.title || '') + '</span><span class="github-work-entry-meta">' + escapeHtml(link.repository + ' · ' + state + (link.stale ? ' · Last known status' : '')) + '</span></span>';
    if (detailed && link.kind === 'pr') {
      html += anchor(link.url + '/files', 'View PR changes on GitHub', 'Changes', 'github-work-action');
      html += anchor(link.url + '#pullrequestreview', 'View PR reviews on GitHub', escapeHtml((link.review || 'Reviews').replace(/_/g, ' ').toLowerCase()), 'github-work-action');
      (link.checks || []).forEach(function (check) {
        if (/^https:\/\//i.test(check.url)) html += anchor(check.url, check.name + ': ' + check.state, escapeHtml(check.name + ' · ' + check.state.toLowerCase()), 'github-work-action');
      });
    }
    return html;
  }).join('') + (!detailed && !expanded && links.length > 1 ? '<button type="button" class="github-work-more" aria-label="Show all ' + links.length + ' linked GitHub items" aria-haspopup="dialog" aria-expanded="false" data-github-links="' + escapeHtml(JSON.stringify(safeLinks(session))) + '">+' + (links.length - 1) + '</button>' : '') + '</span>';
}
export function appendGithubWork(row, session, title) {
  var html = githubWorkMarkup(session, false);
  bindGithubWorkPopover();
  if (!html) return;
  var column = document.createElement('span');
  column.className = 'session-work-column';
  row.insertBefore(column, title);
  column.appendChild(title);
  var links = document.createElement('span');
  links.innerHTML = html;
  links.addEventListener('click', function (event) { if (event.target.closest('a')) event.stopPropagation(); });
  links.addEventListener('contextmenu', function (event) { event.stopPropagation(); });
  column.appendChild(links);
}
export function syncGithubSessions(sessions) {
  bindGithubWorkPopover();
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
  var session = (store.get('githubWorkSessions') || []).find(function (item) { return item.active; });
  if (!safeLinks(session).length) return;
  var key = store.get('currentSlug') + ':' + session.id;
  var previous = store.get('githubWorkRefresh') || {};
  if (previous.key === key && Date.now() - previous.at < 60000) return;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  store.set({ githubWorkRefresh: { key: key, at: Date.now() } });
  ws.send(JSON.stringify({ type: 'session_github_refresh' }));
}

export function resetGithubWork() {
  closeGithubWorkPopover();
  store.set({ githubWorkSessions: [], githubWorkProject: null, githubWorkRefresh: null });
  var header = document.getElementById('header-github-links');
  if (header) header.remove();
}

function closeGithubWorkPopover() {
  var popup = document.getElementById('github-work-popover');
  if (popup) popup.hidePopover();
}
function bindGithubWorkPopover() {
  if (store.get('githubWorkPopoverBound')) return;
  store.set({ githubWorkPopoverBound: true });
  document.addEventListener('click', function (event) {
    var button = event.target.closest('.github-work-more');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    var existing = document.getElementById('github-work-popover');
    var same = existing && button.getAttribute('aria-expanded') === 'true';
    if (existing) { existing.hidePopover(); existing.remove(); }
    if (same) return;
    var links;
    try { links = JSON.parse(button.dataset.githubLinks); } catch (error) { return; }
    var popup = document.createElement('div');
    popup.id = 'github-work-popover';
    popup.className = 'github-work-popover';
    popup.setAttribute('popover', 'auto');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Linked GitHub work');
    popup.innerHTML = '<strong>Linked GitHub work</strong>' + githubWorkMarkup({ githubLinks: links }, false, true);
    document.body.appendChild(popup);
    button.setAttribute('aria-expanded', 'true');
    popup.addEventListener('toggle', function (toggle) {
      if (toggle.newState === 'closed') {
        button.setAttribute('aria-expanded', 'false');
        if (document.activeElement === document.body && button.isConnected) button.focus();
        popup.remove();
      }
    });
    popup.showPopover();
    var rect = button.getBoundingClientRect();
    var box = popup.getBoundingClientRect();
    popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8)) + 'px';
    popup.style.top = Math.max(8, rect.bottom + box.height + 8 <= window.innerHeight ? rect.bottom + 6 : rect.top - box.height - 6) + 'px';
    var first = popup.querySelector('a');
    if (first) first.focus({ preventScroll: true });
    refreshIcons();
  }, true);
  window.addEventListener('resize', closeGithubWorkPopover);
  store.subscribe(function (state, previous) {
    if (state.currentSlug !== previous.currentSlug || state.activeSessionId !== previous.activeSessionId || state.dmMode !== previous.dmMode) closeGithubWorkPopover();
  });
}
