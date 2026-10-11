// Correlated model catalogs and an explicit provider/model draft.
import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { enhanceWorkerRuntimePicker } from './worker-runtime-picker.js';
var sequence = 0;
var timer = null;
function state() { return store.get('mateModelDraft'); }
function put(s) { store.set({mateModelDraft: s}); }
function value(entry) { return typeof entry === 'string' ? entry : entry.value || entry.id || ''; }
function label(entry) { return typeof entry === 'string' ? entry : entry.displayName || entry.label || entry.name || value(entry); }
function send(message) { var ws = getWs(); if (!ws || ws.readyState !== 1) return false; try { ws.send(JSON.stringify(message)); return true; } catch (error) { return false; } }
function id() { return 'mate-model-' + Date.now() + '-' + (++sequence); }
export function resetHomeMateModelPicker(mateId, name, mate, sessionId) {
  clearTimeout(timer);
  put({mateId: mateId, name: name, builtinClay: mate.builtinKey === 'clay', sessionId: sessionId || null, vendor: mate.vendor || '', model: mate.model || '', mateVendor: mate.vendor || '', mateModel: mate.model || '', vendors: [], models: [], status: 'idle', requestId: null, saveId: null, error: ''});
}
export function clearHomeMateModelPicker() { clearTimeout(timer); put(null); }
export function hasHomeMateModelDraft() { var s = state(); return !!s && (!!s.saveId || s.vendor !== s.mateVendor || s.model !== s.mateModel); }
function armTimeout(requestId, render) {
  clearTimeout(timer);
  timer = setTimeout(function () {
    var s = state(); if (!s || (s.requestId !== requestId && s.saveId !== requestId)) return;
    put(Object.assign({}, s, {requestId: null, saveId: null, status: s.status === 'loading' ? 'error' : s.status, error: 'No response received. Your choices are retained; try again.'})); render();
  }, 15000);
}
export function requestHomeMateModels(vendor, render) {
  var s = state(); if (!s || s.saveId) return;
  var requestId = id();
  put(Object.assign({}, s, {vendor: vendor || s.vendor, models: [], status: 'loading', requestId: requestId, error: ''}));
  render();
  if (!send({type: 'home_mate_models_get', mateId: s.mateId, vendor: vendor || s.vendor, requestId: requestId})) {
    put(Object.assign({}, state(), {status: 'error', requestId: null, error: 'Clay is offline. Reconnect and try again.'})); render(); return;
  }
  armTimeout(requestId, render);
}
function save(render) {
  var s = state(); if (!s || s.saveId || s.status !== 'ready' || !s.models.some(function (m) { return value(m) === s.model; })) return;
  var saveId = id(); put(Object.assign({}, s, {saveId: saveId, error: '', notice: ''})); render();
  var message = {type:'home_mate_model_set', mateId:s.mateId, vendor:s.vendor, model:s.model, requestId:saveId};
  if (s.sessionId) message.sessionId = s.sessionId;
  if (!send(message)) { put(Object.assign({}, state(), {saveId:null, error:'Clay is offline. Your choices are retained.'})); render(); return; }
  armTimeout(saveId, render);
}
function selector(body, title, help, entries, selected, disabled, onChange) {
  var row = document.createElement('div'); row.className = 'mate-settings-row';
  var text = document.createElement('div'); var heading = document.createElement('label'); heading.textContent = title;
  var hint = document.createElement('p'); hint.textContent = help; text.appendChild(heading); text.appendChild(hint); row.appendChild(text);
  var control = document.createElement('div'); control.className = 'mate-settings-value';
  var select = document.createElement('select'); select.className = 'worker-proposal-select'; select.setAttribute('aria-label', title); select.id = 'mate-settings-' + title.toLowerCase(); heading.htmlFor = select.id;
  if (!entries.some(function (e) { return value(e) === selected; })) { var empty = document.createElement('option'); empty.value = selected; empty.textContent = selected || 'Choose a model'; empty.disabled = true; select.appendChild(empty); }
  entries.forEach(function (entry) { var option = document.createElement('option'); option.value = value(entry); option.textContent = label(entry); select.appendChild(option); });
  select.value = selected; select.disabled = disabled; select.addEventListener('change', function () { onChange(select.value); });
  control.appendChild(select); row.appendChild(control); body.appendChild(row);
  enhanceWorkerRuntimePicker(select, title, body.closest('.home-mate-settings-dialog'));
}
export function renderHomeMateModelPicker(body, render) {
  var s = state(); if (!s) return;
  var note = document.createElement('p'); note.className = 'mate-settings-help';
  note.textContent = s.sessionId ? 'Used for this draft and future conversations. Conversations with activity keep their committed model.' : 'Used for new conversations with this Mate. Existing conversations keep their current model.';
  if (s.builtinClay) note.textContent = 'Clay uses your Default AI for new conversations. This choice can update an eligible current draft; conversations with activity keep their committed model.';
  body.appendChild(note);
  selector(body, 'Provider', 'Choose the service for this Mate.', s.vendors.map(function (v) { return {value:v.id, displayName:v.displayName || v.id}; }), s.vendor, !!s.saveId || !s.vendors.length, function (vendor) {
    put(Object.assign({}, state(), {vendor:vendor, model:vendor === s.mateVendor ? s.mateModel : '', notice:''})); requestHomeMateModels(vendor, render);
  });
  selector(body, 'Model', 'Available models come from the selected provider.', s.models, s.model, !!s.saveId || s.status !== 'ready', function (model) { put(Object.assign({}, state(), {model:model, error:'', notice:''})); render(); });
  var status = document.createElement('p'); status.className = 'mate-settings-status' + (s.error ? ' is-error' : ''); status.setAttribute('role', s.error ? 'alert' : 'status');
  status.textContent = s.saveId ? 'Saving provider and model…' : s.status === 'loading' ? 'Loading models…' : s.error || s.notice || (s.status === 'empty' ? 'No models are available from this provider.' : ''); body.appendChild(status);
  if (s.status === 'error' || s.status === 'empty') { var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'mate-settings-button home-mate-model-retry'; retry.textContent = 'Try again'; retry.addEventListener('click', function () { requestHomeMateModels(s.vendor, render); }); body.appendChild(retry); }
  if (!hasHomeMateModelDraft()) return;
  var bar = document.createElement('div'); bar.className = 'mate-settings-savebar';
  var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'mate-settings-button'; cancel.textContent = 'Cancel'; cancel.disabled = !!s.saveId;
  cancel.addEventListener('click', function () { put(Object.assign({}, state(), {vendor:s.mateVendor, model:s.mateModel, error:'', notice:''})); requestHomeMateModels(s.mateVendor, render); });
  var apply = document.createElement('button'); apply.type = 'button'; apply.className = 'mate-settings-button primary'; apply.textContent = 'Save model'; apply.disabled = !!s.saveId || s.status !== 'ready' || !s.models.some(function (m) { return value(m) === s.model; }); apply.addEventListener('click', function () { save(render); });
  bar.appendChild(cancel); bar.appendChild(apply); body.appendChild(bar);
}
export function applyHomeMateModelsState(msg) {
  var s = state(); if (!s || msg.mateId !== s.mateId || msg.requestId !== s.requestId) return false;
  clearTimeout(timer);
  put(Object.assign({}, s, {requestId:null, status:msg.status || 'empty', vendor:msg.vendor || s.vendor, model:s.model || msg.model || '', mateVendor:msg.mateVendor || s.mateVendor, mateModel:msg.mateModel || s.mateModel, vendors:msg.vendors || s.vendors, models:msg.models || [], error:msg.error || ''}));
  return true;
}
export function applyHomeMateModelResult(msg) {
  var s = state(); if (!s || msg.mateId !== s.mateId || msg.requestId !== s.saveId) return false;
  clearTimeout(timer);
  if (!msg.ok) { put(Object.assign({}, s, {saveId:null, error:msg.error || 'Could not save. Your choices are retained.'})); return true; }
  var vendor = msg.vendor || s.vendor; var model = msg.model || s.model;
  put(Object.assign({}, s, {saveId:null, vendor:vendor, model:model, mateVendor:vendor, mateModel:model, error:'', notice:msg.requestedSessionId && !msg.sessionApplied ? (msg.sessionReason || 'Default saved. This conversation keeps its committed model.') : 'Model saved.'}));
  window.dispatchEvent(new CustomEvent('clay:home-mate-model-confirmed', {detail:{mateId:msg.mateId, vendor:vendor, model:model, requestedSessionId:msg.requestedSessionId || null, sessionId:msg.sessionId || null, sessionApplied:msg.sessionApplied === true, sessionVendor:msg.sessionVendor || null, sessionModel:msg.sessionModel || null}}));
  return true;
}
