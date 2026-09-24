// Sticky Note lifecycle: close is reversible and never destroys a record.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var lifecycle = require("../lib/notes-lifecycle");
var notesModule = require("../lib/notes");
var sessionNotes = require("../lib/project-session-notes");
var logsMcp = require("../lib/project-logs-mcp-server");
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;

// A real manager over a throwaway CONFIG_DIR, so persistence is genuinely
// exercised rather than mocked.
function manager(label, seed) {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-notes-" + label + "-"));
  process.env.CLAY_CONFIG_DIR = home;
  delete require.cache[require.resolve("../lib/config")];
  delete require.cache[require.resolve("../lib/notes")];
  var freshNotes = require("../lib/notes");
  var cwd = path.join(home, "project");
  fs.mkdirSync(cwd, { recursive: true });
  var nm = freshNotes.createNotesManager({ cwd: cwd });
  if (seed) {
    for (var i = 0; i < seed.length; i++) nm.create(seed[i]);
  }
  return { nm: nm, cwd: cwd, home: home, reopenManager: function () {
    return freshNotes.createNotesManager({ cwd: cwd });
  } };
}

function productionNoteHandler(nm, options) {
  var opts = options || {};
  var sent = [];
  var direct = [];
  var actor = opts.actor || { id: "u1", displayName: "Ada" };
  var users = {
    isMultiUser: function () { return opts.multiUser !== false; },
    findUserById: function (id) { return opts.revoked ? null : (id === actor.id ? actor : null); },
    canAccessProject: function () { return opts.access !== false; },
  };
  var handler = attachUserMessage({
    cwd: "/tmp/notes-handler-project",
    slug: "notes-handler-project",
    isMate: false,
    osUsers: false,
    nm: nm,
    usersModule: users,
    send: function (message) { sent.push(message); },
    sendTo: function (ws, message) { direct.push(message); },
    sendToSession: function () {},
    sendToSessionOthers: function () {},
    clients: new Set(),
    getProjectAccess: function () { return { visibility: "public", ownerId: "u1" }; },
    canAccessProjectSlug: function () { return opts.access !== false; },
  });
  return { handler: handler, sent: sent, direct: direct, ws: { readyState: 1, _clayUser: actor } };
}

// --- projection of legacy files ------------------------------------------

test("a legacy note with no state projects as open", function () {
  var note = { id: "n_1", text: "Legacy" };
  assert.equal(lifecycle.stateOf(note), "open");
  assert.equal(lifecycle.isOpen(note), true);
  assert.equal(lifecycle.isClosed(note), false);
});

test("a legacy hidden note projects as closed without inventing a close time", function () {
  var note = { id: "n_2", text: "Legacy hidden", hidden: true };
  assert.equal(lifecycle.stateOf(note), "closed");
  lifecycle.normalize(note);
  assert.equal(note.state, "closed");
  assert.equal(note.closedAt, null, "no timestamp is fabricated for a note that never recorded one");
  assert.equal(note.closedBy, null);
  assert.equal(note.text, "Legacy hidden", "content is untouched");
});

test("projection adds fields and never drops any", function () {
  var note = { id: "n_3", text: "Keep me", color: "green", x: 12, y: 34, custom: "unknown-field" };
  var before = Object.keys(note).slice();
  lifecycle.normalize(note);
  for (var i = 0; i < before.length; i++) {
    assert.ok(Object.prototype.hasOwnProperty.call(note, before[i]), before[i] + " survived");
  }
  assert.equal(note.custom, "unknown-field", "an unrecognised field is preserved verbatim");
  assert.equal(note.state, "open");
});

test("an unknown state value falls back rather than trusting it", function () {
  assert.equal(lifecycle.stateOf({ state: "archived" }), "open");
  assert.equal(lifecycle.stateOf({ state: "archived", hidden: true }), "closed");
  assert.equal(lifecycle.stateOf(null), "open");
});

// --- transitions ----------------------------------------------------------

