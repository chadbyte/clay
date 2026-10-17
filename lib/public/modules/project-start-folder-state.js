// project-start-folder-state.js - Pure state transitions for the open-folder browser.
// A reply is applied only when its requestId matches the single in-flight request.

export function emptyFolderState() {
  return {
    status: "idle", dir: null, parent: null, entries: [], error: null, errorKind: null,
    requestId: null, requestedPath: null, candidates: [], candidateIdx: 0, initial: false, pathOpen: false,
  };
}

export function beginInitial(candidates, requestId) {
  var next = emptyFolderState();
  next.status = "loading";
  next.candidates = candidates.slice();
  next.initial = true;
  next.requestId = requestId;
  next.requestedPath = candidates[0] || "~";
  return next;
}

export function beginNavigate(prev, path, requestId) {
  return Object.assign({}, prev, {
    status: "loading", requestId: requestId, requestedPath: path, error: null, errorKind: null, initial: false,
  });
}

function errorKindOf(message) {
  return /not permitted|permission|EACCES|EPERM/i.test(message || "") ? "denied" : "failed";
}

function cleanEntries(entries) {
  var out = [];
  for (var i = 0; i < (entries || []).length; i++) {
    var e = entries[i];
    if (e && typeof e.name === "string" && typeof e.path === "string") out.push({ name: e.name, path: e.path });
  }
  return out;
}

// Returns { state, retryPath }. retryPath is set when the initial candidate failed and another remains.
export function applyBrowseResult(prev, msg, nextRequestId) {
  if (!msg || prev.status !== "loading" || !prev.requestId || msg.requestId !== prev.requestId) {
    return { state: prev, retryPath: null };
  }
  var failed = !!msg.error;
  var wrongTarget = !failed && (typeof msg.dir !== "string" || (msg.prefix || "") !== "");
  if (failed || wrongTarget) {
    var idx = prev.candidateIdx + 1;
    if (prev.initial && idx < prev.candidates.length) {
      var retry = Object.assign({}, prev, { candidateIdx: idx, requestId: nextRequestId, requestedPath: prev.candidates[idx] });
      return { state: retry, retryPath: prev.candidates[idx] };
    }
    return {
      state: Object.assign({}, prev, {
        status: "error",
        error: failed ? msg.error : "That folder was not found.",
        errorKind: failed ? errorKindOf(msg.error) : "missing",
      }),
      retryPath: null,
    };
  }
  return {
    state: Object.assign({}, prev, {
      status: "ready", dir: msg.dir, parent: typeof msg.parent === "string" ? msg.parent : null,
      entries: cleanEntries(msg.entries), error: null, errorKind: null, initial: false,
    }),
    retryPath: null,
  };
}

export function failLocally(prev, message) {
  if (prev.status !== "loading") return prev;
  return Object.assign({}, prev, { status: "error", error: message, errorKind: "failed" });
}

export function canOpenFolder(state) {
  return state.status === "ready" && typeof state.dir === "string" && state.dir.length > 0;
}
