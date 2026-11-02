// Personal Agent behavior policy: schema, per-account persistence, the
// authenticated settings route and the runtime gate. No provider, account or
// real storage is touched: every dependency is injected.
var test = require("node:test");
var assert = require("node:assert/strict");
var EventEmitter = require("node:events");

var schema = require("../lib/agent-behavior-schema");
var attachPrefs = require("../lib/users-agent-behavior-preferences").attachAgentBehaviorPreferences;
var attachSettings = require("../lib/server-agent-behavior-settings").attachAgentBehaviorSettings;
var attachGate = require("../lib/agent-behavior-gate").attachAgentBehavior;

var ALL_MODE_IDS = schema.SETTINGS.filter(function (s) { return s.type === "mode"; }).map(function (s) { return s.id; });

function prefsHarness(initial, failSave) {
  var data = { users: initial || [{ id: "u1" }, { id: "u2" }] };
  var saves = 0;
  var prefs = attachPrefs({
    loadUsers: function () { return JSON.parse(JSON.stringify(data)); },
    saveUsers: function (next) { if (failSave && failSave()) throw new Error("disk full"); data = next; saves++; },
  });
  return { prefs: prefs, data: function () { return data; }, saves: function () { return saves; } };
}

function request(handler, method, url, body) {
  return new Promise(function (resolve) {
    var req = new EventEmitter();
    req.method = method;
    var res = { status: null, headers: null, body: "", writeHead: function (s, h) { this.status = s; this.headers = h; }, end: function (b) { this.body = b || ""; resolve({ status: this.status, json: this.body ? JSON.parse(this.body) : null }); } };
    var handled = handler.handleRequest(req, res, url);
    if (!handled) { resolve({ handled: false }); return; }
    if (method === "PUT") setImmediate(function () { if (body !== undefined) req.emit("data", typeof body === "string" ? body : JSON.stringify(body)); req.emit("end"); });
  });
}

test("defaults preserve existing behavior and every mode setting is typed", function () {
  var defaults = schema.defaults();
  ALL_MODE_IDS.forEach(function (id) { assert.equal(defaults[id], "auto", id); });
  assert.equal(defaults.issueLinkedNotes, true);
  assert.deepEqual(schema.normalize(undefined), defaults);
  assert.deepEqual(schema.normalize("junk"), defaults);
  assert.deepEqual(schema.normalize([1, 2]), defaults);
  schema.SETTINGS.forEach(function (setting) {
    assert.ok(setting.label && setting.description, setting.id);
    if (setting.type === "mode") {
      ["off", "request", "auto"].forEach(function (mode) {
        assert.ok(setting.modes[mode].consequence.length > 10, setting.id + ":" + mode);
        assert.ok(setting.modes[mode].example.length > 5, setting.id + ":" + mode + " example");
      });
    }
  });
  var text = JSON.stringify(schema.catalog());
  assert.doesNotMatch(text, new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']'), "catalog text must not contain en or em dashes");
});

test("normalize drops unknown keys and invalid values; validateChanges is strict", function () {
  var out = schema.normalize({ meUse: "off", notes: "sometimes", issues: 3, issueLinkedNotes: "yes", rogue: "x", __proto__: { logs: "off" } });
  assert.equal(out.meUse, "off");
  assert.equal(out.notes, "auto");
  assert.equal(out.issues, "auto");
  assert.equal(out.issueLinkedNotes, true);
  assert.equal(out.logs, "auto");
  assert.equal(out.rogue, undefined);
  assert.deepEqual(schema.validateChanges({ meUse: "request" }), { value: { meUse: "request" } });
  assert.match(schema.validateChanges({ meUse: "maybe" }).error, /Invalid value/);
  assert.match(schema.validateChanges({ rogue: "off" }).error, /Unknown setting/);
  assert.match(schema.validateChanges({ issueLinkedNotes: "off" }).error, /Invalid value/);
  assert.match(schema.validateChanges({ meUse: true }).error, /Invalid value/);
  assert.match(schema.validateChanges({}).error, /at least one/);
  assert.match(schema.validateChanges(null).error, /object/);
  assert.match(schema.validateChanges(["meUse"]).error, /object/);
  assert.match(schema.validateChanges({ constructor: "off" }).error, /Unknown setting/);
});

