import { store } from './store.js';
import { getWs } from './ws-ref.js';

var MODES = ["off", "mini", "panel"];
var sequence = 0;

function validMode(mode) { return MODES.indexOf(mode) !== -1; }
function nextRequestId(prefix) { sequence += 1; return prefix + Date.now() + "-" + sequence; }
function accountId() { return store.get("myUserId") || "default"; }
function initialState() {
  return { mode: "off", canonicalMode: "off", preferencePresent: false, loading: false, saving: false, requestId: null, saveRequestId: null, pendingSaves: [], accountId: null, serverEpoch: null, rejectedEpoch: null, canonicalRevision: 0, error: "" };
}

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

export function getContextView() {
  var state = store.get("contextViewPreferenceState") || initialState();
  return validMode(state.mode) ? state.mode : "off";
}

export function getEffectiveContextView() {
  if (store.get("paneMode") !== true) return getContextView();
  var override = store.get("contextViewOverride");
  return override === null || override === undefined ? getContextView() : (validMode(override) ? override : getContextView());
}

export function beginContextViewConnection() {
  var state = store.get("contextViewPreferenceState") || initialState();
  store.set({ contextViewPreferenceState: Object.assign({}, state, {
    mode: validMode(state.canonicalMode) ? state.canonicalMode : "off",
    loading: false,
    saving: false,
    requestId: null,
    saveRequestId: null,
    pendingSaves: [],
    rejectedEpoch: state.serverEpoch || null,
    serverEpoch: null,
    canonicalRevision: 0,
    error: "",
  }) });
}

export function requestContextView() {
  var id = nextRequestId("context-view-");
  var state = store.get("contextViewPreferenceState") || initialState();
  store.set({ contextViewPreferenceState: Object.assign({}, state, { loading: true, requestId: id, error: "" }) });
  if (!send({ type: "context_view_get", requestId: id })) {
    store.set({ contextViewPreferenceState: Object.assign({}, store.get("contextViewPreferenceState") || initialState(), { loading: false, requestId: null, error: "Clay is offline. Reconnect and try again." }) });
    return false;
  }
  return true;
}

export function setContextView(mode) {
  if (!validMode(mode)) return false;
  var id = nextRequestId("context-view-save-");
  var state = store.get("contextViewPreferenceState") || initialState();
  var pendingSaves = (state.pendingSaves || []).concat([{ requestId: id, mode: mode }]);
  store.set({ contextViewPreferenceState: Object.assign({}, state, { mode: mode, saving: true, saveRequestId: id, pendingSaves: pendingSaves, error: "" }) });
  if (!send({ type: "context_view_set", requestId: id, mode: mode })) {
    var reverted = store.get("contextViewPreferenceState") || initialState();
    pendingSaves = (reverted.pendingSaves || []).filter(function (item) { return item.requestId !== id; });
    var pendingMode = pendingSaves.length ? pendingSaves[pendingSaves.length - 1].mode : (reverted.canonicalMode || "off");
    store.set({ contextViewPreferenceState: Object.assign({}, reverted, { mode: pendingMode, saving: pendingSaves.length > 0, saveRequestId: pendingSaves.length ? pendingSaves[pendingSaves.length - 1].requestId : null, pendingSaves: pendingSaves, error: "Clay is offline. Reconnect and try again." }) });
    return false;
  }
  return true;
}

export function handleContextViewMessage(msg) {
  if (!msg || msg.type !== "context_view_state") return false;
  var state = store.get("contextViewPreferenceState") || initialState();
  var currentAccount = accountId();
  var isGetReply = !!msg.requestId && msg.requestId === state.requestId;
  var pendingSaves = state.pendingSaves || [];
  var saveIndex = -1;
  for (var i = 0; i < pendingSaves.length; i++) if (pendingSaves[i].requestId === msg.requestId) saveIndex = i;
  var isSaveReply = !!msg.requestId && saveIndex !== -1;
  var isOlderSaveRevision = isSaveReply && typeof msg.canonicalRevision === "number" && msg.canonicalRevision < (state.canonicalRevision || 0);
  var isCorrelatedAccountFailure = (isGetReply || isSaveReply) && msg.accountId === null && msg.accountAvailable === false;
  if ((!isCorrelatedAccountFailure && msg.accountId !== currentAccount) || (msg.accountId === null && !isCorrelatedAccountFailure)) return true;
  if (msg.serverEpoch && state.serverEpoch && msg.serverEpoch !== state.serverEpoch && (!msg.requestId || (!isGetReply && !isSaveReply))) return true;
  if (msg.serverEpoch && state.rejectedEpoch && msg.serverEpoch === state.rejectedEpoch && (!isGetReply && !isSaveReply)) return true;
  if (msg.canonicalRevision !== undefined && msg.canonicalRevision < (state.canonicalRevision || 0) && msg.serverEpoch === state.serverEpoch && !isSaveReply) return true;
  if (msg.requestId && !isGetReply && !isSaveReply) return true;
  if (msg.requestId && !isSaveReply && msg.ready === false && state.saving) return true;
  var next = Object.assign({}, state, {
    accountId: msg.accountId || currentAccount,
    serverEpoch: msg.serverEpoch || state.serverEpoch || null,
    rejectedEpoch: isGetReply || isSaveReply ? null : state.rejectedEpoch || null,
    canonicalRevision: isOlderSaveRevision ? (state.canonicalRevision || 0) : (typeof msg.canonicalRevision === "number" ? msg.canonicalRevision : state.canonicalRevision || 0),
    loading: isGetReply ? false : state.loading,
    saving: state.saving,
    requestId: isGetReply ? null : state.requestId,
    saveRequestId: state.saveRequestId,
    error: msg.error || "",
  });
  if (Object.prototype.hasOwnProperty.call(msg, "mode") && validMode(msg.mode) && msg.ready !== false && !isCorrelatedAccountFailure) {
    if (isSaveReply) {
      if (!isOlderSaveRevision && msg.ready !== false) {
        pendingSaves = pendingSaves.slice(saveIndex + 1);
      } else {
        pendingSaves = pendingSaves.filter(function (item) { return item.requestId !== msg.requestId; });
      }
    }
    if (!isOlderSaveRevision) {
      next.canonicalMode = msg.mode;
      next.preferencePresent = msg.preferencePresent === true;
    }
    if (pendingSaves.length) {
      next.mode = pendingSaves[pendingSaves.length - 1].mode;
      next.saving = true;
      next.saveRequestId = pendingSaves[pendingSaves.length - 1].requestId;
    } else {
      next.mode = next.canonicalMode;
      next.saving = false;
      next.saveRequestId = null;
    }
    next.pendingSaves = pendingSaves;
  } else if (isSaveReply && (msg.ready === false || isCorrelatedAccountFailure)) {
    pendingSaves = pendingSaves.filter(function (item) { return item.requestId !== msg.requestId; });
    next.pendingSaves = pendingSaves;
    next.mode = pendingSaves.length ? pendingSaves[pendingSaves.length - 1].mode : (state.canonicalMode || "off");
    next.saving = pendingSaves.length > 0;
    next.saveRequestId = pendingSaves.length ? pendingSaves[pendingSaves.length - 1].requestId : null;
  }
  store.set({ contextViewPreferenceState: next });
  return true;
}

store.subscribe(function (state, previous) {
  if (state.myUserId !== previous.myUserId || state.currentSlug !== previous.currentSlug) {
    store.set({ contextViewPreferenceState: Object.assign({}, initialState(), { accountId: accountId() }), contextViewOverride: null });
    if (state.connected) requestContextView();
  }
});

export { validMode };
