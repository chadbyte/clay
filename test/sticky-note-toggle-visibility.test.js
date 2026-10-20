var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

var root = path.join(__dirname, '..');
var canvasSource = fs.readFileSync(path.join(root, 'lib/public/modules/sticky-notes.js'), 'utf8');
var sharedSource = fs.readFileSync(path.join(root, 'lib/public/modules/sticky-notes-shared.js'), 'utf8');

function createHarness() {
  var button = { hidden: true, title: '', attributes: {}, setAttribute: function (name, value) { this.attributes[name] = String(value); }, querySelector: function () { return badge; } };
  var badge = { textContent: '', classes: new Set(['hidden']), classList: {
    add: function (name) { badge.classes.add(name); },
    remove: function (name) { badge.classes.delete(name); },
    toggle: function (name, value) { if (value) badge.classes.add(name); else badge.classes.delete(name); },
  } };
  var container = { children: [], classList: { toggle: function () {} }, appendChild: function (el) {
    if (el.parentNode) el.parentNode.removeChild(el);
    this.children.push(el); el.parentNode = this;
  }, removeChild: function (el) { this.children.splice(this.children.indexOf(el), 1); el.parentNode = null; } };
  var state = { notesTemporarilyHidden: false };
  var context = vm.createContext({
    Map: Map,
    Object: Object,
    document: {
      activeElement: null,
      querySelectorAll: function (selector) { return selector === '#sticky-notes-toggle-btn' ? [button] : []; },
      querySelector: function (selector) { return selector === '.sticky-notes-count' ? badge : null; },
      getElementById: function (id) { return id === 'sticky-notes-container' ? container : null; },
    },
    store: { get: function (key) { return state[key]; }, set: function (update) { Object.assign(state, update); } },
    refreshIcons: function () {},
    closeColorPicker: function () {},
    closeFormatToolbar: function () {},
    isFormatToolbarOpen: function () { return false; },
    notes: new Map(),
    notesVisible: false,
    notesSuppressed: false,
    notesResizeObserver: null,
    renderNote: function (data) {
      return { data: data, parentNode: null, classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
        style: { setProperty: function () {} }, setAttribute: function () {}, remove: function () { if (this.parentNode) this.parentNode.removeChild(this); } };
    },
    syncFlightState: function () {},
    patchNote: function (entry, next) { entry.data = next; return false; },
    clearNoteTimers: function () {},
    deleteNoteUiState: function () {},
    updateSidebarBadge: function () {},
    refreshBrowser: function () {},
    applyCanvasVisibility: function () {},
    reclampAllNotes: function () {},
    send: function () {},
  });
  var closedStart = sharedSource.indexOf('export function isClosedNote(');
  var closedEnd = sharedSource.indexOf('\n}', closedStart) + 2;
  var ranges = [
    [canvasSource.indexOf('function openCount()'), canvasSource.indexOf('function syncToggleAvailability()')],
    [canvasSource.indexOf('function syncToggleAvailability()'), canvasSource.indexOf('// The browser pane registers here')],
    [canvasSource.indexOf('function syncFlightControls()'), canvasSource.indexOf('export function toggleNotesTemporaryVisibility()')],
    [canvasSource.indexOf('function updateBadge()'), canvasSource.indexOf('// --- WS message handlers ---')],
    [canvasSource.indexOf('export function handleNotesList('), canvasSource.indexOf('export function handleNoteCreated(')],
    [canvasSource.indexOf('export function handleNoteCreated('), canvasSource.indexOf('// Canonical content reconciles')],
    [canvasSource.indexOf('export function handleNoteUpdated('), canvasSource.indexOf('export function handleNoteUpdateResult(')],
    [canvasSource.indexOf('export function handleNoteDeleted('), canvasSource.indexOf('// --- Sidebar badge ---')],
    [canvasSource.indexOf('export function resetStickyNotes()'), canvasSource.indexOf('store.subscribe(function (next, previous)')],
    [canvasSource.indexOf('export function toggleNotesTemporaryVisibility()'), canvasSource.indexOf('// Read-only view of every note')],
  ];
  var source = sharedSource.slice(closedStart, closedEnd).replace('export function', 'function') + '\n';
  ranges.forEach(function (range) { source += canvasSource.slice(range[0], range[1]).replace(/export function/g, 'function') + '\n'; });
  source += '\nexports.refresh = updateBadge; exports.list = handleNotesList; exports.create = handleNoteCreated; exports.update = handleNoteUpdated; exports.remove = handleNoteDeleted; exports.reset = resetStickyNotes; exports.toggle = toggleNotesTemporaryVisibility; exports.button = null;';
  context.exports = {};
  vm.runInContext(source, context);
  context.exports.button = button;
  return { api: context.exports, button: button, badge: badge, state: state, container: container };
}

test('sticky toggle availability follows open-note lifecycle and ignores temporary hiding', function () {
  var fixture = createHarness();
  fixture.api.refresh();
  assert.equal(fixture.button.hidden, true, 'zero open notes hides the toolbar control');

  fixture.api.list({ notes: [{ id: 'n1', state: 'open' }] });
  assert.equal(fixture.button.hidden, false, 'an authoritative open note reveals the control');
  assert.equal(fixture.badge.classes.has('hidden'), true, 'visible notes need no count badge');
  fixture.api.toggle();
  assert.equal(fixture.state.notesTemporarilyHidden, true);
  assert.equal(fixture.button.hidden, false, 'temporarily hidden open notes keep Show reachable');
  assert.equal(fixture.button.attributes['aria-pressed'], 'true');
  assert.equal(fixture.badge.textContent, '1');
  assert.equal(fixture.badge.classes.has('hidden'), false, 'hidden notes display their count');

  fixture.api.update({ note: { id: 'n1', state: 'closed' } });
  assert.equal(fixture.button.hidden, true, 'closed notes do not count');
  fixture.api.update({ note: { id: 'n1', state: 'open' } });
  assert.equal(fixture.button.hidden, false, 'reopening a note reveals the control again');

  fixture.api.create({ note: { id: 'n2', state: 'open' } });
  assert.equal(fixture.button.hidden, false, 'note creation updates availability');
  assert.equal(fixture.badge.textContent, '2', 'live creation updates the hidden-note count');
  fixture.api.remove({ id: 'n1' });
  assert.equal(fixture.button.hidden, false, 'one remaining open note keeps it visible');
  assert.equal(fixture.badge.textContent, '1');
  fixture.api.toggle();
  assert.equal(fixture.badge.classes.has('hidden'), true, 'showing notes clears the badge');
  fixture.api.reset();
  assert.equal(fixture.button.hidden, true, 'project reset returns to the empty state');
});

test('initial markup is hidden and the toggle keeps its sticky-note glyph in both states', function () {
  var html = fs.readFileSync(path.join(root, 'lib/public/index.html'), 'utf8');
  assert.match(html, /id="sticky-notes-toggle-btn"[^>]*\shidden(?:\s|>)/);
  assert.match(html, /id="sticky-notes-toggle-btn"[^>]*><i data-lucide="sticky-note"><\/i>/);
  assert.match(canvasSource, /function initStickyNotes\(\)\s*\{\s*syncToggleAvailability\(\);/);
  assert.match(canvasSource, /function updateBadge\(\)\s*\{\s*syncToggleAvailability\(\);/);
  assert.doesNotMatch(canvasSource, /data-lucide", hidden \? "eye" : "eye-off"/);
});
