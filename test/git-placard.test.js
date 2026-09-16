// Repository placard: Git leaves the tool palette and becomes an always-visible
// compact block under the tool strip. These tests cover the projection logic,
// the rendering contract (including "show nothing rather than a placeholder"),
// and the wiring that keeps one Git request path and one Git surface.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

var placardSource = read("lib/public/modules/git-placard.js");
var panelSource = read("lib/public/modules/git-panel.js");
var sidebarSource = read("lib/public/modules/sidebar.js");
var appSource = read("lib/public/app.js");
var indexHtml = read("lib/public/index.html");
var placardCss = read("lib/public/css/git-placard.css");
var inputCss = read("lib/public/css/input.css");
var styleCss = read("lib/public/style.css");

// --- Fake DOM -------------------------------------------------------------
//
// There is no DOM harness in this suite, so the module is evaluated with its
// imports stubbed and a minimal element model. Only what the placard touches
// is modelled; anything else would be pretending to test a browser.

function makeElement(id) {
  var classes = {};
  return {
    id: id,
    innerHTML: "",
    attributes: {},
    classList: {
      add: function (name) { classes[name] = true; },
      remove: function (name) { delete classes[name]; },
      contains: function (name) { return !!classes[name]; },
    },
    setAttribute: function (name, value) { this.attributes[name] = value; },
    removeAttribute: function (name) { delete this.attributes[name]; },
  };
}

function loadPlacard() {
  var body = placardSource
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/^export function/gm, "function");
  var elements = { "git-placard": makeElement("git-placard"), "git-placard-body": makeElement("git-placard-body") };
  var iconCalls = [];
  var refreshCalls = { count: 0 };
  var fakeDocument = {
    getElementById: function (id) { return elements[id] || null; },
  };
  var factory = new Function(
    "document", "escapeHtml", "iconHtml", "refreshIcons",
    body + "\nreturn { mergeStatusIntoSummary: mergeStatusIntoSummary, accessibleLabel: accessibleLabel," +
      " renderGitPlacard: renderGitPlacard, hideGitPlacard: hideGitPlacard };"
  );
  var api = factory(
    fakeDocument,
    function (value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    },
    function (name) { iconCalls.push(name); return "<i data-lucide=\"" + name + "\"></i>"; },
    function () { refreshCalls.count++; }
  );
  api.elements = elements;
  api.iconCalls = iconCalls;
  api.refreshCalls = refreshCalls;
  return api;
}

function fullStatus(overrides) {
  return Object.assign({
    isRepository: true,
    name: "throughline-portal",
    root: "/Users/chad/clay-projects/throughline-portal",
    gitDir: "/Users/chad/clay-projects/throughline-portal/.git",
    mainWorktree: "/Users/chad/clay-projects/throughline-portal",
    origin: "git@github.com:ThroughLineCare/throughline-portal.git",
    branch: "codex/centralize-sdk-login",
    detached: false,
    oid: "6cdcc4109e91570867f8848c0e04e8b52d3b32e7",
    upstream: "origin/codex/centralize-sdk-login",
    ahead: 2,
    behind: 0,
    isWorktree: false,
    files: [],
  }, overrides || {});
}

// --- Projection -----------------------------------------------------------

test("a non-repository status projects to nothing at all", function () {
  var api = loadPlacard();
  assert.equal(api.mergeStatusIntoSummary(null, null), null);
  assert.equal(api.mergeStatusIntoSummary({ isRepository: false }, null), null);
  assert.equal(api.mergeStatusIntoSummary({ isRepository: false, loadError: "boom" }, null), null);
});

test("the projection carries identity, branch and bounded counts", function () {
  var api = loadPlacard();
  var summary = api.mergeStatusIntoSummary(fullStatus({
    files: [
      { path: "a.js", staged: true, unstaged: false, untracked: false, conflicted: false },
      { path: "b.js", staged: false, unstaged: true, untracked: false, conflicted: false },
      { path: "c.js", staged: false, unstaged: true, untracked: true, conflicted: false },
      { path: "d.js", staged: true, unstaged: true, untracked: false, conflicted: true },
    ],
  }), null);

  assert.equal(summary.name, "throughline-portal");
  assert.equal(summary.branch, "codex/centralize-sdk-login");
  assert.equal(summary.changed, 4);
  assert.equal(summary.staged, 2);
  assert.equal(summary.unstaged, 2, "an untracked file is not double counted as unstaged");
  assert.equal(summary.untracked, 1);
  assert.equal(summary.conflicted, 1);
  assert.equal(summary.hasUpstream, true);
  assert.equal(summary.ahead, 2);
  assert.equal(summary.behind, 0);
});

