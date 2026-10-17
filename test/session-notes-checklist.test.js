// Native checklist operations through the shared session note tools over the
// real notes manager. CLAY_HOME is a throwaway directory set before imports.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-notes-checklist-"));
process.env.CLAY_HOME = home;
delete process.env.CLAY_CONFIG;
test.after(function () { fs.rmSync(home, { recursive: true, force: true }); });
var notesModule = require("../lib/notes");
var sessionNotes = require("../lib/project-session-notes");
var codexModule = require("../lib/yoke/adapters/codex");

var counter = 0;
function fixture() {
  var cwd = path.join(home, "project-" + (++counter));
  fs.mkdirSync(cwd, { recursive: true });
  var nm = notesModule.createNotesManager({ cwd: cwd });
  var caller = { localId: 7, vendor: "codex", title: "Driver" };
  var sent = [];
  var authorized = true;
  var attached = sessionNotes.attachSessionNotes({
    nm: nm, isMate: false,
    canUseSession: function (session) { return authorized && session === caller; },
    send: function (message) { sent.push(message); },
  });
  var tools = {};
  attached.getToolDefs(caller).forEach(function (tool) { tools[tool.name] = tool; });
  async function call(name, args) {
    var result = await tools[name].handler(args);
    var text = result.content[0].text;
    return result.isError ? { error: text } : JSON.parse(text);
  }
  return { nm: nm, cwd: cwd, call: call, attached: attached, sent: sent, tools: tools,
    revoke: function () { authorized = false; } };
}

function itemByText(note, text) {
  return note.checklist.items.find(function (item) { return item.text === text; });
}

test("write_note creates a native checklist and list_notes reports authoritative items and version", async function () {
  var f = fixture();
  var created = await f.call("write_note", { text: "Release\n- [ ] build\n- [x] docs\n## Later\nship", checklist: true });
  assert.equal(created.checklistMode, true);
  assert.equal(created.version, created.updatedAt);
  var listed = (await f.call("list_notes", {}))[0];
  assert.deepEqual(listed.checklist.items.map(function (item) { return [item.text, item.checked, item.saved]; }),
    [["build", false, null], ["docs", true, null], ["ship", false, null]]);
  assert.equal(listed.checklist.completed, 1);
  assert.equal(listed.checklist.total, 3);
  assert.equal(f.nm.list()[0].checklistMode, true, "mode is persisted by the notes manager");
  var ordinary = await f.call("write_note", { text: "Port 2633 is reserved" });
  assert.equal(ordinary.checklistMode, false);
  assert.equal(ordinary.checklist, undefined);
});

test("checks require the current version and exact item keys, and preserve the note text", async function () {
  var f = fixture();
  var created = await f.call("write_note", { text: "Release\n- [ ] build\n- [x] docs", checklist: true });
  var build = itemByText(created, "build");
  var stale = await f.call("write_note", { id: created.id, version: created.version - 1, checks: [{ item: build.item, checked: true }] });
  assert.match(stale.error, /has changed or the version is missing/);
  var missing = await f.call("write_note", { id: created.id, checks: [{ item: build.item, checked: true }] });
  assert.match(missing.error, /version is missing/);
  var unknown = await f.call("write_note", { id: created.id, version: created.version, checks: [{ item: encodeURIComponent("- [ ] gone\u00000"), checked: true }] });
  assert.match(unknown.error, /checklist item not found/);
  assert.equal(f.nm.list()[0].updatedAt, created.version, "refused writes change nothing");

  var checked = await f.call("write_note", { id: created.id, version: created.version, checks: [{ item: build.item, checked: true }] });
  assert.ok(checked.version > created.version);
  assert.equal(checked.text, "Release\n- [ ] build\n- [x] docs", "a check never rewrites Markdown");
  assert.deepEqual([itemByText(checked, "build").checked, itemByText(checked, "build").saved], [true, true]);
  var reused = await f.call("write_note", { id: created.id, version: created.version, checks: [{ item: build.item, checked: false }] });
  assert.match(reused.error, /has changed/, "the previous version cannot be replayed after a successful check");

  var reopened = notesModule.createNotesManager({ cwd: f.cwd }).list()[0];
  assert.equal(reopened.checklistState[decodeURIComponent(build.item)], true, "the saved check is on disk");
});

test("an explicit saved false overrides a Markdown x in list, prompt and Mate knowledge text", async function () {
  var f = fixture();
  var created = await f.call("write_note", { text: "Release\n- [ ] build\n- [x] docs", checklist: true });
  var docs = itemByText(created, "docs");
  var unchecked = await f.call("write_note", { id: created.id, version: created.version, checks: [{ item: docs.item, checked: false }] });
  assert.deepEqual([itemByText(unchecked, "docs").checked, itemByText(unchecked, "docs").saved], [false, false]);
  assert.equal(unchecked.checklist.effectiveText, "Release\n- [ ] build\n- [ ] docs");
  var prompt = f.attached.getSystemPrompt();
  assert.match(prompt, /- \[purple\] \[checklist\] Release\n- \[ \] build\n- \[ \] docs/);
  assert.doesNotMatch(prompt, /\[x\] docs/);
  assert.doesNotMatch(f.nm.getActiveNotesText(), /\[x\] docs/);
});

