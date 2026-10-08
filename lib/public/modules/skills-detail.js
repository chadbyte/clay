import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { skillState, content, getInstalledInfo, scopeLabel, patchSkills } from './skills-state.js';
import { buildInstallButtonsHtml, buildLocalActionsHtml, attachInstallHandlers } from './skills-actions.js';
function text(value) { return escapeHtml(String(value || '')); }
export function renderDetail(data) {
  patchSkills({ detailData: data });
  var name = data.name || data._skill || 'Skill', skill = data._skill || name;
  var info = getInstalledInfo(skill), builtin = info && info.source === 'clay-builtin';
  var source = data._source || data.repository || '';
  var cmd = data.command || 'npx skills add https://github.com/' + source + ' --skill ' + skill;
  var html = '<article class="skills-detail" data-local="' + !!data._installed + '"><header class="skills-detail-heading"><span class="skills-detail-icon">' + iconHtml(builtin ? 'sparkles' : 'book-open') + '</span><h2 class="skills-detail-name" tabindex="-1">' + text(name) + '</h2>';
  if (data.description) html += '<p class="skills-detail-desc">' + text(data.description) + '</p>';
  html += '<div class="skills-detail-byline">' + (builtin ? 'Included with Clay' : data._installed ? text(scopeLabel(info && info.scope || data.scope)) : text(source)) + (data.weeklyInstalls ? '<span>' + text(data.weeklyInstalls) + ' weekly installs</span>' : '') + '</div></header>';
  html += '<section class="skills-placement"><div class="skills-placement-heading"><h3>' + (builtin ? 'Ready to use' : data._installed ? 'Availability' : 'Add to your workflow') + '</h3><p>' + (builtin ? 'This skill comes with Clay and is maintained with the app.' : 'Project skills stay with this workspace. Global skills are available across your projects.') + '</p></div><div data-skill-actions>' + (data._installed ? buildLocalActionsHtml(skill) : buildInstallButtonsHtml(skill, source, skill)) + '</div></section>';
  if (data.skillMd) html += '<section class="skills-detail-md-wrap"><h3 class="skills-detail-section-title">Instructions</h3><div class="skills-detail-md">' + (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(data.skillMd) : text(data.skillMd)) + '</div></section>';
  if (data._installed && !data.skillMd) html += '<div class="skills-local-note">' + iconHtml('circle-check') + '<p>Your agent can discover this skill when it is relevant to a task. You can also ask for it by name.</p></div>';
  if (source || data.path || data.version || data.audits || data.githubStars || data.firstSeen || data.installedOn) {
    html += '<details class="skills-metadata"><summary>Skill information</summary><dl>';
    if (source) html += '<dt>Repository</dt><dd><a href="https://github.com/' + text(source) + '" target="_blank" rel="noopener noreferrer">' + text(source) + '</a></dd>';
    if (data.version) html += '<dt>Version</dt><dd>' + text(data.version) + '</dd>';
    if (data.path) html += '<dt>Location</dt><dd><code>' + text(data.path) + '</code></dd>';
    if (data.githubStars) html += '<dt>GitHub stars</dt><dd>' + text(data.githubStars) + '</dd>';
    if (data.firstSeen) html += '<dt>First seen</dt><dd>' + text(data.firstSeen) + '</dd>';
    (data.audits || []).forEach(function (audit) { html += '<dt>' + text(audit.name) + '</dt><dd>' + text(audit.status) + '</dd>'; });
    (data.installedOn || []).forEach(function (platform) { html += '<dt>' + text(platform.name) + '</dt><dd>' + text(platform.installs) + ' installs</dd>'; });
    html += '</dl></details>';
  }
  if (!data._installed) html += '<details class="skills-manual"><summary>Install from your terminal</summary><div class="skills-detail-cmd"><code>' + text(cmd) + '</code><button type="button" class="skills-copy-btn" aria-label="Copy installation command">' + iconHtml('copy') + '</button></div></details>';
  html += '</article>';
  content().innerHTML = html; refreshIcons();
  var copy = content().querySelector('.skills-copy-btn'); if (copy) copy.onclick = function () { copyToClipboard(cmd); };
  attachInstallHandlers(content().querySelector('[data-skill-actions]'), source, skill);
  content().querySelector('h2').focus({ preventScroll: true });
}
