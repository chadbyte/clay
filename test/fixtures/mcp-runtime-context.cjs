// Exercise the production coordinator's runtime source resolver in an isolated home.
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var root = process.argv[2], cwd = path.join(root, 'workspace'), custom = path.join(root, 'custom-codex');
fs.mkdirSync(cwd); fs.mkdirSync(custom); fs.writeFileSync(path.join(custom, 'config.toml'), '[mcp_servers.runtime_root]\ncommand="node"');
var scheduler = require('../../lib/durable-scheduler').attachDurableScheduler({ namespace: 'runtime-source-fixture', storageDir: path.join(root, 'scheduler') });
var project = require('../../lib/project').createProjectContext({ durableScheduler: scheduler, cwd: cwd, slug: 'runtime-source', port: 0,
  onGetProjectEnv: function () { return { envrc: 'CODEX_HOME=' + JSON.stringify(custom) + '\nOPENCODE_CONFIG_CONTENT=\'{"mcp":{"inline":{"type":"local","command":["node"]}}}\'' }; } });
var messages = [], ws = { readyState: 1, send: function (data) { messages.push(JSON.parse(data)); } }; project.clients.add(ws);
async function main() {
  try {
    project.handleMessage(ws, { type: 'mcp_discovery_request', requestId: 'runtime' });
    var result = messages.find(function (msg) { return msg.type === 'mcp_discovery_result'; }); assert.equal(result.ok, true);
    assert.ok(result.candidates.some(function (row) { return row.name === 'runtime_root' && row.file === path.join(custom, 'config.toml'); }));
    assert.ok(result.candidates.some(function (row) { return row.name === 'inline' && row.scope === 'runtime-inline'; }));
    assert.equal(JSON.stringify(result).includes('command'), false); console.log('production runtime root and inline discovery passed');
  } finally { project.destroy(); await scheduler.shutdown(); }
}
main().then(function () { process.exit(0); }, function (error) { console.error(error.stack); process.exit(1); });
