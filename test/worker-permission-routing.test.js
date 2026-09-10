// Split Worker permission routing.
//
// A visible Split Worker's ordinary provider permission prompts are decided by
// its exact paired Driver through the pair's existing MCP tool coordination,
// never presented in the Worker pane as if the human had asked for that call.
// The properties that matter: exact pair identity, no broadened authority, and
// deterministic failure rather than a hang or a leak to another session.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var { attachWorkerPermission, isUserInputTool, USER_INPUT_TOOLS } = require("../lib/project-worker-permission");

// --- Harness --------------------------------------------------------------

function makeSession(id, ownerId) {
  return { localId: id, ownerId: ownerId === undefined ? null : ownerId, history: [], destroying: false };
}

function makeWorld(options) {
  var opts = options || {};
  var driver = makeSession(1, opts.ownerId === undefined ? null : opts.ownerId);
  var worker = makeSession(2, opts.ownerId === undefined ? null : opts.ownerId);
  var sessions = new Map([[1, driver], [2, worker]]);
  var group = { id: "sg_test", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var groups = [group];

  var sent = [];
  var resumes = [];
  var detached = [];

  var sm = {
    sessions: sessions,
    sendToSession: function (session, msg) { sent.push({ to: session.localId, msg: msg }); },
  };
  var store = {
    groupForMember: function (localId) {
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].members.indexOf(localId) !== -1) return groups[i];
      }
      return null;
    },
  };

  var router = attachWorkerPermission({
    sm: sm,
    splitStore: store,
    onProcessingChanged: function () {},
    resumeDriverWithMessage: function (session, text, meta) {
      resumes.push({ to: session.localId, text: text, meta: meta });
      return opts.resumeFails ? false : true;
    },
    requestDetach: function (session) { detached.push(session.localId); return true; },
  });

  return {
    router: router, driver: driver, worker: worker, group: group,
    groups: groups, sessions: sessions, sent: sent, resumes: resumes, detached: detached,
    dissolve: function () { groups.length = 0; },
  };
}

function route(world, overrides) {
  var req = Object.assign({ toolName: "Write", input: { file_path: "/tmp/x" }, toolUseId: "tu_1" }, overrides || {});
  return world.router.routeIfWorker(world.worker, req);
}

function parseToolText(result) {
  return JSON.parse(result.content[0].text);
}

// --- Normal approval and denial -------------------------------------------

test("a Worker request goes to its exact Driver and an approval resolves it", async function () {
  var world = makeWorld();
  var decision = route(world);
  assert.ok(decision instanceof Promise, "the request was routed rather than shown to the human");

  // The Driver was resumed with the request, and told the exact request id.
  assert.equal(world.resumes.length, 1);
  assert.equal(world.resumes[0].to, 1, "delivered to the Driver, not the Worker");
  assert.match(world.resumes[0].text, /\[Split Worker permission request\]/);
  assert.match(world.resumes[0].text, /Tool: Write/);
  assert.match(world.resumes[0].text, /file_path/, "the Driver sees what it is approving");
  assert.equal(world.resumes[0].meta.workerPermissionRequest, true);

  var requestId = world.resumes[0].meta.requestId;
  assert.match(requestId, /^wperm_/);

  var tools = world.router.getToolDefs(world.driver);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "respond_to_worker_permission");

  var result = await tools[0].handler({ requestId: requestId, decision: "allow" });
  var payload = parseToolText(result);
  assert.equal(payload.status, "resolved");
  assert.equal(payload.decision, "allow");

  var resolved = await decision;
  assert.deepEqual(resolved, { behavior: "allow", updatedInput: { file_path: "/tmp/x" } },
    "the Worker's original tool input is passed through unchanged");
});

test("a denial reaches the Worker with the Driver's reason", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;

  var tools = world.router.getToolDefs(world.driver);
  await tools[0].handler({ requestId: requestId, decision: "deny", reason: "outside the delegated scope" });

  var resolved = await decision;
  assert.equal(resolved.behavior, "deny");
  assert.match(resolved.message, /Denied by the paired Driver: outside the delegated scope/);

  // The Worker learns the outcome from its own resolved tool call. No frame is
  // emitted to either pane, so no client rendering is implied.
  assert.deepEqual(world.sent, [], "routing sends nothing to any pane");
});

