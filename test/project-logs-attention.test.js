// The Sticky Notes / Project Logs boundary contract.
//
// Notes are the transient attention layer and Logs are the durable ledger.
// These tests pin the guidance the exact Project Driver receives, and pin the
// things that guidance must NOT do: it must not reach into note content, must
// not appear for sessions without Logs authority, and must not turn note
// creation into a ledger mutation.
//
// What this cannot test is the Driver's judgment about which independent
// record surfaces are appropriate; these assertions pin the guidance only.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var attachService = require("../lib/project-logs-service").attachProjectLogsService;
var attachProjectLogs = require("../lib/project-logs").attachProjectLogs;
var logsMcp = require("../lib/project-logs-mcp-server");
var logsStore = require("../lib/project-logs-store");
var logsSchema = require("../lib/project-logs-schema");
var sessionNotes = require("../lib/project-session-notes");
var notesMcp = require("../lib/session-notes-mcp-server");

var CONTRACT = logsMcp.ATTENTION_CONTRACT;

function handle(status, sessions) {
  var manager = { sessions: new Map() };
  for (var i = 0; i < (sessions || []).length; i++) manager.sessions.set(sessions[i].localId, sessions[i]);
  return { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
}

function fixture(opts) {
  var options = opts || {};
  var base = fs.mkdtempSync(path.join(os.tmpdir(), "clay-logs-attn-"));
  var cache = new Map();
  var session = { localId: 11, cliSessionId: "cli-11", ownerId: "owner", vendor: "claude" };
  var mateSession = { localId: 21, cliSessionId: "cli-21", ownerId: "owner", vendor: "claude" };

  var projects = new Map();
  projects.set("app", handle({ slug: "app", path: "/srv/app", projectOwnerId: "owner", visibility: "private", allowedUsers: ["member"] }, [session]));
  projects.set("mate-home", handle({ slug: "mate-home", path: "/srv/mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }, [mateSession]));

  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function (ownerId, mateId) {
      return { id: mateId, createdBy: ownerId, builtinKey: options.builtinKey === undefined ? "clay" : options.builtinKey };
    },
    canAccessProject: function (userId, status) {
      if (!status) return false;
      if (status.projectOwnerId === userId) return true;
      return (status.allowedUsers || []).indexOf(userId) >= 0;
    },
    findUserById: function (id) { return id === "owner" ? { id: "owner", displayName: "Owner" } : null; },
    openStore: function (cwd) {
      if (!cache.has(cwd)) cache.set(cwd, logsStore.createProjectLogsStore({ root: cwd, baseDir: base }));
      return cache.get(cwd);
    },
  });

  var attached = attachProjectLogs({
    service: service,
    sm: projects.get(options.mate ? "mate-home" : "app").getSessionManager(),
    projectSlug: options.mate ? "mate-home" : "app",
    getProjectOwnerId: function () { return "owner"; },
    isMate: !!options.mate,
    mateId: options.mate ? "mate-id" : null,
    sendTo: function () {},
  });
  return { attached: attached, service: service, session: session, mateSession: mateSession, projects: projects };
}

// Matches a whole clause rather than a keyword, so a contract that merely
// mentions the word cannot satisfy the assertion.
function requires(text, phrases, label) {
  for (var i = 0; i < phrases.length; i++) {
    assert.match(text, phrases[i], label + ": missing " + phrases[i]);
  }
}

// --- the boundary itself --------------------------------------------------

test("the contract states the issue, note, and log layers", function () {
  requires(CONTRACT, [
    /Sticky Notes, Project Issues, and Project Logs are three complementary surfaces and must not be confused/,
    /Sticky Notes are the transient attention layer for preferences, reminders, undeveloped ideas, and explicit requests to remember something/,
    /transient attention layer/,
    /own reminder or attention item needs action/,
    /closed once it no longer does/,
    /Closing is reversible and never deletes the note/,
    /Project Issues are the lifecycle record for concrete actionable work/,
    /Project Logs are the durable continuity record for task results, decisions, and verification/,
    /Project Logs remain required for concise task continuity, decisions, and verification/,
    /Logs are durable and versioned/,
  ], "boundary");
});

test("the actionable issue-first rule is stated imperatively", function () {
  requires(CONTRACT, [
    /proactively search or reuse an existing Issue, or create one/,
    /observable evidence, affected component, impact, next action, and acceptance criteria/,
    /do not wait for a separate user request/,
    /opaque issue: reference/,
    /Do not create a mandatory duplicate Sticky Note/,
  ], "issue guidance");
});

test("correlation carries the issue ref into the note and points Logs at Issues", function () {
  requires(CONTRACT, [
    /Reference related Issues in the Log instead of duplicating their full reports/,
    /cite the opaque issue: reference/,
    /Never invent an issue reference, mirror storage automatically/,
  ], "correlation");
});

test("update-not-duplicate is explicit", function () {
  requires(CONTRACT, [/If the Issue already exists, revise that Issue instead of creating a second one/], "dedupe");
});

test("issue lifecycle keeps Logs concise and follows issue status rules", function () {
  requires(CONTRACT, [
    /Project Logs remain required for concise task continuity, decisions, and verification/,
    /update the Issue with remediation and verification/,
    /real commit-evidence and status rules/,
    /close any related Sticky Note only when its own reminder is done/,
  ], "lifecycle");
});

test("the resolution lifecycle ends with the note gone and the entry kept", function () {
  requires(CONTRACT, [
    /When tracked Issue work is complete, update the Issue with remediation and verification/,
    /close any related Sticky Note only when its own reminder is done/,
    /Close it, never delete it/,
  ], "resolution");
  var reviseIdx = CONTRACT.indexOf("When tracked Issue work is complete, update the Issue");
  var removeIdx = CONTRACT.indexOf("close any related Sticky Note only when its own reminder is done");
  assert.ok(reviseIdx !== -1 && removeIdx > reviseIdx, "the revision is ordered before the removal");
});

test("a defect fixed inside the current task opens no note", function () {
  requires(CONTRACT, [
    /find and fully fix a defect inside the current task, do not open a Sticky Note or create a retroactive Issue/,
    /keep the required concise Log only when the work instruction or result belongs in the project record/,
  ], "same-task exception");
});

test("the contract never tells the Driver to delete or remove a note", function () {
  assert.doesNotMatch(CONTRACT, /remove the Sticky Note|delete the Sticky Note|remove the note|delete the note/i,
    "resolution closes the note; it never erases it");
  assert.match(CONTRACT, /close any related Sticky Note/, "and says close explicitly");
  assert.doesNotMatch(CONTRACT, /\barchive\b/i, "Archive is not this lifecycle's vocabulary");
});

test("noise is excluded from the ledger in both directions", function () {
  requires(CONTRACT, [
    /not to ordinary notes or undeveloped ideas/,
    /Never invent an issue reference, mirror storage automatically, or expand privileges/,
    /Notes written by people or by other sessions are not yours to mirror/,
  ], "exclusions");
});

// --- the guidance must not leak or overreach ------------------------------

test("the contract carries no note content and no note ids", function () {
  // It may name the tools' subject matter, but it must not embed a board.
  assert.doesNotMatch(CONTRACT, /n_\d{10,}/, "no note id shape");
  assert.doesNotMatch(CONTRACT, /\[(purple|orange|blue|green|yellow|pink)\]/, "no rendered note rows");
  assert.doesNotMatch(CONTRACT, /list_notes|write_note|remove_note/,
    "the ledger contract does not script the notes tool surface");
  // The notes prompt is the only thing that renders note text, and it is a
  // separate surface that this change does not touch.
  assert.ok(sessionNotes.NOTES_LABEL, "the notes surface still owns its own label");
  assert.equal(CONTRACT.indexOf(sessionNotes.NOTES_LABEL), -1, "the two surfaces are not merged");
});

test("the Driver system prompt states the boundary and still injects no note bodies", function () {
  var f = fixture();
  var prompt = f.attached.getSystemPrompt(f.session);
  assert.ok(prompt.indexOf(CONTRACT) !== -1, "the bound Driver receives the boundary contract");
  assert.ok(prompt.indexOf(logsMcp.LOGS_CONTRACT) !== -1, "alongside the existing ledger contract");
  assert.ok(prompt.indexOf(logsMcp.REVIEW_CONTRACT) !== -1);
  assert.doesNotMatch(prompt, /n_\d{10,}/, "no note ids reach the prompt");
  assert.doesNotMatch(prompt, /list_notes|write_note|remove_note/, "no notes tooling is scripted here");
  // The Logs prompt is bounded and does not grow with the note board.
  assert.ok(prompt.length < 8000, "the Logs prompt stays a contract, not a data dump");
});

test("the notes prompt remains a separate surface that this change did not touch", function () {
  // The notes prompt is what renders note previews. It must not have acquired
  // any ledger instruction, or notes written without Driver authority would be
  // told to mutate Logs.
  assert.doesNotMatch(notesMcp.MEMORY_CONTRACT, /clay-logs|create_log|update_log|Project Log/,
    "the generic note contract stays free of ledger obligations");
  assert.doesNotMatch(sessionNotes.PROACTIVE_POLICY, /clay-logs|create_log|update_log|Project Log/,
    "and so does the proactive note policy");
});

// --- authority is unchanged ------------------------------------------------

test("only an exact bound Driver session sees the boundary contract", function () {
  var f = fixture();
  // A session that does not resolve to the exact live object gets nothing,
  // which is what keeps the authoring contract with the actual author.
  assert.equal(f.attached.getSystemPrompt({ localId: 99, ownerId: "owner" }), "",
    "a session the manager does not hold gets nothing");
  assert.equal(f.attached.getSystemPrompt({ localId: 11, cliSessionId: "cli-11", ownerId: "owner" }), "",
    "a look-alike session object is not the exact bound session");
  // The session-less call is the existing static-descriptor path used before a
  // session is known. It carries contract text only, never project data.
  var unbound = f.attached.getSystemPrompt(null);
  assert.ok(unbound.indexOf(CONTRACT) !== -1, "the static descriptor still describes the boundary");
  assert.doesNotMatch(unbound, /n_\d{10,}/, "and still carries no note or project data");
});

test("an ordinary Mate gets no Logs surface at all, contract included", function () {
  var ordinary = fixture({ mate: true, builtinKey: null });
  assert.equal(ordinary.attached.getSystemPrompt(ordinary.mateSession), "", "no prompt");
  var adapter = { createToolServer: function (definition) { return definition; } };
  assert.equal(ordinary.attached.createMcpServer(adapter, ordinary.mateSession), null, "no tool server");
  var bridge = ordinary.attached.getBridgeTools(ordinary.mateSession) || [];
  assert.equal(bridge.length, 0, "no bridge tools");
});

test("builtin Clay stays read-only and is not given the authoring boundary", function () {
  var clay = fixture({ mate: true, builtinKey: "clay" });
  var adapter = { createToolServer: function (definition) { return definition; } };
  var server = clay.attached.createMcpServer(adapter, clay.mateSession);
  assert.ok(server, "Clay has a Logs surface");
  var names = server.tools.map(function (tool) { return tool.name; });
  for (var i = 0; i < names.length; i++) {
    assert.doesNotMatch(names[i], /^(create|update|revert|link|review)_/, names[i] + " is not a write tool");
  }
  // The authoring contract is for the author. Clay does not write, so it is not
  // told to pair notes with entries.
  assert.equal(clay.attached.getSystemPrompt(clay.mateSession).indexOf(CONTRACT), -1,
    "the read-only surface carries no dual-write obligation");
});

test("writing a note cannot mutate the ledger, and human comments stay proposals", function () {
  var f = fixture();
  var bound = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var before = bound.listLogs({}).entries.length;

  // There is no path from the notes surface into the Logs surface: the Logs
  // binding exposes no note-shaped operation at all.
  var surface = Object.keys(bound);
  for (var i = 0; i < surface.length; i++) {
    assert.doesNotMatch(surface[i], /note/i, surface[i] + " is not a note operation");
  }
  assert.equal(bound.listLogs({}).entries.length, before, "nothing was written");

  // A human user binding still cannot author, only comment. The capability is
  // refused at call time rather than by omitting the method.
  var userBound = f.service.bindUser({ projectSlug: "app", user: { id: "owner", displayName: "Owner" } });
  assert.equal(userBound.canWrite, false, "a user binding is not canonical");
  assert.equal(userBound.canComment, true, "but it may comment");
  assert.throws(function () { userBound.createLog({ kind: "defect", title: "x", summary: "y" }); },
    "a user binding cannot create");
  assert.throws(function () { userBound.updateLog({ ref: "log:whatever", title: "x" }); },
    "a user binding cannot update");
  assert.equal(typeof userBound.commentLog, "function", "commenting is the human path");
});

// --- the lifecycle the contract describes is actually supported ------------

test("the ledger supports the lifecycle the contract prescribes", function () {
  var f = fixture();
  var bound = f.service.bindProjectSession({ projectSlug: "app", session: f.session });

  // Discovery: one entry, categorised and prioritised independently.
  var created = bound.createLog({
    kind: "defect",
    title: "Access check fails open",
    summary: "Reconstructed access records default to public.",
    body: "Discovery: reconstructing the record from getStatus() omits visibility.",
    priority: "urgent",
  });
  assert.match(created.ref, /^log:[A-Za-z0-9_-]{24}$/, "the ref is opaque and is what the note would carry");
  assert.equal(created.kind, "defect");
  assert.equal(created.priority, "urgent");

  // Resolution: the same entry gains remediation as a new revision, not a
  // second entry.
  var resolved = bound.updateLog({
    ref: created.ref,
    body: "Discovery: reconstructing the record from getStatus() omits visibility.\n"
      + "Remediation: resolve access from the authoritative record.\n"
      + "Verification: focused suites plus full suite pass.\n"
      + "Outcome: private foreign projects are denied.",
  });
  assert.equal(resolved.ref, created.ref, "same entry");
  assert.equal(bound.listLogs({}).entries.length, 1, "no duplicate was created");

  var history = bound.logHistory({ ref: created.ref });
  assert.equal(history.revisions.length, 2, "discovery and remediation are both permanent revisions");
  assert.equal(history.revisions[0].op, "create");
  assert.equal(history.revisions[1].op, "update");

  // The durable record survives independently of any note: nothing about the
  // entry references a note id.
  var read = bound.readLog({ ref: created.ref });
  assert.doesNotMatch(JSON.stringify(read), /n_\d{10,}/, "no note id is embedded in the entry");
});
