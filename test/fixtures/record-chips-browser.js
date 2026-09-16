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
  root.innerHTML = renderMarkdown(pair + '\n\n' + issueRef + ' ' + logRef + '\n\n`' + issueRef + '` `' + logRef + '`');
  enhanceClayLogLinks(root);
  counts(root, 3);
  enhanceClayLogLinks(root);
  counts(root, 3);
  check(root.querySelector('.clayos-issue-link').dataset.issueRef === issueRef, 'Issue navigation ref');
  check(root.querySelector('.clayos-log-link').dataset.logRef === logRef, 'Log navigation ref');
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
  return { markdownLinks: true, bareAndInlineRefs: true, idempotent: true, codeAndExternalLinks: true, issueSummaryBodyDiscussionReview: true, sanitization: true };
}
