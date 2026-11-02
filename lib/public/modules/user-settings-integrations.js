import { selectIntegrationEditor, clearIntegrationEditor, bindIntegrationEditorFocus } from './personal-integration-editor.js';
import { initGithubIntegration } from './user-settings-github.js';
import { linearIconMarkup } from './session-github.js';
import { iconHtml } from './icons.js';
import { store } from './store.js';
import { confirmSettingsAction } from './server-settings-state.js';

export function initPersonalIntegrations() {
  var root = document.querySelector('[data-section="us-integrations"].us-section');
  root.innerHTML = '<h2>Integrations</h2><p class="settings-hint">Connect accounts and services used by Clay Studio.</p><h3>Your connections</h3><div id="us-email-list"></div><div id="us-linear-connections"></div><p id="us-connections-empty" class="settings-hint">No connections yet. Choose a service below to get started.</p><p id="us-linear-collection-status" class="settings-status" role="status" aria-live="polite"></p><button id="us-linear-retry" type="button" class="settings-btn-sm" hidden>Retry Linear</button><section class="us-integration-catalog"><h3>Available integrations</h3><div class="us-integration-tiles"><button type="button" class="us-integration-tile" data-email-provider="gmail"><img src="/icons/email/gmail.svg" alt=""><span>Gmail</span></button><button type="button" class="us-integration-tile" data-email-provider="outlook"><img src="/icons/email/outlook.svg" alt=""><span>Outlook Mail</span></button><button type="button" class="us-integration-tile" data-email-provider="yahoo"><img src="/icons/email/yahoo.svg" alt=""><span>Yahoo Mail</span></button><button type="button" class="us-integration-tile" data-email-provider="custom">' + iconHtml('mail') + '<span>Custom email</span></button><button type="button" class="us-integration-tile" id="us-linear-add" aria-label="Add Linear connection">' + linearIconMarkup() + '<span>Linear</span></button></div></section><div id="us-integration-setup"></div><form id="us-linear-editor" class="settings-form" hidden><div class="settings-field"><label class="settings-label" for="us-linear-name">Connection name</label><input id="us-linear-name" class="us-text-input" maxlength="80" required placeholder="Work, personal, or client name"></div><div class="settings-field"><label class="settings-label" for="us-linear-key">Personal API key</label><input id="us-linear-key" class="us-text-input" type="password" autocomplete="off" spellcheck="false" maxlength="4096"><p id="us-linear-key-help" class="settings-hint">Existing keys stay masked.</p></div><div class="settings-form-actions"><button type="submit" class="settings-btn-sm">Save connection</button><button type="button" class="settings-btn-sm" id="us-linear-cancel">Cancel</button><button type="button" class="settings-btn-sm" id="us-linear-remove">Disconnect</button></div></form>';
  bindIntegrationEditorFocus(root);
  initGithubIntegration(root);
  var list = root.querySelector('#us-linear-connections'), form = root.querySelector('form');
  var name = root.querySelector('#us-linear-name'), key = root.querySelector('#us-linear-key');
  var add = root.querySelector('#us-linear-add'), remove = root.querySelector('#us-linear-remove');
  var status = root.querySelector('#us-linear-collection-status'), retry = root.querySelector('#us-linear-retry');
  function message(text, error) { status.textContent = text; status.dataset.state = error ? 'error' : ''; }
  function busy(value) {
    store.set({ personalLinearSaving: value });
    root.querySelectorAll('input,button').forEach(function (el) { el.disabled = value; });
  }
  function render() {
    root.insertBefore(form, status); list.replaceChildren();
    var connections = store.get('personalLinearConnections') || [];

    connections.forEach(function (connection) {
      var row = document.createElement('div'); row.className = 'us-voice-row'; row.dataset.connectionId = connection.id;
      var controls = document.createElement('div'); controls.className = 'us-voice-row-controls';
      var copy = document.createElement('div'); copy.className = 'us-voice-provider-copy';
      var title = document.createElement('strong'); title.textContent = connection.name;
      var detail = document.createElement('small'); detail.textContent = 'Linear · ' + (connection.workspace && connection.workspace.name || 'Linear') + (connection.legacy ? '' : ' · Not assigned');
      copy.append(title, detail);
      var button = document.createElement('button'); button.type = 'button'; button.className = 'settings-btn-sm'; button.textContent = 'Manage';
      button.setAttribute('aria-label', 'Manage ' + connection.name); button.setAttribute('aria-controls', 'us-linear-editor');
      button.setAttribute('aria-expanded', String(store.get('personalLinearEditing') === connection.id));
      button.onclick = function () { selectIntegrationEditor('linear:' + connection.id, '#us-linear-editor', function () { edit(connection); }); };
      var brand = document.createElement('span'); brand.className = 'us-integration-brand'; brand.innerHTML = linearIconMarkup();
      var saved = document.createElement('span'); saved.className = 'us-integration-state'; saved.textContent = 'Key saved';
      controls.append(brand, copy, saved, button); row.appendChild(controls); list.appendChild(row);
      if (store.get('personalLinearEditing') === connection.id) row.appendChild(form);
    });
    if (store.get('personalLinearEditing') === 'new') root.querySelector('#us-integration-setup').appendChild(form);
  }
  function edit(connection) {
    store.set({personalLinearGeneration:(store.get('personalLinearGeneration') || 0)+1, personalLinearEditing: connection ? connection.id : 'new', personalLinearDirty: false, personalLinearOriginalName: connection ? connection.name : '', personalLinearNewId: connection ? null : crypto.randomUUID()});
    name.value = connection ? connection.name : ''; key.value = ''; key.required = !connection;
    root.querySelector('#us-linear-key-help').textContent = connection ? 'Leave blank to keep the saved key.' : 'Enter your personal Linear API key. It stays private to your account.';
    key.placeholder = connection ? 'Enter a replacement key' : 'Enter API key'; remove.hidden = !connection;
    form.hidden = false; message(''); render(); name.focus();
  }
  function close() {
    var id = store.get('personalLinearEditing');
    closePersonalLinearEditor(); render();
    var row = Array.from(list.children).find(function (el) { return el.dataset.connectionId === id; });
    (row ? row.querySelector('button') : add).focus();
  }
  // Only an open editor holds a draft; autofill or restore into the hidden form is not an edit.
  form.oninput = function () { if (!store.get('personalLinearEditing')) return; store.set({personalLinearDirty: !!key.value || name.value !== store.get('personalLinearOriginalName')}); };
  async function save(disconnect) {
    if (store.get('personalLinearSaving')) return;
    var actor = store.get('myUserId'), generation = store.get('personalLinearGeneration');
    var id = store.get('personalLinearEditing'); if (!id) return;
    if (id === 'new') id = store.get('personalLinearNewId');
    busy(true); message(disconnect ? 'Disconnecting…' : 'Saving connection…');
    try {
      var response = await fetch('/api/linear/connections/' + id, {method:disconnect ? 'DELETE' : 'PUT', headers:{'Content-Type':'application/json'}, body:disconnect ? undefined : JSON.stringify({name:name.value,key:key.value})});
      var data = await response.json();
      if (actor !== store.get('myUserId') || generation !== store.get('personalLinearGeneration')) return;
      if (!response.ok) throw new Error(data.error || 'Could not save connection.');
      var entries = (store.get('personalLinearConnections') || []).filter(function (entry) { return entry.id !== id; });
      if (!disconnect) entries.push(Object.assign({id:id,name:name.value.trim(),legacy:id === 'default'},data));
      store.set({personalLinearConnections:entries, githubWorkRefresh:null}); busy(false); close(); message(disconnect ? 'Connection removed.' : 'Connection saved.');
    } catch (error) { if (actor === store.get('myUserId') && generation === store.get('personalLinearGeneration')) message(error.message,true); }
    finally { if (generation === store.get('personalLinearGeneration')) busy(false); }
  }
  form.onsubmit = function (event) { event.preventDefault(); save(false); };
  add.onclick = function () { selectIntegrationEditor('linear:new', '#us-linear-editor', function () { edit(null); }); };
  root.querySelector('#us-linear-cancel').onclick = function () { selectIntegrationEditor(null, null); };
  remove.onclick = function () { confirmSettingsAction('Disconnect this Linear connection? Work using this key will need to be reconnected. Existing issue links are retained.', 'Disconnect', function () { save(true); }); };
  retry.onclick = loadPersonalIntegrations;
  store.subscribe(function (state, previous) {
    if (state.myUserId !== previous.myUserId) {
      store.set({personalLinearConnections:null,personalLinearEditing:null,personalLinearDirty:false,personalLinearSaving:false,personalLinearGeneration:(state.personalLinearGeneration || 0)+1});
      root.dataset.connectionsLoaded = 'false'; form.reset(); form.hidden = true; busy(false); render(); message('');
    } else if (state.personalLinearConnections !== previous.personalLinearConnections || state.personalLinearEditing !== previous.personalLinearEditing) render();
  });
}

