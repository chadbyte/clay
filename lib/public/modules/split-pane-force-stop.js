import { iconHtml } from './icons.js';
import { livePaneBinding, samePaneBinding } from './pane-binding.js';
import { syncPaneHeaderState } from './split-pane-header-state.js';
import { showConfirm, hideConfirm } from './app-misc.js';

export function createPaneForceStop(paneEl, frame) {
  var button = document.createElement('button');
  button.type = 'button'; button.className = 'split-pane-force-stop';
  button.setAttribute('aria-label', 'Force stop session'); button.title = 'Force stop session and all its Workers';
  button.innerHTML = iconHtml('power');
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    if (!syncPaneHeaderState(paneEl) || button.disabled || !frame.contentWindow || !frame.clayPane || !livePaneBinding(frame)) return;
    var binding = frame.clayPane.identity().binding, sourceDocument = frame.contentDocument, settled = false;
    var title = paneEl.querySelector('.split-pane-title');
    var text = 'Force stop all work in ' + (title && title.textContent || 'this session') + ' and all of its Workers? Queued messages will be paused. The pane and conversation history will stay open. Commands or external requests already sent may still be running.';
    function current() {
      return paneEl.isConnected && !paneEl.hidden && !paneEl.inert && frame.contentDocument === sourceDocument &&
        syncPaneHeaderState(paneEl) && !button.disabled && livePaneBinding(frame, { paneBinding: binding }) && samePaneBinding(binding, frame.clayPane.identity().binding);
    }
    var modal = document.getElementById('confirm-modal'), panel = modal && modal.querySelector('.confirm-dialog');
    var cancel = document.getElementById('confirm-cancel'), ok = document.getElementById('confirm-ok');
    function cleanup() {
      settled = true;
      window.removeEventListener('keydown', onKey, true);
      if (panel) { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); panel.removeAttribute('aria-labelledby'); }
      if (current()) button.focus();
    }
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); hideConfirm(); return; }
      if (event.key !== 'Tab') return;
      event.preventDefault(); event.stopImmediatePropagation();
      var controls = [cancel, ok].filter(Boolean), index = controls.indexOf(document.activeElement);
      controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
    }
    showConfirm(text, function () {
      if (settled) return;
      var valid = current(); cleanup();
      if (!valid) return;
      frame.contentWindow.postMessage({ type: 'clay-pane-force-stop', paneBinding: binding }, window.location.origin);
    }, 'Force stop all work', true, cleanup);
    if (panel) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'confirm-text'); }
    window.addEventListener('keydown', onKey, true);
    if (cancel) cancel.focus();
  });
  return button;
}
