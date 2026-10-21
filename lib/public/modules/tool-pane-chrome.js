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
    if (name === 'browser') { original.hidden = true; var close = header.querySelector('[data-action="hide"]'); if (close) { close.title = 'Close browser pane'; close.setAttribute('aria-label', 'Close browser pane'); } }
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
