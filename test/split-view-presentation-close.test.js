var test = require('node:test');
var assert = require('node:assert/strict');
var vm = require('node:vm');
var fs = require('node:fs');
var path = require('node:path');
function fixture() {
  var state = { currentSlug: 'proj', myUserId: 'owner', projectSplitViewActiveId: 'view', projectSplitViewRevision: 8,
    projectSplitViews: [{ id: 'view', sessions: [{ id: 2, sessionOriginId: 'origin-2' }, { id: 3, sessionOriginId: 'origin-3' }] }] };
  var binding = { sessionOriginId: 'origin-2', generation: 7 }, events = [], listeners = [];
  var live = { ready: true, sessionId: 2, projectSlug: 'proj', ownerId: 'owner', binding: binding };
  var button = { dataset: {}, addEventListener: function (type, fn, capture) { listeners.push({ fn: fn, capture: capture }); } };
  var frame = { dataset: { sessionId: '2', sessionOriginId: 'origin-2' }, clayPane: { identity: function () { return live; } }, closest: function () { return pane; } };
  var pane = { isConnected: true, hidden: false, querySelector: function (selector) { return selector === '.split-pane-frame' ? frame : button; } };
  var context = vm.createContext({ store: { snap: function () { return state; }, get: function (key) { return state[key]; } },
    livePaneBinding: function () { return true; }, samePaneBinding: function (a, b) { return JSON.stringify(a) === JSON.stringify(b); },
    document: { dispatchEvent: function (event) { events.push(event); } }, CustomEvent: function (name, options) { this.type = name; this.detail = options.detail; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/split-view-presentation-close.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), context);
  return { api: context, pane: pane, frame: frame, state: state, live: live, listeners: listeners, events: events };
}
test('presentation close takes target capture ownership on reused legacy panes and binds exact live source', function () {
  var f = fixture(), stopped = 0;
  assert.equal(f.api.validPresentationClose({}), false);
  f.api.bindPresentationClose(f.pane); f.api.bindPresentationClose(f.pane);
  assert.equal(f.listeners.length, 1); assert.equal(f.listeners[0].capture, true);
  f.listeners[0].fn({ preventDefault: function () {}, stopImmediatePropagation: function () { stopped++; } });
  assert.equal(stopped, 1); assert.equal(f.events.length, 1);
  assert.equal(f.api.validPresentationClose(f.events[0].detail), true);
  f.state.projectSplitViewRevision++;
  assert.equal(f.api.validPresentationClose(f.events[0].detail), false);
  f.state.projectSplitViewRevision--; f.live.binding = { sessionOriginId: 'origin-2', generation: 8 };
  assert.equal(f.api.validPresentationClose(f.events[0].detail), false);
  f.frame.dataset.requestedSessionId = '3'; assert.equal(f.api.presentationCloseTarget(f.pane), null);
  delete f.frame.dataset.requestedSessionId; f.pane.hidden = true; assert.equal(f.api.presentationCloseTarget(f.pane), null);
  f.pane.hidden = false; f.live.ownerId = 'foreign'; assert.equal(f.api.presentationCloseTarget(f.pane), null);
});
