import { store } from './store.js';
import { openIssues } from './issues.js';

function isIssueReference(ref) {
  return typeof ref === "string" && /^issue:[A-Za-z0-9_-]{24}$/.test(ref);
}

function isPaneSource(host, source) {
  var frames = host.querySelectorAll(".split-pane-frame");
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow === source) return true;
  }
  return false;
}

export function handlePaneIssueMessage(event, host) {
  if (!event || event.origin !== window.location.origin || !host) return false;
  var msg = event.data;
  if (!msg || msg.type !== "clay-pane-open-issue") return false;
  if (!isIssueReference(msg.ref) || !isPaneSource(host, event.source)) return true;

  var issueTarget = store.get('issuesCache') && store.get('issuesCache')[msg.ref];
  var projectSlug = (issueTarget && issueTarget.projectSlug) || msg.projectSlug || store.get('currentSlug');
  if (projectSlug === store.get('currentSlug')) openIssues(msg.ref);
  else window.location.assign('/p/' + encodeURIComponent(projectSlug) + '/?issue=' + encodeURIComponent(msg.ref));
  return true;
}
