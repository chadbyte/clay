import { refreshIcons } from './icons.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { parseEnvString, serializeEnvValue, looksLikeEnv } from './settings-env-values.js';

function state() { return store.get('projectEnvironmentEditor') || {}; }
function update(values) { store.set({ projectEnvironmentEditor: Object.assign({}, state(), values) }); }
function status(text) { document.getElementById('ps-env-save-status').textContent = text; }
function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { status('Disconnected. Your draft is kept. Reconnect and try again.'); return false; }
  ws.send(JSON.stringify(message)); return true;
}
export function projectEnvironmentDirty() { return state().slug === store.get("projectSettingsSlug") && !!(state().dirty || state().saving); }
export function openProjectEnvironment(slug) {
  if (state().slug === slug && (state().loaded || state().loading || state().dirty)) return;
  var cached = Object.assign({}, store.get('projectEnvironmentDrafts') || {});
  if (state().slug && state().dirty) cached[state().slug] = state();
  store.set({ projectEnvironmentDrafts: cached });
  if (cached[slug]) { store.set({ projectEnvironmentEditor: cached[slug] }); render(); status('Unsaved changes'); return; }
  update({ slug: slug, saved: '', rows: [], dirty: false, loaded: false, loading: false, editing: false, saving: false });
  render(); status('Loading…');
  var requestId = crypto.randomUUID();
  update({ requestId: requestId });
  if (send({ type: 'get_project_env', slug: slug, requestId: requestId })) update({ loading: true });
}
export function handleProjectEnv(msg) {
  if (!state().loading || (msg.slug !== state().slug || msg.requestId !== state().requestId)) return;
  update({ loading: false });
  if (msg.error) { status(msg.error); return; }
  update({ loaded: true, saved: msg.envrc || '', rows: parseEnvString(msg.envrc || '') });
  render(); status('');
}
// A draft exists only while the rows differ from the saved variables; blank rows and edits that are
// reverted by hand leave nothing to save.
function rowsSignature(rows) {
  return (rows || []).filter(function (row) { return row.key.trim() || row.value; }).map(function (row) { return row.key.trim() + '\u0000' + row.value; }).join('\n');
}
function changeRows(rows) {
  var dirty = rowsSignature(rows) !== rowsSignature(parseEnvString(state().saved || ''));
  update({ rows: rows, dirty: dirty });
  document.getElementById('ps-env-save').disabled = !dirty || !!state().saving;
  if (!dirty) clearCachedDraft();
  status(dirty ? 'Unsaved changes' : '');
}
function render() {
  var editor = state();
  var list = document.getElementById('ps-env-list'); list.replaceChildren();
  (editor.rows || []).forEach(function (entry, index) {
    var row = document.createElement('div'); row.className = 'ps-env-row';
    var key = document.createElement('input'); key.className = 'ps-env-key'; key.value = entry.key; key.placeholder = 'KEY'; key.setAttribute('aria-label', 'Variable name');
    var value = document.createElement('input'); value.className = 'ps-env-val'; value.type = 'password'; value.value = entry.value; value.placeholder = 'Value'; value.setAttribute('aria-label', 'Variable value');
    [key, value].forEach(function (input) { input.autocomplete = 'off'; input.spellcheck = false; input.disabled = !!editor.saving; });
    function changed() {
      var rows = state().rows.slice(); rows[index] = { key: key.value, value: value.value }; changeRows(rows);
    }
    key.addEventListener('input', changed); value.addEventListener('input', changed);
    key.addEventListener('paste', function (event) {
      var text = event.clipboardData.getData('text');
      if (!looksLikeEnv(text)) return;
      event.preventDefault(); var rows = state().rows.slice();
      rows.splice.apply(rows, [index, 1].concat(parseEnvString(text))); changeRows(rows); render();
    });
    var remove = document.createElement('button'); remove.className = 'ps-env-del'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove variable'); remove.disabled = !!editor.saving;
    remove.onclick = function () { var rows = state().rows.slice(); rows.splice(index, 1); changeRows(rows); render(); };
    remove.innerHTML = '<i data-lucide="x"></i>';
    var reveal = document.createElement('button'); reveal.type = 'button'; reveal.className = 'settings-btn-sm'; reveal.textContent = 'Show';
    reveal.setAttribute('aria-label', 'Show variable value'); reveal.setAttribute('aria-pressed', 'false');
    reveal.onclick = function () { var visible = value.type === 'password'; value.type = visible ? 'text' : 'password'; reveal.textContent = visible ? 'Hide' : 'Show'; reveal.setAttribute('aria-pressed', String(visible)); };
    row.append(key, value, reveal, remove); list.appendChild(row);
  });
  document.getElementById('ps-env-add-btn').disabled = !editor.loaded || !!editor.saving;
  document.getElementById('ps-env-save').disabled = !editor.loaded || !editor.dirty || !!editor.saving;
  refreshIcons();
}
function clearCachedDraft() {
  var cached = Object.assign({}, store.get('projectEnvironmentDrafts') || {}); delete cached[state().slug]; store.set({ projectEnvironmentDrafts: cached });
}
export function discardProjectEnvironment() {
  clearCachedDraft();
  update({ rows: parseEnvString(state().saved || ''), editing: false, dirty: false }); render(); status(''); document.getElementById('ps-env-add-btn').focus();
}
export function handleProjectEnvSaved(msg) {
  if (!state().saving || (msg.slug !== state().slug || msg.requestId !== state().requestId)) return;
  update({ saving: false });
  if (!msg.ok) { render(); status(msg.error || 'Save failed. Your draft is kept.'); return; }
  clearCachedDraft();
  update({ saved: state().submitted, dirty: false, editing: false });
  render(); document.getElementById('ps-env-add-btn').focus(); status('Saved. ' + (msg.timing || 'Applies to newly created coding-agent processes.'));
}
function save() {
  var names = {};
  var rows = state().rows || [];
  for (var i = 0; i < rows.length; i++) {
    var key = rows[i].key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { status('Enter a valid name for every variable.'); return; }
    if (Object.prototype.hasOwnProperty.call(names, key)) { status('Each variable needs a unique name.'); return; }
    names[key] = true;
  }
  var envrc = rows.map(function (row) { return 'export ' + row.key.trim() + '=' + serializeEnvValue(row.value); }).join('\n');
  var requestId = crypto.randomUUID();
  update({ requestId: requestId });
  if (!send({ type: 'set_project_env', slug: state().slug, envrc: envrc, requestId: requestId })) return;
  update({ submitted: envrc, saving: true }); render(); status('Saving…');
}
export function initProjectEnvironment() {
  document.getElementById('ps-env-add-btn').onclick = function () { changeRows((state().rows || []).concat([{ key: '', value: '' }])); render(); document.querySelector('#ps-env-list .ps-env-row:last-child input').focus(); };
  document.getElementById('ps-env-save').onclick = save;
  store.subscribe(function (next, previous) {
    if (next.myUserId !== previous.myUserId) {
      store.set({ projectEnvironmentEditor: {}, projectEnvironmentDrafts: {} }); render(); status(''); return;
    }
    if (previous.connected && !next.connected && (state().saving || state().loading)) {
      update({ saving: false, loading: false }); render(); status('Disconnected. Your draft is kept. Reconnect and try again.');
    }
  });
}
