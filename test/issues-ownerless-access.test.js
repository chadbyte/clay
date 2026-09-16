var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachService = require("../lib/issues-service").attachIssuesService;
var attachProject = require("../lib/project-issues").attachProjectIssues;

function fixture(t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-ownerless-"));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var user = { id: "member" };
  var session = { localId: 1, ownerId: user.id, vendor: "codex" };
  var status = { slug: "app", path: directory, projectKnowledgeId: "pk_ownerless", projectOwnerId: null };
  var sessions = new Map([[1, session]]);
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return { sessions: sessions }; } };
  var projects = new Map([["app", project]]);
  var access = true;
  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    findUserById: function (id) { return id === user.id ? user : null; },
    canAccessProject: function (id) { return access && id === user.id; },
    baseDir: directory,
  });
  var controller = attachProject({ service: service, projectSlug: "app", getClients: function () { return []; } });
  return { service: service, controller: controller, session: session, status: status,
    revoke: function () { access = false; } };
}

test("ownerless project exposes Driver tools that create, read and update without granting deletion", async function (t) {
  var f = fixture(t);
  var defs = f.controller.getDynamicToolDefs(f.session);
  function tool(name) { return defs.find(function (item) { return item.name === name; }); }
  assert.ok(tool("create_issue"));
  var created = await tool("create_issue").handler({ title: "Ownerless project regression" });
  assert.notEqual(created.isError, true);
  var entry = JSON.parse(created.content[0].text);
  var read = await tool("read_issue").handler({ ref: entry.ref });
  assert.equal(JSON.parse(read.content[0].text).title, entry.title);
  var updated = await tool("update_issue").handler({ ref: entry.ref, expectedRevision: 1, status: "in_progress" });
  assert.equal(JSON.parse(updated.content[0].text).revision, 2);
  var human = f.service.bindUser({ projectSlug: "app", userId: "member" });
  assert.equal(human.canDelete, false);
  assert.throws(function () { human.removeIssue({ ref: entry.ref, expectedRevision: 2 }); }, /project owner/);
  assert.throws(function () { human.createIssue({ title: "Human write" }); }, /cannot create issues directly/);
  assert.equal(f.status.projectOwnerId, null);
  f.revoke();
  assert.equal(f.controller.getDynamicToolDefs(f.session).length, 0);
  var stale = await tool("read_issue").handler({ ref: entry.ref });
  assert.equal(stale.isError, true);
  assert.equal(f.service.bindUser({ projectSlug: "app", userId: "member" }), null);
});

test("ownerless access still rejects unauthorized users, workers and stale sessions", function (t) {
  var f = fixture(t);
  assert.equal(f.service.bindUser({ projectSlug: "app", userId: "unknown" }), null);
  var forged = Object.assign({}, f.session);
  assert.equal(f.service.bindProjectSession({ projectSlug: "app", session: forged }), null);
  f.session.ownerId = null;
  assert.equal(f.controller.getDynamicToolDefs(f.session).length, 0);
  f.session.ownerId = "member";
  f.session.sessionProvenance = { kind: "worker" };
  assert.equal(f.controller.getDynamicToolDefs(f.session).length, 0);
  delete f.session.sessionProvenance;
  f.session.hidden = true;
  assert.equal(f.controller.getDynamicToolDefs(f.session).length, 0);
  f.session.hidden = false;
  f.revoke();
  assert.equal(f.controller.getDynamicToolDefs(f.session).length, 0);
});

test("absent ownership is allowed but dangling and malformed ownership remains rejected", function (t) {
  var f = fixture(t);
  delete f.status.projectOwnerId;
  assert.ok(f.service.bindProjectSession({ projectSlug: "app", session: f.session }));
  ["missing-user", "", 123].forEach(function (owner) {
    f.status.projectOwnerId = owner;
    assert.equal(f.controller.getDynamicToolDefs(f.session).length, 0);
  });
});
