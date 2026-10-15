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

module.exports = { validState: validState, normalizeState: normalizeState, validateChange: validateChange };
