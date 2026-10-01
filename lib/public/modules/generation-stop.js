import { store } from './store.js';
import { getWs } from './ws-ref.js';

// This control lives outside the composer so drafts and Worker locks cannot
// take away the human's ability to stop the displayed session.
export function initGenerationStop() {
  var row = document.getElementById('generation-stop-row');
  var button = document.getElementById('generation-stop');
  if (!row || !button) return;
  function sync() {
    row.classList.toggle('hidden', !store.get('processing'));
    button.disabled = !store.get('connected');
    button.title = store.get('connected') ? 'Stop generating' : 'Reconnect to stop generating';
  }
  button.addEventListener('click', function () {
    var ws = getWs();
    if (!store.get('processing') || !store.get('connected') || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'stop' }));
  });
  store.subscribe(function (state, previous) {
    if (state.processing !== previous.processing || state.connected !== previous.connected) sync();
  });
  sync();
}
