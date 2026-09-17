// End-to-end Split Worker permission routing, driven through the REAL
// sdk-bridge decision chain rather than a re-implementation of it.
//
// The property under test is the one the product contract turns on: from the
// Worker's tool call to the Worker's resolved decision, no human-facing
// permission_request is ever emitted — not for the Worker's original tool, and
// not for the Driver's answer either.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var { createSDKBridge } = require("../lib/sdk-bridge");
var { attachWorkerPermission } = require("../lib/project-worker-permission");

function makeSession(id) {
  return {
    localId: id,
    ownerId: null,
    history: [],
    destroying: false,
    isProcessing: false,
    pendingPermissions: {},
    blocks: {},
    sentToolResults: {},
  };
}

// A bridge wired with the smallest surface handleCanUseTool actually touches,
// plus a real router over a real two-member pair. Every frame the bridge would
// send to a client is captured so the test can prove what was NOT sent.
function makeWorld(options) {
  var opts = options || {};
  var driver = makeSession(1);
  var worker = makeSession(2);
  var sessions = new Map([[1, driver], [2, worker]]);
  var group = { id: "sg_e2e", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var groups = [group];

  var frames = [];
  var resumes = [];

  var sm = {
    sessions: sessions,
    permissionRequestIndex: {},
    currentPermissionMode: opts.permissionMode || "default",
    sendToSession: function (session, msg) { frames.push({ to: session.localId, msg: msg }); },
    sendAndRecord: function (session, msg) { frames.push({ to: session.localId, msg: msg }); },
    broadcastSessionList: function () {},
    saveSessionFile: function () {},
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
    // Stands in for project-session-pair's resume: records the internal
    // message the Driver receives and reports successful delivery.
    resumeDriverWithMessage: function (session, text, meta) {
      resumes.push({ to: session.localId, text: text, meta: meta });
      return true;
    },
    requestDetach: function () { return false; },
  });

  var bridge = createSDKBridge({
    cwd: root,
    slug: "e2e",
    sessionManager: sm,
    send: function (msg) { frames.push({ to: "all", msg: msg }); },
    onProcessingChanged: function () {},
    getWorkerPermissionRouter: function () { return router; },
  });

  return {
    bridge: bridge, router: router, driver: driver, worker: worker,
    group: group, groups: groups, sm: sm, frames: frames, resumes: resumes,
    humanPrompts: function () {
      return frames.filter(function (f) {
        return f.msg && (f.msg.type === "permission_request" || f.msg.type === "permission_request_pending");
      });
    },
  };
}

// The Worker asks for an ordinary mutating tool through the real bridge.
function workerAsks(world, toolName, input) {
  return world.bridge.handleCanUseTool(
    world.worker,
    toolName || "Write",
    input || { file_path: "/tmp/e2e.txt", content: "x" },
    { toolUseID: "tu_e2e" }
  );
}

// The Driver answers through the real bridge too, so its own tool call is
// subject to the same whitelist and permission chain as any other.
//
// If the answer tool ever stops being auto-approved, the bridge hands back a
// promise that only a human can settle. That would hang the suite, so the
// synchronous evidence is checked first and the await is bounded: a regression
// reports the contract violation instead of stalling.
function driverAnswers(world, requestId, decision) {
  var toolName = "respond_to_worker_permission";
  var args = { requestId: requestId, decision: decision };
  var framesBefore = world.frames.length;

  var gatePromise = world.bridge.handleCanUseTool(world.driver, toolName, args, { toolUseID: "tu_answer" });

  assert.deepEqual(Object.keys(world.driver.pendingPermissions), [],
    "answering must not register a human-facing pending permission");
  var newPrompts = world.frames.slice(framesBefore).filter(function (f) {
    return f.msg && f.msg.type === "permission_request";
  });
  assert.deepEqual(newPrompts, [],
    "answering a Worker permission request must not itself prompt a human");

  var timeout = new Promise(function (_, reject) {
    var t = setTimeout(function () {
      reject(new Error("the Driver's answer tool did not resolve: it is waiting on a human decision"));
    }, 2000);
    if (t.unref) t.unref();
  });

  return Promise.race([gatePromise, timeout]).then(function (gate) {
    assert.deepEqual(gate, { behavior: "allow", updatedInput: args },
      "the Driver's answer tool is auto-approved, so answering raises no prompt");
    return world.router.getToolDefs(world.driver)[0].handler(args);
  });
}

