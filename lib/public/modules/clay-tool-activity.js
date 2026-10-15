import { clayToolPresentation, clayToolOutcome } from './clay-tool-presentation.js';
import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';

function bindDisclosure(header, toggle) {
  header.setAttribute('role', 'button');
  header.tabIndex = 0;
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  });
}

export function syncToolGroupDisclosure(el) {
  var expanded = !el.classList.contains('collapsed');
  el.querySelector('.tool-group-header').setAttribute('aria-expanded', String(expanded));
  var items = el.querySelector('.tool-group-items');
  items.inert = !expanded;
  items.setAttribute('aria-hidden', String(!expanded));
}

export function bindToolGroupDisclosure(el, onToggle) {
  // History links may expand a group directly; keep disclosure semantics in sync.
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function () { syncToolGroupDisclosure(el); });
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  bindDisclosure(el.querySelector('.tool-group-header'), function () {
    el.classList.toggle('collapsed');
    onToggle();
    syncToolGroupDisclosure(el);
  });
}

function detailsFor(tool) {
  var block = tool.el.querySelector('.clay-tool-evidence');
  if (!block) {
    block = document.createElement('div');
    block.className = 'tool-result-block clay-tool-evidence collapsed';
    tool.el.appendChild(block);
  }
  return block;
}
function renderEvidence(tool, block) {
  block.replaceChildren();
  var name = document.createElement('div');
  name.className = 'clay-tool-technical-name';
  name.textContent = tool.name;
  block.appendChild(name);
  [['Input', tool.input], ['Output', tool.clayRawResult]].forEach(function (entry) {
    if (entry[1] === undefined || entry[1] === null) return;
    var heading = document.createElement('div');
    heading.className = 'clay-tool-evidence-label';
    heading.textContent = entry[0];
    var pre = document.createElement('pre');
    pre.textContent = typeof entry[1] === 'string' ? entry[1] : JSON.stringify(entry[1], null, 2);
    block.appendChild(heading);
    block.appendChild(pre);
  });
}
function statusIcon(el, selector, phase) {
  var icon = el.querySelector(selector);
  var name = phase === 'error' || phase === 'cancelled' ? 'alert-triangle' : phase === 'pending' ? 'clock' : phase === 'running' ? 'loader' : phase === 'returned' ? 'circle-help' : 'check';
  var cls = phase === 'running' ? 'icon-spin' : phase === 'error' || phase === 'cancelled' ? 'err-icon' : 'check';
  icon.innerHTML = iconHtml(name, cls);
}

export function applyClayToolItem(tool) {
  if (!tool || !tool.el) return false;
  var presentation = clayToolPresentation(tool.name, tool.input, tool.clayOutcome);
  if (!presentation) return false;
  tool.clayActivity = presentation;
  var el = tool.el;
  var header = el.querySelector('.tool-header');
  el.classList.add('clay-tool-activity');
  el.dataset.activityPhase = presentation.phase;
  el.classList.toggle('error', presentation.phase === 'error' || presentation.phase === 'cancelled');
  el.querySelector('.tool-name').textContent = presentation.label;
  el.querySelector('.tool-desc').textContent = presentation.subject;
  el.querySelector('.tool-subtitle').hidden = true;
  header.setAttribute('aria-label', presentation.label + (presentation.subject ? ' · ' + presentation.subject : '') + '. Show technical details');
  if (!tool.clayDisclosureBound) {
    tool.clayDisclosureBound = true;
    bindDisclosure(header, function () {
      var expanded = el.classList.toggle('expanded');
      var block = detailsFor(tool);
      if (expanded) renderEvidence(tool, block);
      block.classList.toggle('collapsed', !expanded);
      header.setAttribute('aria-expanded', String(expanded));
    });
  }
  header.setAttribute('aria-expanded', String(el.classList.contains('expanded')));
  if (el.classList.contains('expanded')) renderEvidence(tool, detailsFor(tool));
  statusIcon(el, '.tool-status-icon', presentation.phase);
  refreshIcons();
  return true;
}

export function finishClayToolItem(tool, group) {
  if (!tool || !clayToolPresentation(tool.name, tool.input)) return false;
  if (!tool.clayOutcome) {
    tool.clayOutcome = { phase: 'returned', status: 'result_unavailable' };
    tool.clayEndedGroup = group;
    var cache = store.get('clayEndedToolRecords');
    if (!cache) { cache = new WeakMap(); store.set({ clayEndedToolRecords: cache }); }
    cache.set(tool.el, tool);
  }
  return applyClayToolItem(tool);
}

// Done clears the live registry; only rows still in this transcript can receive late results.
export function findEndedClayTool(root, id) {
  var cache = store.get('clayEndedToolRecords');
  if (!cache || !root) return null;
  var rows = root.querySelectorAll('.clay-tool-activity[data-tool-id]');
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].dataset.toolId === id && cache.has(rows[i])) return cache.get(rows[i]);
  }
  return null;
}

export function clayToolResultGroup(tool, liveGroup) {
  return liveGroup && liveGroup.el.contains(tool.el) ? liveGroup : tool.clayEndedGroup;
}

export function applyClayToolResult(tool, content, isError) {
  if (!clayToolPresentation(tool.name, tool.input)) return false;
  tool.clayRawResult = content;
  tool.clayOutcome = clayToolOutcome(content, isError);
  return applyClayToolItem(tool);
}

export function syncClayToolGroup(group) {
  if (!group.clayActivityPhase) { delete group.el.dataset.activityPhase; return; }
  group.el.dataset.activityPhase = group.clayActivityPhase;
  statusIcon(group.el, '.tool-group-status-icon', group.clayActivityPhase);
  refreshIcons();
}
