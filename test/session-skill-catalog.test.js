var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createCatalog = require("../lib/yoke/session-skill-catalog").createSessionSkillCatalog;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;

function fixture() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-session-skills-"));
  var cwd = path.join(root, "project");
  fs.mkdirSync(path.join(cwd, ".agents", "skills", "private"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".agents", "skills", "private", "SKILL.md"), "---\nname: private\ndescription: Private skill\n---\n");
  return { root: root, cwd: cwd };
}

test("session hydration combines vendor commands with the current shared skill inventory", function() {
  var f = fixture();
  try {
    var catalog = createCatalog({ cwd: f.cwd, homeDir: path.join(f.root, "empty-home"), getLinuxUser: function () { return null; } });
    var session = { vendor: "claude", vendorSlashCommands: ["/help", "/status"] };
    assert.deepStrictEqual(catalog.hydrate(session), ["/help", "/status", "private"]);
    assert.deepStrictEqual(session.skillNames, ["private"]);
    assert.deepStrictEqual(session.slashCommandsByVendor.claude, ["/help", "/status", "private"]);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("session hydration fails closed when a mapped identity cannot be resolved", function() {
  var f = fixture();
  try {
    var catalog = createCatalog({
      cwd: f.cwd,
      osUsers: true,
      getLinuxUser: function () { return "missing-user"; },
      resolveUser: function () { throw new Error("missing mapped identity"); },
    });
    var session = { vendor: "codex", vendorSlashCommands: ["/help"] };
    assert.deepStrictEqual(catalog.hydrate(session), ["/help"]);
    assert.deepStrictEqual(session.skillNames, []);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("SDK init and command updates route only the session catalog", function() {
  var targeted = [];
  var broadcast = [];
  var processor = attachMessageProcessor({
    sm: {
      sendToSession: function (session, message) { targeted.push(message); },
      sendAndRecord: function () {},
      broadcastSessionList: function () { broadcast.push(true); },
    },
    send: function (message) { broadcast.push(message); },
    adapter: { vendor: "claude" },
    discoverSkillDirs: function (options) {
      assert.strictEqual(options.homeDir, "/mapped/home");
      return { personal: "/mapped/home/.agents/skills/personal" };
    },
    mergeSkills: function (commands, discovered) {
      return new Set((commands || []).concat(Object.keys(discovered || {})));
    },
    getSessionSkillOptions: function () { return { homeDir: "/mapped/home" }; },
    onProcessingChanged: function () {},
    getNotificationsModule: function () { return null; },
    shouldSuppressResponseNotification: function () { return true; },
  });
  var session = { vendor: "claude", activeBackgroundTasks: [], blocks: {}, sentToolResults: {}, pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {}, activeTaskToolIds: {}, taskIdMap: {}, messageUUIDs: [] };

  processor.processSDKMessage(session, { yokeType: "init", skills: ["sdk-skill"], slashCommands: ["/help", "sdk-skill"] });
  assert.deepStrictEqual(session.vendorSlashCommands, ["/help"]);
  assert.deepStrictEqual(targeted.filter(function (message) { return message.type === "slash_commands"; })[0].commands, ["/help", "sdk-skill", "personal"]);
  assert.strictEqual(broadcast.filter(function (message) { return message && message.type === "slash_commands"; }).length, 0);

  targeted.length = 0;
  processor.processSDKMessage(session, { yokeType: "commands_changed", commandNames: ["/help", "/new", "personal"] });
  assert.deepStrictEqual(targeted.filter(function (message) { return message.type === "slash_commands"; })[0].commands, ["/help", "/new", "sdk-skill", "personal"]);
  assert.strictEqual(broadcast.filter(function (message) { return message && message.type === "slash_commands"; }).length, 0);
});
