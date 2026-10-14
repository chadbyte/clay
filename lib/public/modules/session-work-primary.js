import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml } from './utils.js';
var PRIMARY_PIN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path class="work-primary-pin-head" d="M16 9V4l1-1V2H7v1l1 1v5l-2 3v2h12v-2z"/><path d="M12 14v8"/></svg>';
function attr(value) { return escapeHtml(String(value)).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
export function primaryWorkPopover(links, primary, sessionId, render) {
  var html = ['linear', 'pr', 'issue'].map(function (type) {
    var items = links.filter(function (link) { return (link.provider === 'linear' ? 'linear' : link.kind) === type; }).reverse();
    if (!items.length) return '';
    return '<section class="work-primary-group"><h3>' + ({ linear: 'Linear issues', pr: 'Pull requests', issue: 'GitHub issues' })[type] + '</h3>' + items.map(function (link) {
      var selected = String(primary[type] || '').toLowerCase() === link.url.toLowerCase();
      return '<div class="work-primary-row">' + render({ githubLinks: [link] }, false, true) +
        (sessionId ? '<button type="button" class="work-primary-choice" data-primary-url="' + attr(link.url) + '" aria-label="' + attr((selected ? 'Primary: ' : 'Make primary: ') + (link.identifier || (type === 'pr' ? 'PR #' : 'Issue #') + link.number)) + '" title="' + (selected ? 'Primary' : 'Make primary') + '" aria-pressed="' + selected + '"' + (selected ? ' disabled' : '') + '>' + PRIMARY_PIN + '</button>' : '') + '</div>';
    }).join('') + '</section>';
  }).join('');
  return html + '<p class="work-primary-feedback" role="status" aria-live="polite"></p>';
}
export function handlePrimaryWorkClick(event) {
  var button = event.target.closest('.work-primary-choice');
  if (!button) return false;
  event.preventDefault(); event.stopPropagation();
  var popup = button.closest('#github-work-popover'), ws = getWs();
  if (!popup) return true;
  var feedback = popup.querySelector('.work-primary-feedback');
  if (!ws || ws.readyState !== 1) { feedback.textContent = 'Reconnect to save your selection.'; return true; }
  var requestId = 'work-primary-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  store.set({ workPrimaryPending: { requestId: requestId, sessionId: Number(popup.dataset.sessionId), projectSlug: store.get('currentSlug') } });
  popup.querySelectorAll('.work-primary-choice').forEach(function (control) { control.disabled = true; });
  feedback.textContent = 'Saving…';
  var projectSlug = store.get('currentSlug');
  setTimeout(function () {
    handlePrimaryWorkResult({ requestId: requestId, projectSlug: projectSlug, error: 'Save confirmation did not arrive. Reopen the list to check, or retry.' });
  }, 15000);
  try { ws.send(JSON.stringify({ type: 'session_work_primary_set', requestId: requestId, sessionId: Number(popup.dataset.sessionId), url: button.dataset.primaryUrl })); }
  catch (error) { handlePrimaryWorkResult({ requestId: requestId, projectSlug: store.get('currentSlug'), error: 'Could not send your selection. Please retry.' }); }
  return true;
}
export function handlePrimaryWorkResult(msg) {
  var pending = store.get('workPrimaryPending');
  if (!pending || msg.requestId !== pending.requestId || msg.projectSlug !== pending.projectSlug) return;
  store.set({ workPrimaryPending: null });
  var popup = document.getElementById('github-work-popover');
  if (!popup || Number(popup.dataset.sessionId) !== pending.sessionId || store.get('currentSlug') !== pending.projectSlug) return;
  popup.querySelectorAll('.work-primary-choice').forEach(function (button) {
    var selected = msg.error ? button.getAttribute('aria-pressed') === 'true' : Object.values(msg.workPrimary || {}).some(function (url) { return url.toLowerCase() === button.dataset.primaryUrl.toLowerCase(); });
    button.setAttribute('aria-pressed', String(selected)); button.disabled = selected;
    button.title = selected ? 'Primary' : 'Make primary';
    button.setAttribute('aria-label', (selected ? 'Primary: ' : 'Make primary: ') + button.getAttribute('aria-label').replace(/^(Primary|Make primary): /, ''));
  });
  popup.querySelector('.work-primary-feedback').textContent = msg.error || 'Primary saved.';
}
