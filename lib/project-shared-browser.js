var activityHistory = require("./shared-browser-activity-history");
var crypto = require("crypto");
var policy = require("./shared-browser-policy");
var browserTools = require("./shared-browser-tools");
var createRuntime = require("./shared-browser-runtime").createRuntime;

function attachSharedBrowser(ctx) {
  var records = new Map();
  var viewers = new Map();
  var destroyed = false;
  function allowed(session, ws) {
    try {
      if (ctx.isMate || !session || ctx.sm.sessions.get(session.localId) !== session) return false;
      if (ctx.usersModule.isMultiUser()) {
        var user = ctx.usersModule.findUserById(session.ownerId);
        if (!user || (ws && (!ws._clayUser || String(ws._clayUser.id) !== String(user.id)))) return false;
        var actor = { _clayUser: user };
        if (!ctx.requestAccess.canAccessProject(actor, ctx.slug) || !ctx.requestAccess.hasPermission(actor, "terminal")) return false;
      } else if (ws && !ctx.requestAccess.hasPermission(ws, "terminal")) return false;
      if (ctx.osUsers && !ctx.getIdentity(session)) return false;
      return true;
    } catch (e) { return false; }
  }
  function identityKey(session) {
    var identity = ctx.getIdentity(session);
    return identity ? JSON.stringify([identity.uid, identity.gid, identity.home]) : "default";
  }
  function recordAllowed(record, ws) {
    try { return allowed(record.session, ws) && record.ownerId === record.session.ownerId && record.identity === identityKey(record.session); }
    catch (e) { return false; }
  }
  function requireAccess(session, ws) {
    if (!allowed(session, ws)) throw new Error("Shared browser access is not permitted for this session");
  }
  function projection(record) {
    if (!record) return null;
    return { id: record.id, phase: record.phase, control: record.control, epoch: record.epoch, handoff: !!record.handoff,
      url: record.url, width: record.width, height: record.height, activity: record.activity || null, activityHistory: record.activityHistory || [], pointer: record.pointer || null, error: record.error || "" };
  }
  function sessionRecords(session) {
    return Array.from(records.values()).filter(function (record) { return record.session === session && recordAllowed(record); });
  }
  function selectRecord(session, id) {
    var tabs = sessionRecords(session);
    if (id) {
      var record = records.get(id);
      if (!record || record.session !== session || !recordAllowed(record)) throw new Error("Browser tab expired");
      return record;
    }
    if (tabs.length > 1) throw new Error("Choose a browserId from status before operating a tab");
    return tabs[0] || null;
  }
  function sendState(ws, session, record, present, focus) {
    if (!ws || ws.readyState !== 1 || !allowed(session, ws) || (record && !recordAllowed(record, ws))) return;
    ctx.sendTo(ws, { type: "shared_browser_state", sessionId: session.localId, browser: projection(record), browsers: sessionRecords(session).map(projection), present: !!present, focus: !!focus });
  }
  function broadcast(record, present) {
    ctx.clients.forEach(function (ws) {
      if (ctx.getSessionForWs(ws) === record.session) sendState(ws, record.session, record, present);
    });
  }
  function watching(record, ws) {
    return ws.readyState === 1 && viewers.get(ws) === record.id && ctx.getSessionForWs(ws) === record.session && recordAllowed(record, ws);
  }
  function visibility(record) {
    if (!record.runtime) return;
    var visible = false;
    viewers.forEach(function (id, ws) { if (id === record.id && watching(record, ws)) visible = true; });
    record.runtime.viewing(visible);
  }
  function end(record, reason) {
    if (record.runtime) record.runtime.close();
    record.runtime = null;
    record.phase = "ended";
    record.error = reason || "";
    record.control = "user";
    activityHistory.interruptActivity(record); record.pointer = null;
    record.epoch++;
    record.rejectReady(new Error(reason || "Browser ended"));
    broadcast(record);
  }
  function receive(record, message) {
    if (destroyed || records.get(record.id) !== record || !record.runtime) return;
    if (!recordAllowed(record)) { end(record, "Browser access was revoked"); records.delete(record.id); return; }
    if (message.type === "activity" || message.type === "pointer") {
      var late = record.settledThrough !== undefined && Number(message.type === "activity" ? message.activity && message.activity.id : message.pointer && message.pointer.commandId) <= record.settledThrough;
      if (late || message.epoch !== record.epoch || message.generation !== Number(record.session._sdkQueryGeneration || 0) || record.control !== "agent" || record.handoff) return;
      record.activityGeneration = message.generation;
      if (message.type === "activity") activityHistory.recordActivity(record, message.activity);
      else record.pointer = message.pointer;
      broadcast(record); return;
    }
    if ((record.activity || record.pointer) && record.activityGeneration !== Number(record.session._sdkQueryGeneration || 0)) {
      activityHistory.interruptActivity(record); record.pointer = null; broadcast(record);
    }
    if (message.type === "ready") { record.phase = "live"; record.resolveReady(); }
    if (message.type === "error") { end(record, message.error); return; }
    if (message.url !== undefined) record.url = policy.visibleUrl(message.url);
    if (message.width) { record.width = message.width; record.height = message.height; }
    if (message.type === "frame") {
      record.frame = { type: "shared_browser_frame", sessionId: record.session.localId, browserId: record.id,
        data: message.data, width: record.width, height: record.height };
      viewers.forEach(function (id, ws) {
        if (watching(record, ws) && ws.bufferedAmount < 1024 * 1024) ctx.sendTo(ws, record.frame);
      });
      visibility(record);
    } else broadcast(record);
  }
  // Every new tab starts shared. Exclusive human mode is explicit, per tab, and only the human clears it,
  // so an agent open never reuses (or bypasses) an exclusive tab.
  function create(session, actor, newTab) {
    requireAccess(session);
    var tabs = sessionRecords(session);
    var previous = !newTab && tabs.find(function (record) { return record.runtime && (actor === "user" || record.control === "agent"); });
    if (previous) return previous;
    if (tabs.length >= 12) {
      var expired = tabs.find(function (record) { return !record.runtime; });
      if (expired) records.delete(expired.id);
      else throw new Error("Close a browser tab before opening another");
    }
    var active = 0;
    records.forEach(function (record) { if (record.runtime && record.ownerId === session.ownerId) active++; });
    if (active >= 4) throw new Error("End another browser before opening more than four active tabs");
    var record = { session: session, ownerId: session.ownerId, identity: identityKey(session), id: crypto.randomUUID(), phase: "starting", control: "agent", epoch: 0,
      url: "", width: 1280, height: 800, touched: Date.now(), runtime: null, frame: null };
    record.ready = new Promise(function (resolve, reject) { record.resolveReady = resolve; record.rejectReady = reject; });
    record.ready.catch(function () {});
    records.set(record.id, record);
    try {
      record.runtime = (ctx.createRuntime || createRuntime)({ identity: ctx.getIdentity(session), onEvent: function (message) { receive(record, message); } });
    } catch (e) { end(record, e.message); }
    broadcast(record, true);
    return record;
  }
  async function changeControl(record, control) {
    if (!record.runtime) throw new Error("Open a browser first");
    record.control = control;
    activityHistory.interruptActivity(record); record.pointer = null;
    record.epoch++;
    record.touched = Date.now();
    record.handoff = true;
    var epoch = record.epoch;
    broadcast(record);
    try {
      await record.runtime.control(epoch);
      if (record.runtime && record.epoch === epoch) { record.handoff = false; broadcast(record); }
    } catch (e) { if (record.runtime && record.epoch === epoch) end(record, e.message); }

  }
  // Finish is a serialized boundary: it waits for earlier queued work in the browser worker, then
  // drops only telemetry from before that boundary. Control, epoch and later actions are untouched.
  async function settle(record) {
    if (!record.runtime || !recordAllowed(record)) throw new Error("Open a browser first");
    var runtime = record.runtime;
    var result = await runtime.settle();
    if (!recordAllowed(record) || records.get(record.id) !== record || record.runtime !== runtime) throw new Error("Browser ended before it settled");
    var through = Number(result && result.through);
    if (record.settledThrough === undefined || through > record.settledThrough) record.settledThrough = through;
    if (record.activity && Number(record.activity.id) <= through) { activityHistory.interruptActivity(record); }
    if (record.pointer && Number(record.pointer.commandId) <= through) record.pointer = null;
    record.touched = Date.now(); broadcast(record);
    return projection(record);
  }
  async function run(session, record, actor, action, event, intent) {
    requireAccess(session);
    if (!record || !record.runtime || !recordAllowed(record)) throw new Error("Open a browser first");
    if (record.handoff) throw new Error("Browser control is changing; wait for the handoff");
    // control "agent" = shared (owner and Clay may both act); "user" = exclusive human mode (Clay mutations denied).
    // The authorized owner is never blocked by control mode and ordinary human input never changes it.
    if (action !== "inspect" && actor === "agent" && record.control !== "agent") throw new Error("Only the user can control this browser right now (Clay is paused). Wait for them to resume shared control; do not work around it.");
    var epoch = record.epoch;
    var generation = Number(session._sdkQueryGeneration || 0);
    await record.ready;
    if (actor === "agent" && Number(session._sdkQueryGeneration || 0) !== generation) throw new Error("Browser request belongs to an older query");
    requireAccess(session);
    if (!recordAllowed(record) || !record.runtime || record.epoch !== epoch) throw new Error("Browser control changed; retry after the handoff");
    record.touched = Date.now();
    var result;
    try { result = await record.runtime.request(action, event, epoch, actor === "agent" ? { intent: intent || "", generation: generation } : null); }
    catch (error) {
      if (actor === "agent" && record.epoch === epoch && record.activity && record.activity.phase === "running") {
        activityHistory.recordActivity(record, Object.assign({}, record.activity, { phase: "failed" })); broadcast(record);
      }
      throw error;
    }
    requireAccess(session);
    if (actor === "agent" && Number(session._sdkQueryGeneration || 0) !== generation) throw new Error("Browser result belongs to an older query");
    if (!recordAllowed(record) || records.get(record.id) !== record || record.epoch !== epoch) throw new Error("Browser control changed during the action");
    return result;
  }
  async function tool(session, args) {
    try {
      requireAccess(session);
      if (args.intent !== undefined && (typeof args.intent !== "string" || args.intent.length > 160)) throw new Error("Browser intent must be at most 160 characters");
      var record = args.action === "status" || args.action === "open" ? null : selectRecord(session, args.browserId);
      var value;
      if (args.action === "status") value = { browsers: sessionRecords(session).map(projection) };
      else if (args.action === "open") {
        var url = args.url ? policy.browserUrl(args.url) : null;
        record = args.browserId ? selectRecord(session, args.browserId) : create(session, "agent", args.newTab === true);
        if (url) await run(session, record, "agent", "action", { kind: "navigate", url: url }, args.intent);
        value = projection(record);
      } else if (args.action === "finish") {
        if (!record || !record.runtime) throw new Error("Open a browser first");
        value = await settle(record);
      } else if (args.action === "inspect") {
        value = await run(session, record, "agent", "inspect", null, args.intent);
        value.browserId = record.id;
        var image = value.image; delete value.image;
        return { content: [{ type: "text", text: JSON.stringify(value) }, { type: "image", mimeType: "image/jpeg", data: image }] };
      } else {
        value = await run(session, record, "agent", "action", policy.validateAction(Object.assign({}, args, { kind: args.action })), args.intent);
      }
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch (e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
  }
  function handleMessage(ws, msg) {
    if (!msg.type || msg.type.indexOf("shared_browser_") !== 0) return false;
    var session = ctx.getSessionForWs(ws);
    Promise.resolve().then(async function () {
      requireAccess(session, ws);
      if (String(msg.sessionId) !== String(session.localId)) throw new Error("Browser session changed");
      var record;
      if (msg.type === "shared_browser_state_request") { sendState(ws, session, sessionRecords(session)[0]); return; }
      if (msg.type === "shared_browser_open") { record = create(session, "user", msg.newTab === true); sendState(ws, session, record, true, true); return; }
      record = selectRecord(session, msg.browserId);
      if (!record || !recordAllowed(record, ws) || msg.browserId !== record.id) throw new Error("Browser session expired");
      if (msg.type === "shared_browser_view") {
        if (msg.visible) { var previous = records.get(viewers.get(ws)); viewers.set(ws, record.id); if (previous && previous !== record) visibility(previous); if (record.frame) ctx.sendTo(ws, record.frame); }
        else viewers.delete(ws);
        visibility(record);
      } else if (msg.type === "shared_browser_control") {
        if (!["agent", "user"].includes(msg.control)) throw new Error("Invalid control mode");
        await changeControl(record, msg.control);
      } else if (msg.type === "shared_browser_close") {
        end(record); records.delete(record.id);
        sendState(ws, session, sessionRecords(session)[0]);
        ctx.clients.forEach(function (peer) { if (peer !== ws && ctx.getSessionForWs(peer) === session) sendState(peer, session, sessionRecords(session)[0]); });
      } else if (msg.type === "shared_browser_end") end(record);
      else if (msg.type === "shared_browser_input") {
        if (msg.epoch !== record.epoch) throw new Error("Browser control changed");
        await run(session, record, "user", "action", policy.validateAction(msg.event));
      }
    }).catch(function (e) {
      if (ws.readyState === 1) ctx.sendTo(ws, { type: "shared_browser_error", sessionId: msg.sessionId, error: e.message });
    });
    return true;
  }
  var sweep = setInterval(function () {
    viewers.forEach(function (id, ws) { if (ws.readyState !== 1) viewers.delete(ws); });
    records.forEach(function (record, key) {
      if (!recordAllowed(record)) { end(record, "Browser session is no longer available"); records.delete(key); }
      else if (Date.now() - record.touched > 30 * 60 * 1000) { end(record, "Browser expired after 30 minutes without activity"); records.delete(key); }
      else visibility(record);
    });
  }, 15000);
  sweep.unref();
  function getToolDefs(session) {
    var generation = Number(session && session._sdkQueryGeneration || 0);
    return ctx.isMate ? [] : browserTools.getToolDefs(function (args) {
      if (session && Number(session._sdkQueryGeneration || 0) !== generation) {
        return Promise.resolve({ isError: true, content: [{ type: "text", text: "This browser tool belongs to an older query" }] });
      }
      return tool(session, args || {});
    });
  }
  return {
    handleMessage: handleMessage,
    getToolDefs: getToolDefs,
    getSystemPrompt: function () { return ctx.isMate ? "" : browserTools.PROMPT; },
    createMcpServer: function (adapter, session) { return ctx.isMate || !adapter || typeof adapter.createToolServer !== "function" ? null : adapter.createToolServer({ name: "clay-shared-browser", version: "1.0.0", tools: getToolDefs(session) }); },
    destroy: function () { destroyed = true; clearInterval(sweep); records.forEach(function (record) { end(record); }); records.clear(); viewers.clear(); },
  };
}
module.exports = { attachSharedBrowser: attachSharedBrowser };