test("the projection never carries a filesystem path", function () {
  var api = loadPlacard();
  var summary = api.mergeStatusIntoSummary(fullStatus(), null);
  var keys = Object.keys(summary);
  assert.equal(keys.indexOf("root"), -1);
  assert.equal(keys.indexOf("gitDir"), -1);
  assert.equal(keys.indexOf("commonDir"), -1);
  assert.equal(keys.indexOf("mainWorktree"), -1);
  assert.equal(keys.indexOf("origin"), -1, "the raw remote URL is not projected either");
  assert.equal(keys.indexOf("files"), -1);
  for (var i = 0; i < keys.length; i++) {
    var value = summary[keys[i]];
    if (typeof value !== "string") continue;
    assert.equal(value.indexOf("/Users/"), -1, keys[i] + " must not contain an absolute path");
  }
});

test("the remote label comes only from the server summary, never parsed client-side", function () {
  var api = loadPlacard();
  var withoutPrevious = api.mergeStatusIntoSummary(fullStatus(), null);
  assert.equal(withoutPrevious.remote, null,
    "a raw origin URL in the panel status is never turned into a label here");

  var withPrevious = api.mergeStatusIntoSummary(fullStatus(), {
    remote: "github.com/ThroughLineCare/throughline-portal",
    name: "stale-name",
  });
  assert.equal(withPrevious.remote, "github.com/ThroughLineCare/throughline-portal");
  assert.equal(withPrevious.name, "throughline-portal", "the fresher status wins for identity");
  assert.equal(/git@|https:\/\//.test(placardSource), false,
    "the client does not parse remote URLs");
});

test("a detached head reports the short oid instead of a branch", function () {
  var api = loadPlacard();
  var summary = api.mergeStatusIntoSummary(fullStatus({ detached: true, branch: null }), null);
  assert.equal(summary.branch, null);
  assert.equal(summary.detached, true);
  assert.equal(summary.shortOid, "6cdcc410");
  assert.match(api.accessibleLabel(summary), /Detached at 6cdcc410/);
});

// --- Accessible label -----------------------------------------------------

test("the placard announces one full sentence rather than bare numbers", function () {
  var api = loadPlacard();
  var label = api.accessibleLabel(api.mergeStatusIntoSummary(fullStatus({
    isWorktree: true,
    behind: 3,
    files: [{ path: "a.js", staged: false, unstaged: true, untracked: false, conflicted: false }],
  }), { remote: "github.com/ThroughLineCare/throughline-portal" }));

  assert.match(label, /Repository throughline-portal/);
  assert.match(label, /branch codex\/centralize-sdk-login/);
  assert.match(label, /linked worktree/);
  assert.match(label, /1 changed files/);
  assert.match(label, /2 ahead/);
  assert.match(label, /3 behind/);
  assert.match(label, /remote github\.com\/ThroughLineCare\/throughline-portal/);

  var clean = api.accessibleLabel(api.mergeStatusIntoSummary(fullStatus({ ahead: 0 }), null));
  assert.match(clean, /working tree clean/);
  assert.equal(/ahead|behind/.test(clean), false, "a synced branch says nothing about sync");
  assert.equal(api.accessibleLabel(null), "");
});

// --- Rendering ------------------------------------------------------------

test("no repository renders no placeholder and no flash", function () {
  var api = loadPlacard();
  api.renderGitPlacard(null);
  assert.equal(api.elements["git-placard"].classList.contains("hidden"), true);
  assert.equal(api.elements["git-placard-body"].innerHTML, "");
  assert.equal(api.elements["git-placard"].attributes["aria-label"], undefined);

  api.renderGitPlacard({ isRepository: false });
  assert.equal(api.elements["git-placard"].classList.contains("hidden"), true);
  assert.equal(api.elements["git-placard-body"].innerHTML, "");
});