test("close persists without deleting, and survives a reload", function () {
  var m = manager("close");
  var note = m.nm.create({ text: "Fix the thing" });
  assert.equal(lifecycle.stateOf(note), "open");

  var actor = lifecycle.userActor({ id: "u1", displayName: "Ada" });
  var closed = m.nm.close(note.id, actor);
  assert.equal(closed.state, "closed");
  assert.ok(closed.closedAt > 0, "a real close records when");
  assert.deepEqual(closed.closedBy, { type: "user", userId: "u1", displayName: "Ada" });
  assert.equal(m.nm.list().length, 1, "the record is still there");
  assert.equal(closed.text, "Fix the thing", "content is untouched");

  // A fresh manager over the same directory: this is the restart case.
  var reloaded = m.reopenManager();
  var after = reloaded.list();
  assert.equal(after.length, 1, "nothing was lost on disk");
  assert.equal(after[0].state, "closed", "closed survives a reload");
  assert.equal(after[0].closedAt, closed.closedAt);
  assert.deepEqual(after[0].closedBy, { type: "user", userId: "u1", displayName: "Ada" });
});

test("permanent removal only deletes closed notes and survives disk reload", function () {
  var m = manager("permanent-remove");
  var open = m.nm.create({ text: "Keep open" });
  var closed = m.nm.create({ text: "Discard me" });
  assert.equal(m.nm.removeClosed(open.id), null, "open notes cannot be permanently removed");
  m.nm.close(closed.id, null);
  assert.equal(m.nm.removeClosed(closed.id).id, closed.id);
  assert.deepEqual(m.reopenManager().list().map(function (note) { return note.id; }), [open.id]);
});

test("permanent removal rolls back when persistence fails", function () {
  var m = manager("permanent-remove-failure");
  var note = m.nm.create({ text: "Must survive" });
  m.nm.close(note.id, null);
  var originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (target) {
    if (String(target).slice(-4) === ".tmp") throw new Error("simulated disk failure");
    return originalWrite.apply(fs, arguments);
  };
  try {
    assert.equal(m.nm.removeClosed(note.id), null, "failed persistence reports removal failure");
    assert.equal(m.nm.list().length, 1, "the in-memory record is rolled back");
    assert.equal(m.nm.list()[0].state, "closed");
  } finally {
    fs.writeFileSync = originalWrite;
  }
  var reloaded = m.reopenManager().list();
  assert.equal(reloaded.length, 1, "the record remains on disk after failure");
  assert.equal(reloaded[0].text, "Must survive");
});

test("production delete handler rejects missing, open, reopened, unauthorized, revoked, and failed writes", function () {
  var missing = manager("handler-missing");
  var missingFlow = productionNoteHandler(missing.nm);
  missingFlow.handler.handleUserMessage(missingFlow.ws, { type: "note_delete_permanently", id: "missing", requestId: "missing-1" });
  assert.equal(missingFlow.direct[0].ok, false);
  assert.equal(missingFlow.sent.length, 0);

  var open = manager("handler-open");
  var openNote = open.nm.create({ text: "Open" });
  var openFlow = productionNoteHandler(open.nm);
  openFlow.handler.handleUserMessage(openFlow.ws, { type: "note_delete_permanently", id: openNote.id, requestId: "open-1" });
  assert.match(openFlow.direct[0].error, /closed/);
  assert.equal(openFlow.sent.length, 0);

  var reopened = manager("handler-reopened");
  var reopenedNote = reopened.nm.create({ text: "Reopened" });
  reopened.nm.close(reopenedNote.id, null);
  reopened.nm.reopen(reopenedNote.id);
  var reopenedFlow = productionNoteHandler(reopened.nm);
  reopenedFlow.handler.handleUserMessage(reopenedFlow.ws, { type: "note_delete_permanently", id: reopenedNote.id, requestId: "reopened-1" });
  assert.equal(reopenedFlow.direct[0].ok, false);
  assert.equal(reopened.nm.list().length, 1);

  var unauthorized = manager("handler-unauthorized");
  var unauthorizedNote = unauthorized.nm.create({ text: "No access" });
  unauthorized.nm.close(unauthorizedNote.id, null);
  var unauthorizedFlow = productionNoteHandler(unauthorized.nm, { access: false });
  unauthorizedFlow.handler.handleUserMessage(unauthorizedFlow.ws, { type: "note_delete_permanently", id: unauthorizedNote.id, requestId: "unauthorized-1" });
  assert.equal(unauthorizedFlow.direct[0].ok, false);
  assert.equal(unauthorized.nm.list().length, 1);

  var revoked = manager("handler-revoked");
  var revokedNote = revoked.nm.create({ text: "Revoked" });
  revoked.nm.close(revokedNote.id, null);
  var revokedFlow = productionNoteHandler(revoked.nm, { revoked: true });
  revokedFlow.handler.handleUserMessage(revokedFlow.ws, { type: "note_delete_permanently", id: revokedNote.id, requestId: "revoked-1" });
  assert.equal(revokedFlow.direct[0].ok, false);
  assert.equal(revoked.nm.list().length, 1);

  var failed = manager("handler-failed-write");
  var failedNote = failed.nm.create({ text: "Disk failure" });
  failed.nm.close(failedNote.id, null);
  var failedFlow = productionNoteHandler(failed.nm);
  var originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (target) {
    if (String(target).slice(-4) === ".tmp") throw new Error("simulated handler disk failure");
    return originalWrite.apply(fs, arguments);
  };
  try {
    failedFlow.handler.handleUserMessage(failedFlow.ws, { type: "note_delete_permanently", id: failedNote.id, requestId: "failed-1" });
  } finally {
    fs.writeFileSync = originalWrite;
  }
  assert.equal(failedFlow.direct[0].ok, false);
  assert.equal(failedFlow.sent.length, 0, "persistence failure never broadcasts deletion");
  assert.equal(failed.nm.list().length, 1);
  assert.equal(failed.reopenManager().list().length, 1);
});

