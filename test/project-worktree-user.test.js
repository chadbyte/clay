var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;

function fixture(onCreateWorktree, slug, overrides) {
  var sent = [];
  var options = Object.assign({
    cwd: "/tmp/project",
    slug: slug || "project-one",
    sm: {},
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: {},
    send: function () {},
    sendTo: function (ws, message) { sent.push(message); },
    onCreateWorktree: onCreateWorktree,
  }, overrides || {});
  var attached = attachSessions(options);
  return { attached: attached, sent: sent };
}

test("worktree creation forwards the authenticated user to the daemon", function () {
  var actor = { id: "user-one", linuxUser: "clay-user-one" };
  var received = null;
  var f = fixture(function () {
    received = Array.prototype.slice.call(arguments);
    return { ok: true, slug: "project-one--feature-one" };
  });

  assert.equal(f.attached.handleSessionsMessage({ _clayUser: actor }, {
    type: "create_worktree",
    branch: "feature-one",
    dirName: "feature-one",
  }), true);
  assert.equal(received[4], actor);
  assert.equal(f.sent[0].ok, true);
});

test("worktree creation rejects an escaping directory before reaching Git", function () {
  var called = false;
  var f = fixture(function () { called = true; });

  assert.equal(f.attached.handleSessionsMessage({ _clayUser: { id: "user-one" } }, {
    type: "create_worktree",
    branch: "feature-one",
    dirName: "../feature-one",
  }), true);
  assert.equal(called, false);
  assert.equal(f.sent[0].ok, false);
  assert.equal(f.sent[0].error, "Invalid worktree directory name");
});

test("worktree creation is denied from an exact worktree context", function () {
  var called = false;
  var f = fixture(function () { called = true; }, "project-one--feature-one");
  assert.equal(f.attached.handleSessionsMessage({ _clayUser: { id: "user-one" } }, {
    type: "create_worktree",
    branch: "nested",
    dirName: "nested",
    parentSlug: "project-one",
  }), true);
  assert.equal(called, false, "a forged parentSlug is ignored and cannot bypass the current project scope");
  assert.equal(f.sent[0].ok, false);
  assert.match(f.sent[0].error, /another worktree/);
});

test("an exact worktree socket cannot forge cross-project schedule targets", function () {
  var called = false;
  var f = fixture(function () {}, "project-one--feature-one", {
    usersModule: { isMultiUser: function () { return true; } },
    opts: {
      canAccessProjectSlug: function (userId, targetSlug) {
        return userId === "user-one" && targetSlug === "project-one--feature-one";
      },
    },
    moveScheduleToProject: function () { called = true; return { ok: true }; },
  });
  f.attached.handleSessionsMessage({ _clayUser: { id: "user-one" } }, {
    type: "schedule_move",
    recordId: "record-one",
    fromSlug: "project-one--feature-one",
    toSlug: "project-one",
  });
  assert.equal(called, false);
  assert.equal(f.sent[0].ok, false);
  assert.match(f.sent[0].error, /access/);
});
