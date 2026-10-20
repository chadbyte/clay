var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
function element() {
  return { dataset: {}, children: [], listeners: {}, attrs: {}, isConnected: true,
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    appendChild: function (child) { this.children.push(child); },
    addEventListener: function (name, fn) { this.listeners[name] = fn; },
    setAttribute: function (name, value) { this.attrs[name] = value; },
    closest: function () { return this; }, querySelector: function () { return this.children[0]; } };
}
function fixture() {
  var handlers = {}, calls = [], socket = {}, folderState = { folders: [{ id: 'f_first1', name: 'First' }] }, picker;
  var doc = { createElement: element, addEventListener: function (name, fn) { handlers[name] = fn; }, querySelectorAll: function () { return []; } };
  var context = vm.createContext({ document: doc, getWs: function () { return socket; },
    organizePresentationView: function () { calls.push(Array.from(arguments)); return true; },
    currentFolderState: function () { return folderState; }, openFolderPicker: function (options) { picker = options; }, iconHtml: function () { return ''; } });
  var root = path.join(__dirname, '../lib/public/modules');
  vm.runInContext(fs.readFileSync(path.join(root, 'store.js'), 'utf8').replace(/^export \{.*$/gm, ''), context);
  context.createStore({ myUserId: 'alice', currentSlug: 'alpha', connected: true, projectSplitViewSocketGeneration: 1,
    projectSplitViewContextKey: 'ctx', projectSplitViews: [{ id: 'v', revision: 2, name: 'View', folderId: 'f_first1', favorite: false }] });
  function load(name) { vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), context); }
  load('split-view-organization.js');
  return { context: context, doc: doc, store: context.store, handlers: handlers, calls: calls, folderState: folderState,
    picker: function () { return picker; }, load: load, replaceSocket: function () { socket = {}; } };
}
function event(target) { return { target: target, dataTransfer: { setData: function () {} }, prevented: false,
  preventDefault: function () { this.prevented = true; }, stopImmediatePropagation: function () {} }; }
function begin(f) { var heading = element(); f.context.appendViewOrganization(heading, f.store.get('projectSplitViews')[0]); heading.listeners.dragstart(event(heading)); return heading; }

test('native view drops use exact view identity and preserve folder when starring; session drops remain untouched', function () {
  var f = fixture(), target = element(); target.dataset.folderId = 'favorites';
  var ordinary = event(target); f.handlers.drop(ordinary); assert.equal(ordinary.prevented, false);
  begin(f); f.handlers.dragover(event(target)); f.handlers.drop(event(target));
  assert.deepEqual(f.calls[0], ['v', 2, 'f_first1', true]);
  assert.equal(f.store.get('splitViewOrganizationDrag'), null);
  begin(f); target.dataset.folderId = 'unfiled'; f.handlers.drop(event(target));
  assert.deepEqual(f.calls[1], ['v', 2, null, false]);
  begin(f); target.dataset.folderId = 'foreign'; f.handlers.drop(event(target)); assert.equal(f.calls.length, 2);
  begin(f); target.dataset.folderId = 'f_first1'; f.replaceSocket(); f.handlers.drop(event(target)); assert.equal(f.calls.length, 2);
});

test('folder picker and drag receipts reject owner, revision, disconnect and deleted targets', function () {
  var f = fixture(), view = f.store.get('projectSplitViews')[0];
  f.context.organizeViewAction(view, 'folder'); f.store.set({ myUserId: 'bob' }); f.picker().onPick(null); assert.equal(f.calls.length, 0);
  f.store.set({ myUserId: 'alice' }); f.context.organizeViewAction(view, 'folder');
  f.store.set({ projectSplitViews: [Object.assign({}, view, { revision: 3 })] }); f.picker().onPick(null); assert.equal(f.calls.length, 0);
  begin(f); f.store.set({ connected: false }); assert.equal(f.store.get('splitViewOrganizationDrag'), null);
  f.store.set({ connected: true }); begin(f); f.folderState.folders = [];
  var target = element(); target.dataset.folderId = 'f_first1'; f.handlers.drop(event(target)); assert.equal(f.calls.length, 0);
});

test('duplicate folder and Favorite rows share semantic id but only the folder renders member rows', function () {
  var f = fixture(); f.load('split-view-sidebar-renderer.js');
  var view = f.store.get('projectSplitViews')[0], count = 0;
  function renderMember() { count++; return element(); }
  var folder = f.context.renderPresentationSplitViewItem(view, [{ title: 'A' }, { title: 'B' }], renderMember, 'f_first1');
  var favorite = f.context.renderPresentationSplitViewItem(view, [{ title: 'A' }, { title: 'B' }], renderMember, 'favorites');
  assert.equal(count, 2); assert.equal(folder.dataset.splitViewId, favorite.dataset.splitViewId);
  assert.equal(folder.dataset.splitViewProjection, 'f_first1'); assert.equal(favorite.dataset.splitViewProjection, 'favorites');
  assert.equal(folder.children[0].children[1].attrs['aria-pressed'], 'false');
  assert.equal(folder.children[0].draggable, true);
  assert.match(folder.children[0].children[1].className, /session-folder-star-btn.*split-view-group-favorite/);
  assert.equal(folder.dataset.splitViewSurface, 'desktop');
});

