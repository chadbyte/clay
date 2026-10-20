var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var document = { activeElement: null };
  function element(tag) {
    var node = { tagName: tag.toUpperCase(), dataset: {}, children: [], attrs: {}, hidden: false,
      setAttribute: function (key, value) { this.attrs[key] = value; }, getAttribute: function (key) { return this.attrs[key]; },
      appendChild: function (child) { this.children.push(child); child.parentElement = this; return child; },
      append: function () { Array.from(arguments).forEach(function (child) { node.appendChild(child); }); },
      addEventListener: function (type, fn) { this[type] = fn; }, focus: function () { document.activeElement = this; },
      contains: function (child) { return child === this || this.children.some(function (entry) { return entry.contains(child); }); },
      querySelectorAll: function (selector) {
        var all = []; this.children.forEach(function (child) { all.push(child); all = all.concat(child.querySelectorAll('*')); });
        return all.filter(function (child) {
          if (selector === '*') return true;
          if (selector === '[data-disclosure-key]') return !!child.dataset.disclosureKey;
          if (selector === 'details[open]') return child.tagName === 'DETAILS' && child.open;
          if (selector.indexOf('aria-expanded') >= 0) return child.className === 'worker-activity-summary' && child.attrs['aria-expanded'] === 'true';
          return child.tagName === selector.toUpperCase();
        });
      }, querySelector: function (selector) { return this.querySelectorAll(selector)[0] || null; } };
    return node;
  }
  document.createElement = element;
  var api = vm.createContext({ document: document });
  ['clay-tool-presentation', 'split-view-worker-activity', 'split-view-worker-transcript'].forEach(function (file) {
    vm.runInContext(fs.readFileSync('lib/public/modules/' + file + '.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), api);
  });
  api.body = element('div'); return api;
}
function row(index, type, id, name, text) { return { role: 'tool', recordIndex: index, recordType: type, toolId: id, toolName: name, text: text || 'evidence', start: 0, end: 8 }; }
test('parallel calls correlate only exact IDs, retain chronology, and expose latest two recorded steps', function () {
  var api = fixture(), rows = [row(1, 'tool_start', 'a', 'Read'), row(2, 'tool_start', 'b', 'Bash'), row(3, 'tool_result', 'b'), row(4, 'tool_result', 'a')];
  api.appendWorkerTranscript(api.body, rows);
  var group = api.body.children[0], toggle = group.children[0], items = group.children[1].children;
  assert.equal(toggle.children[1].textContent, 'Activity · 4 recorded steps');
  assert.equal(toggle.children[0].getAttribute('data-lucide'), 'activity');
  assert.equal(toggle.children[2].getAttribute('data-lucide'), 'chevron-down');
  assert.equal(toggle.children[2].className, 'worker-activity-chevron');
  assert.equal(toggle.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(toggle.children[2].getAttribute('aria-hidden'), 'true');
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(items.map(function (item) { return item.hidden; }), [true, true, false, false]);
  assert.equal(items[0].inert, true); assert.equal(items[0].dataset.phase, 'recorded');
  assert.equal(items[2].children[0].children[1].textContent, 'Run command');
  assert.equal(items[3].children[0].children[1].textContent, 'Read file');
  toggle.click(); assert.ok(items.every(function (item) { return !item.hidden && !item.inert; }));
});
test('orphan, ambiguous IDs, errors and malicious names remain truthful inert text', function () {
  var api = fixture(), rows = [row(1, 'tool_result', 'missing'), row(2, 'tool_start', 'a', 'Read'), row(3, 'tool_start', 'a', 'Bash'), row(4, 'tool_result', 'a', null, '<script>evil()</script>')];
  rows[3].isError = true;
  var names = api.workerActivityNames(rows);
  assert.equal(api.workerActivityLabel(rows[0], names), 'Tool activity'); assert.equal(api.workerActivityLabel(rows[3], names), 'Tool activity');
  api.appendWorkerTranscript(api.body, rows);
  var item = api.body.children[0].children[1].children[3];
  assert.equal(item.dataset.phase, 'failed'); assert.equal(item.children[1].children[1].textContent, '<script>evil()</script>');
  assert.equal(item.children[1].children[1].innerHTML, undefined);
  assert.equal(api.workerActivityLabel(row(8, 'tool_start', 'c', 'search_logs'), {}), 'Log search');
});
test('prepend and fragment merging preserve group/evidence expansion and focused summary', function () {
  var api = fixture(), latest = row(5, 'tool_result', 'a', null, 'tail'); latest.start = 4; latest.end = 8;
  api.appendWorkerTranscript(api.body, [row(3, 'tool_start', 'b', 'Read'), row(4, 'tool_result', 'b'), latest]);
  var group = api.body.children[0]; group.children[0].click();
  var evidence = group.children[1].children[2].children[1]; evidence.open = true; evidence.children[0].focus();
  var saved = api.captureWorkerDisclosures(api.body);
  api.body.children = [];
  var prefix = row(5, 'tool_result', 'a', null, 'head'); prefix.end = 4;
  api.appendWorkerTranscript(api.body, [row(1, 'tool_start', 'a', 'Bash'), row(3, 'tool_start', 'b', 'Read'), row(4, 'tool_result', 'b'), prefix, latest]);
  api.restoreWorkerDisclosures(api.body, saved);
  group = api.body.children[0]; evidence = group.children[1].children[3].children[1];
  assert.equal(group.children[0].getAttribute('aria-expanded'), 'true'); assert.equal(evidence.open, true);
  assert.equal(api.document.activeElement, evidence.children[0]); assert.equal(evidence.children[1].textContent, 'headtail');
  assert.equal(group.children[1].children[3].children[0].children[1].textContent, 'Run command');
});

test('empty/error evidence and unknown malicious names have no executable DOM', function () {
  var api = fixture(), message = row(9, 'tool_result', 'unknown', '<img src=x onerror=evil()>', '');
  message.text = ''; message.isError = true;
  api.appendWorkerMessage(api.body, message);
  var toggle = api.body.children[0].children[0];
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.children[1].textContent, 'Activity · 1 recorded step');
  assert.equal(toggle.dataset.disclosureKey, 'activity-9');
  var item = api.body.children[0].children[1].children[0];
  assert.equal(item.children[0].children[1].textContent, '<img src=x onerror=evil()>');
  assert.equal(item.children[1].children[0].textContent, 'Technical details');
  assert.equal(item.children[1].children[1].textContent, '');
  assert.equal(api.body.querySelectorAll('input').length, 0); assert.equal(api.body.querySelectorAll('script').length, 0);
});
test('prose still uses the shared Markdown parser with the read-only sanitization vocabulary', function () {
  var api = fixture(), options;
  api.renderMarkdown = function (text) { return '<p>' + text + '</p>'; };
  api.DOMPurify = { sanitize: function (html, config) { options = config; return 'sanitized prose'; } };
  api.appendWorkerTranscript(api.body, [{ role: 'user', recordIndex: 0, text: 'Question' }, row(1, 'tool_start', 'a', 'Read'), { role: 'assistant', recordIndex: 2, text: '**Answer**' }]);
  assert.equal(api.body.children.length, 3);
  assert.equal(api.body.children[0].children[1].innerHTML, 'sanitized prose');
  assert.ok(options.ALLOWED_TAGS.includes('a') && options.ALLOWED_TAGS.includes('code'));
  assert.ok(!options.ALLOWED_TAGS.includes('script') && !options.ALLOWED_TAGS.includes('input'));
  assert.equal(options.ALLOW_DATA_ATTR, false);
});
