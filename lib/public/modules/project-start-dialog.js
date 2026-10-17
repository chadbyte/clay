// project-start-dialog.js - One fixed-size dialog for choosing how to start a project

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { openState, closeState, selectView } from './project-start-state.js';
import { folderViewHtml, bindFolderView, renderFolderView, startFolderBrowse, resetFolderState, handleBrowseDirResult } from './project-start-folder-view.js';
import { formViewHtml, bindFormView, renderFormView } from './project-start-forms.js';
import { submitFolder, handleAddProjectResult, handleCloneProgress } from './project-start-submit.js';

export { handleBrowseDirResult, handleAddProjectResult, handleCloneProgress };

var TITLES = { choices: 'Start a project', open: 'Open a folder', create: 'Create a project', clone: 'Clone a repository' };
var CHOICES = [
  { view: 'open', icon: 'folder-open', title: 'Open an existing folder', text: 'Use a directory on the machine running Clay.' },
  { view: 'create', icon: 'plus', title: 'Create a new project', text: 'Start in a new, empty project directory.' },
  { view: 'clone', icon: 'git-branch', title: 'Clone a repository', text: 'Bring an existing Git repository into Clay.' },
];
var shownGen = -1;
var opener = null;

function modal() { return document.getElementById('project-start-modal'); }
function body() { return document.getElementById('project-start-body'); }
function current() { return store.get('projectStart'); }

function choicesHtml() {
  var html = '<div class="project-start-view" data-view="choices"><div class="project-start-scroll"><ul class="project-start-rows project-start-choices" role="list">';
  for (var i = 0; i < CHOICES.length; i++) {
    var c = CHOICES[i];
    html += '<li><button type="button" class="project-start-row project-start-choice" data-choice="' + c.view + '">' +
      iconHtml(c.icon, 'project-start-choice-icon') + '<span class="project-start-choice-text"><strong>' + c.title + '</strong><span>' + c.text + '</span></span>' +
      iconHtml('chevron-right') + '</button></li>';
  }
  return html + '</ul></div></div>';
}

function focusFirst(view) {
  var target = null;
  if (view === 'choices') target = body().querySelector('[data-choice]');
  else if (view === 'open') target = body().querySelector('[data-ps="list"]');
  else target = body().querySelector('[data-ps="field"]');
  if (!target) target = modal().querySelector('.project-start-dialog');
  target.focus({ preventScroll: true });
}

function renderShell(view) {
  var container = body();
  document.getElementById('project-start-title').textContent = TITLES[view];
  document.getElementById('project-start-back').hidden = view === 'choices';
  document.getElementById('project-start-subtitle').hidden = view !== 'choices';
  if (view === 'choices') container.innerHTML = choicesHtml();
  else if (view === 'open') { container.innerHTML = folderViewHtml(); bindFolderView(submitFolder); }
  else { container.innerHTML = formViewHtml(view); bindFormView(view); }
  refreshIcons();
}

function render(state, previous) {
  var overlay = modal();
  if (!overlay) return;
  if (state.view === null) {
    if (!overlay.classList.contains('hidden')) hide();
    return;
  }
  if (state.gen !== shownGen || previous.view === null) {
    shownGen = state.gen;
    overlay.classList.remove('hidden');
    renderShell(state.view);
    if (state.view === 'open') { resetFolderState(); startFolderBrowse(); }
    if (state.view === 'create' || state.view === 'clone') renderFormView(state.view);
    focusFirst(state.view);
    return;
  }
  if (state.view === 'open') renderFolderView();
  else if (state.view === 'create' || state.view === 'clone') renderFormView(state.view);
}

function hide() {
  modal().classList.add('hidden');
  body().innerHTML = '';
  shownGen = -1;
  resetFolderState();
  var target = opener;
  opener = null;
  if (target && document.contains(target) && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

export function openAddProjectModal(mode) {
  if (current().view === null) opener = document.activeElement;
  store.set({ projectStart: openState(current(), mode) });
}

export function closeAddProjectModal() {
  if (current().view === null) return;
  store.set({ projectStart: closeState(current()) });
}

function trapTab(event, dialog) {
  var items = dialog.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), [tabindex="-1"][data-ps="list"]');
  var focusable = [];
  for (var i = 0; i < items.length; i++) if (items[i].offsetParent !== null && items[i].tabIndex >= 0) focusable.push(items[i]);
  if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
  var first = focusable[0];
  var last = focusable[focusable.length - 1];
  var active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

export function initProjectStart() {
  var overlay = modal();
  var dialog = overlay.querySelector('.project-start-dialog');
  store.subscribe(function (state, previous) {
    if (state.projectStart !== previous.projectStart) render(state.projectStart, previous.projectStart);
    else if (state.projectStartFolder !== previous.projectStartFolder && state.projectStart.view === 'open') renderFolderView();
  });
  overlay.querySelector('.project-start-backdrop').addEventListener('click', closeAddProjectModal);
  document.getElementById('project-start-close').addEventListener('click', closeAddProjectModal);
  document.getElementById('project-start-back').addEventListener('click', function () {
    store.set({ projectStart: selectView(current(), 'choices') });
  });
  body().addEventListener('click', function (event) {
    var choice = event.target.closest('[data-choice]');
    if (choice) store.set({ projectStart: selectView(current(), choice.dataset.choice) });
  });
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); closeAddProjectModal(); }
    else if (event.key === 'Tab') trapTab(event, dialog);
  });
  var addButton = document.getElementById('project-list-add');
  if (addButton) addButton.addEventListener('click', function () { openAddProjectModal(); });
}
