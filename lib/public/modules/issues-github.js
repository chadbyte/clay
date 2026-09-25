import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { refreshIcons } from './icons.js';
import { requestIssue, refreshGithubIssue } from './issues.js';

function esc(value) { return escapeHtml(String(value || '')).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function safeUrl(value) { return /^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+\/issues\/[1-9][0-9]*$/.test(value || '') ? value : ''; }
export function issueGithubAction(entry) {
  var url = safeUrl(entry.github && entry.github.url);
  return url ? '<a class="issue-github-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"><i data-lucide="github"></i>GitHub #' + esc(entry.github.number) + '<i data-lucide="arrow-up-right"></i></a>' :
    '<button type="button" data-issue-github="open"><i data-lucide="github"></i>' + 'Connect to GitHub' + '</button>';
}
function patch(change) { store.set({ issueGithub: Object.assign({}, store.get('issueGithub'), change) }); render(); }
function send(action, args) {
  var state = store.get('issueGithub'); var entry = store.get('issuesSelected');
  if (!state || !entry || state.ref !== entry.ref || state.busy) return;
  var id = requestIssue(action, Object.assign({ ref: entry.ref, expectedRevision: entry.revision }, args), 'github');
  if (id) patch({ busy: true, requestId: id, error: '' });
}
function render() {
  var host = document.querySelector('[data-issue-github-panel]');
  var state = store.get('issueGithub'); var entry = store.get('issuesSelected');
  if (!host || !state || !entry || state.ref !== entry.ref || store.get('issuesView') !== 'detail') return;
  var html = '<div class="issue-github-heading"><strong><i data-lucide="github"></i>Connect to GitHub</strong><button type="button" data-issue-github="close" aria-label="Close GitHub connection"><i data-lucide="x"></i></button></div>';
  if (state.repository) html += '<p class="issue-github-repo">' + esc(state.repository) + '</p>';
  if (state.error) html += '<p role="alert">' + esc(state.error) + '</p>';
  if (state.busy) html += '<p role="status">' + (state.creating ? 'Creating and linking…' : 'Checking existing GitHub issues for the same problem…') + '</p>';
  if (state.pending || entry.github && entry.github.attempt) html += '<p>A previous creation could not be confirmed. Find and link the existing issue before continuing.</p>';
  if (state.preview) {
    html += '<p>No likely duplicate remains among the checked issues. Review before publishing; search cannot guarantee that every duplicate was found.</p>';
    html += '<form data-issue-github-form="create"><label>Title<input name="title" maxlength="200" required value="' + esc(state.title) + '"></label><label>Description<textarea name="body" rows="7" maxlength="21000" required>' + esc(state.body) + '</textarea></label><p>This publishes the title and description to ' + esc(state.repository) + ' using your GitHub account.</p><div class="issue-github-actions"><button type="button" data-issue-github="back">Back</button><button type="submit" class="issue-primary">Create &amp; link</button></div></form>';
  } else {
    if (state.candidates && state.candidates.length) {
      html += '<p>' + (state.pending ? 'Possible previous filing' : 'These may describe the same problem. Does one match?') + '</p><div class="issue-github-matches">';
      state.candidates.forEach(function (item) {
        if (safeUrl(item.url)) html += '<div><a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer"><small>#' + esc(item.number) + ' · ' + esc(item.state) + '</small><span>' + esc(item.title) + '</span><small>' + esc(item.reason) + '</small></a><button type="button" data-issue-github-url="' + esc(item.url) + '">Same issue · link</button></div>';
      });
      html += '</div>';
      if (!state.pending && state.assessment) html += '<button type="button" data-issue-github="preview">None of these are the same issue</button>';
    }
    if (state.pending) html += '<form data-issue-github-form="link" class="issue-github-inline"><input name="url" type="url" required aria-label="Existing GitHub issue URL" placeholder="Paste the created GitHub issue URL" value="' + esc(state.url) + '"><button type="submit">Link</button></form>';
    if (!state.busy) html += '<button type="button" data-issue-github="retry">Check again</button>';

  }
  host.innerHTML = '<section class="issue-github-card">' + html + '</section>';
  if (state.busy) host.querySelectorAll('button,input,textarea').forEach(function (el) { if (el.dataset.issueGithub !== 'close') el.disabled = true; });
  refreshIcons();
}
export function handleIssueGithubClick(target) {
  var action = target.dataset.issueGithub;
  if (!action && !target.dataset.issueGithubUrl) return false;
  if (target.disabled) return true;
  var entry = store.get('issuesSelected');
  if (!entry || store.get('issuesView') !== 'detail') return true;
  if (action === 'open') {
    store.set({ issueGithub: { ref: entry.ref, query: entry.title, title: entry.title, body: [entry.summary, entry.body].filter(Boolean).join('\n\n'), busy: false } });
    render(); send('issue_github_search', {});
  } else if (action === 'close') {
    store.set({ issueGithub: null });
    var host = document.querySelector('[data-issue-github-panel]'); if (host) host.innerHTML = '';
    var button = document.querySelector('[data-issue-github="open"]'); if (button) button.focus();
  } else if (action === 'preview' || action === 'back') {
    patch({ preview: action === 'preview', rejectCandidates: action === 'preview', error: '' });
    var input = document.querySelector('[data-issue-github-panel] input'); if (input) input.focus();
  } else if (action === 'retry') { patch({ preview: false, candidates: null, assessment: null }); send('issue_github_search', {});
  } else if (target.dataset.issueGithubUrl) send('issue_github_link', { url: target.dataset.issueGithubUrl });
  return true;
}
export function handleIssueGithubInput(event) {
  if (!event.target.closest('[data-issue-github-form]')) return;
  var change = {}; change[event.target.name] = event.target.value;
  store.set({ issueGithub: Object.assign({}, store.get('issueGithub'), change) });
}
export function handleIssueGithubSubmit(event) {
  var action = event.target.dataset.issueGithubForm;
  if (!action) return false;
  event.preventDefault();
  var state = store.get('issueGithub'); if (!state) return true;
  if (action === 'search') send('issue_github_search', { query: state.query });
  if (action === 'link') send('issue_github_link', { url: state.url });
  if (action === 'create') {
    patch({ creating: true });
    send('issue_github_create', { repository: state.repository, title: state.title, body: state.body, confirm: true, assessment: state.assessment, rejectCandidates: state.rejectCandidates === true });
  }
  return true;
}
export function handleIssueGithubResult(msg, item) {
  var state = store.get('issueGithub'); var entry = store.get('issuesSelected');
  if (!state || state.requestId !== msg.requestId || !entry || item.sourceRef !== entry.ref ||
      item.viewGeneration !== store.get('issuesViewGeneration') || store.get('issuesView') !== 'detail') return;
  if (msg.error) {
    if (item.action === 'issue_github_create' && msg.result && msg.result.ref === entry.ref) {
      store.set({ issuesSelected: Object.assign({}, entry, msg.result) });
      patch({ pending: !!(msg.result.github && msg.result.github.attempt), preview: false });
    }
    patch({ error: msg.error, busy: false, creating: false }); return;
  }
  if (msg.result && msg.result.linked) { store.set({ issueGithub: null }); refreshGithubIssue(entry.ref); return; }
  if (item.action === 'issue_github_search') patch(Object.assign({}, msg.result, { busy: false, creating: false, error: '', rejectCandidates: false }));
  else { store.set({ issueGithub: null }); refreshGithubIssue(entry.ref); }
}
