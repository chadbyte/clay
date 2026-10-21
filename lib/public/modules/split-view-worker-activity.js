import { clayToolDefinition } from './clay-tool-presentation.js';

// These are recorded events, not live tool controllers or authority receipts.
export function workerActivityNames(messages) {
  var names = Object.create(null), ambiguous = Object.create(null);
  messages.forEach(function (message) {
    if (!message.toolId || (message.recordType !== 'tool_start' && message.recordType !== 'tool_use')) return;
    if (names[message.toolId] && names[message.toolId].index !== message.recordIndex) ambiguous[message.toolId] = true;
    names[message.toolId] = { index: message.recordIndex, name: message.toolName };
  });
  Object.keys(ambiguous).forEach(function (id) { delete names[id]; });
  return names;
}
export function workerActivityLabel(message, names) {
  var match = message.toolId && names[message.toolId];
  var name = message.toolName || match && match.name;
  var definition = clayToolDefinition(name);
  var generic = { Read: 'Read file', read_file: 'Read file', Edit: 'Edit file', Write: 'Write file',
    Bash: 'Run command', exec_command: 'Run command', Grep: 'Search files', Glob: 'Find files',
    WebSearch: 'Search the web', WebFetch: 'Read web page' };
  return definition ? definition.noun : (Object.prototype.hasOwnProperty.call(generic, name) ? generic[name] : null) || (typeof name === 'string' ? name.slice(0, 120) : 'Tool activity');
}
export function captureWorkerDisclosures(body) {
  return {
    open: Array.from(body.querySelectorAll('details[open], [data-disclosure-key][aria-expanded="true"]')).map(function (node) { return node.dataset.disclosureKey; }),
    focus: document.activeElement && body.contains(document.activeElement) && (document.activeElement.dataset.disclosureKey || document.activeElement.parentElement && document.activeElement.parentElement.dataset.disclosureKey)
  };
}
export function restoreWorkerDisclosures(body, saved) {
  Array.from(body.querySelectorAll('[data-disclosure-key]')).forEach(function (node) {
    var key = node.dataset.disclosureKey;
    if (saved.open.indexOf(key) >= 0) { if (node.tagName === 'DETAILS') node.open = true; else if (node.getAttribute('aria-expanded') !== 'true') node.click(); }
    if (saved.focus === key) {
      var target = node.tagName === 'DETAILS' ? node.querySelector('summary') : node;
      if (target) target.focus({ preventScroll: true });
    }
  });
}
