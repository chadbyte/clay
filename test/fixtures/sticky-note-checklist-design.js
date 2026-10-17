// Isolated presentation preview. No network mutation or persistent storage.
import { createStore } from '/lib/public/modules/store.js';
import { setWs } from '/lib/public/modules/ws-ref.js';
import { handleNotesList, handleNoteUpdated, handleNoteUpdateResult, handleNoteDeleted, initStickyNotes } from '/lib/public/modules/sticky-notes.js';
import { setNoteUiState } from '/lib/public/modules/sticky-notes-shared.js';
import { renderTaskControls } from '/lib/public/modules/sticky-notes-checklist.js';
var samples = [
  ['purple', 'Release preparations\n- [ ] Review the onboarding journey and make sure the first useful action remains clear on a narrow screen\n- [x] Check the release notes\n- [ ] Confirm keyboard navigation'],
  ['green', 'Today\n- [x] Make a little room to think\n- [x] Finish the first working version\n- [ ] Take a fresh look'],
  ['yellow', 'A fresh page'],
  ['blue', 'Links and longer thoughts\n- [ ] Review https://example.com/release/preparations/keyboard-and-screen-reader-behaviour\n- [ ] Keep the complete thought readable as the note gets narrower'],
  ['pink', 'Ready to go\n- [x] Review the scope\n- [x] Check the result together'],
  ['orange', 'Keep a draft\n- [ ] Revisit the wording before sharing']
];
var notes = samples.map(function (sample, i) { return { id: 'sample-' + i, text: sample[1], color: sample[0], checklistMode: true, checklistState: {}, state: 'open', x: 0, y: 0, w: 300, h: 360, opacity: .85, updatedAt: i + 1 }; });
var failNext = false;
createStore({ connected: true, stickyNoteUiState: {}, notesTemporarilyHidden: false });
initStickyNotes();
setWs({ send: function (raw) {
  var msg = JSON.parse(raw);
  if (msg.type !== 'note_update' && msg.type !== 'note_close') return;
  var note = notes.find(function (item) { return item.id === msg.id; });
  if (!note) return;
  var fail = failNext; failNext = false;
  document.getElementById('failure').textContent = 'Fail next save';
  setTimeout(function () {
    if (fail) { handleNoteUpdateResult({ noteId: note.id, requestId: msg.requestId, ok: false, error: 'Sample save failed. Your draft is still here.' }); return; }
    if (msg.text !== undefined) note.text = msg.text;
    if (msg.checklistKey) note.checklistState[decodeURIComponent(msg.checklistKey)] = msg.checklistChecked;
    if (msg.checklistConvert) { note.text = ''; note.checklistState = {}; }
    if (msg.checklistMode !== undefined) note.checklistMode = msg.checklistMode;
    if (msg.type === 'note_close') { note.state = 'closed'; handleNoteDeleted({ id: note.id }); }
    note.updatedAt++;
    var snapshot = JSON.parse(JSON.stringify(note));
    handleNoteUpdated({ note: snapshot });
    handleNoteUpdateResult({ noteId: note.id, requestId: msg.requestId, ok: true, note: snapshot });
  }, 500);
} });
handleNotesList({ notes: JSON.parse(JSON.stringify(notes)) });
setNoteUiState('sample-5', { error: 'Sample save failed. Your draft is still here.', checklistInputs: { entry: 'This thought is kept safely in the draft' } });
renderTaskControls(document.querySelector('[data-note-id="sample-5"] .sticky-note-rendered'), 'sample-5');
function theme(dark) { document.documentElement.classList.toggle('dark-theme', dark); document.documentElement.classList.toggle('light-theme', !dark); }
theme(new URLSearchParams(location.search).get('theme') === 'dark');
document.getElementById('theme').onclick = function () { theme(!document.documentElement.classList.contains('dark-theme')); };
document.getElementById('failure').onclick = function () { failNext = true; this.textContent = 'Next save will fail'; };
document.getElementById('reset').onclick = function () { location.reload(); };