test("production delete handler broadcasts only after a successful closed-note removal", function () {
  var m = manager("handler-success");
  var note = m.nm.create({ text: "Delete successfully" });
  m.nm.close(note.id, null);
  var flow = productionNoteHandler(m.nm);
  flow.handler.handleUserMessage(flow.ws, { type: "note_delete_permanently", id: note.id, requestId: "success-1" });
  assert.deepEqual(flow.sent, [{ type: "note_deleted", id: note.id }]);
  assert.deepEqual(flow.direct[0], { type: "note_delete_result", projectSlug: "notes-handler-project", noteId: note.id, requestId: "success-1", ok: true, error: null });
  assert.equal(m.reopenManager().list().length, 0);
});

test("reopen restores the note and clears the close provenance", function () {
  var m = manager("reopen");
  var note = m.nm.create({ text: "Come back" });
  m.nm.close(note.id, lifecycle.userActor({ id: "u1" }));
  var reopened = m.nm.reopen(note.id);
  assert.equal(reopened.state, "open");
  assert.equal(reopened.closedAt, null);
  assert.equal(reopened.closedBy, null);
  assert.equal(reopened.hidden, false);

  var reloaded = m.reopenManager().list();
  assert.equal(reloaded[0].state, "open", "reopen survives a reload");
});

test("close and reopen are idempotent and do not restamp", function () {
  var m = manager("idem");
  var note = m.nm.create({ text: "Repeat" });
  var first = m.nm.close(note.id, lifecycle.userActor({ id: "u1", displayName: "Ada" }));
  var stamp = first.closedAt;
  var again = m.nm.close(note.id, lifecycle.userActor({ id: "u2", displayName: "Bob" }));
  assert.equal(again.closedAt, stamp, "the original completion time is not overwritten");
  assert.deepEqual(again.closedBy, { type: "user", userId: "u1", displayName: "Ada" },
    "nor is the original actor");

  m.nm.reopen(note.id);
  var reopenedTwice = m.nm.reopen(note.id);
  assert.equal(reopenedTwice.state, "open");
  assert.equal(m.nm.list().length, 1, "no duplication and no loss across repeats");
});

