var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
var path = require('node:path');
function fixture() {
  var context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/split-view-worker-transcript.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), context);
  return context;
}
test('page fragments and streaming deltas form one lossless Markdown message without merging distinct turns', function () {
  var api = fixture();
  var rows = api.workerTranscriptRows([
    { role: 'assistant', recordType: 'delta', recordIndex: 1, start: 0, end: 8, text: '```js\nva' },
    { role: 'assistant', recordType: 'delta', recordIndex: 1, start: 8, end: 13, text: 'r x =' },
    { role: 'assistant', recordType: 'delta', recordIndex: 2, start: 0, end: 7, text: ' 1;\n```' },
    { role: 'assistant', recordType: 'delta', recordIndex: 4, start: 0, end: 4, text: 'Next' },
    { role: 'tool', recordType: 'tool_result', recordIndex: 5, start: 0, end: 4, text: '<b>x' },
    { role: 'tool', recordType: 'tool_result', recordIndex: 5, start: 4, end: 8, text: '</b>' }
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].text, '```js\nvar x = 1;\n```');
  assert.equal(rows[1].text, 'Next'); assert.equal(rows[2].text, '<b>x</b>');
});
