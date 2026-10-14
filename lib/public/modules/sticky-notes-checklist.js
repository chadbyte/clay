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
  root.replaceChildren();
  var form = document.createElement('form'); form.className = 'sn-task-form';
  function input(label, value, key) {
    var control = document.createElement('input'); control.type = 'text'; control.value = fields[key] !== undefined ? fields[key] : value;
    control.setAttribute('aria-label', label); control.placeholder = label; control.maxLength = 400;
    control.disabled = busy;
    control.oninput = function () {
      var current = getNoteUiState(id);
      var draft = Object.assign({}, current.checklistInputs || {}); draft[key] = control.value;
      setNoteUiState(id, { checklistInputs: draft });
    };
    return control;
  }
  var title = input('Checklist title', (ui.text || '').split('\n')[0], 'title'); title.className = 'sn-task-title'; form.appendChild(title);
  getChecklistItems(ui.text).forEach(function (item, position) {
    var row = document.createElement('div'); row.className = 'sn-task-row';
    var marker = item.text.match(/^\s*(?:[-*+]\s+)?\[([ xX])\]\s*(.*)$/);
    var check = document.createElement('button'); check.type = 'button'; check.className = 'sn-check';
    var checked = ui.checklistState[item.key];
    if (checked === undefined) checked = marker && marker[1].toLowerCase() === 'x';
    check.classList.toggle('checked', !!checked); check.textContent = checked ? '✓' : '☐';
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
  var entry = input('New task', '', 'entry'); entry.className = 'sn-task-entry'; form.appendChild(entry);
  var saveButton = document.createElement('button'); saveButton.type = 'submit'; saveButton.className = 'sn-task-save'; saveButton.textContent = 'Save tasks'; saveButton.disabled = busy; form.appendChild(saveButton);
  function save(text) {
    var current = getNoteUiState(id);
    if (current.pending.length) return;
    mutateChecklist(id, { checklistEdit: true, checklistSource: current.canonical.text, checklistVersion: current.canonical.updatedAt, text: text });
  }
  form.onsubmit = function (event) { event.preventDefault(); save(checklistDraftText(getNoteUiState(id))); };
  root.appendChild(form); refreshIcons(root);
}
