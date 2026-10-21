var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
async function snapshotModule() {
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/file-history-snapshot.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
test('session history uses recorded Edit excerpts and Write content, never later disk content', async function () {
  var api = await snapshotModule();
  var edit = { source: 'session', toolName: 'Edit', old_string: 'old excerpt', new_string: 'new excerpt', content: 'later disk contents' };
  assert.equal(api.historicalSnapshot(edit, true), 'old excerpt');
  assert.equal(api.historicalSnapshot(edit, false), 'new excerpt');
  assert.match(api.historicalScope(edit), /excerpt/);
  assert.equal(api.historicalSnapshot({ toolName: 'Write', content: 'original write' }, false), 'original write');
  assert.equal(api.historicalSnapshot({ toolName: 'Write', content: 'original write' }, true), undefined);
  assert.equal(api.historicalSnapshot({ toolName: 'Write' }, false), undefined);
  assert.equal(api.historicalSnapshot(Object.assign({}, edit, { beforeContent: 'full before', afterContent: 'full after' }), true), 'full before');
  assert.equal(api.historicalSnapshot(Object.assign({}, edit, { beforeContent: 'full before', afterContent: 'full after' }), false), 'full after');
});
