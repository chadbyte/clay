import { store } from './store.js';

export function clearLinearKeyInput() {
  var input = document.getElementById('us-linear-key');
  if (input) input.value = '';
}
function setLinearStatus(text, state) {
  var status = document.getElementById('us-linear-status');
  if (!status) return;
  status.textContent = text;
  if (state) status.dataset.state = state; else delete status.dataset.state;
}
export async function loadLinearConnection() {
  var actor = store.get('myUserId');
  var generation = (store.get('linearConnectionGeneration') || 0) + 1;
  store.set({ linearConnectionGeneration: generation });
  try {
    var response = await fetch('/api/linear/connection');
    if (!response.ok) throw new Error('Could not load Linear connection.');
    var data = await response.json();
    if (store.get('linearConnectionGeneration') !== generation || store.get('myUserId') !== actor) return;
    store.set({ linearConnection: data });
    setLinearStatus(data.connected ? 'Connected to ' + data.workspace.name : 'Not connected', data.connected ? 'connected' : '');
    var disconnect = document.getElementById('us-linear-disconnect');
    if (disconnect) disconnect.disabled = !data.connected;
  } catch (error) { if (store.get('linearConnectionGeneration') === generation) setLinearStatus(error.message, 'error'); }
}
export function initLinearSettings() {
  var form = document.getElementById('us-linear-form');
  if (!form || store.get('linearSettingsBound')) return;
  store.set({ linearSettingsBound: true });
  async function save(disconnect) {
    if (store.get('linearConnectionSaving')) return;
    var actor = store.get('myUserId');
    store.set({ linearConnectionSaving: true, linearConnectionGeneration: (store.get('linearConnectionGeneration') || 0) + 1 });
    var input = document.getElementById('us-linear-key');
    var buttons = form.querySelectorAll('button');
    buttons.forEach(function (button) { button.disabled = true; });
    setLinearStatus(disconnect ? 'Disconnecting…' : 'Connecting…', '');
    try {
      var response = await fetch('/api/linear/connection', { method: disconnect ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: disconnect ? undefined : JSON.stringify({ key: input.value }) });
      clearLinearKeyInput();
      if (store.get('myUserId') !== actor) return;
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update Linear connection.');
      store.set({ linearConnection: data, githubWorkRefresh: null });
      setLinearStatus(data.connected ? 'Connected to ' + data.workspace.name : 'Disconnected', data.connected ? 'connected' : '');
    } catch (error) { clearLinearKeyInput(); setLinearStatus(error.message, 'error'); }
    finally {
      store.set({ linearConnectionSaving: false });
      buttons.forEach(function (button) { button.disabled = false; });
      document.getElementById('us-linear-disconnect').disabled = !(store.get('linearConnection') || {}).connected;
    }
  }
  store.subscribe(function (state, previous) {
    if (state.myUserId !== previous.myUserId) { clearLinearKeyInput(); store.set({ linearConnection: null, linearConnectionGeneration: (state.linearConnectionGeneration || 0) + 1 }); }
  });
  form.addEventListener('submit', function (event) { event.preventDefault(); save(false); });
  document.getElementById('us-linear-disconnect').addEventListener('click', function () { save(true); });
}
