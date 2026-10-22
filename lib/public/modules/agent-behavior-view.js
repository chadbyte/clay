// agent-behavior-view.js - DOM for the Personal "Agent behavior" page. Built
// from the server catalog; later store changes update the existing nodes in
// place so focus, scroll position and the live status regions are stable.
import { store } from './store.js';
import {
  getAgentBehavior, loadAgentBehavior, chooseValue, retryValue, displayedValue, statusFor, checkboxStatus
} from './agent-behavior.js';
import { attachSectionNav } from './agent-behavior-nav.js';
import { setPageSubnav } from './settings-shell-view.js';

var NOTE = 'Choices apply to your own Driver conversations and take effect from your next message in each conversation.';
var host = null; var unsubscribe = null; var built = null; var nav = null;

function make(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }

function statusBox(id) {
  var box = make('div', 'ab-status'); box.dataset.status = id;
  box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
  return box;
}

function buildMode(setting, state) {
  var id = setting.id;
  var wrap = make('div', 'ab-setting'); wrap.dataset.setting = id;
  var label = make('h4', 'ab-label', setting.label); label.id = 'ab-l-' + id;
  var desc = make('p', 'settings-hint ab-desc', setting.description); desc.id = 'ab-d-' + id;
  var row = make('div', 'ab-control-row');
  var group = make('div', 'ab-seg'); group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', 'ab-l-' + id);
  group.setAttribute('aria-describedby', 'ab-d-' + id + ' ab-c-' + id);
  state.catalog.modes.forEach(function (mode) {
    var radio = make('button', 'ab-seg-opt', mode.label); radio.type = 'button';
    radio.setAttribute('role', 'radio'); radio.dataset.value = mode.id;
    group.appendChild(radio);
  });
  group.addEventListener('click', function (event) {
    var radio = event.target.closest('[role="radio"]');
    if (radio) chooseValue(id, radio.dataset.value);
  });
  group.addEventListener('keydown', function (event) { onRadioKey(event, group, id); });
  row.appendChild(group); row.appendChild(statusBox(id));
  var consequence = make('p', 'ab-consequence'); consequence.id = 'ab-c-' + id;
  var example = make('p', 'ab-example');
  example.appendChild(make('span', 'ab-example-label', 'Example'));
  example.appendChild(make('span', 'ab-example-text'));
  [label, desc, row, consequence, example].forEach(function (node) { wrap.appendChild(node); });
  return wrap;
}

function onRadioKey(event, group, id) {
  var keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  var radios = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
  var index = radios.indexOf(document.activeElement);
  if (index < 0) return;
  var next = -1;
  if (keys[event.key]) next = (index + keys[event.key] + radios.length) % radios.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = radios.length - 1;
  if (next < 0) return;
  event.preventDefault();
  radios[next].focus();
  chooseValue(id, radios[next].dataset.value);
}

function buildCheckbox(setting) {
  var id = setting.id;
  var wrap = make('div', 'ab-setting ab-nested'); wrap.dataset.setting = id;
  var label = make('label', 'ab-check');
  var input = document.createElement('input'); input.type = 'checkbox'; input.id = 'ab-i-' + id;
  input.setAttribute('aria-describedby', 'ab-d-' + id + ' ab-c-' + id + ' ab-n-' + id);
  input.addEventListener('change', function () { chooseValue(id, input.checked); });
  label.appendChild(input); label.appendChild(make('span', 'ab-check-text', setting.label));
  var desc = make('p', 'settings-hint ab-desc', setting.description); desc.id = 'ab-d-' + id;
  var inactive = make('p', 'ab-inactive'); inactive.id = 'ab-n-' + id;
  var row = make('div', 'ab-control-row'); row.appendChild(statusBox(id));
  var consequence = make('p', 'ab-consequence'); consequence.id = 'ab-c-' + id;
  var example = make('p', 'ab-example');
  example.appendChild(make('span', 'ab-example-label', 'Example'));
  example.appendChild(make('span', 'ab-example-text', setting.example));
  [label, desc, inactive, row, consequence, example].forEach(function (node) { wrap.appendChild(node); });
  return wrap;
}

function buildStatic(state, scroller) {
  var frag = make('div', 'ab-ready');
  var note = make('div', 'ab-note');
  note.appendChild(make('p', '', NOTE));
  var layout = make('div', 'ab-layout');
  var navEl = make('nav', 'ab-nav'); navEl.setAttribute('aria-label', 'Agent behavior sections');
  var list = make('ul', 'ab-nav-list');
  var main = make('div', 'ab-sections');
  var sections = [];
  state.catalog.sections.forEach(function (section) {
    var item = make('li'); var link = make('a', 'ab-nav-link', section.label);
    link.href = '#ab-sec-' + section.id; link.dataset.section = section.id; item.appendChild(link); list.appendChild(item);
    var el = make('section', 'ab-section'); el.id = 'ab-sec-' + section.id;
    var heading = make('h3', 'ab-section-title', section.label); heading.id = 'ab-h-' + section.id; heading.tabIndex = -1;
    el.setAttribute('aria-labelledby', heading.id);
    el.appendChild(heading); el.appendChild(make('p', 'settings-hint ab-section-desc', section.description));
    state.catalog.settings.forEach(function (setting) {
      if (setting.section !== section.id || setting.type !== 'mode') return;
      var block = buildMode(setting, state); el.appendChild(block);
      state.catalog.settings.forEach(function (child) {
        if (child.type === 'checkbox' && child.parent === setting.id) block.appendChild(buildCheckbox(child));
      });
    });
    main.appendChild(el); sections.push({ id: section.id, el: el, heading: heading });
  });
  navEl.appendChild(list); layout.appendChild(main);
  frag.appendChild(note); frag.appendChild(layout);
  return { root: frag, layout: layout, nav: navEl, sections: sections, catalog: state.catalog, scroller: scroller };
}

