import { renderMarkdown } from '/modules/markdown.js';
import { enhanceClayLogLinks } from '/modules/clay-log-links.js';
import { renderIssueDetail } from '/modules/issues-render.js';

// Run from the Issues browser fixture to exercise the real parser, sanitizer,
// DOM enhancement, and detail renderer without creating project records.
export function checkRecordChips(issueRef) {
  var logRef = 'log:hDY0BvyWCr1IK3baMdIXUmG4';
  var pair = '[this Issue](' + issueRef + ') and [the log](' + logRef + ')';
  function check(value, message) { if (!value) throw new Error(message); }
  function counts(root, issueExpected, logExpected) {
    check(root.querySelectorAll('.clayos-issue-link').length === issueExpected, 'Issue chip count');
    check(root.querySelectorAll('.clayos-log-link').length === (logExpected === undefined ? issueExpected : logExpected), 'Log chip count');
    check(!root.querySelector('button button'), 'Nested buttons');
  }
  var root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = renderMarkdown(pair + '\n\n' + issueRef + ' ' + logRef + '\n\n`' + issueRef + '` `' + logRef + '`');
  enhanceClayLogLinks(root);
  counts(root, 3);
  enhanceClayLogLinks(root);
  counts(root, 3);
  check(root.querySelector('.clayos-issue-link').dataset.issueRef === issueRef, 'Issue navigation ref');
  check(root.querySelector('.clayos-log-link').dataset.logRef === logRef, 'Log navigation ref');
  root.innerHTML = renderMarkdown('[**Review**](https://github.com/ThroughLineCare/fs-handler-interviewer/issues/123), <https://github.com/ThroughLineCare/fs-handler-interviewer/pulls>, <https://github.com/ThroughLineCare/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz/issues/123>, and [GitLab MR](https://gitlab.com/group/subgroup/repo/-/merge_requests/7)\n\n`https://gitlab.com/group/subgroup/repo/-/issues/123`');
  enhanceClayLogLinks(root);
  check(root.querySelectorAll('.github-link-chip').length === 3, 'GitHub chip count');
  check(root.querySelectorAll('.gitlab-link-chip').length === 1, 'GitLab chip count');
  var gitlabChip = root.querySelector('.gitlab-link-chip');
  var gitlabStyle = getComputedStyle(gitlabChip);
  check(gitlabStyle.display === 'inline-flex', 'GitLab chip display');
  check(gitlabStyle.borderRadius !== '0px', 'GitLab chip radius');
  check(gitlabChip.querySelector('[data-lucide="gitlab"]'), 'GitLab chip icon');
  check(root.querySelector('.github-link-main').textContent === 'Review', 'GitHub inline label');
  root.querySelectorAll('.github-link-kind').forEach(function (meta) { check(meta.scrollWidth <= meta.clientWidth, 'GitHub metadata overflow'); });
  check(root.querySelector('.github-link-chip').target === '_blank', 'GitHub target');
  check(root.querySelector('.github-link-chip').rel === 'noopener noreferrer', 'GitHub rel');
  enhanceClayLogLinks(root);
  check(root.querySelectorAll('.github-link-chip').length === 3, 'GitHub idempotence');
  check(root.querySelectorAll('.gitlab-link-chip').length === 1, 'GitLab idempotence');
  check(root.querySelector('code .github-link-chip') === null, 'GitHub code preserved');
  root.innerHTML = renderMarkdown('[External](https://example.test/' + issueRef + ')\n\n```\n' + issueRef + '\n' + logRef + '\n```\n\n' + issueRef + 'x ' + logRef + 'x');
  enhanceClayLogLinks(root);
  counts(root, 0);
  check(root.querySelector('a').getAttribute('href').startsWith('https://example.test/'), 'External link preserved');
  check(root.querySelector('pre code').textContent.includes(issueRef), 'Code preserved');
  var bare = 'Continuity: ' + logRef;
  root.innerHTML = renderIssueDetail({
    ref: issueRef, title: 'Record chip regression', type: 'bug', status: 'open', priority: 'normal', revision: 1,
    summary: pair + ' ' + bare, body: '| Related records |\n| --- |\n| ' + pair + ' ' + bare + ' |',
    comments: [{ author: { displayName: 'Fixture' }, at: Date.now(), body: pair + ' ' + bare, review: { action: 'incorporate', response: pair + ' ' + bare } }],
  });
  enhanceClayLogLinks(root);
  counts(root, 4, 8);
  check(root.querySelectorAll('.issue-comment .clayos-log-link').length === 4, 'Discussion and review references');
  check(root.querySelectorAll('.issue-doc-summary .clayos-log-link, .issue-doc-body .clayos-log-link').length === 4, 'Issue document references');
  root.innerHTML = renderMarkdown('[Unsafe](javascript:alert(1)) <img src=x onerror=alert(1)>');
  enhanceClayLogLinks(root);
  check(!root.querySelector('[onerror], a[href^="javascript:"]'), 'Sanitization preserved');
  root.remove();
  return { markdownLinks: true, bareAndInlineRefs: true, idempotent: true, githubChips: true, gitlabChips: true, codeAndExternalLinks: true, issueSummaryBodyDiscussionReview: true, sanitization: true };
}
