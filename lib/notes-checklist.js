// Bounded source identities shared by checklist validation and reconciliation.
function items(text) {
  var lines = (text || '').split('\n').slice(1);
  var occurrences = Object.create(null);
  var out = [];
  var fence = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var match = line.match(/^\s*(\x60{3,}|~{3,})/);
    if (match) { fence = fence === match[1].charAt(0) ? null : (fence || match[1].charAt(0)); continue; }
    if (fence || !line.trim() || /^\s*#{1,6}\s/.test(line)) continue;
    var occurrence = occurrences[line] || 0;
    occurrences[line] = occurrence + 1;
    var key = line + '\u0000' + occurrence;
    if (i <= 1000 && key.length <= 2000 && encodeURIComponent(key).length <= 2000) out.push({ index: i, key: key });
  }
  return out;
}

function validState(value) {
  if (!Array.isArray(value) && (!value || typeof value !== 'object')) return false;
  var keys = Object.keys(value);
  if (keys.length > 1000) return false;
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].length > 2000 || typeof value[keys[i]] !== 'boolean') return false;
  }
  return true;
}

function normalizeState(value, text) {
  var state = {};
  items(text).forEach(function (item) {
    var checked = value && value[Array.isArray(value) ? item.index : item.key];
    if (typeof checked === 'boolean' && Object.keys(state).length < 1000) state[item.key] = checked;
  });
  return state;
}

function validateChange(note, changes) {
  if (changes.checklistIndex === undefined) return null;
  if (!Number.isInteger(changes.checklistIndex) || changes.checklistIndex < 0 || changes.checklistIndex > 1000) return null;
  if (typeof changes.checklistChecked !== 'boolean' || typeof changes.checklistSource !== 'string' || typeof changes.checklistKey !== 'string') return null;
  if (changes.checklistSource !== note.text || changes.checklistKey.length > 2000 || (changes.text !== undefined && changes.text !== note.text)) return null;
  var item = items(note.text).find(function (item) { return item.index === changes.checklistIndex; });
  var state = normalizeState(note.checklistState, note.text);
  if (item && state[item.key] === undefined && Object.keys(state).length >= 1000) return null;
  try { return item && item.key === decodeURIComponent(changes.checklistKey) ? item.key : null; } catch (error) { return null; }
}

// Saved booleans win over Markdown markers, matching the native task controls.
var MARKER = /^\s*(?:[-*+]\s+)?\[([ xX])\]\s*(.*)$/;

function describe(note) {
  var text = note && typeof note.text === 'string' ? note.text : '';
  var state = normalizeState(note && note.checklistState, text);
  var lines = text.split('\n');
  return items(text).map(function (item) {
    var line = lines[item.index + 1];
    var marker = line.match(MARKER);
    var saved = typeof state[item.key] === 'boolean' ? state[item.key] : null;
    return {
      item: encodeURIComponent(item.key),
      index: item.index,
      text: marker ? marker[2] : line.trim(),
      checked: saved !== null ? saved : !!(marker && marker[1].toLowerCase() === 'x'),
      saved: saved,
    };
  });
}

// Prompt/knowledge projection of a checklist note with its effective checks.
function effectiveText(note) {
  var text = note && typeof note.text === 'string' ? note.text : '';
  if (!note || note.checklistMode !== true) return text;
  var lines = text.split('\n');
  describe(note).forEach(function (entry) {
    lines[entry.index + 1] = '- [' + (entry.checked ? 'x' : ' ') + '] ' + entry.text;
  });
  return lines.join('\n');
}

function findItem(note, encodedKey) {
  if (typeof encodedKey !== 'string') return null;
  var key;
  try { key = decodeURIComponent(encodedKey); } catch (error) { return null; }
  return items(note && note.text).find(function (item) { return item.key === key; }) || null;
}

module.exports = {
  validState: validState, normalizeState: normalizeState, validateChange: validateChange,
  describe: describe, effectiveText: effectiveText, findItem: findItem,
};
