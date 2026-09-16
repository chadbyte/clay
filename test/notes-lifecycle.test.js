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

// --- no destructive path --------------------------------------------------

test("no WebSocket or MCP path reaches permanent deletion", function () {
  var userMessage = fs.readFileSync(path.join(__dirname, "..", "lib", "project-user-message.js"), "utf8");
  var block = userMessage.substring(userMessage.indexOf("// --- Sticky notes ---"), userMessage.indexOf("// --- Web terminal ---"));
  assert.ok(block.length > 0, "the sticky-note dispatch block was found");
  assert.doesNotMatch(block, /nm\.remove\(/, "no message handler deletes a note");
  assert.match(block, /note_close/, "close is handled");
  assert.match(block, /note_reopen/, "reopen is handled");
  // The retired spelling is still accepted, and is routed to the same close.
  assert.match(block, /msg\.type === "note_close" \|\| msg\.type === "note_delete"/,
    "an older client's note_delete is handled as a close");
  assert.doesNotMatch(block, /type: "note_deleted"/, "note_deleted is never broadcast");

  var handlers = fs.readFileSync(path.join(__dirname, "..", "lib", "project-session-notes.js"), "utf8");
  assert.doesNotMatch(handlers, /nm\.remove\(/, "no MCP tool deletes a note");
});

test("the client offers no destructive control", function () {
  var base = path.join(__dirname, "..", "lib", "public");
  var browser = fs.readFileSync(path.join(base, "modules", "sticky-notes-browser.js"), "utf8");
  var canvas = fs.readFileSync(path.join(base, "modules", "sticky-notes.js"), "utf8");
  assert.doesNotMatch(browser, /note_delete/, "the browser never sends a delete");
  assert.doesNotMatch(canvas, /note_delete/, "the canvas never sends a delete");
  assert.doesNotMatch(browser, /trash-2|Delete permanently/, "no delete affordance survives");
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
  assert.match(logsMcp.ATTENTION_CONTRACT, /Do not create a mandatory duplicate Sticky Note/);
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