test("a decision covers one call and never widens the Worker's authority", async function () {
  var world = makeWorld();
  var decision = route(world);
  await world.router.getToolDefs(world.driver)[0]
    .handler({ requestId: world.resumes[0].meta.requestId, decision: "allow" });
  await decision;

  assert.equal(world.worker.allowedTools, undefined,
    "an approval does not pre-authorize the same tool next time");
  assert.equal(world.worker.permissionMode, undefined, "and does not change a permission mode");
  assert.equal(world.driver.allowedTools, undefined);

  // The next call is a brand new request with a different id.
  var second = route(world);
  assert.ok(second instanceof Promise);
  assert.equal(world.resumes.length, 2);
  assert.notEqual(world.resumes[1].meta.requestId, world.resumes[0].meta.requestId);
});

// --- Who may answer -------------------------------------------------------

test("only the exact paired Driver can answer", async function () {
  var world = makeWorld();
  route(world);
  var requestId = world.resumes[0].meta.requestId;
  var handler = world.router.getToolDefs(world.driver)[0].handler;

  // The Worker itself cannot answer its own request.
  var selfAnswer = await world.router.handleDriverResponse({ requestId: requestId, decision: "allow" }, world.worker);
  assert.equal(selfAnswer.isError, true);
  assert.match(selfAnswer.content[0].text, /only the paired Driver/);

  // An unrelated session cannot answer.
  var stranger = makeSession(99, null);
  var strangerAnswer = await world.router.handleDriverResponse({ requestId: requestId, decision: "allow" }, stranger);
  assert.equal(strangerAnswer.isError, true);

  // A session-less caller cannot answer.
  var unbound = await world.router.handleDriverResponse({ requestId: requestId, decision: "allow" }, null);
  assert.equal(unbound.isError, true);

  // The real Driver still can, so the request was never consumed by the above.
  var ok = parseToolText(await handler({ requestId: requestId, decision: "allow" }));
  assert.equal(ok.status, "resolved");
});

test("a Driver from another user cannot answer even with the right request id", async function () {
  var world = makeWorld({ ownerId: "alice" });
  route(world);
  var requestId = world.resumes[0].meta.requestId;

  // Same localId, different owner, not the live entry: refused by the
  // exact-live-object guard, which is the earlier and stronger invariant.
  var impostor = makeSession(1, "mallory");
  var denied = await world.router.handleDriverResponse({ requestId: requestId, decision: "allow" }, impostor);
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /no longer live/);

  // The owner check still has its own teeth: the live Driver object itself,
  // whose ownership changed after the request was opened, is also refused.
  world.driver.ownerId = "mallory";
  var reowned = await world.router.handleDriverResponse({ requestId: requestId, decision: "allow" }, world.driver);
  assert.equal(reowned.isError, true);
  assert.match(reowned.content[0].text, /access denied/);
});

test("the response tool is offered to the Driver only", function () {
  var world = makeWorld();
  assert.equal(world.router.getToolDefs(world.driver).length, 1, "the Driver gets it");
  assert.deepEqual(world.router.getToolDefs(world.worker), [], "the Worker does not");
  assert.deepEqual(world.router.getToolDefs(makeSession(99, null)), [], "an ungrouped session does not");
  assert.equal(world.router.getToolDefs(world.driver, { dormantDriver: true }).length, 1,
    "the pair coordinator may pre-mount it for an eligible future Driver");
  assert.deepEqual(world.router.getToolDefs(null), []);
});