test("the linked-note checkbox is only effective with Notes Auto and Issues not Off", function () {
  assert.equal(schema.effective({}).issueLinkedNotes, true);
  assert.equal(schema.effective({ notes: "request" }).issueLinkedNotes, false);
  assert.equal(schema.effective({ notes: "off" }).issueLinkedNotes, false);
  assert.equal(schema.effective({ issues: "off" }).issueLinkedNotes, false);
  assert.equal(schema.effective({ issues: "request", notes: "auto" }).issueLinkedNotes, true);
  assert.equal(schema.effective({ issueLinkedNotes: false }).issueLinkedNotes, false);
});

test("persistence is per account, merges changes and ignores malformed stored values", function () {
  var fixture = prefsHarness([{ id: "u1" }, { id: "u2", agentBehavior: { logs: "off", bogus: 1, notes: "nope" } }]);
  assert.deepEqual(fixture.prefs.getAgentBehavior("u1"), schema.defaults());
  assert.equal(fixture.prefs.getAgentBehavior("u2").logs, "off");
  assert.equal(fixture.prefs.getAgentBehavior("u2").notes, "auto");
  assert.deepEqual(fixture.prefs.getAgentBehavior("missing"), schema.defaults());
  var first = fixture.prefs.updateAgentBehavior("u1", { meUse: "off" });
  assert.equal(first.ok, true);
  assert.equal(fixture.prefs.updateAgentBehavior("u1", { issues: "request" }).policy.meUse, "off", "a second tab's change keeps the first");
  assert.equal(fixture.prefs.getAgentBehavior("u2").meUse, "auto", "another account is untouched");
  assert.deepEqual(fixture.data().users[1].agentBehavior, { logs: "off", bogus: 1, notes: "nope" }, "foreign record is not rewritten");
  var cleaned = fixture.prefs.updateAgentBehavior("u2", { sketch: "off" });
  assert.deepEqual(cleaned.policy.sketch, "off");
  assert.equal(fixture.data().users[1].agentBehavior.bogus, undefined, "malformed values are dropped on the next explicit save");
  assert.match(fixture.prefs.updateAgentBehavior("u1", { meUse: "x" }).error, /Invalid/);
  assert.match(fixture.prefs.updateAgentBehavior("nobody", { meUse: "off" }).error, /not found/);
});

test("a failed write reports an error and leaves the stored policy unchanged", function () {
  var failing = false;
  var fixture = prefsHarness(null, function () { return failing; });
  fixture.prefs.updateAgentBehavior("u1", { meUse: "off" });
  failing = true;
  var result = fixture.prefs.updateAgentBehavior("u1", { meUse: "request" });
  assert.match(result.error, /Could not save/);
  assert.equal(fixture.prefs.getAgentBehavior("u1").meUse, "off");
});

function multiHandler(fixture, user, hooks) {
  return attachSettings({
    users: { isMultiUser: function () { return true; }, getAgentBehavior: fixture.prefs.getAgentBehavior, updateAgentBehavior: fixture.prefs.updateAgentBehavior },
    getMultiUserFromReq: function () { return user; },
    opts: {},
    onAgentBehaviorChanged: hooks && hooks.changed,
  });
}

