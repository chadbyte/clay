// agent-behavior.js - state, REST and save correlation for the Personal
// "Agent behavior" page. The catalog (labels, consequences, examples) always
// comes from the server; this module only decides what is acknowledged.
//
// Saving contract: a choice is shown as "Saving" until the PUT answers 200.
// A failed save reverts the displayed value to the last acknowledged server
// value and keeps the failed choice so Retry can resend it. Requests are
// serialized per setting (newest choice wins) and only the changed key of a
// reply is merged, so a late reply cannot overwrite a newer choice.
import { store } from './store.js';

var ROUTE = '/api/user/agent-behavior';
var SAVED_MS = 3500;
var inflight = {};
var loadToken = 0;
var requestCounter = 0;
var sendSeq = 0;

function emptyState() {
  return { status: 'idle', error: '', catalog: null, policy: null, effective: null, edits: {}, saved: {} };
}

export function getAgentBehavior() { return store.get('agentBehavior') || emptyState(); }
function patch(values) { store.set({ agentBehavior: Object.assign({}, getAgentBehavior(), values) }); }

export function findSetting(state, id) {
  var list = state && state.catalog ? state.catalog.settings : [];
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export function modeLabel(state, value) {
  var modes = state && state.catalog ? state.catalog.modes : [];
  for (var i = 0; i < modes.length; i++) if (modes[i].id === value) return modes[i].label;
  return String(value);
}

// The value the control shows: a pending choice while saving, otherwise the
// last acknowledged value (a failed choice is never displayed as selected).
export function displayedValue(state, id) {
  var edit = state.edits[id];
  if (edit && edit.state === 'saving') return edit.value;
  return state.policy ? state.policy[id] : undefined;
}

export function hasPendingEdits(state) {
  return Object.keys(state.edits).some(function (id) { return state.edits[id].state === 'saving'; });
}

// Status line for one setting: { kind: '' | 'saving' | 'saved' | 'error', text }.
export function statusFor(state, id) {
  var edit = state.edits[id];
  if (edit && edit.state === 'saving') return { kind: 'saving', text: 'Saving...' };
  if (edit && edit.state === 'failed') return { kind: 'error', text: edit.message };
  if (state.saved[id]) return { kind: 'saved', text: 'Saved' };
  return { kind: '', text: '' };
}

// The linked-note checkbox keeps its saved choice but is inactive unless Sticky
// Notes is Auto and Issues is not Off. Reasons use the displayed values.
export function checkboxStatus(state, setting) {
  var parent = setting.parent || 'notes';
  var notes = displayedValue(state, parent);
  var issues = displayedValue(state, 'issues');
  var reasons = [];
  if (notes !== 'auto') reasons.push('Sticky Notes is ' + modeLabel(state, notes) + ' (it must be Auto)');
  if (issues === 'off') reasons.push('Issues is Off');
  var checked = displayedValue(state, setting.id) === true;
  if (!reasons.length && checked && !hasPendingEdits(state) && state.effective && state.effective.issueLinkedNotes === false) {
    reasons.push('your account does not currently apply it');
  }
  return {
    checked: checked, inactive: reasons.length > 0,
    reason: reasons.length ? 'Not in effect: ' + reasons.join(' and ') + '. Your choice is kept.' : ''
  };
}

function validPayload(data) {
  return !!(data && data.ok === true && data.policy && typeof data.policy === 'object' && data.catalog &&
    Array.isArray(data.catalog.settings) && Array.isArray(data.catalog.modes) && Array.isArray(data.catalog.sections));
}

function errorText(response, data, fallback) {
  var message = data && typeof data.error === 'string' && data.error ? data.error : '';
  if (response && response.status === 401) return 'You are signed out. Sign in again to continue.';
  return message || fallback;
}

export function loadAgentBehavior() {
  var token = ++loadToken;
  inflight = {};
  patch({ status: 'loading', error: '', edits: {}, saved: {} });
  return fetch(ROUTE, { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (data) { return { response: response, data: data }; });
  }).then(function (result) {
    if (token !== loadToken) return;
    if (!result.response.ok || !validPayload(result.data)) {
      patch({ status: 'error', error: errorText(result.response, result.data, 'Could not load agent behavior.') });
      return;
    }
    patch({ status: 'ready', error: '', catalog: result.data.catalog, policy: result.data.policy, effective: result.data.effective || null });
  }).catch(function () {
    if (token === loadToken) patch({ status: 'error', error: 'Could not reach the server. Check your connection and try again.' });
  });
}

