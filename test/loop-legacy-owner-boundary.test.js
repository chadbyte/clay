var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("node:child_process").execFileSync;
var attachLoop = require("../lib/project-loop").attachLoop;

function fixture(t, options) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-legacy-owner-boundary-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=Clay Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "chore: initialize test fixture"], { cwd: dir });
  var loopId = "legacy-owner-loop"; var loopDir = path.join(dir, ".claude", "loops", loopId);
  fs.mkdirSync(loopDir, { recursive: true }); fs.writeFileSync(path.join(loopDir, "PROMPT.md"), "Implement safely.\n"); fs.writeFileSync(path.join(loopDir, "JUDGE.md"), "Verify safely.\n");
  var sessions = new Map(); var nextId = 1; var calls = []; var events = []; var allowed = true; var linuxAvailable = true;
  var sm = {
    sessions: sessions, setResolveLoopInfo: function () {}, saveSessionFile: function () {}, broadcastSessionList: function () {}, appendToSessionFile: function () {},
    createSession: function (input) { var session = { localId: nextId++, ownerId: input.ownerId || null, history: [] }; sessions.set(session.localId, session); return session; },
  };
  var loop = attachLoop({
    cwd: dir, slug: "legacy-boundary", sm: sm, loopRegistryPath: path.join(dir, "registry.jsonl"), loopStatePath: path.join(dir, "loop-state.json"),
    sdk: { startQuery: function (session, prompt, images, linuxUser) {
      calls.push({ role: session.loop.role, ownerId: session.ownerId, linuxUser: linuxUser });
      if (session.loop.role === "coder" && options.revokeAfterCoder) { allowed = false; session.history.push({ type: "delta", text: "coder complete" }); session.onQueryComplete(session); }
      return Promise.resolve();
    } },
    send: function (message) { events.push(message); }, sendTo: function () {}, sendToSession: function () {}, getHubSchedules: function () { return []; },
    getLinuxUserForSession: function () { return linuxAvailable ? "alice-linux" : null; }, onProcessingChanged: function () {}, hydrateImageRefs: function (value) { return value; },
    isMultiUser: function () { return true; }, requiresLinuxUser: function () { return true; }, authorizeScheduledRun: function () { return allowed; },
  });
  loop.stopTimer();
  var record = loop.loopRegistry.register({ id: loopId, name: "Legacy owner", task: "Run", cron: "0 9 * * *", ownerId: "alice", maxIterations: 2 });
  loop.loopState.loopId = record.id; loop.loopState.loopFilesId = record.id; loop.loopState.wizardData = { loopMode: "judge", name: record.name };
  if (options.missingLinuxAtStart) linuxAvailable = false;
  t.after(function () { loop.stopTimer(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { loop: loop, calls: calls, events: events };
}

test("legacy coder and judge starts recheck live owner authorization and OS identity", function (t) {
  var revoked = fixture(t, { revokeAfterCoder: true }); revoked.loop.startLoop({ maxIterations: 2, name: "Legacy owner" });
  assert.deepEqual(revoked.calls.map(function (call) { return call.role; }), ["coder"]); assert.equal(revoked.calls[0].ownerId, "alice"); assert.equal(revoked.calls[0].linuxUser, "alice-linux");
  assert.equal(revoked.loop.loopState.active, false); assert.equal(revoked.events.some(function (event) { return event.type === "loop_error" && /no longer authorized/.test(event.text); }), true);

  var missingIdentity = fixture(t, { missingLinuxAtStart: true }); missingIdentity.loop.startLoop({ maxIterations: 2, name: "Legacy owner" });
  assert.equal(missingIdentity.calls.length, 0); assert.equal(missingIdentity.loop.loopState.active, false);
  assert.equal(missingIdentity.events.some(function (event) { return event.type === "loop_error" && /valid OS identity/.test(event.text); }), true);
});
