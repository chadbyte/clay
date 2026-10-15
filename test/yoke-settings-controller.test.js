// Exercise the shared production renderer without a provider or browser process.
var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
function element() {
  var item = { children: [], style: {}, dataset: {}, listeners: {}, classList: { add: function() {}, remove: function() {} } };
  item.parentElement = { style: {} };
  item.appendChild = function(child) { item.children.push(child); };
  item.addEventListener = function(name, fn) { item.listeners[name] = fn; };
  item.querySelectorAll = function() { return item.children; };
  Object.defineProperty(item, 'innerHTML', { set: function() { item.children = []; } });
  return item;
}
function runtime() {
  var elements = { 'test-effort-bar': element(), 'test-mode-list': element(), 'test-model-list': element(), 'test-thinking-bar': element() };
  var context = vm.createContext({ document: { getElementById: function(id) { return elements[id]; }, createElement: element } });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/public/modules/settings-defaults.js'), 'utf8').replace(/export /g, ''), context);
  return { api: context, elements: elements };
}
test('shared controls use an independently named provider description and preserve typed messages', function() {
  var r = runtime(), sent = [];
  var opts = { vendor: 'independent-engine', currentModel: 'model-a', models: [{ value: 'model-a', description: 'Provider-authored description', supportedEffortLevels: ['minimal', 'xhigh'] }], effortLevels: ['low'], configuration: { permissionModes: [{ value: 'ask', label: 'Review' }] }, effortMsgType: 'set_effort', modeMsgType: 'set_mode', sendMsg: function(type, value) { sent.push({ type: type, value: value }); } };
  r.api.renderEffortBar('test', opts);
  assert.deepEqual(r.elements['test-effort-bar'].children.map(function(child) { return child.textContent; }), ['Minimal', 'Xhigh']);
  r.elements['test-effort-bar'].children[1].listeners.click();
  assert.equal(sent[0].type, 'set_effort'); assert.equal(sent[0].value.effort, 'xhigh');
  r.api.renderModeList('test', opts);
  assert.equal(r.elements['test-mode-list'].children[0].children[0].textContent, 'Review');
  r.api.renderModelList('test', opts);
  assert.equal(r.elements['test-model-list'].children[0].children[1].textContent, 'Provider-authored description');
});
test('unsupported model or missing descriptions never advertise effort, modes or thinking', function() {
  var r = runtime();
  r.api.renderEffortBar('test', { currentModel: 'plain', models: [{ value: 'plain', supportsEffort: false }], effortLevels: ['high'] });
  assert.equal(r.elements['test-effort-bar'].children.length, 0);
  assert.equal(r.elements['test-effort-bar'].parentElement.style.display, 'none');
  r.api.renderModeList('test', {}); r.api.renderThinkingBar('test', {});
  assert.equal(r.elements['test-mode-list'].parentElement.style.display, 'none');
  assert.equal(r.elements['test-thinking-bar'].parentElement.style.display, 'none');
});
