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
export function appendWorkerActivity(body, messages, names) {
  var group = document.createElement('section'); group.className = 'worker-activity-group';
  var key = String(messages[messages.length - 1].recordIndex);
  group.dataset.activityKey = key;
  var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'worker-activity-summary';
  toggle.dataset.disclosureKey = 'activity-' + key;
  var activityIcon = document.createElement('i'); activityIcon.setAttribute('data-lucide', 'activity'); activityIcon.setAttribute('aria-hidden', 'true');
  var heading = document.createElement('span'); heading.textContent = 'Activity · ' + messages.length + (messages.length === 1 ? ' recorded step' : ' recorded steps');
  var chevron = document.createElement('i'); chevron.className = 'worker-activity-chevron';
  chevron.setAttribute('data-lucide', 'chevron-down'); chevron.setAttribute('aria-hidden', 'true');
  toggle.append(activityIcon, heading, chevron);
  toggle.setAttribute('aria-expanded', 'false'); toggle.disabled = messages.length <= 2;
  var list = document.createElement('div'); list.className = 'worker-activity-list';
  var items = [];
  messages.forEach(function (message) {
    var item = document.createElement('article'); item.className = 'worker-activity-item worker-tool-message';
    item.dataset.recordIndex = String(message.recordIndex);
    var phase = message.isError ? 'failed' : message.recordType === 'tool_result' ? 'returned' : 'recorded';
    item.dataset.phase = phase;
    var row = document.createElement('div'); row.className = 'worker-activity-row';
    var glyph = document.createElement('i'); glyph.className = 'worker-activity-glyph'; glyph.setAttribute('aria-hidden', 'true');
    glyph.setAttribute('data-lucide', phase === 'failed' ? 'circle-alert' : phase === 'returned' ? 'corner-down-left' : 'circle-dot');
    var label = document.createElement('span'); label.className = 'worker-activity-label'; label.textContent = workerActivityLabel(message, names);
    var detail = document.createElement('span'); detail.className = 'worker-activity-detail';
    detail.textContent = phase === 'failed' ? 'Failed' : phase === 'returned' ? 'Result returned' : 'Call recorded';
    row.append(glyph, label, detail);
    var evidence = document.createElement('details'); evidence.className = 'worker-activity-evidence'; evidence.dataset.disclosureKey = 'record-' + message.recordIndex;
    var summary = document.createElement('summary'); summary.textContent = 'Technical details';
    var output = document.createElement('pre'); output.textContent = message.text;
    evidence.append(summary, output); item.append(row, evidence); items.push(item); list.appendChild(item);
  });
  function expand(open) {
    toggle.setAttribute('aria-expanded', String(open));
    items.forEach(function (item, index) { item.hidden = !open && index < items.length - 2; item.inert = item.hidden; });
  }
  toggle.addEventListener('click', function () { expand(toggle.getAttribute('aria-expanded') !== 'true'); });
  expand(false); group.append(toggle, list); body.appendChild(group);
}
export function captureWorkerDisclosures(body) {
  return {
    open: Array.from(body.querySelectorAll('details[open]')).map(function (node) { return node.dataset.disclosureKey; }),
    groups: Array.from(body.querySelectorAll('.worker-activity-summary[aria-expanded="true"]')).map(function (node) { return node.dataset.disclosureKey; }),
    focus: document.activeElement && body.contains(document.activeElement) && (document.activeElement.dataset.disclosureKey || document.activeElement.parentElement && document.activeElement.parentElement.dataset.disclosureKey)
  };
}
export function restoreWorkerDisclosures(body, saved) {
  Array.from(body.querySelectorAll('[data-disclosure-key]')).forEach(function (node) {
    var key = node.dataset.disclosureKey;
    if (saved.groups.indexOf(key) >= 0 && node.getAttribute('aria-expanded') === 'false') node.click();
    if (saved.open.indexOf(key) >= 0) node.open = true;
    if (saved.focus === key) {
      var target = node.tagName === 'DETAILS' ? node.querySelector('summary') : node;
      if (target) target.focus({ preventScroll: true });
    }
  });
}
