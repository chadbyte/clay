function clean(value) {
  return value === undefined || value === null ? "" : String(value);
}

export function continuationKey(message) {
  if (!message) return "";
  var projectSlug = clean(message.projectSlug);
  var sourceOriginId = clean(message.sourceOriginId);
  var proposalId = clean(message.proposalId);
  if (!projectSlug || !sourceOriginId || !proposalId) return "";
  return projectSlug + "\n" + sourceOriginId + "\n" + proposalId;
}

export function authoritativeState(message) {
  return {
    key: continuationKey(message),
    projectSlug: clean(message.projectSlug),
    sourceOriginId: clean(message.sourceOriginId),
    proposalId: clean(message.proposalId),
    sourceSessionId: Number(message.sourceSessionId),
    status: message.status || "pending",
    requestId: "",
    requestKind: "",
    inflight: false,
    error: message.error || "",
  };
}

export function beginRequest(state, kind, requestId, connected) {
  if (!state || !state.key || state.inflight || connected !== true) return null;
  if (kind === "decision" && state.status !== "pending") return null;
  var next = Object.assign({}, state, {
    inflight: true,
    requestId: clean(requestId),
    requestKind: kind,
    error: "",
  });
  return next.requestId ? next : null;
}

export function applyResponse(state, message) {
  if (!state || !message || continuationKey(message) !== state.key) return null;
  if (message.requestId && clean(message.requestId) !== state.requestId) return null;
  var next = Object.assign({}, state, { inflight: false, requestId: "", requestKind: "" });
  var sourceSessionId = Number(message.sourceSessionId);
  if (Number.isInteger(sourceSessionId) && sourceSessionId > 0) next.sourceSessionId = sourceSessionId;
  if (message.status) next.status = message.status;
  next.error = message.error || "";
  return next;
}

export function failRequest(state, requestId, error) {
  if (!state || !state.inflight || clean(requestId) !== state.requestId) return null;
  return Object.assign({}, state, {
    inflight: false,
    requestId: "",
    requestKind: "",
    error: clean(error) || "The request could not be sent. Try again.",
  });
}

export function sendContinuationPayload(ws, payload) {
  if (!ws || ws.readyState !== 1) return { ok: false, error: "The connection is unavailable. Try again." };
  try {
    if (ws.send(JSON.stringify(payload)) === false) {
      return { ok: false, error: "The request was not accepted by the connection. Try again." };
    }
  } catch (error) {
    return { ok: false, error: "The request could not be sent. Try again." };
  }
  return { ok: true };
}

export function continuationCanAct(state, connected) {
  return !!state && state.status === "pending" && !state.inflight && connected === true;
}
