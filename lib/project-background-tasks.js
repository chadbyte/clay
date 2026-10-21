// Read-only inspection of native background work through its existing query.
function remember(session, tasks) {
  var generation = session._sdkQueryGeneration || 0;
  var catalog = session.backgroundTaskCatalog;
  if (!catalog || catalog.generation !== generation) catalog = { generation: generation, tasks: [] };
  var next = (tasks || []).slice(0, 64).map(function (task) {
    var old = catalog.tasks.find(function (item) { return item.task_id === task.task_id && String(item.run_id || '') === String(task.run_id || ''); });
    return Object.assign(old || {}, task, { active: true });
  });
  catalog.tasks.forEach(function (old) {
    if (!next.some(function (task) { return task.task_id === old.task_id; })) next.push(Object.assign(old, { active: false }));
  });
  catalog.tasks = next.slice(0, 64); session.backgroundTaskCatalog = catalog;
  return catalog.tasks;
}
function observeMessage(session, parsed, send) {
  if (!parsed || parsed.messageRole !== 'assistant' || !Array.isArray(parsed.content)) return false;
  var id = session.taskIdMap && session.taskIdMap[parsed.parentToolUseId];
  var catalog = session.backgroundTaskCatalog;
  if (!id || !catalog || catalog.generation !== (session._sdkQueryGeneration || 0)) return false;
  var task = catalog.tasks.find(function (item) { return item.task_id === id && item.active; });
  if (!task) return false;
  var text = parsed.content.filter(function (part) { return part && part.type === 'text' && typeof part.text === 'string'; }).map(function (part) { return part.text; }).join('\n').slice(0, 1200);
  if (!text.trim()) return false;
  var id = parsed.uuid || String(Date.now());
  var preview = { id: id, text: text, vendor: session.vendor || null, timestamp: task.preview && task.preview.id === id ? task.preview.timestamp : Date.now() };
  if (task.preview && task.preview.id === preview.id && task.preview.text === preview.text) return false;
  task.preview = preview;
  send(session, { type: 'background_task_preview', taskId: task.task_id, runId: task.run_id || null, sessionOriginId: session.sessionOriginId, preview: preview, live: true });
  return true;
}
function attach(ctx) {
  var pending = new WeakSet();
  function authorized(ws, session) {
    if (!session || ctx.getSessionForWs(ws) !== session || ws.readyState !== 1 || session.destroying) return false;
    var users = ctx.usersModule;
    if (!users.isMultiUser()) return !session.ownerId;
    var user = ws._clayUser;
    return !!(user && users.findUserById(user.id) && users.canAccessProject(user.id, (ctx.getProjectAccess ? ctx.getProjectAccess() : { visibility: "public" })) &&
      users.canAccessSession(user.id, session, (ctx.getProjectAccess ? ctx.getProjectAccess() : { visibility: "public" })));
  }
  async function read(ws, msg) {
    var session = ctx.getSessionForWs(ws), query = session && session.queryInstance;
    var generation = session && session._sdkQueryGeneration;
    var catalog = session && session.backgroundTaskCatalog;
    var task = catalog && catalog.generation === (generation || 0) && catalog.tasks.find(function (item) {
      return item.task_id === msg.taskId && String(item.run_id || '') === String(msg.runId || '');
    });
    var actor = ws._clayUser && ws._clayUser.id, cwd = session && session.cwd, owner = session && session.ownerId;
    var osIdentity = session && ctx.getLinuxUserForSession ? ctx.getLinuxUserForSession(session) : null;
    var requestId = typeof msg.requestId === 'string' ? msg.requestId.slice(0, 120) : null;
    function current() { return authorized(ws, session) && ctx.sm.sessions.get(session.localId) === session &&
      session.sessionOriginId === msg.sessionOriginId && session.queryInstance === query && session._sdkQueryGeneration === generation &&
      session.cwd === cwd && session.ownerId === owner && (!ctx.getLinuxUserForSession || ctx.getLinuxUserForSession(session) === osIdentity) && (ws._clayUser && ws._clayUser.id) === actor && session.backgroundTaskCatalog === catalog &&
      catalog.tasks.indexOf(task) >= 0; }
    function reply(data) { if (authorized(ws, session)) ctx.sendTo(ws, Object.assign({ type: 'background_task_read', requestId: requestId,
      taskId: msg.taskId, runId: msg.runId || null, sessionOriginId: msg.sessionOriginId }, data)); }
    if (!requestId || !task || !current() || !query || msg.type === 'background_task_read' && typeof query.readBackgroundTask !== 'function') {
      reply({ error: 'This task is unavailable in the current session.' }); return;
    }
    var reading = msg.type === 'background_task_read';
    if (reading && pending.has(ws)) { reply({ error: 'A task read is already in progress.' }); return; }
    if (reading) pending.add(ws);
    try {
      var data;
      if (msg.type === 'background_task_stop') {
        if (!task.active || typeof query.stopTask !== 'function') throw new Error('Task is no longer running.');
        await query.stopTask(task.task_id); data = { stopRequested: true };
      } else data = await query.readBackgroundTask({ taskId: task.task_id, runId: task.run_id || null, offset: msg.offset });
      if (current()) reply({ data: data });
    } catch (error) { if (current()) reply({ error: 'Task transcript or output is not available yet.' }); }
    finally { if (reading) pending.delete(ws); }
  }
  return { handleMessage: function (ws, msg) { if (msg.type !== 'background_task_read' && msg.type !== 'background_task_stop') return false; read(ws, msg); return true; } };
}
module.exports = { attach: attach, remember: remember, observeMessage: observeMessage };
