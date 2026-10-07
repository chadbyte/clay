import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { claimRightWorkbench, registerRightWorkbench, releaseRightWorkbench } from './right-workbench.js';

function state() { return store.get('mcpSkillsWorkbench') || {}; }
function patch(value) { store.set({ mcpSkillsWorkbench: Object.assign({}, state(), value) }); }
function skillsAllowed() { var permissions = store.get('permissions'); return !permissions || permissions.skills !== false; }
export function ensureMcpSkillsWorkbench() {
  var panel = document.getElementById('mcp-skills-workbench');
  if (panel) return panel;
  var root = document.getElementById('main-panels');
  if (!root) return null;
  panel = document.createElement('section'); panel.id = 'mcp-skills-workbench'; panel.className = 'mcp-skills-workbench hidden'; panel.setAttribute('aria-label', 'MCP / Skills');
  panel.innerHTML = '<header class="mcp-skills-header"><strong>' + iconHtml('blocks') + 'MCP / Skills</strong><div>' +
    '<button type="button" data-workbench="wide" aria-label="Widen MCP / Skills">' + iconHtml('chevrons-left-right') + '</button>' +
    '<button type="button" data-workbench="fullscreen" aria-label="Toggle MCP / Skills fullscreen">' + iconHtml('maximize-2') + '</button>' +
    '<button type="button" data-workbench="close" aria-label="Close MCP / Skills">' + iconHtml('x') + '</button></div></header>' +
    '<div class="mcp-skills-tabs" role="tablist" aria-label="MCP / Skills sections"><button id="mcp-workbench-tab" role="tab" data-section="mcp" aria-controls="mcp-modal">MCP Servers</button><button id="skills-workbench-tab" role="tab" data-section="skills" aria-controls="skills-modal">Skills</button></div>';
  ['mcp', 'skills'].forEach(function (name) {
    var section = document.getElementById(name + '-modal');
    if (!section) return;
    var backdrop = section.querySelector('.confirm-backdrop'); if (backdrop) backdrop.remove();
    var dialog = section.querySelector('.confirm-dialog'); if (dialog) dialog.classList.remove('confirm-dialog');
    section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', name + '-workbench-tab');
    panel.appendChild(section);
  });
  root.appendChild(panel);
  panel.querySelector('[data-workbench="close"]').onclick = closeMcpSkillsWorkbench;
  ['wide', 'fullscreen'].forEach(function (key) { panel.querySelector('[data-workbench="' + key + '"]').onclick = function () { var value = {}; value[key] = !state()[key]; patch(value); }; });
  panel.querySelectorAll('[data-section]').forEach(function (button) {
    button.onclick = function () { openMcpSkillsWorkbench(button.dataset.section); };
    button.onkeydown = function (event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); var tab = button.dataset.section === 'mcp' && skillsAllowed() ? 'skills' : 'mcp';
      if (event.key === 'Home') tab = 'mcp'; if (event.key === 'End' && skillsAllowed()) tab = 'skills';
      openMcpSkillsWorkbench(tab); panel.querySelector('[data-section="' + tab + '"]').focus();
    };
  });
  // Compatibility targets for older mobile entry points; never palette tiles.
  ['skills-btn', 'mate-skills-btn'].forEach(function (id) {
    if (document.getElementById(id)) return;
    var button = document.createElement('button'); button.id = id; button.hidden = true;
    button.onclick = function () { openMcpSkillsWorkbench('skills'); }; root.appendChild(button);
  });
  refreshIcons(panel); render(); return panel;
}
export function openMcpSkillsWorkbench(tab) {
  if (!ensureMcpSkillsWorkbench()) return;
  tab = tab || state().tab || 'mcp';
  if (tab === 'skills' && !skillsAllowed()) tab = 'mcp';
  claimRightWorkbench('mcp-skills'); patch({ open: true, tab: tab });
}
export function closeMcpSkillsWorkbench() { patch({ open: false }); releaseRightWorkbench('mcp-skills'); }
function render() {
  var panel = document.getElementById('mcp-skills-workbench'); if (!panel) return;
  var current = state(); var tab = current.tab || 'mcp';
  panel.classList.toggle('hidden', !current.open); panel.classList.toggle('workbench-wide', !!current.wide); panel.classList.toggle('panel-fullscreen', !!current.fullscreen);
  ['wide', 'fullscreen'].forEach(function (key) { panel.querySelector('[data-workbench="' + key + '"]').setAttribute('aria-pressed', String(!!current[key])); });
  panel.querySelectorAll('[data-section]').forEach(function (button) { var selected = button.dataset.section === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; button.hidden = button.dataset.section === 'skills' && !skillsAllowed(); });
  ['mcp', 'skills'].forEach(function (name) { var section = document.getElementById(name + '-modal'); if (section) section.classList.toggle('hidden', !current.open || name !== tab); });
}
registerRightWorkbench('mcp-skills', closeMcpSkillsWorkbench);
store.subscribe(function (current, previous) {
  if (current.currentSlug !== previous.currentSlug || current.myUserId !== previous.myUserId || current.dmMode !== previous.dmMode) { closeMcpSkillsWorkbench(); return; }
  if (current.permissions !== previous.permissions && !skillsAllowed() && state().tab === 'skills') { patch({ tab: 'mcp' }); return; }
  if (current.mcpSkillsWorkbench !== previous.mcpSkillsWorkbench || current.permissions !== previous.permissions) render();
});