test("a malformed decision is refused and leaves the request pending", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;
  var handler = world.router.getToolDefs(world.driver)[0].handler;

  var bad = ["", "maybe", "ALLOW ME", "approve", "yes", null, 1, {}];
  for (var i = 0; i < bad.length; i++) {
    var res = await handler({ requestId: requestId, decision: bad[i] });
    assert.equal(res.isError, true, JSON.stringify(bad[i]) + " is refused");
  }
  assert.equal(world.router.pendingCountFor(world.worker), 1, "still awaiting a real answer");

  // Case is normalized, so a capitalized valid decision still works.
  var ok = parseToolText(await handler({ requestId: requestId, decision: " Allow " }));
  assert.equal(ok.decision, "allow");
  assert.equal((await decision).behavior, "allow");
});

test("a missing or unknown request id is refused", async function () {
  var world = makeWorld();
  var handler = world.router.getToolDefs(world.driver);
  // No pending request yet, so no tool: create one first.
  route(world);
  handler = world.router.getToolDefs(world.driver)[0].handler;

  assert.equal((await handler({ decision: "allow" })).isError, true, "no requestId");
  assert.equal((await handler({ requestId: "   ", decision: "allow" })).isError, true);
  var unknown = parseToolText(await handler({ requestId: "wperm_nope", decision: "allow" }));
  assert.equal(unknown.status, "already_resolved", "an unknown id is reported, never applied");
});

// --- Stale pair and idempotency ------------------------------------------

test("a response after the pair changed is refused and the request fails closed", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;
  var handler = world.router.getToolDefs(world.driver)[0].handler;

  // The roles swap underneath: the recorded Driver is no longer the Driver.
  world.group.pair = { driverId: 2, workerId: 1 };

  var res = await handler({ requestId: requestId, decision: "allow" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /pair changed/);

  var resolved = await decision;
  assert.equal(resolved.behavior, "deny", "the stale request fails closed rather than lingering");
  assert.equal(world.router.pendingCountFor(world.worker), 0);
});

test("a response for a request whose group was replaced is refused", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;
  var handler = world.router.getToolDefs(world.driver)[0].handler;

  world.group.id = "sg_different";

  assert.equal((await handler({ requestId: requestId, decision: "allow" })).isError, true);
  assert.equal((await decision).behavior, "deny");
});

test("a duplicate response is idempotent and never re-applies", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;
  var handler = world.router.getToolDefs(world.driver)[0].handler;

  var settlements = [];
  decision.then(function (d) { settlements.push(d); });

  var first = parseToolText(await handler({ requestId: requestId, decision: "allow" }));
  assert.equal(first.status, "resolved");
  assert.equal((await decision).behavior, "allow");

  // A second answer, including a contradicting one, changes nothing.
  var second = parseToolText(await handler({ requestId: requestId, decision: "deny" }));
  assert.equal(second.status, "already_resolved");
  var third = parseToolText(await handler({ requestId: requestId, decision: "allow" }));
  assert.equal(third.status, "already_resolved");

  // A promise settles once by construction, so the contradicting answer could
  // not have reached the Worker even if the handler had let it through.
  await Promise.resolve();
  assert.equal(settlements.length, 1, "the Worker's call resolved exactly once");
  assert.equal(settlements[0].behavior, "allow", "with the first decision, not the last");
  assert.equal(world.router.pendingCountFor(world.worker), 0);
});

// --- Deterministic failure ------------------------------------------------

test("stopping the Worker cancels the pending request", async function () {
  var world = makeWorld();
  var listeners = [];
  var signal = { addEventListener: function (name, fn) { listeners.push({ name: name, fn: fn }); } };
  var decision = route(world, { signal: signal });

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].name, "abort");
  listeners[0].fn();

  var resolved = await decision;
  assert.equal(resolved.behavior, "deny");
  assert.match(resolved.message, /Split Worker stopped/);
  assert.equal(world.router.pendingCountFor(world.worker), 0);
  assert.deepEqual(world.sent, [], "cancellation emits no frame either");

  // A Driver that answers afterwards is told it is too late, which is how it
  // learns the request is gone without needing a pushed notice.
  var late = parseToolText(await world.router.handleDriverResponse(
    { requestId: world.resumes[0].meta.requestId, decision: "allow" }, world.driver));
  assert.equal(late.status, "already_resolved");
});

