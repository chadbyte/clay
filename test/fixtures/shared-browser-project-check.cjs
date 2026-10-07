// Smoke-check the production project's tool and WebSocket wiring without an LLM call.
var fs = require('fs');
var os = require('os');
var path = require('path');
var assert = require('node:assert/strict');
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-shared-browser-project-'));
process.env.CLAY_HOME = fixtureHome;
delete process.env.CLAY_DEV;
var relay = require('../../lib/server').createServer({ port: 0 });
var directory = path.join(fixtureHome, 'project');
fs.mkdirSync(directory);
relay.addProject(directory, 'browser-fixture', 'Browser fixture');
async function main() {
  var project;
  relay.forEachProject(function (value) { if (value.slug === 'browser-fixture') project = value; });
  assert.ok(project);
  var session = project.sm.createSession({ vendor: 'codex' });
  session._sdkQueryGeneration = 1;
  var bridge = project.getMcpBridgeHandler(session.localId, true, 1);
  var tools = await bridge.listTools();
  var tool = tools.find(function (value) { return value.server === 'clay-shared-browser' && value.name === 'shared_browser'; });
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties.action.enum.includes('inspect'), true);
  var result = await bridge.callTool('clay-shared-browser', 'shared_browser', { action: 'status' });
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), { browsers: [] });
  assert.ok(tool.inputSchema.properties.browserId);
  assert.ok(tool.inputSchema.properties.newTab);
  var messages = [];
  var ws = { readyState: 1, _clayActiveSession: session.localId, send: function (text) { messages.push(JSON.parse(text)); } };
  project.handleMessage(ws, { type: 'shared_browser_state_request', sessionId: session.localId });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(messages.some(function (value) { return value.type === 'shared_browser_state' && value.browser === null; }), true);
  session._sdkQueryGeneration = 2;
  assert.deepEqual(await bridge.listTools(), []);
  await assert.rejects(bridge.callTool('clay-shared-browser', 'shared_browser', { action: 'status' }));
  console.log('PASS: production project exposes the shared browser schema, binds the exact query, dispatches owner WebSocket state and rejects stale bridge calls');
}
main().then(function () { return relay.destroyAll(); }).then(function () { fs.rmSync(fixtureHome, { recursive: true, force: true }); process.exit(0); }).catch(function (error) { console.error(error); Promise.resolve(relay.destroyAll()).finally(function () { fs.rmSync(fixtureHome, { recursive: true, force: true }); process.exit(1); }); });
