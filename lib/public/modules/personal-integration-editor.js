import { store } from './store.js';
import { confirmSettingsAction } from './server-settings-state.js';
import { showToast } from './utils.js';
import { closePersonalLinearEditor } from './user-settings-integrations.js';
import { closeGithubEditor, stopGithubEditorLogin } from './user-settings-github.js';
import { closePersonalEmailEditor } from './personal-settings-dialog.js';

export function integrationEditorBusy() {
  return store.get('personalLinearSaving') || store.get('personalEmailSaving') || store.get('personalIntegrationSwitching') ||
    store.get('githubSettingsPending') && store.get('githubSettingsAction') !== 'get' && store.get('githubSettingsAction') !== 'login';
}
function focusEditor(selector) {
  var root = document.querySelector(selector);
  if (!root) return;
  var last = store.get('personalIntegrationFocus');
  var target = last && root.contains(last) ? last : root.querySelector('input:not([type=hidden]),button') || root;
  if (target.disabled) { root.tabIndex = -1; target = root; }
  target.focus();
}
export function clearIntegrationEditor(key) {
  var active = store.get('personalIntegrationEditor');
  if (active && active.key === key) store.set({personalIntegrationEditor:null,personalIntegrationFocus:null});
}
function cleanup() {
  var active = store.get('personalIntegrationEditor');
  if (!active) return;
  if (active.key === 'github') closeGithubEditor();
  else if (active.key.indexOf('linear:') === 0) closePersonalLinearEditor();
  else if (active.key.indexOf('email-add:') === 0) closePersonalEmailEditor();
  else {
    var panel = document.querySelector(active.selector);
    if (panel) { panel.hidden = true; panel.parentElement.querySelector('[aria-expanded]').setAttribute('aria-expanded','false'); }
  }
  clearIntegrationEditor(active.key);
}
export function selectIntegrationEditor(key, selector, open) {
  if (integrationEditorBusy()) {
    var current = store.get('personalIntegrationEditor');
    if (current) focusEditor(current.selector);
    showToast('Wait for the current connection operation to finish.'); return;
  }
  var active = store.get('personalIntegrationEditor');
  if (active && active.key === key) { focusEditor(selector); return; }
  var actor = store.get('myUserId'), socket = store.get('projectSplitViewSocketGeneration');
  async function proceed() {
    if (actor !== store.get('myUserId') || socket !== store.get('projectSplitViewSocketGeneration') || integrationEditorBusy()) return;
    store.set({personalIntegrationSwitching:true});
    try {
      if (active && active.key === 'github' && !await stopGithubEditorLogin()) return;
      if (actor !== store.get('myUserId') || socket !== store.get('projectSplitViewSocketGeneration') || active !== store.get('personalIntegrationEditor')) return;
      cleanup();
      if (!key) { if (open) open(); return; }
      store.set({personalIntegrationEditor:{key:key,selector:selector}});
      open();
    } finally { store.set({personalIntegrationSwitching:false}); }
  }
  if (active && (store.get('personalLinearDirty') || store.get('personalEmailDirty'))) {
    focusEditor(active.selector);
    confirmSettingsAction('Discard this unsaved connection draft?', 'Discard', proceed);
  } else proceed();
}
export function bindIntegrationEditorFocus(root) {
  root.addEventListener('focusin', function (event) {
    var active = store.get('personalIntegrationEditor'), editor = active && document.querySelector(active.selector);
    if (editor && editor.contains(event.target)) store.set({personalIntegrationFocus:event.target});
  });
  store.subscribe(function (state, previous) {
    if (state.myUserId !== previous.myUserId) store.set({personalIntegrationEditor:null,personalIntegrationFocus:null});
  });
}
