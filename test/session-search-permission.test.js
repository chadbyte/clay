var test = require("node:test");
var assert = require("node:assert/strict");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

test("session discovery and reads skip approval only for exact native and MCP names", function () {
  var check = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {},
    send: function () {},
  }).checkToolWhitelist;
  var input = { query: "Orca" };
  var names = ["list_other_driver_sessions", "search_other_driver_sessions", "read_other_driver_session"];
  names.forEach(function (name) {
    assert.deepEqual(check(name, input), { behavior: "allow", updatedInput: input });
    assert.deepEqual(check("mcp__clay-handoff__" + name, input), { behavior: "allow", updatedInput: input });
    [
      name + "_extra",
      "mcp__other__" + name,
      "mcp__clay-handoff-extra__" + name,
      "mcp__clay-handoff__nested__" + name,
    ].forEach(function (invalidName) {
      assert.equal(check(invalidName, input), null);
    });
  });
  [
    "search_other_driver_sessions_extra",
    "mcp__other__search_other_driver_sessions",
    "mcp__clay-handoff-extra__search_other_driver_sessions",
    "mcp__clay-handoff__nested__search_other_driver_sessions",
    "mcp__clay-handoff__unknown_tool",
  ].forEach(function (name) {
    assert.equal(check(name, input), null);
  });
});