test("a real repository renders identity, branch and a bounded status glance", function () {
  var api = loadPlacard();
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({
    files: [
      { path: "a.js", staged: true, unstaged: false, untracked: false, conflicted: false },
      { path: "b.js", staged: false, unstaged: true, untracked: false, conflicted: false },
    ],
  }), { remote: "github.com/ThroughLineCare/throughline-portal" }));

  var el = api.elements["git-placard"];
  var html = api.elements["git-placard-body"].innerHTML;
  assert.equal(el.classList.contains("hidden"), false);
  assert.match(html, /git-placard-repo">throughline-portal</);
  assert.match(html, /git-placard-branch">codex\/centralize-sdk-login</);
  assert.match(html, /2 changed/);
  assert.match(html, /git-placard-remote/);
  assert.match(html, /github\.com\/ThroughLineCare\/throughline-portal/);
  assert.equal(html.indexOf("/Users/"), -1, "no filesystem path is ever rendered");
  assert.ok(el.attributes["aria-label"].length > 0, "the group carries its own label");
});

test("a clean tree says so, and sync counts appear only when there is an upstream", function () {
  var api = loadPlacard();
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({ ahead: 0, behind: 0 }), null));
  assert.match(api.elements["git-placard-body"].innerHTML, /Clean/);

  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({ ahead: 4, behind: 1 }), null));
  var synced = api.elements["git-placard-body"].innerHTML;
  assert.match(synced, /arrow-up"><\/i>4/);
  assert.match(synced, /arrow-down"><\/i>1/);

  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({ upstream: null, ahead: 0, behind: 0 }), null));
  var noUpstream = api.elements["git-placard-body"].innerHTML;
  assert.equal(/arrow-up|arrow-down/.test(noUpstream), false,
    "without an upstream there is no ahead/behind claim to make");
});

test("conflicts and linked worktrees are surfaced as bounded labels", function () {
  var api = loadPlacard();
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({
    isWorktree: true,
    files: [{ path: "a.js", staged: true, unstaged: true, untracked: false, conflicted: true }],
  }), null));
  var html = api.elements["git-placard-body"].innerHTML;
  assert.match(html, /Linked worktree/);
  assert.match(html, /git-placard-stat-warn">1 conflicted</);

  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({ detached: true, branch: null }), null));
  assert.match(api.elements["git-placard-body"].innerHTML, /git-placard-badge-warn">Detached</);
});

test("an unchanged reading does not rewrite the DOM", function () {
  var api = loadPlacard();
  var summary = api.mergeStatusIntoSummary(fullStatus(), null);
  api.renderGitPlacard(summary);
  var firstRefresh = api.refreshCalls.count;
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus(), null));
  assert.equal(api.refreshCalls.count, firstRefresh, "identical data re-renders nothing");
});

test("hiding clears the label and the body so nothing stale survives a switch", function () {
  var api = loadPlacard();
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus(), null));
  api.hideGitPlacard();
  assert.equal(api.elements["git-placard"].classList.contains("hidden"), true);
  assert.equal(api.elements["git-placard-body"].innerHTML, "");
  assert.equal(api.elements["git-placard"].attributes["aria-label"], undefined);

  // And the next render after a hide repaints rather than short-circuiting.
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus(), null));
  assert.match(api.elements["git-placard-body"].innerHTML, /throughline-portal/);
});

// --- Markup and wiring ----------------------------------------------------

