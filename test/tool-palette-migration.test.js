var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette.js"), "utf8");
var orderSource = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette-order.js"), "utf8");
var appSource = fs.readFileSync(path.join(root, "lib/public/app.js"), "utf8");
var schedulerSource = fs.readFileSync(path.join(root, "lib/public/modules/scheduler.js"), "utf8");
var scheduledTasksSource = fs.readFileSync(path.join(root, "lib/public/modules/scheduled-tasks.js"), "utf8");

// The registry and the preference rules live in tool-palette-order.js, which
// is pure by construction, so they are exercised directly rather than asserted
// against their source text. The suite is CommonJS and the module is ESM, so
// the source is evaluated with its export keywords stripped.
function loadNormalizer() {
  var body = orderSource
    .replace(/^export function/gm, "function")
    .replace(/^export var/gm, "var");
  var factory = new Function(body + "\nreturn {" +
    " normalizeToolPreferences: normalizeToolPreferences," +
    " PALETTES: PALETTES," +
    " LEGACY_SESSION_TOOL_IDS: LEGACY_SESSION_TOOL_IDS," +
    " RETIRED_SESSION_TOOL_IDS: RETIRED_SESSION_TOOL_IDS };");
  return factory();
}

var api = loadNormalizer();
var normalize = api.normalizeToolPreferences;

// Evaluate the real palette module against a tiny fake DOM so ordering and the
// save path are exercised, not just matched in source text.
function loadPalette(prefs) {
  var elements = {};
  function makeEl(tag) {
    var el = { tagName: tag, children: [], parentNode: null, dataset: {}, listeners: {}, style: {}, attrs: {}, id: "", className: "",
      classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} } };
    el.appendChild = function (child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      el.children.push(child);
      child.parentNode = el;
      if (child.id) elements[child.id] = child;
      return child;
    };
    el.removeChild = function (child) { el.children.splice(el.children.indexOf(child), 1); child.parentNode = null; return child; };
    el.insertBefore = function (child, ref) {
      if (child.parentNode) child.parentNode.removeChild(child);
      el.children.splice(el.children.indexOf(ref), 0, child);
      child.parentNode = el;
    };
    el.addEventListener = function (type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); };
    el.setAttribute = function (k, v) { el.attrs[k] = v; };
    el.querySelectorAll = function () { return el.children.filter(function (c) { return c.dataset.toolId; }); };
    Object.defineProperty(el, "nextSibling", { get: function () {
      var i = el.parentNode ? el.parentNode.children.indexOf(el) : -1;
      return i >= 0 ? el.parentNode.children[i + 1] || null : null;
    } });
    return el;
  }
  var session = makeEl("div"); session.id = "session-actions"; elements["session-actions"] = session;
  var mate = makeEl("div"); mate.id = "mate-sidebar-tools"; elements["mate-sidebar-tools"] = mate;
  var pending = [];
  var puts = [];
  var fakeDocument = {
    getElementById: function (id) { return elements[id] || null; },
    createElement: makeEl,
  };
  var fakeFetch = function (url, init) {
    if (init && init.method === "PUT") { puts.push(JSON.parse(init.body)); return Promise.resolve({}); }
    return Promise.resolve({ ok: !!prefs, json: function () { return Promise.resolve({ session: prefs }); } });
  };
  var body = source.replace(/^import .*$/gm, "").replace(/^export function/gm, "function");
  var factory = new Function("document", "fetch", "setTimeout", "clearTimeout", "PALETTES", "normalizeToolPreferences", "refreshIcons",
    body + "\nreturn initToolPalettes;");
  var init = factory(fakeDocument, fakeFetch, function (fn) { pending.push(fn); return pending.length; }, function () {},
    api.PALETTES, api.normalizeToolPreferences, function () {});
  var harness = {
    puts: puts,
    flushTimers: function () { pending.splice(0).forEach(function (fn) { fn(); }); },
    byId: function (id) { return elements[id]; },
    ids: function (id) { return elements[id].children.map(function (c) { return c.dataset.toolId; }); },
    fire: function (el, type, evt) { (el.listeners[type] || []).forEach(function (fn) { fn(evt); }); },
    run: function () { init(); return new Promise(function (resolve) { setImmediate(resolve); }); },
  };
  return harness;
}

// The registry order, which is the default arrangement for a user with no
// saved preference. The grid is four columns wide, so the 7th entry is row 2,
// column 3.
var DEFAULT_ORDER = [
  "file-browser-btn",
  "terminal-sidebar-btn",
  "sticky-notes-sidebar-btn",
  "project-logs-btn",
  "mcp-btn",
  "scheduler-btn",
  "issues-btn",
  "shared-browser-btn",
];

