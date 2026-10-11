var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

function fixture(reduced) {
  var data = { youActivity: {} };
  var timers = new Map();
  var elements = new Map();
  var counter = 0;
  function node() {
    var classes = new Set();
    return { textContent: '', scrollWidth: 10, classList: {
      add: function (name) { classes.add(name); }, remove: function (name) { classes.delete(name); },
      contains: function (name) { return classes.has(name); }, toggle: function () {},
    }, setAttribute: function () {}, replaceChildren: function () {}, appendChild: function () {}, append: function () {}, addEventListener: function () {}, matches: function () { return false; } };
  }
  function el(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
  var context = {
    store: { get: function (key) { return data[key]; }, set: function (values) { Object.assign(data, values); } },
    document: { getElementById: el, createElement: node },
    window: { matchMedia: function () { return { matches: !!reduced }; } },
    setTimeout: function (fn) { var id = ++counter; timers.set(id, fn); return id; },
    clearTimeout: function (id) { timers.delete(id); }, sendYou: function () { return 'request'; },
    openYou: function () {}, relativeTime: function () { return 'now'; },
  };
  vm.createContext(context);
  var source = fs.readFileSync('lib/public/modules/you-activity.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export function/g, 'function');
  vm.runInContext(source, context);
  return { data: data, el: el, context: context, tick: function () { var first = timers.entries().next().value; assert.ok(first); timers.delete(first[0]); first[1](); }, drain: function () { var count = 0; while (timers.size && count++ < 500) this.tick(); assert.equal(timers.size, 0); } };
}
test('old activity stays silent; a new save types, queues subsequent saves, and restores idle branding', function () {
  var f = fixture(false);
  f.data.youActivity.requestId = 'history';
  f.context.handleYouActivity({ operation: 'you_activity', requestId: 'history', ok: true, result: { items: [], nextOffset: null } });
  assert.equal(f.el('you-activity').classList.contains('announcing'), false);
  var notice = { type: 'you_changed', activity: { id: 'new', summary: 'Prefers concise reviews.' } };
  f.context.handleYouActivity(notice);
  assert.equal(f.el('you-activity').classList.contains('announcing'), true);
  assert.equal(f.el('you-activity-text').textContent, 'Cl');
  f.context.handleYouActivity(notice);
  assert.equal((f.data.youActivity.queue || []).length, 0, 'duplicate notifications are silent');
  f.context.handleYouActivity({ type: 'you_changed', activity: { id: 'next', summary: 'Another preference.' } });
  assert.equal(f.data.youActivity.queue.length, 1);
  f.drain();
  assert.equal(f.el('you-activity').classList.contains('announcing'), false);
  assert.equal(f.el('you-activity-text').textContent, 'Clay remembered: Another preference.');
});
test('reduced motion presents the complete announcement immediately', function () {
  var f = fixture(true);
  f.context.handleYouActivity({ type: 'you_changed', activity: { id: 'new', summary: 'Prefers concise reviews.' } });
  assert.equal(f.el('you-activity-text').textContent, 'Clay remembered: Prefers concise reviews.');
  f.drain();
  assert.equal(f.data.youActivity.active, false);
});
