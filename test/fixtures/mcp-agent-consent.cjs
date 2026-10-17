// Actual project/SDK question and bridge paths in an isolated owner home.
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var root = process.argv[2], home = process.env.HOME, file = path.join(home, '.claude.json');
var notifications = require('../../lib/project-notifications').attachNotifications({});
var createProject = require('../../lib/project').createProjectContext;
var scheduler = require('../../lib/durable-scheduler').attachDurableScheduler({ namespace: 'agent-consent-fixture', storageDir: path.join(root, 'scheduler') });
function decoded(result) { return JSON.parse(result.content[0].text); }
async function main() {
  var projects = [];
  try {
    var cases = [{ name: 'driver', isMate: false, vendor: 'claude' }, { name: 'clay', isMate: true, isHostAgent: true, vendor: 'codex' }, { name: 'mate', isMate: true, vendor: 'kiro' }];
    for (var item of cases) {
      var cwd = path.join(root, item.name); fs.mkdirSync(cwd);
      fs.writeFileSync(file, JSON.stringify({ mcpServers: { consent: { command: 'never-start-agent-consent', args: [item.name, 'private-secret'] } } }));
      var project = createProject({ durableScheduler: scheduler, notificationsModule: notifications, cwd: cwd, slug: item.name, isMate: item.isMate, isHostAgent: !!item.isHostAgent, port: 0 }); projects.push(project);
      var session = { localId: 700, ownerId: null, mode: 'gui', vendor: item.vendor, history: [], _sdkQueryGeneration: 8, isProcessing: true, abortController: new AbortController(), pendingPermissions: {} }; project.sm.sessions.set(700, session);
      var events = [], ws = { readyState: 1, _clayActiveSession: 700, send: function (data) { events.push(JSON.parse(data)); } }; project.clients.add(ws);
      var detachHome = null;
      if (item.name === 'clay') { project.clients.delete(ws); detachHome = project.registerMcpConsentViewer(ws, session); ws._homeChatTap = { mateSlug: item.name, sessionId: 700, requestId: 'review' }; project.sm.subscribeSession(700, function (event) { events.push(event); }); }
      var legacy = project.getMcpBridgeHandler(700, false); assert.equal((await legacy.listTools()).some(function (tool) { return tool.server === 'clay-mcp-connections'; }), false); await assert.rejects(legacy.callTool('clay-mcp-connections', 'discover_mcp_connections', {}));
      var bridge = project.getMcpBridgeHandler(700, true, 8), tools = await bridge.listTools();
      ['discover_mcp_connections', 'propose_mcp_import'].forEach(function (name) { assert.ok(tools.some(function (tool) { return tool.server === 'clay-mcp-connections' && tool.name === name; }), item.name); });
      var scan = decoded(await bridge.callTool('clay-mcp-connections', 'discover_mcp_connections', {})); assert.equal(JSON.stringify(scan).includes('private-secret'), false);
      var request = { scanId: scan.scanId, candidateId: scan.candidates.find(function (row) { return row.vendor === 'claude' && row.name === 'consent'; }).id };
      var call = bridge.callTool('clay-mcp-connections', 'propose_mcp_import', request); await new Promise(function (resolve) { setImmediate(resolve); });
      var card = events.find(function (event) { return event.type === 'tool_executing' && event.source === 'mcp-import'; }); assert.ok(card, item.name);
      assert.equal(JSON.stringify(card).includes('private-secret'), false);
      if (item.name === 'clay') {
        var homeConsent = require('../../lib/server-home-mcp-consent').attachHomeMcpConsent({ findMateProject: function () { return { ctx: project, slug: item.name, mate: { id: 'clay-fixture' } }; }, resolveHomeSession: function () { return session; }, messageTap: function () { return ws._homeChatTap; }, isActorLive: function () { return true; }, sendError: function () { throw new Error('Home consent refused'); } });
        homeConsent.respond(ws, null, { mateId: 'clay-fixture', sessionId: 'local:700', requestId: 'review', toolId: card.id, answers: { 0: 'Import disabled copy' } });
      } else project.handleMessage(ws, { type: 'ask_user_response', toolId: card.id, answers: { 0: 'Import disabled copy' } });
      var imported = decoded(await call); assert.equal(imported.imported, true); assert.equal(imported.enabled, false);
      if (detachHome) { detachHome(); project.clients.add(ws); }
      project.handleMessage(ws, { type: 'mcp_state_request' });
      var state = events.filter(function (event) { return event.type === 'mcp_servers_state'; }).pop(); assert.equal(state.servers.find(function (row) { return row.id === imported.id; }).projectEnabled, false);
      project.handleMessage(ws, { type: 'ask_user_response', toolId: card.id, answers: { 0: 'Import disabled copy' } });
      assert.equal(decoded(await bridge.callTool('clay-mcp-connections', 'propose_mcp_import', request)).status, 'refused');
      session._sdkQueryGeneration = 9; assert.deepEqual(await bridge.listTools(), []); await assert.rejects(bridge.callTool('clay-mcp-connections', 'discover_mcp_connections', {}), /older query/);
      var resumed = project.getMcpBridgeHandler(700, true, 9); assert.ok((await resumed.listTools()).some(function (tool) { return tool.name === 'propose_mcp_import'; }));
      session.vendor = 'antigravity'; assert.equal((await resumed.listTools()).some(function (tool) { return tool.server === 'clay-mcp-connections'; }), false);
      console.log(item.name + ' production owner consent and resumed catalog passed');
    }
  } finally { projects.forEach(function (project) { project.destroy(); }); await scheduler.shutdown(); }
}
main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
