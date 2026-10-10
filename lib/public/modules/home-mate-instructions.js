import { store } from './store.js';
import { getWs } from './ws-ref.js';

var sequence = 0;
var timer = null;
function state() { return store.get('mateInstructionsDraft'); }
function put(value) { store.set({mateInstructionsDraft: value}); }
export function resetMateInstructions(mateId) {
  clearTimeout(timer);
  put(mateId ? {mateId: mateId, content: '', saved: '', revision: '', status: 'idle', error: '', requestId: null} : null);
}
export function hasMateInstructionDraft() { var s = state(); return !!s && (s.content !== s.saved || s.status === 'saving'); }
function request(save, render) {
  var s = state();
  if (!s || s.status === 'saving') return;
  var id = 'mate-instructions-' + Date.now() + '-' + (++sequence);
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { put(Object.assign({}, s, {error: 'Clay is offline. Reconnect and try again.', status: s.revision ? 'ready' : 'error'})); render(); return; }
  put(Object.assign({}, s, {requestId: id, status: save ? 'saving' : 'loading', error: ''}));
  render();
  try { ws.send(JSON.stringify({type: save ? 'mate_instructions_set' : 'mate_instructions_get', mateId: s.mateId, requestId: id, content: save ? s.content : undefined, revision: save ? s.revision : undefined})); }
  catch (error) { put(Object.assign({}, state(), {status: s.revision ? 'ready' : 'error', requestId: null, error: 'Could not send. Your draft is retained.'})); render(); return; }
  clearTimeout(timer);
  timer = setTimeout(function () {
    var current = state();
    if (!current || current.requestId !== id) return;
    put(Object.assign({}, current, {requestId: null, status: current.revision ? 'ready' : 'error', error: 'No response received. Retry to check the saved prompt.'}));
    render();
  }, 15000);
}
export function loadMateInstructions(render) { request(false, render); }
export function applyMateInstructions(msg) {
  var s = state();
  if (!s || msg.mateId !== s.mateId || msg.requestId !== s.requestId) return false;
  clearTimeout(timer);
  if (!msg.ok) put(Object.assign({}, s, {status: s.revision ? 'ready' : 'error', requestId: null, conflict: !!msg.conflict, error: msg.error || 'Could not save the prompt.'}));
  else put(Object.assign({}, s, {status: 'ready', requestId: null, content: msg.content, saved: msg.content, revision: msg.revision, conflict: false, error: '', notice: msg.operation === 'save' ? 'Prompt saved. New conversations use these instructions.' : ''}));
  return true;
}
export function renderMateInstructions(body, render) {
  var s = state();
  if (!s) return;
  var section = document.createElement('section');
  section.className = 'mate-instructions';
  section.innerHTML = '<p class="mate-settings-help">The identity and instructions this Mate uses. Clay manages its system capabilities separately.</p>';
  body.appendChild(section);
  if (s.status === 'idle' || (s.status === 'loading' && !s.revision)) {
    section.insertAdjacentHTML('beforeend', '<p role="status" class="mate-settings-help">Loading prompt…</p>');
    return;
  }
  if (s.revision) {
    var input = document.createElement('textarea');
    input.className = 'mate-instructions-input';
    input.id = 'mate-prompt-input';
    input.setAttribute('aria-label', 'Mate prompt');
    input.spellcheck = false;
    input.value = s.content;
    input.disabled = s.status === 'saving' || s.status === 'loading';
    section.appendChild(input);
    input.addEventListener('input', function () { put(Object.assign({}, state(), {content: input.value, notice: ''})); updateActions(); });
  }
  var status = document.createElement('p');
  status.className = 'mate-settings-status' + (s.error ? ' is-error' : '');
  status.setAttribute('role', s.error ? 'alert' : 'status');
  status.textContent = s.error || s.notice || (s.status === 'saving' ? 'Saving prompt…' : '');
  section.appendChild(status);
  var actions = document.createElement('div');
  actions.className = 'mate-settings-savebar';
  section.appendChild(actions);
  function button(text, action, primary) {
    var el = document.createElement('button'); el.type = 'button'; el.textContent = text; el.className = 'mate-settings-button' + (primary ? ' primary' : ''); el.addEventListener('click', action); actions.appendChild(el); return el;
  }
  function updateActions() {
    var current = state(); actions.replaceChildren();
    if (current.conflict || !current.revision) {
      button(current.conflict ? 'Reload saved prompt' : 'Try again', function () { request(false, render); });
      if (current.conflict) {
        var help = document.createElement('span'); help.textContent = 'Copy your draft before reloading.'; help.className = 'mate-settings-help'; actions.appendChild(help);
      }
      return;
    }
    actions.hidden = current.content === current.saved && current.status !== 'saving';
    if (actions.hidden) return;
    var cancel = button('Cancel', function () { put(Object.assign({}, current, {content: current.saved, error: '', notice: ''})); render(); });
    var save = button('Save prompt', function () { request(true, render); }, true);
    cancel.disabled = current.status === 'saving';
    save.disabled = current.status === 'saving';
  }
  updateActions();
}