// --- The contract ---------------------------------------------------------

test("Worker request reaches the exact Driver and an approval resolves it, with no human prompt", async function () {
  var world = makeWorld();
  var decision = workerAsks(world);

  // 1. Nothing was presented to the human for the Worker's tool.
  assert.deepEqual(world.humanPrompts(), [], "no permission_request was emitted for the Worker");
  assert.deepEqual(Object.keys(world.worker.pendingPermissions), [],
    "and no human-facing pending request was registered");
  assert.deepEqual(Object.keys(world.sm.permissionRequestIndex), []);

  // 2. The Driver received the request as an internal message.
  assert.equal(world.resumes.length, 1);
  assert.equal(world.resumes[0].to, 1);
  assert.match(world.resumes[0].text, /\[Split Worker permission request\]/);
  assert.match(world.resumes[0].text, /Tool: Write/);
  var requestId = world.resumes[0].meta.requestId;

  // 3. The Driver answers. Its own tool call is gated by the real chain and
  //    must come back allowed without emitting anything to a human.
  var toolResult = await driverAnswers(world, requestId, "allow");
  assert.equal(JSON.parse(toolResult.content[0].text).decision, "allow");

  // 4. The Worker's original call resolves.
  var resolved = await decision;
  assert.deepEqual(resolved, {
    behavior: "allow",
    updatedInput: { file_path: "/tmp/e2e.txt", content: "x" },
  });

  // 5. Still nothing was ever shown to a human, for either hop.
  assert.deepEqual(world.humanPrompts(), []);
});

test("a Driver denial resolves the Worker's call as denied, with no human prompt", async function () {
  var world = makeWorld();
  var decision = workerAsks(world, "Bash", { command: "rm -rf /tmp/e2e" });
  assert.deepEqual(world.humanPrompts(), []);

  var requestId = world.resumes[0].meta.requestId;
  await driverAnswers(world, requestId, "deny");

  var resolved = await decision;
  assert.equal(resolved.behavior, "deny");
  assert.match(resolved.message, /Denied by the paired Driver/);
  assert.deepEqual(world.humanPrompts(), []);
});

test("the answer tool is auto-approved under both naming forms and nothing broader is", function () {
  var world = makeWorld();
  var allow = { behavior: "allow", updatedInput: { requestId: "r", decision: "allow" } };
  var args = { requestId: "r", decision: "allow" };

  assert.deepEqual(world.bridge.checkToolWhitelist("respond_to_worker_permission", args), allow,
    "the dynamic/direct name Codex delivers");
  assert.deepEqual(world.bridge.checkToolWhitelist("mcp__clay-sessions__respond_to_worker_permission", args), allow,
    "and the clay-sessions MCP name");

  // No prefix was widened. close_partner is now auto-approved too, as one of
  // the autonomous pair lifecycle tools, so the boundary to assert is the one
  // that creates arbitrary sessions and the one that borrows the name.
  assert.equal(world.bridge.checkToolWhitelist("mcp__clay-sessions__spawn_sessions", {}), null,
    "spawn_sessions still prompts");
  assert.equal(world.bridge.checkToolWhitelist("respond_to_worker_permission_extra", args), null,
    "no prefix match");
  assert.equal(world.bridge.checkToolWhitelist("mcp__evil__respond_to_worker_permission", args), null,
    "and not under some other server");
  assert.equal(world.bridge.checkToolWhitelist("mcp__clay-sessions__evil__respond_to_worker_permission", args), null,
    "the server segment is matched exactly");
});

