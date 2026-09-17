// Bounded, query-bound discovery of other visible Driver sessions.

var sessionDriverEligibility = require("./session-driver-eligibility");
var sessionRef = require("./workspace-query-service").sessionRef;

var MAX_RESULTS = 20;
var MAX_QUERY_CHARS = 200;
var MAX_EXCERPT_CHARS = 1200;
var MAX_RESPONSE_CHARS = 15000;
var MAX_QUERY_RESPONSE_CHARS = 32000;
var MAX_CALLS = 8;
var UNVERSIONED_QUERY = "__unversioned_query__";
var CROSS_PROJECT_LIMITATION = "Only sessions in this project are available.";
var EXHAUSTED_TEXT = "Retrieval budget exhausted for this query.";

function clean(value, limit) {
  if (typeof value !== "string") return "";
  var result = value.replace(/\u0000/g, "").trim();
  if (result.length <= limit) return result;
  return result.substring(0, Math.max(0, limit - 3)) + "...";
}

function resultResponse(text) {
  return { content: [{ type: "text", text: text }] };
}

function errorResponse(text) {
  return { content: [{ type: "text", text: "Error: " + text }], isError: true };
}

function responseSize(response) {
  return JSON.stringify(response).length;
}

function isExcludedDriverIdentity(session) {
  return !!(session && (
    session.hidden === true || session.delegated === true ||
    session._pairDelegation || session._delegatedBy ||
    session.scheduledTaskRun || session.projectLogReview
  ));
}

function currentGeneration(session) {
  if (!session) return null;
  if (Number.isInteger(session._sdkQueryGeneration)) return session._sdkQueryGeneration;
  if (Number.isInteger(session._queryGeneration)) return session._queryGeneration;
  return null;
}

function entryKey(projectSlug, source, index) {
  return "entry:" + sessionRef(projectSlug, source) + ":" + index;
}