// --- Default placement ----------------------------------------------------

test("Scheduled Tasks is the 6th registry entry after standalone Loop retirement", function () {
  var registry = orderSource.slice(orderSource.indexOf("var SESSION_TOOLS"), orderSource.indexOf("var MATE_TOOLS"));
  assert.match(registry, /id: "scheduler-btn",\s+icon: "calendar-clock", label: "Scheduled"/);

  var ids = api.PALETTES.session.tools.map(function (tool) { return tool.id; });
  assert.deepEqual(ids, DEFAULT_ORDER, "the default arrangement is the registry order");
  assert.equal(ids.length, 8);
  assert.equal(ids[6], "issues-btn");
  assert.equal(ids.indexOf("scheduler-btn"), 5, "the 6th slot, zero-indexed");

  var css = fs.readFileSync(path.join(root, "lib/public/css/filebrowser.css"), "utf8");
  assert.match(css, /#session-actions \{[^}]*grid-template-columns: repeat\(4, 1fr\)/s,
    "the 7th tile is row 2 column 3 while the grid is four columns wide");

  // A fresh palette is built straight from the registry, in order.
  var build = source.slice(source.indexOf("function buildPalette(name)"));
  build = build.slice(0, build.indexOf("function buildToolButton"));
  assert.match(build, /for \(var i = 0; i < palette\.tools\.length; i\+\+\) \{\s*\n\s*active\.appendChild\(buildToolButton\(palette\.tools\[i\], name\)\);\s*\n\s*\}/,
    "registry order is the default order, with nothing reordering it afterwards");
});

test("retiring standalone Loop preserves Scheduled Tasks and keeps Git retired", function () {
  assert.equal(/git-sidebar-btn/.test(JSON.stringify(api.PALETTES)), false, "Git still has no tile");
  assert.deepEqual(api.RETIRED_SESSION_TOOL_IDS, ["git-sidebar-btn", "loop-tool-btn"],
    "Git and the replaced standalone Loop entry stay retired");
  assert.equal(DEFAULT_ORDER.indexOf("git-sidebar-btn"), -1);
  assert.deepEqual(api.PALETTES.session.tools.map(function (t) { return t.id; }), DEFAULT_ORDER,
    "the remaining tools retain registry order");
});

// --- No mandated position -------------------------------------------------

test("Scheduled Tasks is an ordinary tool with no special-casing anywhere", function () {
  var all = source + orderSource;
  assert.equal(/PINNED|pinned|isPinnedTool|applyPinnedPositions|enforcePinnedPositions/.test(all), false,
    "no mandated-slot machinery survives");
  assert.equal(/scheduler-btn/.test(source), false,
    "the DOM module never names the tool at all");

  // The only code that names it is the registry entry; the rest is the
  // comment recording why the old remap was retired.
  var codeLines = orderSource.split("\n").filter(function (line) {
    return line.indexOf("scheduler-btn") !== -1 && !/^\s*\/\//.test(line);
  });
  assert.equal(codeLines.length, 1, "one line of code names the tool: its registry entry");
  assert.match(codeLines[0], /icon: "calendar-clock", label: "Scheduled"/);
});

test("every tool is built draggable with no hide or edit affordance", function () {
  var build = source.slice(source.indexOf("function buildToolButton(tool, paletteName)"));
  build = build.slice(0, build.indexOf("\nfunction getDragAfterElement"));

  assert.match(build, /btn\.draggable = true;/);
  assert.equal(/if \(!?pinned\)|dataset\.pinned/.test(build), false, "no per-tool exception");
  assert.equal(/tool-palette-remove|contextmenu|stopImmediatePropagation|moveToHidden|moveToActive/.test(build), false,
    "no remove badge, context menu or click interception on tiles");
  assert.match(build, /if \(!container \|\| container\.id !== PALETTES\[paletteName\]\.activeContainerId\) \{/);
  assert.match(build, /if \(_draggingPaletteName\) queueSave\(_draggingPaletteName\);/,
    "a drop saves the order the user produced, unaltered");
});

test("the edit, hide, add-back and Cmd/Ctrl+O entry points are gone from markup, script and styles", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/sidebar.css"), "utf8");
  assert.equal(/tool-palette-edit-btn|sidebar-tools-hint|sidebar-tools-header|tool-palette-hidden|session-actions-hidden|sidebar-tools-hidden/.test(html), false,
    "no pencil, hotkey hint, empty header row or hidden sections in the markup");
  assert.match(html, /<div id="session-actions" role="group" aria-label="Tools"><\/div>/, "the label stays accessible");
  assert.match(html, /<div id="mate-sidebar-tools" role="group" aria-label="Tools"><\/div>/);
  assert.equal(/toggleEditMode|moveToHidden|moveToActive|edit-mode|tool-palette-edit-btn|ToolPick|openPaletteContextMenu/.test(source), false);
  assert.equal(/edit-mode|tool-palette-remove|tool-palette-hidden|tool-palette-hotkey|tool-palette-ctx|sidebar-tools-hint|tool-palette-edit-btn/.test(css), false);
  assert.equal(fs.existsSync(path.join(root, "lib/public/modules/tool-palette-overlays.js")), false,
    "the overlay module that owned the Cmd/Ctrl+O keydown listener is deleted");
});

