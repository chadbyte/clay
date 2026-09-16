import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { firstInstalledVendor } from './vendor-priority.js';

function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}

var sequence = 0;

function nextRequestId(prefix) {
  sequence += 1;
  return prefix + Date.now() + "-" + sequence;
}

function emptyState(accountId, projectSlug) {
  return { loading: false, saving: false, getRequestId: null, saveRequestId: null, preference: null, preferencePresent: false, installedVendors: [], accountId: accountId || null, projectSlug: projectSlug || null, serverEpoch: null, canonicalRevision: 0, error: "" };
}

export function requestDefaultVendor() {
  var id = nextRequestId("default-vendor-");
  var state = store.get("defaultVendorState") || {};
  store.set({ defaultVendorState: Object.assign({}, state, { loading: true, getRequestId: id, error: "" }) });
  if (!send({ type: "default_vendor_get", requestId: id })) {
    store.set({ defaultVendorState: Object.assign({}, store.get("defaultVendorState") || {}, { loading: false, getRequestId: null, error: "Clay is offline. Reconnect and try again." }) });
    return false;
  }
  return true;
}

export function beginDefaultVendorConnection() {
  var state = store.get("defaultVendorState") || {};
  store.set({ defaultVendorState: Object.assign({}, state, {
    loading: false,
    saving: false,
    getRequestId: null,
    saveRequestId: null,
    preference: null,
    preferencePresent: false,
    installedVendors: [],
    accountId: store.get("myUserId") || "default",
    projectSlug: store.get("currentSlug") || null,
    serverEpoch: null,
    canonicalRevision: 0,
    error: "",
  }) });
}

export function saveDefaultVendor(vendor) {
  var state = store.get("defaultVendorState") || {};
  if (vendor !== "" && (state.installedVendors || []).indexOf(vendor) === -1) return false;
  var id = nextRequestId("default-vendor-save-");
  store.set({ defaultVendorState: Object.assign({}, state, { saving: true, saveRequestId: id, error: "" }) });
  if (!send({ type: "default_vendor_set", requestId: id, vendor: vendor })) {
    store.set({ defaultVendorState: Object.assign({}, store.get("defaultVendorState") || {}, { saving: false, saveRequestId: null, error: "Clay is offline. Reconnect and try again." }) });
    return false;
  }
  return true;
}

export function handleDefaultVendorMessage(msg) {
  if (!msg || msg.type !== "default_vendor_state") return false;
  var state = store.get("defaultVendorState") || {};
  var accountId = store.get("myUserId") || "default";
  var projectSlug = store.get("currentSlug") || null;
  var isGetReply = !!msg.requestId && msg.requestId === state.getRequestId;
  var isSaveReply = !!msg.requestId && msg.requestId === state.saveRequestId;
  var isCorrelatedAccountFailure = (isGetReply || isSaveReply) && msg.accountId === null && msg.accountAvailable === false;
  if ((!isCorrelatedAccountFailure && msg.accountId !== accountId) || (msg.accountId === null && !isCorrelatedAccountFailure)) return true;
  if (Object.prototype.hasOwnProperty.call(msg, "projectSlug") && msg.projectSlug !== projectSlug) return true;
  if (msg.serverEpoch && state.serverEpoch && msg.serverEpoch !== state.serverEpoch && (!msg.requestId || (msg.requestId !== state.getRequestId && msg.requestId !== state.saveRequestId))) return true;
  if (msg.canonicalRevision !== undefined && msg.canonicalRevision < (state.canonicalRevision || 0) && msg.serverEpoch === state.serverEpoch) return true;
  if (msg.requestId && !isGetReply && !isSaveReply) return true;
  if (msg.requestId && !isSaveReply && msg.ready === false && state.saving) return true;
  var next = Object.assign({}, state, {
    accountId: msg.accountId || accountId,
    projectSlug: projectSlug,
    serverEpoch: msg.serverEpoch || state.serverEpoch || null,
    canonicalRevision: typeof msg.canonicalRevision === "number" ? msg.canonicalRevision : state.canonicalRevision || 0,
    installedVendors: Array.isArray(msg.installedVendors) ? msg.installedVendors : state.installedVendors || [],
    loading: isGetReply ? false : state.loading,
    saving: isSaveReply ? false : state.saving,
    getRequestId: isGetReply ? null : state.getRequestId,
    saveRequestId: isSaveReply ? null : state.saveRequestId,
    error: msg.error || ""
  });
  if (Object.prototype.hasOwnProperty.call(msg, "preference")) {
    next.preference = msg.preference || null;
    next.preferencePresent = msg.preferencePresent === true;
  }
  store.set({ defaultVendorState: next });
  return true;
}

store.subscribe(function (state, previous) {
  if (state.myUserId !== previous.myUserId || state.currentSlug !== previous.currentSlug) {
    var accountId = state.myUserId || "default";
    store.set({ defaultVendorState: emptyState(accountId, state.currentSlug || null) });
    if (state.connected) requestDefaultVendor();
  }
});

export function resolvePreferredVendor(installedVendors) {
  var installed = Array.isArray(installedVendors) ? installedVendors : [];
  var state = store.get("defaultVendorState") || {};
  if (state.preference && installed.indexOf(state.preference) !== -1) return state.preference;
  return firstInstalledVendor(installed);
}

export function defaultVendorUnavailable(installedVendors) {
  var state = store.get("defaultVendorState") || {};
  return !!state.preference && (installedVendors || []).indexOf(state.preference) === -1;
}
