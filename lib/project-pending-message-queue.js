var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var config = require("./config");
var sessionProvenance = require("./session-provenance");

var MAX_TEXT = 100000;
var MAX_PASTES = 20;
var MAX_PASTE_LENGTH = 500000;
var MAX_IMAGES = 20;
var MAX_IMAGE_DATA = 25 * 1024 * 1024;
var MAX_TOTAL_BYTES = 32 * 1024 * 1024;
var MAX_ACTIVE_ITEMS = 100;
var IMAGE_TYPE_RE = /^image\/[a-z0-9.+-]{1,64}$/i;
var CLIENT_MESSAGE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function defaultFilePath(opts) {
  var identity = String(opts.slug || "") + "\n" + path.resolve(opts.cwd || process.cwd());
  return path.join(config.CONFIG_DIR, "pending-message-queues", crypto.createHash("sha256").update(identity).digest("hex") + ".json");
}

function createPendingMessageQueue(opts) {
  var filePath = opts.filePath || defaultFilePath(opts);
  var broadcast = opts.broadcast || opts.send || function () {};
  var authorize = opts.authorize || function () { return true; };
  var canMutate = opts.canMutate || authorize;
  var loaded = load();
  var data = loaded.data;
  var loadError = loaded.error;

  function emptyData() { return { version: 1, revision: 0, nextId: 1, items: [], paused: {} }; }
  function validStored(parsed) {
    if (!parsed || parsed.version !== 1 || !Number.isInteger(parsed.revision) || parsed.revision < 0 || !Number.isInteger(parsed.nextId) || parsed.nextId < 1 || !Array.isArray(parsed.items)) return false;
    if (parsed.paused !== undefined && (!parsed.paused || typeof parsed.paused !== "object" || Array.isArray(parsed.paused))) return false;
    var pausedKeys = Object.keys(parsed.paused || {});
    for (var pausedIndex = 0; pausedIndex < pausedKeys.length; pausedIndex++) if (pausedKeys[pausedIndex].length > 300 || parsed.paused[pausedKeys[pausedIndex]] !== true) return false;
    for (var i = 0; i < parsed.items.length; i++) {
      var item = parsed.items[i];
      if (!item || typeof item.id !== "string" || typeof item.sessionKey !== "string" || typeof item.projectSlug !== "string" || typeof item.actorId !== "string" || !item.message || ["pending", "claimed", "consumed", "cancelled", "failed"].indexOf(item.state) < 0) return false;
      if (item.schedule !== undefined && (!item.schedule || typeof item.schedule !== "object" || typeof item.schedule.jobId !== "string" || typeof item.schedule.revision !== "string" || typeof item.schedule.ready !== "boolean" || !Number.isFinite(Number(item.schedule.notBefore)))) return false;
    }
    return true;
  }
  function load() {
    if (!fs.existsSync(filePath)) return { data: emptyData(), error: null };
    try {
      var parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!validStored(parsed)) return { data: emptyData(), error: "Queue storage is malformed" };
      if (!parsed.paused) parsed.paused = {};
      return { data: parsed, error: null };
    } catch (e) {
      return { data: emptyData(), error: "Queue storage is unreadable" };
    }
  }
  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    var tmp = filePath + ".tmp." + process.pid + "." + crypto.randomBytes(6).toString("hex");
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }
  var persist = opts.persist || save;
  function key(session) {
    var hadOrigin = !!(session && session.sessionOriginId);
    var origin = sessionProvenance.ensureOrigin(session);
    if (!hadOrigin && origin && typeof opts.ensureSessionIdentity === "function") opts.ensureSessionIdentity(session);
    return String(origin);
  }
  function actorId(actor) { return actor && actor.id ? String(actor.id) : "default"; }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function restore(snapshot) { data.version = snapshot.version; data.revision = snapshot.revision; data.nextId = snapshot.nextId; data.items = snapshot.items; data.paused = snapshot.paused || {}; }
  function targetKey(session) { return String(opts.slug) + ":" + key(session); }
  function isPaused(session) { return !!(session && data.paused[targetKey(session)]); }
  function sameTarget(item, session) { return !!(item && session && item.sessionKey === key(session) && item.projectSlug === opts.slug); }
  function scoped(item, session, actor) { return sameTarget(item, session) && item.actorId === actorId(actor); }
  function visible(session, actor) {
    if (loadError || !session || !authorize(session, actor)) return [];
    var out = [];
    for (var i = 0; i < data.items.length; i++) if (sameTarget(data.items[i], session)) out.push(copy(data.items[i]));
    return out;
  }
  function result(ok, error, session, actor) {
    return { ok: ok, error: error || null, revision: data.revision, sessionId: session ? session.localId : null, projectSlug: opts.slug, paused: session ? isPaused(session) : false, items: session ? visible(session, actor) : [] };
  }
  function validateMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) return "Invalid message";
    var text = message.text == null ? "" : message.text;
    if (typeof text !== "string" || text.length > MAX_TEXT) return "Message text is invalid or too long";
    var pastes = message.pastes == null ? [] : message.pastes;
    if (!Array.isArray(pastes) || pastes.length > MAX_PASTES) return "Too many paste attachments";
    for (var i = 0; i < pastes.length; i++) if (typeof pastes[i] !== "string" || pastes[i].length > MAX_PASTE_LENGTH) return "Invalid paste attachment";
    var images = message.images == null ? [] : message.images;
    if (!Array.isArray(images) || images.length > MAX_IMAGES) return "Too many image attachments";
    for (var j = 0; j < images.length; j++) {
      var image = images[j];
      if (!image || typeof image !== "object" || !IMAGE_TYPE_RE.test(image.mediaType || "") || typeof image.data !== "string" || image.data.length > MAX_IMAGE_DATA) return "Invalid image attachment";
    }
    if (!text.trim() && !pastes.length && !images.length) return "Message must contain text or an attachment";
    if (message.clientMessageId != null && (typeof message.clientMessageId !== "string" || !CLIENT_MESSAGE_ID_RE.test(message.clientMessageId))) return "Invalid client message identifier";
    try { if (Buffer.byteLength(JSON.stringify(message), "utf8") > MAX_TOTAL_BYTES) return "Message payload is too large"; }
    catch (e) { return "Invalid message payload"; }
    return null;
  }
  function sanitizeImages(images) {
    if (!Array.isArray(images)) return images;
    return images.map(function (image) { return { mediaType: image.mediaType, data: image.data }; });
  }
  function inspect(session, actor, clientMessageId) {
    if (loadError || !clientMessageId) return null;
    for (var i = 0; i < data.items.length; i++) if (data.items[i].clientMessageId === clientMessageId && scoped(data.items[i], session, actor)) return copy(data.items[i]);
    return null;
  }
  function hasActive(session) {
    if (loadError || !session) return false;
    for (var i = 0; i < data.items.length; i++) if (sameTarget(data.items[i], session) && (data.items[i].state === "pending" || data.items[i].state === "claimed")) return true;
    return false;
  }
  function admitInternal(session, message, actor, trustedSchedule) {
    if (loadError) return result(false, loadError, session, actor);
    if (!session || !canMutate(session, actor, null)) return result(false, "Not authorized", session, actor);
    var validationError = validateMessage(message);
    if (validationError) return result(false, validationError, session, actor);
    var clientId = message.clientMessageId ? String(message.clientMessageId) : null;
    var duplicate = inspect(session, actor, clientId);
    if (duplicate) {
      var duplicateResult = result(duplicate.state !== "cancelled" && duplicate.state !== "failed", duplicate.state === "cancelled" ? "Message was cancelled" : duplicate.state === "failed" ? "Message delivery failed" : null, session, actor);
      duplicateResult.item = duplicate;
      return duplicateResult;
    }
    var activeCount = 0;
    for (var activeIndex = 0; activeIndex < data.items.length; activeIndex++) {
      if (sameTarget(data.items[activeIndex], session) && (data.items[activeIndex].state === "pending" || data.items[activeIndex].state === "claimed")) activeCount++;
    }
    if (activeCount >= MAX_ACTIVE_ITEMS) return result(false, "Pending message queue is full", session, actor);
    var before = copy(data);
    var storedMessage = copy(message);
    delete storedMessage.schedule;
    if (Object.prototype.hasOwnProperty.call(storedMessage, "images")) storedMessage.images = sanitizeImages(storedMessage.images);
    var item = { id: "pm_" + data.nextId++, sessionKey: key(session), sessionLocalId: session.localId, projectSlug: opts.slug, actorId: actorId(actor), actorName: actor && (actor.displayName || actor.username || actor.name) ? String(actor.displayName || actor.username || actor.name).slice(0, 120) : null, clientMessageId: clientId, message: storedMessage, createdAt: Date.now(), state: "pending" };
    if (trustedSchedule) item.schedule = copy(trustedSchedule);
    delete item.message._pendingConsumed;
    delete item.message._scheduledJobId;
    delete item.message._scheduledRevision;
    delete item.message._scheduledNotBefore;
    data.items.push(item);
    data.revision++;
    try { persist(); } catch (e) { restore(before); return result(false, "Queue storage failed", session, actor); }
    broadcast(session, { type: "pending_message_queued", sessionId: session.localId, projectSlug: opts.slug, paused: isPaused(session), item: copy(item), revision: data.revision });
    var admitted = result(true, null, session, actor);
    admitted.item = copy(item);
    return admitted;
  }
  function admit(session, message, actor) { return admitInternal(session, message, actor, null); }
  function mutate(session, actor, id, expectedRevision, expectedSessionId, operation, allowedStates) {
    if (loadError) return result(false, loadError, session, actor);
    if (!session || session.localId !== expectedSessionId || !authorize(session, actor)) return result(false, "Session changed", session, actor);
    if (expectedRevision !== data.revision) return result(false, "Stale queue revision", session, actor);
    var index = -1;
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id && sameTarget(data.items[i], session)) index = i;
    var mutableStates = allowedStates || ["pending"];
    if (index < 0 || mutableStates.indexOf(data.items[index].state) < 0 || !canMutate(session, actor, data.items[index])) return result(false, "Pending message not found", session, actor);
    var before = copy(data);
    operation(data.items, index);
    data.revision++;
    try { persist(); } catch (e) { restore(before); return result(false, "Queue storage failed", session, actor); }
    if (data.items[index].state === "cancelled" && session._pendingMessageClaimId === data.items[index].id) delete session._pendingMessageClaimId;
    broadcast(session, { type: "pending_message_state", sessionId: session.localId, projectSlug: opts.slug, paused: isPaused(session), revision: data.revision, items: visible(session, actor) });
    if (data.items[index].state === "cancelled" && typeof opts.onItemCancelled === "function") opts.onItemCancelled(copy(data.items[index]));
    return result(true, null, session, actor);
  }
  function edit(session, actor, id, revision, expectedSessionId, message) {
    var current = null;
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id && sameTarget(data.items[i], session)) current = data.items[i];
    var text = message && message.text;
    if (typeof text !== "string" || text.length > MAX_TEXT) return result(false, "Edited text is invalid or too long", session, actor);
    var proposed = current ? Object.assign({}, current.message, { text: text }) : null;
    if (message && Object.prototype.hasOwnProperty.call(message, "images")) {
      proposed = Object.assign({}, proposed, { images: message.images });
    }
    if (current) {
      var validationError = validateMessage(proposed);
      if (validationError) return result(false, validationError, session, actor);
    }
    if (current && (!session || session.localId !== expectedSessionId || !authorize(session, actor) || revision !== data.revision || current.state !== "pending" || !canMutate(session, actor, current))) return result(false, "Pending message not found", session, actor);
    return mutate(session, actor, id, revision, expectedSessionId, function (items, index) {
      var nextMessage = Object.assign({}, items[index].message, proposed || { text: text });
      if (message && Object.prototype.hasOwnProperty.call(message, "images")) nextMessage.images = sanitizeImages(message.images);
      items[index].message = nextMessage;
    });
  }
  function cancel(session, actor, id, revision, expectedSessionId) {
    return mutate(session, actor, id, revision, expectedSessionId, function (items, index) { items[index].state = "cancelled"; }, ["pending", "claimed"]);
  }
  function reorder(session, actor, ids, revision, expectedSessionId) {
    if (loadError) return result(false, loadError, session, actor);
    var positions = [];
    var pending = [];
    for (var i = 0; i < data.items.length; i++) if (scoped(data.items[i], session, actor) && data.items[i].state === "pending") { positions.push(i); pending.push(data.items[i].id); }
    if (!Array.isArray(ids) || ids.length !== pending.length) return result(false, "Reorder must include every owned pending message", session, actor);
    var seen = {};
    for (var j = 0; j < ids.length; j++) {
      if (seen[ids[j]] || pending.indexOf(ids[j]) < 0) return result(false, "Reorder contains a duplicate, foreign, or nonpending message", session, actor);
      seen[ids[j]] = true;
    }
    if (!ids.length) return result(true, null, session, actor);
    return mutate(session, actor, ids[0], revision, expectedSessionId, function (items) {
      var byId = {};
      for (var k = 0; k < positions.length; k++) byId[items[positions[k]].id] = items[positions[k]];
      for (var n = 0; n < positions.length; n++) items[positions[n]] = byId[ids[n]];
    });
  }
  function pause(session, actor) {
    if (loadError || !session || !authorize(session, actor)) return false;
    if (!hasActive(session)) return true;
    if (isPaused(session)) return true;
    var before = copy(data);
    data.paused[targetKey(session)] = true;
    data.revision++;
    try { persist(); } catch (e) { restore(before); return false; }
    broadcast(session, { type: "pending_message_state", sessionId: session.localId, projectSlug: opts.slug, paused: true, revision: data.revision, items: visible(session, actor) });
    return true;
  }
  function resume(session, actor, expectedRevision, expectedSessionId) {
    if (loadError) return result(false, loadError, session, actor);
    if (!session || session.localId !== expectedSessionId || !authorize(session, actor)) return result(false, "Session changed", session, actor);
    if (expectedRevision !== data.revision) return result(false, "Stale queue revision", session, actor);
    if (!isPaused(session)) return result(true, null, session, actor);
    var before = copy(data);
    delete data.paused[targetKey(session)];
    data.revision++;
    try { persist(); } catch (e) { restore(before); return result(false, "Queue storage failed", session, actor); }
    broadcast(session, { type: "pending_message_state", sessionId: session.localId, projectSlug: opts.slug, paused: false, revision: data.revision, items: visible(session, actor) });
    return result(true, null, session, actor);
  }
  function finishClaim(session, id, ok, error) {
    var index = -1;
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id && sameTarget(data.items[i], session) && data.items[i].state === "claimed") index = i;
    if (index < 0) return false;
    var before = copy(data);
    data.items[index].state = ok === "release" ? "pending" : ok ? "consumed" : "failed";
    if (ok === "release") delete data.items[index].claimedAt;
    else data.items[index][ok ? "consumedAt" : "failedAt"] = Date.now();
    if (!ok) data.items[index].failure = error || "Pending message dispatch was rejected";
    data.revision++;
    try { persist(); } catch (e) { restore(before); return false; }
    if (session._pendingMessageClaimId === id) delete session._pendingMessageClaimId;
    broadcast(session, { type: ok === "release" ? "pending_message_state" : "pending_message_consumed", sessionId: session.localId, projectSlug: opts.slug, paused: isPaused(session), id: id, state: data.items[index].state, items: ok === "release" ? visible(session, { id: data.items[index].actorId }) : undefined, revision: data.revision });
    if (ok === true && typeof opts.onItemConsumed === "function") opts.onItemConsumed(copy(data.items[index]));
    return true;
  }
  function consumeOne(session, dispatch) {
    if (loadError || !session || session._pendingMessageClaimId || isPaused(session) || session._pendingMessageDrainPaused || session.taskStopRequested || session._queryStarting || session._awaitingTurnResult || session.isProcessing) return null;
    if (session.rateLimitResetsAt && session.rateLimitResetsAt > Date.now()) return null;
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      if (!sameTarget(item, session) || item.state !== "pending") continue;
      if (item.schedule && !item.schedule.ready) continue;
      if (!canMutate(session, { id: item.actorId }, item)) continue;
      var before = copy(data);
      item.state = "claimed";
      item.claimedAt = Date.now();
      data.revision++;
      try { persist(); } catch (e) { restore(before); return null; }
      session._pendingMessageClaimId = item.id;
      broadcast(session, { type: "pending_message_claimed", sessionId: session.localId, projectSlug: opts.slug, paused: isPaused(session), id: item.id, revision: data.revision });
      var completed = false;
      function complete(ok, error) { if (completed) return false; completed = true; return finishClaim(session, item.id, ok, error); }
      try { if (dispatch(copy(item), complete) === false) complete(false, "Pending message dispatch was rejected"); }
      catch (e) { complete(false, e.message || String(e)); }
      return copy(item);
    }
    return null;
  }
  function hydrate(session, actor) { return result(!loadError, loadError, session, actor); }
  function isClaimed(session, id) {
    for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id && sameTarget(data.items[i], session) && data.items[i].state === "claimed") return true;
    return false;
  }
  function upsertScheduled(session, message, actor, trustedSchedule) {
    message = copy(message);
    var schedule = trustedSchedule || message.schedule;
    delete message.schedule;
    if (!schedule || typeof schedule.jobId !== "string" || typeof schedule.revision !== "string" || typeof schedule.ready !== "boolean" || !Number.isFinite(Number(schedule.notBefore))) return result(false, "Invalid scheduled queue metadata", session, actor);
    var validationError = validateMessage(message);
    if (validationError) return result(false, validationError, session, actor);
    if (Object.prototype.hasOwnProperty.call(message, "images")) message.images = sanitizeImages(message.images);
    delete message._pendingConsumed;
    delete message._scheduledJobId;
    delete message._scheduledRevision;
    delete message._scheduledNotBefore;
    for (var i = 0; i < data.items.length; i++) {
      if (sameTarget(data.items[i], session) && data.items[i].schedule && data.items[i].schedule.jobId === schedule.jobId && data.items[i].state !== "pending") return result(false, "Scheduled queue item is terminal", session, actor);
      if (sameTarget(data.items[i], session) && data.items[i].schedule && data.items[i].schedule.jobId === schedule.jobId && data.items[i].state === "pending") {
        if (!authorize(session, actor) || !canMutate(session, actor, data.items[i])) return result(false, "Not authorized", session, actor);
        var before = copy(data);
        data.items[i].message = copy(message);
        data.items[i].schedule = copy(schedule);
        data.revision++;
        try { persist(); } catch (error) { restore(before); return result(false, "Queue storage failed", session, actor); }
        broadcast(session, { type: "pending_message_state", sessionId: session.localId, projectSlug: opts.slug, paused: isPaused(session), revision: data.revision, items: visible(session, actor) });
        return { ok: true, item: copy(data.items[i]), revision: data.revision };
      }
    }
    return admitInternal(session, message, actor, schedule);
  }
  function cancelScheduled(session, jobId, actor) {
    for (var i = 0; i < data.items.length; i++) {
      if (sameTarget(data.items[i], session) && data.items[i].schedule && data.items[i].schedule.jobId === jobId && (data.items[i].state === "pending" || data.items[i].state === "claimed")) return cancel(session, actor, data.items[i].id, data.revision, session.localId);
    }
    return false;
  }
  function releaseScheduled(session, jobId, revision) {
    for (var i = 0; i < data.items.length; i++) {
      var item = data.items[i];
      if (!sameTarget(item, session) || !item.schedule || item.schedule.jobId !== jobId || item.schedule.revision !== revision) continue;
      if (item.state !== "pending" || item.schedule.ready) return item.state === "pending" ? copy(item) : null;
      var before = copy(data);
      item.schedule.ready = true;
      data.revision++;
      try { persist(); } catch (error) { restore(before); return null; }
      broadcast(session, { type: "pending_message_state", sessionId: session.localId, projectSlug: opts.slug, paused: isPaused(session), revision: data.revision, items: visible(session, { id: item.actorId }) });
      return copy(item);
    }
    return null;
  }
  return { admit: admit, upsertScheduled: upsertScheduled, releaseScheduled: releaseScheduled, cancelScheduled: cancelScheduled, edit: edit, cancel: cancel, reorder: reorder, pause: pause, resume: resume, consumeOne: consumeOne, hydrate: hydrate, inspect: inspect, hasActive: hasActive, isClaimed: isClaimed, isPaused: isPaused, list: visible, getRevision: function () { return data.revision; }, getLoadError: function () { return loadError; }, filePath: filePath };
}

module.exports = { createPendingMessageQueue: createPendingMessageQueue };
