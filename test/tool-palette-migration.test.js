var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var source = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette.js"), "utf8");
var orderSource = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette-order.js"), "utf8");
var overlaysSource = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette-overlays.js"), "utf8");
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

// The registry order, which is the default arrangement for a user with no
// saved preference. The grid is four columns wide, so the 7th entry is row 2,
// column 3.
var DEFAULT_ORDER = [
  "file-browser-btn",
  "terminal-sidebar-btn",
  "sticky-notes-sidebar-btn",
  "project-logs-btn",
  "mcp-btn",
  "skills-btn",
  "scheduler-btn",
];

// --- Default placement ----------------------------------------------------

test("Scheduled Tasks is the 7th registry entry after standalone Loop retirement", function () {
  var registry = orderSource.slice(orderSource.indexOf("var SESSION_TOOLS"), orderSource.indexOf("var MATE_TOOLS"));
  assert.match(registry, /id: "scheduler-btn",\s+icon: "calendar-clock", label: "Scheduled Tasks"/);

  var ids = api.PALETTES.session.tools.map(function (tool) { return tool.id; });
  assert.deepEqual(ids, DEFAULT_ORDER, "the default arrangement is the registry order");
  assert.equal(ids.length, 7);
  assert.equal(ids.indexOf("scheduler-btn"), 6, "the 7th slot, zero-indexed");

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
  var all = source + orderSource + overlaysSource;
  assert.equal(/PINNED|pinned|isPinnedTool|applyPinnedPositions|enforcePinnedPositions/.test(all), false,
    "no mandated-slot machinery survives");
  assert.equal(/scheduler-btn/.test(source + overlaysSource), false,
    "the DOM and overlay modules never name the tool at all");

  // The only code that names it is the registry entry; the rest is the
  // comment recording why the old remap was retired.
  var codeLines = orderSource.split("\n").filter(function (line) {
    return line.indexOf("scheduler-btn") !== -1 && !/^\s*\/\//.test(line);
  });
  assert.equal(codeLines.length, 1, "one line of code names the tool: its registry entry");
  assert.match(codeLines[0], /icon: "calendar-clock", label: "Scheduled Tasks"/);
});