test("skip permissions passes the Worker through without involving the Driver", async function () {
  var world = makeWorld({ permissionMode: "bypassPermissions" });
  var resolved = await workerAsks(world);
  assert.deepEqual(resolved, {
    behavior: "allow",
    updatedInput: { file_path: "/tmp/e2e.txt", content: "x" },
  });
  assert.deepEqual(world.resumes, [], "the Driver was never asked");
  assert.deepEqual(world.humanPrompts(), [], "and no human was either");
  assert.equal(world.router.pendingCountFor(world.worker), 0, "nothing is pending");
});

test("a whitelisted read from the Worker never reaches the Driver", async function () {
  var world = makeWorld();
  var resolved = await workerAsks(world, "Read", { file_path: "/tmp/e2e.txt" });
  assert.equal(resolved.behavior, "allow");
  assert.deepEqual(world.resumes, [], "the existing whitelist resolves first");
  assert.deepEqual(world.humanPrompts(), []);
});

test("a question for the person still reaches the person, not the Driver", function () {
  var world = makeWorld();
  world.bridge.handleCanUseTool(world.worker, "AskUserQuestion", { questions: [] }, { toolUseID: "tu_q" });
  assert.deepEqual(world.resumes, [], "the Driver is not asked to answer a human's question");
  var prompts = world.humanPrompts();
  assert.equal(prompts.length, 1, "it goes to the human as before");
  assert.equal(prompts[0].msg.toolName, "AskUserQuestion");
  // It stays on the existing user-input path: a real pending permission the
  // human answers, exactly as an unpaired session would produce.
  assert.deepEqual(Object.keys(world.worker.pendingPermissions), [prompts[0].msg.requestId]);
  assert.equal(world.sm.permissionRequestIndex[prompts[0].msg.requestId], 2);
});

test("EnterPlanMode from a Worker is decided by the Driver, with no human prompt", async function () {
  var world = makeWorld();
  var decision = world.bridge.handleCanUseTool(world.worker, "EnterPlanMode", {}, { toolUseID: "tu_enter" });

  assert.deepEqual(world.humanPrompts(), [], "no plan prompt was shown to the human");
  assert.deepEqual(Object.keys(world.worker.pendingPermissions), []);
  assert.equal(world.resumes.length, 1, "the Driver was asked instead");
  assert.match(world.resumes[0].text, /Tool: EnterPlanMode/);

  await driverAnswers(world, world.resumes[0].meta.requestId, "allow");
  assert.deepEqual(await decision, { behavior: "allow", updatedInput: {} });
  assert.deepEqual(world.humanPrompts(), []);
});

test("ExitPlanMode from a Worker is decided by the Driver, with no human plan card", async function () {
  var world = makeWorld();
  var planInput = { plan: "1. read files\n2. edit them" };
  var decision = world.bridge.handleCanUseTool(world.worker, "ExitPlanMode", planInput, { toolUseID: "tu_exit" });

  // The rich human plan card is never rendered for a Worker, because no
  // permission_request is emitted for it at all.
  assert.deepEqual(world.humanPrompts(), []);
  assert.deepEqual(Object.keys(world.worker.pendingPermissions), []);
  assert.equal(world.resumes.length, 1);
  assert.match(world.resumes[0].text, /Tool: ExitPlanMode/);
  assert.match(world.resumes[0].text, /read files/, "the Driver sees the plan it is approving");

  await driverAnswers(world, world.resumes[0].meta.requestId, "allow");
  assert.deepEqual(await decision, { behavior: "allow", updatedInput: planInput },
    "the provider gets a plain allow, so it leaves plan mode normally");
  assert.deepEqual(world.humanPrompts(), []);
});

test("a Driver plan denial resolves the Worker's call as denied", async function () {
  var world = makeWorld();
  var decision = world.bridge.handleCanUseTool(world.worker, "ExitPlanMode", { plan: "risky" }, { toolUseID: "tu_x" });
  await driverAnswers(world, world.resumes[0].meta.requestId, "deny");
  var resolved = await decision;
  assert.equal(resolved.behavior, "deny");
  assert.deepEqual(world.humanPrompts(), []);
});

