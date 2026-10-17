// Plain task controls use Markdown only as the internal persistence format.
import { iconHtml, refreshIcons } from './icons.js';
import { getChecklistItems } from './sticky-note-markdown.js';
import { getNoteUiState, setNoteUiState } from './sticky-notes-shared.js';
import { mutateChecklist } from './sticky-notes-state.js';

export function checklistDraftText(ui) {
  var fields = ui.checklistInputs || {};
  var lines = (ui.text || '').split('\n');
  if (fields.title !== undefined) lines[0] = fields.title;
  getChecklistItems(ui.text).forEach(function (item) {
    if (fields[item.key] !== undefined) {
      var marker = item.text.match(/^\s*(?:[-*+]\s+)?\[([ xX])\]/);
      var checked = ui.checklistState[item.key];
      if (checked === undefined) checked = marker && marker[1].toLowerCase() === 'x';
      lines[item.index + 1] = '- [' + (checked ? 'x' : ' ') + '] ' + fields[item.key];
    }
  });
  if (fields.entry && fields.entry.trim()) {
    if (!lines[0].trim()) lines[0] = 'Checklist';
    lines.push('- [ ] ' + fields.entry.trim());
  }
  return lines.join('\n');
}

export function renderTaskControls(root, id) {
  var ui = getNoteUiState(id);
  var fields = ui.checklistInputs || {};
  var busy = ui.pending.length > 0;
  var active = document.activeElement;
  var focusField = active && root.contains(active) ? active.dataset.taskField : undefined;
  var selection = focusField !== undefined ? [active.selectionStart, active.selectionEnd] : null;
  root.replaceChildren();
  var form = document.createElement('form'); form.className = 'sn-task-form';
  form.setAttribute('aria-label', 'Checklist');
  form.setAttribute('aria-busy', busy ? 'true' : 'false');
  var feedback = document.createElement('span'); feedback.className = 'sn-task-feedback';
  feedback.setAttribute('role', 'status');
  var saveButton = document.createElement('button');
  function updateFeedback() {
    var current = getNoteUiState(id);
    var dirty = checklistDraftText(current) !== current.text;
    feedback.textContent = busy ? 'Saving…' : current.error ? (dirty ? 'Draft kept. ' : 'Not saved. ') + current.error : dirty ? 'Unsaved changes' : 'All changes saved';
    saveButton.disabled = busy || !dirty;
  }
  function input(label, value, key) {
    var control = document.createElement('textarea'); control.rows = 1; control.value = fields[key] !== undefined ? fields[key] : value;
    control.setAttribute('aria-label', label); control.placeholder = label; control.maxLength = 400;
    control.readOnly = busy;
    control.dataset.taskField = key;
    control.onkeydown = function (event) {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    };
    control.oninput = function () {
      var current = getNoteUiState(id);
      // A task remains one persisted line; visual wrapping does not split tasks.
      control.value = control.value.replace(/[\r\n]+/g, ' ');
      var draft = Object.assign({}, current.checklistInputs || {}); draft[key] = control.value;
      setNoteUiState(id, { checklistInputs: draft });
      updateFeedback();
    };
    return control;
  }
  var title = input('Checklist title', (ui.text || '').split('\n')[0], 'title'); title.className = 'sn-task-title'; form.appendChild(title);
  var items = getChecklistItems(ui.text);
  var completed = 0;
  var summary = document.createElement('div'); summary.className = 'sn-task-summary';
  form.appendChild(summary);
  items.forEach(function (item, position) {
    var row = document.createElement('div'); row.className = 'sn-task-row';
    var marker = item.text.match(/^\s*(?:[-*+]\s+)?\[([ xX])\]\s*(.*)$/);
    var check = document.createElement('button'); check.type = 'button'; check.className = 'sn-check';
    var checked = ui.checklistState[item.key];
    if (checked === undefined) checked = marker && marker[1].toLowerCase() === 'x';
    check.classList.toggle('checked', !!checked);
    check.innerHTML = '<span class="sn-task-box" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="m3.5 8 3 3 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    row.classList.toggle('is-complete', !!checked);
    if (checked) completed++;
    check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', checked ? 'true' : 'false'); check.setAttribute('aria-label', 'Complete task ' + (position + 1));
    check.dataset.checklistIndex = item.index; check.dataset.checklistKey = encodeURIComponent(item.key);
    check.disabled = busy;
    var label = input('Task ' + (position + 1), marker ? marker[2] : item.text, item.key);
    var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'sn-task-remove'; remove.innerHTML = iconHtml('x'); remove.setAttribute('aria-label', 'Remove task ' + (position + 1)); remove.disabled = busy;
    remove.onclick = function () {
      var current = getNoteUiState(id); var lines = checklistDraftText(current).split('\n'); lines.splice(item.index + 1, 1);
      save(lines.join('\n'));
    };
    row.append(check, label, remove); form.appendChild(row);
  });
  summary.textContent = items.length ? completed + ' of ' + items.length + ' complete' : 'A little space for what’s next';
  var addRow = document.createElement('div'); addRow.className = 'sn-task-add';
  var plus = document.createElement('span'); plus.className = 'sn-task-plus'; plus.innerHTML = iconHtml('plus'); plus.setAttribute('aria-hidden', 'true');
  var entry = input('New task', '', 'entry'); entry.className = 'sn-task-entry'; entry.placeholder = 'Add a task…';
  addRow.append(plus, entry); form.appendChild(addRow);
  var footer = document.createElement('div'); footer.className = 'sn-task-footer';
  saveButton.type = 'submit'; saveButton.className = 'sn-task-save'; saveButton.textContent = 'Save tasks';
  footer.append(feedback, saveButton); form.appendChild(footer);
  updateFeedback();
  function save(text) {
    var current = getNoteUiState(id);
    if (current.pending.length) return;
    mutateChecklist(id, { checklistEdit: true, checklistSource: current.canonical.text, checklistVersion: current.canonical.updatedAt, text: text });
  }
  form.onsubmit = function (event) { event.preventDefault(); save(checklistDraftText(getNoteUiState(id))); };
  root.appendChild(form); refreshIcons(root);
  if (focusField !== undefined) {
    var controls = form.querySelectorAll('[data-task-field]');
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].dataset.taskField === focusField) {
        controls[i].focus({ preventScroll: true });
        controls[i].setSelectionRange(selection[0], selection[1]);
        break;
      }
    }
  }
}
