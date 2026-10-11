var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

test('only a visible, open, rendered memory is acknowledged; stale count replies cannot restore a badge', function () {
  var data = { you: {}, youSequence: 0 };
  var sent = [];
  var elements = {};
  function element(id) { if (!elements[id]) elements[id] = { setAttribute: function () {} }; return elements[id]; }
  var context = {
    store: { get: function (key) { return data[key]; }, set: function (values) { Object.assign(data, values); } },
    getWs: function () { return { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } }; },
    document: { visibilityState: 'visible', getElementById: element },
  };
  vm.createContext(context);
  var source = fs.readFileSync('lib/public/modules/you.js','utf8').replace(/^import .*;\n/gm,'').replace(/export function/g,'function');
  vm.runInContext(source,context);
  data.you = { open: true, selected: null, renderedRef: 'you:a', renderedRevision: 1 };
  context.acknowledgeVisible(); assert.equal(sent.length,0,'list views do not acknowledge');
  data.you.selected = 'you:a'; context.document.visibilityState = 'hidden';
  context.acknowledgeVisible(); assert.equal(sent.length,0,'background tabs do not acknowledge');
  context.document.visibilityState = 'visible'; data.you.open = false;
  context.acknowledgeVisible(); assert.equal(sent.length,0,'closed panels do not acknowledge');
  data.you.open = true; context.acknowledgeVisible();
  assert.equal(sent[0].type,'you_seen'); assert.equal(sent[0].revision,1);
  context.acknowledgeVisible(); assert.equal(sent.length,1,'one in-flight acknowledgement');
  context.showAttention({unread:0,version:5});
  context.showAttention({unread:1,version:4});
  assert.equal(element('me-unread-badge').hidden,true);
});