export async function loadPersonalIntegrations() {
  if (store.get('personalLinearSaving') || store.get('personalLinearEditing')) return;
  var actor = store.get('myUserId'), generation = (store.get('personalLinearGeneration') || 0) + 1;
  store.set({personalLinearGeneration:generation});
  var status = document.getElementById('us-linear-collection-status'), retry = document.getElementById('us-linear-retry');
  status.textContent = 'Loading connections…'; retry.hidden = true;
  try {
    var response = await fetch('/api/linear/connections');
    if (!response.ok) throw new Error('Could not load connections. Try again.');
    var data = await response.json();
    if (actor !== store.get('myUserId') || generation !== store.get('personalLinearGeneration')) return;
    store.set({personalLinearConnections:data.connections}); document.querySelector('.us-section[data-section="us-integrations"]').dataset.connectionsLoaded = 'true'; status.textContent = ''; status.dataset.state = '';
  } catch (error) {
    if (actor !== store.get('myUserId') || generation !== store.get('personalLinearGeneration')) return;
    status.textContent = error.message; status.dataset.state = 'error'; retry.hidden = false;
  }
}

export function closePersonalLinearEditor() {
  var id = store.get('personalLinearEditing');
  var form = document.getElementById('us-linear-editor');
  store.set({personalLinearEditing:null,personalLinearDirty:false,personalLinearNewId:null});
  if (form) { form.reset(); form.hidden = true; }
  clearIntegrationEditor('linear:' + id);
  var row = Array.from(document.querySelectorAll('#us-linear-connections [data-connection-id]')).find(function (el) { return el.dataset.connectionId === id; });
  var trigger = row ? row.querySelector('button') : document.getElementById('us-linear-add');
  if (trigger) trigger.focus();
}
