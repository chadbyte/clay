var test = require("node:test");
var assert = require("node:assert/strict");
var attachRuntime = require("../lib/project-tool-llm-runtime").attachProjectToolLlmRuntime;

function fixture(options) {
  options = options || {};
  var usersById = {
    u1: { id: "u1", linuxUser: "linux-u1" },
    owner: { id: "owner", linuxUser: "linux-owner" },
  };
  var access = { visibility: "private", ownerId: "owner", allowedUsers: ["u1"] };
  var completed = [];
  var catalogIdentities = [];
  var resolveModel = options.resolveModel || function (ws) {
    var user = usersById[ws._clayUser.id];
    catalogIdentities.push(options.osUsers === false ? null : user.linuxUser || null);
    return Promise.resolve({ status: "ready", vendor: "codex", model: "gpt-6-astra", effort: "high" });
  };
  var runtime = attachRuntime({
    users: {
      isMultiUser: function () { return true; },
      findUserById: function (id) { return usersById[id] || null; },
      canAccessProject: function (id, project) { return project.ownerId === id || project.allowedUsers.indexOf(id) !== -1; },
    },
    osUsers: options.osUsers !== false,
    getProjectAccess: function () { return access; },
    resolveModel: resolveModel,
    complete: function (request) { completed.push(request); return Promise.resolve("done"); },
    adapters: { codex: {} },
    cwd: "/workspace",
  });
  return { runtime: runtime, usersById: usersById, access: access, completed: completed, catalogIdentities: catalogIdentities, ws: { _clayUser: { id: "u1", linuxUser: "stale-client-value" } } };
}

test("tool LLM selection and execution use the same live actor OS identity", async function () {
  var f = fixture();
  assert.equal(await f.runtime.complete(f.ws, { model: "standard", prompt: "hello" }), "done");
  assert.equal(f.completed.length, 1);
  assert.equal(f.completed[0].linuxUser, "linux-u1");
  assert.equal(f.completed[0].selection.vendor, "codex");
  assert.notEqual(f.completed[0].linuxUser, "linux-owner");
});

test("tool LLM ignores retained OS identities when project OS isolation is disabled", async function () {
  var f = fixture({ osUsers: false });
  assert.equal(f.usersById.u1.linuxUser, "linux-u1");
  assert.equal(await f.runtime.complete(f.ws, { model: "standard", prompt: "hello" }), "done");
  assert.equal(f.completed[0].linuxUser, f.catalogIdentities[0]);
  assert.equal(f.completed[0].linuxUser, null);
});

test("tool LLM execution stops when actor OS identity changes during model resolution", async function () {
  var release;
  var f = fixture({ resolveModel: function () { return new Promise(function (resolve) { release = resolve; }); } });
  var pending = f.runtime.complete(f.ws, { model: "standard", prompt: "hello" });
  f.usersById.u1 = { id: "u1", linuxUser: "linux-u1-reassigned" };
  release({ status: "ready", vendor: "codex", model: "gpt-6-astra", effort: "high" });
  await assert.rejects(pending, /identity changed/);
  assert.equal(f.completed.length, 0);
});

test("tool LLM execution rechecks project access after model resolution", async function () {
  var release;
  var f = fixture({ resolveModel: function () { return new Promise(function (resolve) { release = resolve; }); } });
  var pending = f.runtime.complete(f.ws, { model: "standard", prompt: "hello" });
  f.access.allowedUsers = [];
  release({ status: "ready", vendor: "codex", model: "gpt-6-astra", effort: "high" });
  await assert.rejects(pending, /Project access/);
  assert.equal(f.completed.length, 0);
});
