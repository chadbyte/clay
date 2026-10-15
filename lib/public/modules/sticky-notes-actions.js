import { getNoteUiState, clearNoteTextTimer, setNoteUiState } from './sticky-notes-shared.js';
import { checklistDraftText } from './sticky-notes-checklist.js';
import { mutateChecklist } from './sticky-notes-state.js';
import { confirmSettingsAction } from './server-settings-state.js';

export function requestChecklistMode(id) {
  var ui = getNoteUiState(id);
  if (ui.pending.length) return;
  if (ui.checklistMode) { mutateChecklist(id, { checklistMode: false }); return; }
  var text = ui.text;
  var canonical = ui.canonical;
  function convert() {
    var current = getNoteUiState(id);
    if (current.text !== text || current.canonical.text !== canonical.text || current.canonical.updatedAt !== canonical.updatedAt) {
      setNoteUiState(id, { error: 'The note changed. Review its contents and try again.' }); return;
    }
    clearNoteTextTimer(id);
    mutateChecklist(id, { checklistConvert: true, checklistSource: canonical.text, checklistVersion: canonical.updatedAt });
  }
  if (text.trim() || (canonical.text || '').trim()) {
    confirmSettingsAction('Switching to a checklist will delete all existing contents and completion marks. Continue with an empty checklist?', 'Delete contents and create checklist', convert);
  } else convert();
}

export function closeHumanNote(id, fallback) {
  var ui = getNoteUiState(id, fallback);
  if (ui.pending.length) { setNoteUiState(id, { error: 'Wait for the current save before closing.' }); return; }
  clearNoteTextTimer(id);
  mutateChecklist(id, { humanClose: true, expectedText: ui.canonical.text, expectedVersion: ui.canonical.updatedAt, draftText: ui.checklistMode ? checklistDraftText(ui) : ui.text });
}
