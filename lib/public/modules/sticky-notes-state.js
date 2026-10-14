// Reconcile canonical broadcasts with optimistic checklist actions and text drafts.
import { store } from './store.js';
import { getNoteUiState, setNoteUiState, send } from './sticky-notes-shared.js';

function project(ui, pending, error) {
  var canonical = ui.canonical || {};
  var text = ui.draft ? ui.text : canonical.text || "";
  var mode = canonical.checklistMode === true;
  var state = Object.assign({}, canonical.checklistState || {});
  pending.forEach(function (request) {
    var changes = request.changes;
    if (changes.text !== undefined) text = changes.text;
    if (changes.checklistMode !== undefined) mode = changes.checklistMode;
    if (changes.checklistKey) state[decodeURIComponent(changes.checklistKey)] = changes.checklistChecked;
  });
  return setNoteUiState(canonical.id, {
    text: text,
    checklistMode: mode, checklistState: state, pending: pending, error: error || '',
  });
}

export function reconcileNote(data) {
  var ui = getNoteUiState(data.id, data);
  var draft = ui.draft && ui.text !== (data.text || '');
  ui = setNoteUiState(data.id, { canonical: data, canonicalRevision: (ui.canonicalRevision || 0) + 1, draft: draft });
  project(ui, ui.pending || [], ui.error);
}

export function mutateChecklist(id, changes) {
  var ui = getNoteUiState(id);
  var requestId = 'note-update-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  var pending = (ui.pending || []).concat([{ requestId: requestId, changes: changes, revision: ui.canonicalRevision, draftText: ui.text }]);
  project(ui, pending, '');
  if (!send(Object.assign({}, changes, { type: changes.humanClose ? 'note_close' : 'note_update', id: id, requestId: requestId }))) {
    project(getNoteUiState(id), pending.slice(0, -1), 'Connection unavailable');
  }
}

export function reconcileNoteResult(msg) {
  var ui = getNoteUiState(msg.noteId);
  var request = (ui.pending || []).find(function (item) { return item.requestId === msg.requestId; });
  if (!request) return;
  // The server broadcasts before acknowledgement. Use the returned note when
  // that broadcast was absent, but never replace a newer remote canonical note.
  if (msg.ok && msg.note && ui.canonicalRevision === request.revision) {
    reconcileNote(msg.note);
    ui = getNoteUiState(msg.noteId);
  }
  if (msg.ok && request.changes.checklistConvert && ui.text === request.draftText) {
    ui = setNoteUiState(msg.noteId, { draft: false, text: ui.canonical.text || '' });
  }
  if (msg.ok && (request.changes.checklistEdit || request.changes.checklistConvert || request.changes.humanClose)) {
    ui = setNoteUiState(msg.noteId, { checklistInputs: null });
  }
  var remaining = ui.pending.filter(function (item) { return item.requestId !== msg.requestId; });
  project(ui, remaining, msg.ok ? '' : msg.error || 'Could not save checklist change');
  return ui.canonical;
}

store.subscribe(function (next, previous) {
  if (next.connected || next.connected === previous.connected) return;
  var all = next.stickyNoteUiState || {};
  Object.keys(all).forEach(function (id) {
    if (all[id].pending && all[id].pending.length) project(all[id], [], 'Connection unavailable');
  });
});