test("open and closed listings partition the board", function () {
  var m = manager("partition");
  var a = m.nm.create({ text: "A" });
  var b = m.nm.create({ text: "B" });
  m.nm.create({ text: "C" });
  m.nm.close(b.id, null);
  assert.deepEqual(m.nm.openList().map(function (n) { return n.text; }), ["A", "C"]);
  assert.deepEqual(m.nm.closedList().map(function (n) { return n.text; }), ["B"]);
  assert.equal(m.nm.list().length, 3, "the full record set is unchanged");
  assert.equal(a.state, "open");
});

test("the agent prompt shows open notes only", function () {
  var m = manager("prompt");
  var keep = m.nm.create({ text: "Still needed" });
  var done = m.nm.create({ text: "Already handled" });
  m.nm.close(done.id, null);
  var text = m.nm.getActiveNotesText();
  assert.match(text, /Still needed/);
  assert.doesNotMatch(text, /Already handled/, "a closed note stops occupying the prompt");
  assert.ok(keep);
});

test("a legacy hidden note on disk loads as closed with its content intact", function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-notes-legacy-"));
  process.env.CLAY_CONFIG_DIR = home;
  delete require.cache[require.resolve("../lib/config")];
  delete require.cache[require.resolve("../lib/notes")];
  var freshNotes = require("../lib/notes");
  var config = require("../lib/config");
  var utils = require("../lib/utils");
  var cwd = path.join(home, "legacy-project");
  fs.mkdirSync(cwd, { recursive: true });

  // A file written by the previous version: no state, no closedAt, no closedBy.
  var notesDir = path.join(config.CONFIG_DIR, "notes");
  fs.mkdirSync(notesDir, { recursive: true });
  var encoded = utils.resolveEncodedFile(notesDir, cwd, ".json");
  fs.writeFileSync(path.join(notesDir, encoded + ".json"), JSON.stringify({
    notes: [
      { id: "n_old_open", text: "Old open note", color: "blue", x: 1, y: 2 },
      { id: "n_old_hidden", text: "Old hidden note", color: "pink", hidden: true, x: 3, y: 4 },
    ],
  }));

  var nm = freshNotes.createNotesManager({ cwd: cwd });
  var loaded = nm.list();
  assert.equal(loaded.length, 2, "both legacy notes survive the migration");
  assert.equal(loaded[0].state, "open");
  assert.equal(loaded[0].text, "Old open note");
  assert.equal(loaded[0].color, "blue");
  assert.equal(loaded[1].state, "closed");
  assert.equal(loaded[1].text, "Old hidden note", "content is not touched by migration");
  assert.equal(loaded[1].closedAt, null);
});

// --- actor provenance -----------------------------------------------------

test("actors are built from server-bound context only", function () {
  assert.deepEqual(lifecycle.sessionActor({ localId: 7, vendor: "kiro" }),
    { type: "session", sessionId: 7, vendor: "kiro" });
  assert.equal(lifecycle.sessionActor(null), null);
  assert.deepEqual(lifecycle.userActor({ id: "u1", displayName: "Ada" }),
    { type: "user", userId: "u1", displayName: "Ada" });
  // Single-user mode has no user record; the shape stays honest about that
  // rather than inventing an identity.
  assert.deepEqual(lifecycle.userActor(null), { type: "user", userId: null, displayName: null });
  // Nothing in the actor is read from a note payload.
  var forged = lifecycle.userActor({ id: "u1", displayName: "Ada", type: "session", sessionId: 99 });
  assert.equal(forged.type, "user");
  assert.equal(forged.sessionId, undefined);
});

// --- destructive boundary -------------------------------------------------

