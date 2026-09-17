import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { forwardPaneIssueReference } from './pane-bridge.js';
function accountKey(state) { return state.isMultiUserMode ? 'user:' + String(state.myUserId || '') : 'single'; }
function requestContext(state) { return { accountKey: accountKey(state), projectSlug: state.currentSlug || null, epoch: state.issuesEpoch || 0 }; }
function sameContext(request, state) {
  var current = requestContext(state);
  return !!request && request.accountKey === current.accountKey && request.projectSlug === current.projectSlug && request.epoch === current.epoch;
}
export function parseClayIssueReferences(text) {
  var pattern = /\[clayos\/(issue:[A-Za-z0-9_-]{24})(?:\s+[\u2014-]\s+([^\]\n]{1,80}))?\]|(^|[^A-Za-z0-9_/:])(issue:[A-Za-z0-9_-]{24})(?![A-Za-z0-9_-])/g;
  var results = [];
  var match;
  while ((match = pattern.exec(text || ""))) {
    results.push({
      start: match.index,
      end: pattern.lastIndex,
      prefix: match[3] || "",
      ref: match[1] || match[4],
      label: match[2] ? match[2].trim() : "",
    });
  }
  return results;
}

export function isExactClayIssueReference(text) {
  return /^issue:[A-Za-z0-9_-]{24}$/.test((text || "").trim());
}

function createIssueLink(ref, labelText) {
  var button = document.createElement("button");
  button.type = "button";
  button.className = "clayos-issue-link";
  button.classList.add("clayos-record-link");
  button.contentEditable = "false";
  button.dataset.issueRef = ref;
  button.setAttribute("aria-label", "Open Project Issue" + (labelText ? " " + labelText : ""));
  var label = document.createElement("span");
  label.textContent = "Issue";
  button.appendChild(label);
  if (labelText) {
    var meta = document.createElement("small");
    meta.textContent = labelText;
    button.appendChild(meta);
  }
  var cache = store.get('issuesCache') || {};
  if (cache[ref]) updateIssueLink(button, cache[ref]);
  setTimeout(function () { resolve(ref); }, 0);
  return button;
}

export function enhanceClayIssueLinks(root) {
  root.querySelectorAll('a').forEach(function (anchor) {
    var ref = anchor.getAttribute('data-clay-record-ref') || anchor.getAttribute('href');
    if (anchor.closest('pre, code, button') || !isExactClayIssueReference(ref)) return;
    anchor.replaceWith(createIssueLink(ref.trim(), anchor.textContent.trim()));
  });
  var codeNodes = root.querySelectorAll("code");
  for (var codeIndex = 0; codeIndex < codeNodes.length; codeIndex++) {
    var code = codeNodes[codeIndex];
    var codeText = (code.textContent || "").trim();
    if (code.closest("pre") || !isExactClayIssueReference(codeText)) continue;
    code.parentNode.replaceChild(createIssueLink(codeText, ""), code);
  }

  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var nodes = [];
  var node;
  while ((node = walker.nextNode())) {
    if (!node.parentElement || node.parentElement.closest("code, pre, a, button")) continue;
    if (parseClayIssueReferences(node.nodeValue).length) nodes.push(node);
  }
  for (var i = 0; i < nodes.length; i++) {
    var text = nodes[i].nodeValue || "";
    var matches = parseClayIssueReferences(text);
    var fragment = document.createDocumentFragment();
    var offset = 0;
    for (var j = 0; j < matches.length; j++) {
      var match = matches[j];
      fragment.appendChild(document.createTextNode(text.slice(offset, match.start)));
      if (match.prefix) fragment.appendChild(document.createTextNode(match.prefix));
      fragment.appendChild(createIssueLink(match.ref, match.label));
      offset = match.end;
    }
    fragment.appendChild(document.createTextNode(text.slice(offset)));
    nodes[i].parentNode.replaceChild(fragment, nodes[i]);
  }
}

export function updateIssueLink(button, target) {
  var status = target.status || 'open';
  var title = target.title || 'Issue';
  button.replaceChildren();
  var label = document.createElement('span');
  label.textContent = 'Issue';
  var meta = document.createElement('small');
  meta.textContent = title;
  button.append(label, meta);
  button.dataset.status = status;
  button.title = title + ' · ' + status.replace(/_/g, ' ');
  button.setAttribute('aria-label', 'Open Project Issue: ' + button.title);
}

function resolve(ref) {
  var ws = getWs();
  var requests = store.get('issueLinkRequests') || {};
  if (!ws || ws.readyState !== 1 || requests[ref]) return;
  var next = Object.assign({}, requests);
  var requestId = crypto.randomUUID();
  next[ref] = Object.assign({ requestId: requestId }, requestContext(store.snap()));
  store.set({ issueLinkRequests: next });
  ws.send(JSON.stringify({ type: 'issue_reference_resolve', ref: ref, requestId: requestId }));
}
export function handleIssueReference(msg) {
  if (msg.type !== 'issue_reference_result') return false;
  var requests = store.get('issueLinkRequests') || {};
  var request = requests[msg.ref];
  if (!request || request.requestId !== msg.requestId || !sameContext(request, store.snap())) return true;
  var next = Object.assign({}, requests); delete next[msg.ref]; store.set({ issueLinkRequests: next });
  if (msg.target) {
    var cache = Object.assign({}, store.get('issuesCache') || {}); cache[msg.ref] = msg.target; store.set({ issuesCache: cache });
  }
  document.querySelectorAll('[data-issue-ref]').forEach(function (button) {
    if (button.dataset.issueRef !== msg.ref) return;
    if (msg.target) updateIssueLink(button, msg.target);
    else button.title = msg.error || 'Issue unavailable';
  });
  if (store.get('issueLinkOpenRef') === msg.ref) {
    store.set({ issueLinkOpenRef: null });
    if (msg.target) navigate(msg.target);
  }
  return true;
}
function navigate(target) {
  if (forwardPaneIssueReference(target.ref, target.projectSlug)) return;
  if (target.projectSlug !== store.get('currentSlug')) { window.location.assign('/p/' + encodeURIComponent(target.projectSlug) + '/?issue=' + encodeURIComponent(target.ref)); return; }
  import('./issues.js').then(function (module) { module.openIssues(target.ref); });
}
export function initIssueLinks() {
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-issue-ref]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    var ref = button.dataset.issueRef;
    var target = (store.get('issuesCache') || {})[ref];
    if (!target) { store.set({ issueLinkOpenRef: ref }); resolve(ref); return; }
    navigate(target);
  });
  store.subscribe(function (state, previous) {
    if (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId || state.isMultiUserMode !== previous.isMultiUserMode ||
        (previous.connected && !state.connected)) store.set({ issueLinkRequests: {}, issueLinkOpenRef: null, issuesCache: {} });
  });
}