test("losing the Driver fails the request closed rather than leaking or hanging", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;

  // The Driver session goes away entirely.
  world.sessions.delete(1);
  world.router.cancelForSession(world.driver, "Driver session ended.");

  var resolved = await decision;
  assert.equal(resolved.behavior, "deny");
  assert.equal(world.router.pendingCountFor(world.worker), 0);

  // And a late answer cannot revive it.
  var late = parseToolText(await world.router.handleDriverResponse(
    { requestId: requestId, decision: "allow" }, world.driver));
  assert.equal(late.status, "already_resolved");
});

test("dissolving the pair cancels everything the Worker was waiting on", async function () {
  var world = makeWorld();
  var first = route(world);
  var second = route(world);
  assert.equal(world.router.pendingCountFor(world.worker), 2);

  world.dissolve();
  world.router.cancelForSession(world.worker, "The Driver closed the Split Worker pair.");

  assert.equal((await first).behavior, "deny");
  assert.equal((await second).behavior, "deny");
  assert.equal(world.router.pendingCountFor(world.worker), 0);
});

test("an undeliverable Driver fails closed immediately", async function () {
  var world = makeWorld({ resumeFails: true });
  var decision = route(world);
  var resolved = await decision;
  assert.equal(resolved.behavior, "deny");
  assert.match(resolved.message, /could not be reached/);
  assert.equal(world.router.pendingCountFor(world.worker), 0);
});

test("a Driver blocked in a waiting delegation is detached so it can answer", function () {
  var world = makeWorld();
  route(world);
  assert.deepEqual(world.detached, [2],
    "the Worker's delegation wait is released before the Driver is asked to decide");
});

// --- What is NOT routed ---------------------------------------------------

test("only a configured Worker is routed; everything else keeps the human flow", function () {
  var world = makeWorld();

  // The Driver's own permission requests are never routed to itself.
  assert.equal(world.router.routeIfWorker(world.driver, { toolName: "Write", input: {} }), null);

  // An ordinary session in no split group.
  assert.equal(world.router.routeIfWorker(makeSession(99, null), { toolName: "Write", input: {} }), null);

  // A split group with no pair roles is a plain side-by-side split, not a
  // Driver/Worker pair.
  var plain = makeWorld();
  delete plain.group.pair;
  assert.equal(plain.router.routeIfWorker(plain.worker, { toolName: "Write", input: {} }), null);

  // A Worker whose Driver has vanished falls back rather than routing nowhere.
  var orphan = makeWorld();
  orphan.sessions.delete(1);
  assert.equal(orphan.router.routeIfWorker(orphan.worker, { toolName: "Write", input: {} }), null);

  // A Worker whose Driver is being torn down.
  var dying = makeWorld();
  dying.driver.destroying = true;
  assert.equal(dying.router.routeIfWorker(dying.worker, { toolName: "Write", input: {} }), null);

  // Cross-owner pairs never route.
  var mixed = makeWorld({ ownerId: "alice" });
  mixed.driver.ownerId = "bob";
  assert.equal(mixed.router.routeIfWorker(mixed.worker, { toolName: "Write", input: {} }), null);
});

test("user input is not a permission approval, so it stays with the person", function () {
  var world = makeWorld();
  assert.deepEqual(USER_INPUT_TOOLS, ["AskUserQuestion"],
    "exactly one exemption, and it is not an approval at all");
  for (var i = 0; i < USER_INPUT_TOOLS.length; i++) {
    assert.equal(isUserInputTool(USER_INPUT_TOOLS[i]), true);
    assert.equal(world.router.routeIfWorker(world.worker, { toolName: USER_INPUT_TOOLS[i], input: {} }), null,
      USER_INPUT_TOOLS[i] + " is never answered by the Driver");
  }
  assert.equal(isUserInputTool("Write"), false);
  assert.equal(isUserInputTool("EnterPlanMode"), false, "plan mode is an approval, not user input");
  assert.equal(isUserInputTool("ExitPlanMode"), false);
  assert.equal(world.resumes.length, 0, "and no Driver was disturbed");
});

