import { skillState, patchSkills, basePath, content } from './skills-state.js';
import { renderDetail } from './skills-detail.js';
import { renderSkillList, renderSkillFeedback } from './skills-list-view.js';
export { handleSkillInstalled, handleSkillUninstalled } from './skills-actions.js';
import { openMcpSkillsWorkbench, closeMcpSkillsWorkbench } from './mcp-skills-workbench.js';
import { store } from './store.js';

function target() { return String(store.get('currentSlug')) + ':' + String(store.get('myUserId')); }
function modal() { return document.getElementById('skills-modal'); }
function requestGuard() {
  var version = (skillState().requestVersion || 0) + 1, owner = target();
  patchSkills({ requestVersion: version });
  return function () { return target() === owner && skillState().requestVersion === version; };
}
function json(url) { return fetch(url).then(function (res) { if (!res.ok) throw new Error('Request failed'); return res.json(); }); }
function chrome() {
  var state = skillState(), detail = state.currentView === 'detail', root = modal();
  root.querySelector('.skills-library-heading').hidden = detail;
  document.getElementById('skills-back-btn').classList.toggle('hidden', !detail);
  root.querySelector('.skills-tabs').hidden = detail;
  root.querySelector('.skills-toolbar').hidden = detail;
  root.querySelector('.skills-discovery-views').hidden = detail || state.activeTab === 'installed' || !!state.searchQuery;
  root.querySelectorAll('.skills-tab').forEach(function (button) {
    var active = button.dataset.tab === state.activeTab;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
  var input = document.getElementById('skills-search-input');
  input.placeholder = state.activeTab === 'installed' ? 'Search installed skills' : 'Search community skills';
  input.setAttribute('aria-label', input.placeholder);
  if (input.value !== state.searchQuery) input.value = state.searchQuery;
  document.getElementById('skills-search-clear').classList.toggle('hidden', !state.searchQuery);
  document.getElementById('skills-installed-count').textContent = Object.keys(state.installedSkills).length || '';
  root.querySelectorAll('[data-discovery]').forEach(function (button) {
    button.setAttribute('aria-pressed', String(button.dataset.discovery === (state.discoverySort || 'all')));
  });
}
function renderList(rows) { chrome(); renderSkillList(rows || [], openSkill, function () { selectTab('discover'); }); }
function loadList(refresh) {
  chrome();
  var state = skillState(), valid = requestGuard();
  if (state.activeTab === 'installed') {
    if (!refresh && state.inventoryLoaded) { renderList(); return; }
    renderSkillFeedback('Loading your skills…');
    json(basePath() + 'api/installed-skills').then(function (data) {
      if (!valid()) return;
      patchSkills({ installedSkills: data.installed || {}, inventoryLoaded: true }); renderList();
    }).catch(function () { if (valid()) renderSkillFeedback('Could not load your skills.', function () { loadList(true); }); });
    return;
  }
  var query = state.searchQuery, sort = state.discoverySort || 'all';
  var cache = query ? state.searchCache[query] : state.skillsData[sort];
  if (cache && !refresh) { renderList(cache); return; }
  renderSkillFeedback(query ? 'Searching community skills…' : 'Loading community skills…');
  json(query ? '/api/skills/search?q=' + encodeURIComponent(query) : '/api/skills?tab=' + sort).then(function (data) {
    if (!valid()) return;
    var rows = data.skills || [], update = {};
    if (query) update.searchCache = Object.assign({}, skillState().searchCache, { [query]: rows });
    else update.skillsData = Object.assign({}, skillState().skillsData, { [sort]: rows });
    patchSkills(update); renderList(rows);
  }).catch(function () { if (valid()) renderSkillFeedback('Could not load community skills.', function () { loadList(true); }); });
}
function selectTab(tab) {
  clearTimeout(skillState().searchTimer);
  patchSkills({ activeTab: tab, currentView: 'list', searchQuery: '', selectedSkill: null }); loadList();
}
function showList() { patchSkills({ currentView: 'list', selectedSkill: null }); loadList(); document.getElementById('skills-search-input').focus(); }
function openSkill(row, installed) {
  clearTimeout(skillState().searchTimer);
  patchSkills({ currentView: 'detail', selectedSkill: row.skillId || row.name }); chrome();
  var valid = requestGuard(); content().scrollTop = 0;
  if (installed) {
    renderDetail(Object.assign({}, row, { _skill: row.name, _installed: true })); return;
  }
  renderSkillFeedback('Loading skill details…');
  json('/api/skills/detail?source=' + encodeURIComponent(row.source) + '&skill=' + encodeURIComponent(row.skillId || row.name)).then(function (data) {
    if (valid()) renderDetail(Object.assign({}, data, { _source: row.source, _skill: row.skillId || row.name }));
  }).catch(function () { if (valid()) renderSkillFeedback('Could not load this skill.', function () { openSkill(row, false); }); });
}
function activate() {
  if (skillState().loadedFor === target()) return;
  clearTimeout(skillState().searchTimer);
  patchSkills({ loadedFor: target(), activeTab: 'installed', currentView: 'list', searchQuery: '', installedSkills: {}, inventoryLoaded: false, selectedSkill: null });
  loadList(true);
}
export function initSkills() {
  if (!modal()) return;
  var input = document.getElementById('skills-search-input');
  document.getElementById('skills-back-btn').onclick = showList;
  var legacy = document.getElementById('skills-btn'); if (legacy) legacy.onclick = function () { openMcpSkillsWorkbench('skills'); };
  modal().querySelectorAll('.skills-tab').forEach(function (button) {
    button.onclick = function () { selectTab(button.dataset.tab); };
    button.onkeydown = function (event) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); var tab = event.key === 'Home' ? 'installed' : event.key === 'End' ? 'discover' : skillState().activeTab === 'installed' ? 'discover' : 'installed';
      selectTab(tab); modal().querySelector('[data-tab="' + tab + '"]').focus();
    };
  });
  input.oninput = function () {
    clearTimeout(skillState().searchTimer); requestGuard(); patchSkills({ searchQuery: input.value }); chrome();
    if (skillState().activeTab === 'installed') loadList();
    else patchSkills({ searchTimer: setTimeout(function () { loadList(); }, 250) });
  };
  document.getElementById('skills-search-clear').onclick = function () { input.value = ''; input.oninput(); input.focus(); };
  modal().querySelectorAll('[data-discovery]').forEach(function (button) {
    button.onclick = function () { patchSkills({ discoverySort: button.dataset.discovery }); loadList(); };
  });
  document.addEventListener('keydown', function (event) {
    var panel = store.get('mcpSkillsWorkbench') || {};
    if (!panel.open || panel.tab !== 'skills' || (event.target && (event.target.matches('input,textarea,select') || event.target.isContentEditable))) return;
    if (event.key === '/' && skillState().currentView === 'list') { event.preventDefault(); input.focus(); }
    if (event.key === 'Escape') { if (skillState().currentView === 'detail') showList(); else closeMcpSkillsWorkbench(); }
  });
  store.subscribe(function (state, previous) {
    var next = state.mcpSkillsWorkbench || {}, old = previous.mcpSkillsWorkbench || {};
    if (state.currentSlug !== previous.currentSlug || state.myUserId !== previous.myUserId) { clearTimeout(skillState().searchTimer); requestGuard(); }
    if (state.skillsRefreshVersion !== previous.skillsRefreshVersion && skillState().currentView === 'list') loadList(true);
    if (next.open && next.tab === 'skills' && (!old.open || old.tab !== 'skills')) activate();
  });
}