test("the route requires an authenticated owner and answers only after persistence", async function () {
  var fixture = prefsHarness();
  var changed = [];
  var handler = multiHandler(fixture, { id: "u1" }, { changed: function (id, policy) { changed.push([id, policy.meUse]); } });
  var got = await request(handler, "GET", "/api/user/agent-behavior");
  assert.equal(got.status, 200);
  assert.equal(got.json.policy.meUse, "auto");
  assert.equal(got.json.catalog.settings.length, schema.SETTINGS.length);
  var put = await request(handler, "PUT", "/api/user/agent-behavior", { changes: { meUse: "off" }, requestId: "r1" });
  assert.equal(put.status, 200);
  assert.equal(put.json.policy.meUse, "off");
  assert.equal(put.json.requestId, "r1");
  assert.equal(fixture.prefs.getAgentBehavior("u1").meUse, "off", "persisted before the acknowledgement");
  assert.deepEqual(changed, [["u1", "off"]]);
  var anonymous = await request(multiHandler(fixture, null), "GET", "/api/user/agent-behavior");
  assert.equal(anonymous.status, 401);
  assert.equal((await request(multiHandler(fixture, null), "PUT", "/api/user/agent-behavior", { changes: { meUse: "off" } })).status, 401);
  assert.equal(fixture.prefs.getAgentBehavior("u2").meUse, "auto");
});

