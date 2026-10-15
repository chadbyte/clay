var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var source = fs.readFileSync(path.join(__dirname, "../lib/public/modules/app-messages.js"), "utf8");

test("tool activity replaces the generic bouncing indicator", function () {
  assert.match(source, /case "tool_start":\s*removeMatePreThinking\(\);\s*stopThinking\(\);\s*setActivity\(null\);/);
});

test("permission prompts clear visible and stored activity", function () {
  ['permission_request', 'permission_request_pending'].forEach(function (type) {
    var client = require('./helpers/project-stream-client.cjs').create();
    client.dispatch({ type: 'turn_activity', phase: 'waiting' });
    client.dispatch({ type: type, requestId: 'review', toolName: 'Bash', toolInput: {} });
    assert.equal(client.activity(), null);
    assert.equal(client.context.store.get('turnActivity'), null);
    assert.equal(client.calls.renderPermissionRequest, 1);
    assert.deepEqual(client.errors, []);
  });
});

test("live Thinking suppresses duplicate generic and running activity only", function () {
  var client = require('./helpers/project-stream-client.cjs').create();
  client.context.store.set({ thinkingState: { active: true } });
  ['thinking', 'running'].forEach(function (phase) {
    client.context.setActivity(phase);
    assert.equal(client.context.getActivityEl(), null);
  });
  ['waiting', 'background', 'compacting'].forEach(function (phase) {
    client.context.setActivity(phase);
    assert.ok(client.context.getActivityEl(), phase + ' must remain distinct from Thinking');
  });
  assert.deepEqual(client.errors, []);
  assert.match(source, /case "compacting":[\s\S]*setActivity\("compacting"\)/);
});