test("plan-mode approvals are routed to the Driver like every other permission", async function () {
  var planTools = ["EnterPlanMode", "ExitPlanMode"];
  for (var i = 0; i < planTools.length; i++) {
    var world = makeWorld();
    var input = planTools[i] === "ExitPlanMode" ? { plan: "Do the thing" } : {};
    var decision = world.router.routeIfWorker(world.worker, { toolName: planTools[i], input: input });
    assert.ok(decision instanceof Promise, planTools[i] + " is routed");
    assert.equal(world.resumes.length, 1);
    assert.match(world.resumes[0].text, new RegExp("Tool: " + planTools[i]));

    await world.router.getToolDefs(world.driver)[0]
      .handler({ requestId: world.resumes[0].meta.requestId, decision: "allow" });
    var resolved = await decision;
    assert.deepEqual(resolved, { behavior: "allow", updatedInput: input },
      planTools[i] + " resolves as a plain provider allow");

    // The Driver decided the Worker's execution mode for this one call and
    // nothing else: no session-global mode, no persistent tool grant.
    assert.equal(world.worker.permissionMode, undefined);
    assert.equal(world.worker.allowedTools, undefined);
    assert.equal(world.driver.permissionMode, undefined);
    assert.equal(world.driver.allowedTools, undefined);
  }
});

test("the router cannot reach the mode-mutating plan decisions at all", function () {
  var routerSource = fs.readFileSync(path.join(root, "lib/project-worker-permission.js"), "utf8");
  // Assert against code only: the header comment discusses these names in
  // order to explain why the code must never use them.
  var routerCode = routerSource.replace(/^\s*\/\/.*$/gm, "");

  // Those decisions are interpreted only on the permission_response path in
  // project-sessions.js, which the router never travels.
  assert.equal(/allow_accept_edits|allow_clear_context/.test(routerCode), false,
    "no mode-changing decision string appears in router code");
  // The router may *read* a mode — inheritedPermissionMode resolves the
  // Driver's, which is the whole point of Driver-operated inheritance — but it
  // must never write one, nor grant a tool persistently.
  assert.equal(/setPermissionMode|\.permissionMode\s*=|allowedTools/.test(routerCode), false,
    "the router writes neither a permission mode nor a persistent grant");
  assert.match(routerCode, /return driver\.permissionMode \|\| sm\.currentPermissionMode/,
    "it reads the Driver's mode, which is a read and not a mutation");
  // The explanation is still required to be present, in the comments.
  assert.match(routerSource, /decision\s*\n\/\/ strings\* carried on the permission_response WebSocket message/);

  // The plain allow it does produce is the same shape the human plan card's
  // "Manually approve" button sends.
  var sessionsSource = fs.readFileSync(path.join(root, "lib/project-sessions.js"), "utf8");
  assert.match(sessionsSource, /if \(decision === "allow_accept_edits"\)/,
    "the mutating branches live on the human response path");
  assert.match(sessionsSource, /if \(decision === "allow_clear_context"\)/);
});

// --- Wiring ---------------------------------------------------------------

var bridgeSource = fs.readFileSync(path.join(root, "lib/sdk-bridge.js"), "utf8");
var pairSource = fs.readFileSync(path.join(root, "lib/project-session-pair.js"), "utf8");
var projectSource = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
var routerSource = fs.readFileSync(path.join(root, "lib/project-worker-permission.js"), "utf8");

