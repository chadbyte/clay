var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var control = require("../lib/clay-vendor-usage");
var tools = require("../lib/clay-product-control-tools");
var attachVendorUsageOverview = require("../lib/vendor-usage-overview").attachVendorUsageOverview;
var usageService = require("../lib/vendor-usage-service");
var metrics = require("../lib/vendor-usage-metrics");

function fixture(options) {
  options = options || {};
  var calls = [];
  var overviewCtx = {
    slug: "alpha", sm: { sessions: new Map(), installedVendors: ["codex", "kimi", "antigravity"] }, clients: new Set(),
    usersModule: { isMultiUser: function () { return options.multiUser === true; }, findUserById: function (id) { return { id: id }; }, canAccessProject: function () { return true; } },
    getProjectAccess: function () { return {}; }, sendTo: function () {},
    usageService: usageService.createUsageService({
      multiUser: function () { return options.multiUser === true; }, osUsersEnabled: function () { return !!options.osUsers; },
      getAdapter: function () { return {}; },
      readers: {
        codex: function (context) { calls.push({ vendor: "codex", linuxUser: context.linuxUser }); return Promise.resolve({ metrics: [metrics.metric("percent", "p", "P", { usedPercent: 12 })] }); },
        kimi: function () { calls.push({ vendor: "kimi" }); return Promise.resolve({ metrics: [metrics.metric("count", "k", "K", { used: 1, limit: 5, remaining: 4 })] }); },
      },
    }),
    getLinuxUserForWs: function () { return null; }, osUsers: options.osUsers,
  };
  var overview = attachVendorUsageOverview(overviewCtx);
  var state = { principal: { userId: "alice" }, project: { readVendorUsage: null }, authorized: true, resolveSlug: "target" };
  var project = {
    readVendorUsage: function (request) {
      calls.push({ request: request });
      return overview.readForOwner({ owner: request.owner, linuxUser: options.linuxUser || null, installed: { codex: true, kimi: true, antigravity: true }, isCurrent: request.isCurrent });
    },
  };
  state.project = project;
  var bound = control.attachClayVendorUsage({
    authorize: function () { if (!state.authorized) throw new Error("Source no longer authorized."); },
    multiUser: function () { return options.multiUser === true; },
    resolve: function (slug) { if (slug !== "target") throw new Error("Selected records require an owned ordinary project with live access."); return { principal: state.principal, project: state.project, status: {} }; },
  });
  return { bound: bound, state: state, calls: calls, project: project };
}

test("the tool reads the owner's own usage through the shared service and keeps units and reasons", async function () {
  var f = fixture({ multiUser: true, osUsers: true, linuxUser: "u_alice" });
  var result = await f.bound.readVendorUsage({ projectSlug: "target" });
  assert.equal(result.status, "completed");
  var byVendor = {};
  result.vendors.forEach(function (v) { byVendor[v.vendor] = v; });
  assert.equal(f.calls.filter(function (c) { return c.request; })[0].request.owner, "alice", "the owner is derived from the live principal, not an argument");
  assert.equal(byVendor.codex.account.metrics[0].unit, "percent");
  assert.equal(byVendor.codex.capability.mode, "query");
  assert.equal(byVendor.kimi.account.status, "refused", "a server-user credential is not read for an account-mode owner");
  assert.equal(byVendor.kimi.account.failureKind, "identity_unprovable");
  assert.equal(byVendor.antigravity.account.status, "unintegrated");
  assert.match(byVendor.antigravity.capability.reason, /^Not integrated:/);
  assert.equal(f.calls.filter(function (c) { return c.vendor === "kimi"; }).length, 0, "no reader ran for a refused vendor");
  assert.equal(f.calls.find(function (c) { return c.vendor === "codex"; }).linuxUser, "u_alice");
  assert.doesNotMatch(JSON.stringify(result), /Bearer|access_token|SECRET/);
});

