import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard, showToast } from './utils.js';
import { store } from './store.js';
import { skillState, content, basePath, getInstalledInfo, scopeLabel } from './skills-state.js';
import { buildInstallButtonsHtml, attachInstallHandlers } from './skills-actions.js';
export function renderDetail(data) {
  var name = data.name || data._skill || "Unknown";
  var desc = data.description || "";
  var cmd = data.command || "npx skills add https://github.com/" + data._source + " --skill " + data._skill;
  var skillId = data._skill || name;
  var info = getInstalledInfo(skillId);

  // Show back button in header
  var backBtn = document.getElementById("skills-back-btn");
  if (backBtn) backBtn.classList.remove("hidden");

  var html = '<div class="skills-detail">';

  // --- Main content (left) ---
  html += '<div class="skills-detail-main">';
  html += '<div class="skills-detail-name">' + escapeHtml(name) + '</div>';

  if (desc) {
    html += '<div class="skills-detail-desc">' + escapeHtml(desc) + '</div>';
  }

  html += '<div class="skills-detail-cmd">' +
    '<code>' + escapeHtml(cmd) + '</code>' +
    '<button class="skills-copy-btn" data-cmd="' + escapeHtml(cmd) + '">' + iconHtml("copy") + '</button>' +
  '</div>';

  // SKILL.md content (already rendered HTML from skills.sh)
  if (data.skillMd) {
    html += '<div class="skills-detail-md-wrap">' +
      '<div class="skills-detail-section-title">SKILL.md</div>' +
      '<div class="skills-detail-md">' + sanitizeSkillHtml(data.skillMd) + '</div>' +
    '</div>';
  }

  html += '</div>'; // end main

  // --- Sidebar (right) ---
  html += '<div class="skills-detail-sidebar">';

  // Weekly installs
  if (data.weeklyInstalls) {
    html += '<div class="skills-meta-block">' +
      '<div class="skills-meta-label">Weekly Installs</div>' +
      '<div class="skills-meta-value">' + escapeHtml(data.weeklyInstalls) + '</div>' +
    '</div>';
  }

  // Repository
  if (data.repository || data._source) {
    var repo = data.repository || data._source;
    html += '<div class="skills-meta-block">' +
      '<div class="skills-meta-label">Repository</div>' +
      '<div class="skills-meta-value small">' +
        '<div class="skills-meta-repo">' +
          iconHtml("external-link") +
          '<a href="https://github.com/' + escapeHtml(repo) + '" target="_blank" rel="noopener">' + escapeHtml(repo) + '</a>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // GitHub stars
  if (data.githubStars) {
    html += '<div class="skills-meta-block">' +
      '<div class="skills-meta-label">GitHub Stars</div>' +
      '<div class="skills-meta-value">' + escapeHtml(data.githubStars) + '</div>' +
    '</div>';
  }

  // First seen
  if (data.firstSeen) {
    html += '<div class="skills-meta-block">' +
      '<div class="skills-meta-label">First Seen</div>' +
      '<div class="skills-meta-value small">' + escapeHtml(data.firstSeen) + '</div>' +
    '</div>';
  }

  // Security audits
  if (data.audits && data.audits.length) {
    html += '<div class="skills-meta-block">' +
      '<div class="skills-meta-label">Security Audits</div>' +
      '<div class="skills-audit-list">';
    for (var a = 0; a < data.audits.length; a++) {
      var audit = data.audits[a];
      html += '<div class="skills-audit-item">' +
        '<span>' + escapeHtml(audit.name) + '</span>' +
        '<span class="skills-audit-badge ' + escapeHtml(audit.status) + '">' + escapeHtml(audit.status.toUpperCase()) + '</span>' +
      '</div>';
    }
    html += '</div></div>';
  }

  // Installed on
  if (data.installedOn && data.installedOn.length) {
    html += '<div class="skills-meta-block">' +
      '<div class="skills-meta-label">Installed On</div>' +
      '<div class="skills-platform-list">';
    for (var p = 0; p < data.installedOn.length; p++) {
      var plat = data.installedOn[p];
      html += '<div class="skills-platform-item">' +
        '<span>' + escapeHtml(plat.name) + '</span>' +
        '<span class="skills-platform-count">' + escapeHtml(plat.installs) + '</span>' +
      '</div>';
    }
    html += '</div></div>';
  }

  // Install buttons or installed status
  html += '<div class="skills-meta-block">' +
    buildInstallButtonsHtml(skillId, data._source, data._skill) +
  '</div>';

  html += '</div>'; // end sidebar
  html += '</div>'; // end detail

  content().innerHTML = html;
  refreshIcons(content());

  // Copy button handler
  var copyBtn = content().querySelector(".skills-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var cmdText = copyBtn.dataset.cmd;
      copyToClipboard(cmdText);
      copyBtn.classList.add("copied");
      setTimeout(function () { copyBtn.classList.remove("copied"); }, 1500);
    });
  }

  // Install button handlers
  var installActions = content().querySelector(".skills-install-actions");
  if (installActions) {
    attachInstallHandlers(installActions, data._source, data._skill);
  }
}

function sanitizeSkillHtml(rawHtml) {
  if (typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(rawHtml);
  }
  return rawHtml;
}