test("routing sits below every existing auto-decision, so skip permissions never waits", function () {
  var fn = bridgeSource.slice(bridgeSource.indexOf("function handleCanUseTool(session, toolName, input, opts)"));
  fn = fn.slice(0, fn.indexOf("\n  /**"));

  var bypassAt = fn.indexOf('clayPermissionMode === "bypassPermissions"');
  var whitelistAt = fn.indexOf("var whitelisted = checkToolWhitelist");
  var allowedAt = fn.indexOf("session.allowedTools && session.allowedTools[toolName]");
  var loopAt = fn.indexOf("session.loop && session.loop.active");
  var routeAt = fn.indexOf("_wp.routeIfWorker(session");
  var humanAt = fn.indexOf('type: "permission_request"');

  assert.ok(bypassAt !== -1 && routeAt !== -1 && humanAt !== -1);
  assert.ok(bypassAt < routeAt, "skip permissions resolves before routing is considered");
  assert.ok(whitelistAt < routeAt, "the safe-tool whitelist resolves first");
  assert.ok(allowedAt < routeAt, "session allowedTools resolves first");
  assert.ok(loopAt < routeAt, "Ralph loop denials resolve first");
  assert.ok(routeAt < humanAt, "and routing precedes the human-facing request");

  // Skip permissions is the existing bypass, with no second toggle invented.
  assert.equal(/skipWorkerPermission|workerSkip|bypassWorker/.test(bridgeSource + routerSource + pairSource), false,
    "no parallel skip state exists");
});

