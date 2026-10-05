import { store } from './store.js';
import { showConfirm, hideConfirm } from './app-misc.js';
import { parseOriginDraft, removesCurrentOrigin, describeInvalidEntries } from './network-origin-guard.js';

// errorKind: 'validation' marks the textarea invalid; 'request' covers
// network, authorization, and disk failures that are not the input's fault.
function updateNetworkState(values) {
  store.set({ networkSettings: Object.assign({}, store.get('networkSettings'), values) });
  renderNetworkSettings();
}

function renderNetworkSettings() {
  var state = store.get('networkSettings');
  var input = document.getElementById('settings-network-origins');
  var button = document.getElementById('settings-network-save');
  var status = document.getElementById('settings-network-status');
  if (!input || !state) return;
  var locked = state.busy || state.confirming || !state.loaded;
  if (input.value !== state.draft) input.value = state.draft;
  input.disabled = locked;
  button.disabled = locked || state.draft === state.saved;
  button.textContent = state.busy && state.loaded ? 'Saving...' : 'Save changes';
  status.textContent = state.status;
  status.classList.toggle('settings-network-error', !!state.errorKind);
  input.setAttribute('aria-invalid', state.errorKind === 'validation' ? 'true' : 'false');
}

async function requestNetworkSettings(options) {
  var response = await fetch('/api/server/network', Object.assign({ credentials: 'same-origin' }, options));
  var data;
  try { data = await response.json(); } catch (e) { data = {}; }
  if (!response.ok) {
    var error = new Error(data.error || 'Could not reach network settings (HTTP ' + response.status + ').');
    if (typeof data.index === 'number') error.index = data.index;
    error.reason = data.reason;
    throw error;
  }
  return data;
}

function loadedState(data, extra) {
  var value = (data.allowedOrigins || []).join('\n');
  var invalidMessage = describeInvalidEntries(data.invalid);
  return Object.assign({ loaded: true, busy: false, draft: value, saved: value,
    status: invalidMessage, errorKind: invalidMessage ? 'validation' : '' }, extra || {});
}

export async function loadNetworkSettings() {
  var current = store.get('networkSettings');
  if (current.busy || current.confirming || (current.loaded && current.draft !== current.saved)) return;
  var requestId = current.requestId + 1;
  updateNetworkState({ busy: true, loaded: false, status: 'Loading...', errorKind: '', requestId: requestId });
  try {
    var data = await requestNetworkSettings();
    if (store.get('networkSettings').requestId !== requestId) return;
    updateNetworkState(loadedState(data));
  } catch (e) {
    if (store.get('networkSettings').requestId !== requestId) return;
    updateNetworkState({ loaded: false, busy: false, draft: '', saved: '', status: e.message, errorKind: 'request' });
  }
}

async function submitOrigins(parsed) {
  updateNetworkState({ busy: true, status: 'Saving...', errorKind: '' });
  try {
    var data = await requestNetworkSettings({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Clay-Network-Settings': '1' },
      body: JSON.stringify({ allowedOrigins: parsed.origins }),
    });
    updateNetworkState(loadedState(data, { status: 'Saved. Applies to new connections; existing connections stay open.' }));
  } catch (e) {
    if (typeof e.index === 'number' && e.reason) {
      var line = parsed.lines[e.index] || e.index + 1;
      updateNetworkState({ busy: false, status: 'Line ' + line + ' ' + e.reason, errorKind: 'validation' });
    } else {
      updateNetworkState({ busy: false, status: e.message, errorKind: 'request' });
    }
  }
}

function confirmCurrentOriginRemoval(origin, parsed) {
  var modal = document.getElementById('confirm-modal');
  function settle() { if (modal) modal.classList.remove('confirm-above-settings'); }
  updateNetworkState({ confirming: true });
  if (modal) modal.classList.add('confirm-above-settings');
  showConfirm('This removes ' + origin + ', the address you are using now. Your current connection stays open, ' +
    'but the next reconnect or page reload from this address may be refused, and you may need local access to Clay to add it back.',
  function () {
    settle();
    updateNetworkState({ confirming: false });
    submitOrigins(parsed);
  }, 'Remove and save', true, function () {
    settle();
    updateNetworkState({ confirming: false, status: 'Not saved. Your edits are still here.', errorKind: '' });
    var input = document.getElementById('settings-network-origins');
    if (input) input.focus();
  });
  // Default keyboard focus to the safe choice.
  var cancel = document.getElementById('confirm-cancel');
  if (cancel) cancel.focus();
}

// Escape cancels a pending removal instead of closing Settings underneath it.
function handleConfirmEscape(event) {
  if (event.key !== 'Escape' || !store.get('networkSettings').confirming) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  hideConfirm();
}

export function saveNetworkSettings(event) {
  if (event) event.preventDefault();
  var state = store.get('networkSettings');
  if (!state.loaded || state.busy || state.confirming) return;
  var parsed = parseOriginDraft(state.draft);
  var removed = removesCurrentOrigin(state.saved, parsed.origins, window.location.origin);
  if (removed) {
    confirmCurrentOriginRemoval(removed, parsed);
    return;
  }
  return submitOrigins(parsed);
}

export function initNetworkSettings() {
  var form = document.getElementById('settings-network-form');
  if (!form) return;
  form.addEventListener('submit', saveNetworkSettings);
  window.addEventListener('keydown', handleConfirmEscape, true);
  document.getElementById('settings-network-origins').addEventListener('input', function () {
    updateNetworkState({ draft: this.value, status: '', errorKind: '' });
  });
}
