// The Sticky Notes browser is a bounded right workbench window, and the
// lifecycle it exposes is Open/Closed with Close/Reopen and confirmed deletion
// for Closed notes only.
//
// These are source-contract tests, the same shape the Project Logs UI uses:
// they pin the geometry, the vocabulary, the wiring, and the absence of a
// destructive control. They do not execute the DOM.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");

var root = path.join(__dirname, "..");
function source(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

var browserSource = source("lib/public/modules/sticky-notes-browser.js");
var canvasSource = source("lib/public/modules/sticky-notes.js");
var sharedSource = source("lib/public/modules/sticky-notes-shared.js");
var cardSource = source("lib/public/modules/sticky-notes-card.js");
var editorSource = source("lib/public/modules/sticky-notes-editor.js");
// Every sticky-note client module, for the structural rules that apply to all.
var STICKY_MODULES = [
  "sticky-notes.js", "sticky-notes-shared.js", "sticky-notes-card.js",
  "sticky-notes-editor.js", "sticky-notes-browser.js",
];
var appSource = source("lib/public/app.js");
var logsSource = source("lib/public/modules/project-logs.js");
var css = source("lib/public/css/sticky-notes.css");

// --- geometry -------------------------------------------------------------

test("the browser mounts in the right workbench slot, not over the app", function () {
  assert.match(browserSource, /document\.getElementById\("main-panels"\)/,
    "it is a sibling of #app in the workbench, like the other tools");
  assert.match(browserSource, /panels\.appendChild\(panel\)/);
  // The retired fullscreen surface hid the conversation and composer. Nothing
  // in the browser may do that any more.
  assert.doesNotMatch(browserSource, /getElementById\("messages"\)/, "the transcript is left alone");
  assert.doesNotMatch(browserSource, /getElementById\("input-area"\)/, "the composer is left alone");
  assert.doesNotMatch(browserSource, /title-bar-content/, "the session title bar is left alone");
});

test("desktop geometry matches the established workbench window", function () {
  var desktop = css.substring(css.indexOf("@media (min-width: 1024px)"));
  var panelBlock = desktop.substring(desktop.indexOf("#notes-browser {"), desktop.indexOf("#notes-browser.hidden"));
  assert.match(panelBlock, /width:\s*50%/, "same default width as Logs and the viewer");
  assert.match(panelBlock, /max-width:\s*720px/);
  assert.match(panelBlock, /min-width:\s*360px/);
  assert.match(panelBlock, /border-radius:\s*12px/);
  assert.match(css, /#notes-browser\.notes-browser-wide \{ width: 70%; max-width: 1200px; \}/,
    "optional wide state, as the shared pattern supports");
  assert.match(css, /#notes-browser\.panel-fullscreen \{/, "and the shared optional fullscreen class");
});

test("mobile is a full viewport overlay with no window chrome", function () {
  var narrow = css.substring(css.indexOf("@media (max-width: 1023px)"));
  var block = narrow.substring(0, narrow.indexOf("/* --- Top bar --- */"));
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /top:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0/);
  assert.match(block, /padding-top:\s*var\(--safe-top\)/, "notch-safe, like the other tools");
  assert.match(block, /#notes-browser-wide,\s*\n\s*#notes-browser-fullscreen \{ display: none; \}/,
    "width and fullscreen controls are meaningless at viewport size");
});

test("reduced motion drops the panel animation", function () {
  var reduced = css.substring(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced.substring(0, 120), /#notes-browser \{ animation: none; \}/);
});

// --- lifecycle vocabulary and controls ------------------------------------

test("the surface says Open, Closed, Close, and Reopen", function () {
  assert.match(browserSource, /label: "Open"/);
  assert.match(browserSource, /label: "Closed"/);
  assert.match(browserSource, /<span>Close<\/span>/);
  assert.match(browserSource, /<span>Reopen<\/span>/);
  assert.doesNotMatch(browserSource, /[Aa]rchive/, "Archive is not this lifecycle's vocabulary");
  assert.doesNotMatch(css, /archive/i, "nor is it left in the styling");
});

test("permanent deletion is a confirmed Closed-note action", function () {
  assert.match(browserSource, /type: "note_close", id: data\.id/);
  assert.match(browserSource, /type: "note_reopen", id: data\.id/);
  assert.match(browserSource, /note_delete_permanently/, "the dedicated delete message is sent");
  assert.match(browserSource, /Delete permanently/, "the delete affordance is present");
  assert.match(browserSource, /closeDeleteDialog\(true\)/, "confirmation can be cancelled safely");
  assert.doesNotMatch(browserSource, /confirm\(|alert\(|prompt\(/, "no native dialogs");
});

test("completing a floating card closes it rather than hiding it destructively", function () {
  assert.match(cardSource, /type: "note_close", id: noteId/);
  assert.doesNotMatch(canvasSource + cardSource + editorSource + sharedSource, /type: "note_delete"/);
});

// --- open versus closed ---------------------------------------------------

test("the canvas and the badges count open notes only", function () {
  assert.match(canvasSource, /function openCount\(\)/);
  assert.match(canvasSource, /if \(entry && !isClosedNote\(entry\.data\)\) count\+\+/);
  // Both badges read the open count, never the total record set.
  var badges = canvasSource.match(/var count = openCount\(\);/g) || [];
  assert.equal(badges.length, 2, "the toolbar badge and the sidebar badge both count open items");
  assert.doesNotMatch(canvasSource, /badge\.textContent = notes\.size/, "no badge shows all history");
  // A board of nothing but closed notes must not pop the canvas open.
  assert.match(canvasSource, /if \(openCount\(\) > 0 && !notesVisible\)/);
});

test("closed notes leave the canvas and legacy hidden notes still count as closed", function () {
  assert.match(cardSource, /if \(isClosedNote\(data\)\) el\.classList\.add\("hidden"\)/);
  assert.match(canvasSource, /if \(isClosedNote\(next\)\) el\.classList\.add\("hidden"\)/);
  assert.match(sharedSource, /return data\.hidden === true;/, "the legacy flag is still honoured");
});

// The open/closed split is pure, so it can be executed directly.
test("the browser's open and closed partition is exact and legacy-aware", function () {
  var start = browserSource.indexOf("function isClosed(data)");
  var end = browserSource.indexOf("function currentTab()");
  var context = { exports: {} };
  vm.runInNewContext(
    browserSource.substring(start, end).replace(/export function/g, "function") +
    "\nexports.openNotes = openNotes; exports.closedNotes = closedNotes; exports.isClosed = isClosed;",
    context
  );
  var all = [
    { id: "a", state: "open" },
    { id: "b", state: "closed" },
    { id: "c" },
    { id: "d", hidden: true },
    { id: "e", state: "open", hidden: true },
  ];
  assert.deepEqual(context.exports.openNotes(all).map(function (n) { return n.id; }), ["a", "c", "e"],
    "an explicit state wins over the legacy flag");
  assert.deepEqual(context.exports.closedNotes(all).map(function (n) { return n.id; }), ["b", "d"]);
  assert.equal(context.exports.isClosed(null), false);
});

// --- mutual exclusion, escape, project switch -----------------------------

test("opening the browser claims the single right workbench slot", function () {
  assert.match(browserSource, /claimRightWorkbench\("notes-browser"\)/);
  assert.match(browserSource, /registerRightWorkbench\("notes-browser"/, "registered with the shared arbiter");
  assert.match(browserSource, /hideNotes\(\);/, "the floating canvas does not sit on top of the pane");
  assert.doesNotMatch(browserSource, /from '\.\/project-logs\.js'/, "no cycle with Logs");
});

test("opening another right tool closes the browser", function () {
  var openLogs = logsSource.substring(logsSource.indexOf("export function openProjectLogs()"),
    logsSource.indexOf("export function closeProjectLogs()"));
  assert.match(openLogs, /claimRightWorkbench\("project-logs"\);/, "Logs claims the shared workbench slot");
  assert.doesNotMatch(openLogs, /hideNotes\(\)/,
    "opening Logs never hides the persistent floating-note canvas");
  assert.doesNotMatch(logsSource, /import \{ hideNotes \} from '\.\/sticky-notes\.js'/,
    "Logs has no authority over sticky-note canvas visibility");
  assert.match(appSource, /onFilesTabOpen:[\s\S]*reopenFileViewer\(\);/);
});

test("Escape closes the browser and a project switch resets it", function () {
  assert.match(browserSource, /if \(e\.key !== "Escape"\) return;[\s\S]*closeNotesBrowser\(\);/);
  assert.match(browserSource, /if \(state\.currentSlug === previous\.currentSlug\) return;/);
  var reset = browserSource.substring(browserSource.indexOf("if (state.currentSlug === previous.currentSlug) return;"));
  assert.match(reset, /closeNotesBrowser\(\);/, "a different project starts closed");
  assert.match(reset, /applyWindowState\(false, false\)/, "and bounded");
  assert.match(reset, /notesBrowserTab: "open"/, "and on the Open tab");
});

test("project reset clears pending deletion even when the browser is already closed", function () {
  var listeners = [];
  var state = { notesBrowserOpen: false, notesDeletePending: { noteId: "n1", requestId: "r1" }, currentSlug: "old", connected: true, myUserId: "u1", isMultiUserMode: true };
  var context = {
    exports: {},
    store: {
      get: function (key) { return state[key]; },
      set: function (partial) { state = Object.assign({}, state, partial); },
      subscribe: function (listener) { listeners.push(listener); },
    },
    document: { addEventListener: function () {}, getElementById: function () { return null; } },
    releaseRightWorkbench: function () {},
    registerRightWorkbench: function () {},
    claimRightWorkbench: function () {},
    hideNotes: function () {},
    showNotes: function () {},
    refreshIcons: function () {},
    iconHtml: function () { return ""; },
  };
  var source = browserSource.substring(browserSource.indexOf("var panel = null;"));
  source = source.replace(/export function/g, "function");
  source += "\nexports.initNotesBrowser = initNotesBrowser; exports.closeNotesBrowser = closeNotesBrowser;";
  vm.runInNewContext(source, context);
  context.exports.initNotesBrowser();
  assert.equal(listeners.length, 1);
  var previous = Object.assign({}, state);
  state = Object.assign({}, state, { currentSlug: "new" });
  listeners[0](state, previous);
  assert.equal(state.notesDeletePending, null, "project change clears pending state even with a closed browser");

  state = Object.assign({}, state, { notesDeletePending: { noteId: "n1", requestId: "r2" }, connected: false });
  previous = Object.assign({}, state, { connected: true });
  listeners[0](state, previous);
  assert.equal(state.notesDeletePending, null, "disconnect clears pending state");
});

test("closing always drops fullscreen so the next open is bounded", function () {
  var close = browserSource.substring(browserSource.indexOf("export function closeNotesBrowser()"));
  assert.match(close.substring(0, 650), /applyWindowState\(store\.get\('notesBrowserWide'\), false\)/);
  var open = browserSource.substring(browserSource.indexOf("export function openNotesBrowser()"));
  assert.match(open.substring(0, 500), /applyWindowState\(store\.get\('notesBrowserWide'\), false\)/,
    "the default is the right pane, never fullscreen");
});

// --- accessibility and conventions ---------------------------------------

test("the pane is accessible and keyboard operable", function () {
  assert.match(browserSource, /setAttribute\("aria-label", "Sticky Notes"\)/);
  assert.match(browserSource, /role="tablist"/);
  assert.match(browserSource, /setAttribute\("role", "tab"\)/);
  assert.match(browserSource, /setAttribute\("aria-selected"/);
  assert.match(browserSource, /tab\.tabIndex = spec\.key === active \? 0 : -1/, "roving tabindex");
  assert.match(browserSource, /e\.key !== "ArrowLeft" && e\.key !== "ArrowRight"/, "arrow-key tab switching");
  assert.match(browserSource, /aria-pressed/, "the window toggles report their state");
  assert.match(browserSource, /if \(e\.key !== "Enter" && e\.key !== " "\) return;/, "cards are keyboard activable");
  assert.match(css, /\.notes-browser-tab:focus-visible \{ outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.notes-browser-card-action:focus-visible/);
});

test("the client module follows the project conventions", function () {
  assert.doesNotMatch(browserSource, /=>/, "no arrow functions");
  assert.doesNotMatch(browserSource, /^\s*(const|let) /m, "var only");
  assert.doesNotMatch(browserSource, /localStorage/, "no client-side settings storage");
  assert.match(browserSource, /import \{ store \} from '\.\/store\.js'/, "state lives in the store");
  // The browser shares the feature's single send path rather than opening its
  // own, so every note message is guarded identically.
  assert.match(browserSource, /import \{ send \} from '\.\/sticky-notes-shared\.js'/);
  assert.doesNotMatch(browserSource, /ws\.send\(/, "it does not talk to the socket directly");
  assert.ok(browserSource.split("\n").length < 500, "module stays under the size limit");
});

test("closed metadata is shown without becoming a task manager", function () {
  assert.match(browserSource, /function closedMeta\(data\)/);
  assert.match(browserSource, /parts\.push\("Closed " \+ when\.toLocaleDateString\(\)\)/);
  assert.match(browserSource, /parts\.push\("by " \+ by\.displayName\)/);
  assert.match(browserSource, /parts\.push\("by an agent session"\)/);
  // Only closed cards carry metadata; open cards stay clean. Deletion controls
  // are also scoped to the same closed branch.
  assert.match(browserSource, /if \(closed\) \{[\s\S]*?var meta = document\.createElement\("p"\);/);
  assert.match(browserSource, /if \(closed\) \{[\s\S]*?var deleteAction = document\.createElement\("button"\);/);
  assert.doesNotMatch(browserSource, /assignee|due date|priority|estimate/i, "no task-manager fields");
});

test("rendered sticky-note surfaces turn Project Log references into durable chips", function () {
  assert.match(cardSource, /enhanceClayLogLinks\(rendered\)/,
    "new floating notes enhance their rendered markdown");
  assert.match(canvasSource, /enhanceClayLogLinks\(rendered\)/,
    "server-updated floating notes enhance their rendered markdown");
  assert.match(editorSource, /rendered\.innerHTML = renderMiniMarkdown\(md\);\s*enhanceClayLogLinks\(rendered\);/,
    "returning from raw Markdown and normalizing an edit both restore chips");
  assert.match(browserSource, /enhanceClayLogLinks\(body\)/,
    "the Sticky Notes browser enhances log references too");
});

// --- module structure ---------------------------------------------------

test("every sticky-note client module is under the size limit", function () {
  for (var i = 0; i < STICKY_MODULES.length; i++) {
    var text = source("lib/public/modules/" + STICKY_MODULES[i]);
    var lines = text.split("\n").length;
    assert.ok(lines < 500, STICKY_MODULES[i] + " is " + lines + " lines, over the 500 line limit");
  }
});

test("the sticky-note modules form a layered graph with no cycle", function () {
  // Declared layering: shared depends on nothing local, editor on shared, card
  // on shared and editor, canvas on all three, browser on canvas and shared.
  var allowed = {
    "sticky-notes-shared.js": [],
    "sticky-notes-editor.js": ["sticky-notes-shared.js"],
    "sticky-notes-card.js": ["sticky-notes-shared.js", "sticky-notes-editor.js"],
    "sticky-notes.js": ["sticky-notes-shared.js", "sticky-notes-editor.js", "sticky-notes-card.js"],
    "sticky-notes-browser.js": ["sticky-notes.js", "sticky-notes-shared.js"],
  };
  var graph = {};
  for (var i = 0; i < STICKY_MODULES.length; i++) {
    var name = STICKY_MODULES[i];
    var text = source("lib/public/modules/" + name);
    var deps = [];
    var re = /from '\.\/(sticky-notes[^']*)\.js'/g;
    var m;
    while ((m = re.exec(text))) deps.push(m[1] + ".js");
    graph[name] = deps;
    for (var d = 0; d < deps.length; d++) {
      assert.ok(allowed[name].indexOf(deps[d]) !== -1,
        name + " may not import " + deps[d] + "; that inverts the declared layering");
    }
  }
  // Walk the graph for real rather than trusting the table above.
  function reaches(from, target, seen) {
    var deps = graph[from] || [];
    for (var i = 0; i < deps.length; i++) {
      if (deps[i] === target) return true;
      if (seen.indexOf(deps[i]) !== -1) continue;
      seen.push(deps[i]);
      if (reaches(deps[i], target, seen)) return true;
    }
    return false;
  }
  for (var k = 0; k < STICKY_MODULES.length; k++) {
    assert.equal(reaches(STICKY_MODULES[k], STICKY_MODULES[k], []), false,
      STICKY_MODULES[k] + " is part of an import cycle");
  }
});

test("no sticky-note module uses the retired init-context pattern", function () {
  for (var i = 0; i < STICKY_MODULES.length; i++) {
    var name = STICKY_MODULES[i];
    var text = source("lib/public/modules/" + name);
    assert.doesNotMatch(text, /^var ctx;/m, name + " keeps a module-level ctx");
    assert.doesNotMatch(text, /function init[A-Za-z]*\(_ctx\)/, name + " takes an injected context");
    assert.doesNotMatch(text, /ctx\.ws|ctx\.connected/, name + " reads the socket from a context");
  }
  // The canvas is initialised with no arguments at all now.
  assert.match(appSource, /initStickyNotes\(\);/);
  assert.doesNotMatch(appSource, /initStickyNotes\(\{/);
});

test("the socket and connection flag come from ws-ref and the store", function () {
  assert.match(sharedSource, /import \{ getWs \} from '\.\/ws-ref\.js'/);
  assert.match(sharedSource, /import \{ store \} from '\.\/store\.js'/);
  assert.match(sharedSource, /var ws = getWs\(\);\n\s*if \(!ws \|\| !store\.get\('connected'\)\) return;/,
    "the same guard the injected context used to express");
  // Exactly one place builds a note message, so there is one send path.
  var senders = 0;
  for (var i = 0; i < STICKY_MODULES.length; i++) {
    if (/ws\.send\(JSON\.stringify/.test(source("lib/public/modules/" + STICKY_MODULES[i]))) senders++;
  }
  assert.equal(senders, 1, "only sticky-notes-shared.js talks to the socket");
});

test("shared stays a dependency-neutral leaf", function () {
  assert.doesNotMatch(sharedSource, /from '\.\/sticky-notes/, "shared imports no sibling sticky-note module");
  // The debounce timers live in exactly one place so two modules cannot race.
  assert.match(sharedSource, /var updateTimers = \{\};/);
  assert.match(sharedSource, /var textTimers = \{\};/);
  for (var i = 0; i < STICKY_MODULES.length; i++) {
    var name = STICKY_MODULES[i];
    if (name === "sticky-notes-shared.js") continue;
    assert.doesNotMatch(source("lib/public/modules/" + name), /var (update|text)Timers/,
      name + " keeps its own timer map");
  }
});

test("the editor owns its toolbar element and the card owns its picker", function () {
  assert.match(editorSource, /var formatToolbarEl = null;/);
  assert.doesNotMatch(canvasSource, /formatToolbarEl/, "the canvas asks, it does not reach in");
  assert.match(canvasSource, /isFormatToolbarOpen\(\)/);
  assert.match(cardSource, /var colorPickerEl = null;/);
  assert.doesNotMatch(canvasSource, /colorPickerEl/);
});

test("every sticky-note module follows the client conventions", function () {
  for (var i = 0; i < STICKY_MODULES.length; i++) {
    var name = STICKY_MODULES[i];
    var text = source("lib/public/modules/" + name);
    assert.doesNotMatch(text, /=>/, name + " uses an arrow function");
    assert.doesNotMatch(text, /^\s*(const|let) /m, name + " uses const or let");
    assert.doesNotMatch(text, /localStorage/, name + " touches localStorage");
  }
});