test("the route rejects malformed, foreign-key and oversized input without saving", async function () {
  var fixture = prefsHarness();
  var handler = multiHandler(fixture, { id: "u1" });
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", "{not json")).status, 400);
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", { changes: { rogue: "off" } })).status, 400);
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", { changes: { meUse: "nope" } })).status, 400);
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", { changes: [] })).status, 400);
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", { userId: "u2", changes: { meUse: "off" } })).json.policy.meUse, "off");
  assert.equal(fixture.prefs.getAgentBehavior("u2").meUse, "auto", "the target account always comes from the session, never the body");
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", "x".repeat(20000))).status, 413);
  var unrelated = await request(handler, "POST", "/api/user/agent-behavior");
  assert.equal(unrelated.handled, false);
});

test("authentication revoked, replaced or switched while the body arrives is refused before persistence", async function () {
  var fixture = prefsHarness();
  var current = { id: "u1" };
  var handler = attachSettings({
    users: { isMultiUser: function () { return true; }, getAgentBehavior: fixture.prefs.getAgentBehavior, updateAgentBehavior: fixture.prefs.updateAgentBehavior },
    getMultiUserFromReq: function () { return current; }, opts: {},
  });
  async function attempt(next) {
    current = { id: "u1" };
    return new Promise(function (resolve) {
      var req = new EventEmitter(); req.method = "PUT";
      var res = { writeHead: function (s) { this.status = s; }, end: function (b) { resolve({ status: this.status, json: JSON.parse(b) }); } };
      handler.handleRequest(req, res, "/api/user/agent-behavior");
      setImmediate(function () { current = next; req.emit("data", JSON.stringify({ changes: { notes: "off" } })); req.emit("end"); });
    });
  }
  assert.equal((await attempt(null)).status, 401, "revoked mid-request");
  assert.equal((await attempt({ id: "u2" })).status, 401, "replaced by another account mid-request");
  assert.equal(fixture.prefs.getAgentBehavior("u1").notes, "auto");
  assert.equal(fixture.prefs.getAgentBehavior("u2").notes, "auto");
  assert.equal((await attempt({ id: "u1" })).status, 200, "an unchanged identity still saves");
  var mode = { multi: true };
  var switching = attachSettings({
    users: { isMultiUser: function () { return mode.multi; }, getAgentBehavior: fixture.prefs.getAgentBehavior, updateAgentBehavior: fixture.prefs.updateAgentBehavior },
    getMultiUserFromReq: function () { return { id: "u1" }; }, opts: { onUpdateAgentBehavior: function () { return { ok: true, policy: schema.defaults() }; } },
  });
  var result = await new Promise(function (resolve) {
    var req = new EventEmitter(); req.method = "PUT";
    var res = { writeHead: function (s) { this.status = s; }, end: function () { resolve(this.status); } };
    switching.handleRequest(req, res, "/api/user/agent-behavior");
    setImmediate(function () { mode.multi = false; req.emit("data", JSON.stringify({ changes: { notes: "off" } })); req.emit("end"); });
  });
  assert.equal(result, 401, "account mode changed mid-request");
});

test("a storage failure returns 500 and never acknowledges the change", async function () {
  var failing = false;
  var fixture = prefsHarness(null, function () { return failing; });
  var handler = multiHandler(fixture, { id: "u1" });
  failing = true;
  var res = await request(handler, "PUT", "/api/user/agent-behavior", { changes: { logs: "off" } });
  assert.equal(res.status, 500);
  assert.match(res.json.error, /Could not save/);
  assert.equal(fixture.prefs.getAgentBehavior("u1").logs, "auto");
});

test("a solo server stores the policy through the daemon callbacks", async function () {
  var stored = { agentBehavior: undefined };
  var handler = attachSettings({
    users: { isMultiUser: function () { return false; } },
    getMultiUserFromReq: function () { return null; },
    opts: {
      onGetDaemonConfig: function () { return { agentBehavior: schema.normalize(stored.agentBehavior) }; },
      onUpdateAgentBehavior: function (changes) {
        var checked = schema.validateChanges(changes);
        if (checked.error) return { error: checked.error };
        stored.agentBehavior = Object.assign({}, schema.explicit(stored.agentBehavior), checked.value);
        return { ok: true, policy: schema.normalize(stored.agentBehavior) };
      },
    },
  });
  assert.equal((await request(handler, "GET", "/api/user/agent-behavior")).json.policy.notes, "auto");
  var res = await request(handler, "PUT", "/api/user/agent-behavior", { changes: { notes: "off" } });
  assert.equal(res.json.policy.notes, "off");
  assert.equal((await request(handler, "GET", "/api/user/agent-behavior")).json.policy.notes, "off");
  assert.equal((await request(handler, "PUT", "/api/user/agent-behavior", { changes: { rogue: 1 } })).status, 400);
  var noWriter = attachSettings({ users: { isMultiUser: function () { return false; } }, getMultiUserFromReq: function () { return null; }, opts: {} });
  assert.equal((await request(noWriter, "PUT", "/api/user/agent-behavior", { changes: { notes: "off" } })).status, 400);
});

// --- gate ---------------------------------------------------------------

function tool(name, extra) {
  var calls = [];
  return Object.assign({ name: name, description: "Original " + name + ".", inputSchema: {}, calls: calls, handler: function (args) { calls.push(args); return Promise.resolve({ content: [{ type: "text", text: "ran " + name }] }); } }, extra || {});
}

function gateFor(policyRef, options) {
  var opts = options || {};
  return attachGate({
    isMate: opts.isMate === true,
    isMultiUser: function () { return opts.multi !== false; },
    getPolicy: function (ownerId) { return policyRef.byOwner ? policyRef.byOwner[ownerId] : policyRef.value; },
  });
}

var DRIVER = { localId: 1, ownerId: "u1" };

test("with no stored choice every tool keeps its text and handler result", async function () {
  var gate = gateFor({ value: undefined });
  var defs = [tool("create_note_x"), tool("write_note"), tool("create_log"), tool("shared_browser")];
  var out = gate.filterTools(DRIVER, defs);
  assert.deepEqual(out.map(function (d) { return d.name; }), defs.map(function (d) { return d.name; }));
  out.forEach(function (d, i) { assert.equal(d.description, defs[i].description); });
  assert.equal((await out[1].handler({ a: 1 })).content[0].text, "ran write_note");
  assert.equal(gate.notice(DRIVER), "", "no override block when nothing is restricted");
  assert.deepEqual(gate.excludedSkills(DRIVER), []);
});

test("Off removes the tools, refuses a handler held from before, and names the setting", async function () {
  var policy = { value: {} };
  var gate = gateFor(policy);
  var held = gate.filterTools(DRIVER, [tool("write_note"), tool("list_notes"), tool("create_issue")]);
  assert.equal(held.length, 3);
  policy.value = { notes: "off" };
  assert.deepEqual(gate.filterTools(DRIVER, [tool("write_note"), tool("list_notes"), tool("create_issue")]).map(function (d) { return d.name; }), ["create_issue"]);
  var refused = await held[0].handler({ text: "late" });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Sticky Notes/);
  assert.equal((await held[2].handler({})).isError, undefined, "other settings are unaffected");
  var bridge = gate.callRefusal(DRIVER, "write_note");
  assert.equal(bridge.isError, true);
  assert.equal(gate.callRefusal(DRIVER, "create_issue"), null);
  assert.equal(gate.callRefusal(DRIVER, "unmapped_tool"), null);
  assert.match(gate.notice(DRIVER), /Off, do not do these: using Sticky Notes/);
});