// --- Stored preferences are honored --------------------------------------

test("a stored order is honored exactly, wherever the user put Scheduled Tasks", function () {
  var front = { order: ["scheduler-btn", "file-browser-btn", "issues-btn"], hidden: [] };
  var result = normalize("session", front);
  assert.equal(result.migrated, false, "nothing to rewrite, so nothing is written back");
  assert.deepEqual(result.order, ["scheduler-btn", "file-browser-btn", "issues-btn"],
    "the user's chosen position is preserved, not corrected to the default slot");

  var middle = normalize("session", { order: ["file-browser-btn", "scheduler-btn", "issues-btn"], hidden: [] });
  assert.deepEqual(middle.order, ["file-browser-btn", "scheduler-btn", "issues-btn"]);
});

test("a stored hidden choice is honored, including for Scheduled Tasks", function () {
  var result = normalize("session", {
    order: ["file-browser-btn", "issues-btn"],
    hidden: ["scheduler-btn", "mcp-btn"],
  });
  assert.equal(result.migrated, false);
  assert.deepEqual(result.hidden, ["scheduler-btn", "mcp-btn"],
    "a user who removed the tool keeps it removed");
  assert.deepEqual(result.order, ["file-browser-btn", "issues-btn"]);
});

test("a saved palette drops retired Loop while Scheduled Tasks uses normal append", async function () {
  // No rewrite and no server state: applyPreferences places the stored order,
  // then appends any registry tool the stored list doesn't mention.
  var postLogs = {
    order: ["file-browser-btn", "terminal-sidebar-btn", "sticky-notes-sidebar-btn",
      "project-logs-btn", "loop-tool-btn", "mcp-btn", "issues-btn"],
    hidden: [],
  };
  var result = normalize("session", postLogs);
  assert.equal(result.migrated, true, "the retired Loop entry is removed from stored preferences");
  assert.deepEqual(result.order, postLogs.order.filter(function (id) { return id !== "loop-tool-btn"; }));

  var h = loadPalette(postLogs);
  await h.run();
  var shown = h.ids("session-actions");
  assert.deepEqual(shown.slice(0, 6), result.order.slice(0, 6), "the stored order is placed first");
  assert.equal(shown[shown.length - 1], "shared-browser-btn", "an unmentioned registry tool is appended after the stored order");
  assert.equal(shown.length, 8);

  // Appending after the remaining stored tools lands it in the current default
  // position. A user who later moves it keeps that choice.
  assert.equal(postLogs.order.length, 7);
  assert.equal(DEFAULT_ORDER.indexOf("scheduler-btn"), 5);
});

test("formerly hidden tools stay reachable: shown after the ordered tools, with no write-back", async function () {
  var h = loadPalette({ order: ["issues-btn", "file-browser-btn"], hidden: ["scheduler-btn", "mcp-btn"] });
  await h.run();
  var ids = h.ids("session-actions");
  assert.deepEqual(ids.slice(0, 2), ["issues-btn", "file-browser-btn"], "saved order first");
  assert.deepEqual(ids.slice(2), ["terminal-sidebar-btn", "sticky-notes-sidebar-btn", "project-logs-btn", "shared-browser-btn", "scheduler-btn", "mcp-btn"],
    "unmentioned tools next, formerly hidden tools last");
  assert.equal(ids.length, 8, "every registered tool is present exactly once");
  h.flushTimers();
  assert.equal(h.puts.length, 0, "loading never rewrites the server preference");
});

test("a retired or legacy preference is not written back on load either", async function () {
  var h = loadPalette({ order: ["skills-btn", "git-sidebar-btn", "file-browser-btn"], hidden: [] });
  await h.run();
  h.flushTimers();
  assert.deepEqual(h.ids("session-actions").slice(0, 2), ["mcp-btn", "file-browser-btn"], "legacy id keeps its slot");
  assert.equal(h.puts.length, 0, "the stored preference is left untouched");
});

