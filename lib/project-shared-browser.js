var activityHistory = require("./shared-browser-activity-history");
var crypto = require("crypto");
var policy = require("./shared-browser-policy");
var browserTools = require("./shared-browser-tools");
var createRuntime = require("./shared-browser-runtime").createRuntime;
var workspace = require('./shared-browser-workspace');

function attachSharedBrowser(ctx) {
  var storageStore = ctx.storageStore || require("./shared-browser-storage").attachStorageStore(require("./config").CONFIG_DIR);
  var records = new Map();
  var viewers = new Map();
  var destroyed = false;
  function allowed(session, ws) {
    try {
      if (!session || ctx.sm.sessions.get(session.localId) !== session) return false;
      if (ctx.isMate && ctx.usersModule.isMultiUser() && (!ctx.ownerId || session.ownerId !== ctx.ownerId)) return false;
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
    try { return allowed(record.session, ws) && record.ownerId === record.session.ownerId && record.identity === identityKey(record.session) && record.sourceStamp === workspace.sourceStamp(record.session); }
    catch (e) { return false; }
  }
  function requireAccess(session, ws) {
    if (!allowed(session, ws)) throw new Error("Shared browser access is not permitted for this session");
  }
  function projection(record) {
    if (!record) return null;
    return { id: record.id, phase: record.phase, control: record.control, epoch: record.epoch, handoff: !!record.handoff,
      browserLink: record.url ? "browser:" + record.url : null, incognito: record.incognito, personalCookiesAvailable: !!ctx.isMate, url: record.url, width: record.width, height: record.height, activity: record.activity || null, activityHistory: record.activityHistory || [], pointer: record.pointer || null, error: record.error || "" };
  }
  function sessionRecords(session) {
    return Array.from(records.values()).filter(function (record) { return record.session === session && recordAllowed(record); });
  }
  function humanAllowed(session, record, ws) {
    return allowed(session, ws) && recordAllowed(record, ws) &&
      (record.session === session || workspace.linkedWorker(ctx, session, record.session));
  }
  function humanRecords(session, ws) {
    return Array.from(records.values()).filter(function (record) { return humanAllowed(session, record, ws); });
  }
  function requireHumanRecord(session, record, ws) {
    if (ctx.getSessionForWs(ws) !== session || !humanAllowed(session, record, ws)) throw new Error('Browser session expired');
  }
  function selectRecord(session, id, ws) {
    var tabs = ws ? humanRecords(session, ws) : sessionRecords(session);
    if (id) {
      var record = records.get(id);
      if (!record || tabs.indexOf(record) < 0) throw new Error("Browser tab expired");
      return record;
    }
    if (tabs.length > 1) throw new Error("Choose a browserId from status before operating a tab");
    return tabs[0] || null;
  }
  function sendBrowserMessage(ws, session, message) {
    var payload = require('./pane-session-transport').outbound(ws, message, session.localId);
    if (payload) ctx.sendTo(ws, payload);
  }
  function sendState(ws, session, record, present, focus) {
    if (!ws || ws.readyState !== 1 || !allowed(session, ws)) return;
    var tabs = humanRecords(session, ws);
    if (!record || tabs.indexOf(record) < 0) record = tabs[0] || null;
    function humanProjection(tab) { return Object.assign({}, projection(tab), workspace.describe(tab)); }
    sendBrowserMessage(ws, session, { type: "shared_browser_state", sessionId: session.localId, browser: record ? humanProjection(record) : null,
      browsers: tabs.map(humanProjection), present: !!present && record && record.session === session, focus: !!focus });
  }
  function broadcast(record, present) {
    ctx.clients.forEach(function (ws) {
      var session = ctx.getSessionForWs(ws);
      if (session && (session.ownerId || null) === (record.ownerId || null)) sendState(ws, session, record, present);
    });
  }
  function watching(record, ws) {
    var viewer = viewers.get(ws);
    return ws.readyState === 1 && viewer && viewer.id === record.id && ctx.getSessionForWs(ws) === viewer.session &&
      viewer.sourceStamp === workspace.sourceStamp(viewer.session) && humanAllowed(viewer.session, record, ws);
  }
  function visibility(record) {
    if (!record.runtime) return;
    var visible = false;
    viewers.forEach(function (viewer, ws) { if (viewer.id === record.id && watching(record, ws)) visible = true; });
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
    if (message.type === "navigation") {
      try { record.navigationUrl = policy.browserUrl(message.navigationUrl || message.url); } catch (error) { record.navigationUrl = null; }
    }
    if (message.type === "navigation" && !record.incognito) {
      try { storageStore.visit(record.cookieOwner, message.url); }
      catch (error) { end(record, "Could not save personal browsing history"); return; }
    }
    if (message.type === "ready") { record.phase = "live"; record.resolveReady(); }
    if (message.type === "error") { end(record, message.error); return; }
    if (message.url !== undefined) record.url = policy.visibleUrl(message.url);
    if (message.width) { record.width = message.width; record.height = message.height; }
    if (message.type === "frame") {
      record.frame = { type: "shared_browser_frame", sessionId: record.session.localId, browserId: record.id,
        data: message.data, width: record.width, height: record.height };
      viewers.forEach(function (id, ws) {
        if (watching(record, ws) && ws.bufferedAmount < 1024 * 1024) {
          var session = viewers.get(ws).session;
          sendBrowserMessage(ws, session, Object.assign({}, record.frame, { sessionId: session.localId }));
        }
      });
      visibility(record);
    } else broadcast(record);
  }
  // Every new tab starts shared. Exclusive human mode is explicit, per tab, and only the human clears it,
  // so an agent open never reuses (or bypasses) an exclusive tab.
  function create(session, actor, newTab, incognito) {
    requireAccess(session);
    if (incognito !== undefined && typeof incognito !== "boolean") throw new Error("Invalid incognito mode");
    var temporary = !ctx.isMate || incognito === true;
    var tabs = sessionRecords(session);
    var previous = !newTab && tabs.find(function (record) { return record.runtime && (incognito === undefined || record.incognito === temporary) && (actor === "user" || record.control === "agent"); });
    if (previous) return previous;
    if (tabs.length >= 12) {
      var expired = tabs.find(function (record) { return !record.runtime; });
      if (expired) records.delete(expired.id);
      else throw new Error("Close a browser tab before opening another");
    }
    var active = 0;
    records.forEach(function (record) { if (record.runtime && record.ownerId === session.ownerId) active++; });
    if (active >= 4) throw new Error("End another browser before opening more than four active tabs");
    var record = { session: session, sourceStamp: workspace.sourceStamp(session), ownerId: session.ownerId, identity: identityKey(session), id: crypto.randomUUID(), phase: "starting", control: "agent", epoch: 0,
      cookieOwner: ctx.isMate ? (ctx.ownerId || session.ownerId || "default") : null, incognito: temporary, url: "", width: 1280, height: 800, touched: Date.now(), runtime: null, frame: null };
    record.ready = new Promise(function (resolve, reject) { record.resolveReady = resolve; record.rejectReady = reject; });
    record.ready.catch(function () {});
    records.set(record.id, record);
    try {
      record.runtime = (ctx.createRuntime || createRuntime)({ identity: ctx.getIdentity(session), storage: temporary ? null : {
        read: function () { if (!recordAllowed(record)) throw new Error("Browser access was revoked"); return storageStore.read(record.cookieOwner); },
        exchange: function (previous, current) { if (!recordAllowed(record)) throw new Error("Browser access was revoked"); return storageStore.exchange(record.cookieOwner, previous, current); },
      }, onEvent: function (message) { receive(record, message); } });
    } catch (e) { end(record, e.message); }
    broadcast(record, true);
    return record;
  }
  async function changeControl(record, control, validate) {
    if (validate) validate();
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
    } catch (e) { if (record.runtime && record.epoch === epoch) end(record, e.message); }
    if (record.runtime && record.epoch === epoch) {
      record.handoff = false;
      if (validate) validate();
      broadcast(record);
    }

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
  async function run(session, record, actor, action, event, intent, presentationStart, validate) {
    if (validate) validate();
    requireAccess(session);
    if (!record || !record.runtime || !recordAllowed(record)) throw new Error("Open a browser first");
    if (record.handoff) throw new Error("Browser control is changing; wait for the handoff");
    // control "agent" = shared (owner and Clay may both act); "user" = exclusive human mode (Clay mutations denied).
    // The authorized owner is never blocked by control mode and ordinary human input never changes it.
    if (action !== "inspect" && actor === "agent" && record.control !== "agent") throw new Error("Only the user can control this browser right now (Clay is paused). Wait for them to resume shared control; do not work around it.");
    if (action !== 'inspect') { record.presentationRevision = (record.presentationRevision || 0) + 1; if (presentationStart) presentationStart(record.presentationRevision); }
    var epoch = record.epoch;
    var generation = Number(session._sdkQueryGeneration || 0);
    await record.ready;
    if (actor === "agent" && Number(session._sdkQueryGeneration || 0) !== generation) throw new Error("Browser request belongs to an older query");
    requireAccess(session);
    if (validate) validate();
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
    if (validate) validate();
    if (actor === "agent" && Number(session._sdkQueryGeneration || 0) !== generation) throw new Error("Browser result belongs to an older query");
    if (!recordAllowed(record) || records.get(record.id) !== record || record.epoch !== epoch) throw new Error("Browser control changed during the action");
    if (result && result.url !== undefined) record.url = policy.visibleUrl(result.url);
    return result;
  }
  async function tool(session, args) {
    var observer;
    try {
      requireAccess(session);
      if (args.intent !== undefined && (typeof args.intent !== "string" || args.intent.length > 160)) throw new Error("Browser intent must be at most 160 characters");
      var record = args.action === "status" || args.action === "open" ? null : selectRecord(session, args.browserId);
      var value, actionRevision = record && (record.presentationRevision || 0);
      function presentationStart(value) { actionRevision = value; }
      if (['status', 'inspect'].indexOf(args.action) < 0 && ctx.getPresentation) { var display = ctx.getPresentation(session); if (display) observer = ctx.studioPresentation ? ctx.studioPresentation.begin(session, 'browser') : display.track('studio', 'browser'); }
      if (args.action === "status") value = { browsers: sessionRecords(session).map(projection) };
      else if (args.action === "open") {
        if (args.incognito !== undefined && typeof args.incognito !== "boolean") throw new Error("Invalid incognito mode");
        var url = args.url ? policy.browserUrl(args.url) : null;
        record = args.browserId ? selectRecord(session, args.browserId) : create(session, "agent", args.newTab === true, args.incognito);
        if (args.incognito !== undefined && record.incognito !== (!ctx.isMate || args.incognito)) throw new Error("This tab has a different cookie mode. Open a new tab with the requested mode.");
        if (url) await run(session, record, "agent", "action", { kind: "navigate", url: url }, args.intent, presentationStart);
        else actionRevision = record.presentationRevision || 0;
        value = projection(record);
      } else if (args.action === "finish") {
        if (!record || !record.runtime) throw new Error("Open a browser first");
        value = await settle(record);
      } else if (args.action === "inspect") {
        value = await run(session, record, "agent", "inspect", null, args.intent);
        value.browserId = record.id;
        value.browserLink = record.url ? "browser:" + record.url : null;
        var image = value.image; delete value.image;
        return { content: [{ type: "text", text: JSON.stringify(value) }, { type: "image", mimeType: "image/jpeg", data: image }] };
      } else {
        value = await run(session, record, "agent", "action", policy.validateAction(Object.assign({}, args, { kind: args.action })), args.intent, presentationStart);
      }
      if (observer && observer.present) {
        observer.phase('completed');
        try {
          observer.guard();
          var expectedRecord = record, expectedEpoch = record.epoch, expectedUrl = record.url;
          if ((record.presentationRevision || 0) !== actionRevision || record.control !== 'agent') throw new Error('The browser changed after this action.');
          var view = await run(session, record, 'agent', 'inspect', null, args.intent);
          if (view && view.url && policy.visibleUrl(view.url) !== expectedUrl) throw new Error('The browser navigated after this action.');
          if (!view || typeof view.image !== 'string' || !view.image) throw new Error('No exact browser frame was returned.');
          observer.present({ type: 'shared_browser_frame', sessionId: session.localId, browserId: record.id, data: view.image, width: view.width, height: view.height }, 'browser', record.id, require('./clay-control-target-projection').digest(view.image), function () { requireAccess(session); if (records.get(expectedRecord.id) !== expectedRecord || !recordAllowed(expectedRecord) || expectedRecord.epoch !== expectedEpoch || expectedRecord.url !== expectedUrl || expectedRecord.control !== 'agent' || (expectedRecord.presentationRevision || 0) !== actionRevision || !expectedRecord.runtime) throw new Error('Browser target changed.'); }, function (message, onSent) { return ctx.sendToSession(session.localId, message, onSent); });
        } catch (visibilityError) { observer.noVisibility(); }
      } else if (observer) observer.finish({ status: 'completed' });
      if (value && value.url) value.browserLink = "browser:" + policy.visibleUrl(value.url);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch (e) { if (observer) { if (observer.unknown) observer.unknown(); else observer.finish({ outcome: "uncertain" }); } return { isError: true, content: [{ type: "text", text: e.message }] }; }
  }
  async function openLinkedPage(session, url, incognito) {
    var record = sessionRecords(session).find(function (tab) {
      return tab.runtime && ((tab.phase === "live" && (tab.navigationUrl || tab.url) === url) || (tab.linkOpening && tab.linkOpening.url === url));
    });
    if (record) { if (record.linkOpening) await record.linkOpening.promise; return record; }
    record = create(session, "user", true, incognito);
    record.navigationUrl = url;
    record.linkOpening = { url: url, promise: run(session, record, "user", "action", { kind: "navigate", url: url }) };
    try { await record.linkOpening.promise; } finally { record.linkOpening = null; }
    return record;
  }
  function handleMessage(ws, msg) {
    if (!msg.type || msg.type.indexOf("shared_browser_") !== 0) return false;
    var session = ctx.getSessionForWs(ws);
    var requestStamp = workspace.sourceStamp(session), requestBinding = ws._clayPaneActivation;
    Promise.resolve().then(async function () {
      function validateRecord() {
        if (requestStamp !== workspace.sourceStamp(session) || requestBinding !== ws._clayPaneActivation ||
            requestBinding && (!ws._clayPaneActivationValid || !ws._clayPaneActivationValid())) throw new Error('Browser session changed');
        requireHumanRecord(session, record, ws);
      }
      requireAccess(session, ws);
      if (String(msg.sessionId) !== String(session.localId)) throw new Error("Browser session changed");
      var record;
      if (msg.type === "shared_browser_settings") {
        if (!ctx.isMate) throw new Error("Personal browser settings are available only in Mates");
        if (typeof msg.requestId !== "string" || msg.requestId.length > 100) throw new Error("Invalid browser settings request");
        var owner = ctx.ownerId || session.ownerId || "default";
        var settings = storageStore.manage(owner, msg.operation, msg.target);
        requireAccess(session, ws);
        ctx.sendTo(ws, { type: "shared_browser_settings", sessionId: session.localId, requestId: msg.requestId, settings: settings });
        return;
      }
      if (msg.type === "shared_browser_state_request") { sendState(ws, session, sessionRecords(session)[0]); return; }
      if (msg.type === "shared_browser_open") {
        var targetUrl = msg.url === undefined ? null : policy.browserUrl(msg.url);
        if (targetUrl) record = await openLinkedPage(session, targetUrl, msg.incognito);
        else {
          var existing = msg.newTab !== true && msg.incognito === undefined && humanRecords(session, ws).filter(function (tab) { return !!tab.runtime; });
          record = existing && (existing.find(function (tab) { return tab.session === session; }) || existing[0]) || create(session, "user", msg.newTab === true, msg.incognito);
        }
        sendState(ws, session, record, true, true); return;
      }
      record = selectRecord(session, msg.browserId, ws);
      if (!record || !recordAllowed(record, ws) || msg.browserId !== record.id) throw new Error("Browser session expired");
      validateRecord();
      if (msg.type === "shared_browser_view") {
        if (msg.visible) {
          var previousViewer = viewers.get(ws), previous = previousViewer && records.get(previousViewer.id);
          viewers.set(ws, { id: record.id, session: session, sourceStamp: workspace.sourceStamp(session) });
          if (previous && previous !== record) visibility(previous);
          if (record.frame) sendBrowserMessage(ws, session, Object.assign({}, record.frame, { sessionId: session.localId }));
        }
        else viewers.delete(ws);
        visibility(record);
      } else if (msg.type === "shared_browser_control") {
        if (!["agent", "user"].includes(msg.control)) throw new Error("Invalid control mode");
        await changeControl(record, msg.control, validateRecord);
      } else if (msg.type === "shared_browser_close") {
        end(record); records.delete(record.id);
        sendState(ws, session, sessionRecords(session)[0]);
        broadcast(record);
      } else if (msg.type === "shared_browser_end") end(record);
      else if (msg.type === "shared_browser_input") {
        if (msg.epoch !== record.epoch) throw new Error("Browser control changed");
        await run(session, record, "user", "action", policy.validateAction(msg.event), null, null, validateRecord);
      }
    }).catch(function (e) {
      if (ws.readyState === 1) ctx.sendTo(ws, { type: "shared_browser_error", sessionId: msg.sessionId, error: e.message, requestId: msg.requestId });
    });
    return true;
  }
  var sweep = setInterval(function () {
    viewers.forEach(function (viewer, ws) { var record = records.get(viewer.id); if (!record || !watching(record, ws)) viewers.delete(ws); });
    records.forEach(function (record, key) {
      if (!recordAllowed(record)) { end(record, "Browser session is no longer available"); records.delete(key); }
      else if (Date.now() - record.touched > 30 * 60 * 1000) { end(record, "Browser expired after 30 minutes without activity"); records.delete(key); }
      else visibility(record);
    });
  }, 15000);
  sweep.unref();
  function getToolDefs(session) {
    var generation = Number(session && session._sdkQueryGeneration || 0);
    return browserTools.getToolDefs(function (args) {
      if (session && Number(session._sdkQueryGeneration || 0) !== generation) {
        return Promise.resolve({ isError: true, content: [{ type: "text", text: "This browser tool belongs to an older query" }] });
      }
      return tool(session, args || {});
    });
  }
  return {
    refresh: function () {
      viewers.forEach(function (viewer, ws) { var record = records.get(viewer.id); if (!record || !watching(record, ws)) { viewers.delete(ws); if (record) visibility(record); } });
      ctx.clients.forEach(function (ws) { var session = ctx.getSessionForWs(ws); if (session) sendState(ws, session); });
    },
    handleMessage: handleMessage,
    getToolDefs: getToolDefs,
    getSystemPrompt: function () { return browserTools.PROMPT; },
    createMcpServer: function (adapter, session) { return !adapter || typeof adapter.createToolServer !== "function" ? null : adapter.createToolServer({ name: "clay-shared-browser", version: "1.0.0", tools: getToolDefs(session) }); },
    destroy: function () { destroyed = true; clearInterval(sweep); records.forEach(function (record) { end(record); }); records.clear(); viewers.clear(); },
  };
}
module.exports = { attachSharedBrowser: attachSharedBrowser };
