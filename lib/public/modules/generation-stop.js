import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { isDriverOperatedView } from './worker-pane-lock.js';

// Fallback Stop control for when Send cannot double as Stop: a draft sitting
// in the composer (Send stays Send so the draft can still go out), or a
// locked configured Worker pane (Send and the rest of the composer are
// hidden entirely). One button, two homes, moved rather than duplicated:
// beside Send in the ordinary composer action row, or a direct child of
// #input-area -- outside the composer that worker-pane-lock.js hides with
// #input-wrapper { display: none } -- when the pane is locked. Either way
// there is never more than one visible Stop, and a locked pane's hidden
// composer never takes the human's cancellation away with it.
export function initGenerationStop() {
  var button = document.getElementById('generation-stop');
  if (!button) return;
  var inputArea = document.getElementById('input-area');
  var actionRow = document.getElementById('input-bottom-right');
  var sendBtn = document.getElementById('send-btn');

  function place() {
    if (isDriverOperatedView()) {
      if (inputArea && button.parentNode !== inputArea) inputArea.appendChild(button);
    } else if (actionRow && button.parentNode !== actionRow) {
      actionRow.insertBefore(button, sendBtn || null);
    }
  }
  function sync() {
    button.classList.toggle('hidden', !store.get('processing'));
    button.disabled = !store.get('connected');
    button.title = store.get('connected') ? 'Stop generating' : 'Reconnect to stop generating';
    place();
  }
  button.addEventListener('click', function () {
    var ws = getWs();
    if (!store.get('processing') || !store.get('connected') || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'stop' }));
  });
  store.subscribe(function (state, previous) {
    if (state.processing !== previous.processing || state.connected !== previous.connected
      || state.splitGroups !== previous.splitGroups || state.activeSessionId !== previous.activeSessionId
      || state.paneSessionId !== previous.paneSessionId) sync();
  });
  sync();
}
