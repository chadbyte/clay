var assert = require('node:assert/strict');
async function run(f) {
  var count = 0, seq = 0;
  var second = f.mates.createMate(f.ctx, { name: 'Second context Mate' });
  var a = f.make('mate-' + f.custom.id, f.custom), b = f.make('mate-' + second.id, second);
  var target = f.projects.get('target'), sm = target.getSessionManager();
  var selected = sm.createSession({ ownerId: 'owner', vendor: 'claude', sessionVisibility: 'private' });
  selected.title = 'Selected context'; selected.history = [
    { type: 'user_message', text: 'Visible owner text', from: 'owner' }, { type: 'delta', text: 'Visible assistant text' }, { type: 'done' },
    { type: 'user_message', text: 'HIDDEN_SECRET', hidden: true }, { type: 'tool_result', content: 'TOOL_SECRET' },
    { type: 'delta', text: 'INTERNAL_SECRET', internal: true }, { type: 'user_message', text: 'Attachment turn', pastes: ['PASTE_SECRET'], imageRefs: ['IMAGE_SECRET'], from: 'owner' }
  ];
  var viewerEvents = [], viewer = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: selected.localId, send: function (value) { viewerEvents.push(JSON.parse(value)); } };
  target.clients.add(viewer); f.ownerUi.handleMessage(viewer, { type: 'clay_ui_ready', version: 1 });
  function fresh(project, mate) {
    var session = project.sm.createSession({ ownerId: 'owner', vendor: 'claude', sessionVisibility: 'private' });
    session._sdkQueryGeneration = 1; session.abortController = new AbortController();
    var events = [], ws = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: session.localId, send: function (value) { events.push(JSON.parse(value)); } }; project.clients.add(ws);
    return { project: project, mate: mate, session: session, ws: ws, events: events };
  }
  function prepare(item, socket) {
    var messages = socket === viewer || !socket ? viewerEvents : item.events;
    f.service.handleMessage(socket || viewer, { type: 'mate_context_prepare', requestId: 'prepare-' + (++seq), available: true, mateId: item.mate.id, sessionId: item.session.localId });
    return messages[messages.length - 1];
  }
  function share(item) {
    var prepared = prepare(item); assert.ok(prepared.contextRef, JSON.stringify(prepared));
    var message = { type: 'user_message', text: 'Read the selected context', from: 'owner' }; item.session.history.push(message);
    f.service.activate(item.ws, item.session, prepared.contextRef, message); item.ref = prepared.contextRef;
    return bind(item);
  }
  function bind(item) { return f.service.bind({ projectSlug: 'mate-' + item.mate.id, projectOwnerId: 'owner', mateId: item.mate.id, session: item.session }); }
  async function call(item, name, args, freshCatalog) {
    return JSON.parse((await item.project.getMcpBridgeHandler(item.session.localId, freshCatalog !== false, item.session._sdkQueryGeneration).callTool('clay-workspace', name, args || {})).content[0].text);
  }
  async function rejected(fn, pattern) { await assert.rejects(async function () { return fn(); }, pattern || /context|query|conversation|Mate|project|Owner|Receipt|view/i); count++; }
  var one = fresh(a, f.custom), two = fresh(b, second);
  var names = require('../../lib/mate-context-tools').getToolDefs(null).map(function (tool) { return tool.name; });
  var canonical = require('../../lib/clay-product-control-tools').getToolDefs(null).map(function (tool) { return tool.name; }); assert.ok(canonical.length >= 28);
  for (var item of [one, two]) {
    for (var vendor of ['claude', 'codex', 'muse']) {
      item.session.vendor = vendor;
      for (var freshCatalog of [true, false]) {
        var tools = await item.project.getMcpBridgeHandler(item.session.localId, freshCatalog, 1).listTools();
        names.forEach(function (name) { assert.ok(tools.some(function (tool) { return tool.name === name; }), name); });
        canonical.forEach(function (name) { assert.ok(!tools.some(function (tool) { return tool.name === name; }), name); }); count++;
      }
    }
    item.session.vendor = 'claude';
    for (var flag of ['_mcpForeignInput', 'delegated', '_mentionInProgress', 'homeDebatePlanning']) {
      item.session[flag] = true;
      var excluded = await item.project.getMcpBridgeHandler(item.session.localId, true, 1).listTools();
      names.forEach(function (name) { assert.ok(!excluded.some(function (tool) { return tool.name === name; })); });
      delete item.session[flag]; count++;
    }
    var module = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: f.workspace, contextService: f.service, sm: item.project.sm, projectSlug: 'mate-' + item.mate.id, getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: item.mate.id });
    var dynamic = module.getDynamicToolDefs(item.session); names.forEach(function (name) { var definition = dynamic.find(function (tool) { return tool.name === name; }); assert.ok(definition.queryBound); assert.equal(definition.permissionName, 'mcp__clay-workspace__' + name); }); count++;
    var adapter = { createToolServer: function (value) { return value; } };
    for (var s of [null, item.session]) {
      var native = module.createMcpServer(adapter, s); names.forEach(function (name) { assert.ok(native.tools.some(function (tool) { return tool.name === name; })); }); count++;
    }
    assert.equal((await call(item, 'read_current_context')).status, 'unavailable');
    var bound = share(item); assert.equal(bound.current().summary.conversation, selected.title);
    var content = await call(item, 'read_selected_context', { contextRef: item.ref });
    assert.match(JSON.stringify(content), /Visible owner text/); assert.doesNotMatch(JSON.stringify(content), /HIDDEN_SECRET|TOOL_SECRET|INTERNAL_SECRET|PASTE_SECRET|IMAGE_SECRET/); count++;
  }
  var originalHistory = selected.history;
  selected.history = Array.from({ length: 30 }, function () { return { type: 'user_message', text: 'x'.repeat(1500), from: 'owner' }; });
  var bounded = share(one), limited = await bounded.read({ contextRef: one.ref });
  assert.ok(limited.turns.length <= 20); assert.equal(limited.turns.reduce(function (sum, turn) { return sum + turn.text.length; }, 0), 24000); assert.equal(limited.truncated, true); count++;
  selected.history = originalHistory;
  var bound = share(one);
  await rejected(function () { return bound.read({ contextRef: two.ref }); });
  await rejected(function () { return f.service.activate(two.ws, two.session, one.ref, {}); });
  assert.equal((await call(one, 'read_selected_context', { contextRef: one.ref, projectSlug: 'foreign' })).status, 'failed'); count++;
  var foreign = Object.assign({}, viewer, { _clayUser: f.users.findUserById('foreign'), send: function (v) { viewerEvents.push(JSON.parse(v)); } });
  target.clients.add(foreign); f.service.handleMessage(foreign, { type: 'mate_context_prepare', available: true, mateId: one.mate.id, sessionId: one.session.localId }); assert.equal(viewerEvents[viewerEvents.length - 1].contextRef, null); count++;
  for (var mode of ['foreignInput', 'delegated', 'shared', 'stopped', 'deleted', 'replaced', 'revokedMate', 'changedMate', 'foreignTarget', 'hiddenTarget', 'changedTarget', 'changedView', 'revokedAccess', 'newQuery', 'newOwnerMessage', 'osIdentity']) {
    bound = share(one);
    var originalMate = f.mates.loadMates(f.ctx), originalSession = one.session, originalAccess = f.access.ownerId;
    var userData = f.users.loadUsers();
    if (mode === 'foreignInput') one.session._mcpForeignInput = true;
    if (mode === 'delegated') one.session.delegated = true;
    if (mode === 'shared') one.session.sessionVisibility = 'shared';
    if (mode === 'stopped') one.session.taskStopRequested = true;
    if (mode === 'deleted') a.sm.sessions.delete(one.session.localId);
    if (mode === 'replaced') a.sm.sessions.set(one.session.localId, Object.assign({}, one.session));
    if (mode === 'revokedMate') f.mates.saveMates(f.ctx, Object.assign({}, originalMate, { mates: originalMate.mates.filter(function (mate) { return mate.id !== one.mate.id; }) }));
    if (mode === 'changedMate') f.mates.updateMate(f.ctx, one.mate.id, { name: 'Changed registry profile' });
    if (mode === 'foreignTarget') selected.ownerId = 'foreign';
    if (mode === 'hiddenTarget') selected.hidden = true;
    if (mode === 'changedTarget') selected.title = 'Changed selected title';
    if (mode === 'changedView') f.service.handleMessage(viewer, { type: 'mate_context_prepare', available: false });
    if (mode === 'revokedAccess') { f.access.ownerId = 'foreign'; f.access.allowedUsers = []; }
    if (mode === 'newQuery') one.session._sdkQueryGeneration++;
    if (mode === 'newOwnerMessage') one.session.history.push({ type: 'user_message', text: 'New query', from: 'owner' });
    if (mode === 'osIdentity') f.users.saveUsers(Object.assign({}, userData, { users: userData.users.map(function (user) { return user.id === 'owner' ? Object.assign({}, user, { linuxUser: 'changed-fixture-mapping' }) : user; }) }));
    await rejected(function () { return bound.read({ contextRef: one.ref }); });
    one.session = originalSession; a.sm.sessions.set(one.session.localId, one.session);
    one.session._mcpForeignInput = false; one.session.delegated = false; one.session.sessionVisibility = 'private'; one.session.taskStopRequested = false;
    selected.ownerId = 'owner'; selected.hidden = false; selected.title = 'Selected context'; f.access.ownerId = originalAccess;
    f.mates.saveMates(f.ctx, originalMate); f.users.saveUsers(userData);
  }
  var canonicalSource = f.projects.get('clay-source');
  var canonicalSession = Array.from(canonicalSource.sm.sessions.values())[0];
  f.service.handleMessage(viewer, { type: 'mate_context_prepare', available: true, mateId: f.clay.id, sessionId: canonicalSession.localId });
  assert.equal(viewerEvents[viewerEvents.length - 1].contextRef, null); count++;
  bound = share(one); var reading = bound.read({ contextRef: one.ref }); selected.title = 'Changed across await'; await rejected(function () { return reading; }); selected.title = 'Selected context';
  bound = share(one);
  function answer(label) { var ids = Object.keys(one.session.pendingAskUser || {}); assert.ok(ids.length); return a.handleHomeAskUserResponse({ toolId: ids[ids.length - 1], answers: { 0: label } }, one.session, one.ws); }
  async function navigate(id) { var promise = bound.navigate({ contextRef: one.ref, requestId: id, why: 'Open this selected conversation' }); await new Promise(function (r) { setImmediate(r); }); return { promise: promise, id: Object.keys(one.session.pendingAskUser || {}).slice(-1)[0] }; }
  var request = await navigate('decline'); assert.equal(answer('Keep unchanged'), true); assert.equal((await request.promise).status, 'cancelled'); count++;
  request = await navigate('approve'); assert.equal(answer('Apply exact change'), true); var delivery = await request.promise; assert.equal(delivery.delivered, true); assert.equal(delivery.visible, 'unknown'); count++;
  assert.deepEqual(await bound.navigate({ contextRef: one.ref, requestId: 'approve', why: 'Open this selected conversation' }), delivery); count++;
  assert.equal(bound.receipt({ contextRef: one.ref, deliveryId: delivery.deliveryId }).acknowledged, false);
  f.ownerUi.handleMessage(viewer, { type: 'clay_navigation_claim', deliveryId: delivery.deliveryId });
  assert.ok(viewerEvents.some(function (event) { return event.type === 'clay_navigation_apply' && event.target.sessionId === selected.localId; }));
  f.ownerUi.handleMessage(viewer, { type: 'clay_navigation_ack', deliveryId: delivery.deliveryId, status: 'accepted' });
  assert.equal(bound.receipt({ contextRef: one.ref, deliveryId: delivery.deliveryId }).clientStatus, 'accepted'); count++;
  await rejected(function () { return bound.receipt({ contextRef: one.ref, deliveryId: 'navigation:foreign' }); });
  var originalSend = viewer.send, offered = 0;
  viewer.send = function (value) { if (JSON.parse(value).type === 'clay_navigation_offer') { offered++; throw new Error('Uncertain fixture delivery'); } originalSend(value); };
  request = await navigate('uncertain'); assert.equal(answer('Apply exact change'), true);
  var uncertain = await request.promise; assert.equal(uncertain.status, 'failed'); assert.equal(uncertain.retrySafe, false); assert.equal(uncertain.visible, 'unknown');
  assert.deepEqual(await bound.navigate({ contextRef: one.ref, requestId: 'uncertain', why: 'Open this selected conversation' }), uncertain); assert.equal(offered, 1); count++;
  viewer.send = originalSend;
  request = await navigate('stop'); one.session.taskStopRequested = true; one.session.abortController.abort();
  assert.equal(a.handleHomeAskUserResponse({ toolId: request.id, answers: { 0: 'Apply exact change' } }, one.session, one.ws), false); var ids = Object.keys(one.session.pendingAskUser || {}); if (ids.length) one.session.pendingAskUser[ids[0]].respond.cancel('Stopped');
  assert.equal((await request.promise).status, 'failed'); count++;
  one.session.taskStopRequested = false; one.session.abortController = new AbortController(); bound = share(one);
  request = await navigate('stale-review'); f.service.handleMessage(viewer, { type: 'mate_context_prepare', available: false }); assert.equal(answer('Apply exact change'), false);
  ids = Object.keys(one.session.pendingAskUser || {}); one.session.pendingAskUser[ids[0]].respond.cancel('Changed view'); assert.equal((await request.promise).status, 'failed'); count++;
  bound = share(one);
  var originalNow = Date.now;
  try { Date.now = function () { return originalNow() + 300001; }; await rejected(function () { return bound.current(); }, /expired/i); }
  finally { Date.now = originalNow; }
  share(one); one.session.isProcessing = true;
  a.handleMessage(one.ws, { type: 'message', text: 'Queue this isolated owner message', mateContextRef: one.ref, clientMessageId: 'context-queued-fixture' });
  assert.ok(one.events.some(function (event) { return event.type === 'message_queued' && event.clientMessageId === 'context-queued-fixture'; }));
  assert.ok(one.events.some(function (event) { return event.type === 'mate_context_shared' && event.status === 'unavailable' && /Queued messages/.test(event.error); })); count++;
  one.session.isProcessing = false;
  for (var file of ['lib/sdk-bridge.js', 'lib/yoke/claude-hook-installer.js']) { var source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../..', file), 'utf8'); names.forEach(function (name) { assert.ok(source.includes('mcp__clay-workspace__' + name)); }); count++; }
  console.log(count + ' restricted context production scenarios passed');
}
module.exports = { run: run };
