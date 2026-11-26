import { iconHtml } from './icons.js';
import { getListSearchQuery, getListSearchScopes, setListSearchQuery, toggleListSearchScope } from './session-list-search.js';

var PICKER_ID = 'session-search-scope-picker';
var SCOPES = [
  ['title', 'Title', 'Match session titles'],
  ['chat', 'Messages', 'Match text in session messages'],
  ['pr', 'PR', 'GitHub pull request number, optionally with a repository'],
  ['issue', 'Issue', 'GitHub issue number, optionally with a repository'],
  ['linear', 'Linear', 'Linear issue ID or exact issue number'],
];

function visibleTrigger(surface) {
  var button = document.querySelector('[data-search-scope-trigger="' + surface + '"]');
  return button && button.getClientRects().length ? button : null;
}

function positionPicker(picker, button) {
  var anchor = button.getBoundingClientRect();
  var margin = 8;
  var width = Math.min(picker.dataset.surface === 'mobile' ? 224 : 184, window.innerWidth - 2 * margin);
  picker.style.width = width + 'px';
  var below = window.innerHeight - anchor.bottom - margin - 4;
  var above = anchor.top - margin - 4;
  var openAbove = below < picker.scrollHeight && above > below;
  picker.style.left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)) + 'px';
  picker.style.maxHeight = Math.max(0, openAbove ? above : below) + 'px';
  var top = openAbove ? anchor.top - 4 - picker.offsetHeight : anchor.bottom + 4;
  picker.style.top = Math.max(margin, Math.min(top, window.innerHeight - margin - picker.offsetHeight)) + 'px';
}

function openPicker(trigger, surface) {
  var picker = document.createElement('div');
  picker.id = PICKER_ID;
  picker.dataset.surface = surface;
  picker.className = 'session-search-scope-picker';
  picker.setAttribute('popover', 'manual');
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Search scopes');
  var help = document.createElement('span');
  help.id = PICKER_ID + '-default';
  help.className = 'session-search-scope-default';
  help.textContent = 'Title and Messages are the default. Choose a scope to replace them.';
  picker.appendChild(help);

  var checks = SCOPES.map(function (scope) {
    var row = document.createElement('label');
    row.className = 'session-search-scope-option';
    var check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('aria-description', scope[2] + '.');
    check.addEventListener('change', function () {
      toggleListSearchScope(scope[0]);
      paint();
    });
    row.appendChild(check);
    row.appendChild(document.createTextNode(scope[1]));
    picker.appendChild(row);
    return check;
  });

  var actions = document.createElement('div');
  actions.className = 'session-search-scope-actions';
  function addAction(label, description, scopes) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-folder-tool';
    button.textContent = label;
    button.setAttribute('aria-description', description);
    button.addEventListener('click', function () {
      button.focus({ preventScroll: true });
      setListSearchQuery(getListSearchQuery(), scopes);
      paint();
    });
    actions.appendChild(button);
    return button;
  }
  addAction('Select all', 'Select all search scopes.', SCOPES.map(function (scope) { return scope[0]; }));
  var clear = addAction('Clear all', 'Clear all search scopes and keep the query.', []);
  picker.appendChild(actions);

  function paint() {
    var scopes = getListSearchScopes();
    help.hidden = scopes !== null;
    if (help.hidden) picker.removeAttribute('aria-describedby');
    else picker.setAttribute('aria-describedby', help.id);
    checks.forEach(function (check, index) {
      check.checked = !!scopes && scopes.includes(SCOPES[index][0]);
    });
    syncAnchor();
  }

  function syncAnchor() {
    var button = visibleTrigger(surface);
    if (!button) {
      close(false);
      return;
    }
    trigger = button;
    trigger.setAttribute('aria-expanded', 'true');
    positionPicker(picker, trigger);
  }

  function onOutside(event) {
    if (!picker.contains(event.target) && !trigger.contains(event.target)) close(false);
  }

  function onKey(event) {
    if (event.isComposing || event.keyCode === 229) return;
    var leave = event.key === 'Tab' &&
      (event.shiftKey ? document.activeElement === checks[0] : document.activeElement === clear);
    if (event.key !== 'Escape' && !leave) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }

  function onBlur() { close(false); }

  function close(restoreFocus) {
    observer.disconnect();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', syncAnchor);
    window.removeEventListener('scroll', syncAnchor, true);
    window.removeEventListener('blur', onBlur);
    picker.remove();
    // Escape can arrive before the observer has seen a toolbar replacement.
    var button = visibleTrigger(surface);
    if (!button) return;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus({ preventScroll: true });
  }

  // The list swaps out the toolbar on search results. Re-anchor without moving focus in the picker.
  var observer = new MutationObserver(function () {
    if (!trigger.isConnected) syncAnchor();
  });
  picker.closeScopePicker = close;
  document.body.appendChild(picker);
  picker.showPopover();
  paint();
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', syncAnchor);
  window.addEventListener('scroll', syncAnchor, true);
  window.addEventListener('blur', onBlur);
  checks[0].focus({ preventScroll: true });
}

export function searchScopePickerContains(node) {
  var picker = document.getElementById(PICKER_ID);
  return !!picker && picker.contains(node);
}

export function closeSearchScopePicker(restoreFocus) {
  var picker = document.getElementById(PICKER_ID);
  if (!picker) return false;
  picker.closeScopePicker(restoreFocus);
  return true;
}

export function renderSearchScopeTrigger(surface, scopes, input) {
  var summary = 'Default: Title + Messages';
  if (scopes) {
    if (scopes.length === SCOPES.length) summary = 'All scopes';
    else if (!scopes.length) summary = 'No scopes selected';
    else summary = SCOPES.filter(function (scope) {
      return scopes.includes(scope[0]);
    }).map(function (scope) { return scope[1]; }).join(', ');
  }

  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'session-folder-tool session-search-scope-trigger';
  button.dataset.searchScopeControl = 'trigger';
  button.dataset.searchScopeTrigger = surface;
  button.dataset.tip = 'Search in: ' + summary;
  button.setAttribute('aria-label', button.dataset.tip);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', PICKER_ID);
  button.innerHTML = '<span>Search in</span><span class="session-search-scope-summary"></span>' + iconHtml('chevron-down');
  button.querySelector('.session-search-scope-summary').textContent = summary;
  button.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || input.value || document.activeElement !== input) return;
    // Keep focus within the search while the pointer is held, even on browsers
    // that blur the input without focusing the pressed button.
    event.preventDefault();
    button.focus({ preventScroll: true });
  });
  button.addEventListener('click', function () {
    if (!closeSearchScopePicker(true)) openPicker(button, surface);
  });
  return button;
}
