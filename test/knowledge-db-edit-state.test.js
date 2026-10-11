var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var url = require('node:url');

async function helpers() {
  var file = url.pathToFileURL(path.join(__dirname, '../lib/public/modules/knowledge-db-edit-state.js')).href;
  return import(file + '?test=' + Date.now());
}

test('record attempts stay immutable for every unresolved successful send', async function () {
  var state = await helpers();
  var edit = { creating: false, recordId: 'rec_12345678', baseVersion: 1, operationId: 'op_pending', version: 1, attempt: null, saving: false, retryPending: false };
  var first = state.buildRecordAttempt(edit, 'db_12345678', 3, { fld_title001: 'First' });
  edit = Object.assign({}, edit, { attempt: first, saving: true, version: 2 });
  var retry = state.buildRecordAttempt(edit, 'db_12345678', 3, { fld_title001: 'Later' });
  assert.equal(retry, first);
  assert.deepEqual(retry.payload.values, { fld_title001: 'First' });
});