test("checklist text edits need the version, keep unchanged marks and report dropped saved checks", async function () {
  var f = fixture();
  var created = await f.call("write_note", { text: "Release\n- [ ] build\n- [ ] docs", checklist: true });
  var marked = await f.call("write_note", { id: created.id, version: created.version, checks: [
    { item: itemByText(created, "build").item, checked: true },
    { item: itemByText(created, "docs").item, checked: true },
  ] });
  var noVersion = await f.call("write_note", { id: created.id, text: "Release\n- [ ] build\n- [ ] docs\n- [ ] tag" });
  assert.match(noVersion.error, /version is missing/);
  var mixed = await f.call("write_note", { id: created.id, version: marked.version, text: "Release\n- [ ] build", checks: [{ item: itemByText(marked, "build").item, checked: false }] });
  assert.match(mixed.error, /separate calls/);
  var edited = await f.call("write_note", { id: created.id, version: marked.version, text: "Release\n- [ ] build\n- [ ] write docs\n- [ ] tag" });
  assert.equal(itemByText(edited, "build").checked, true, "an unchanged line keeps its saved mark");
  assert.equal(itemByText(edited, "write docs").checked, false);
  assert.deepEqual(edited.droppedSavedChecks, [{ text: "docs", checked: true }]);
  var emptied = await f.call("write_note", { id: created.id, version: edited.version, text: "   " });
  assert.match(emptied.error, /must not be empty/);
});

test("mode switches keep content and marks, require the version, and never use the destructive convert", async function () {
  var f = fixture();
  var plain = await f.call("write_note", { text: "Ideas\n- [x] sketch\nprototype" });
  var unversioned = await f.call("write_note", { id: plain.id, checklist: true });
  assert.match(unversioned.error, /version is missing/);
  var asChecklist = await f.call("write_note", { id: plain.id, version: plain.version, checklist: true });
  assert.equal(asChecklist.text, "Ideas\n- [x] sketch\nprototype");
  assert.deepEqual(asChecklist.checklist.items.map(function (item) { return [item.text, item.checked]; }), [["sketch", true], ["prototype", false]]);
  var checked = await f.call("write_note", { id: plain.id, version: asChecklist.version, checks: [{ item: itemByText(asChecklist, "prototype").item, checked: true }] });
  var back = await f.call("write_note", { id: plain.id, version: checked.version, checklist: false });
  assert.equal(back.checklistMode, false);
  assert.equal(back.text, "Ideas\n- [x] sketch\nprototype");
  var again = await f.call("write_note", { id: plain.id, version: back.version, checklist: true });
  assert.equal(itemByText(again, "prototype").checked, true, "saved marks survive a round trip through ordinary mode");
});

test("ordinary note writes stay compatible and invalid checklist requests are refused", async function () {
  var f = fixture();
  var plain = await f.call("write_note", { text: "Use port 2633", color: "yellow" });
  var updated = await f.call("write_note", { id: plain.id, text: "Use port 2634" });
  assert.equal(updated.text, "Use port 2634");
  var recoloured = await f.call("write_note", { id: plain.id, color: "blue" });
  assert.equal(recoloured.color, "blue");
  assert.equal(recoloured.text, "Use port 2634");
  var same = await f.call("write_note", { id: plain.id, text: "Use port 2634" });
  assert.equal(same.unchanged, true);
  assert.equal(same.version, recoloured.version, "an identical write does not bump the version");
  assert.match((await f.call("write_note", { id: plain.id })).error, /nothing to change/);
  assert.match((await f.call("write_note", { id: plain.id, version: recoloured.version, checks: [{ item: "x", checked: true }] })).error, /only to checklist notes/);
  assert.match((await f.call("write_note", { text: "New\n- [ ] a", checklist: true, checks: [{ item: "x", checked: true }] })).error, /apply to an existing note/);
  assert.match((await f.call("write_note", { id: plain.id, checklist: "yes" })).error, /checklist must be true or false/);
  assert.match((await f.call("write_note", { id: plain.id, version: recoloured.version, checks: [{ item: 3 }] })).error, /each checks entry/);
  assert.match((await f.call("write_note", { color: "blue" })).error, /text is required/);
});