test("single-user canonical reads use the single local owner", async function () {
  var f = fixture({ multiUser: false });
  var result = await f.bound.readVendorUsage({ projectSlug: "target" });
  assert.equal(f.calls.filter(function (c) { return c.request; })[0].request.owner, "default");
  assert.equal(result.vendors.filter(function (v) { return v.vendor === "kimi"; })[0].account.status, "ok");
});

test("only an exact projectSlug is accepted: no user, credential, URL, command, refresh or settings argument", async function () {
  var f = fixture();
  for (var args of [undefined, {}, { projectSlug: "" }, { projectSlug: "target", owner: "bob" }, { projectSlug: "target", force: true }, { projectSlug: "target", url: "https://x" }, { projectSlug: "target", vendor: "kimi" }, { projectSlug: 5 }]) {
    await assert.rejects(f.bound.readVendorUsage(args), /Choose an exact owned ordinary project/);
  }
  assert.equal(f.calls.length, 0);
});

test("an unowned, foreign or private project is refused by the shared project resolver, and a revoked source reads nothing", async function () {
  var f = fixture();
  await assert.rejects(f.bound.readVendorUsage({ projectSlug: "someone-elses" }), /owned ordinary project/);
  f.state.authorized = false;
  await assert.rejects(f.bound.readVendorUsage({ projectSlug: "target" }), /no longer authorized/);
  assert.equal(f.calls.length, 0);
});

test("the result is withheld when the project or access changes while usage is read", async function () {
  var f = fixture({ multiUser: true });
  var pending = f.bound.readVendorUsage({ projectSlug: "target" });
  f.state.project = { readVendorUsage: f.project.readVendorUsage };
  await assert.rejects(pending, /changed while usage was read/);
  var g = fixture({ multiUser: true });
  var second = g.bound.readVendorUsage({ projectSlug: "target" });
  g.state.principal = { userId: "mallory" };
  await assert.rejects(second, /changed while usage was read/);
  var h = fixture();
  var third = h.bound.readVendorUsage({ projectSlug: "target" });
  h.state.authorized = false;
  await assert.rejects(third, /changed while usage was read/);
});

test("a project without the service reports it unavailable rather than guessing", async function () {
  var f = fixture();
  f.state.project = {};
  await assert.rejects(f.bound.readVendorUsage({ projectSlug: "target" }), /unavailable for this project/);
});

test("the tool is in the typed catalog, both SDK and hook allowlists and the friendly presentation, and is read-only", function () {
  var defs = tools.getToolDefs(null);
  var tool = defs.filter(function (t) { return t.name === "read_vendor_usage"; })[0];
  assert.ok(tool);
  assert.deepEqual(Object.keys(tool.inputSchema), ["projectSlug"]);
  assert.equal(defs.filter(function (t) { return /vendor_usage/.test(t.name); }).length, 1, "no inspect or control twin exists: nothing here mutates");
  var root = path.join(__dirname, "..", "lib");
  assert.match(fs.readFileSync(path.join(root, "sdk-bridge.js"), "utf8"), /"mcp__clay-workspace__read_vendor_usage": true/);
  assert.match(fs.readFileSync(path.join(root, "yoke", "claude-hook-installer.js"), "utf8"), /"mcp__clay-workspace__read_vendor_usage"/);
  assert.match(fs.readFileSync(path.join(root, "public", "modules", "clay-tool-presentation.js"), "utf8"), /\['read_vendor_usage', 'Reading vendor usage'/);
  var source = fs.readFileSync(path.join(root, "clay-vendor-usage.js"), "utf8");
  assert.doesNotMatch(source, /fetch\(|child_process|readFile|WebSocket|ws\.send|force:/);
});

test("an unbound tool call fails closed", async function () {
  var tool = tools.getToolDefs(null).filter(function (t) { return t.name === "read_vendor_usage"; })[0];
  var out = await tool.handler({ projectSlug: "target" });
  assert.equal(out.isError, true);
});