test("the router is wired through a getter and never to a Mate project", function () {
  assert.match(bridgeSource, /var getWorkerPermissionRouter = opts\.getWorkerPermissionRouter \|\| function \(\) \{ return null; \};/);
  assert.match(projectSource, /getWorkerPermissionRouter: function \(\) \{\s*\n\s*return isMate \? null : _sessionPair\.workerPermission;\s*\n\s*\},/,
    "Mate DM projects keep the ordinary flow");
  assert.match(pairSource, /workerPermission = attachWorkerPermission\(\{/);
  assert.match(pairSource, /workerPermission: workerPermission/, "exposed for the bridge");
});

test("the Driver tool is mounted alongside the existing pair tools", function () {
  assert.match(pairSource, /workerPermission\.getToolDefs\(boundSession, \{ dormantDriver: true \}\)/,
    "an unpaired proposal query can answer Worker permissions after acceptance");
  assert.match(pairSource, /workerPermission\.getToolDefs\(boundSession, \{ dormantDriver: false \}\)/,
    "a paired Driver retains the permission decision tool");
  // A configured Worker receives only its exact outcome-report surface.
  assert.match(pairSource, /group && group\.pair && group\.pair\.driverId !== boundSession\.localId\) return taskControl\.workerToolDefs\(boundSession\);/);
});

test("closing the pair cancels pending requests immediately", function () {
  var fn = pairSource.slice(pairSource.indexOf("function closePartner(args, caller)"));
  fn = fn.slice(0, fn.indexOf("\n  function getToolDefs"));
  assert.match(fn, /workerPermission\.cancelForSession\(partner, "The Driver closed the Split Worker pair\."\);/);
  assert.ok(fn.indexOf("cancelForSession") < fn.indexOf("store.dissolve"),
    "cancelled before the group record disappears");
});

test("a permission request detaches a waiting delegation through the existing path", function () {
  assert.match(pairSource, /if \(Date\.now\(\) >= deadline \|\| token\.detachRequested\) \{/,
    "the same detach the timeout already used");
  assert.match(pairSource, /function requestDetach\(worker\)[\s\S]*?token\.detachRequested = true;/);
  assert.match(routerSource, /requestDetach\(session\);/);
});

test("server conventions and module sizes hold", function () {
  var files = [
    ["project-worker-permission.js", routerSource],
    ["project-session-pair.js", pairSource],
    ["session-pair-factory.js", fs.readFileSync(path.join(root, "lib/session-pair-factory.js"), "utf8")],
  ];
  for (var i = 0; i < files.length; i++) {
    var name = files[i][0], src = files[i][1];
    assert.equal(/=>/.test(src), false, name + ": no arrow functions");
    assert.equal(/^\s*(const|let)\s/m.test(src), false, name + ": var only");
    assert.ok(src.split("\n").length < 500, name + ": under the module size limit");
  }
  assert.match(routerSource, /module\.exports = \{/, "CommonJS");

  // project.js stays thin: it wires, it does not decide.
  var wiring = projectSource.slice(projectSource.indexOf("getWorkerPermissionRouter: function"));
  wiring = wiring.slice(0, wiring.indexOf("onProcessingChanged: onProcessingChanged,"));
  assert.equal(/routeIfWorker|pending|requestId|allow|deny/.test(wiring), false,
    "no routing logic leaked into project.js");
});

test("identity is re-derived from the live pair, never taken from arguments", function () {
  var fn = routerSource.slice(routerSource.indexOf("function handleDriverResponse(args, caller)"));
  fn = fn.slice(0, fn.indexOf("\n  // Exposed to the Driver only"));
  assert.equal(/args\.(driverId|workerId|ownerId|userId|groupId|sessionId)/.test(fn), false,
    "no identity field is read from the tool arguments");
  assert.match(fn, /record\.driverId !== caller\.localId/, "the caller must be the recorded Driver");
  assert.match(fn, /caller\.ownerId \|\| null\) !== record\.ownerId/, "and the same owner");
  assert.match(fn, /if \(!pairStillExact\(record\)\)/, "and the pair must still be exactly that pair");
});

// --- Exact live session objects, not just ids ----------------------------
//
// A localId is reusable and a session object can be replaced in the manager by
// a rehydrated or forged one carrying the same id. Identity by id alone would
// let a stale object inherit the Driver's permission mode, be treated as
// Driver-operated, open a routed request against the wrong object, or answer
// one through a captured handler.

function impostorOf(session, overrides) {
  return Object.assign({
    localId: session.localId,
    ownerId: session.ownerId,
    history: [],
    destroying: false,
  }, overrides || {});
}

test("a stale Worker object no longer inherits the Driver's permission mode", function () {
  var world = makeWorld();
  world.driver.permissionMode = "bypassPermissions";

  // Live: the configured Worker inherits skip mode from its Driver.
  assert.equal(world.router.inheritedPermissionMode(world.worker), "bypassPermissions");

  // The manager entry is replaced by a different object with the same id.
  var stale = world.worker;
  var impostor = impostorOf(stale);
  world.sessions.set(stale.localId, impostor);

  assert.equal(world.router.inheritedPermissionMode(stale), null,
    "the stale object inherits nothing, so the caller keeps its own resolution");
  assert.equal(world.router.inheritedPermissionMode(impostor), "bypassPermissions",
    "and the live object still does");

  // A stale Driver object is equally powerless to donate a mode.
  var liveWorker = impostor;
  var staleDriver = world.driver;
  world.sessions.set(staleDriver.localId, impostorOf(staleDriver, { permissionMode: "default" }));
  assert.equal(world.router.inheritedPermissionMode(liveWorker), "default",
    "inheritance follows the live Driver entry, not the object that was captured");
});

test("a stale Worker object is not Driver-operated, so it cannot be mutated as one", function () {
  var world = makeWorld();
  assert.equal(world.router.isDriverOperated(world.worker), true);

  var stale = world.worker;
  world.sessions.set(stale.localId, impostorOf(stale));

  assert.equal(world.router.isDriverOperated(stale), false,
    "the wrong object is never treated as the configured Worker");
  assert.equal(world.router.isDriverOperated(world.sessions.get(stale.localId)), true,
    "while the live entry still is, so the human-send refusal still applies to it");

  // The Driver side too: a stale Driver object is not a Worker either way.
  assert.equal(world.router.isDriverOperated(world.driver), false);
});

test("a live server-resolved configured Worker stays blocked from human sends", function () {
  // isDriverOperated is what the ordinary-message refusal consults, so the
  // property that matters is that the live entry keeps answering true.
  var world = makeWorld();
  var live = world.sessions.get(world.worker.localId);
  assert.equal(world.router.isDriverOperated(live), true, "before any swap");

  var replaced = impostorOf(world.worker);
  world.sessions.set(world.worker.localId, replaced);
  assert.equal(world.router.isDriverOperated(replaced), true,
    "after a rehydration the new live entry is still the configured Worker");
  assert.equal(world.router.isDriverOperated(world.worker), false,
    "and only the stale object loses the role");

  // Dissolving the pair is the only thing that actually lifts the block.
  world.dissolve();
  assert.equal(world.router.isDriverOperated(replaced), false);
});

test("a stale Worker object cannot open a routed permission request", function () {
  var world = makeWorld();
  var stale = world.worker;
  world.sessions.set(stale.localId, impostorOf(stale));

  assert.equal(world.router.routeIfWorker(stale, { toolName: "Write", input: {} }), null,
    "no request is created, so the call falls back to the ordinary human flow");
  assert.deepEqual(world.resumes, [], "and no Driver was asked to decide");
  assert.equal(world.router.pendingCountFor(stale), 0);
});

test("a captured Driver handler cannot answer after its session object is replaced", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;
  var captured = world.router.getToolDefs(world.driver)[0].handler;

  // The Driver entry is replaced by a same-id object mid-request.
  var staleDriver = world.driver;
  var newDriver = impostorOf(staleDriver);
  world.sessions.set(staleDriver.localId, newDriver);

  var viaStale = await captured({ requestId: requestId, decision: "allow" });
  assert.equal(viaStale.isError, true, "the captured handler is refused");
  assert.match(viaStale.content[0].text, /no longer live/);
  assert.equal(world.router.pendingCountFor(newDriver), 0, "the Worker id is what pends, not the Driver");
  // Refusing a stale handler does not kill the request: a live Driver could
  // still legitimately answer it.
  assert.equal(world.router.pendingCountFor(world.worker), 1);

  // The replacement cannot inherit the open request either: it is the live
  // entry, but not the object the request was opened against.
  // It is the live entry, but not the object the request was opened against,
  // which is a pair change: refused, and the request is failed closed.
  var viaNew = await world.router.handleDriverResponse(
    { requestId: requestId, decision: "allow" }, newDriver);
  assert.equal(viaNew.isError, true);
  assert.match(viaNew.content[0].text, /pair changed/);

  var resolved = await decision;
  assert.equal(resolved.behavior, "deny", "the request failed closed rather than resolving");
});

test("a replaced Worker object fails an open request closed", async function () {
  var world = makeWorld();
  var decision = route(world);
  var requestId = world.resumes[0].meta.requestId;
  var handler = world.router.getToolDefs(world.driver)[0].handler;

  world.sessions.set(world.worker.localId, impostorOf(world.worker));

  var res = await handler({ requestId: requestId, decision: "allow" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /pair changed/);
  assert.equal((await decision).behavior, "deny");
});

test("the record binds the exact objects, and every entry point shares one check", function () {
  var src = fs.readFileSync(path.join(root, "lib/project-worker-permission.js"), "utf8");

  var resolve = src.slice(src.indexOf("function resolveWorkerPair(session)"));
  resolve = resolve.slice(0, resolve.indexOf("function pairStillExact"));
  assert.match(resolve, /if \(sm\.sessions\.get\(session\.localId\) !== session\) return null;/);
  assert.ok(resolve.indexOf("sm.sessions.get(session.localId) !== session") < resolve.indexOf("groupForMember"),
    "identity is settled before the group lookup");

  // One shared gate: routing, the role predicate and inheritance all go
  // through resolveWorkerPair, so none of them can drift.
  assert.match(src, /function driverOperatedPair\(session\) \{\s*\n\s*var resolved = resolveWorkerPair\(session\);/);
  assert.match(src, /function isDriverOperated\(session\) \{\s*\n\s*return !!driverOperatedPair\(session\);/);
  assert.match(src, /function inheritedPermissionMode\(session\) \{\s*\n\s*var resolved = driverOperatedPair\(session\);/);
  assert.match(src, /function routeIfWorker\(session, req\) \{[\s\S]*?var resolved = resolveWorkerPair\(session\);/);

  var exact = src.slice(src.indexOf("function pairStillExact(record)"));
  exact = exact.slice(0, exact.indexOf("function clearRecord"));
  assert.match(exact, /if \(driver !== record\.driverRef \|\| worker !== record\.workerRef\) return false;/);
  assert.match(src, /driverRef: resolved\.driver,\s*\n\s*workerRef: session,/);
});
