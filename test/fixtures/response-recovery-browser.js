import '/app.js';
import { store } from '/modules/store.js';
import { getWs } from '/modules/ws-ref.js';

var bar = document.createElement('section');
bar.id = 'recovery-fixture-controls';
bar.setAttribute('aria-label', 'Recovery fixture controls');
bar.style.cssText = 'position:fixed;top:8px;left:260px;right:12px;z-index:9999;display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font:12px sans-serif';
var label = document.createElement('span');
label.textContent = 'Isolated fixture · Synthetic Claude · Manual clock';
bar.appendChild(label);
var status = document.createElement('output');
status.id = 'fixture-status';
status.setAttribute('aria-live', 'polite');
var errors = document.createElement('output');
errors.id = 'fixture-action-error';
async function action(name) {
  errors.textContent = '';
  var response = await fetch('/__fixture/action/' + name, { method: 'POST' });
  if (!response.ok) errors.textContent = await response.text();
  return refresh();
}
[['fresh', 'Fresh session'], ['advance', 'Advance 3 minutes'], ['confirm', 'Confirm stopped'], ['reply', 'Reply successfully'],
 ['disconnect', 'Disconnect socket'], ['disconnect-recover', 'Disconnect and recover']].forEach(function(item) {
  var button = document.createElement('button');
  button.id = 'fixture-' + item[0]; button.textContent = item[1]; button.type = 'button';
  button.onclick = function() { action(item[0]).catch(function(error) { errors.textContent = error.message; }); };
  bar.appendChild(button);
});
bar.appendChild(status); bar.appendChild(errors); document.body.appendChild(bar);
async function refresh() {
  var state = await (await fetch('/__fixture/state')).json();
  var ownAttempts = state.attempts.filter(function(attempt) { return attempt.sessionId === state.sessionId; });
  status.textContent = (store.get('connected') ? 'Connected' : 'Disconnected') + ' · ' + (state.processing ? 'Processing' : 'Idle')
    + ' · Attempts ' + ownAttempts.length + ' · Connections ' + state.connections + (state.stopping ? ' · Awaiting stop confirmation' : '');
  return state;
}
window.recoveryFixture = { store: store, getWs: getWs, action: action, state: refresh };
setInterval(refresh, 250);