test("the placard sits directly below the tool strip and starts hidden", function () {
  var toolsBlock = indexHtml.slice(indexHtml.indexOf('<div id="sidebar-tools">'));
  toolsBlock = toolsBlock.slice(0, toolsBlock.indexOf('<div id="sidebar-sessions-header">'));
  assert.ok(toolsBlock.indexOf('id="session-actions"') !== -1);
  assert.ok(toolsBlock.indexOf('id="git-placard"') > toolsBlock.indexOf('id="session-actions-hidden"'),
    "the placard follows the tool palette inside the tool strip container");
  assert.match(toolsBlock, /id="git-placard" class="git-placard hidden"/);
  assert.match(toolsBlock, /id="git-placard-body"[^>]*aria-hidden="true"/,
    "the rendered rows are not announced twice");
  assert.match(toolsBlock, /id="git-placard-more"[^>]*aria-label="Open Git panel[^"]*"/);
  assert.match(toolsBlock, /<button id="git-placard-more"[^>]*type="button"/,
    "More is a real button, so keyboard activation and focus come for free");
});

test("More opens the existing Git panel through its existing lifecycle", function () {
  assert.match(sidebarSource, /gitPlacardMore\.addEventListener\("click"/);
  var handler = sidebarSource.slice(sidebarSource.indexOf("if (gitPlacardMore) {"));
  handler = handler.slice(0, handler.indexOf("// --- User island width sync"));
  assert.match(handler, /hideGitPanel\(function \(\) \{ showSessionsPanel\(\); \}\)/,
    "closing still returns to the sessions panel");
  assert.match(handler, /else showGitPanel\(\);/, "opening still runs the panel's own opener");
  assert.match(handler, /if \(event\.target\.closest\("#git-placard-more"\)\) return;/);
  assert.match(handler, /gitPlacardMore\.click\(\);/,
    "the block forwards to the single control instead of duplicating the action");

  // The panel itself is untouched: same container, same refresh on open.
  assert.match(sidebarSource, /function showGitPanel\(\)[\s\S]*?refreshGitStatus\(\);/);
  assert.match(indexHtml, /<div id="sidebar-panel-git" class="sidebar-panel hidden">/);
  assert.match(indexHtml, /id="git-panel-refresh"/);
  assert.match(indexHtml, /id="git-panel-close"/);
});

test("tool mutual exclusion and the permission gate follow the placard", function () {
  assert.match(appSource, /var gitPlacardMoreBtn = \$\("git-placard-more"\);/);
  assert.match(appSource,
    /if \(gitPlacardMoreBtn\) gitPlacardMoreBtn\.addEventListener\("click", function \(\) \{ closeIssues\(\); closeProjectLogs\(\); closeScheduledTasks\(\); if \(isNotesBrowserOpen\(\)\) closeNotesBrowser\(\); if \(isSchedulerOpen\(\)\) closeScheduler\(\); \}\);/,
    "opening Git still dismisses the other right-hand tools");
  var permBlock = appSource.slice(appSource.indexOf("if (!_perms.fileBrowser) {"));
  permBlock = permBlock.slice(0, permBlock.indexOf("if (!_perms.skills) {"));
  assert.match(permBlock, /getElementById\("git-placard"\)/,
    "a user without file-browser permission does not see the placard");
});

test("the Git surface closes through its own control, not a removed tile", function () {
  var handoffSource = read("lib/public/modules/git-agent-sessions.js");
  assert.equal(/git-sidebar-btn|git-sidebar-count/.test(panelSource + handoffSource + sidebarSource + appSource), false,
    "no reference to the retired tile survives anywhere");
  assert.match(handoffSource, /export function closeGitSurface\(\)[\s\S]*?getElementById\("git-panel-close"\)/);
  assert.match(panelSource, /closeGitSurface\(\);/, "returning to a session closes the panel the same way");
  assert.match(handoffSource, /closeGitSurface\(\);/, "so does an agent handoff");
  assert.equal((handoffSource.match(/function closeGitSurface/g) || []).length, 1,
    "one teardown, defined once");
});

test("the agent handoff split leaves one Git data path and no duplicate helpers", function () {
  var handoffSource = read("lib/public/modules/git-agent-sessions.js");
  assert.ok(handoffSource.split("\n").length < 500);
  assert.equal(/fetch\(|api\/git|refreshGitSummary|mergeStatusIntoSummary/.test(handoffSource), false,
    "the handoff module holds no Git reading of its own");
  assert.match(panelSource, /import \{[\s\S]*?\} from '\.\/git-agent-sessions\.js';/);

  // Helpers moved rather than copied.
  var moved = ["function splitFilePath", "function compactSessionTitle", "function startFocusedAgentSession"];
  for (var i = 0; i < moved.length; i++) {
    assert.equal(panelSource.indexOf(moved[i]), -1, moved[i] + " is not defined twice");
    assert.ok(handoffSource.indexOf(moved[i]) !== -1, moved[i] + " has exactly one home");
  }
  assert.equal(/=>/.test(handoffSource), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(handoffSource), false, "var only");
});

// --- One source of truth --------------------------------------------------

test("there is exactly one Git request path in the client", function () {
  var placardRequests = placardSource.match(/fetch\(|api\/git/g) || [];
  assert.deepEqual(placardRequests, [],
    "the placard renders what it is handed and never requests anything itself");

  assert.match(panelSource, /api\/git\/status/);
  assert.match(panelSource, /api\/git\/summary/);
  var otherModules = [sidebarSource, appSource, read("lib/public/modules/git-agent-sessions.js")];
  for (var i = 0; i < otherModules.length; i++) {
    assert.equal(/api\/git/.test(otherModules[i]), false,
      "the panel module owns every Git endpoint the client uses");
  }
  assert.equal((panelSource.match(/setInterval\(/g) || []).length, 1,
    "one timer serves both readings");
});

test("the single timer never runs both readings and never polls a hidden tab", function () {
  var timer = panelSource.slice(panelSource.indexOf("setInterval(function () {"));
  timer = timer.slice(0, timer.indexOf("}, POLL_MS);"));
  assert.match(timer, /if \(panelOpen\) \{[\s\S]*?refreshGitStatus\(\);\s*\n\s*return;/,
    "an open panel keeps its existing cadence and returns");
  assert.match(timer, /if \(summaryTicks < SUMMARY_TICKS\) return;/,
    "the closed-panel summary runs on a slower cadence");
  assert.match(timer, /document\.hidden \|\| store\.get\('dmMode'\) \|\| !store\.get\('connected'\) \|\| busy/);
  assert.match(panelSource, /var SUMMARY_TICKS = 6;/);
  assert.equal(/--cached|diff/.test(panelSource.slice(panelSource.indexOf("setInterval("))), false,
    "no periodic diff work");
});

test("the placard is a projection of the panel status, not a parallel reading", function () {
  var sync = panelSource.slice(panelSource.indexOf("function syncPlacard()"));
  sync = sync.slice(0, sync.indexOf("export function refreshGitSummary"));
  assert.match(sync, /currentSummary = mergeStatusIntoSummary\(currentStatus, currentSummary\);/,
    "a full status supersedes the cheap summary so the two cannot disagree");
  assert.match(panelSource, /function render\(\)[\s\S]*?syncPlacard\(\);/,
    "every panel render refreshes the placard from the same state");

  // A completed Git action reuses the status it already got back.
  var action = panelSource.slice(panelSource.indexOf("function runAction(action, paths)"));
  action = action.slice(0, action.indexOf("function openFileDiff"));
  assert.match(action, /currentStatus = result\.status;/);
  assert.equal(/refreshGitSummary|refreshGitStatus/.test(action), false,
    "an action does not trigger an extra request for data it was handed");
});

test("reconnect, project switch and Mate DM all reset the surface", function () {
  var lifecycle = panelSource.slice(panelSource.indexOf("function initGitLifecycle()"));
  lifecycle = lifecycle.slice(0, lifecycle.indexOf("export function initGitPanel"));
  assert.match(lifecycle, /state\.basePath !== prev\.basePath \|\| state\.currentSlug !== prev\.currentSlug/);
  assert.match(lifecycle, /resetGitSurface\(\);/, "a project switch clears the previous repository");
  assert.match(lifecycle, /if \(state\.connected && !prev\.connected && !state\.dmMode\) refreshGitSummary\(\);/,
    "a reconnect re-reads without tearing down what the user is looking at");
  assert.match(lifecycle, /if \(state\.dmMode\) hideGitPlacard\(\);/,
    "a Mate DM surface has no repository to show");

  var reset = panelSource.slice(panelSource.indexOf("export function resetGitSurface()"));
  reset = reset.slice(0, reset.indexOf("export function refreshGitStatus"));
  assert.match(reset, /currentStatus = null;/);
  assert.match(reset, /currentSummary = null;/);
  assert.match(reset, /hideGitPlacard\(\);/);
});

test("a surface without a project never issues a repository request", function () {
  assert.match(panelSource, /function hasProjectBasePath\(\)[\s\S]*?indexOf\("\/p\/"\) === 0/);
  var summary = panelSource.slice(panelSource.indexOf("export function refreshGitSummary()"));
  summary = summary.slice(0, summary.indexOf("export function resetGitSurface"));
  assert.match(summary, /if \(busy \|\| !hasProjectBasePath\(\) \|\| !placardMounted\(\)\) return/,
    "Home and any placard-less surface are skipped before any fetch");
  assert.match(summary, /store\.get\('basePath'\) !== basePath/,
    "a response for the previous project is discarded");
  assert.match(summary, /currentSummary = null;\s*\n\s*syncPlacard\(\);/,
    "an unavailable or forbidden repository shows nothing, not an error block");
});

// --- Presentation ---------------------------------------------------------

test("the placard reuses theme tokens and stays subordinate to the tool strip", function () {
  assert.match(styleCss, /@import url\("css\/git-placard\.css"\);/);
  assert.match(placardCss, /\.git-placard\.hidden \{ display: none; \}/);
  assert.match(placardCss, /background: var\(--bg-alt\)/);
  assert.match(placardCss, /border: 1px solid var\(--border-subtle\)/);

  // No invented palette: every color is a token or a mix of tokens.
  var colors = placardCss.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || [];
  assert.deepEqual(colors, [], "no literal colors, tokens only");

  // Subordinate: smaller than the repo name in the panel's own card.
  assert.match(placardCss, /\.git-placard-repo \{[^}]*font-size: 11px/s);
  assert.match(placardCss, /\.git-placard-branch \{[^}]*font-size: 10px/s);
});

test("focus-visible and reduced motion are both honored", function () {
  assert.match(placardCss, /\.git-placard-more:focus-visible \{[^}]*box-shadow: 0 0 0 2px var\(--accent-25\)/s);
  assert.match(placardCss, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.git-placard-more \{ transition: none; \}/s);
});

test("mobile keeps its existing behavior: the tool strip and the placard with it", function () {
  var mobileHide = inputCss.slice(inputCss.indexOf("/* Hide sidebar tools & title bar status icons"));
  mobileHide = mobileHide.slice(0, mobileHide.indexOf("}") + 1);
  assert.match(mobileHide, /#sidebar-tools,/,
    "the placard lives inside #sidebar-tools, so the existing mobile rule covers it");
  assert.equal(/git-placard/.test(inputCss), false, "no bespoke mobile exception is needed");
});

// --- Conventions ----------------------------------------------------------

test("the placard module follows the client conventions", function () {
  assert.equal(/=>/.test(placardSource), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(placardSource), false, "var only");
  assert.equal(/localStorage|sessionStorage/.test(placardSource), false, "no client-side settings storage");
  assert.equal(/alert\(|confirm\(|prompt\(/.test(placardSource), false, "no native dialogs");
  assert.equal(/_ctx|initGitPlacard\(ctx\)/.test(placardSource), false, "no init context bag");
  assert.match(placardSource, /^import \{ escapeHtml \} from '\.\/utils\.js';$/m, "direct imports");
  assert.match(placardSource, /export function renderGitPlacard/, "ESM export");
  assert.ok(placardSource.split("\n").length < 500, "under the module size limit");
  assert.ok(panelSource.split("\n").length < 500, "the panel stays under the module size limit");
});

test("every value the placard renders is escaped", function () {
  var api = loadPlacard();
  api.renderGitPlacard(api.mergeStatusIntoSummary(fullStatus({
    name: "<script>x</script>",
    branch: "feat/<b>",
  }), { remote: "example.com/<i>" }));
  var html = api.elements["git-placard-body"].innerHTML;
  assert.equal(html.indexOf("<script>"), -1);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /feat\/&lt;b&gt;/);
  assert.match(html, /example\.com\/&lt;i&gt;/);
});
