var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var isolated = fs.mkdtempSync(path.join(os.tmpdir(), "clay-muse-skills-suite-"));
process.env.HOME = isolated;
process.env.CLAY_HOME = path.join(isolated, ".clay");
process.env.CODEX_HOME = path.join(isolated, ".codex");
process.env.CLAY_CONFIG = path.join(isolated, "daemon.json");
var muse = require("../lib/yoke/adapters/muse");
var discovery = require("../lib/yoke/skill-discovery");
var createBridge = require("../lib/sdk-bridge").createSDKBridge;
test.after(function() { fs.rmSync(isolated, { recursive: true, force: true }); });
function writeSkill(root, name, body) {
  var dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: " + name + "\ndescription: Scoped " + name + "\n---\n" + body);
}
async function fixture(t, mode) {
  var dir = fs.mkdtempSync(path.join(isolated, "case-"));
  var cwd = path.join(dir, "project"), home = path.join(dir, "owner-home"), other = path.join(dir, "other-home"), log = path.join(dir, "wire.jsonl");
  fs.mkdirSync(cwd, { recursive: true }); fs.mkdirSync(home); fs.mkdirSync(other);
  writeSkill(path.join(home, ".clay", "skills"), "clay-personal", "OWNER_A_PRIVATE_INSTRUCTIONS");
  writeSkill(path.join(other, ".clay", "skills"), "clay-personal", "OWNER_B_PRIVATE_INSTRUCTIONS");
  writeSkill(path.join(cwd, ".clay", "skills"), "clay-project", "PROJECT_PRIVATE_INSTRUCTIONS");
  writeSkill(path.join(home, ".agents", "skills"), "review", "SHARED_REVIEW_INSTRUCTIONS");
  var sdk = await import("@muse-code/sdk");
  var adapter = muse.createMuseAdapter({ cwd: cwd, _binaryPath: path.join(__dirname, "fixtures", "muse-msp-host.cjs"), _shutdownTimeoutMs: 40,
    _sdk: Object.assign({}, sdk, { spawnMspConnection: function(options) {
      return sdk.spawnMspConnection(Object.assign({}, options, { command: process.execPath, args: [path.join(__dirname, "fixtures", "muse-msp-host.cjs")],
        env: Object.assign({}, options.env, { MUSE_FIXTURE_MODE: mode || "skills", MUSE_FIXTURE_LOG: log }) }));
    } }),
  });
  function wire() { return fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").slice(0, -1).map(function(line) { return JSON.parse(line); }) : []; }
  t.after(async function() {
    await adapter.shutdown();
    wire().filter(function(row) { return row.pid; }).forEach(function(row) { assert.throws(function() { process.kill(row.pid, 0); }, /ESRCH/); });
  });
  return { adapter: adapter, cwd: cwd, home: home, other: other, wire: wire, scope: function() { return { homeDir: home, isAvailable: function() { return true; } }; } };
}
async function until(fn) {
  var limit = Date.now() + 4000;
  while (!fn()) { if (Date.now() > limit) throw new Error("Fixture condition timed out"); await new Promise(function(resolve) { setTimeout(resolve, 5); }); }
}
function sent(f, method) { return f.wire().filter(function(row) { return row.method === method; }); }
function prompt(f, index) { return sent(f, "turn/start")[index].params.input.filter(function(part) { return part.type === "text"; }).map(function(part) { return part.text; }).join("\n"); }
async function drainTurn(handle, text) {
  handle.pushMessage(text);
  var events = [], iterator = handle[Symbol.asyncIterator]();
  while (true) {
    var next = await iterator.next(); if (next.done) break; events.push(next.value);
    if (["result", "error", "interrupted"].includes(next.value.yokeType)) break;
  }
  return events;
}
function spyDiscovery(t) {
  var calls = 0, original = discovery.discoverSkills;
  discovery.discoverSkills = function() { calls++; return original.apply(this, arguments); };
  t.after(function() { discovery.discoverSkills = original; });
  return function() { return calls; };
}
function bridgeFixture(f, overrides) {
  overrides = overrides || {};
  var session = Object.assign({ localId: "skills-session", ownerId: "owner-a", vendor: "muse", model: "wonder-1", history: [], messageUUIDs: [],
    pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {}, skillNames: [], responsePreview: "" }, overrides.session);
  var records = [], targeted = [], broadcast = [], live = true;
  var sm = { sessions: new Map([[session.localId, session]]), availableModels: [], saveSessionFile: function() {}, broadcastSessionList: function() {},
    sendToSession: function(target, event) { targeted.push({ session: target.localId, event: event }); },
    sendAndRecord: function(target, event) { target.history.push(event); records.push(event); } };
  var bridge = createBridge({ cwd: f.cwd, slug: "skills-fixture", adapter: f.adapter, adapters: { muse: f.adapter }, sessionManager: sm,
    send: function(event) { broadcast.push(event); }, canUseSessionTools: function() { return live; },
    getRuntimeEnv: function(target) { var home = target.ownerId === "owner-b" ? f.other : f.home;
      return Object.assign({}, process.env, { HOME: home, CODEX_HOME: path.join(home, ".codex"), CLAUDE_CONFIG_DIR: path.join(home, ".claude") }); },
  });
  return { session: session, sm: sm, bridge: bridge, records: records, targeted: targeted, broadcast: broadcast, revoke: function() { live = false; } };
}
[false, true].forEach(function(resume) {
  test("production Muse bridge delivers scoped shared catalog/references on " + (resume ? "resume" : "fresh query") + " and later turns", async function(t) {
    var f = await fixture(t), b = bridgeFixture(f, { session: { cliSessionId: resume ? "fixture-session" : null } });
    assert.equal((await b.bridge.startQueryWithAcceptance(b.session, "Use $clay-personal and $clay-project", null, null)).accepted, true);
    await until(function() { return b.records.some(function(event) { return event.type === "done"; }); });
    assert.match(prompt(f, 0), /Available shared skills/);
    assert.match(prompt(f, 0), /OWNER_A_PRIVATE_INSTRUCTIONS/); assert.match(prompt(f, 0), /PROJECT_PRIVATE_INSTRUCTIONS/);
    assert.doesNotMatch(prompt(f, 0), /OWNER_B_PRIVATE_INSTRUCTIONS/);
    assert.equal(sent(f, resume ? "session/resume" : "session/start").length, 1);
    var commands = b.targeted.filter(function(row) { return row.event.type === "slash_commands"; }).at(-1);
    assert.equal(commands.session, b.session.localId); assert.ok(commands.event.commands.includes("plugin:deploy")); assert.ok(commands.event.commands.includes("clay-personal"));
    assert.equal(commands.event.commands.includes("clay-hidden"), false);
    assert.equal(b.broadcast.some(function(event) { return event.type === "slash_commands"; }), false);
    writeSkill(path.join(f.home, ".clay", "skills"), "clay-personal", "OWNER_A_UPDATED_INSTRUCTIONS");
    assert.equal(b.bridge.pushMessage(b.session, "Again $clay-personal"), true);
    await until(function() { return b.records.filter(function(event) { return event.type === "done"; }).length === 2; });
    assert.match(prompt(f, 1), /OWNER_A_UPDATED_INSTRUCTIONS/); assert.doesNotMatch(prompt(f, 1), /OWNER_A_PRIVATE_INSTRUCTIONS/);
    assert.equal(sent(f, "turn/start")[1].params.input.some(function(part) { return part.type === "skill"; }), false);
    await b.session.queryInstance.close();
    assert.equal(fs.existsSync(path.join(f.home, ".agents", "skills", "clay-personal")), false);
  });
});
test("native slash selections and typed invocation preserve exact selectors/arguments; shared names never register natively", async function(t) {
  var f = await fixture(t), b = bridgeFixture(f);
  assert.equal((await b.bridge.startQueryWithAcceptance(b.session, "/plugin:deploy  alpha\n beta", null, null)).accepted, true);
  await until(function() { return b.records.some(function(event) { return event.type === "done"; }); });
  var handle = b.session.queryInstance;
  assert.deepEqual(sent(f, "turn/start")[0].params.input.filter(function(part) { return part.type === "skill"; }), [{ type: "skill", selector: "plugin:deploy", arguments: " alpha\n beta" }]);
  await handle.invokeSkill("review", " exact native args ");
  await until(function() { return b.records.filter(function(event) { return event.type === "done"; }).length === 2; });
  assert.deepEqual(sent(f, "turn/start")[1].params.input.filter(function(part) { return part.type === "skill"; }), [{ type: "skill", selector: "review", arguments: " exact native args " }]);
  assert.equal(f.wire().some(function(row) { return /skill\/(import|setActivation)/.test(row.method || ""); }), false);
  await assert.rejects(handle.invokeSkill("clay-hidden", ""), /live session catalog/); await handle.close();
});
test("slash collisions prefer native selectors while explicit dollar references always use shared instructions", async function(t) {
  var f = await fixture(t), handle = await f.adapter.createQuery({ cwd: f.cwd, skillOptions: f.scope() });
  await drainTurn(handle, "/review native arguments");
  assert.equal(sent(f, "turn/start")[0].params.input[1].selector, "review"); assert.doesNotMatch(prompt(f, 0), /SHARED_REVIEW_INSTRUCTIONS/);
  await drainTurn(handle, "Use $review");
  assert.match(prompt(f, 1), /SHARED_REVIEW_INSTRUCTIONS/); assert.equal(sent(f, "turn/start")[1].params.input.length, 1);
  await drainTurn(handle, "/clay-personal shared arguments");
  assert.match(prompt(f, 2), /OWNER_A_PRIVATE_INSTRUCTIONS/); assert.equal(sent(f, "turn/start")[2].params.input.length, 1);
  await handle.close();
});
["unscoped", "disabled", "skipped", "foreign-scope", "read-only"].forEach(function(kind) {
  test(kind + " queries never discover/read shared skills or list native personal skills", async function(t) {
    var f = await fixture(t), calls = spyDiscovery(t);
    var options = { cwd: f.cwd };
    if (kind !== "unscoped") options.skillOptions = f.scope();
    if (kind === "disabled") options.skillOptions.disable = true;
    if (kind === "skipped") options.skipSkills = true;
    if (kind === "foreign-scope") options.skillOptions.isAvailable = function() { return false; };
    if (kind === "read-only") options.adapterOptions = { MUSE: { readOnly: true } };
    var handle = await f.adapter.createQuery(options); var events = await drainTurn(handle, "$clay-personal");
    assert.equal(events.at(-1).yokeType, "result"); assert.equal(calls(), 0); assert.equal(sent(f, "skill/list").length, 0);
    assert.doesNotMatch(prompt(f, 0), /PRIVATE_INSTRUCTIONS|Available shared skills/);
    await assert.rejects(handle.listSkills(), /authorized Clay query scope/); await handle.close();
  });
});
test("title generation never discovers personal skills even for explicit references", async function(t) {
  var f = await fixture(t), calls = spyDiscovery(t);
  await f.adapter.generateTitle(["$clay-personal"], { cwd: f.cwd });
  assert.equal(calls(), 0); assert.equal(sent(f, "skill/list").length, 0); assert.doesNotMatch(prompt(f, 0), /PRIVATE_INSTRUCTIONS|Available shared skills/);
});
test("independent owner queries on a reused adapter never share catalogs or instruction contents", async function(t) {
  var f = await fixture(t), a = bridgeFixture(f), b = bridgeFixture(f, { session: { ownerId: "owner-b", localId: "owner-b-session" } });
  for (var bridge of [a, b]) {
    await bridge.bridge.startQueryWithAcceptance(bridge.session, "$clay-personal", null, null);
    await until(function() { return bridge.records.some(function(event) { return event.type === "done"; }); });
    await bridge.session.queryInstance.close();
  }
  assert.match(prompt(f, 0), /OWNER_A_PRIVATE_INSTRUCTIONS/); assert.doesNotMatch(prompt(f, 0), /OWNER_B_PRIVATE_INSTRUCTIONS/);
  assert.match(prompt(f, 1), /OWNER_B_PRIVATE_INSTRUCTIONS/); assert.doesNotMatch(prompt(f, 1), /OWNER_A_PRIVATE_INSTRUCTIONS/);
});
["foreign-input", "shared-session", "delegated", "foreign-history"].forEach(function(kind) {
  test("production bridge excludes personal skill scope for " + kind, async function(t) {
    var f = await fixture(t), calls = spyDiscovery(t), session = {};
    if (kind === "foreign-input") session._mcpForeignInput = true;
    if (kind === "shared-session") session.sessionVisibility = "shared";
    if (kind === "delegated") session.delegated = true;
    if (kind === "foreign-history") session.history = [{ type: "user_message", from: "someone-else", text: "Foreign input" }];
    var b = bridgeFixture(f, { session: session });
    await b.bridge.startQueryWithAcceptance(b.session, "$clay-personal", null, null);
    await until(function() { return b.records.some(function(event) { return event.type === "done"; }); });
    assert.equal(calls(), 0); assert.equal(sent(f, "skill/list").length, 0); assert.doesNotMatch(prompt(f, 0), /PRIVATE_INSTRUCTIONS|Available shared skills/);
    await b.session.queryInstance.close();
  });
});
["owner", "foreign", "generation", "permission", "deleted"].forEach(function(kind) {
  test("live " + kind + " changes retire scoped skill delivery before a subsequent turn", async function(t) {
    var f = await fixture(t), calls = spyDiscovery(t), b = bridgeFixture(f);
    await b.bridge.startQueryWithAcceptance(b.session, "$clay-personal", null, null);
    await until(function() { return b.records.some(function(event) { return event.type === "done"; }); });
    var reads = calls(), nativeReads = sent(f, "skill/list").length;
    if (kind === "owner") b.session.ownerId = "owner-b";
    if (kind === "foreign") b.session._mcpForeignInput = true;
    if (kind === "generation") b.session._sdkQueryGeneration++;
    if (kind === "permission") b.revoke();
    if (kind === "deleted") b.sm.sessions.delete(b.session.localId);
    var handle = b.session.queryInstance;
    handle.pushMessage("Again $clay-personal");
    await until(function() { return f.adapter.clients.size === 0; });
    assert.equal(sent(f, "turn/start").length, 1); assert.equal(sent(f, "skill/list").length, nativeReads); assert.equal(calls(), reads);
  });
});
test("Stop during native catalog lookup prevents discovery, referenced reads and turn effects", async function(t) {
  var f = await fixture(t, "skills-hang"), calls = spyDiscovery(t);
  var handle = await f.adapter.createQuery({ cwd: f.cwd, skillOptions: f.scope() });
  handle.pushMessage("$clay-personal"); await until(function() { return sent(f, "skill/list").length === 1; });
  await handle.abort();
  var events = []; for await (var event of handle) events.push(event);
  assert.deepEqual(events, [{ yokeType: "interrupted" }]); assert.equal(calls(), 0); assert.equal(sent(f, "turn/start").length, 0);
});
test("native selector changes and missing skills reject before native turn admission", async function(t) {
  var f = await fixture(t, "skills-change"), handle = await f.adapter.createQuery({ cwd: f.cwd, skillOptions: f.scope() });
  await drainTurn(handle, "/review first");
  await assert.rejects(handle.invokeSkill("review", "stale native"), /live session catalog/);
  await assert.rejects(handle.invokeSkill("missing-skill", ""), /live session catalog/);
  assert.equal(sent(f, "turn/start").length, 1);
  await drainTurn(handle, "/review now shared");
  assert.match(prompt(f, 1), /SHARED_REVIEW_INSTRUCTIONS/); assert.equal(sent(f, "turn/start")[1].params.input.length, 1);
  var events = await drainTurn(handle, "/missing-skill argument");
  assert.equal(events.at(-1).yokeType, "error"); assert.match(events.at(-1).text, /not in the current Muse or shared catalog/);
  assert.equal(sent(f, "turn/start").length, 2); await handle.close();
});
test("Clay-only names in generic vendor roots are neither delivered nor installed", async function(t) {
  var f = await fixture(t);
  writeSkill(path.join(f.home, ".agents", "skills"), "clay-rogue", "UNAPPROVED_GENERIC_CLAY_BODY");
  var handle = await f.adapter.createQuery({ cwd: f.cwd, skillOptions: f.scope() });
  var events = await drainTurn(handle, "Use $clay-rogue");
  assert.equal(events.at(-1).yokeType, "result"); assert.doesNotMatch(prompt(f, 0), /UNAPPROVED_GENERIC_CLAY_BODY/);
  var catalog = events.find(function(event) { return event.yokeType === "commands_changed"; });
  assert.equal(catalog.skills.includes("clay-rogue"), false);
  assert.equal(fs.existsSync(path.join(f.home, ".clay", "skills", "clay-rogue")), false);
  assert.equal(fs.existsSync(path.join(f.home, ".agents", "skills", "clay-rogue", "SKILL.md")), true);
  await handle.close();
});
test("mapped OS-owner refusal occurs before any skill discovery or SDK process", async function(t) {
  var f = await fixture(t), calls = spyDiscovery(t);
  await assert.rejects(f.adapter.createQuery({ cwd: f.cwd, linuxUser: 'foreign-os-owner', skillOptions: f.scope() }), /OS-owner isolation/);
  assert.equal(calls(), 0); assert.equal(f.wire().length, 0);
});
test("verified sharing capability does not discover skills during unscoped adapter initialization", async function(t) {
  var f = await fixture(t), calls = spyDiscovery(t);
  var ready = await f.adapter.init();
  assert.equal(ready.capabilities.skillSharing, true); assert.deepEqual(ready.skills, []); assert.deepEqual(ready.slashCommands, []);
  assert.equal(calls(), 0); assert.equal(sent(f, "skill/list").length, 0);
});
test("production slash catalog refresh replaces removed shared entries without losing native collisions", async function(t) {
  var f = await fixture(t), b = bridgeFixture(f);
  await b.bridge.startQueryWithAcceptance(b.session, "Begin", null, null);
  await until(function() { return b.records.some(function(event) { return event.type === "done"; }); });
  fs.rmSync(path.join(f.home, ".clay", "skills", "clay-personal"), { recursive: true });
  fs.rmSync(path.join(f.home, ".agents", "skills", "review"), { recursive: true });
  writeSkill(path.join(f.home, ".clay", "skills"), "clay-new", "NEW_SHARED_INSTRUCTIONS");
  b.bridge.pushMessage(b.session, "$clay-new");
  await until(function() { return b.records.filter(function(event) { return event.type === "done"; }).length === 2; });
  assert.match(prompt(f, 1), /NEW_SHARED_INSTRUCTIONS/); assert.doesNotMatch(prompt(f, 1), /OWNER_A_PRIVATE_INSTRUCTIONS/);
  assert.equal(b.session.skillNames.includes("clay-personal"), false);
  var commands = b.targeted.filter(function(row) { return row.event.type === "slash_commands"; }).at(-1).event.commands;
  assert.ok(commands.includes("clay-new")); assert.ok(commands.includes("review")); assert.equal(commands.includes("clay-personal"), false);
  await b.session.queryInstance.close();
});
test("a referenced skill that becomes unreadable cannot silently admit a turn without its instructions", async function(t) {
  var f = await fixture(t), scope = f.scope(), reads = 0;
  var referencedFile = fs.realpathSync(path.join(f.home, ".clay", "skills", "clay-personal", "SKILL.md"));
  scope.readFile = function(file) {
    if (file === referencedFile && ++reads > 1) throw new Error("Fixture file removed after discovery");
    return fs.readFileSync(file, "utf8");
  };
  var handle = await f.adapter.createQuery({ cwd: f.cwd, skillOptions: scope });
  var events = await drainTurn(handle, "$clay-personal");
  assert.equal(events.at(-1).yokeType, "error"); assert.match(events.at(-1).text, /instructions are unavailable/);
  assert.equal(reads, 2); assert.equal(sent(f, "turn/start").length, 0); await handle.close();
});
test("scope revocation during a discovery read prevents catalog/content delivery and turn admission", async function(t) {
  var f = await fixture(t), scope = f.scope(), allowed = true;
  var scopedFile = fs.realpathSync(path.join(f.home, ".clay", "skills", "clay-personal", "SKILL.md"));
  scope.isAvailable = function() { return allowed; };
  scope.readFile = function(file) {
    var content = fs.readFileSync(file, "utf8");
    if (file === scopedFile) allowed = false;
    return content;
  };
  var handle = await f.adapter.createQuery({ cwd: f.cwd, skillOptions: scope });
  var events = await drainTurn(handle, "$clay-personal");
  assert.equal(events.at(-1).yokeType, "error"); assert.equal(events.some(function(event) { return event.yokeType === "commands_changed"; }), false);
  assert.equal(sent(f, "turn/start").length, 0); await handle.close();
});