function timestamp(entry, source) {
  var value = entry && entry._ts;
  if (typeof value !== "number" || !Number.isFinite(value)) value = source.lastActivity || source.createdAt || 0;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function attachSessionHandoffDiscovery(ctx) {
  var sm = ctx.sm;
  var budgets = new WeakMap();

  function isDriver(session) {
    if (!sessionDriverEligibility.isEligibleDriverSession(session)) return false;
    if (isExcludedDriverIdentity(session) || session.isMate === true) return false;
    if (typeof ctx.isDriverOperatedSession !== "function") return true;
    try {
      return ctx.isDriverOperatedSession(session) !== true;
    } catch (e) {
      return false;
    }
  }

  function stateFor(boundSession, generation) {
    var current = currentGeneration(boundSession);
    if (generation === UNVERSIONED_QUERY && current !== null) return null;
    if (generation !== UNVERSIONED_QUERY && generation !== undefined && generation !== null && current !== generation) return null;
    var key = generation !== undefined && generation !== null
      ? generation
      : (current === null ? "unversioned" : current);
    var state = budgets.get(boundSession);
    if (!state || state.key !== key) {
      state = { key: key, calls: 0, used: 0, seen: Object.create(null), exhausted: false };
      budgets.set(boundSession, state);
    }
    return state;
  }

  function authorize(boundSession, candidate) {
    if (!boundSession || !sm || !sm.sessions) return false;
    if (sm.sessions.get(boundSession.localId) !== boundSession) return false;
    if (ctx.isMate || !isDriver(boundSession) || typeof ctx.getProjectAccess !== "function") return false;
    var access;
    try {
      access = ctx.getProjectAccess();
    } catch (e) {
      return false;
    }
    if (!access || access.error) return false;
    var actorId = boundSession.ownerId || null;
    if (typeof ctx.isMultiUser === "function" && ctx.isMultiUser()) {
      if (!actorId || typeof ctx.findUserById !== "function" || typeof ctx.canAccessSession !== "function") return false;
      var actor = ctx.findUserById(actorId);
      if (!actor || actor.active === false || actor.disabled === true) return false;
      try {
        if (ctx.canAccessSession(actorId, boundSession, access) !== true) return false;
        if (candidate === boundSession) return true;
        return !!candidate && isDriver(candidate) && ctx.canAccessSession(actorId, candidate, access) === true;
      } catch (e2) {
        return false;
      }
    }
    if (!candidate || !isDriver(candidate)) return false;
    if (candidate === boundSession) return true;
    return !candidate.ownerId || candidate.ownerId === actorId;
  }

  function candidates(boundSession) {
    if (!authorize(boundSession, boundSession)) return [];
    var result = [];
    sm.sessions.forEach(function (candidate) {
      if (candidate !== boundSession && authorize(boundSession, candidate)) result.push(candidate);
    });
    result.sort(function (a, b) {
      var activity = (b.lastActivity || b.createdAt || 0) - (a.lastActivity || a.createdAt || 0);
      if (activity) return activity;
      return sessionRef(ctx.projectSlug, a) < sessionRef(ctx.projectSlug, b) ? -1 : 1;
    });
    return result;
  }

  function metadata(boundSession, candidate) {
    if (!authorize(boundSession, candidate)) return null;
    return {
      sessionRef: sessionRef(ctx.projectSlug, candidate),
      title: clean(candidate.title || "New Session", 160),
      vendor: clean(candidate.vendor || "", 40) || null,
      createdAt: candidate.createdAt || 0,
      lastActivity: candidate.lastActivity || candidate.createdAt || 0,
    };
  }

  function refusal(message) {
    return errorResponse(message || EXHAUSTED_TEXT);
  }

  function beginCall(boundSession, generation) {
    var state = stateFor(boundSession, generation);
    if (!state) return { refusal: refusal("This retrieval tool belongs to an older query.") };
    if (state.exhausted || state.calls >= MAX_CALLS) {
      state.exhausted = true;
      return { state: state, refusal: refusal(EXHAUSTED_TEXT) };
    }
    state.calls++;
    if (state.used >= MAX_QUERY_RESPONSE_CHARS) {
      state.exhausted = true;
      return { state: state, refusal: refusal(EXHAUSTED_TEXT) };
    }
    return { state: state };
  }

  function budgetMetadata(state) {
    return {
      maxResponseChars: MAX_RESPONSE_CHARS,
      maxQueryChars: MAX_QUERY_RESPONSE_CHARS,
      usedChars: state.used,
      maxCalls: MAX_CALLS,
      calls: state.calls,
      query: state.key,
    };
  }

  function encodePayload(state, payload) {
    var response;
    var size = 0;
    for (var i = 0; i < 8; i++) {
      response = resultResponse(JSON.stringify(payload));
      size = responseSize(response);
      if (!payload.budget || payload.budget.usedChars === state.used + size) break;
      payload.budget.usedChars = state.used + size;
    }
    return { response: response, size: size };
  }

  function finishPayload(call, payload, arrayName, keys) {
    var state = call.state;
    var available = Math.min(MAX_RESPONSE_CHARS, MAX_QUERY_RESPONSE_CHARS - state.used);
    var encoded = encodePayload(state, payload);
    while (encoded.size > available && arrayName && payload[arrayName].length > 0) {
      payload[arrayName].pop();
      keys.pop();
      payload.truncated = true;
      encoded = encodePayload(state, payload);
    }
    if (encoded.size > available) {
      state.exhausted = true;
      return refusal(EXHAUSTED_TEXT);
    }
    state.used += encoded.size;
    for (var i = 0; i < keys.length; i++) state.seen[keys[i]] = true;
    if (state.used >= MAX_QUERY_RESPONSE_CHARS || state.calls >= MAX_CALLS) state.exhausted = true;
    return encoded.response;
  }

  function finishError(call, message) {
    if (call.refusal) return call.refusal;
    var state = call.state;
    var response = errorResponse(clean(message || "Retrieval failed.", 500));
    var size = responseSize(response);
    if (size > MAX_QUERY_RESPONSE_CHARS - state.used) {
      state.exhausted = true;
      return refusal(EXHAUSTED_TEXT);
    }
    state.used += size;
    if (state.used >= MAX_QUERY_RESPONSE_CHARS || state.calls >= MAX_CALLS) state.exhausted = true;
    return response;
  }

  function basePayload(state) {
    return {
      projectSlug: ctx.projectSlug,
      crossProject: false,
      limitation: CROSS_PROJECT_LIMITATION,
      budget: budgetMetadata(state),
    };
  }

  function list(boundSession, args, generation) {
    var call = beginCall(boundSession, generation);
    if (call.refusal) return call.refusal;
    if (!authorize(boundSession, boundSession)) return finishError(call, "Driver session access denied.");
    var all = candidates(boundSession);
    var payload = basePayload(call.state);
    payload.sessions = [];
    payload.scannedSessions = all.length;
    payload.truncated = false;
    payload.budget.maxResults = MAX_RESULTS;
    var keys = [];
    for (var i = 0; i < all.length && payload.sessions.length < MAX_RESULTS; i++) {
      var item = metadata(boundSession, all[i]);
      var key = item ? "source:" + item.sessionRef : null;
      if (!item || call.state.seen[key]) continue;
      payload.sessions.push(item);
      keys.push(key);
    }
    payload.truncated = all.length > payload.sessions.length;
    return finishPayload(call, payload, "sessions", keys);
  }

  function search(boundSession, args, generation) {
    var call = beginCall(boundSession, generation);
    if (call.refusal) return call.refusal;
    if (!authorize(boundSession, boundSession)) return finishError(call, "Driver session access denied.");
    var query = clean(args && args.query || "", MAX_QUERY_CHARS).toLowerCase();
    if (!query) return finishError(call, "A keyword query is required.");
    var all = candidates(boundSession);
    var payload = basePayload(call.state);
    payload.query = query;
    payload.results = [];
    payload.scannedSessions = all.length;
    payload.truncated = false;
    payload.budget.maxResults = MAX_RESULTS;
    payload.budget.maxExcerptChars = MAX_EXCERPT_CHARS;
    var keys = [];
    for (var i = 0; i < all.length && payload.results.length < MAX_RESULTS; i++) {
      var candidate = all[i];
      var item = metadata(boundSession, candidate);
      if (!item) continue;
      var history = Array.isArray(candidate.history) ? candidate.history : [];
      for (var h = 0; h < history.length && payload.results.length < MAX_RESULTS; h++) {
        var entry = history[h];
        if (!entry || (entry.type !== "user_message" && entry.type !== "delta")) continue;
        if (typeof entry.text !== "string") continue;
        var match = entry.text.toLowerCase().indexOf(query);
        if (match === -1) continue;
        var key = entryKey(ctx.projectSlug, candidate, h);
        if (call.state.seen[key]) continue;
        var start = Math.max(0, match - 180);
        var excerpt = clean(entry.text.substring(start, start + MAX_EXCERPT_CHARS), MAX_EXCERPT_CHARS);
        if (start > 0) excerpt = "..." + excerpt;
        var date = timestamp(entry, candidate);
        payload.results.push({
          sessionRef: item.sessionRef,
          title: item.title,
          vendor: item.vendor,
          role: entry.type === "user_message" ? "user" : "assistant",
          entryIndex: h,
          date: date,
          excerpt: excerpt,
          citation: item.sessionRef + " entry " + h + " (" + new Date(date).toISOString() + ")",
        });
        keys.push(key);
      }
    }
    payload.truncated = payload.results.length >= MAX_RESULTS;
    return finishPayload(call, payload, "results", keys);
  }

  function read(boundSession, args, generation) {
    var call = beginCall(boundSession, generation);
    if (call.refusal) return call.refusal;
    if (!authorize(boundSession, boundSession)) return finishError(call, "Driver session access denied.");
    var ref = args && args.sessionRef;
    var all = candidates(boundSession);
    var candidate = null;
    for (var i = 0; i < all.length; i++) {
      if (sessionRef(ctx.projectSlug, all[i]) === ref) candidate = all[i];
    }
    if (!candidate || !authorize(boundSession, candidate)) {
      return finishError(call, "Session not found or not shared with this Driver.");
    }
    var item = metadata(boundSession, candidate);
    var history = Array.isArray(candidate.history) ? candidate.history : [];
    var limit = Number.isFinite(args && args.limit) ? Math.max(1, Math.min(20, Math.floor(args.limit))) : 5;
    var start;
    if (Number.isInteger(args && args.entryIndex)) start = Math.max(0, args.entryIndex - 2);
    else if (Number.isInteger(args && args.offset)) start = Math.max(0, args.offset);
    else start = 0;
    start = Math.min(history.length, start);
    var end = Math.min(history.length, start + limit);
    var payload = basePayload(call.state);
    payload.session = item;
    payload.excerpts = [];
    payload.requestedStart = start;
    payload.requestedEnd = end;
    payload.truncated = end < history.length;
    payload.budget.maxExcerptChars = MAX_EXCERPT_CHARS;
    var keys = [];
    for (var h = start; h < end; h++) {
      var entry = history[h];
      if (!entry || (entry.type !== "user_message" && entry.type !== "delta")) continue;
      if (typeof entry.text !== "string") continue;
      var key = entryKey(ctx.projectSlug, candidate, h);
      if (call.state.seen[key]) continue;
      var date = timestamp(entry, candidate);
      payload.excerpts.push({
        entryIndex: h,
        role: entry.type === "user_message" ? "user" : "assistant",
        date: date,
        excerpt: clean(entry.text, MAX_EXCERPT_CHARS),
        citation: item.sessionRef + " entry " + h,
      });
      keys.push(key);
    }
    return finishPayload(call, payload, "excerpts", keys);
  }

  function legacyLine(entry) {
    if (!entry) return null;
    var label;
    var text = "";
    if (entry.type === "user_message") {
      label = "USER";
      text = entry.text || "";
    } else if (entry.type === "delta") {
      label = "ASSISTANT";
      text = entry.text || "";
    } else if (entry.type === "tool_executing" || entry.type === "tool_result") {
      label = "TOOL";
      var input = "";
      try {
        input = entry.input ? JSON.stringify(entry.input) || "" : "";
      } catch (e) {
        input = "[unserializable input]";
      }
      text = (entry.name || "") + (input ? " " + input.substring(0, 120) : "");
    } else {
      return null;
    }
    return "[" + label + "] " + clean(text, 800);
  }

  function legacy(boundSession, source, args, generation) {
    var call = beginCall(boundSession, generation);
    if (call.refusal) return call.refusal;
    if (!authorize(boundSession, boundSession) || !authorize(boundSession, source)) {
      return finishError(call, "Source session access denied.");
    }
    var history = Array.isArray(source.history) ? source.history : [];
    var limit = Number.isFinite(args && args.limit) ? Math.max(1, Math.min(100, Math.floor(args.limit))) : 30;
    var offset = Number.isFinite(args && args.offset)
      ? Math.max(0, Math.min(history.length, Math.floor(args.offset)))
      : Math.max(0, history.length - limit);
    var end = Math.min(history.length, offset + limit);
    var header = "# " + clean(source.title || "Untitled session", 160) + " — " +
      clean(source.vendor || "unknown", 40) + "/" + source.localId + "\n" +
      "Showing entries " + (history.length ? offset + 1 : 0) + "-" + end + " of " + history.length + "\n";
    var lines = [];
    var keys = [];
    for (var i = offset; i < end; i++) {
      var line = legacyLine(history[i]);
      var key = entryKey(ctx.projectSlug, source, i);
      if (!line || call.state.seen[key]) continue;
      lines.push(line);
      keys.push(key);
    }
    var available = Math.min(MAX_RESPONSE_CHARS, MAX_QUERY_RESPONSE_CHARS - call.state.used);
    var response = resultResponse(header + "\n" + lines.join("\n"));
    while (responseSize(response) > available && lines.length > 0) {
      lines.pop();
      keys.pop();
      response = resultResponse(header + "\n" + lines.join("\n") + "\n[truncated]");
    }
    var size = responseSize(response);
    if (size > available) {
      call.state.exhausted = true;
      return refusal(EXHAUSTED_TEXT);
    }
    call.state.used += size;
    for (var k = 0; k < keys.length; k++) call.state.seen[keys[k]] = true;
    if (call.state.used >= MAX_QUERY_RESPONSE_CHARS || call.state.calls >= MAX_CALLS) call.state.exhausted = true;
    return response;
  }

  function fail(boundSession, generation, message) {
    var call = beginCall(boundSession, generation);
    return finishError(call, message);
  }

  return {
    authorize: authorize,
    captureGeneration: function (session) {
      var generation = currentGeneration(session);
      return generation === null ? UNVERSIONED_QUERY : generation;
    },
    currentGeneration: currentGeneration,
    fail: fail,
    legacy: legacy,
    list: list,
    read: read,
    search: search,
  };
}

module.exports = {
  attachSessionHandoffDiscovery: attachSessionHandoffDiscovery,
  MAX_CALLS: MAX_CALLS,
  MAX_QUERY_RESPONSE_CHARS: MAX_QUERY_RESPONSE_CHARS,
  MAX_RESPONSE_CHARS: MAX_RESPONSE_CHARS,
  MAX_RESULTS: MAX_RESULTS,
  UNVERSIONED_QUERY: UNVERSIONED_QUERY,
};