test("deciding plan mode for a Worker never changes session or global permission state", async function () {
  var world = makeWorld();
  var modeBefore = world.sm.currentPermissionMode;
  var decision = world.bridge.handleCanUseTool(world.worker, "ExitPlanMode", { plan: "p" }, { toolUseID: "tu_m" });
  await driverAnswers(world, world.resumes[0].meta.requestId, "allow");
  await decision;

  assert.equal(world.sm.currentPermissionMode, modeBefore, "no global mode flip");
  assert.equal(world.worker.permissionMode, undefined, "no session mode set on the Worker");
  assert.equal(world.worker.allowedTools, undefined, "no persistent tool grant");
  assert.equal(world.driver.permissionMode, undefined);
  assert.equal(world.driver.allowedTools, undefined);

  // No config_state broadcast, which is how a real mode change announces itself.
  var configFrames = world.frames.filter(function (f) { return f.msg && f.msg.type === "config_state"; });
  assert.deepEqual(configFrames, [], "nothing announced a mode change, because none happened");

  // And the next plan call asks again rather than being pre-authorized.
  var second = world.bridge.handleCanUseTool(world.worker, "ExitPlanMode", { plan: "q" }, { toolUseID: "tu_m2" });
  assert.ok(second instanceof Promise);
  assert.equal(world.resumes.length, 2, "a fresh request went to the Driver");
});

test("skip permissions still resolves plan mode before any routing", async function () {
  var world = makeWorld({ permissionMode: "bypassPermissions" });
  var enter = await world.bridge.handleCanUseTool(world.worker, "EnterPlanMode", {}, { toolUseID: "tu_be" });
  var exit = await world.bridge.handleCanUseTool(world.worker, "ExitPlanMode", { plan: "p" }, { toolUseID: "tu_bx" });
  assert.deepEqual(enter, { behavior: "allow", updatedInput: {} });
  assert.deepEqual(exit, { behavior: "allow", updatedInput: { plan: "p" } });
  assert.deepEqual(world.resumes, [], "the Driver was never asked");
  assert.deepEqual(world.humanPrompts(), []);

  // AskUserQuestion is deliberately exempt from the bypass, so it still asks.
  world.bridge.handleCanUseTool(world.worker, "AskUserQuestion", { questions: [] }, { toolUseID: "tu_bq" });
  assert.equal(world.humanPrompts().length, 1, "user input is not bypassed and not routed");
  assert.deepEqual(world.resumes, []);
});

test("a Ralph loop Worker still gets its hard plan denial, ahead of routing", async function () {
  var world = makeWorld();
  world.worker.loop = { active: true, role: "execution" };
  var resolved = await world.bridge.handleCanUseTool(world.worker, "EnterPlanMode", {}, { toolUseID: "tu_l" });
  assert.equal(resolved.behavior, "deny");
  assert.match(resolved.message, /Do not enter plan mode/);
  assert.deepEqual(world.resumes, [], "the platform denial is not something a Driver can override");
});

test("the Driver's own mutating tools still prompt the human as before", function () {
  var world = makeWorld();
  world.bridge.handleCanUseTool(world.driver, "Write", { file_path: "/tmp/d.txt" }, { toolUseID: "tu_d" });
  assert.deepEqual(world.resumes, [], "a Driver does not route its own requests to itself");
  var prompts = world.humanPrompts();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].to, 1);
  assert.equal(prompts[0].msg.toolName, "Write");
});

test("an ordinary unpaired session is completely unaffected", function () {
  var world = makeWorld();
  var plain = makeSession(7);
  world.sessions = null; // not used further
  world.bridge.handleCanUseTool(plain, "Write", { file_path: "/tmp/p.txt" }, { toolUseID: "tu_p" });
  assert.deepEqual(world.resumes, []);
  var prompts = world.humanPrompts();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].to, 7);
});

// --- No client surface ----------------------------------------------------

