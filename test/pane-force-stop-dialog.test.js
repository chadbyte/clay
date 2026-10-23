var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function fixture() {
  var sent = [], listeners = {}, confirmation, focus = '', ready = true;
  var binding = { sessionId: 2, generation: 1 }, live = binding;
  var frame = { contentDocument: {}, contentWindow: { postMessage: function (message) { sent.push(message); } }, clayPane: { identity: function () { return { binding: live }; } } };
  var button = { setAttribute: function () {}, addEventListener: function (name, fn) { listeners[name] = fn; }, focus: function () { focus = 'force'; } };
  var cancel = { focus: function () { focus = 'cancel'; } }, ok = { focus: function () { focus = 'ok'; } };
  var panel = { setAttribute: function () {}, removeAttribute: function () {} };
  var pane = { isConnected: true, querySelector: function () { return { textContent: 'Driver 0' }; } };
  var context = {
    document: { createElement: function () { return button; }, addEventListener: function () {}, removeEventListener: function () {},
      getElementById: function (id) { return id === 'confirm-cancel' ? cancel : id === 'confirm-ok' ? ok : { querySelector: function () { return panel; } }; } },
    window: { location: { origin: 'http://fixture' }, addEventListener: function () {}, removeEventListener: function () {} }, iconHtml: function (name) { return name; },
    syncPaneHeaderState: function () { return ready; }, samePaneBinding: function (a, b) { return a === b; },
    livePaneBinding: function (target, message) { return ready && (!message || message.paneBinding === live); },
    showConfirm: function (text, confirm, label, destructive, cancelAction) { confirmation = { text: text, confirm: confirm, cancel: cancelAction, label: label }; }, hideConfirm: function () {},
  };
  var source = fs.readFileSync('lib/public/modules/split-pane-force-stop.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  vm.runInNewContext(source + '\ncreatePaneForceStop(pane, frame);', Object.assign(context, { pane: pane, frame: frame }));
  return { sent: sent, pane: pane, frame: frame, click: function () { listeners.click({ stopPropagation: function () {} }); }, confirmation: function () { return confirmation; },
    retarget: function () { live = { sessionId: 3, generation: 2 }; }, disconnect: function () { ready = false; }, focus: function () { return focus; }, button: button };
}

test('pane Force stop opens a custom all-work confirmation without stopping or closing anything', function () {
  var f = fixture(); f.click();
  assert.deepEqual(f.sent, []); assert.equal(f.pane.isConnected, true);
  assert.match(f.confirmation().text, /Driver 0 and all of its Workers/);
  assert.match(f.confirmation().text, /pane and conversation history will stay open/);
  assert.equal(f.confirmation().label, 'Force stop all work'); assert.equal(f.focus(), 'cancel');
  assert.equal(f.button.innerHTML, 'power', 'Force stop uses a different icon from Close pane');
});

test('Cancel sends nothing; confirmation sends exactly one request to the captured pane', function () {
  var f = fixture(); f.click(); f.confirmation().cancel(); f.confirmation().confirm();
  assert.equal(f.sent.length, 0); assert.equal(f.focus(), 'force');
  f.click(); var confirm = f.confirmation().confirm; confirm(); confirm();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].type, 'clay-pane-force-stop'); assert.equal(f.sent[0].paneBinding.sessionId, 2);
  assert.equal(f.pane.isConnected, true);
});

test('a removed, retargeted, reloaded or disconnected pane cannot confirm a stale force stop', function () {
  ['retarget', 'removed', 'reload', 'disconnect'].forEach(function (change) {
    var f = fixture(); f.click();
    if (change === 'retarget') f.retarget();
    if (change === 'removed') f.pane.isConnected = false;
    if (change === 'reload') f.frame.contentDocument = {};
    if (change === 'disconnect') f.disconnect();
    f.confirmation().confirm(); assert.equal(f.sent.length, 0, change);
  });
});


test('disabled Force stop stays visible and cannot open confirmation or send a request', function () {
  var f = fixture(); f.button.disabled = true; f.click();
  assert.equal(f.confirmation(), undefined); assert.deepEqual(f.sent, []);
  assert.equal(f.button.hidden, undefined);
});
test('capability loss after opening the dialog refuses confirmation', function () {
  var f = fixture(); f.click(); f.button.disabled = true;
  f.confirmation().confirm(); assert.deepEqual(f.sent, []);
});

test('production header projection keeps unsupported and unknown controls disabled with the exact explanation', function () {
  var button = { dataset: {}, setAttribute: function (name, value) { this[name] = value; } };
  var header = { dataset: {}, setAttribute: function () {}, querySelectorAll: function () { return [button]; }, querySelector: function () { return button; } };
  var frame = { dataset: { sessionId: '2', sessionOriginId: 'origin' }, clayPane: { identity: function () { return { sessionId: 2, ready: true, binding: { sessionOriginId: 'origin' } }; } } };
  var pane = { dataset: { sessionId: '2' }, querySelector: function (selector) { return selector === '.split-pane-header' ? header : selector === '.split-pane-frame' ? frame : null; } };
  var session = { id: 2 }, context = { store: { get: function () { return true; }, snap: function () { return {}; } },
    getCachedSessions: function () { return [session]; }, paneTarget: function () { return {}; }, samePaneTarget: function () { return true; }, livePaneBinding: function () { return true; } };
  vm.runInNewContext(fs.readFileSync('lib/public/modules/split-pane-header-state.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function'), context);
  context.syncPaneHeaderState(pane);
  assert.equal(button.disabled, true); assert.equal(button.title, 'Force termination is not yet supported for this vendor');
  session.forceTermination = { supported: true }; context.syncPaneHeaderState(pane); assert.equal(button.disabled, false);
  session.forceTermination = { supported: false, reason: 'Force termination is not yet supported for this vendor (owned Worker)' };
  context.syncPaneHeaderState(pane); assert.equal(button.disabled, true); assert.match(button['aria-label'], /owned Worker/);
  assert.notEqual(button.hidden, true);
});
test('production Worker controls expose support loss and unknown support without hiding Force stop', function () {
  var button = { setAttribute: function () {} }, header = { querySelector: function () { return button; } }, context = {};
  vm.runInNewContext(fs.readFileSync('lib/public/modules/worker-stop-controls.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  context.syncWorkerForceStop(header, {}); assert.equal(button.disabled, true);
  assert.equal(button.title, 'Force termination is not yet supported for this vendor');
  context.syncWorkerForceStop(header, { forceTermination: { supported: true } }); assert.equal(button.disabled, false);
  context.syncWorkerForceStop(header, { forceTermination: { supported: false, reason: 'Starting runtime' } });
  assert.equal(button.disabled, true); assert.equal(button.title, 'Starting runtime'); assert.notEqual(button.hidden, true);
});
