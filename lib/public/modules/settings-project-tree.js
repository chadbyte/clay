import { store } from './store.js';
import { groupProjects } from './project-grouping.js';

function state() { return store.get('settingsProjectTree') || { expanded: {}, query: '' }; }
function button(text, label, action) {
  var node = document.createElement('button'); node.type = 'button'; node.textContent = text;
  node.setAttribute('aria-label', label); node.onclick = action; return node;
}
export function renderProjectTree(choices, selected, onSelect, placeholder) {
  var root = document.getElementById('settings-project-tree');
  if (!root) return;
  var focus = root.contains(document.activeElement) && document.activeElement.dataset.treeKey;
  var data = state();
  root.replaceChildren();
  var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a project or worktree…';
  search.setAttribute('aria-label', 'Find a project or worktree'); search.value = data.query; search.dataset.treeKey = 'search';
  search.oninput = function () {
    store.set({ settingsProjectTree: Object.assign({}, state(), { query: search.value }) });
    renderProjectTree(choices, selected, onSelect, placeholder);
  };
  root.onkeydown = function (event) {
    if (event.target === search) return;
    var items = Array.from(root.querySelectorAll('button')).filter(function (el) { return !el.closest('[hidden]'); });
    var index = items.indexOf(document.activeElement);
    if (index < 0) return;
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      items[next].focus();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      var toggle = event.target.closest('.settings-project-row').querySelector('[aria-expanded]');
      if (toggle && toggle.getAttribute('aria-expanded') !== String(event.key === 'ArrowRight')) { event.preventDefault(); toggle.click(); }
    }
  };
  root.appendChild(search);
  var list = document.createElement('div'); list.className = 'settings-project-list'; list.setAttribute('aria-label', 'Projects'); root.appendChild(list);
  var query = data.query.trim().toLowerCase();
  var grouped = groupProjects(choices.map(function (choice) { return Object.assign({}, choice.project, { settingsChoice: choice }); }));
  function matches(project) { return !query || (project.settingsChoice.label + ' ' + project.slug).toLowerCase().includes(query); }
  function row(project, children, child) {
    var item = document.createElement('div'); item.className = 'settings-project-row' + (child ? ' settings-worktree-row' : '');
    var expanded = !!data.expanded[project.slug];
    if (children.length) {
      var toggle = button(expanded ? '⌄' : '›', (expanded ? 'Collapse ' : 'Expand ') + project.settingsChoice.label + ' worktrees', function () {
        var next = Object.assign({}, state().expanded); next[project.slug] = !expanded;
        store.set({ settingsProjectTree: Object.assign({}, state(), { expanded: next }) });
        renderProjectTree(choices, selected, onSelect, placeholder);
      });
      toggle.className = 'settings-project-expand'; toggle.dataset.treeKey = 'expand:' + project.slug;
      toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-controls', 'settings-children-' + project.slug); item.appendChild(toggle);
    } else { var spacer = document.createElement('span'); spacer.className = 'settings-project-expand-spacer'; item.appendChild(spacer); }
    var select = button(project.settingsChoice.label, project.settingsChoice.label + (child ? ' worktree' : ' project'), function () { onSelect(project.slug); });
    select.className = 'settings-project-item'; select.dataset.slug = project.slug; select.dataset.treeKey = 'select:' + project.slug;
    select.classList.toggle('active', project.slug === selected);
    if (project.slug === selected) select.setAttribute('aria-current', 'page');
    var label = document.createElement('span'); label.className = 'settings-project-label'; label.textContent = project.settingsChoice.label;
    var detail = document.createElement('small');
    detail.textContent = project.ownershipRecovery ? 'Needs recovery' : children.length ? children.length + ' worktrees' : child ? 'Worktree' : '';
    select.replaceChildren(label, detail); item.appendChild(select); list.appendChild(item);
    if (children.length) {
      var group = document.createElement('div'); group.id = 'settings-children-' + project.slug; group.hidden = !expanded; group.className = 'settings-project-children';
      list.appendChild(group);
      children.filter(function (entry) { return matches(project) || matches(entry); }).forEach(function (entry) {
        row(entry, [], true); group.appendChild(list.lastChild);
      });
    }
  }
  grouped.parents.forEach(function (project) {
    var children = grouped.wtByParent[project.slug] || [];
    if (matches(project) || children.some(matches)) row(project, children, project.isWorktree);
  });
  if (!list.children.length) { var empty = document.createElement('p'); empty.className = 'settings-hint'; empty.textContent = choices.length ? 'No matching projects or worktrees.' : placeholder || 'No projects available'; list.appendChild(empty); }
  if (focus) Array.from(root.querySelectorAll('[data-tree-key]')).some(function (node) { if (node.dataset.treeKey !== focus) return false; node.focus(); return true; });
}
