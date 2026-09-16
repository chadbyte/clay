var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var test = require("node:test");

function source(name) {
  return fs.readFileSync(path.join(__dirname, "../lib/public/modules", name), "utf8");
}

test("Issue updates refresh the list quietly and offer a contextual selected-issue refresh", function () {
  var issues = source("issues.js");
  assert.doesNotMatch(issues, /An issue changed\. Back returns/);
  assert.match(issues, /selected\.ref === msg\.ref && \(view === 'detail' \|\| view === 'edit'\)/);
  assert.match(issues, /view === 'list'\) listing\(\)/);
  assert.match(issues, /dataset\.issueRefresh = update\.ref/);
  assert.match(issues, /issues-inline-update/);
  assert.doesNotMatch(issues, /issues-notice.*issueRefresh/);
  assert.match(issues, /item\.intent !== 'detail' && item\.intent !== 'refresh'\) clearUpdateNotice\(\)/);
  assert.match(issues, /msg\.result\.revision.*available\.revision/);
  assert.match(issues, /hasNewerDraft\(item\)/);
  assert.match(issues, /restoreCommentDraft\(item\.draft\)/);
  assert.match(issues, /Finish editing to refresh/);
  assert.match(issues, /store\.get\('issuesView'\) === 'edit'/);
  assert.match(issues, /request\('issue_read', \{ ref: ref \}, 'refresh'\)/);
  assert.match(issues, /item\.intent === 'save'/);
  assert.match(issues, /canRestoreCommentDraft\(item\.draft, msg\.result\.ref\)/);
  assert.match(issues, /function detail\(entry\) \{\n  panel\(\)\.querySelector\('\.issues-notice'\)\.textContent = '';/);
  assert.match(issues, /export function openIssues\(ref\) \{\n  if \(!panel\(\) \|\| store\.get\('isMate'\)\) return;\n  panel\(\)\.querySelector\('\.issues-notice'\)\.textContent = '';/);
  assert.match(issues, /if \(hasNewerDraft\(item\)\) \{/);
});

test("Issue links in split panes route through the outer workbench with frame validation", function () {
  var links = source("clay-issue-links.js");
  var bridge = source("pane-bridge.js");
  var issueBridge = source("pane-issue-bridge.js");
  var split = source("split-view.js");
  assert.match(links, /forwardPaneIssueReference\(target\.ref, target\.projectSlug\)/);
  assert.match(bridge, /type: "clay-pane-open-issue"/);
  assert.match(issueBridge, /event\.origin !== window\.location\.origin/);
  assert.match(issueBridge, /contentWindow === source/);
  assert.match(issueBridge, /openIssues\(msg\.ref\)/);
  assert.match(split, /handlePaneIssueMessage\(event, host\)/);
});

test("the actual pane bridge opens an uncached same-project issue without reloading", function () {
  var bridgeSource = source("pane-issue-bridge.js").replace(/^import .*$/gm, "").replace(/export function /g, "function ");
  var opened = [];
  var assigned = [];
  var trustedWindow = {};
  var sandbox = {
    window: { location: { origin: "https://clay.test", assign: function (url) { assigned.push(url); } } },
    store: { get: function (key) { return key === "currentSlug" ? "fixture" : key === "issuesCache" ? {} : null; } },
    openIssues: function (ref) { opened.push(ref); },
  };
  vm.runInNewContext(bridgeSource + "\nthis.run = handlePaneIssueMessage;", sandbox);
  var host = { querySelectorAll: function () { return [{ contentWindow: trustedWindow }]; } };
  var ref = "issue:123456789012345678901234";
  assert.equal(sandbox.run({ origin: "https://clay.test", source: trustedWindow, data: { type: "clay-pane-open-issue", ref: ref, projectSlug: "fixture" } }, host), true);
  assert.deepEqual(opened, [ref]);
  assert.deepEqual(assigned, []);
  sandbox.run({ origin: "https://clay.test", source: {}, data: { type: "clay-pane-open-issue", ref: ref, projectSlug: "fixture" } }, host);
  assert.deepEqual(opened, [ref]);
});

test("the actual update renderer places the affordance inside issue actions", function () {
  var issuesSource = source("issues.js");
  var start = issuesSource.indexOf("function clearUpdateNotice");
  var end = issuesSource.indexOf("function refreshSelectedIssue", start);
  var actionSource = issuesSource.slice(start, end).replace(/export function /g, "function ");
  function node(tag) {
    return { tagName: tag, children: [], dataset: {}, parentNode: null, appendChild: function (child) { child.parentNode = this; this.children.push(child); return child; }, insertBefore: function (child) { child.parentNode = this; this.children.unshift(child); return child; }, remove: function () { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(function (item) { return item !== this; }, this); }, querySelector: function (selector) { if (selector === ".issue-detail .issue-actions" && this.issueActions) return this.issueActions; if (selector === "#issue-form .issue-actions" && this.formActions) return this.formActions; if (selector === "[data-issue-update-notice]" && this.updateNotice) return this.updateNotice; return null; } };
  }
  var actions = node("div");
  var root = node("main"); root.issueActions = actions;
  var sandbox = { store: { get: function (key) { return key === "issuesUpdateAvailable" ? { ref: "issue:123456789012345678901234", revision: 2 } : null; }, set: function () {} }, content: function () { return root; }, panel: function () { return root; }, document: { createElement: function (tag) { return node(tag); }, createTextNode: function (text) { return { textContent: text }; } } };
  vm.runInNewContext(actionSource + "\nthis.render = renderContextualUpdate;", sandbox);
  sandbox.render();
  assert.equal(actions.children.length, 1);
  assert.equal(actions.children[0].className, "issues-inline-update");
  assert.equal(actions.children[0].parentNode, actions);
});

test("the detail response guard treats typing during a read as newer draft state", function () {
  var issuesSource = source("issues.js");
  var start = issuesSource.indexOf("function hasNewerDraft");
  var end = issuesSource.indexOf("function noteIssueUpdate", start);
  var guardSource = issuesSource.slice(start, end);
  var sandbox = { store: { get: function (key) { return key === "issuesViewGeneration" ? 8 : null; } } };
  vm.runInNewContext(guardSource + "\nthis.guard = hasNewerDraft;", sandbox);
  assert.equal(sandbox.guard({ intent: "detail", viewGeneration: 7 }), true);
  assert.equal(sandbox.guard({ intent: "refresh", viewGeneration: 7 }), true);
  assert.equal(sandbox.guard({ intent: "detail", viewGeneration: 8 }), false);
  assert.equal(sandbox.guard({ intent: "list", viewGeneration: 7 }), false);
});

test("comment drafts only restore for the issue that started the read", function () {
  var issuesSource = source("issues.js");
  var start = issuesSource.indexOf("function canRestoreCommentDraft");
  var end = issuesSource.indexOf("function hasNewerDraft", start);
  var sandbox = {};
  vm.runInNewContext(issuesSource.slice(start, end) + "\nthis.canRestore = canRestoreCommentDraft;", sandbox);
  assert.equal(sandbox.canRestore({ ref: "issue:123456789012345678901234", comment: "draft" }, "issue:123456789012345678901234"), true);
  assert.equal(sandbox.canRestore({ ref: "issue:123456789012345678901234", comment: "draft" }, "issue:654321098765432109876543"), false);
});