test("routing adds no websocket frame, schema entry, or client rendering", function () {
  var routerSource = fs.readFileSync(path.join(root, "lib/project-worker-permission.js"), "utf8");
  var schemaSource = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");

  // The router talks to the model, not to a pane.
  assert.equal(/sendToSession|sendAndRecord|worker_permission_/.test(routerSource), false,
    "the router emits no frame at all");
  assert.equal(/worker_permission/.test(schemaSource), false, "so there is nothing to register");

  // And nothing client-side mentions it, so no UI was added or needed.
  var clientHits = [];
  function walk(dir) {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var full = path.join(dir, entries[i].name);
      if (entries[i].isDirectory()) walk(full);
      else if (entries[i].isFile() && /\.(js|html|css)$/.test(entries[i].name)) {
        if (fs.readFileSync(full, "utf8").indexOf("worker_permission") !== -1) clientHits.push(full);
      }
    }
  }
  walk(path.join(root, "lib/public"));
  assert.deepEqual(clientHits, [], "no client file references the routing");

  // Coordination is the internal message plus the tool result, and the
  // reasoning for having no frame is recorded where the decision was made.
  assert.match(routerSource, /Model coordination is complete without/);
});

// --- Provider coverage ----------------------------------------------------
//
// Routing lives in the shared handleCanUseTool, so any adapter that calls its
// queryOpts.canUseTool reaches it. These assertions pin that chain per vendor
// so a future adapter change cannot silently drop a Worker out of routing.

