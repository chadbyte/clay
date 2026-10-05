import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard, showToast } from './utils.js';
import { store } from './store.js';
import { skillState, content, basePath, getInstalledInfo, scopeLabel } from './skills-state.js';
import { getWs } from './ws-ref.js';
function reloadActiveSessionSkills() { var ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'reload_skills' })); }
function installSkill(source, skill, scope) {
  var url = "https://github.com/" + source;

  // Set all install buttons in the detail view to installing state
  var btns = content().querySelectorAll(".skills-install-btn:not(.installed-state)");
  for (var i = 0; i < btns.length; i++) {
    btns[i].disabled = true;
    btns[i].classList.add("installing");
    btns[i].innerHTML = '<div class="skills-btn-spinner"></div> Installing...';
  }

  fetch(basePath() + "api/install-skill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url, skill: skill, scope: scope }),
  }).catch(function () {
    // Re-enable buttons on fetch error
    for (var j = 0; j < btns.length; j++) {
      btns[j].disabled = false;
      btns[j].classList.remove("installing");
    }
  });
}

export function handleSkillInstalled(msg) {
  var skill = msg.skill;
  var scope = msg.scope;
  var success = msg.success;

  if (success) {
    // Update skillState().installedSkills cache
    var existing = skillState().installedSkills[skill];
    if (existing) {
      if (existing.scope !== scope && existing.scope !== "both") {
        existing.scope = "both";
      }
    } else {
      skillState().installedSkills[skill] = { scope: scope };
    }

    // Invalidate skills data cache so list refreshes with updated badges
    skillState().skillsData = {};

    // If we're on the detail view for this skill, re-render it
    if (skillState().currentView === "detail") {
      var detailEl = content().querySelector(".skills-detail");
      if (detailEl) {
        // Re-render the install section in the sidebar
        updateDetailInstallButtons(skill);
      }
    }

    // If we're on the installed tab, refresh it
    if (skillState().activeTab === "installed" && skillState().currentView === "list") {
      store.set({ skillsRefreshVersion: (store.get('skillsRefreshVersion') || 0) + 1 });
    }

    // Hot-reload skills in the active session so it's usable immediately
    reloadActiveSessionSkills();
  } else {
    // Show error toast
    showToast("Failed to install " + skill + (msg.error ? ": " + msg.error : ""), "error");
    // Re-enable buttons
    var btns = content().querySelectorAll(".skills-install-btn.installing");
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = false;
      btns[i].classList.remove("installing");
      // We can't easily restore the original text, so just set generic labels
      btns[i].innerHTML = iconHtml("download") + " Install";
    }
  }
}

export function uninstallSkill(skill, scope) {
  // Set the uninstall button to loading state
  var unBtn = content().querySelector('.skills-uninstall-btn[data-scope="' + scope + '"]');
  if (unBtn) {
    unBtn.disabled = true;
    unBtn.classList.add("uninstalling");
    unBtn.innerHTML = '<div class="skills-btn-spinner small"></div>';
  }

  fetch(basePath() + "api/uninstall-skill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skill: skill, scope: scope }),
  }).catch(function () {
    if (unBtn) {
      unBtn.disabled = false;
      unBtn.classList.remove("uninstalling");
      unBtn.innerHTML = iconHtml("x");
    }
  });
}

export function handleSkillUninstalled(msg) {
  var skill = msg.skill;
  var scope = msg.scope;
  var success = msg.success;

  if (success) {
    // Update skillState().installedSkills cache
    var existing = skillState().installedSkills[skill];
    if (existing) {
      if (existing.scope === "both") {
        // Downgrade from "both" to whichever scope remains
        existing.scope = scope === "global" ? "project" : "global";
      } else {
        // Fully uninstalled
        delete skillState().installedSkills[skill];
      }
    }

    // Invalidate skills data cache so list refreshes
    skillState().skillsData = {};

    // If we're on the detail view, re-render buttons
    if (skillState().currentView === "detail") {
      var detailEl = content().querySelector(".skills-detail");
      if (detailEl) {
        updateDetailInstallButtons(skill);
      }
    }

    // If we're on the installed tab, refresh it
    if (skillState().activeTab === "installed" && skillState().currentView === "list") {
      store.set({ skillsRefreshVersion: (store.get('skillsRefreshVersion') || 0) + 1 });
    }

    // Hot-reload skills in the active session so the change applies immediately
    reloadActiveSessionSkills();
  } else {
    showToast("Failed to uninstall " + skill + (msg.error ? ": " + msg.error : ""), "error");
    // Re-enable the uninstall button
    var unBtn = content().querySelector('.skills-uninstall-btn[data-scope="' + scope + '"]');
    if (unBtn) {
      unBtn.disabled = false;
      unBtn.classList.remove("uninstalling");
      unBtn.innerHTML = iconHtml("x");
      refreshIcons(unBtn);
    }
  }
}

