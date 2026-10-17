// Isolated production coordinator fixture: no provider query or vendor login.
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var createProject = require('../../lib/project').createProjectContext;
async function main() {
  var root = process.argv[2], sourceDir = path.join(root, 'source'), mateDir = path.join(root, 'mate');
  fs.mkdirSync(sourceDir); fs.mkdirSync(mateDir);
  var scheduler = require('../../lib/durable-scheduler').attachDurableScheduler({ namespace: 'mcp-fixture', storageDir: path.join(root, 'scheduler') });
  var source = createProject({ durableScheduler: scheduler, cwd: sourceDir, slug: 'source', port: 0 });
  var mate = createProject({ durableScheduler: scheduler, cwd: mateDir, slug: 'mate-fixture', isMate: true, port: 0 });
  var messages = [], ws = { readyState: 1, send: function (value) { messages.push(JSON.parse(value)); } };
  source.clients.add(ws);
  var mateWs = { readyState: 1, send: function () {} }; mate.clients.add(mateWs);
  var session = { localId: 900, ownerId: null, mode: 'gui', history: [], _sdkQueryGeneration: 4, vendor: 'codex' };
  mate.sm.sessions.set(900, session);
  try {
    source.handleMessage(ws, { type: 'mcp_servers_available', hostConnected: true, servers: [{ name: 'fixture', enabled: true, tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }] });
    mate.handleMessage(mateWs, { type: 'mcp_toggle_server', name: 'fixture', enabled: true });
    var bridge = mate.getMcpBridgeHandler(900, true, 4), catalog = await bridge.listTools();
    ['clay-notes', 'clay-documents', 'clay-github'].forEach(function (name) { assert.ok(catalog.some(function (tool) { return tool.server === name; }), name); });
    assert.ok(catalog.some(function (tool) { return tool.server === 'fixture' && tool.name === 'echo'; }));
    assert.equal(catalog.some(function (tool) { return tool.server === 'clay-issues' || tool.server === 'clay-logs'; }), false);
    var notes = await bridge.callTool('clay-notes', 'list_notes', {}); assert.equal(notes.isError, undefined);
    var doc = await bridge.callTool('clay-documents', 'present_markdown_edit', { path: 'new.md' }); assert.equal(JSON.parse(doc.content[0].text).ready, true);
    var links = await bridge.callTool('clay-github', 'get_session_github', {}); assert.deepEqual(JSON.parse(links.content[0].text).links, []);
    var call = bridge.callTool('fixture', 'echo', {});
    var request = messages.find(function (message) { return message.type === 'mcp_tool_call'; });
    assert.equal(request.slug, 'source');
    source.handleMessage(ws, { type: 'mcp_tool_result', callId: request.callId, result: { content: [{ type: 'text', text: 'production-coordinator' }] } });
    assert.equal((await call).content[0].text, 'production-coordinator');
    session._sdkQueryGeneration++;
    assert.deepEqual(await bridge.listTools(), []); await assert.rejects(bridge.callTool('fixture', 'echo', {}), /older query/);
    console.log('production coordinator parity and exact-query routing passed');
  } finally { source.destroy(); mate.destroy(); await scheduler.shutdown(); }
}
main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
