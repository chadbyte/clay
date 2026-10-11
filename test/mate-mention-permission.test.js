var test = require("node:test");
var assert = require("node:assert/strict");
var attachMateInteraction = require("../lib/project-mate-interaction").attachMateInteraction;

function fixture(mode, projectMode) {
  var session = { localId: 1, permissionMode: mode, history: [], pendingPermissions: {} };
  var mate = { id: "mate-1", name: "Reviewer", vendor: "claude" };
  var captures = [];
  var events = [];
  var continued = 0;
  var sm = { currentPermissionMode: projectMode, appendToSessionFile: function () {} };
  var interaction = attachMateInteraction({
    cwd: process.cwd(), sm: sm,
    sdk: {
      checkToolWhitelist: function () { return null; },
      createMentionSession: function (opts) {
        captures.push(opts);
        return Promise.resolve({
          isAlive: function () { return true; },
          pushMessage: function () { continued++; },
          close: function () {},
        });
      },
    },
    matesModule: {
      buildMateCtx: function () { return {}; },
      getMate: function () { return mate; },
      getMateDir: function () { return "/nonexistent-clay-test-mate"; },
    },
    getSessionForWs: function () { return session; },
    getLinuxUserForSession: function () { return null; },
    send: function () {}, sendTo: function () {}, sendToSessionOthers: function () {},
    sendToSession: function (id, event) { events.push(event); },
    hydrateImageRefs: function (entry) { return entry; },
    loadMateDigests: function () { return ""; },
    onProcessingChanged: function () {},
  });
  return {
    session: session, mate: mate, sm: sm, captures: captures, events: events,
    continued: function () { return continued; },
    mention: async function () {
      interaction.handleMention({}, { mateId: mate.id, text: "Please edit the file." });
      await Promise.resolve();
    },
  };
}

async function expectPrompt(f, toolName) {
  var pending = f.captures[0].canUseTool(toolName, { value: "test" }, {});
  var request = f.events[f.events.length - 1];
  assert.equal(request.type, "permission_request");
  assert.equal(request.toolName, toolName);
  assert.equal(request.mateId, f.mate.id);
  f.session.pendingPermissions[request.requestId].resolve({ behavior: "deny" });
  assert.equal((await pending).behavior, "deny");
  delete f.session.pendingPermissions[request.requestId];
}

test("mentioned Mate follows session Skip without changing saved Mate settings", async function () {
  var f = fixture("bypassPermissions", "default");
  var saved = JSON.stringify(f.mate);
  await f.mention();
  var input = { command: "touch example" };
  assert.deepEqual(await f.captures[0].canUseTool("Bash", input, {}), { behavior: "allow", updatedInput: input });
  assert.equal(Object.keys(f.session.pendingPermissions).length, 0);
  assert.equal(JSON.stringify(f.mate), saved);
  await expectPrompt(f, "AskUserQuestion");
});

test("explicit session Ask overrides project Skip and remains isolated", async function () {
  var ask = fixture("default", "bypassPermissions");
  var skip = fixture("bypassPermissions", "default");
  await ask.mention();
  await skip.mention();
  await expectPrompt(ask, "Write");
  assert.equal((await skip.captures[0].canUseTool("Write", {}, {})).behavior, "allow");
});

test("reused mention checks live session mode in both directions", async function () {
  var f = fixture("bypassPermissions", "default");
  await f.mention();
  f.session._mentionInProgress = false;
  f.session.history.push({ type: "mention_response", mateId: f.mate.id, mateName: f.mate.name, text: "Done" });
  f.session.permissionMode = "default";
  await f.mention();
  assert.equal(f.captures.length, 1);
  assert.equal(f.continued(), 1);
  await expectPrompt(f, "Write");
  f.session.permissionMode = "bypassPermissions";
  assert.equal((await f.captures[0].canUseTool("Write", {}, {})).behavior, "allow");
});

test("unset session mode falls back to the current project default", async function () {
  var f = fixture(undefined, "bypassPermissions");
  await f.mention();
  assert.equal((await f.captures[0].canUseTool("Write", {}, {})).behavior, "allow");
  f.sm.currentPermissionMode = "default";
  await expectPrompt(f, "Write");
});