function updateDetailInstallButtons(skillId) {
  var info = getInstalledInfo(skillId);
  var sidebar = content().querySelector(".skills-detail-sidebar");
  if (!sidebar) return;

  // Find the install actions or installed status block (last .skills-meta-block)
  var blocks = sidebar.querySelectorAll(".skills-meta-block");
  var lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) return;

  // Get source/skill from the current detail view data attributes
  var sourceEl = sidebar.querySelector("[data-detail-source]");
  if (!sourceEl) sourceEl = content().querySelector("[data-detail-source]");
  var source = sourceEl ? sourceEl.dataset.detailSource : "";
  var skill = sourceEl ? sourceEl.dataset.detailSkill : skillId;

  lastBlock.innerHTML = buildInstallButtonsHtml(skillId, source, skill);
  refreshIcons(lastBlock);
  attachInstallHandlers(lastBlock, source, skill);
}

export function buildInstallButtonsHtml(skillId, source, skill) {
  var info = getInstalledInfo(skillId);
  if (info && info.source === "clay-builtin") return '<div class="skills-installed-status">' + iconHtml("circle-check") + ' Built in to Clay</div>';

  var html = '<div class="skills-install-actions" data-detail-source="' + escapeHtml(source) + '" data-detail-skill="' + escapeHtml(skill) + '">';

  if (info && info.scope === "both") {
    // Both scopes installed — show status + uninstall for each
    html += '<div class="skills-installed-row">' +
      '<div class="skills-installed-status compact">' +
        iconHtml("circle-check") + ' Installed (Project)' +
      '</div>' +
      '<button class="skills-uninstall-btn" data-scope="project" title="Uninstall (Project)">' +
        iconHtml("x") +
      '</button>' +
    '</div>';
    html += '<div class="skills-installed-row">' +
      '<div class="skills-installed-status compact">' +
        iconHtml("circle-check") + ' Installed (Global)' +
      '</div>' +
      '<button class="skills-uninstall-btn" data-scope="global" title="Uninstall (Global)">' +
        iconHtml("x") +
      '</button>' +
    '</div>';
  } else if (info) {
    // One scope installed — show status with uninstall + install button for other scope
    html += '<div class="skills-installed-row">' +
      '<div class="skills-installed-status compact">' +
        iconHtml("circle-check") + ' Installed (' + scopeLabel(info.scope) + ')' +
      '</div>' +
      '<button class="skills-uninstall-btn" data-scope="' + escapeHtml(info.scope) + '" title="Uninstall (' + scopeLabel(info.scope) + ')">' +
        iconHtml("x") +
      '</button>' +
    '</div>';

    // Show install button for the other scope
    var otherScope = info.scope === "global" ? "project" : "global";
    var otherLabel = info.scope === "global" ? "Project" : "Global";
    html += '<button class="skills-install-btn secondary" data-scope="' + otherScope + '">' +
      iconHtml("download") + ' Install (' + otherLabel + ')' +
    '</button>';
  } else {
    // Not installed — show both install buttons
    html += '<button class="skills-install-btn" data-scope="project">' +
      iconHtml("download") + ' Install (Project)' +
    '</button>';
    html += '<button class="skills-install-btn secondary" data-scope="global">' +
      iconHtml("download") + ' Install (Global)' +
    '</button>';
  }

  html += '</div>';
  return html;
}

export function attachInstallHandlers(container, source, skill) {
  var btns = container.querySelectorAll(".skills-install-btn");
  for (var i = 0; i < btns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var scope = btn.dataset.scope;
        installSkill(source, skill, scope);
      });
    })(btns[i]);
  }
  var unBtns = container.querySelectorAll(".skills-uninstall-btn");
  for (var j = 0; j < unBtns.length; j++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var scope = btn.dataset.scope;
        uninstallSkill(skill, scope);
      });
    })(unBtns[j]);
  }
}

