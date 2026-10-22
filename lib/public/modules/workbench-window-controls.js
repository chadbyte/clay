import { store } from './store.js';
import { iconHtml } from './icons.js';
import { WORKBENCH_PANELS } from './workbench-panels.js';

// Every registered workbench gets the same window actions. Existing controllers
// retain their handlers; missing actions use the common shell and presentation.
export function ensureWorkbenchWindowControls(panel, name, actions) {
  var definition = WORKBENCH_PANELS[name];
  if (!definition || !actions) return;
  function ensure(kind, selector, label, icon) {
    var button = actions.querySelector(selector);
    if (!button) {
      button = document.createElement('button'); button.type = 'button';
      button.setAttribute('aria-label', label); button.setAttribute('data-tip', label);
      button.setAttribute('aria-pressed', String(kind === 'wide' && !!((store.get('workbenchWindowStates') || {})[name] || {}).wide)); button.innerHTML = iconHtml(icon);
      var close = actions.querySelector('button[aria-label^="Close"]');
      actions.insertBefore(button, close || null);
      button.addEventListener('click', function () {
        if (kind === 'fullscreen') panel.classList.toggle('panel-fullscreen');
        else {
          var values = store.get('workbenchWindowStates') || {}, previous = values[name] || {};
          var wide = !previous.wide;
          store.set({ workbenchWindowStates: Object.assign({}, values, { [name]: Object.assign({}, previous, { wide: wide }) }) });
          button.setAttribute('aria-pressed', String(wide));
        }
      });
    }
    button.dataset.workbenchWindow = kind;
    return button;
  }
  ensure('wide', 'button[aria-label^="Widen"]', 'Widen ' + definition.label, 'chevrons-left-right');
  ensure('fullscreen', 'button[aria-label*="fullscreen"]', 'Toggle ' + definition.label + ' fullscreen', 'maximize-2');
  syncWorkbenchWindowControls(panel, actions);
}
export function syncWorkbenchWindowControls(panel, actions) {
  var full = panel.classList.contains('panel-fullscreen');
  var button = actions.querySelector('[data-workbench-window="fullscreen"]');
  if (button) button.setAttribute('aria-pressed', String(full));
}
