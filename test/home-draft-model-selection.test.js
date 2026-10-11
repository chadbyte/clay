var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

async function loadConfirmationModule() {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/home-session-model-confirmation.js"), "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

test("confirmed draft model applies to the exact session and promotes its durable identity", async function () {
  var helpers = await loadConfirmationModule();
  var exact = helpers.confirmedHomeSessionModel({ mateId: "mate-a", sessionId: "draft-a" }, {
    mateId: "mate-a", requestedSessionId: "draft-a", sessionId: "draft-a", sessionApplied: true,
    sessionVendor: "codex", sessionModel: "gpt-5.6",
  });
  assert.deepEqual(exact, { sessionId: "draft-a", vendor: "codex", model: "gpt-5.6" });

  var promoted = helpers.confirmedHomeSessionModel({ mateId: "mate-a", sessionId: "local:11" }, {
    mateId: "mate-a", requestedSessionId: "local:11", sessionId: "durable-11", sessionApplied: true,
    sessionVendor: "claude", sessionModel: "sonnet",
  });
  assert.deepEqual(promoted, { sessionId: "durable-11", vendor: "claude", model: "sonnet" });
});

test("stale, different-Mate, and non-applied model confirmations cannot overwrite the composer", async function () {
  var helpers = await loadConfirmationModule();
  var active = { mateId: "mate-a", sessionId: "draft-a" };
  var base = { mateId: "mate-a", requestedSessionId: "draft-b", sessionId: "draft-b", sessionApplied: true, sessionVendor: "codex", sessionModel: "gpt-5.6" };
  assert.equal(helpers.confirmedHomeSessionModel(active, base), null);
  assert.equal(helpers.confirmedHomeSessionModel(active, Object.assign({}, base, { mateId: "mate-b", requestedSessionId: "draft-a", sessionId: "draft-a" })), null);
  assert.equal(helpers.confirmedHomeSessionModel(active, Object.assign({}, base, { requestedSessionId: "draft-a", sessionId: "draft-a", sessionApplied: false })), null);
});

test("composer chooser opens Model settings with its exact pristine session", function () {
  var chat = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
  var picker = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-model-picker.js"), "utf8");
  var settings = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-settings.js"), "utf8");
  assert.match(chat, /openHomeMateSettings\(mate\.id, sessionModelChooseEl, \{ section: "model", sessionId: store\.get\('homeChatSessionId'\) \}\)/);
  assert.match(picker, /if \(s\.sessionId\) message\.sessionId = s\.sessionId/);
  assert.match(settings, /resetHomeMateModelPicker\(mateId, getMateName\(mate\), mate, options && options\.sessionId\)/);
  assert.match(chat, /export function openHomeMateAction\(kind, initialTopic\)/);
});
