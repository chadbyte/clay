// Isolate storage before importing production modules. No provider or remote Git calls.
var fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
var root = process.argv[2];
if (!root || process.env.HOME !== root || process.env.CLAY_HOME !== path.join(root, '.clay')) throw new Error('Isolated HOME and CLAY_HOME must be assigned before imports.');
var config = require('../../lib/config'); config.ensureConfigDir();
['execFile', 'execFileSync', 'spawn', 'spawnSync'].forEach(function (name) {
  var original = cp[name]; cp[name] = function (command, args) {
    if (/^(claude|codex|copilot|opencode)(?:\.exe)?$/.test(path.basename(String(command)))) throw new Error('Live provider processes are forbidden in this fixture.');
    if (command === 'git' && (args || []).some(function (arg) { return ['commit', 'commit-tree', 'push', 'pull', 'fetch'].indexOf(arg) >= 0; })) throw new Error('Commits and remote Git are forbidden in this fixture.');
    return original.apply(cp, arguments);
  };
});
var yoke = require('../../lib/yoke');
yoke.createAdapters = function () {
  var adapters = {};
  ['claude', 'codex'].forEach(function (vendor) {
    adapters[vendor] = { vendor: vendor, init: async function () { return { models: [{ value: 'fixture-model', displayName: 'Fixture model' }], slashCommands: [], capabilities: { effort: true } }; },
      createToolServer: function (definition) { return definition; }, shutdown: function () {},
      createQuery: function () { throw new Error('Live model execution is forbidden.'); } };
  });
  return { adapters: adapters, auth: { claude: true, codex: true } };
};
yoke.completeOnce = function () { return Promise.reject(new Error('Live completion is forbidden.')); };
require('../../lib/updater').fetchVersion = function () { return Promise.resolve(null); };
require('../../lib/updater').fetchLatestVersion = function () { return Promise.resolve(null); };
require('../../lib/claude-hook-installer').installNotificationHook = function () { return { installed: [], errors: [] }; };
require('../../lib/claude-hook-installer').installAllowList = function () { return { installed: [], errors: [] }; };
var users = require('../../lib/users'), mates = require('../../lib/mates');
users.saveUsers({ multiUser: true, users: [
  { id: 'owner', username: 'fixture-owner', displayName: 'Fixture Owner', role: 'admin', pinHash: 'fixture-only', homeSurfacePreference: { surface: 'home', projectSlug: null } },
  { id: 'foreign', username: 'fixture-other', role: 'admin', pinHash: 'fixture-only' }
], invites: [] });
fs.writeFileSync(path.join(config.CONFIG_DIR, 'auth-tokens.json'), JSON.stringify({ 'fixture-owner-token': 'owner', 'fixture-foreign-token': 'foreign' }));
var mateCtx = mates.buildMateCtx('owner'); mates.ensureBuiltinMates(mateCtx);
var clay = mates.getAllMates(mateCtx).find(function (mate) { return mate.builtinKey === 'clay'; });
var access = {}, contexts = new Map(), results = [], sequence = 0;
var relay = require('../../lib/server').createServer({ port: 0,
  onGetProjectAccess: function (slug) { return access[slug] || { error: 'No fixture project' }; }
});
function add(slug, name, mate) {
  var directory = mate ? mates.getMateDir(mateCtx, mate.id) : path.join(root, slug);
  fs.mkdirSync(directory, { recursive: true });
  access[slug] = { slug: slug, ownerId: 'owner', visibility: 'private', allowedUsers: [] };
  relay.addProject(directory, slug, name, null, 'owner', null, mate ? { isMate: true, mateId: mate.id, isHostAgent: true } : null);
  relay.forEachProject(function (project, key) { contexts.set(key, project); });
  return contexts.get(slug);
}
var sourceSlug = 'mate-' + clay.id, source = add(sourceSlug, 'Clay', clay);
var alpha = add('alpha', 'Alpha integration'), beta = add('beta', 'Beta integration');
function session(project, title, text) {
  var item = project.getSessionManager().createSession({ ownerId: 'owner', vendor: 'claude', sessionVisibility: 'private' });
  item.model = 'fixture-model'; item.title = title;
  project.getSessionManager().sendAndRecord(item, { type: 'delta', text: text, _ts: Date.now() });
  project.getSessionManager().sendAndRecord(item, { type: 'done', _ts: Date.now() });
  project.getSessionManager().saveSessionFile(item); return item;
}
var sourceSession = session(source, 'Canonical integration source', 'Isolated canonical integration conversation.');
sourceSession._sdkQueryGeneration = 8; sourceSession.abortController = new AbortController();
var activeSessions = {}; activeSessions[clay.id] = 'local:' + sourceSession.localId;
users.setHomeSurfacePreference('owner', { surface: 'home', activeMateId: clay.id, activeSessionByMate: activeSessions, onboardingStep: 'complete' });
var alphaSession = session(alpha, 'Alpha destination', 'ALPHA_RENDERED_DESTINATION');
var betaSession = session(beta, 'Beta destination', 'BETA_RENDERED_DESTINATION');
function controller() {
  var candidates = Array.from(source.getSessionManager().sessions.values()).filter(function (item) { return item.ownerId === 'owner' && !item.hidden; });
  return candidates.find(function (item) { return item.localId === sourceSession.localId; }) || sourceSession;
}
async function call(name, args) {
  var item = controller();
  var result = await source.getMcpBridgeHandler(item.localId, true, Number(item._sdkQueryGeneration || 0)).callTool('clay-workspace', name, args || {});
  return JSON.parse(result.content[0].text);
}
async function propose(viewerKind, destination) {
  var read = await call('read_owner_screen', { action: 'screen_context' });
  var selected = (read.viewers || []).find(function (viewer) { return viewer.projectSlug === (viewerKind === 'global' ? null : viewerKind === 'mate' ? sourceSlug : viewerKind); });
  if (!selected) throw new Error('Exact fixture viewer not found: ' + JSON.stringify(read));
  var target = destination === 'alpha' ? alphaSession : betaSession;
  var inspected = await call('inspect_owner_screen_change', { operation: { action: 'navigate', viewerRef: selected.viewerRef, projectSlug: destination, sessionRef: require('../../lib/workspace-query-service').sessionRef(destination, target) } });
  if (!inspected.targetToken) throw new Error(JSON.stringify(inspected));
  var result = await call('control_owner_screen', { targetToken: inspected.targetToken, requestId: 'integration-' + (++sequence), why: 'Open the exact isolated ' + destination + ' destination' });
  results.push(result); return result;
}
var originalRequests = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', async function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/fixture/')) { originalRequests.forEach(function (handler) { handler(req, res); }); return; }
  if (url.pathname === '/fixture/login') {
    var to = url.searchParams.get('to') === 'global' ? '/fixture/global' : '/p/' + sourceSlug + '/';
    res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=fixture-owner-token; Path=/; HttpOnly; SameSite=Strict', Location: to }); res.end(); return;
  }
  if (!String(req.headers.cookie || '').includes('relay_auth_user=fixture-owner-token')) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/fixture/global.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(__dirname, 'clay-final-home-browser.mjs'), 'utf8').replaceAll('FIXTURE_MATE_ID', clay.id).replaceAll('FIXTURE_SOURCE_SESSION', String(sourceSession.localId))); return; }
  if (url.pathname === '/fixture/global') {
    var html = fs.readFileSync(path.join(__dirname, '../../lib/public/index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html'); res.end(html.replace('<head>', '<head><base href="/">').replace('</body>', '<script type="module" src="/fixture/global.js"></script></body>')); return;
  }
  try {
    var data;
    if (url.pathname === '/fixture/propose') data = await propose(url.searchParams.get('viewer') || 'mate', url.searchParams.get('target') === 'alpha' ? 'alpha' : 'beta');
    else if (url.pathname === '/fixture/state') data = { sourceSlug: sourceSlug, sourceSessionId: sourceSession.localId, alphaSessionId: alphaSession.localId, betaSessionId: betaSession.localId, results: results, screen: await call('read_owner_screen', { action: 'screen_context' }), sessions: Array.from(source.getSessionManager().sessions.values()).map(function (item) { return { id: item.localId, title: item.title, pending: Object.keys(item.pendingAskUser || {}) }; }) };
    else if (url.pathname === '/fixture/catalog') data = await catalog();
    else { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data));
  } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
});
async function catalog() {
  var item = controller(), originalVendor = item.vendor, originalGeneration = item._sdkQueryGeneration;
  var definitions = require('../../lib/clay-product-control-tools').getToolDefs(null), expected = definitions.map(function (tool) { return tool.name; }).sort(), rows = [];
  var assert = require('node:assert/strict');
  for (var vendor of ['claude', 'codex']) {
    item.vendor = vendor;
    for (var fresh of [true, false]) {
      var tools = await source.getMcpBridgeHandler(item.localId, fresh, Number(item._sdkQueryGeneration || 0)).listTools();
      var actual = tools.filter(function (tool) { return expected.includes(tool.name); }).map(function (tool) { return tool.name; }).sort();
      assert.deepEqual(actual, expected);
      assert.equal(tools.some(function (tool) { return tool.name === 'list_project_session_pull_requests'; }), false);
      rows.push({ vendor: vendor, fresh: fresh, controls: actual.length });
    }
  }
  item.vendor = originalVendor;
  // Native construction uses the same production attachment with the actual source registry and query.
  var service = require('../../lib/workspace-query-service').attachWorkspaceQueryService({ getProjects: function () { return contexts; }, isMultiUser: users.isMultiUser, onGetProjectAccess: function (slug) { return access[slug]; }, canAccessProject: users.canAccessProject, resolveMate: function (owner, id) { return mates.getMate(mates.buildMateCtx(owner), id); } });
  var controlService = require('../../lib/clay-product-control').attachClayProductControl({ getProjects: function () { return contexts; }, isMultiUser: users.isMultiUser, onGetProjectAccess: function (slug) { return access[slug]; }, canAccessProject: users.canAccessProject, findUser: users.findUserById, resolveMate: function (owner, id) { return mates.getMate(mates.buildMateCtx(owner), id); } });
  var attached = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: service, controlService: controlService, sm: source.getSessionManager(), projectSlug: sourceSlug, getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: clay.id });
  var native = attached.createMcpServer({ createToolServer: function (value) { return value; } }, item);
  assert.deepEqual(attached.getDynamicToolDefs(item).filter(function (tool) { return expected.includes(tool.name); }).map(function (tool) { return tool.name; }).sort(), expected);
  assert.deepEqual(native.tools.filter(function (tool) { return expected.includes(tool.name); }).map(function (tool) { return tool.name; }).sort(), expected);
  var oldBridge = source.getMcpBridgeHandler(item.localId, true, Number(item._sdkQueryGeneration || 0));
  item._sdkQueryGeneration++;
  assert.deepEqual(await oldBridge.listTools(), []);
  var resumed = await source.getMcpBridgeHandler(item.localId, false, Number(item._sdkQueryGeneration || 0)).listTools();
  assert.deepEqual(resumed.filter(function (tool) { return expected.includes(tool.name); }).map(function (tool) { return tool.name; }).sort(), expected);
  item._sdkQueryGeneration = originalGeneration;
  var ordinary = await alpha.getMcpBridgeHandler(alphaSession.localId, true, 0).listTools();
  assert.equal(ordinary.some(function (tool) { return expected.includes(tool.name); }), false);
  assert.equal(typeof alpha.inspectSessionPullRequests, 'undefined');
  var hook = fs.readFileSync(path.join(__dirname, '../../lib/claude-hook-installer.js'), 'utf8'), sdk = fs.readFileSync(path.join(__dirname, '../../lib/sdk-bridge.js'), 'utf8');
  expected.forEach(function (name) { assert.ok(hook.includes('mcp__clay-workspace__' + name), name); assert.ok(sdk.includes('mcp__clay-workspace__' + name), name); });
  var presentation = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '../../lib/public/modules/clay-tool-presentation.js'), 'utf8')).toString('base64'));
  expected.forEach(function (name) { assert.ok(presentation.clayToolDefinition(name), 'Friendly activity definition: ' + name); });
  return { status: 'passed', rows: rows, native: expected.length, dynamic: expected.length, resumed: expected.length, names: expected, disconnectedPrInventory: true };
}
var closing = false;
async function stop() { if (closing) return; closing = true; await relay.destroyAll(); relay.server.close(); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
relay.server.listen(0, '127.0.0.1', function () {
  var info = { port: relay.server.address().port, sourceSlug: sourceSlug, sourceSessionId: sourceSession.localId, root: root };
  console.log('Integration fixture ' + JSON.stringify(info));
  if (process.send) process.send(info);
});
