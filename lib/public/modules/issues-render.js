import { githubWorkMarkup } from './session-github.js';
import { escapeHtml } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { authorLine, relativeTime } from './project-logs-render.js';
export function statusLabel(status) { return { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' }[status] || 'Issue'; }
function esc(value) { return escapeHtml(String(value || '')); }
function options(values, selected) { return values.map(function (value) { return '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + esc(statusLabel(value) === 'Issue' ? value.replace(/_/g, ' ') : statusLabel(value)) + '</option>'; }).join(''); }
function label(value) { return value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : ''; }
function statusChip(status) { return '<span class="issue-status" data-status="' + esc(status) + '">' + statusLabel(status) + '</span>'; }
function priorityChip(priority) { return priority && priority !== 'normal' ? '<span class="project-log-priority" data-priority="' + esc(priority) + '">' + esc(label(priority)) + '</span>' : ''; }
function action(attribute, icon, text, extra) { return '<button type="button" ' + attribute + (extra || '') + '><i data-lucide="' + icon + '"></i>' + text + '</button>'; }
function prose(text, className) { return '<div class="markdown-body ' + (className || '') + '">' + renderMarkdown(text || '') + '</div>'; }
export function renderIssueList(result) {
  var filtered = !!(result.query || result.status || result.type);
  if (!result.issues.length) return '<div class="issues-empty"><i data-lucide="circle-dot"></i><h2>' + (filtered ? 'No matching issues' : 'No issues yet') + '</h2><p>' + (filtered ? 'Try a different search or filter.' : 'Manage issues through Driver chat.') + '</p></div>';
  return result.issues.map(function (entry) {
    var meta = [authorLine(entry), relativeTime(entry.updatedAt || entry.createdAt)];
    if (entry.revision > 1) meta.push('v' + entry.revision);
    if (entry.commentCount) meta.push(entry.commentCount + (entry.commentCount === 1 ? ' comment' : ' comments'));
    return '<button type="button" class="issue-row" data-open-issue="' + esc(entry.ref) + '">' +
      '<div class="issue-row-head"><span class="issue-type">' + esc(entry.type) + '</span>' + priorityChip(entry.priority) + '<strong>' + esc(entry.title) + '</strong></div>' +
      (entry.summary ? '<p>' + esc(entry.summary) + '</p>' : '') +
      '<div class="issue-row-meta">' + statusChip(entry.status) + '<span>' + esc(meta.filter(Boolean).join(' · ')) + '</span></div></button>';
  }).join('') + (result.nextCursor ? '<div class="issues-load-more"><button data-issues-more="' + esc(result.nextCursor) + '">Load more</button></div>' : '');
}
function renderComment(comment) {
  var actor = comment.author || {};
  var review = comment.review;
  return '<article class="issue-comment"><div class="issue-comment-meta">' + esc(actor.displayName || actor.userId || 'Project member') + ' · ' + esc(new Date(comment.at).toLocaleString()) + '</div>' +
    prose(comment.body, 'issue-comment-body') + (review ? '<div class="issue-comment-review"><span>' + esc(label(review.action)) + '</span>' + prose(review.response) + '</div>' : '') + '</article>';
}
export function renderIssueDetail(entry) {
  var comments = (entry.comments || []).map(renderComment).join('');
  var closed = entry.status === 'resolved' || entry.status === 'closed';
  var time = entry.updatedAt || entry.createdAt;
  var byline = [authorLine(entry), time ? new Date(time).toLocaleString() : '', 'v' + entry.revision].filter(Boolean).join(' · ');
  return '<article class="issue-detail"><div class="issue-doc-chips"><span class="issue-type">' + esc(entry.type) + '</span>' + priorityChip(entry.priority) + statusChip(entry.status) + '</div>' +
    githubWorkMarkup(entry, true) +
    '<h2 class="issue-doc-title">' + esc(entry.title) + '</h2>' + prose(entry.summary, 'issue-doc-summary') + '<div class="issue-byline">' + esc(byline) + '</div>' +
    '<div class="issue-actions">' + action('data-issue-work', 'play', 'Start work', ' class="issue-primary"' + (closed ? ' disabled title="Reopen this issue to start work"' : '')) +
    action('data-issue-edit', 'pencil', 'Edit') + action('data-issue-history', 'history', 'History') + action('data-issue-copy', 'link', 'Copy reference') +
    (entry.canDelete ? action('data-issue-delete', 'trash-2', 'Delete', ' class="issue-danger"') : '') + '</div>' +
    prose(entry.body, 'issue-doc-body') +
    (entry.verifiedCommit ? '<section class="issue-evidence"><h3>Resolution</h3>' + prose(entry.resolutionSummary) + '<code>' + esc(entry.verifiedCommit.sha) + '</code><p>' + esc(entry.verifiedCommit.subject) + '</p></section>' : '') +
    (entry.closeReason ? '<section class="issue-evidence"><h3>Closure</h3><p>' + esc(label(entry.closeReason)) + '</p></section>' : '') +
    ((entry.linkedWorkSessions || []).length ? '<section class="issue-evidence"><h3>Linked work sessions</h3>' + entry.linkedWorkSessions.map(function (link) { return action('data-issue-session="' + esc(link.sessionId) + '"', 'messages-square', 'Open Driver session'); }).join('') + '</section>' : '') +
    ((entry.resolutionHistory || []).length ? '<section class="issue-evidence"><h3>Resolution history</h3>' + entry.resolutionHistory.map(function (item) { return prose(item.resolutionSummary) + '<code>' + esc(item.verifiedCommit && item.verifiedCommit.sha) + '</code>'; }).join('') + '</section>' : '') +
    '<section class="issue-discussion"><h3>Discussion' + (comments ? ' <span>' + entry.comments.length + '</span>' : '') + '</h3>' + (comments || '<p class="issue-discussion-empty">No comments yet.</p>') +
    '<form id="issue-comment-form"><label for="issue-comment-input">Add a comment</label><textarea id="issue-comment-input" rows="3" required placeholder="Add context, a correction, or a question."></textarea><p class="issue-comment-status" role="status"></p><div class="issue-comment-actions"><button type="submit" class="issue-primary">Comment</button></div></form></section></article>';
}
export function renderIssueForm(entry) {
  var item = entry || {};
  return '<form id="issue-form"><label>Title<input name="title" maxlength="200" required value="' + esc(item.title) + '"></label><label>Summary<textarea name="summary" maxlength="400">' + esc(item.summary) + '</textarea></label><div class="issue-fields"><label>Type<select name="type">' + options(['bug', 'feature', 'plan'], item.type || 'bug') + '</select></label><label>Priority<select name="priority">' + options(['normal', 'important', 'urgent'], item.priority || 'normal') + '</select></label><label>Status<select name="status">' + options(['open', 'in_progress', 'resolved', 'closed'], item.status || 'open') + '</select></label></div><label>Details (Markdown)<textarea name="body" rows="10" maxlength="20000">' + esc(item.body) + '</textarea></label><div data-resolution-fields><label>Resolution summary<input name="resolutionSummary" maxlength="400" value="' + esc(item.resolutionSummary) + '"></label><label>Resolving commit SHA<input name="commitSha" value="' + esc(item.verifiedCommit && item.verifiedCommit.sha) + '"></label></div><label data-close-fields>Close reason<select name="closeReason">' + options(['declined', 'duplicate', 'non_code_decision'], item.closeReason || 'non_code_decision') + '</select></label><div class="issue-actions"><button type="submit">Save issue</button><button type="button" data-issue-cancel>Cancel</button></div></form>';
}
export function renderIssueHistory(result) {
  return '<h2>Revision history</h2>' + result.revisions.slice().reverse().map(function (revision) { var actor = revision.author || {}; return '<button class="issue-row" data-issue-revision="' + revision.revision + '"><strong>Revision ' + revision.revision + '</strong><p>' + esc(actor.displayName || actor.userId || 'Local user') + ' · ' + esc(new Date(revision.at).toLocaleString()) + '</p><small>' + statusLabel(revision.status) + '</small></button>'; }).join('');
}
