// Isolated fixture only: exercises existing UI actions against the production service.
import { store } from '/p/reuse/modules/store.js';
import { currentFolderState } from '/p/reuse/modules/session-folders.js';
function assert(value, message) { if (!value) throw new Error(message); }
function waitFor(check, label) {
  var started = performance.now();
  return new Promise(function (resolve, reject) {
    function inspect() {
      try { if (check()) { resolve(); return; } } catch (error) { reject(error); return; }
      if (performance.now() - started > 20000) { reject(new Error('Timed out: ' + label)); return; }
      setTimeout(inspect, 40);
    }
    inspect();
  });
}
function rootFor(id, projection) {
  return Array.from(document.querySelectorAll('.split-view-group[data-split-view-id]')).find(function (root) {
    return root.dataset.splitViewId === id && root.dataset.splitViewProjection === projection;
  });
}
function viewFor(id) { return (store.get('projectSplitViews') || []).find(function (view) { return view.id === id; }); }
function geometry(view) { return JSON.stringify({ tree: view.tree, layout: view.layout, sessions: view.sessions, active: view.activeSessionOriginId }); }
async function createFolder(name) {
  document.querySelector('[data-new-folder-button="desktop"]').click();
  await waitFor(function () { return document.querySelector('.session-folder-create-input'); }, 'folder input');
  var input = document.querySelector('.session-folder-create-input'); input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor(function () { return currentFolderState().folders.some(function (folder) { return folder.name === name; }); }, 'persist folder');
  return currentFolderState().folders.find(function (folder) { return folder.name === name; }).id;
}
function dropView(id, projection, folderId) {
  var source = rootFor(id, projection).querySelector('.split-view-group-heading');
  var target = document.querySelector('.session-folder[data-folder-id="' + folderId + '"]');
  assert(target, 'Folder target missing: ' + folderId);
  source.scrollIntoView({ block: 'nearest' });
  var transfer = new DataTransfer();
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
}
async function moveThroughMenu(id, projection, label) {
  rootFor(id, projection).querySelector('.split-view-group-more').click();
  document.querySelector('.split-view-menu [data-split-view-action="folder"]').click();
  var choice = Array.from(document.querySelectorAll('.session-folder-choice')).find(function (row) { return row.textContent.trim() === label; });
  assert(choice, 'Folder picker choice missing: ' + label); choice.click();
}
window.runSplitViewOrganizationChecks = async function () {
  var result = { checks: [], errors: [] }; button.disabled = true;
  try {
    await waitFor(function () { return store.get('connected') && store.get('projectSplitViewHydrated') && !store.get('projectSplitViewPending'); }, 'connected saved views');
    var view = (store.get('projectSplitViews') || [])[0];
    if (!view) {
      await waitFor(function () { return document.querySelector('#split-host > .split-pane:not([hidden]) .split-view-arrange-trigger'); }, 'singleton pane Arrange');
      document.querySelector('#split-host > .split-pane:not([hidden]) .split-view-arrange-trigger').click();
      var menu = document.getElementById('split-view-create-menu');
      var choices = Array.from(menu.querySelectorAll('[data-create-session-origin]'));
      for (var i = 0; i < choices.length && (store.get('projectSplitViewCreateSelection') || []).length < 2; i++) {
        if (!choices[i].disabled && choices[i].getAttribute('aria-pressed') !== 'true') choices[i].click();
      }
      menu.querySelector('[data-create-split-view]').click();
      await waitFor(function () { return (store.get('projectSplitViews') || []).length && !store.get('projectSplitViewPending'); }, 'create saved view');
      view = store.get('projectSplitViews')[0];
    }
    var id = view.id, original = geometry(view), suffix = Date.now().toString(36);
    var firstName = 'View First ' + suffix, secondName = 'View Second ' + suffix;
    var first = await createFolder(firstName), second = await createFolder(secondName);
    var membersBefore = JSON.stringify({ assignments: currentFolderState().assignments, favorites: currentFolderState().favorites });
    var projection = view.folderId || 'unfiled';
    dropView(id, projection, first);
    await waitFor(function () { return viewFor(id).folderId === first && rootFor(id, first) && !store.get('projectSplitViewPending'); }, 'view folder drop');
    result.checks.push('Native group drag moves the exact saved view to a folder');
    if (viewFor(id).favorite) {
      rootFor(id, first).querySelector('.split-view-star').click();
      await waitFor(function () { return !viewFor(id).favorite && !store.get('projectSplitViewPending'); }, 'clear existing favorite');
    }
    dropView(id, first, 'favorites');
    await waitFor(function () { return viewFor(id).favorite && rootFor(id, 'favorites') && !store.get('projectSplitViewPending'); }, 'favorite drop');
    assert(rootFor(id, 'favorites').querySelectorAll('.session-item').length === 0, 'Favorites duplicated member session rows');
    assert(rootFor(id, first).querySelectorAll('.session-item').length === viewFor(id).sessions.length, 'Folder lost member rows');
    result.checks.push('Favorites drop keeps the actual folder and renders one whole-view shortcut');
    await moveThroughMenu(id, 'favorites', secondName);
    await waitFor(function () { return viewFor(id).folderId === second && rootFor(id, second) && !store.get('projectSplitViewPending'); }, 'Favorite menu move');
    assert(viewFor(id).favorite && rootFor(id, 'favorites'), 'Move removed Favorite projection');
    result.checks.push('Favorite context menu moves the same view to a second folder');
    rootFor(id, 'favorites').querySelector('.split-view-group-open').click();
    await waitFor(function () { return store.get('projectSplitViewActiveId') === id && document.querySelectorAll('#split-host > .split-pane').length === viewFor(id).sessions.length; }, 'whole view open');
    assert(geometry(viewFor(id)) === original, 'Organization changed saved geometry, membership or active pane');
    result.checks.push('Opening Favorite restores whole saved view without rewriting geometry');
    rootFor(id, second).querySelector('.split-view-star').click();
    await waitFor(function () { return !viewFor(id).favorite && !rootFor(id, 'favorites') && !store.get('projectSplitViewPending'); }, 'inline unstar');
    await moveThroughMenu(id, second, 'Unfiled');
    await waitFor(function () { return viewFor(id).folderId === null && rootFor(id, 'unfiled') && !store.get('projectSplitViewPending'); }, 'Unfiled menu move');
    assert(JSON.stringify({ assignments: currentFolderState().assignments, favorites: currentFolderState().favorites }) === membersBefore, 'View organization modified member metadata');
    result.checks.push('Inline star and Unfiled picker preserve independent member metadata');
  } catch (error) { result.errors.push(error.stack || String(error)); }
  window.splitViewOrganizationCheckResult = result; output.textContent = JSON.stringify(result, null, 2); button.disabled = false; return result;
};
var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Run Split view folder/Favorites checks';
var output = document.createElement('pre'); output.setAttribute('role', 'status');
button.addEventListener('click', function () { window.runSplitViewOrganizationChecks(); });
// Reuse the fixture panel; no new overlay can obscure sidebar drop targets.
var panel = document.querySelector('aside[aria-label="Split view production fixture"]');
if (panel) panel.append(button, output);
