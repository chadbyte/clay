import { renderMarkdown, enhanceClaySessionLinks } from '/modules/markdown.js';
import { enhanceClayLogLinks } from '/modules/clay-log-links.js';
import { renderIssueDetail } from '/modules/issues-render.js';
import { store } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';

export function checkSessionNavigation(api) {
  var root = document.createElement('div');
  var messages = document.getElementById('messages');
  var sessionRef = 'session:AAAAAAAAAAAAAAAAAAAAAAAA';
  var requests = [];
  var scrolled = [];
  var nextResolve = { projectSlug: 'fixture', sessionId: 7, status: 'ready' };
  var delayedResolve = false;
  var initialized = window.__sessionNavigationInitialized;
  if (!initialized) {
    api.initCommandPalette({
      currentSlug: function () { return 'fixture'; },
      selectSession: function (sessionId) { store.set({ activeSessionId: sessionId }); },
      switchProject: function (slug) { store.set({ currentSlug: slug }); },
      matesList: function () { return []; },
    });
    window.__sessionNavigationInitialized = true;
  }
  var fakeWs = { readyState: 1, send: function (raw) {
    var request = JSON.parse(raw);
    requests.push(request);
    if (request.type === 'home_clay_session_resolve') {
      var response = { type: 'home_clay_session_target', requestId: request.requestId, status: nextResolve.status, target: nextResolve.status === 'ready' ? { projectSlug: nextResolve.projectSlug, sessionId: nextResolve.sessionId, entryIndex: request.entryIndex } : null, error: nextResolve.error };
      var delay = delayedResolve ? 40 : 0;
      delayedResolve = false;
      setTimeout(function () { api.handleClaySessionTarget(response); }, delay);
    }
  } };
  setWs(fakeWs);
  store.set({ currentSlug: 'fixture', activeSessionId: 7, historyFrom: 0, replayingHistory: false, pendingSessionEntryNavigation: null, sessionNavigationRequestId: null });
  root.innerHTML = renderMarkdown('[Cited passage](' + sessionRef + '#entry-16466)');
  document.body.appendChild(root);
  function addTarget(index, label) {
    var target = document.createElement('div');
    target.dataset.historyIndexes = String(index);
    target.textContent = label || String(index);
    target.scrollIntoView = function () { scrolled.push(index); };
    messages.appendChild(target);
    return target;
  }
  var loadedTarget = addTarget(16466, 'Loaded cited passage');
  enhanceClaySessionLinks(root);
  root.querySelector('.clayos-session-link').click();
  return new Promise(function (resolve) {
    setTimeout(function () {
      if (!loadedTarget.classList.contains('session-entry-target') || scrolled[0] !== 16466) throw new Error('Same-session loaded target navigation');
      messages.innerHTML = '';
      scrolled.length = 0;
      store.set({ historyFrom: 20000, pendingSessionEntryNavigation: null });
      root.querySelector('.clayos-session-link').click();
      setTimeout(function () {
        api.handlePaletteHistoryDone();
        var loadRequest = requests[requests.length - 1];
        if (!loadRequest || loadRequest.type !== 'load_more_history' || loadRequest.target !== 16466) throw new Error('Same-session older target did not request prepend: ' + requests.map(function (item) { return item.type + ':' + (item.target || item.entryIndex || ''); }).join(',') + ' state=' + JSON.stringify({ pending: store.get('pendingSessionEntryNavigation'), historyFrom: store.get('historyFrom'), replaying: store.get('replayingHistory'), active: store.get('activeSessionId') }));
        if (!api.prependOlderHistory) throw new Error('Production prepend helper unavailable');
        messages.innerHTML = '';
        store.set({ currentMsgEl: null, currentFullText: '', replayingHistory: false });
        api.prependOlderHistory([
          { type: 'user_message', text: 'Prepended user cited passage', _historyIndex: 16465 },
          { type: 'delta', text: 'Prepended assistant cited passage part one', _historyIndex: 16466 },
          { type: 'delta', text: ' and part two', _historyIndex: 16467 },
        ], {});
        var prependedAssistant = messages.querySelector('[data-history-indexes*="16467"], [data-history-index="16467"]');
        if (!prependedAssistant || prependedAssistant.dataset.historyIndexes.indexOf('16466') === -1) throw new Error('Coalesced assistant entry attribution');
        api.handlePaletteHistoryPrepended();
        setTimeout(function () {
          var prependedTarget = messages.querySelector('[data-history-indexes*="16466"], [data-history-index="16466"]');
          if (!prependedTarget) throw new Error('Older target render');
          if (!prependedTarget.classList.contains('session-entry-target')) throw new Error('Older target navigation');
          store.set({ pendingSessionEntryNavigation: { projectSlug: 'fixture', sessionId: 7, entryIndex: 16466 }, activeSessionId: 8, replayingHistory: true });
          api.handlePaletteHistoryDone();
          if (store.get('pendingSessionEntryNavigation') !== null) throw new Error('Unrelated session retained active navigation');
          messages.innerHTML = '';
          store.set({ activeSessionId: 7, currentSlug: 'fixture', historyFrom: 0, replayingHistory: true, currentHistoryIndex: 16467, currentMsgEl: null, currentFullText: '' });
          nextResolve = { projectSlug: 'fixture', sessionId: 8, status: 'ready' };
          var differentRoot = document.createElement('div');
          differentRoot.innerHTML = renderMarkdown('[Different session](' + sessionRef + '#entry-16466)');
          document.body.appendChild(differentRoot);
          enhanceClaySessionLinks(differentRoot);
          differentRoot.querySelector('.clayos-session-link').click();
          setTimeout(function () {
            var differentTarget = addTarget(16466, 'Different session cited passage');
            store.set({ replayingHistory: false });
            api.handlePaletteHistoryDone();
            if (!differentTarget.classList.contains('session-entry-target')) throw new Error('Different-session replay navigation');
            differentRoot.remove(); messages.innerHTML = '';
            store.set({ currentSlug: 'fixture', activeSessionId: 7, pendingSessionEntryNavigation: null });
            nextResolve = { projectSlug: 'other-project', sessionId: 9, status: 'ready' };
            var plainRoot = document.createElement('div');
            plainRoot.innerHTML = renderMarkdown('[Plain session](' + sessionRef + ')');
            document.body.appendChild(plainRoot);
            enhanceClaySessionLinks(plainRoot);
            plainRoot.querySelector('.clayos-session-link').click();
            setTimeout(function () {
              if (store.get('pendingSessionEntryNavigation') !== null) throw new Error('Plain session reference created entry jump');
              plainRoot.remove();
              store.set({ currentSlug: 'fixture', activeSessionId: 7, pendingSessionEntryNavigation: null });
              nextResolve = { projectSlug: 'fixture', sessionId: 7, status: 'ready' };
              var missingRoot = document.createElement('div');
              missingRoot.innerHTML = renderMarkdown('[Missing passage](' + sessionRef + '#entry-99999)');
              document.body.appendChild(missingRoot);
              enhanceClaySessionLinks(missingRoot);
              missingRoot.querySelector('.clayos-session-link').click();
              setTimeout(function () {
                api.handlePaletteHistoryDone();
                if (store.get('pendingSessionEntryNavigation') !== null) throw new Error('Missing entry remained pending');
                missingRoot.remove();
                nextResolve = { projectSlug: 'fixture', sessionId: 7, status: 'denied', error: 'Not authorized' };
                var deniedRoot = document.createElement('div');
                deniedRoot.innerHTML = renderMarkdown('[Denied session](' + sessionRef + '#entry-16466)');
                document.body.appendChild(deniedRoot);
                enhanceClaySessionLinks(deniedRoot);
                var deniedLink = deniedRoot.querySelector('.clayos-session-link');
                deniedLink.click();
                setTimeout(function () {
                  if (!deniedLink.classList.contains('is-error')) throw new Error('Denied destination did not recover as error');
                  deniedRoot.remove();
                  nextResolve = { projectSlug: 'fixture', sessionId: 8, status: 'ready' };
                  delayedResolve = true;
                  var staleRoot = document.createElement('div');
                  staleRoot.innerHTML = renderMarkdown('[Stale response](' + sessionRef + '#entry-16466)');
                  document.body.appendChild(staleRoot);
                  enhanceClaySessionLinks(staleRoot);
                  staleRoot.querySelector('.clayos-session-link').click();
                  store.set({ currentSlug: 'manual-project', activeSessionId: 99 });
                  setTimeout(function () {
                    if (store.get('currentSlug') !== 'manual-project' || store.get('activeSessionId') !== 99) throw new Error('Late response stole manual navigation');
                    staleRoot.remove(); root.remove(); messages.innerHTML = '';
                    resolve({ sameSessionLoaded: true, sameSessionOlder: true, differentSession: true, crossProjectPlainRef: true, missingTarget: true, deniedDestination: true, staleResponseIgnored: true, coalescedAssistantAttributed: true });
                  }, 70);
                }, 30);
              }, 30);
            }, 30);
          }, 30);
        }, 30);
      }, 30);
    }, 40);
  });
}

