var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var url = require("node:url");
var createSessionManager = require("../lib/sessions").createSessionManager;

var root = path.join(__dirname, "..");
var visibilityPromise = import(url.pathToFileURL(path.join(root, "lib/public/modules/session-list-visibility.js")).href);

test("ordinary session visibility hides only metadata-owned debates and their Workers", async function () {
  var visibility = await visibilityPromise;
  var sessions = [
    { id: 1, title: "Dedicated planning", homeDebatePlanning: true },
    { id: 2, title: "Active debate", loop: { loopId: "d1", source: "debate", role: "crafting" } },
    { id: 3, title: "Completed debate", loop: { loopId: "d1", source: "debate", role: "participant" } },
    { id: 4, title: "Debate driver", homeDebatePlanning: true, sessionRole: "driver" },
    { id: 5, title: "Legacy unmarked child", sessionRole: "worker", parentSessionId: 4 },
    { id: 6, title: "Nested child", sessionRole: "worker", parentSessionId: 5 },
    { id: 7, title: "Debate: ordinary title only" },
    { id: 8, title: "Ordinary Ralph", loop: { loopId: "r1", source: "ralph", role: "crafting" } },
    { id: 9, title: "Ordinary scheduled task", loop: { loopId: "s1", source: "schedule", role: "run" } },
    { id: 10, title: "Ordinary Worker", sessionRole: "worker", parentSessionId: 11 },
    { id: 11, title: "Ordinary Driver", sessionRole: "driver" },
    { id: 12, title: "Restored completed debate", homeDebatePhase: "ended" },
  ];

  assert.deepEqual(visibility.ordinarySessionListSessions(sessions).map(function (session) { return session.id; }), [7, 8, 9, 10, 11]);
  assert.equal(visibility.isDebateOwnedSession({ title: "We should debate this" }), false);
  assert.equal(visibility.isDebateOwnedSession({ history: [{ text: "debate" }] }), false);
});

test("session list payload projects persisted debate ownership without rewriting history", function (t) {
  var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clay-debate-list-"));
  t.after(function () { fs.rmSync(tempRoot, { recursive: true, force: true }); });
  var manager = createSessionManager({
    cwd: tempRoot,
    sessionsBase: path.join(tempRoot, "sessions"),
    cliSessionsDir: path.join(tempRoot, "cli"),
    send: function () {},
  });
  var planning = manager.createSessionRaw({ ownerId: "u1" });
  planning.homeDebatePlanning = true;
  planning.homeDebatePhase = "live";
  planning.history.push({ type: "user_message", text: "Keep me in the archive" });
  var ordinary = manager.createSessionRaw({ ownerId: "u1" });

  assert.equal(manager.mapSessionForClient(planning).homeDebatePlanning, true);
  assert.equal(manager.mapSessionForClient(planning).homeDebatePhase, "live");
  assert.equal(manager.mapSessionForClient(ordinary).homeDebatePlanning, false);
  assert.equal(manager.mapSessionForClient(ordinary).homeDebatePhase, null);
  assert.equal(planning.history[0].text, "Keep me in the archive");
});

test("desktop and mobile use one policy while the Debate workbench keeps its archive route", function () {
  var desktop = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-sessions.js"), "utf8");
  var mobile = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-mobile.js"), "utf8");
  var workbench = fs.readFileSync(path.join(root, "lib/public/modules/debates-workbench.js"), "utf8");
  var archive = fs.readFileSync(path.join(root, "lib/server-home-debates.js"), "utf8");

  assert.match(desktop, /ordinarySessionListSessions\(cachedSessions\)/);
  assert.match(mobile, /ordinarySessionListSessions\(getCachedSessions\(\)\)/);
  assert.match(desktop, /folderCtx = \{[\s\S]*sessions: cachedSessions/, "desktop keeps the complete cache for routing and folder context");
  assert.match(workbench, /type: 'home_debates_list'/);
  assert.match(workbench, /function isMateDebateSurface\(state\)/);
  assert.match(workbench, /if \(!isMateDebateSurface\(store\.snap\(\)\)\) return false;/);
  assert.match(workbench, /if \(!isMateDebateSurface\(store\.snap\(\)\)\) return true;/);
  assert.match(workbench, /wasMateWorkspace && !isMate/);
  assert.match(archive, /session && session\.homeDebatePlanning === true/);
  assert.match(archive, /manager\.sessions\.forEach[\s\S]*isHomeDebate\(session\)/);
});

test("the ordinary palette retires Debates while the Mate palette keeps its entry", function () {
  var palette = fs.readFileSync(path.join(root, "lib/public/modules/tool-palette-order.js"), "utf8");
  assert.doesNotMatch(palette.slice(palette.indexOf("var SESSION_TOOLS"), palette.indexOf("var MATE_TOOLS")), /debates-btn/);
  assert.match(palette.slice(palette.indexOf("var MATE_TOOLS"), palette.indexOf("export var PALETTES")), /mate-debates-btn/);
  assert.match(palette, /RETIRED_SESSION_TOOL_IDS = \["git-sidebar-btn", "loop-tool-btn", "debates-btn"\]/);
});