test("a drag reorder saves the visible order with nothing hidden", async function () {
  var h = loadPalette({ order: [], hidden: ["mcp-btn"] });
  await h.run();
  var el = h.byId("issues-btn");
  var container = h.byId("session-actions");
  container.insertBefore(el, container.children[0]);
  h.fire(el, "dragstart", { dataTransfer: { setData: function () {} }, preventDefault: function () {} });
  h.fire(el, "dragend", {});
  h.flushTimers();
  assert.equal(h.puts.length, 1);
  assert.equal(h.puts[0].palette, "session");
  assert.equal(h.puts[0].order[0], "issues-btn");
  assert.equal(h.puts[0].order.length, 8);
  assert.deepEqual(h.puts[0].hidden, []);
});

test("a tile click is never intercepted, so the tool's own handler runs", async function () {
  var h = loadPalette(null);
  await h.run();
  var tile = h.byId("terminal-sidebar-btn");
  var calls = 0;
  tile.addEventListener("click", function () { calls++; });
  h.fire(tile, "click", {
    target: { closest: function () { return null; } },
    preventDefault: function () { throw new Error("click was prevented"); },
    stopImmediatePropagation: function () { throw new Error("click was intercepted"); },
  });
  assert.equal(calls, 1);
  assert.equal(tile.listeners.click.length, 1, "the palette binds no click listener of its own");
});

// --- Preference rules ----------------------------------------------------

test("the scheduler remap is retired now that Scheduled Tasks is a live tool", function () {
  assert.equal(api.LEGACY_SESSION_TOOL_IDS["scheduler-btn"], undefined,
    "no active remap: rewriting scheduler-btn would destroy the user's own choice");
  assert.equal(/"scheduler-btn": "project-logs-btn"/.test(orderSource), false);


  var result = normalize("session", {
    order: ["file-browser-btn", "scheduler-btn", "issues-btn"],
    hidden: [],
  });
  assert.equal(result.order.indexOf("project-logs-btn"), -1,
    "a stored scheduler-btn is no longer turned into Logs");
});

test("a stored Git preference is still dropped from order and hidden alike", function () {
  var visible = normalize("session", {
    order: ["file-browser-btn", "git-sidebar-btn", "issues-btn"],
    hidden: [],
  });
  assert.equal(visible.migrated, true, "the drop is written back so it does not linger");
  assert.deepEqual(visible.order, ["file-browser-btn", "issues-btn"]);

  var hidden = normalize("session", {
    order: ["file-browser-btn"],
    hidden: ["git-sidebar-btn", "mcp-btn"],
  });
  assert.equal(hidden.migrated, true);
  assert.deepEqual(hidden.hidden, ["mcp-btn"]);
  assert.deepEqual(hidden.order, ["file-browser-btn"]);
});

test("preferences that need no rewrite are left completely alone", function () {
  var current = { order: DEFAULT_ORDER.slice(), hidden: ["mcp-btn"] };
  var result = normalize("session", current);
  assert.equal(result.migrated, false, "no migration means no write-back");
  assert.deepEqual(result.order, current.order);
  assert.deepEqual(result.hidden, current.hidden);

  var empty = normalize("session", { order: [], hidden: [] });
  assert.equal(empty.migrated, false);
  assert.deepEqual(empty.order, []);
});

test("the mate palette is untouched by every session-only rule", function () {
  var result = normalize("mate", { order: ["mate-memory-btn", "scheduler-btn", "git-sidebar-btn"], hidden: [] });
  assert.equal(result.migrated, false);
  assert.deepEqual(result.order, ["mate-memory-btn", "scheduler-btn", "git-sidebar-btn"],
    "a mate preference is never rewritten by a session-only rule");
  assert.equal(/scheduler-btn/.test(JSON.stringify(api.PALETTES.mate.tools)), false,
    "and the mate palette does not carry the tool");
});

test("missing or malformed preference shapes fail safe", function () {
  var nothing = normalize("session", null);
  assert.equal(nothing.migrated, false);
  assert.deepEqual(nothing.order, []);
  assert.deepEqual(nothing.hidden, []);

  var partial = normalize("session", { order: ["git-sidebar-btn"] });
  assert.equal(partial.migrated, true);
  assert.deepEqual(partial.order, []);
  assert.deepEqual(partial.hidden, []);

  assert.doesNotThrow(function () { normalize("session", {}); });
  assert.doesNotThrow(function () { normalize("session", undefined); });
});

// --- Surface, permissions, platform --------------------------------------

