var test = require('node:test'), assert = require('node:assert/strict');
var transport = require('../lib/pane-session-transport');
function identity(id) { return { requestId: 'request-' + id, generation: id, projectSlug: 'reuse', viewerId: 'owner', ownerId: 'owner', sessionId: id, sessionOriginId: 'origin-' + id, role: 'driver', workerGeneration: null, groupStamp: null, parentSessionOriginId: null }; }
test('asynchronous replies retain their original request while live events follow their explicit source session', async function () {
  var a = identity(1), b = identity(2), release;
  var ws = { _clayPaneActivation: a, _clayPaneActivationValid: function () { return true; } };
  var gate = new Promise(function (resolve) { release = resolve; });
  var work = transport.run(ws, { type: 'request_models', paneBinding: a }, async function () {
    assert.equal(transport.outbound(ws, { type: 'model_info' }).paneActivation, a);
    await gate;
    assert.equal(transport.outbound(ws, { type: 'model_info', model: 'obsolete' }), null);
    assert.equal(transport.outbound(ws, { type: 'delta' }, 1), null);
    assert.equal(transport.outbound(ws, { type: 'delta' }, 2).paneActivation, b);
  });
  ws._clayPaneActivation = b; release(); await work;
});
test('stale Stop/review and uncorrelated pane switches cannot enter the authoritative dispatcher', function () {
  var a = identity(1), b = identity(2), calls = [];
  var ws = { _clayPaneActivation: b, _clayPaneActivationValid: function () { return true; } };
  function dispatch(socket, msg) { calls.push(msg); }
  ['stop', 'permission_response', 'ask_user_response', 'elicitation_response'].forEach(function (type) {
    transport.run(ws, { type: type, paneBinding: a }, dispatch);
    transport.run(ws, { type: type }, dispatch);
  });
  transport.run(ws, { type: 'switch_session', id: 1 }, dispatch);
  assert.equal(calls.length, 0);
  transport.run(ws, { type: 'stop', paneBinding: b }, dispatch);
  assert.equal(calls.length, 1);
  ws._clayPaneActivationValid = function () { return false; };
  transport.run(ws, { type: 'stop', paneBinding: b }, dispatch);
  assert.equal(calls.length, 1);
  ws._clayPaneActivation = null;
  transport.run(ws, { type: 'stop', paneBinding: b }, dispatch);
  assert.equal(calls.length, 1);
});