// Desktop: the section links sit under the active page in the shell's left
// navigation. Narrow: they become a sticky row at the top of the content.
function placeNav(narrow) {
  if (!built) return;
  if (narrow) { setPageSubnav(null, null); built.layout.insertBefore(built.nav, built.layout.firstChild); }
  else setPageSubnav('us-agent', built.nav);
}

function syncStatus(box, id, state, input) {
  var status = statusFor(state, id);
  box.dataset.state = status.kind;
  if (status.kind === 'error') {
    if (box.dataset.shown !== status.text) {
      box.replaceChildren();
      box.appendChild(make('span', 'ab-status-text', status.text));
      var retry = make('button', 'us-btn us-btn-secondary ab-retry', 'Retry'); retry.type = 'button';
      retry.addEventListener('click', function () {
        retryValue(id);
        var target = input || host.querySelector('[data-setting="' + id + '"] [role="radio"][tabindex="0"]');
        if (target) target.focus();
      });
      box.appendChild(retry);
    }
    box.dataset.shown = status.text;
    return;
  }
  delete box.dataset.shown;
  if (box.querySelector('.ab-retry')) box.replaceChildren();
  setText(box, status.text);
}

function syncMode(setting, state) {
  var wrap = built.root.querySelector('[data-setting="' + setting.id + '"]');
  var value = displayedValue(state, setting.id);
  wrap.querySelectorAll('[role="radio"]').forEach(function (radio) {
    var on = radio.dataset.value === value;
    radio.setAttribute('aria-checked', on ? 'true' : 'false');
    radio.tabIndex = on ? 0 : -1;
    radio.classList.toggle('selected', on);
  });
  var copy = setting.modes[value] || { consequence: '', example: '' };
  setText(wrap.querySelector('.ab-consequence'), copy.consequence);
  setText(wrap.querySelector('.ab-example-text'), copy.example);
  syncStatus(wrap.querySelector(':scope > .ab-control-row > .ab-status'), setting.id, state, null);
}

function syncCheckbox(setting, state) {
  var wrap = built.root.querySelector('[data-setting="' + setting.id + '"]');
  var info = checkboxStatus(state, setting);
  var input = wrap.querySelector('input');
  if (input.checked !== info.checked) input.checked = info.checked;
  wrap.classList.toggle('ab-inactive-setting', info.inactive);
  setText(wrap.querySelector('.ab-consequence'), info.checked ? setting.checked : setting.unchecked);
  var note = wrap.querySelector('.ab-inactive');
  setText(note, info.reason); note.hidden = !info.reason;
  syncStatus(wrap.querySelector('.ab-status'), setting.id, state, input);
}

function sync(state) {
  if (!host) return;
  var box;
  if (state.status === 'ready') {
    if (!built || built.catalog !== state.catalog) {
      if (nav) { nav.destroy(); nav = null; }
      host.replaceChildren(make('div', 'ab-feedback')); host.appendChild((built = buildStatic(state, host.closest('.settings-shell-content') || host.parentElement)).root);
      built.scroller.scrollTop = 0;
      nav = attachSectionNav({ layout: built.layout, nav: built.nav, scroller: built.scroller, sections: built.sections, onPlace: placeNav });
    }
    delete host.dataset.abShown;
    host.querySelector('.ab-feedback').hidden = true;
    state.catalog.settings.forEach(function (setting) {
      if (setting.type === 'mode') syncMode(setting, state); else syncCheckbox(setting, state);
    });
    return;
  }
  // Keep an already rendered loading or error state (and its Retry control).
  var key = state.status + '|' + (state.error || '');
  if (!built && host.dataset.abShown === key && host.firstChild) return;
  host.dataset.abShown = key;
  if (nav) { nav.destroy(); nav = null; }
  setPageSubnav(null, null);
  built = null; host.replaceChildren(); box = make('div', 'ab-feedback'); host.appendChild(box);
  if (state.status === 'loading' || state.status === 'idle') {
    box.appendChild(make('p', 'settings-status ab-loading', 'Loading agent behavior...'));
    box.firstChild.dataset.state = 'loading'; box.firstChild.setAttribute('role', 'status');
  } else {
    box.appendChild(make('p', 'settings-status ab-load-error', state.error || 'Could not load agent behavior.'));
    box.firstChild.dataset.state = 'error'; box.firstChild.setAttribute('role', 'alert');
    var retry = make('button', 'us-btn us-btn-secondary ab-retry', 'Retry'); retry.type = 'button';
    retry.addEventListener('click', function () { loadAgentBehavior(); });
    box.appendChild(retry);
  }
}

// Mounts into the page container and loads (every entry re-fetches).
export function mountAgentBehavior(container) {
  // The shell may re-activate the page it is already showing (for example after
  // it refreshes permissions). Keep the mounted view and its in-flight or
  // finished load instead of rebuilding it, which would detach live controls.
  if (host === container && unsubscribe) { sync(getAgentBehavior()); return Promise.resolve(); }
  unmountAgentBehavior();
  host = container; built = null;
  unsubscribe = store.subscribe(function (state, prev) { if (state.agentBehavior !== prev.agentBehavior) sync(getAgentBehavior()); });
  sync(getAgentBehavior());
  return loadAgentBehavior();
}

export function unmountAgentBehavior() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  setPageSubnav(null, null);
  if (nav) { nav.destroy(); nav = null; }
  if (host) { host.replaceChildren(); delete host.dataset.abShown; }
  host = null; built = null;
}

export function agentBehaviorNav() { return nav; }