test("every tool is built with the same customization affordances", function () {
  var build = source.slice(source.indexOf("function buildToolButton(tool, paletteName)"));
  build = build.slice(0, build.indexOf("function toggleEditMode"));

  // Draggable, removable, and context-menued unconditionally.
  assert.match(build, /btn\.draggable = true;/);
  assert.equal(/if \(!?pinned\)|dataset\.pinned/.test(build), false, "no per-tool exception");
  assert.match(build, /remove\.className = 'tool-palette-remove';/);
  assert.match(build, /remove\.setAttribute\('aria-label', 'Remove ' \+ tool\.label \+ ' from palette'\);/);
  assert.match(build, /\{ label: 'Remove from palette', action: function \(\) \{ moveToHidden\(paletteName, tool\.id\); \} \},/);
  assert.match(build, /\{ label: 'Add back to palette', action: function \(\) \{ moveToActive\(paletteName, tool\.id\); \} \},/);

  // Drag is gated only by which grid the tile is in, as before.
  assert.match(build, /if \(!container \|\| container\.id !== PALETTES\[paletteName\]\.activeContainerId\) \{/);
  assert.match(build, /if \(_draggingPaletteName\) queueSave\(_draggingPaletteName\);/,
    "a drop saves the order the user produced, unaltered");
});

test("hiding and restoring any tool goes through the one unguarded path", function () {
  var hide = source.slice(source.indexOf("function moveToHidden(name, toolId)"));
  hide = hide.slice(0, hide.indexOf("function moveToActive"));
  assert.equal(/isPinnedTool|pinned/.test(hide), false, "no tool is exempt from being hidden");
  assert.match(hide, /grid\.appendChild\(btn\);/);
  assert.match(hide, /queueSave\(name\);/);
});

// --- Stored preferences are honored --------------------------------------

test("a stored order is honored exactly, wherever the user put Scheduled Tasks", function () {
  var front = { order: ["scheduler-btn", "file-browser-btn", "skills-btn"], hidden: [] };
  var result = normalize("session", front);
  assert.equal(result.migrated, false, "nothing to rewrite, so nothing is written back");
  assert.deepEqual(result.order, ["scheduler-btn", "file-browser-btn", "skills-btn"],
    "the user's chosen position is preserved, not corrected to the default slot");

  var middle = normalize("session", { order: ["file-browser-btn", "scheduler-btn", "skills-btn"], hidden: [] });
  assert.deepEqual(middle.order, ["file-browser-btn", "scheduler-btn", "skills-btn"]);
});

test("a stored hidden choice is honored, including for Scheduled Tasks", function () {
  var result = normalize("session", {
    order: ["file-browser-btn", "skills-btn"],
    hidden: ["scheduler-btn", "mcp-btn"],
  });
  assert.equal(result.migrated, false);
  assert.deepEqual(result.hidden, ["scheduler-btn", "mcp-btn"],
    "a user who removed the tool keeps it removed");
  assert.deepEqual(result.order, ["file-browser-btn", "skills-btn"]);
});

test("a saved palette drops retired Loop while Scheduled Tasks uses normal append", function () {
  // No rewrite and no server state: applyPreferences places the stored order,
  // then appends any registry tool the stored list doesn't mention.
  var postLogs = {
    order: ["file-browser-btn", "terminal-sidebar-btn", "sticky-notes-sidebar-btn",
      "project-logs-btn", "loop-tool-btn", "mcp-btn", "skills-btn"],
    hidden: [],
  };
  var result = normalize("session", postLogs);
  assert.equal(result.migrated, true, "the retired Loop entry is removed from stored preferences");
  assert.deepEqual(result.order, postLogs.order.filter(function (id) { return id !== "loop-tool-btn"; }));

  var apply = source.slice(source.indexOf("function applyPreferences(name, prefs)"));
  apply = apply.slice(0, apply.indexOf("\nfunction queueSave"));
  assert.match(apply, /for \(var k = 0; k < palette\.tools\.length; k\+\+\) \{[\s\S]*?if \(placed\[tid\] \|\| hiddenSet\[tid\]\) continue;[\s\S]*?if \(tbtn\) active\.appendChild\(tbtn\);/,
    "an unmentioned registry tool is appended after the stored order");
  assert.match(apply, /appended in registry order/,
    "which is the documented mechanism, not a bespoke one");

  // Appending after the remaining stored tools lands it in the current default
  // position. A user who later moves it keeps that choice.
  assert.equal(postLogs.order.length, 7);
  assert.equal(DEFAULT_ORDER.indexOf("scheduler-btn"), 6);
});

test("an unmentioned tool that the user hid is not resurrected by the append", function () {
  var result = normalize("session", {
    order: ["file-browser-btn"],
    hidden: ["scheduler-btn"],
  });
  assert.deepEqual(result.hidden, ["scheduler-btn"]);
  var apply = source.slice(source.indexOf("function applyPreferences(name, prefs)"));
  assert.match(apply, /if \(placed\[tid\] \|\| hiddenSet\[tid\]\) continue;/,
    "the append skips anything the user hid");
});

// --- Preference rules ----------------------------------------------------

test("the scheduler remap is retired now that Scheduled Tasks is a live tool", function () {
  assert.deepEqual(api.LEGACY_SESSION_TOOL_IDS, {},
    "no active remap: rewriting scheduler-btn would destroy the user's own choice");
  assert.equal(/"scheduler-btn": "project-logs-btn"/.test(orderSource), false);
  assert.match(orderSource, /that remap is retired because/,
    "the retirement is documented where the mechanism lives");

  var result = normalize("session", {
    order: ["file-browser-btn", "scheduler-btn", "skills-btn"],
    hidden: [],
  });
  assert.equal(result.order.indexOf("project-logs-btn"), -1,
    "a stored scheduler-btn is no longer turned into Logs");
});

test("a stored Git preference is still dropped from order and hidden alike", function () {
  var visible = normalize("session", {
    order: ["file-browser-btn", "git-sidebar-btn", "skills-btn"],
    hidden: [],
  });
  assert.equal(visible.migrated, true, "the drop is written back so it does not linger");
  assert.deepEqual(visible.order, ["file-browser-btn", "skills-btn"]);

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

test("keyboard access reaches the restored tile like any other", function () {
  // The Cmd/Ctrl+O overlay enumerates whatever is in the active grid, so a
  // restored tile is reachable without a bespoke rule.
  assert.match(overlaysSource, /var tiles = active\.querySelectorAll\('\[data-tool-id\]'\);/);
  assert.match(overlaysSource, /tiles\[i\]\.dataset\.hotkey = key;/);
  assert.match(source, /btn\.setAttribute\('aria-label', tool\.label\);/,
    "the tile is announced by its label");
  assert.match(source, /btn\.title = tool\.label;/);
  assert.match(source, /if \(isToolPickActive\(\)\) exitToolPickMode\(\);/,
    "the hint pill still toggles pick mode after the extraction");
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
  var all = source + orderSource + overlaysSource;
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
    ["tool-palette-overlays.js", overlaysSource],
  ];
  for (var i = 0; i < files.length; i++) {
    assert.ok(files[i][1].split("\n").length < 500, files[i][0] + " is under 500 lines");
  }
});

test("the split is a behavior-preserving extraction with an acyclic graph", function () {
  // Each moved piece has exactly one home.
  assert.equal(/var SESSION_TOOLS|function normalizeToolPreferences/.test(source), false,
    "the palette module no longer defines the registry or the preference rules");
  assert.match(source, /import \{ PALETTES, normalizeToolPreferences \} from '\.\/tool-palette-order\.js';/);
  assert.equal(/function openPaletteContextMenu|function enterToolPickMode/.test(source), false,
    "nor the overlays");
  assert.match(source, /import \{\s*\n\s*enterToolPickMode,/);

  // order.js is a leaf; overlays.js depends only on order.js; neither imports
  // the palette module back.
  assert.equal(/^import /m.test(orderSource), false, "the ordering module imports nothing");
  assert.match(overlaysSource, /^import \{ PALETTES \} from '\.\/tool-palette-order\.js';$/m);
  assert.equal(/from '\.\/tool-palette\.js'/.test(orderSource + overlaysSource), false,
    "no cycle back into the palette module");
});
