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
test('Worker session transcript shows every tool record in chronological order', function () {
  var api = fixture(), rows = [row(1, 'tool_start', 'a', 'Read'), row(2, 'tool_start', 'b', 'Bash'), row(3, 'tool_result', 'b'), row(4, 'tool_result', 'a')];
  api.appendWorkerTranscript(api.body, rows);
  var items = api.body.children;
  assert.equal(items.length, 4);
  assert.deepEqual(items.map(function (item) { return item.dataset.recordIndex; }), ['1', '2', '3', '4']);
  assert.ok(items.every(function (item) { return item.className === 'message worker-readonly-message worker-tool-message' && !item.hidden && !item.inert; }));
  assert.equal(items[0].querySelector('summary').textContent, 'Read file · Call recorded');
  assert.equal(items[2].querySelector('summary').textContent, 'Run command · Result returned');
  assert.equal(items[3].querySelector('summary').textContent, 'Read file · Result returned');
  assert.equal(items[0].querySelector('pre').textContent, 'evidence');
  assert.equal(items[0].dataset.phase, 'recorded');
  assert.equal(items[2].dataset.phase, 'returned');
  assert.equal(api.body.querySelectorAll('button').length, 0);
});
test('orphan and ambiguous IDs never mislabel tool results; evidence stays inert text', function () {
  var api = fixture(), rows = [row(1, 'tool_result', 'missing'), row(2, 'tool_start', 'a', 'Read'), row(3, 'tool_start', 'a', 'Bash'), row(4, 'tool_result', 'a', null, '<script>evil()</script>')];
  rows[3].isError = true;
  api.appendWorkerTranscript(api.body, rows);
  assert.equal(api.body.children[0].querySelector('summary').textContent, 'Tool activity · Result returned');
  var item = api.body.children[3];
  assert.equal(item.dataset.phase, 'failed');
  assert.equal(item.querySelector('summary').textContent, 'Tool activity · Failed');
  assert.equal(item.querySelector('pre').textContent, '<script>evil()</script>');
  assert.equal(item.querySelector('pre').innerHTML, undefined);
});
test('prepend and live refresh retain tool disclosure, focus and reconstructed evidence', function () {
  var api = fixture(), latest = row(5, 'tool_result', 'a', null, 'tail'); latest.start = 4; latest.end = 8;
  api.appendWorkerTranscript(api.body, [row(3, 'tool_start', 'b', 'Read'), row(4, 'tool_result', 'b'), latest]);
  var evidence = api.body.children[2].querySelector('details');
  evidence.open = true; evidence.children[0].focus();
  var saved = api.captureWorkerDisclosures(api.body);
  api.body.children = [];
  var prefix = row(5, 'tool_result', 'a', null, 'head'); prefix.end = 4;
  api.appendWorkerTranscript(api.body, [row(1, 'tool_start', 'a', 'Bash'), row(3, 'tool_start', 'b', 'Read'), row(4, 'tool_result', 'b'), prefix, latest]);
  api.restoreWorkerDisclosures(api.body, saved);
  evidence = api.body.children[3].querySelector('details');
  assert.equal(evidence.open, true);
  assert.equal(api.document.activeElement, evidence.children[0]);
  assert.equal(evidence.querySelector('pre').textContent, 'headtail');
  assert.equal(evidence.querySelector('summary').textContent, 'Run command · Result returned');
});
test('empty evidence and malicious tool names never create executable controls', function () {
  var api = fixture(), message = row(9, 'tool_result', 'unknown', '<img src=x onerror=evil()>');
  message.text = ''; message.isError = true;
  api.appendWorkerMessage(api.body, message);
  var details = api.body.children[0].querySelector('details');
  assert.equal(details.dataset.disclosureKey, 'record-9');
  assert.equal(details.querySelector('summary').textContent, '<img src=x onerror=evil()> · Failed');
  assert.equal(details.querySelector('pre').textContent, '');
  assert.equal(api.body.querySelectorAll('input').length, 0);
  assert.equal(api.body.querySelectorAll('script').length, 0);
});
test('prose still uses the shared Markdown parser with the read-only sanitization vocabulary', function () {
  var api = fixture(), options;
  api.renderMarkdown = function (text) { return '<p>' + text + '</p>'; };
  api.DOMPurify = { sanitize: function (html, config) { options = config; return 'sanitized prose'; } };
  api.appendWorkerTranscript(api.body, [{ role: 'user', recordIndex: 0, text: 'Question' }, row(1, 'tool_start', 'a', 'Read'), { role: 'assistant', recordIndex: 2, text: '**Answer**' }]);
  assert.equal(api.body.children.length, 3);
  assert.equal(api.body.children[0].children[1].innerHTML, 'sanitized prose');
  assert.equal(api.body.children[0].children[0].textContent, 'Driver');
  assert.equal(api.body.children[2].children[0].textContent, 'Worker');
  assert.ok(options.ALLOWED_TAGS.includes('a') && options.ALLOWED_TAGS.includes('code'));
  assert.ok(!options.ALLOWED_TAGS.includes('script') && !options.ALLOWED_TAGS.includes('input'));
  assert.equal(options.ALLOW_DATA_ATTR, false);
});