export function checkSessionChips() {
  var root = document.createElement('div');
  var sessionRef = 'session:AAAAAAAAAAAAAAAAAAAAAAAA';
  document.body.appendChild(root);
  root.innerHTML = renderMarkdown('[Target "session"](' + sessionRef + '#entry-16466)\n\n[clayos/session:BBBBBBBBBBBBBBBBBBBBBBBB — Previous session]\n\n`' + sessionRef + '` session:CCCCCCCCCCCCCCCCCCCCCCC');
  enhanceClaySessionLinks(root);
  if (root.querySelectorAll('.clayos-session-link').length !== 2) throw new Error('Session chip count');
  if (!root.querySelector('.clayos-session-link[data-session-ref="' + sessionRef + '"]')) throw new Error('Markdown session navigation ref');
  if (root.querySelector('.clayos-session-link[data-session-ref="' + sessionRef + '"]').dataset.sessionEntryIndex !== '16466') throw new Error('Markdown session entry anchor');
  if (root.querySelector('.clayos-session-link[data-session-ref="' + sessionRef + '"]').getAttribute('aria-label') !== 'Open session from Target "session"') throw new Error('Session label escaping');
  if (!root.querySelector('.clayos-session-link[data-session-ref="session:BBBBBBBBBBBBBBBBBBBBBBBB"]')) throw new Error('Special session navigation ref');
  if (root.querySelector('code').textContent !== sessionRef) throw new Error('Session code preserved');
  if (!root.textContent.includes('session:CCCCCCCCCCCCCCCCCCCCCCC')) throw new Error('Session lookalike preserved');
  enhanceClaySessionLinks(root);
  if (root.querySelectorAll('.clayos-session-link').length !== 2) throw new Error('Session chip idempotence');
  root.remove();
  return { sessionLinks: true, codeAndLookalikes: true, idempotent: true };
}

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
  var sessionRef = 'session:AAAAAAAAAAAAAAAAAAAAAAAA';
  root.innerHTML = renderMarkdown('[Target session](' + sessionRef + ')\n\n[clayos/session:BBBBBBBBBBBBBBBBBBBBBBBB — Previous session]\n\n`' + sessionRef + '` session:CCCCCCCCCCCCCCCCCCCCCCC');
  enhanceClayLogLinks(root);
  check(root.querySelectorAll('.clayos-session-link').length === 2, 'Session chip count');
  check(root.querySelector('.clayos-session-link[data-session-ref="' + sessionRef + '"]'), 'Markdown session navigation ref');
  check(root.querySelector('.clayos-session-link[data-session-ref="session:BBBBBBBBBBBBBBBBBBBBBBBB"]'), 'Special session navigation ref');
  check(root.querySelector('code').textContent === sessionRef, 'Session code preserved');
  check(root.textContent.includes('session:CCCCCCCCCCCCCCCCCCCCCCC'), 'Session lookalike preserved');
  enhanceClayLogLinks(root);
  check(root.querySelectorAll('.clayos-session-link').length === 2, 'Session chip idempotence');
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
  return { markdownLinks: true, sessionLinks: true, bareAndInlineRefs: true, idempotent: true, githubChips: true, gitlabChips: true, codeAndExternalLinks: true, issueSummaryBodyDiscussionReview: true, sanitization: true };
}
