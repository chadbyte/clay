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
  function textContent(value) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map(function (part) { return part && typeof part.text === "string" ? part.text : ""; }).join("\n");
  }
  function record(history, index) {
    var entry = history[index] || {}, type = entry.type;
    if (type === "user_message") return { role: "user", text: textContent(entry.text || entry.content) };
    if (type === "delta" || type === "result" || type === "assistant_message") return { role: "assistant", text: textContent(entry.text || entry.content) };
    if (type === "tool_start" || type === "tool_use") return { role: "tool", text: "Used " + String(entry.toolName || entry.name || "tool").slice(0, 120) };
    if (type === "tool_result") return { role: "tool", text: textContent(entry.content) || "No recorded tool output.", toolName: entry.name || "Tool result", isError: entry.is_error === true };
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
      var start = Math.max(0, offset - Math.min(MAX_TEXT, budget));
      rows.push({ role: item.role, text: item.text.slice(start, offset), recordIndex: index, recordType: history[index].type,
        start: start, end: offset, toolName: item.toolName || null, isError: item.isError === true });
      budget -= offset - start;
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
  return { handleMessage: handleMessage };
}

module.exports = { attachProjectWorkerConversation: attachProjectWorkerConversation };