test("the bridge routes every vendor's callback into the shared handler", function () {
  var bridgeSource = fs.readFileSync(path.join(root, "lib/sdk-bridge.js"), "utf8");
  assert.match(bridgeSource, /canUseTool: function\(toolName, input, toolOpts\) \{[\s\S]*?return handleCanUseTool\(session, permissionName, input, toolOpts\);/,
    "the single callback handed to every adapter is handleCanUseTool");
});

test("Codex permission callbacks reach the shared handler", function () {
  var src = fs.readFileSync(path.join(root, "lib/yoke/adapters/codex.js"), "utf8");
  assert.match(src, /var canUseTool = queryOpts\.canUseTool \|\| null;/);
  assert.match(src, /canUseTool\("Bash", \{ command: cmdParams\.command \}/, "shell approvals");
  assert.match(src, /canUseTool\("Edit", \{ changes: changeInfo, path: fcParams\.path \}/, "patch approvals");
  assert.match(src, /canUseTool\(permissionToolName, dynamicParams\.arguments \|\| \{\}/, "dynamic tool approvals");
  assert.match(src, /canUseTool\("mcp__" \+ \(mcpParams\.serverName \|\| "unknown"\)/, "MCP tool approvals");
  assert.match(src, /canUseTool: queryOpts\.canUseTool \|\| null,/, "and it is threaded into the handle");

  // Codex canonicalizes selected dynamic tools before asking the shared
  // permission handler. The answer tool remains bare, so its whitelist entry
  // must continue to cover that exact form.
  var canon = src.slice(src.indexOf("function canonicalDynamicPermissionToolName"));
  canon = canon.slice(0, canon.indexOf("// --- Event flattening"));
  assert.match(canon, /toolName === "send_to_partner" \|\| toolName === "read_partner"/);
  assert.equal(/respond_to_worker_permission/.test(canon), false,
    "not canonicalized, so it arrives bare");
});

test("ACP permission requests reach the shared handler", function () {
  var src = fs.readFileSync(path.join(root, "lib/yoke/acp-query-handle.js"), "utf8");
  assert.match(src, /var canUseTool = queryOpts\.canUseTool \|\| null;/);
  assert.match(src, /Promise\.resolve\(canUseTool\(permission\.toolName \|\| toolName, permission\.input \|\| input, \{\}\)\)/,
    "session/request_permission is answered through canUseTool");
  assert.match(src, /if \(!canUseTool\) \{\s*\n\s*respond\(false\);/,
    "and a missing approver denies rather than allows");
  // acp.js is the shared default adapter for every ACP profile.
  var acp = fs.readFileSync(path.join(root, "lib/yoke/adapters/acp.js"), "utf8");
  assert.match(acp, /canUseTool/, "the shared ACP adapter threads the callback");
});

test("Kiro permission requests reach the shared handler", function () {
  var src = fs.readFileSync(path.join(root, "lib/yoke/adapters/kiro.js"), "utf8");
  assert.match(src, /var canUseTool = queryOpts\.canUseTool \|\| null;/);
  assert.match(src, /canUseTool\(toolName, toolInput, \{\}\)\.then\(function\(decision\)/);
  assert.match(src, /permission request with no canUseTool callback, denying/,
    "and a missing approver denies");
  assert.match(src, /canUseTool: queryOpts\.canUseTool \|\| null,/);
});

test("Claude in-process and worker paths reach the shared handler", function () {
  var direct = fs.readFileSync(path.join(root, "lib/yoke/adapters/claude.js"), "utf8");
  var worker = fs.readFileSync(path.join(root, "lib/yoke/adapters/claude-worker.js"), "utf8");
  assert.match(direct, /canUseTool/);
  assert.match(worker, /canUseTool/);
});

test("every adapter either calls canUseTool or delegates to one that does", function () {
  // Enumerated so a newly added adapter cannot silently drop its Split
  // Workers out of routing: it will land in `uncovered` and fail here.
  var yokeDir = path.join(root, "lib/yoke/adapters");
  var helperModules = { "claude-worker-policy.js": true };
  var files = fs.readdirSync(yokeDir).filter(function (name) { return name.endsWith(".js") && !helperModules[name]; });

  var direct = [];
  var delegating = [];
  var uncovered = [];
  for (var i = 0; i < files.length; i++) {
    var src = fs.readFileSync(path.join(yokeDir, files[i]), "utf8");
    if (src.indexOf("canUseTool") !== -1) direct.push(files[i]);
    else if (/require\("\.\/acp"\)/.test(src) && /createAcpAdapter\(/.test(src)) delegating.push(files[i]);
    else uncovered.push(files[i]);
  }

  assert.deepEqual(direct.sort(), ["acp.js", "claude-worker.js", "claude.js", "codex.js", "kiro.js"],
    "these adapters answer permissions through canUseTool themselves");
  assert.deepEqual(delegating.sort(),
    ["copilot.js", "grok.js", "junie.js", "kimi.js", "opencode.js", "qwen.js"],
    "these are thin createAcpAdapter profiles, so they inherit the shared ACP handle's routing");
  assert.deepEqual(uncovered, ["antigravity.js"],
    "Antigravity is the sole adapter outside permission routing");
});

test("the ACP profiles really are thin delegations, so inheriting routing is not an assumption", function () {
  var yokeDir = path.join(root, "lib/yoke/adapters");
  var profiles = ["copilot", "grok", "junie", "kimi", "opencode", "qwen"];
  for (var i = 0; i < profiles.length; i++) {
    var src = fs.readFileSync(path.join(yokeDir, profiles[i] + ".js"), "utf8");
    assert.match(src, /var createAcpAdapter = require\("\.\/acp"\)\.createAcpAdapter;/,
      profiles[i] + " uses the shared ACP adapter");
    assert.match(src, new RegExp("createAcpAdapter\\(\"" + profiles[i] + "\", opts\\)"),
      profiles[i] + " adds no permission handling of its own");
    // No bespoke approval path that could bypass the shared handle.
    assert.equal(/request_permission|respond\(|toolPolicy/.test(src), false,
      profiles[i] + " has no independent approval path");
  }
});

test("Antigravity is outside routing because it never surfaces a prompt to Clay", function () {
  var ag = fs.readFileSync(path.join(root, "lib/yoke/adapters/antigravity.js"), "utf8");
  // Approval is delegated to the Antigravity CLI itself, so there is no
  // permission callback for Clay to route. Nothing to intercept, rather than
  // an interception that fails.
  assert.equal(/canUseTool/.test(ag), false);
  assert.match(ag, /--dangerously-skip-permissions/);
  assert.equal(/request_permission|permission_request/.test(ag), false,
    "and it raises no Clay-side permission request either");
});
