var test = require('node:test'), assert = require('node:assert/strict');
var create = require('../lib/session-list-delivery').createSessionListDelivery;
test('session-list delivery cache is bounded, per socket, and only records successful deliveries', function () {
  var deliver = create(), sent = [], fail = false;
  var ws = { readyState: 1, send: function (raw) { if (fail) throw new Error('failed'); sent.push(raw); } };
  var msg = { type: 'session_list', sessions: [] };
  assert.equal(deliver(ws, msg, true), true);
  assert.equal(deliver(ws, msg, true), false);
  assert.equal(deliver(ws, msg, false), true);
  ws.readyState = 3; assert.equal(deliver(ws, msg, true), false);
  ws.readyState = 1; assert.equal(deliver(ws, msg, true), true);
  var changed = { type: 'session_list', sessions: [{ id: 1 }] };
  fail = true; assert.throws(function () { deliver(ws, changed, true); });
  fail = false; assert.equal(deliver(ws, changed, true), true);
  var large = { type: 'session_list', text: 'x'.repeat(1024 * 1024) };
  assert.equal(deliver(ws, large, true), true); assert.equal(deliver(ws, large, true), true);
  var other = { readyState: 1, send: ws.send };
  assert.equal(deliver(other, changed, true), true);
});