test('context action resolves the exact Favorite projection after rerender and refuses stale view revisions', function () {
  var f = fixture(), folder = element(), favorite = element(), replacement = element(), mobile = element(), chosen = [];
  folder.dataset = { splitViewId: 'v', splitViewProjection: 'f_first1' };
  favorite.dataset = { splitViewId: 'v', splitViewProjection: 'favorites' };
  replacement.dataset = Object.assign({}, favorite.dataset, { splitViewSurface: 'desktop' });
  mobile.dataset = Object.assign({}, favorite.dataset, { splitViewSurface: 'mobile' });
  var menu;
  f.doc.querySelectorAll = function () { return [mobile, folder, replacement]; };
  f.doc.body = { appendChild: function (el) { menu = el; } };
  Object.assign(f.context, { closeSessionContextMenu: function () {}, closeFolderMenu: function () {},
    mountSessionContextMenu: function () {}, positionSessionContextMenu: function () {}, refreshIcons: function () {} });
  f.load('split-view-sidebar-menu.js');
  f.context.openSplitViewMenu(favorite, element(), null, function (view, action, root) { chosen.push({ id: view.id, action: action, root: root }); });
  favorite.isConnected = false;
  menu.children[1].listeners.click({ stopPropagation: function () {} });
  assert.equal(chosen[0].root, replacement); assert.equal(chosen[0].action, 'folder');
  f.context.openSplitViewMenu(favorite, element(), null, function () { chosen.push('stale'); });
  f.store.set({ projectSplitViews: [Object.assign({}, f.store.get('projectSplitViews')[0], { revision: 3 })] });
  menu.children[0].listeners.click({ stopPropagation: function () {} }); assert.equal(chosen.length, 1);
});

test('mobile Favorite menu keeps clicked surface across four projections and refuses missing or ambiguous replacements', function () {
  var f = fixture(), roots = [], chosen = [], menu, resolveAnchor;
  ['desktop', 'mobile'].forEach(function (surface) {
    ['f_first1', 'favorites'].forEach(function (projection) {
      var root = element(); root.dataset = { splitViewId: 'v', splitViewSurface: surface, splitViewProjection: projection };
      root.appendChild(element()); roots.push(root);
    });
  });
  var clicked = roots[3];
  f.doc.querySelectorAll = function () { return roots; };
  f.doc.body = { appendChild: function (el) { menu = el; } };
  Object.assign(f.context, { closeSessionContextMenu: function () {}, closeFolderMenu: function () {},
    mountSessionContextMenu: function (_menu, _anchor, _session, options) { resolveAnchor = options.resolveAnchor; },
    positionSessionContextMenu: function () {}, refreshIcons: function () {} });
  f.load('split-view-sidebar-menu.js');
  function open() { f.context.openSplitViewMenu(clicked, clicked.children[0], null, function (_view, action, root) { chosen.push({ action: action, root: root }); }); }
  function rename() { menu.children[2].listeners.click({ stopPropagation: function () {} }); }
  open(); assert.equal(resolveAnchor(), clicked.children[0]); rename(); assert.equal(chosen[0].root, clicked);
  open(); clicked.isConnected = false;
  var replacement = element(); replacement.dataset = Object.assign({}, clicked.dataset); replacement.appendChild(element()); roots.push(replacement);
  assert.equal(resolveAnchor(), replacement.children[0]); rename(); assert.equal(chosen[1].root, replacement);
  open(); replacement.isConnected = false;
  assert.equal(resolveAnchor(), null); rename(); assert.equal(chosen.length, 2, 'must not fall back to desktop Favorite or mobile folder');
  replacement.isConnected = true; var duplicate = element(); duplicate.dataset = Object.assign({}, clicked.dataset); roots.push(duplicate);
  open(); assert.equal(resolveAnchor(), null); rename(); assert.equal(chosen.length, 2, 'ambiguous same-surface replacement must refuse');
  duplicate.isConnected = false; open(); f.store.set({ projectSplitViews: [Object.assign({}, f.store.get('projectSplitViews')[0], { revision: 3 })] });
  assert.equal(resolveAnchor(), null); rename(); assert.equal(chosen.length, 2);
});

test('Escape and native dragend cancel organization drag without a later folder mutation', function () {
  var f = fixture(), heading = begin(f), target = element(); target.dataset.folderId = 'favorites';
  heading.listeners.dragend(); assert.equal(f.store.get('splitViewOrganizationDrag'), null);
  f.handlers.drop(event(target)); assert.equal(f.calls.length, 0);
  begin(f);
  if (f.handlers.keydown) f.handlers.keydown({ key: 'Escape' });
  assert.equal(f.store.get('splitViewOrganizationDrag'), null, 'Escape must clear the source receipt');
  f.handlers.drop(event(target)); assert.equal(f.calls.length, 0);
});
