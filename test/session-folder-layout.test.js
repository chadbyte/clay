var test = require("node:test");
var assert = require("node:assert");
var path = require("path");
var url = require("url");
var fs = require("fs");

var root = path.join(__dirname, "..");
var layoutPromise = import(url.pathToFileURL(path.join(root, "lib/public/modules/session-folder-layout.js")).href);

function unit(key, title, activity, created, extra) {
  return Object.assign({ key: key, title: title, lastActivity: activity, createdAt: created || activity, item: { type: "session" } }, extra || {});
}

async function layout(units, patch, searching) {
  var m = await layoutPromise;
  var state = m.defaultFolderState();
  Object.assign(state, patch || {});
  return m.buildLayout(units, state, { searching: !!searching });
}

function keys(list) { return list.map(function (u) { return u.key; }); }

test("Favorites come first and keep their manual order whatever the sort is", async function () {
  var units = [unit("a", "A", 10), unit("b", "B", 20), unit("c", "C", 30), unit("d", "D", 40)];
  var state = { assignments: { a: "favorites", c: "favorites" }, orders: { favorites: ["c", "a"] }, view: { sort: "title", direction: "desc" } };
  var l = await layout(units, state);
  assert.deepStrictEqual(keys(l.favorites), ["c", "a"]);
  assert.deepStrictEqual(keys(l.sections[l.sections.length - 1].units), ["d", "b"], "ordinary sessions use Z to A title order");
  for (var sort of ["activity", "created", "title", "manual"]) {
    var again = await layout(units, Object.assign({}, state, { view: { sort: sort, direction: "asc" } }));
    assert.deepStrictEqual(keys(again.favorites), ["c", "a"]);
  }
});

test("folders keep their own order and members; unfiled is the fallback", async function () {
  var units = [unit("a", "A", 10), unit("b", "B", 20), unit("c", "C", 30)];
  var l = await layout(units, {
    folders: [{ id: "f_2", name: "Second" }, { id: "f_1", name: "First" }],
    assignments: { a: "f_1", b: "f_2", c: "f_gone" },
  });
  assert.deepStrictEqual(l.sections.map(function (s) { return s.label; }), ["Second", "First", "Unfiled"]);
  assert.deepStrictEqual(keys(l.sections[0].units), ["b"]);
  assert.deepStrictEqual(keys(l.sections[2].units), ["c"], "dangling folder reference falls back to Unfiled");
});

test("sort modes and directions", async function () {
  var units = [unit("a", "beta", 10, 300), unit("b", "Alpha", 30, 100), unit("c", "gamma", 20, 200)];
  async function order(sort, direction, orderList) {
    var l = await layout(units, { view: { sort: sort, direction: direction }, orders: { unfiled: orderList || [] } });
    return keys(l.sections[0].units);
  }
  assert.deepStrictEqual(await order("activity", "desc"), ["b", "c", "a"]);
  assert.deepStrictEqual(await order("activity", "asc"), ["a", "c", "b"]);
  assert.deepStrictEqual(await order("created", "desc"), ["a", "c", "b"]);
  assert.deepStrictEqual(await order("created", "asc"), ["b", "c", "a"]);
  assert.deepStrictEqual(await order("title", "asc"), ["b", "a", "c"]);
  assert.deepStrictEqual(await order("title", "desc"), ["c", "a", "b"]);
  assert.deepStrictEqual(await order("manual", "desc", ["c", "a"]), ["c", "a", "b"], "unlisted sessions follow the manual list");
});

test("every sort and direction keeps the fixed folder layout and only reorders members", async function () {
  var units = [unit("a", "A", 350, 100), unit("b", "B", 250, 350), unit("c", "C", 50, 250), unit("d", "D", 10, 10)];
  var state = { folders: [{ id: "f_2", name: "Second" }, { id: "f_1", name: "First" }], assignments: { a: "f_1", b: "f_1", c: "f_2" } };
  var m = await layoutPromise;
  for (var sort of ["activity", "created", "title", "manual"]) {
    for (var direction of ["desc", "asc"]) {
      var l = await layout(units, Object.assign({}, state, { view: { sort: sort, direction: direction } }));
      assert.deepStrictEqual(l.sections.map(function (x) { return x.id; }), ["f_2", "f_1", "unfiled"], sort + "/" + direction + " never reorders folders");
      assert.deepStrictEqual(l.sections.map(function (x) { return x.type; }), ["folder", "folder", "unfiled"]);
      assert.deepStrictEqual(m.containerKeys(l, "f_2"), ["c"]);
      assert.deepStrictEqual(keys(l.sections[1].units).sort(), ["a", "b"], "assignments are unchanged");
    }
  }
  var created = await layout(units, Object.assign({}, state, { view: { sort: "created", direction: "desc" } }));
  assert.deepStrictEqual(keys(created.sections[1].units), ["b", "a"]);
  assert.strictEqual(m.GROUP_OPTIONS, undefined, "the grouping selector options are gone");
  assert.strictEqual(m.defaultFolderState().view.group, undefined);
  assert.strictEqual(created.mode, undefined);
});

