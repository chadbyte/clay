import { getWs } from './ws-ref.js';
import { iconHtml } from './icons.js';

export function syncWorkerForceStop(header, worker) {
  var button = header.querySelector('[data-worker-force-stop]');
  if (!button) return;
  var support = worker && worker.forceTermination;
  button.disabled = !support || support.supported !== true;
  button.title = button.disabled ? support && support.reason || 'Force termination is not yet supported for this vendor' : 'Force stop Worker';
  button.setAttribute('aria-label', 'Force stop Worker' + (button.disabled ? ': ' + button.title : ''));
}

// The caller revalidates the visible Driver and exact Worker on every action.
export function appendWorkerStopControls(header, target) {
  ['stop', 'force_stop'].forEach(function (type) {
    var button = document.createElement('button'), pressed = null;
    button.type = 'button'; button.className = 'worker-conversation-stop';
    button.setAttribute('aria-label', type === 'stop' ? 'Stop Worker' : 'Force stop Worker');
    button.title = type === 'stop' ? 'Stop Worker' : 'Force stop Worker';
    button.innerHTML = iconHtml(type === 'stop' ? 'square' : 'octagon-x');
    function stamp(value) { return value && JSON.stringify(value); }
    button.addEventListener('pointerdown', function () { pressed = stamp(target()); });
    button.addEventListener('keydown', function () { pressed = stamp(target()); });
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var current = target(), ws = getWs();
      if (button.disabled || type === 'force_stop' && (!current || !current.forceTermination || current.forceTermination.supported !== true)) return;
      if (!current || !ws || ws.readyState !== 1 || pressed && pressed !== stamp(current)) return;
      pressed = null;
      ws.send(JSON.stringify({ type: type, sessionId: current.workerId, sessionOriginId: current.workerOriginId,
        workerGeneration: current.generation, parentSessionOriginId: current.driverOriginId }));
    });
    if (type === 'force_stop') button.dataset.workerForceStop = 'true';
    header.appendChild(button);
  });
}