test("the WebSocket delete path is separate and MCP remains reversible", function () {
  var userMessage = fs.readFileSync(path.join(__dirname, "..", "lib", "project-user-message.js"), "utf8");
  var block = userMessage.substring(userMessage.indexOf("// --- Sticky notes ---"), userMessage.indexOf("// --- Web terminal ---"));
  assert.ok(block.length > 0, "the sticky-note dispatch block was found");
  assert.doesNotMatch(block, /nm\.remove\(/, "the legacy maintenance remover is not called");
  assert.match(block, /note_close/, "close is handled");
  assert.match(block, /note_reopen/, "reopen is handled");
  // The retired spelling is still accepted, and is routed to the same close.
  assert.match(block, /msg\.type === "note_close" \|\| msg\.type === "note_delete"/,
    "an older client's note_delete is handled as a close");
  assert.match(block, /note_delete_permanently/, "human permanent deletion has a dedicated action");
  assert.match(block, /type: "note_deleted"/, "successful deletion is broadcast");
  assert.match(userMessage, /projectSlug: slug/, "delete results are project-correlated");
  assert.match(userMessage, /noteId: msg\.id/, "delete results are note-correlated");

  var handlers = fs.readFileSync(path.join(__dirname, "..", "lib", "project-session-notes.js"), "utf8");
  assert.doesNotMatch(handlers, /nm\.remove\(/, "no MCP tool deletes a note");
});

test("the client offers permanent deletion only in the Closed tab", function () {
  var base = path.join(__dirname, "..", "lib", "public");
  var browser = fs.readFileSync(path.join(base, "modules", "sticky-notes-browser.js"), "utf8");
  var canvas = fs.readFileSync(path.join(base, "modules", "sticky-notes.js"), "utf8");
  assert.match(browser, /note_delete_permanently/, "the browser uses the dedicated delete action");
  assert.doesNotMatch(canvas, /note_delete/, "the canvas never sends a delete");
  assert.match(browser, /trash-2|Delete permanently/, "the closed-note delete affordance is present");
  assert.match(browser, /msg\.projectSlug !== store\.get\('currentSlug'\)/, "stale project results are ignored");
  assert.match(browser, /setTimeout\(function \(\) \{/, "pending requests have a timeout");
  assert.match(browser, /notesDeletePending/, "pending delete authority is in the shared store");
  assert.doesNotMatch(browser, /dataset\.pendingRequest|var pendingDelete =/, "DOM dataset and module data do not authorize deletion");
  assert.match(browser, /event\.key === "Escape"/, "Escape handles the delete dialog");
  assert.match(browser, /event\.key !== "Tab"/, "the delete dialog traps Tab focus");
  assert.match(browser, /note_close/, "closing is offered");
  assert.match(browser, /note_reopen/, "reopening is offered");
  // The lifecycle vocabulary is Open/Closed/Close/Reopen, never Archive.
  assert.doesNotMatch(browser, /[Aa]rchive/, "Archive is not this lifecycle's word");
  var css = fs.readFileSync(path.join(base, "css", "sticky-notes.css"), "utf8");
  assert.doesNotMatch(css, /notes-archive/, "the retired archive styling is gone");
});

// --- the Logs contract agrees --------------------------------------------

test("the Issues attention contract keeps defect details primary", function () {
  assert.match(logsMcp.ATTENTION_CONTRACT, /Project Issues are the primary record for concrete actionable bugs, improvements, and deferred implementation/);
  assert.match(logsMcp.ATTENTION_CONTRACT, /proactively search or reuse an existing Issue, or create one/);
  assert.match(logsMcp.ATTENTION_CONTRACT, /create or reuse one short linked Sticky Note/);
  assert.match(logsMcp.ATTENTION_CONTRACT, /Reference related Issues in the Log instead of duplicating their full reports/);
  assert.match(logsMcp.ATTENTION_CONTRACT, /Authorized Project Drivers may close notes created by people or other sessions/);
  assert.match(logsMcp.ATTENTION_CONTRACT, /Close it, never delete it/);
  assert.doesNotMatch(logsMcp.ATTENTION_CONTRACT, /remove the Sticky Note|delete the Sticky Note/i);
  assert.match(logsMcp.ATTENTION_CONTRACT, /Never invent an issue reference, mirror storage automatically/);
  assert.match(logsMcp.ATTENTION_CONTRACT, /Notes written by people or by other sessions are not yours to mirror/);
});

test("the sticky-note memory contract tells agents to close, not erase", function () {
  var contract = require("../lib/session-notes-mcp-server").MEMORY_CONTRACT;
  assert.match(contract, /finishing it means closing it, never erasing it/);
  assert.match(contract, /call close_note/);
  assert.ok(sessionNotes.PROACTIVE_POLICY.indexOf(contract) === 0, "the policy still wraps the contract");
});