test("the restored tile opens the project Scheduled Tasks workbench", function () {
  assert.match(scheduledTasksSource, /var button = document\.getElementById\("scheduler-btn"\);/);
  assert.match(scheduledTasksSource, /else openScheduledTasks\(\)/,
    "opening does not require an external skill");
  assert.match(scheduledTasksSource, /button\.classList\.add\("active"\)/);
  assert.match(scheduledTasksSource, /button\.classList\.remove\("active"\)/);

  assert.ok(appSource.indexOf("initToolPalettes();") < appSource.indexOf("initScheduledTasks();"),
    "the tile exists by the time the workbench wires it");
  assert.match(schedulerSource, /export function openHomeScheduler/, "legacy calendar code remains available");
});

test("the scheduledTasks permission hides the project tile", function () {
  var block = appSource.slice(appSource.indexOf("if (!_perms.scheduledTasks) {"));
  block = block.slice(0, block.indexOf("if (!_perms.createProject) {"));
  assert.doesNotMatch(block, /home-scheduler-btn/);
  assert.match(block, /getElementById\("scheduler-btn"\)/,
    "a user without the permission does not get the toolbar tile either");
});

test("tiles keep their accessible names and no Cmd/Ctrl+O handler remains", function () {
  assert.match(source, /btn\.setAttribute\('aria-label', tool\.label\);/, "the tile is announced by its label");
  assert.match(source, /btn\.title = tool\.label;/);
  var files = ["lib/public/app.js", "lib/public/modules/tool-palette.js", "lib/public/modules/project-switcher.js",
    "lib/public/modules/sidebar.js", "lib/public/modules/app-keyboard.js"];
  files.forEach(function (file) {
    var full = path.join(root, file);
    if (!fs.existsSync(full)) return;
    var code = fs.readFileSync(full, "utf8");
    assert.equal(/key\.toLowerCase\(\) === ['"]o['"]|hotkey-badge|data-hotkey/.test(code), false, file + " does not intercept Cmd/Ctrl+O");
  });
});

test("mobile behavior is unchanged: the tool strip is hidden there as before", function () {
  var inputCss = fs.readFileSync(path.join(root, "lib/public/css/input.css"), "utf8");
  var mobileHide = inputCss.slice(inputCss.indexOf("/* Hide sidebar tools & title bar status icons"));
  mobileHide = mobileHide.slice(0, mobileHide.indexOf("}") + 1);
  assert.match(mobileHide, /#sidebar-tools,/,
    "the restored tile lives in #sidebar-tools, already hidden under the mobile breakpoint");
  assert.equal(/scheduler-btn/.test(inputCss), false, "no bespoke mobile exception is needed");
});

// --- Module split --------------------------------------------------------

test("the save path and storage rules are unchanged", function () {
  assert.match(source, /fetch\('\/api\/user\/tool-palettes', \{\s*\n\s*method: 'PUT'/,
    "the existing server preference endpoint is reused");
  var all = source + orderSource;
  assert.equal(/localStorage|sessionStorage/.test(all), false, "no client-side settings storage");
  assert.equal(/alert\(|confirm\(|prompt\(/.test(all), false, "no native dialogs");
  assert.equal(/=>/.test(all), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(all), false, "var only");
  assert.match(orderSource, /export function normalizeToolPreferences/, "ESM export");
});

test("every palette module is under the size limit", function () {
  var files = [
    ["tool-palette.js", source],
    ["tool-palette-order.js", orderSource],
  ];
  for (var i = 0; i < files.length; i++) {
    assert.ok(files[i][1].split("\n").length < 500, files[i][0] + " is under 500 lines");
  }
});

test("the split keeps an acyclic graph", function () {
  assert.equal(/var SESSION_TOOLS|function normalizeToolPreferences/.test(source), false,
    "the palette module no longer defines the registry or the preference rules");
  assert.match(source, /import \{ PALETTES, normalizeToolPreferences \} from '\.\/tool-palette-order\.js';/);
  assert.equal(/^import /m.test(orderSource), false, "the ordering module imports nothing");
  assert.equal(/from '\.\/tool-palette\.js'/.test(orderSource), false, "no cycle back into the palette module");
});

test("MCP / Skills merges legacy entries without overriding an explicit MCP choice", function () {
  assert.deepEqual(normalize("session", { order: ["skills-btn", "file-browser-btn"], hidden: [] }), { order: ["mcp-btn", "file-browser-btn"], hidden: [], migrated: true });
  assert.deepEqual(normalize("session", { order: ["skills-btn"], hidden: ["mcp-btn"] }), { order: [], hidden: ["mcp-btn"], migrated: true });
  assert.deepEqual(normalize("mate", { order: ["mate-skills-btn"], hidden: [] }), { order: ["mate-mcp-btn"], hidden: [], migrated: true });
});
