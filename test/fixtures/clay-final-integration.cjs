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
var contextualModelInputs = [], contextualModelGates = [];
// Optional visual-preview delay retains the production entry's own live checks.
var contextualOpeningDelay = Number(process.env.CLAY_CONTEXTUAL_ASK_DELAY_MS || 0);
if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && contextualOpeningDelay > 0 && contextualOpeningDelay <= 10000) {
  var entryModule = require('../../lib/server-home-clay-entry'), attachEntry = entryModule.attachHomeClayEntry;
  entryModule.attachHomeClayEntry = function (ctx) {
    var entry = attachEntry(ctx), start = entry.start;
    entry.start = async function (ws, userId, message) { if (message.presentation === 'contextual') await new Promise(function (resolve) { setTimeout(resolve, contextualOpeningDelay); }); return start(ws, userId, message); };
    return entry;
  };
}
var yoke = require('../../lib/yoke');
yoke.createAdapters = function () {
  var adapters = {};
  ['claude', 'codex'].forEach(function (vendor) {
    adapters[vendor] = { vendor: vendor, init: async function () { return { models: [{ value: 'fixture-model', displayName: 'Fixture model' }, { value: 'fixture-model-alternative', displayName: 'Fixture alternative' }], slashCommands: [], capabilities: { effort: true } }; },
      createToolServer: function (definition) { return definition; }, shutdown: function () {},
      createQuery: function (options) {
        if (process.env.CLAY_CONTEXT_ACCESS_FIXTURE !== '1') throw new Error('Live model execution is forbidden.');
        var gate = null;
        return { pushMessage: function (text, images) { contextualModelInputs.push({ slug: options.slug, text: text, images: images }); if (text.includes('CONTEXTUAL_HOLD_FOR_QUEUE')) gate = new Promise(function (resolve) { contextualModelGates.push(resolve); }); return true; }, abort: function () {}, close: function () {},
          [Symbol.asyncIterator]: function () { var step = 0; return { next: async function () { if (gate) await gate;
            else if (step === 0 && Number(process.env.CLAY_CONTEXTUAL_RESPONSE_DELAY_MS) > 0 && Number(process.env.CLAY_CONTEXTUAL_RESPONSE_DELAY_MS) <= 15000) await new Promise(function (resolve) { setTimeout(resolve, Number(process.env.CLAY_CONTEXTUAL_RESPONSE_DELAY_MS)); });
            return ++step === 1 ? { done: false, value: { yokeType: 'result', result: 'Isolated context transport accepted input' } } : { done: true }; } }; }
        };
      } };
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
var contextualOrdinary = [];
if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1') {
  mates.getAllMates(mateCtx).filter(function (mate) { return !mate.archived && mate.builtinKey !== 'clay'; }).slice(0, 2).forEach(function (mate, index) {
    var name = index === 0 ? 'Arch' : 'Release planning and implementation companion with a deliberately long name';
    mates.updateMate(mateCtx, mate.id, { profile: Object.assign({}, mate.profile, { displayName: name }) });
    mate = mates.getMate(mateCtx, mate.id);
    var project = add('mate-' + mate.id, name, mate);
    var conversation = session(project, name + ' isolated conversation', 'ORDINARY_MATE_' + index + '_PRIVATE_HISTORY\n\nThis is a separate Mate conversation. It retains its own decisions, attachments and questions.\n\n- Review the intended change.\n- Keep the current session and exact target.\n- Verify the result before continuing.');
    project.getSessionManager().sendAndRecord(conversation, { type: 'user_message', text: 'Keep the release review in this conversation. Explain the next checks and retain the exact session while I compare another Mate’s view.' });
    project.getSessionManager().sendAndRecord(conversation, { type: 'delta', text: 'I would keep the implementation evidence, the interface review and the final decision together. Each belongs to this conversation, so switching views preserves the working context.\n\nBefore making a change, review the named target and its current state. Then check the result against the original request.\n\n```js\nvar review = { preserveSession: true, inspectBeforeChange: true };\n```\n\n[Open the detailed release reference](https://example.invalid/release-review/contextual-mates/session-and-attachment-continuity?view=complete-and-preserve-the-original-session) when you need the longer handoff notes.' });
    project.getSessionManager().sendAndRecord(conversation, { type: 'done' });
    project.getSessionManager().saveSessionFile(conversation);
    contextualOrdinary.push({ id: mate.id, name: name, slug: 'mate-' + mate.id, sessionId: conversation.localId });
  });
}

var contextualSaved = [];
if (process.env.CLAY_CONTEXT_ACCESS_FIXTURE === '1') {
  [ { id: clay.id, slug: sourceSlug } ].concat(contextualOrdinary).forEach(function (target) {
    var manager = contexts.get(target.slug).getSessionManager();
    var saved = manager.createSessionRaw({ ownerId: 'owner', vendor: 'claude', model: 'fixture-model' });
    saved.title = 'Saved earlier conversation'; saved.lastActivity = Date.now() - 86400000;
    manager.sendAndRecord(saved, { type: 'user_message', text: 'HISTORY_NOT_PREVIOUSLY_MOUNTED' });
    saved.lastActivity = Date.now() - 86400000; manager.saveSessionFile(saved);
    var foreign = manager.createSessionRaw({ ownerId: 'foreign', vendor: 'claude', model: 'fixture-model' });
    foreign.title = 'FOREIGN_PRIVATE_CONVERSATION'; manager.saveSessionFile(foreign);
    contextualSaved.push({ mateId: target.id, sessionId: saved.localId, foreignSessionId: foreign.localId });
  });
}

if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1') {
  [
    { type: 'user_message', text: 'Help me prepare the release review. I want to keep the active implementation session and understand what still needs checking.' },
    { type: 'delta', text: 'We can work through that here while you keep the project in view.\n\nI would start with the active session, its linked work and any pending questions. Then we can review the exact change before applying it.' },
    { type: 'done' },
    { type: 'user_message', text: 'Please include the longer handoff notes and any decisions that affect the next person picking this up.' },
    { type: 'tool_start', id: 'fixture-screen-read', name: 'mcp__clay-workspace__read_owner_screen' },
    { type: 'tool_executing', id: 'fixture-screen-read', name: 'mcp__clay-workspace__read_owner_screen', input: { action: 'screen_context' } },
    { type: 'tool_result', id: 'fixture-screen-read', content: '{"untrusted":true,"context":"Server connection and active conversation only; rendered content is unknown."}' },
    { type: 'delta', text: 'For the handoff, keep three things together:\n\n- **The current decision:** preserve the existing conversation and the draft.\n- **The remaining check:** confirm the exact destination before navigation.\n- **The recovery path:** leave unavailable or interrupted work visible until someone decides what to do next.\n\nA long reference such as `release-review/contextual-conversation/session-continuity/approval-and-recovery/production-viewport-check` should remain readable without widening this conversation.\n\nA concrete handoff can also include a small code example:\n\n```js\nvar nextStep = { action: "review", preserveSession: true };\n```\n\nSee [the detailed release reference](https://example.invalid/releases/contextual-clay/acceptance/session-continuity/approval-and-recovery/production-viewport-check?view=complete-and-preserve-the-original-session) for the long-link layout check.\n\nWould you like to review the destination conversation now?' },
    { type: 'done' }
  ].forEach(function (event) { source.getSessionManager().sendAndRecord(sourceSession, Object.assign({ _ts: Date.now() }, event)); });
}
sourceSession._sdkQueryGeneration = 8; sourceSession.abortController = new AbortController();
var activeSessions = {}; activeSessions[clay.id] = 'local:' + sourceSession.localId;
users.setHomeSurfacePreference('owner', { surface: 'home', activeMateId: clay.id, activeSessionByMate: activeSessions, onboardingStep: 'complete' });
var alphaSession = session(alpha, 'Alpha destination', 'ALPHA_RENDERED_DESTINATION');
var betaSession = session(beta, 'Beta destination', 'BETA_RENDERED_DESTINATION');
function controller() {
  var candidates = Array.from(source.getSessionManager().sessions.values()).filter(function (item) { return item.ownerId === 'owner' && !item.hidden; });
  return candidates.find(function (item) { return item.localId === sourceSession.localId; }) || sourceSession;
}
async function call(name, args, contextualSessionId) {
  var item = contextualSessionId ? source.getSessionManager().sessions.get(contextualSessionId) : controller();
  if (!item || contextualSessionId && item.homeClayEntryMode !== 'contextual') throw new Error('Exact contextual Ask session required.');
  var result = await source.getMcpBridgeHandler(item.localId, true, Number(item._sdkQueryGeneration || 0)).callTool('clay-workspace', name, args || {});
  return JSON.parse(result.content[0].text);
}
async function propose(viewerKind, destination, contextualSessionId) {
  var read = await call('read_owner_screen', { action: 'screen_context' }, contextualSessionId);
  var selected = (read.viewers || []).find(function (viewer) { return viewer.projectSlug === (viewerKind === 'global' ? null : viewerKind === 'mate' ? sourceSlug : viewerKind); });
  if (!selected) throw new Error('Exact fixture viewer not found: ' + JSON.stringify(read));
  var target = destination === 'alpha' ? alphaSession : betaSession;
  var inspected = await call('inspect_owner_screen_change', { operation: { action: 'navigate', viewerRef: selected.viewerRef, projectSlug: destination, sessionRef: require('../../lib/workspace-query-service').sessionRef(destination, target) } }, contextualSessionId);
  if (!inspected.targetToken) throw new Error(JSON.stringify(inspected));
  var result = await call('control_owner_screen', { targetToken: inspected.targetToken, requestId: 'integration-' + (++sequence), why: 'Open the exact isolated ' + destination + ' destination' }, contextualSessionId);
  results.push(result); return result;
}
var originalRequests = relay.server.listeners('request'); relay.server.removeAllListeners('request');
relay.server.on('request', async function (req, res) {
  var url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/fixture/')) { originalRequests.forEach(function (handler) { handler(req, res); }); return; }
  if (url.pathname === '/fixture/login') {
    var to = url.searchParams.get('to') === 'alpha' ? '/p/alpha/' : url.searchParams.get('to') === 'global' ? '/fixture/global' : '/p/' + sourceSlug + '/';
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
    if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/stream') {
      sourceSession.isProcessing = true;
      source.getSessionManager().sendAndRecord(sourceSession, { type: 'status', status: 'processing' });
      source.getSessionManager().sendAndRecord(sourceSession, { type: 'delta', text: 'CONTEXTUAL_STREAM_CONTINUES' });
      data = { sessionId: sourceSession.localId };
    }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/release-model') { contextualModelGates.splice(0).forEach(function (resolve) { resolve(); }); data = { released: true }; }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/response-phase') {
      var project = contexts.get(url.searchParams.get('slug')), selected = project && project.getSessionManager().sessions.get(Number(url.searchParams.get('session')));
      if (!selected || selected.ownerId !== 'owner') throw new Error('Exact fixture conversation required.');
      var manager = project.getSessionManager(), phase = url.searchParams.get('phase');
      if (phase === 'thinking') { manager.sendAndRecord(selected, { type: 'thinking_start' }); manager.sendAndRecord(selected, { type: 'thinking_delta', text: 'Reviewing this exact conversation.' }); }
      else if (phase === 'stream') { manager.sendAndRecord(selected, { type: 'thinking_stop', duration: 10 }); manager.sendAndRecord(selected, { type: 'delta', text: 'IDENTITY_STREAM_' + selected.localId + (url.searchParams.get('surface') === 'native' ? '_native' : '') }); }
      else throw new Error('Unsupported response phase.');
      data = { phase: phase };
    }
    else if (process.env.CLAY_CONTEXT_ACCESS_FIXTURE === '1' && url.pathname === '/fixture/session-citation') {
      var reference = require('../../lib/workspace-query-service').sessionRef;
      var alphaRef = reference('alpha', alphaSession), betaRef = reference('beta', betaSession);
      var foreignSession = alpha.getSessionManager().createSessionRaw({ ownerId: 'foreign', vendor: 'claude', model: 'fixture-model' });
      var hiddenSession = alpha.getSessionManager().createSessionRaw({ ownerId: 'owner', vendor: 'claude', model: 'fixture-model' }); hiddenSession.hidden = true;
      var foreignRef = reference('alpha', foreignSession), hiddenRef = reference('alpha', hiddenSession);
      var text = 'The earlier project conversation is available here: `[clay-landing/' + alphaRef + ' — Oct 16]`.\n\n[Inspect the exact entry](' + betaRef + '#entry-0) and [clayos/' + alphaRef + ' — Earlier work].\n\nLiteral example: `call("[clay-landing/' + alphaRef + ' — example]")`.\n\n```text\n[clay-landing/' + alphaRef + ' — fenced example]\n```';
      text += '\n\n[Foreign reference](' + foreignRef + ') [Hidden reference](' + hiddenRef + ') [Unknown reference](session:AAAAAAAAAAAAAAAAAAAAAAAA)';
      var manager = source.getSessionManager();
      manager.sendAndRecord(sourceSession, { type: 'user_message', text: 'Locate the earlier project conversation.' });
      manager.sendAndRecord(sourceSession, { type: 'delta', text: text }); manager.sendAndRecord(sourceSession, { type: 'done' }); manager.saveSessionFile(sourceSession);
      data = { alphaRef: alphaRef, betaRef: betaRef, foreignRef: foreignRef, hiddenRef: hiddenRef };
    }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/model-inputs') { data = contextualModelInputs; }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/contextual-asks') {
      data = Array.from(source.getSessionManager().sessions.values()).filter(function (item) { return item.homeClayEntryMode === 'contextual'; }).map(function (item) { return { id: item.localId, requestId: item.homeClayEntryRequestId, text: item.homeClayEntryText, messages: item.history, stopped: item.taskStopRequested }; });
    }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/ask-stream') {
      var manager = source.getSessionManager(), selected = manager.sessions.get(Number(url.searchParams.get('session')));
      if (!selected || selected.homeClayEntryMode !== 'contextual') throw new Error('Exact new Ask session required.');
      selected.isProcessing = true;
      manager.sendAndRecord(selected, { type: 'status', status: 'processing' });
      manager.sendAndRecord(selected, { type: 'delta', text: 'NEW_ASK_STREAM_IN_PANE' });
      data = { id: selected.localId };
    }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/ask-question') {
      var manager = source.getSessionManager(), selected = manager.sessions.get(Number(url.searchParams.get('session')));
      if (!selected || selected.homeClayEntryMode !== 'contextual') throw new Error('Exact new Ask session required.');
      var handler = require('../../lib/project-ask-user').attachAskUser({ record: function (item, event) { manager.sendAndRecord(item, event); } }).createHandler(selected);
      data = await require('../../lib/yoke/user-input').dispatchUserInput(handler, { questions: [{ question: 'Review this new Ask conversation?', header: 'Review', options: [{ label: 'Continue', description: 'Continue in this exact session' }, { label: 'Keep unchanged', description: 'Leave this session unchanged' }], multiSelect: false }] }, { source: 'mcp_fallback', native: false });
    }
    else if (process.env.CLAY_CONTEXT_ACCESS_FIXTURE === '1' && url.pathname === '/fixture/clear-owned-conversations') {
      var saved = contextualSaved.find(function (item) { return item.mateId === url.searchParams.get('mate'); });
      if (!saved) throw new Error('An exact seeded Mate is required.');
      var manager = contexts.get('mate-' + saved.mateId).getSessionManager(), ids = [];
      manager.sessions.forEach(function (session) { if (session.ownerId === 'owner') ids.push(session.localId); });
      ids.forEach(function (id) { manager.deleteSessionQuiet(id); }); data = { removed: ids.length };
    }
    else if (process.env.CLAY_CONTEXT_ACCESS_FIXTURE === '1' && url.pathname === '/fixture/remove-saved-conversation') {
      var saved = contextualSaved.find(function (item) { return item.mateId === url.searchParams.get('mate'); });
      if (!saved) throw new Error('An exact seeded saved conversation is required.');
      contexts.get('mate-' + saved.mateId).getSessionManager().deleteSessionQuiet(saved.sessionId);
      data = { removed: saved.sessionId };
    }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/remove-contextual-session') {
      source.getSessionManager().sessions.delete(sourceSession.localId);
      data = { removed: sourceSession.localId };
    }
    else if (url.pathname === '/fixture/propose') data = await propose(url.searchParams.get('viewer') || 'mate', url.searchParams.get('target') === 'alpha' ? 'alpha' : 'beta');
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/ask-propose') data = await propose('alpha', 'beta', Number(url.searchParams.get('session')));
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/ordinary-question') {
      var selected = contextualOrdinary[Number(url.searchParams.get('index')) || 0];
      var project = contexts.get(selected.slug); var manager = project.getSessionManager(); var current = manager.sessions.get(selected.sessionId);
      var handler = require('../../lib/project-ask-user').attachAskUser({ record: function (item, message) { manager.sendAndRecord(item, message); } }).createHandler(current);
      data = await require('../../lib/yoke/user-input').dispatchUserInput(handler, { questions: [{ question: 'Which isolated release check should this Mate review?', header: 'Review', options: [{ label: 'Tests', description: 'Inspect test evidence' }, { label: 'Design', description: 'Inspect the interface' }], multiSelect: false }] }, { source: 'mcp_fallback', native: false });
    }
    else if (process.env.CLAY_CONTEXT_ACCESS_FIXTURE === '1' && url.pathname === '/fixture/context-tool') {
      var selected = contextualOrdinary[Number(url.searchParams.get('index')) || 0], project = contexts.get(selected.slug);
      var current = project.sm.sessions.get(selected.sessionId), name = url.searchParams.get('name');
      if (!require('../../lib/mate-context-tools').getToolDefs(null).some(function (tool) { return tool.name === name; })) throw new Error('Only restricted context tools are available here.');
      data = JSON.parse((await project.getMcpBridgeHandler(current.localId, true, Number(current._sdkQueryGeneration || 0)).callTool('clay-workspace', name, JSON.parse(url.searchParams.get('args') || '{}'))).content[0].text);
    }
    else if (process.env.CLAY_CONTEXTUAL_FIXTURE === '1' && url.pathname === '/fixture/ordinary-catalog') {
      var selected = contextualOrdinary[Number(url.searchParams.get('index')) || 0]; var project = contexts.get(selected.slug);
      data = { tools: await project.getMcpBridgeHandler(selected.sessionId, url.searchParams.get('fresh') !== 'false', Number(project.sm.sessions.get(selected.sessionId)._sdkQueryGeneration || 0)).listTools(), canonicalNames: require('../../lib/clay-product-control-tools').getToolDefs(null).map(function (tool) { return tool.name; }) };
    }
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
  for (var vendor of ['claude', 'codex', 'muse']) {
    item.vendor = vendor;
    for (var fresh of [true, false]) {
      var tools = await source.getMcpBridgeHandler(item.localId, fresh, Number(item._sdkQueryGeneration || 0)).listTools();
      var actual = tools.filter(function (tool) { return expected.includes(tool.name); }).map(function (tool) { return tool.name; }).sort();
      assert.deepEqual(actual, expected);
      assert.equal(tools.some(function (tool) { return tool.name === 'list_project_session_pull_requests'; }), false);
      item._mcpForeignInput = true;
      var foreign = await source.getMcpBridgeHandler(item.localId, fresh, Number(item._sdkQueryGeneration || 0)).listTools();
      assert.equal(foreign.some(function(tool) { return expected.includes(tool.name); }), false);
      item._mcpForeignInput = false;
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
  var hook = fs.readFileSync(path.join(__dirname, '../../lib/yoke/claude-hook-installer.js'), 'utf8'), sdk = fs.readFileSync(path.join(__dirname, '../../lib/sdk-bridge.js'), 'utf8');
  expected.forEach(function (name) { assert.ok(hook.includes('mcp__clay-workspace__' + name), name); assert.ok(sdk.includes('mcp__clay-workspace__' + name), name); });
  var presentation = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '../../lib/public/modules/clay-tool-presentation.js'), 'utf8')).toString('base64'));
  expected.forEach(function (name) { assert.ok(presentation.clayToolDefinition(name), 'Friendly activity definition: ' + name); });
  return { status: 'passed', rows: rows, native: expected.length, dynamic: expected.length, resumed: expected.length, names: expected, disconnectedPrInventory: true };
}
var closing = false;
async function stop() { if (closing) return; closing = true; await relay.destroyAll(); relay.server.close(); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
relay.server.listen(process.env.CLAY_CONTEXTUAL_FIXTURE === '1' ? Number(process.env.CLAY_CONTEXTUAL_FIXTURE_PORT || 0) : 0, '127.0.0.1', function () {
  var info = { port: relay.server.address().port, sourceSlug: sourceSlug, sourceSessionId: sourceSession.localId, ordinaryMates: contextualOrdinary, savedConversations: contextualSaved, root: root };
  console.log('Integration fixture ' + JSON.stringify(info));
  if (process.send) process.send(info);
});
