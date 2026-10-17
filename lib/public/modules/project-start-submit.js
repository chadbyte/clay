// project-start-submit.js - add_project / create_project / clone_project requests and replies

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { switchProject } from './app-projects.js';
import { beginSubmit, applyProgress, resolveSubmit, idleSubmit } from './project-start-state.js';

var seq = 0;

function state() { return store.get('projectStart'); }
function setState(next) { store.set({ projectStart: next }); }

function failSubmit(message) {
  var current = state();
  setState(Object.assign({}, current, { submit: Object.assign({}, idleSubmit(), { error: message }) }));
}

function submit(kind, payload) {
  var begun = beginSubmit(state(), kind, 'start-' + (seq += 1));
  if (begun === state()) return;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    setState(begun);
    failSubmit('Not connected to the server.');
    return;
  }
  setState(begun);
  ws.send(JSON.stringify(Object.assign({ requestId: begun.submit.requestId }, payload)));
}

export function submitFolder(dir) {
  if (typeof dir !== 'string' || !dir) return;
  submit('open', { type: 'add_project', path: dir });
}

export function submitCreate() {
  var name = state().name.trim();
  if (name) submit('create', { type: 'create_project', name: name });
}

export function submitClone() {
  var url = state().url.trim();
  if (url) submit('clone', { type: 'clone_project', url: url });
}

export function handleCloneProgress(msg) {
  var next = applyProgress(state(), msg);
  if (next !== state()) setState(next);
}

var SUCCESS_TOASTS = { open: 'Project added', create: 'Project created', clone: 'Project cloned' };

export function handleAddProjectResult(msg) {
  var out = resolveSubmit(state(), msg);
  if (out.outcome === 'orphan') {
    // The dialog was closed or moved on; report the outcome without touching or reopening it.
    if (msg.ok) showToast(msg.existing ? 'Project already registered' : 'Project added', msg.existing ? 'info' : 'success');
    else showToast(msg.error || 'Failed to add project', 'error');
    return;
  }
  setState(out.state);
  if (out.outcome === 'success') {
    showToast(msg.existing ? 'Project already registered' : SUCCESS_TOASTS[out.kind], msg.existing ? 'info' : 'success');
    if (msg.slug) switchProject(msg.slug);
  }
}
