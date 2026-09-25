var test = require("node:test");
var assert = require("node:assert/strict");
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

test("session search skips approval only for its exact native and MCP names", function () {
  var check = createSDKBridge({
    cwd: process.cwd(),
    sessionManager: {},
    adapter: {},
    send: function () {},
  }).checkToolWhitelist;
  var input = { query: "Orca" };
  var names = ["search_other_driver_sessions", "mcp__clay-handoff__search_other_driver_sessions"];
  names.forEach(function (name) {
    assert.deepEqual(check(name, input), { behavior: "allow", updatedInput: input });
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