export function resetAgentBehavior() {
  loadToken++;
  inflight = {};
  store.set({ agentBehavior: emptyState() });
}

function setEdit(id, edit) {
  var state = getAgentBehavior();
  var edits = Object.assign({}, state.edits);
  if (edit) edits[id] = edit; else delete edits[id];
  patch({ edits: edits });
}

function markSaved(id) {
  var state = getAgentBehavior();
  var saved = Object.assign({}, state.saved); saved[id] = true;
  patch({ saved: saved });
  var token = loadToken;
  var timer = setTimeout(function () {
    if (token !== loadToken) return;
    var current = getAgentBehavior();
    if (!current.saved[id]) return;
    var next = Object.assign({}, current.saved); delete next[id];
    patch({ saved: next });
  }, SAVED_MS);
  if (timer && timer.unref) timer.unref();
}

function flush(id) {
  if (inflight[id]) return;
  var state = getAgentBehavior();
  var edit = state.edits[id];
  if (!edit || edit.state !== 'saving') return;
  if (state.policy && state.policy[id] === edit.value) { setEdit(id, null); return; }
  var token = loadToken;
  var sent = edit.value;
  var requestId = 'ab-' + (++requestCounter) + '-' + Math.random().toString(36).slice(2, 8);
  var seq = ++sendSeq;
  inflight[id] = requestId;
  var changes = {}; changes[id] = sent;
  fetch(ROUTE, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ changes: changes, requestId: requestId })
  }).then(function (response) {
    return response.json().catch(function () { return null; }).then(function (data) { return { response: response, data: data }; });
  }).then(function (result) {
    var good = result.response.ok && validPayload(result.data) && (!result.data.requestId || result.data.requestId === requestId) &&
      result.data.policy[id] === sent;
    if (!good) throw new Error(errorText(result.response, result.data, 'Could not save this setting.'));
    return result.data;
  }).then(function (data) {
    if (token !== loadToken) return;
    delete inflight[id];
    var current = getAgentBehavior();
    var policy = Object.assign({}, current.policy); policy[id] = data.policy[id];
    var values = { policy: policy };
    // The server's effective flag is trusted only from the newest request when
    // nothing else is in flight; otherwise it is unknown until the next load.
    values.effective = seq === sendSeq && !Object.keys(inflight).length && data.effective ? data.effective : null;
    patch(values);
    var latest = getAgentBehavior().edits[id];
    if (latest && latest.state === 'saving' && latest.value !== sent) { flush(id); return; }
    setEdit(id, null);
    markSaved(id);
  }).catch(function (error) {
    if (token !== loadToken) return;
    delete inflight[id];
    var latest = getAgentBehavior().edits[id];
    if (latest && latest.state === 'saving' && latest.value !== sent) { flush(id); return; }
    setEdit(id, { state: 'failed', value: sent, message: (error && error.message ? error.message : 'Could not save this setting.') });
  });
}

// Choose a value for one setting. Returns false when it was ignored.
export function chooseValue(id, value) {
  var state = getAgentBehavior();
  var setting = findSetting(state, id);
  if (state.status !== 'ready' || !setting) return false;
  if (displayedValue(state, id) === value && !(state.edits[id] && state.edits[id].state === 'failed')) return false;
  if (state.policy[id] === value && !inflight[id]) { setEdit(id, null); return false; }
  var saved = Object.assign({}, state.saved); delete saved[id];
  var edits = Object.assign({}, state.edits); edits[id] = { state: 'saving', value: value };
  patch({ edits: edits, saved: saved });
  flush(id);
  return true;
}

export function retryValue(id) {
  var edit = getAgentBehavior().edits[id];
  if (!edit || edit.state !== 'failed') return false;
  setEdit(id, { state: 'saving', value: edit.value });
  flush(id);
  return true;
}
