var AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
var requests = new AsyncLocalStorage();

function same(a, b) {
  return !!a && !!b && ['requestId', 'generation', 'projectSlug', 'viewerId', 'ownerId', 'sessionId', 'sessionOriginId', 'role', 'workerGeneration', 'groupStamp', 'parentSessionOriginId'].every(function (key) { return a[key] === b[key]; });
}
function run(ws, msg, dispatch) {
  var binding = ws._clayPaneActivation;
  if (!binding && msg.paneBinding || binding && msg.type === 'switch_session' && !msg.paneActivation) return;
  if (binding && ['switch_session', 'ping', 'pong', 'clay_ui_ready'].indexOf(msg.type) < 0) {
    if (!same(binding, msg.paneBinding) || !ws._clayPaneActivationValid || !ws._clayPaneActivationValid()) return;
  }
  return requests.run({ ws: ws, binding: binding || null }, function () { return dispatch(ws, msg); });
}
// A direct asynchronous reply retains the request's original binding. Live
// provider events instead supply their authoritative source session explicitly.
function outbound(ws, message, sessionId) {
  if (!message || message.paneActivation || /^pane_activation_/.test(message.type)) return message;
  var scope = requests.getStore();
  var binding = sessionId === undefined ? scope && scope.ws === ws && scope.binding : ws._clayPaneActivation;
  if (!binding) return message;
  if (sessionId !== undefined && binding.sessionId !== sessionId) return null;
  if (!same(binding, ws._clayPaneActivation) || !ws._clayPaneActivationValid || !ws._clayPaneActivationValid()) return null;
  return Object.assign({}, message, { paneActivation: binding });
}
module.exports = { run: run, outbound: outbound, same: same };
