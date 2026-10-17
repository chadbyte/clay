// project-start-state.js - Pure state transitions for the project-start dialog

var VIEWS = { choices: true, open: true, create: true, clone: true };

export function idleSubmit() {
  return { status: 'idle', kind: null, requestId: null, error: null, cloning: false };
}

export function initialProjectStart() {
  return { view: null, gen: 0, name: '', url: '', submit: idleSubmit() };
}

// Deep links: "existing" lands on the folder step, "create"/"clone" on theirs, anything else on the choices.
export function viewForMode(mode) {
  if (mode === 'existing') return 'open';
  return mode === 'create' || mode === 'clone' ? mode : 'choices';
}

export function openState(prev, mode) {
  return { view: viewForMode(mode), gen: prev.gen + 1, name: '', url: '', submit: idleSubmit() };
}

export function closeState(prev) {
  return { view: null, gen: prev.gen + 1, name: '', url: '', submit: idleSubmit() };
}

export function selectView(prev, view) {
  if (!VIEWS[view] || prev.view === null) return prev;
  return { view: view, gen: prev.gen + 1, name: '', url: '', submit: idleSubmit() };
}

export function beginSubmit(prev, kind, requestId) {
  if (prev.view === null || prev.submit.status === 'busy') return prev;
  return Object.assign({}, prev, { submit: { status: 'busy', kind: kind, requestId: requestId, error: null, cloning: false } });
}

export function applyProgress(prev, msg) {
  var s = prev.submit;
  if (s.status !== 'busy' || s.kind !== 'clone' || !msg || msg.status !== 'cloning' || s.cloning || typeof msg.requestId !== 'string' || msg.requestId !== s.requestId) return prev;
  return Object.assign({}, prev, { submit: Object.assign({}, s, { cloning: true }) });
}

// outcome: 'success' | 'error' for the submission this dialog is waiting on,
// 'orphan' for any other reply (the dialog was closed or moved on), which never touches the dialog.
export function resolveSubmit(prev, msg) {
  var s = prev.submit;
  var matches = prev.view !== null && s.status === 'busy' && msg && typeof msg.requestId === 'string' && msg.requestId === s.requestId;
  if (!matches) return { state: prev, outcome: 'orphan', kind: null };
  if (msg.ok) return { state: closeState(prev), outcome: 'success', kind: s.kind };
  return {
    state: Object.assign({}, prev, { submit: Object.assign({}, idleSubmit(), { error: msg.error || 'Could not add this project.' }) }),
    outcome: 'error', kind: s.kind,
  };
}
