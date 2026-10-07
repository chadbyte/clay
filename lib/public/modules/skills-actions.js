import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, showToast } from './utils.js';
import { store } from './store.js';
import { skillState, content, basePath, getInstalledInfo, scopeLabel, patchSkills } from './skills-state.js';
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
  }).then(function (res) { if (!res.ok) throw new Error('Request rejected'); }).catch(function () {
    showToast('Could not start installation. Try again.', 'error');
    // Re-enable buttons on fetch error
    for (var j = 0; j < btns.length; j++) {
      btns[j].disabled = false;
      btns[j].classList.remove("installing");
      btns[j].textContent = "Add to " + scopeLabel(btns[j].dataset.scope).toLowerCase();
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
    patchSkills({ skillsData: {}, searchCache: {}, inventoryLoaded: false });

    // If we're on the detail view for this skill, re-render it
    if (skillState().currentView === "detail" && skillState().selectedSkill === skill) {
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
    if (skillState().selectedSkill !== skill) return;
    var btns = content().querySelectorAll(".skills-install-btn.installing");
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = false;
      btns[i].classList.remove("installing");
      // We can't easily restore the original text, so just set generic labels
      btns[i].innerHTML = iconHtml("plus") + " Add to " + scopeLabel(btns[i].dataset.scope).toLowerCase();
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
  }).then(function (res) { if (!res.ok) throw new Error('Request rejected'); }).catch(function () {
    showToast('Could not remove this skill. Try again.', 'error');
    if (unBtn) {
      unBtn.disabled = false;
      unBtn.classList.remove("uninstalling");
      unBtn.textContent = "Remove";
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
    patchSkills({ skillsData: {}, searchCache: {}, inventoryLoaded: false });

    // If we're on the detail view, re-render buttons
    if (skillState().currentView === "detail" && skillState().selectedSkill === skill) {
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
    if (skillState().selectedSkill !== skill) return;
    var unBtn = content().querySelector('.skills-uninstall-btn[data-scope="' + scope + '"]');
    if (unBtn) {
      unBtn.disabled = false;
      unBtn.classList.remove("uninstalling");
      unBtn.textContent = "Remove";
      refreshIcons(unBtn);
    }
  }
}

function updateDetailInstallButtons(skillId) {
  if (skillState().selectedSkill !== skillId) return;
  var data = skillState().detailData || {}, block = content().querySelector('[data-skill-actions]');
  var note = content().querySelector('.skills-local-note');
  if (note) note.hidden = !getInstalledInfo(skillId);
  if (!block) return;
  block.innerHTML = data._installed ? buildLocalActionsHtml(skillId) : buildInstallButtonsHtml(skillId, data._source || '', skillId);
  refreshIcons(); attachInstallHandlers(block, data._source || '', skillId);
}

export function buildLocalActionsHtml(skillId) {
  var info = getInstalledInfo(skillId);
  if (!info) return '<p class="skills-removed-status">Removed from your library.</p>';
  if (info.source === 'clay-builtin') return '<div class="skills-installed-status">' + iconHtml('circle-check') + ' Built in to Clay</div>';
  var scopes = info.scope === 'both' ? ['project', 'global'] : [info.scope];
  return scopes.map(function (scope) { return '<div class="skills-installed-row"><span class="skills-installed-status compact">' + iconHtml('circle-check') + ' ' + scopeLabel(scope) + '</span><button type="button" class="skills-uninstall-btn" data-scope="' + scope + '" aria-label="Remove from ' + scopeLabel(scope) + '">Remove</button></div>'; }).join('');
}

export function buildInstallButtonsHtml(skillId, source, skill) {
  var info = getInstalledInfo(skillId);
  if (info && info.source === 'clay-builtin') return buildLocalActionsHtml(skillId);
  var html = '<div class="skills-install-actions" data-detail-source="' + escapeHtml(source) + '" data-detail-skill="' + escapeHtml(skill) + '">';
  if (info) html += buildLocalActionsHtml(skillId);
  ['project', 'global'].forEach(function (scope) {
    if (info && (info.scope === scope || info.scope === 'both')) return;
    html += '<button type="button" class="skills-install-btn' + (scope === 'global' ? ' secondary' : '') + '" data-scope="' + scope + '">' + iconHtml('plus') + ' Add to ' + scopeLabel(scope).toLowerCase() + '</button>';
  });
  return html + '</div>';
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
        if (btn.dataset.confirmed === 'true') {
          btn.dataset.confirmed = '';
          var existingCancel = btn.parentElement.querySelector('.skills-cancel-remove');
          if (existingCancel) existingCancel.remove();
          uninstallSkill(skill, scope); return;
        }
        btn.dataset.confirmed = 'true'; btn.textContent = 'Confirm removal';
        var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'skills-cancel-remove'; cancel.textContent = 'Cancel';
        cancel.onclick = function () { btn.dataset.confirmed = ''; btn.textContent = 'Remove'; cancel.remove(); };
        btn.after(cancel);
      });
    })(unBtns[j]);
  }
}

