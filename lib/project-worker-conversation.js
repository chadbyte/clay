// Exact, read-only Split Worker transcript snapshots for an owning Driver.
// This does not switch sessions or expose Worker controls.
var provenance = require("./session-provenance");

function attachProjectWorkerConversation(ctx) {
  var sm = ctx.sm;
  var users = ctx.usersModule;
  var MAX_MESSAGES = 120;
  var MAX_TEXT = 8000;
  var MAX_PAGE_TEXT = 64000;

  function send(ws, value) { ctx.sendTo(ws, value); }
  function sessionForOrigin(origin) {
    var found = null;
    var ambiguous = false;
    sm.sessions.forEach(function (session) {
      if (session.sessionOriginId !== origin) return;
      if (found && found !== session) ambiguous = true;
      else if (!found) found = session;
    });
    return ambiguous ? null : found;
  }
  function actor(ws) {
    if (!ws || !ctx.clients || !ctx.clients.has(ws) || ws._clayPaneActivation || ctx.isMate || !ctx.canAccessProject(ws)) return null;
    var user = ws._clayUser && users.findUserById(ws._clayUser.id);
    if (users.isMultiUser() && !user) return null;
    if (ctx.osUsers && (!user || !user.linuxUser || !ctx.getOsUserInfoForWs({ _clayUser: user }))) return null;
    return { id: user && user.id || null, linuxUser: ctx.osUsers && user ? user.linuxUser : null };
  }
  function exactPair(ws, msg, currentActor) {
    if (!msg || typeof msg.parentSessionOriginId !== "string" || typeof msg.workerSessionOriginId !== "string" ||
        !Number.isInteger(msg.generation) || msg.generation < 1) return null;
    var driver = sessionForOrigin(msg.parentSessionOriginId), worker = sessionForOrigin(msg.workerSessionOriginId);
    if (!driver || !worker || driver === worker || sm.sessions.get(driver.localId) !== driver || sm.sessions.get(worker.localId) !== worker) return null;
    if (!ctx.canAccessSession(ws, driver) || !ctx.canAccessSession(ws, worker)) return null;
    if ((driver.ownerId || null) !== (worker.ownerId || null) || currentActor.id !== (worker.ownerId || null)) return null;
    var record = worker.sessionProvenance;
    if (!record || record.kind !== "worker" || record.parentSessionOriginId !== driver.sessionOriginId || record.generation !== msg.generation) return null;
    if (provenance.isWorker(driver) || !driver.sessionOriginId || !worker.sessionOriginId) return null;
    if (ctx.osUsers) {
      var driverLinux = ctx.getLinuxUserForSession(driver), workerLinux = ctx.getLinuxUserForSession(worker);
      if (!driverLinux || driverLinux !== workerLinux || driverLinux !== currentActor.linuxUser) return null;
    }
    return { driver: driver, worker: worker };
  }
  // Share the exact owner/OS/provenance checks used by the human Worker reader.
  function supervision(ws, driverOrigin) {
    var user = actor(ws), driver = sessionForOrigin(driverOrigin);
    if (!user || !driver || provenance.isWorker(driver) || (driver.ownerId || null) !== user.id || !ctx.canAccessSession(ws, driver)) throw new Error('Driver supervision access changed.');
    if (ctx.osUsers && ctx.getLinuxUserForSession(driver) !== user.linuxUser) throw new Error('Driver OS identity changed.');
    var linked = provenance.ownedWorkersByDriver(Array.from(sm.sessions.values()))[driver.localId] || [];
    var group = ctx.getWorkerGroup && ctx.getWorkerGroup(driver.localId);
    var splitRoles = require('./session-split-group-roles');
    var roles = splitRoles.normalizePair(group && group.pair, group && group.members);
    if (group && !roles.ok) throw new Error('Worker configuration is unavailable.');
    var groupIdentity = JSON.stringify(group && [group.id, group.members, group.pair]);
    var configured = roles.ok && roles.driverId === driver.localId ? roles.workerIds : [];
    var bindings = linked.slice().sort(function (a, b) { return Number(configured.indexOf(b.localId) >= 0) - Number(configured.indexOf(a.localId) >= 0); }).slice(0, 100).map(function (worker) {
      var input = { parentSessionOriginId: driverOrigin, workerSessionOriginId: worker.sessionOriginId, generation: worker.sessionProvenance.generation };
      var pair = exactPair(ws, input, user);
      if (!pair || pair.driver !== driver || pair.worker !== worker || worker.destroying || worker._pairGeneration != null && worker._pairGeneration !== input.generation) throw new Error('Exact Worker supervision identity is unavailable.');
      return { input: input, worker: worker };
    });
    function revalidate() {
      var latest = actor(ws);
      if (!latest || latest.id !== user.id || latest.linuxUser !== user.linuxUser || sessionForOrigin(driverOrigin) !== driver) throw new Error('Driver supervision identity changed.');
      if (!ctx.canAccessSession(ws, driver) || ctx.osUsers && ctx.getLinuxUserForSession(driver) !== user.linuxUser) throw new Error('Driver access or OS identity changed.');
      var nextGroup = ctx.getWorkerGroup && ctx.getWorkerGroup(driver.localId);
      if (JSON.stringify(nextGroup && [nextGroup.id, nextGroup.members, nextGroup.pair]) !== groupIdentity) throw new Error('Worker configuration changed.');
      var nextLinked = provenance.ownedWorkersByDriver(Array.from(sm.sessions.values()))[driver.localId] || [];
      if (linked.length !== nextLinked.length || linked.some(function (worker, i) { return worker !== nextLinked[i]; })) throw new Error('Linked Worker membership changed.');
      bindings.forEach(function (binding) {
        var pair = exactPair(ws, binding.input, latest);
        if (!pair || pair.driver !== driver || pair.worker !== binding.worker || pair.worker.destroying || pair.worker._pairGeneration != null && pair.worker._pairGeneration !== binding.input.generation) throw new Error('Exact Worker generation changed.');
      });
    }
    return { revalidate: revalidate, read: function () {
      revalidate();
      return { observedAt: Date.now(), limit: 100, truncated: linked.length > bindings.length, workers: bindings.map(function (binding) {
        var worker = binding.worker;
        if (worker._pairDelegation && !splitRoles.tokenMatchesWorker(worker, worker._pairDelegation)) throw new Error('Delegated Worker generation changed.');
        var activity = require('./project-pair-lifecycle-status').activityStatus(worker);
        return { id: worker.localId, sessionOriginId: worker.sessionOriginId, parentSessionOriginId: driverOrigin, generation: binding.input.generation,
          association: configured.indexOf(worker.localId) >= 0 ? 'current' : 'archived',
          runtime: require('./session-activity-state').currentState(worker), delegated: activity.delegated,
          currentTaskId: activity.currentTaskId, interrupted: !!activity.interruption, lastTurnInterrupted: activity.lastTurnInterrupted };
      }) };
    } };
  }
  function textContent(value) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map(function (part) { return part && typeof part.text === "string" ? part.text : ""; }).join("\n");
  }
  function toolIdentity(entry) {
    var id = entry.id || entry.tool_use_id || entry.toolId;
    var name = entry.toolName || entry.name;
    return { toolId: typeof id === "string" && id.length <= 160 ? id : null,
      toolName: typeof name === "string" ? name.slice(0, 120) : null };
  }
  function record(history, index) {
    var entry = history[index] || {}, type = entry.type;
    if (type === "user_message") return { role: "user", text: textContent(entry.text || entry.content) };
    if (type === "delta" || type === "result" || type === "assistant_message") return { role: "assistant", text: textContent(entry.text || entry.content) };
    if (type === "tool_start" || type === "tool_use") return Object.assign({ role: "tool", text: "Used " + (toolIdentity(entry).toolName || "tool") }, toolIdentity(entry));
    if (type === "tool_result") return Object.assign({ role: "tool", text: textContent(entry.content) || "No recorded tool output.", isError: entry.is_error === true }, toolIdentity(entry));
    return null;
  }
  function snapshot(history, before) {
    var index, offset;
    if (before && typeof before === "object" && Number.isInteger(before.index) && Number.isInteger(before.offset)) {
      index = Math.min(before.index, history.length - 1); offset = Math.max(0, before.offset);
    } else {
      var end = Number.isInteger(before) && before >= 0 ? Math.min(before, history.length) : history.length;
      index = end - 1;
      var latest = index >= 0 ? record(history, index) : null;
      offset = latest ? latest.text.length : 0;
    }
    var rows = [], budget = MAX_PAGE_TEXT, nextBefore = null;
    while (index >= 0 && rows.length < MAX_MESSAGES && budget > 0) {
      var item = record(history, index);
      if (!item) { index -= 1; offset = index >= 0 && record(history, index) ? record(history, index).text.length : 0; continue; }
      offset = Math.min(offset, item.text.length);
      if (!item.text.length || !offset) { index -= 1; offset = index >= 0 && record(history, index) ? record(history, index).text.length : 0; continue; }
      var metadataSize = (item.toolName || "").length + (item.toolId || "").length;
      if (budget <= metadataSize) { nextBefore = { index: index, offset: offset }; break; }
      var start = Math.max(0, offset - Math.min(MAX_TEXT, budget - metadataSize));
      rows.push({ role: item.role, text: item.text.slice(start, offset), recordIndex: index, recordType: history[index].type,
        start: start, end: offset, toolName: item.toolName || null, toolId: item.toolId || null, isError: item.isError === true });
      budget -= offset - start + metadataSize;
      if (start > 0) { nextBefore = { index: index, offset: start }; break; }
      index -= 1;
      if (index >= 0) { var prior = record(history, index); offset = prior ? prior.text.length : 0; }
    }
    rows.reverse();
    if (!nextBefore && index >= 0) nextBefore = { index: index, offset: offset };
    return { messages: rows, nextBefore: nextBefore, hasMore: nextBefore !== null };
  }
  function handleMessage(ws, msg) {
    if (!msg || msg.type !== "split_worker_conversation_request") return false;
    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 160) : "";
    var response = { type: "split_worker_conversation", requestId: requestId, pageBefore: msg.before == null ? null : msg.before,
      parentSessionOriginId: msg.parentSessionOriginId || null, workerSessionOriginId: msg.workerSessionOriginId || null,
      generation: msg.generation || null, messages: [], hasMore: false, nextBefore: null };
    var current = actor(ws), pair = current && exactPair(ws, msg, current);
    if (!requestId || !pair) response.error = "This Worker conversation is no longer available.";
    else {
      var before = msg.before == null ? pair.worker.history.length : msg.before;
      if (!(Number.isInteger(before) && before >= 0) && !(before && typeof before === "object" && Number.isInteger(before.index) && Number.isInteger(before.offset) && before.index >= 0 && before.offset >= 0)) response.error = "Worker conversation page is invalid.";
      else Object.assign(response, snapshot(pair.worker.history || [], before));
    }
    send(ws, response);
    return true;
  }
  return { handleMessage: handleMessage, supervision: supervision };
}

module.exports = { attachProjectWorkerConversation: attachProjectWorkerConversation };