test("On request keeps the tool, prefixes its description and adds the notice", async function () {
  var gate = gateFor({ value: { issues: "request", sharedBrowser: "request" } });
  var defs = gate.filterTools(DRIVER, [tool("create_issue"), tool("shared_browser"), tool("write_note")]);
  assert.match(defs[0].description, /^\[Personal setting: Issues is On request\./);
  assert.match(defs[0].description, /Original create_issue\.$/);
  assert.match(defs[1].description, /Shared Browser is On request/);
  assert.equal(defs[2].description, "Original write_note.");
  assert.equal((await defs[0].handler({})).isError, undefined, "On request is guidance, not a wording check");
  assert.match(gate.notice(DRIVER), /On request, only when the user's message asks for it: using Project Issues; using the Shared Browser/);
});

test("GitHub and Linear links are independent; Linear read tools stay when Linear links are Off", async function () {
  var all = function () { return [tool("link_session_github"), tool("get_session_github"), tool("link_session_linear"), tool("unlink_session_linear"), tool("read_linear_issue"), tool("search_linear_issues")]; };
  var linearOff = gateFor({ value: { linearLinks: "off" } }).filterTools(DRIVER, all());
  assert.deepEqual(linearOff.map(function (d) { return d.name; }), ["link_session_github", "get_session_github", "read_linear_issue", "search_linear_issues"]);
  assert.match(linearOff[2].description, /Linear session links is Off/);
  assert.equal(linearOff[0].description, "Original link_session_github.", "GitHub is untouched by the Linear setting");
  assert.equal((await linearOff[2].handler({})).isError, undefined);
  var githubOff = gateFor({ value: { githubLinks: "off" } }).filterTools(DRIVER, all());
  assert.deepEqual(githubOff.map(function (d) { return d.name; }), ["link_session_linear", "unlink_session_linear", "read_linear_issue", "search_linear_issues"]);
  var request = gateFor({ value: { linearLinks: "request" } });
  assert.match(request.filterTools(DRIVER, all())[2].description, /Linear session links is On request/);
  assert.match(request.notice(DRIVER), /linking this session to Linear issues/);
  assert.doesNotMatch(request.notice(DRIVER), /GitHub/);
});

test("the learning setting adds its own prefix to log writes without removing the tools", function () {
  var gate = gateFor({ value: { logsLearning: "off" } });
  var defs = gate.filterTools(DRIVER, [tool("create_log"), tool("update_log"), tool("read_log")]);
  assert.equal(defs.length, 3);
  assert.match(defs[0].description, /Learning records is Off/);
  assert.match(defs[1].description, /Learning records is Off/);
  assert.equal(defs[2].description, "Original read_log.");
});

test("policy is per owner and Mate or curator sessions never read it", async function () {
  var policies = { byOwner: { u1: { meUse: "off" }, u2: {} } };
  var gate = gateFor(policies);
  assert.equal(gate.filterTools({ localId: 1, ownerId: "u1" }, [tool("search_user_knowledge")]).length, 0);
  assert.equal(gate.filterTools({ localId: 2, ownerId: "u2" }, [tool("search_user_knowledge")]).length, 1);
  assert.equal(gate.filterTools({ localId: 3, ownerId: null }, [tool("search_user_knowledge")]).length, 1, "an ownerless session in account mode is outside the feature");
  assert.equal(gate.filterTools({ localId: 4, ownerId: "u1", youCurator: true }, [tool("search_user_knowledge")]).length, 1);
  var mate = gateFor({ value: { meUse: "off", notes: "off", logs: "off" } }, { isMate: true });
  var defs = [tool("search_user_knowledge"), tool("write_note"), tool("create_log")];
  assert.strictEqual(mate.filterTools(DRIVER, defs), defs, "Mate catalogs are returned untouched");
  assert.equal(mate.notice(DRIVER), "");
  assert.equal(mate.view(DRIVER).active, false);
  assert.equal(mate.view(DRIVER).mode("notes"), "auto");
  assert.equal(mate.callRefusal(DRIVER, "write_note"), null);
  assert.deepEqual(mate.excludedSkills(DRIVER), []);
  assert.strictEqual(mate.gateAdapter({ createToolServer: function () {} }, DRIVER).createToolServer.length, 0);
});

test("solo mode reads the single policy for every session", function () {
  var gate = gateFor({ value: { sketch: "off" } }, { multi: false });
  assert.deepEqual(gate.filterTools({ localId: 1, ownerId: null }, [tool("present_wireframe"), tool("present_markdown_edit")]).map(function (d) { return d.name; }), ["present_markdown_edit"]);
  assert.deepEqual(gate.excludedSkills({ localId: 1 }), ["clay-sketch"]);
});

test("a policy lookup that throws falls back to today's behavior instead of failing the turn", function () {
  var gate = attachGate({ isMate: false, isMultiUser: function () { return true; }, getPolicy: function () { throw new Error("storage unavailable"); } });
  assert.equal(gate.filterTools(DRIVER, [tool("write_note")]).length, 1);
});

test("gateAdapter mounts only kept tools and drops a server whose tools are all off", function () {
  var mounted = [];
  var adapter = { vendor: "x", createToolServer: function (spec) { mounted.push(spec); return { name: spec.name, tools: spec.tools }; } };
  var gate = gateFor({ value: { notes: "off", issues: "off" } });
  var gated = gate.gateAdapter(adapter, DRIVER);
  assert.equal(gated.vendor, "x");
  assert.equal(gated.createToolServer({ name: "clay-notes", tools: [tool("write_note"), tool("list_notes")] }), null);
  var mixed = gated.createToolServer({ name: "clay-documents", tools: [tool("present_markdown_edit")] });
  assert.equal(mixed.tools.length, 1);
  assert.equal(gated.createToolServer({ name: "empty", tools: [] }).tools.length, 0);
  assert.equal(mounted.length, 2);
});

test("bridge listings drop Off tools and prefix On request tools", function () {
  var gate = gateFor({ value: { notes: "off", continuation: "request" } });
  var list = [
    { server: "clay-notes", name: "write_note", description: "d", inputSchema: {} },
    { server: "clay-sessions", name: "propose_driver_continuation", description: "d", inputSchema: {} },
    { server: "x", name: "other", description: "d", inputSchema: {} },
  ];
  var out = gate.filterBridgeTools(DRIVER, list);
  assert.deepEqual(out.map(function (t) { return t.name; }), ["propose_driver_continuation", "other"]);
  assert.match(out[0].description, /Continuation proposals is On request/);
  assert.equal(out[1], list[2]);
});

test("autoPrompt includes module text only for Auto", function () {
  var policy = { value: {} };
  var gate = gateFor(policy);
  function build() { return "TEXT"; }
  assert.equal(gate.autoPrompt(DRIVER, "issues", build), "TEXT");
  policy.value = { issues: "request" };
  assert.equal(gate.autoPrompt(DRIVER, "issues", build), "");
  policy.value = { issues: "off" };
  assert.equal(gate.autoPrompt(DRIVER, "issues", build), "");
});

test("every governed tool name is covered by a catalog setting", function () {
  var gateModule = require("../lib/agent-behavior-gate");
  var ids = {};
  schema.SETTINGS.forEach(function (s) { ids[s.id] = true; });
  Object.keys(gateModule.TOOL_SETTING).forEach(function (name) { assert.ok(ids[gateModule.TOOL_SETTING[name].id], name); });
});