test("a Driver root is one unit and unkeyed items stay unfiled", async function () {
  var driverRoot = unit("drv", "Driver", 100, 1, { item: { type: "driver-hierarchy", root: { workers: [{}, {}] } } });
  var split = unit(null, "Split", 90, 0, { item: { type: "split-group" } });
  var l = await layout([driverRoot, split], { assignments: { drv: "favorites", nope: "favorites" } });
  assert.deepStrictEqual(keys(l.favorites), ["drv"]);
  assert.deepStrictEqual(keys(l.sections[0].units), [null]);
  var m = await layoutPromise;
  assert.strictEqual(m.containerOf({ assignments: { x: "favorites" }, folders: [] }, { key: null }), "unfiled");
});

test("collapsed sections are remembered but searching reveals every match", async function () {
  var units = [unit("a", "A", 10), unit("b", "B", 20)];
  var state = { folders: [{ id: "f_1", name: "One" }], assignments: { a: "f_1", b: "favorites" }, collapsed: { f_1: true, favorites: true } };
  var plain = await layout(units, state);
  assert.strictEqual(plain.favoritesCollapsed, true);
  assert.strictEqual(plain.sections[0].collapsed, true);
  var searching = await layout(units, state, true);
  assert.strictEqual(searching.favoritesCollapsed, false);
  assert.strictEqual(searching.sections[0].collapsed, false);
  var empty = await layout([unit("b", "B", 20)], state, true);
  assert.ok(empty.sections.every(function (s) { return s.units.length > 0; }), "empty sections are hidden while searching");
});

test("orderAfterMove places before, after or at the end", async function () {
  var m = await layoutPromise;
  assert.deepStrictEqual(m.orderAfterMove(["a", "b", "c"], "c", "a", true), ["c", "a", "b"]);
  assert.deepStrictEqual(m.orderAfterMove(["a", "b", "c"], "a", "b", false), ["b", "a", "c"]);
  assert.deepStrictEqual(m.orderAfterMove(["a", "b"], "z", null, true), ["a", "b", "z"]);
  assert.deepStrictEqual(m.orderAfterMove(["a", "b"], "a", "missing", true), ["b", "a"]);
});

test("desktop and mobile share one folder layout and never use localStorage", function () {
  var desktop = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-sessions.js"), "utf8");
  var mobile = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-mobile.js"), "utf8");
  var ui = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-session-folders-ui.js"), "utf8");
  var state = fs.readFileSync(path.join(root, "lib/public/modules/session-folders.js"), "utf8");
  assert.match(desktop, /computeLayout\(/);
  assert.match(mobile, /computeLayout\(/);
  assert.match(mobile, /createMoveButton\(/, "mobile exposes a non-drag move control");
  [ui, state, desktop, mobile].forEach(function (src) { assert.doesNotMatch(src, /localStorage/); });
  [ui, state].forEach(function (src) { assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/); });
});

test("folder client modules keep mutable state in the store, not in module variables", function () {
  ["sidebar-session-folders-ui.js", "session-folder-dialogs.js", "session-folders.js", "session-folder-toolbar.js", "session-folder-view-menu.js", "session-folder-dnd.js", "session-folder-draft.js", "session-list-search.js", "session-folder-context.js"].forEach(function (name) {
    var src = fs.readFileSync(path.join(root, "lib/public/modules", name), "utf8");
    assert.doesNotMatch(src, /^var \w+ = (null|false|true|0|""|\[\]|\{\});/m, name + " has top-level mutable state");
    assert.doesNotMatch(src, /^var \w+;$/m, name + " has an uninitialised top-level variable");
  });
});

test("every folder operation carries its project and project switches reset state", function () {
  var state = fs.readFileSync(path.join(root, "lib/public/modules/session-folders.js"), "utf8");
  var ui = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-session-folders-ui.js"), "utf8");
  assert.match(state, /slug: store\.get\('currentSlug'\)/);
  assert.match(state, /msg\.slug !== slug/);
  assert.match(ui, /state\.currentSlug !== previous\.currentSlug/);
  assert.match(ui, /closeFolderModal\(\)/);
});