test("the shared write_note schema reaches Codex with the checklist fields", async function () {
  var f = fixture();
  var calls = [];
  var server = {
    started: true,
    addHandler: function () { return { threadId: null, fn: function () {} }; },
    removeHandler: function () {},
    send: function (method, params) { calls.push({ method: method, params: params }); return Promise.resolve(method === "thread/start" ? { thread: { id: "notes-thread" } } : {}); },
  };
  var defs = f.attached.getToolDefs({ localId: 7, vendor: "codex", title: "Driver" });
  assert.deepEqual(defs, [], "a foreign session binding receives no note tools");
  var handle = codexModule.contractTestKit.createQueryHandle(server, {
    cwd: f.cwd, model: "gpt-test", abortController: new AbortController(),
    dynamicTools: Object.keys(f.tools).map(function (name) { return f.tools[name]; }),
  });
  handle.pushMessage("Hello");
  await new Promise(function (resolve) { setImmediate(resolve); });
  handle.close();
  var start = calls.find(function (call) { return call.method === "thread/start"; });
  var write = start.params.dynamicTools.find(function (tool) { return tool.name === "write_note"; });
  var props = write.inputSchema.properties;
  assert.equal(props.checklist.type, "boolean");
  assert.equal(props.version.type, "number");
  assert.equal(props.checks.type, "array");
  assert.deepEqual(Object.keys(props.checks.items.properties).sort(), ["checked", "item"]);
  assert.equal((write.inputSchema.required || []).indexOf("text"), -1, "text is optional for checklist-only updates");
  assert.match(write.description, /Native checklists/);
  assert.match(write.description, /explicitly asks for a working checklist/);
  assert.match(write.description, /never start a checklist the user did not ask for/);
  // The week-later retention test must exempt the requested working checklist, matching MEMORY_CONTRACT.
  assert.match(write.description, /other than confirmed Issue link notes and a working checklist the user explicitly asked for, apply this test: would the user likely choose to keep this visible on their board next week\?/);
});

test("duplicate identical checklist lines keep separate exact identities", async function () {
  var f = fixture();
  var created = await f.call("write_note", { text: "Groceries\n- [ ] milk\n- [ ] milk\n- [ ] eggs", checklist: true });
  var milks = created.checklist.items.filter(function (item) { return item.text === "milk"; });
  assert.equal(milks.length, 2);
  assert.notEqual(milks[0].item, milks[1].item, "each occurrence has its own key");
  var checked = await f.call("write_note", { id: created.id, version: created.version, checks: [{ item: milks[1].item, checked: true }] });
  assert.deepEqual(checked.checklist.items.map(function (item) { return [item.text, item.checked]; }), [["milk", false], ["milk", true], ["eggs", false]]);
  assert.match(f.attached.getSystemPrompt(), /- \[ \] milk\n- \[x\] milk\n- \[ \] eggs/);
  var conflicting = await f.call("write_note", { id: created.id, version: checked.version, checks: [{ item: milks[0].item, checked: true }, { item: milks[0].item, checked: false }] });
  assert.match(conflicting.error, /same item more than once/);
  // Removing the first duplicate shifts occurrences, so the second line's saved mark no longer applies and is reported.
  var edited = await f.call("write_note", { id: created.id, version: checked.version, text: "Groceries\n- [ ] milk\n- [ ] eggs" });
  assert.deepEqual(edited.checklist.items.map(function (item) { return [item.text, item.checked]; }), [["milk", false], ["eggs", false]]);
  assert.deepEqual(edited.droppedSavedChecks, [{ text: "milk", checked: true }]);
  var staleKey = await f.call("write_note", { id: created.id, version: edited.version, checks: [{ item: milks[1].item, checked: true }] });
  assert.match(staleKey.error, /checklist item not found/, "a key for a vanished occurrence is refused");
});

test("a revoked session cannot list, create, check or edit notes", async function () {
  var f = fixture();
  var created = await f.call("write_note", { text: "Release\n- [ ] build", checklist: true });
  var before = JSON.stringify(f.nm.list());
  // Reloading projects legacy lifecycle fields, so compare disk with disk.
  var beforeDisk = JSON.stringify(notesModule.createNotesManager({ cwd: f.cwd }).list());
  var sentBefore = f.sent.length;
  f.revoke();
  var refusals = [
    await f.call("list_notes", {}),
    await f.call("write_note", { text: "Another note" }),
    await f.call("write_note", { id: created.id, version: created.version, checks: [{ item: created.checklist.items[0].item, checked: true }] }),
    await f.call("write_note", { id: created.id, version: created.version, text: "Release\n- [x] build" }),
    await f.call("close_note", { id: created.id }),
  ];
  refusals.forEach(function (result) { assert.match(result.error, /live authorized session|no longer has access/); });
  assert.equal(JSON.stringify(f.nm.list()), before, "nothing changed in storage");
  assert.equal(JSON.stringify(notesModule.createNotesManager({ cwd: f.cwd }).list()), beforeDisk, "nothing changed on disk");
  assert.equal(f.sent.length, sentBefore, "no broadcast was sent");
  assert.deepEqual(f.attached.getToolDefs({ localId: 7, vendor: "codex" }), [], "a revoked binding receives no tools");
});
