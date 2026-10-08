import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';
import { content, skillState, getInstalledInfo, scopeLabel } from './skills-state.js';

function text(value) { return escapeHtml(String(value || '')); }
function count(value) { return typeof value === 'number' ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : text(value || '0'); }
export function renderSkillList(skills, openSkill, discover) {
  var state = skillState(), installed = state.activeTab === 'installed';
  var query = state.searchQuery.toLowerCase();
  if (installed) skills = Object.keys(state.installedSkills).sort().map(function (name) { return Object.assign({ name: name, skillId: name }, state.installedSkills[name]); }).filter(function (row) { return (row.name + ' ' + (row.description || '')).toLowerCase().includes(query); });
  var html = '<div class="skills-list-intro"><span>' + (installed ? 'Available to your agent' : state.searchQuery ? 'Search results' : 'Explore community skills') + '</span><span>' + skills.length + (skills.length === 1 ? ' skill' : ' skills') + '</span></div>';
  if (!skills.length) {
    html += '<div class="skills-library-empty">' + iconHtml(query ? 'search' : 'book-open') + '<h3>' + (query ? 'No matching skills' : 'Build your skill library') + '</h3><p>' + (query ? 'Try a different name or a shorter search.' : 'Discover reusable workflows and add the ones that fit your work.') + '</p>' + (!query && installed ? '<button type="button" class="skills-browse-btn">Discover skills ' + iconHtml('arrow-right') + '</button>' : '') + '</div>';
  } else html += '<div class="skills-library-list">' + skills.map(function (row, index) {
    var info = installed ? row : getInstalledInfo(row.skillId || row.name);
    var builtin = info && info.source === 'clay-builtin';
    return '<button type="button" class="skills-library-row" data-skill-index="' + index + '"><span class="skills-library-icon">' + iconHtml(builtin ? 'sparkles' : 'book-open') + '</span><span class="skills-library-info"><span class="skills-library-name">' + text(row.name) + '</span>' + (row.description ? '<span class="skills-library-desc">' + text(row.description) + '</span>' : '') + '<span class="skills-library-meta">' + (installed ? (builtin ? 'Included with Clay' : text(scopeLabel(row.scope))) : text(row.source)) + '</span></span><span class="skills-library-end">' + (info ? '<span class="skills-library-badge">' + (builtin ? 'Built-in' : installed ? '' : 'Installed') + '</span>' : '<span class="skills-library-installs">' + iconHtml('download') + count(row.installs) + '</span>') + iconHtml('chevron-right') + '</span></button>';
  }).join('') + '</div>';
  if (!installed) html += '<p class="skills-catalog-credit">Community catalog from <a href="https://skills.sh" target="_blank" rel="noopener noreferrer">skills.sh</a></p>';
  content().innerHTML = html;
  content().querySelectorAll('[data-skill-index]').forEach(function (button) { button.onclick = function () { openSkill(skills[Number(button.dataset.skillIndex)], installed); }; });
  var browse = content().querySelector('.skills-browse-btn'); if (browse) browse.onclick = discover;
  refreshIcons();
}
export function renderSkillFeedback(message, retry) {
  content().innerHTML = '<div class="skills-library-empty" role="status">' + iconHtml(retry ? 'circle-alert' : 'loader-circle') + '<p>' + text(message) + '</p>' + (retry ? '<button type="button" class="skills-browse-btn">Try again</button>' : '') + '</div>';
  var button = content().querySelector('button'); if (button) button.onclick = retry;
  refreshIcons();
}
