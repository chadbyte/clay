import { ensureWorkbenchWindowControls, syncWorkbenchWindowControls } from './workbench-window-controls.js';
import { WORKBENCH_PANELS } from './workbench-panels.js';
import { recordToolExpansion } from './view-presentation-state.js';
import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { TOOL_PANES } from './tool-pane-tree.js';

function titleFor(panel, name) {
  if (name === 'terminal') {
    var state = store.snap(), project = (state.projectsHubList || []).find(function (item) { return item && item.slug === state.currentSlug; });
    var projectName = project && (project.title || project.project || project.name) || state.projectName || state.currentSlug;
    return projectName ? projectName + ' · Terminal' : 'Terminal';
  }
  if (name === 'file-viewer') { var tab = panel.querySelector('.file-viewer-tab.active .file-viewer-tab-label'); return tab && tab.textContent || 'Files'; }
  var browser = store.get('sharedBrowser');
  try { return browser && browser.url ? new URL(browser.url).hostname : 'Browser'; } catch (error) { return 'Browser'; }
}
export function renderToolPaneChrome(panel, name) {
  if (panel.dataset.fileInstance) return;
  if (WORKBENCH_PANELS[name]) { renderWorkbenchChrome(panel, name); return; }
  var definition = TOOL_PANES[name];
  if (!definition) return;
  var header = panel.querySelector(':scope > .tool-pane-header');
  if (!header) {
    var original = panel.querySelector(name === 'terminal' ? '.terminal-header' : name === 'browser' ? '.shared-browser-header' : '.file-viewer-tabbar');
    if (!original) return;
    header = document.createElement('header'); header.className = 'tool-pane-header split-pane-header'; header.dataset.toolPane = name;
    var kind = document.createElement('span'); kind.className = 'tool-pane-kind' + (name === 'terminal' ? '' : ' split-view-runtime');
    kind.innerHTML = iconHtml(definition.icon) + (name === 'terminal' ? '' : '<span class="split-view-model">' + definition.label + '</span>');
    var title = document.createElement('span'); title.className = 'tool-pane-title split-pane-title';
    var space = document.createElement('span'); space.className = 'split-pane-drag-space'; space.title = 'Drag to rearrange panes'; space.setAttribute('aria-hidden', 'true');
    var actions = original.querySelector('.terminal-header-actions, .shared-browser-window, .file-viewer-window-actions');
    header.append(kind, title, space); if (actions) header.appendChild(actions);
    panel.insertBefore(header, panel.firstChild);
    if (name === 'browser') {
      header.classList.add('browser-pane-header');
      var tabs = panel.querySelector('.shared-browser-tabs');
      if (tabs) header.insertBefore(tabs, space);
      kind.setAttribute('aria-label', 'Browser'); kind.setAttribute('data-tip', 'Browser');
      original.hidden = true; var close = header.querySelector('[data-action="hide"]'); if (close) { close.title = 'Close browser pane'; close.setAttribute('aria-label', 'Close browser pane'); }
    }
    else original.classList.add('tool-pane-tab-row');
    var observer = new MutationObserver(function () { update(); });
    observer.observe(panel, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    panel.addEventListener('clay-tool-pane-dispose', function () { observer.disconnect(); }, { once: true });
    refreshIcons();
  }
  function update() {
    var label = titleFor(panel, name), title = header.querySelector('.tool-pane-title');
    if (title.textContent !== label) { title.textContent = label; title.title = label; }
  }
  update();
}

store.subscribe(function (state, previous) {
  if (state.projectName === previous.projectName && state.projectsHubList === previous.projectsHubList && state.currentSlug === previous.currentSlug) return;
  var panel = document.getElementById('terminal-container');
  if (panel && panel.querySelector(':scope > .tool-pane-header')) renderToolPaneChrome(panel, 'terminal');
});

function renderWorkbenchChrome(panel, name) {
  panel.classList.add('workbench-pane-shell');
  var header = panel.querySelector(':scope > header');
  if (!header || header.dataset.toolPane === name) return;
  header.dataset.toolPane = name;
  header.classList.add('tool-pane-header', 'split-pane-header');
  var actions = header.querySelector('[class*="window-actions"], :scope > div:last-child');
  if (!actions) {
    actions = document.createElement('div');
    Array.from(header.querySelectorAll(':scope > button')).forEach(function (button) {
      var label = button.getAttribute('aria-label') || '';
      if (/^(Widen|Close)|fullscreen/i.test(label)) actions.appendChild(button);
    });
    header.appendChild(actions);
  }
  actions.classList.add('workbench-pane-actions');
  ensureWorkbenchWindowControls(panel, name, actions);
  var title = header.querySelector('strong, [class$="-title"]');
  if (title) title.classList.add('tool-pane-title');
  var space = document.createElement('span'); space.className = 'split-pane-drag-space';
  space.title = 'Drag to rearrange panes'; space.setAttribute('aria-hidden', 'true');
  header.insertBefore(space, actions);
  var expanded = panel.classList.contains('panel-fullscreen');
  var observer = new MutationObserver(function () {
    syncWorkbenchWindowControls(panel, actions);
    var next = panel.classList.contains('panel-fullscreen');
    if (next !== expanded) { expanded = next; recordToolExpansion(name, next); }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  panel.addEventListener('clay-tool-pane-dispose', function () { observer.disconnect(); }, { once: true });
}
