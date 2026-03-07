import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml, copyToClipboard, showToast } from './utils.js';

var ctx;
var modal;
var contentEl;
var activeTab = "all";
var currentView = "list"; // "list" or "detail"
var skillsData = {}; // cache per tab
var basePath = "";
var installedSkills = {}; // { skillName: { scope: "global"|"project"|"both" } }
var searchQuery = "";
var searchTimer = null;
var searchCache = {}; // cache per query

export function initSkills(_ctx) {
  ctx = _ctx;
  basePath = _ctx.basePath || "";

  modal = document.getElementById("skills-modal");
  contentEl = document.getElementById("skills-content");
  var btn = document.getElementById("skills-btn");
  var closeBtn = document.getElementById("skills-modal-close");
  var backBtn = document.getElementById("skills-back-btn");
  var backdrop = modal ? modal.querySelector(".confirm-backdrop") : null;

  if (btn) {
    btn.addEventListener("click", function () {
      openSkillsModal();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", closeSkillsModal);
  }

  if (backBtn) {
    backBtn.addEventListener("click", showListView);
  }

  if (backdrop) {
    backdrop.addEventListener("click", closeSkillsModal);
  }

  // Search input
  var searchInput = document.getElementById("skills-search-input");
  var searchHint = document.getElementById("skills-search-hint");
  var searchClear = document.getElementById("skills-search-clear");

  function updateSearchControls() {
    var hasValue = searchInput && searchInput.value.length > 0;
    if (searchHint) searchHint.style.display = hasValue ? "none" : "";
    if (searchClear) {
      if (hasValue) { searchClear.classList.remove("hidden"); }
      else { searchClear.classList.add("hidden"); }
    }
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim();
      searchQuery = q;
      updateSearchControls();
      if (searchTimer) clearTimeout(searchTimer);
      if (!q) {
        // Clear search — restore tab view
        var tabsEl = modal.querySelector(".skills-tabs");
        if (tabsEl) tabsEl.style.display = "";
        loadSkills(activeTab);
        return;
      }
      // Hide tabs during search
      var tabsEl2 = modal.querySelector(".skills-tabs");
      if (tabsEl2) tabsEl2.style.display = "none";
      searchTimer = setTimeout(function () {
        loadSearchResults(q);
      }, 300);
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      if (searchInput) { searchInput.value = ""; }
      searchQuery = "";
      updateSearchControls();
      if (searchTimer) clearTimeout(searchTimer);
      var tabsEl = modal.querySelector(".skills-tabs");
      if (tabsEl) tabsEl.style.display = "";
      loadSkills(activeTab);
      if (searchInput) searchInput.focus();
    });
  }

  // "/" key focuses search when modal is open
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && modal && !modal.classList.contains("hidden") && currentView === "list") {
      if (document.activeElement !== searchInput) {
        e.preventDefault();
        if (searchInput) searchInput.focus();
      }
    }
  });

  // Tab clicks
  var tabs = modal ? modal.querySelectorAll(".skills-tab") : [];
  for (var i = 0; i < tabs.length; i++) {
    (function (tab) {
      tab.addEventListener("click", function () {
        var tabName = tab.dataset.tab;
        if (tabName === activeTab && currentView === "list" && !searchQuery) return;
        activeTab = tabName;
        currentView = "list";
        // Clear search when switching tabs
        searchQuery = "";
        var si = document.getElementById("skills-search-input");
        if (si) si.value = "";
        updateSearchControls();
        updateTabUI();
        loadSkills(tabName);
      });
    })(tabs[i]);
  }

  // Esc key
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      if (currentView === "detail") {
        showListView();
      } else {
        closeSkillsModal();
      }
    }
  });
}

function fetchInstalledSkills() {
  return fetch(basePath + "api/installed-skills")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      installedSkills = data.installed || {};
    })
    .catch(function () {
      installedSkills = {};
    });
}

function getInstalledInfo(skillId) {
  return installedSkills[skillId] || null;
}

function scopeLabel(scope) {
  if (scope === "both") return "Global + Project";
  if (scope === "project") return "Project";
  return "Global";
}

function openSkillsModal() {
  if (!modal) return;
  modal.classList.remove("hidden");
  refreshIcons(modal);
  currentView = "list";
  var backBtn = document.getElementById("skills-back-btn");
  if (backBtn) backBtn.classList.add("hidden");
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl) tabsEl.style.display = "";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "";
  var searchInput = document.getElementById("skills-search-input");
  if (searchInput) { searchInput.value = ""; searchQuery = ""; }
  // Always refresh installed status on open
  fetchInstalledSkills().then(function () {
    loadSkills(activeTab);
  });
}

function closeSkillsModal() {
  if (!modal) return;
  modal.classList.add("hidden");
}

function updateTabUI() {
  var tabs = modal.querySelectorAll(".skills-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.tab === activeTab) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
}

function loadSkills(tab) {
  // Always ensure tabs and search are visible when loading list view
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl && !searchQuery) tabsEl.style.display = "";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "";

  // Installed tab — uses local data, not skills.sh
  if (tab === "installed") {
    loadInstalledSkills();
    return;
  }

  // Check cache
  if (skillsData[tab]) {
    renderList(skillsData[tab], tab);
    return;
  }

  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Loading skills...</div>';

  fetch("/api/skills?tab=" + encodeURIComponent(tab))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var skills = data.skills || [];
      skillsData[tab] = skills;
      renderList(skills, tab);
    })
    .catch(function (err) {
      contentEl.innerHTML = '<div class="skills-empty">Failed to load skills</div>';
    });
}

function loadInstalledSkills() {
  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Loading installed skills...</div>';

  fetch(basePath + "api/installed-skills")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      installedSkills = data.installed || {};
      renderInstalledList(installedSkills);
    })
    .catch(function () {
      contentEl.innerHTML = '<div class="skills-empty">Failed to load installed skills</div>';
    });
}

function renderInstalledList(installed) {
  var names = Object.keys(installed);
  if (!names.length) {
    contentEl.innerHTML = '<div class="skills-empty">No skills installed<div class="skills-empty-hint">Browse the other tabs to discover and install skills</div></div>';
    return;
  }

  var html = '<div class="skills-list">';

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var info = installed[name];
    var desc = info.description || "";

    html += '<div class="skills-installed-item">' +
      '<div class="skills-installed-item-info">' +
        '<div class="skills-installed-item-header">' +
          '<span class="skills-installed-item-name">' + escapeHtml(name) + '</span>' +
          '<span class="skills-installed-badge">' + iconHtml("check") + ' ' + scopeLabel(info.scope) + '</span>' +
        '</div>' +
        (desc ? '<div class="skills-installed-item-desc">' + escapeHtml(desc) + '</div>' : '') +
      '</div>' +
      '<div class="skills-installed-item-actions">' +
        buildUninstallButtons(name, info.scope) +
      '</div>' +
    '</div>';
  }

  html += '</div>';
  contentEl.innerHTML = html;
  refreshIcons(contentEl);

  // Attach uninstall handlers
  var unBtns = contentEl.querySelectorAll(".skills-uninstall-btn");
  for (var j = 0; j < unBtns.length; j++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        uninstallSkill(btn.dataset.skill, btn.dataset.scope);
      });
    })(unBtns[j]);
  }
}

function buildUninstallButtons(skillName, scope) {
  var html = '';
  if (scope === "both") {
    html += '<button class="skills-uninstall-btn" data-skill="' + escapeHtml(skillName) + '" data-scope="project" title="Uninstall (Project)">' + iconHtml("x") + '</button>';
    html += '<button class="skills-uninstall-btn" data-skill="' + escapeHtml(skillName) + '" data-scope="global" title="Uninstall (Global)">' + iconHtml("x") + '</button>';
  } else {
    html += '<button class="skills-uninstall-btn" data-skill="' + escapeHtml(skillName) + '" data-scope="' + escapeHtml(scope) + '" title="Uninstall">' + iconHtml("x") + '</button>';
  }
  return html;
}

function loadSearchResults(q) {
  // Stale check — if query changed since this was scheduled, skip
  if (q !== searchQuery) return;

  // Check cache
  if (searchCache[q]) {
    renderList(searchCache[q], "search");
    return;
  }

  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Searching...</div>';

  fetch("/api/skills/search?q=" + encodeURIComponent(q))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (q !== searchQuery) return; // stale
      var skills = data.skills || [];
      searchCache[q] = skills;
      renderList(skills, "search");
    })
    .catch(function (err) {
      if (q !== searchQuery) return;
      contentEl.innerHTML = '<div class="skills-empty">Search failed</div>';
    });
}

function formatInstalls(n) {
  if (typeof n !== "number") return n || "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function renderList(skills, tab) {
  if (!skills.length) {
    contentEl.innerHTML = '<div class="skills-empty">' + (searchQuery ? "No matching skills" : "No skills found") + '</div>';
    return;
  }

  var isHot = tab === "hot";
  var html = '<div class="skills-list">';

  for (var i = 0; i < skills.length; i++) {
    var s = skills[i];
    var info = getInstalledInfo(s.skillId || s.name);
    var changeHtml = "";
    if (isHot && typeof s.change === "number" && s.change !== 0) {
      var cls = s.change > 0 ? "" : " negative";
      changeHtml = '<span class="skills-item-change' + cls + '">' +
        (s.change > 0 ? "+" : "") + formatInstalls(s.change) + '</span>';
    }

    var installedBadge = "";
    if (info) {
      installedBadge = '<span class="skills-installed-badge">' + iconHtml("check") + ' ' + scopeLabel(info.scope) + '</span>';
    }

    html += '<div class="skills-item' + (info ? " installed" : "") + '" data-source="' + escapeHtml(s.source) + '" data-skill="' + escapeHtml(s.skillId) + '">' +
      '<span class="skills-item-rank">' + (i + 1) + '</span>' +
      '<div class="skills-item-info">' +
        '<div class="skills-item-name">' + escapeHtml(s.name) + installedBadge + '</div>' +
        '<div class="skills-item-source">' + escapeHtml(s.source) + '</div>' +
      '</div>' +
      '<div class="skills-item-stats">' +
        '<span class="skills-item-installs">' + formatInstalls(s.installs) + '</span>' +
        changeHtml +
      '</div>' +
    '</div>';
  }

  html += '</div>';
  contentEl.innerHTML = html;
  refreshIcons(contentEl);

  // Attach click handlers
  var items = contentEl.querySelectorAll(".skills-item");
  for (var j = 0; j < items.length; j++) {
    (function (item) {
      item.addEventListener("click", function () {
        var source = item.dataset.source;
        var skill = item.dataset.skill;
        loadDetail(source, skill);
      });
    })(items[j]);
  }
}

function loadDetail(source, skill) {
  currentView = "detail";

  // Hide tabs and search
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl) tabsEl.style.display = "none";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "none";

  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Loading skill details...</div>';

  fetch("/api/skills/detail?source=" + encodeURIComponent(source) + "&skill=" + encodeURIComponent(skill))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      data._source = source;
      data._skill = skill;
      renderDetail(data);
    })
    .catch(function (err) {
      contentEl.innerHTML = '<div class="skills-empty">Failed to load skill details</div>';
    });
}

function showListView() {
  currentView = "list";
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl) tabsEl.style.display = searchQuery ? "none" : "";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "";
  var backBtn = document.getElementById("skills-back-btn");
  if (backBtn) backBtn.classList.add("hidden");
  if (searchQuery) {
    loadSearchResults(searchQuery);
  } else {
    loadSkills(activeTab);
  }
}

function renderDetail(data) {
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

  contentEl.innerHTML = html;
  refreshIcons(contentEl);

  // Copy button handler
  var copyBtn = contentEl.querySelector(".skills-copy-btn");
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
  var installActions = contentEl.querySelector(".skills-install-actions");
  if (installActions) {
    attachInstallHandlers(installActions, data._source, data._skill);
  }
}

function installSkill(source, skill, scope) {
  var url = "https://github.com/" + source;

  // Set all install buttons in the detail view to installing state
  var btns = contentEl.querySelectorAll(".skills-install-btn:not(.installed-state)");
  for (var i = 0; i < btns.length; i++) {
    btns[i].disabled = true;
    btns[i].classList.add("installing");
    btns[i].innerHTML = '<div class="skills-btn-spinner"></div> Installing...';
  }

  fetch(basePath + "api/install-skill", {
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
    // Update installedSkills cache
    var existing = installedSkills[skill];
    if (existing) {
      if (existing.scope !== scope && existing.scope !== "both") {
        existing.scope = "both";
      }
    } else {
      installedSkills[skill] = { scope: scope };
    }

    // Invalidate skills data cache so list refreshes with updated badges
    skillsData = {};

    // If we're on the detail view for this skill, re-render it
    if (currentView === "detail") {
      var detailEl = contentEl.querySelector(".skills-detail");
      if (detailEl) {
        // Re-render the install section in the sidebar
        updateDetailInstallButtons(skill);
      }
    }

    // If we're on the installed tab, refresh it
    if (activeTab === "installed" && currentView === "list") {
      loadInstalledSkills();
    }
  } else {
    // Show error toast
    showToast("Failed to install " + skill + (msg.error ? ": " + msg.error : ""), "error");
    // Re-enable buttons
    var btns = contentEl.querySelectorAll(".skills-install-btn.installing");
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = false;
      btns[i].classList.remove("installing");
      // We can't easily restore the original text, so just set generic labels
      btns[i].innerHTML = iconHtml("download") + " Install";
    }
  }
}

function uninstallSkill(skill, scope) {
  // Set the uninstall button to loading state
  var unBtn = contentEl.querySelector('.skills-uninstall-btn[data-scope="' + scope + '"]');
  if (unBtn) {
    unBtn.disabled = true;
    unBtn.classList.add("uninstalling");
    unBtn.innerHTML = '<div class="skills-btn-spinner small"></div>';
  }

  fetch(basePath + "api/uninstall-skill", {
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
    // Update installedSkills cache
    var existing = installedSkills[skill];
    if (existing) {
      if (existing.scope === "both") {
        // Downgrade from "both" to whichever scope remains
        existing.scope = scope === "global" ? "project" : "global";
      } else {
        // Fully uninstalled
        delete installedSkills[skill];
      }
    }

    // Invalidate skills data cache so list refreshes
    skillsData = {};

    // If we're on the detail view, re-render buttons
    if (currentView === "detail") {
      var detailEl = contentEl.querySelector(".skills-detail");
      if (detailEl) {
        updateDetailInstallButtons(skill);
      }
    }

    // If we're on the installed tab, refresh it
    if (activeTab === "installed" && currentView === "list") {
      loadInstalledSkills();
    }
  } else {
    showToast("Failed to uninstall " + skill + (msg.error ? ": " + msg.error : ""), "error");
    // Re-enable the uninstall button
    var unBtn = contentEl.querySelector('.skills-uninstall-btn[data-scope="' + scope + '"]');
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
  var sidebar = contentEl.querySelector(".skills-detail-sidebar");
  if (!sidebar) return;

  // Find the install actions or installed status block (last .skills-meta-block)
  var blocks = sidebar.querySelectorAll(".skills-meta-block");
  var lastBlock = blocks[blocks.length - 1];
  if (!lastBlock) return;

  // Get source/skill from the current detail view data attributes
  var sourceEl = sidebar.querySelector("[data-detail-source]");
  if (!sourceEl) sourceEl = contentEl.querySelector("[data-detail-source]");
  var source = sourceEl ? sourceEl.dataset.detailSource : "";
  var skill = sourceEl ? sourceEl.dataset.detailSkill : skillId;

  lastBlock.innerHTML = buildInstallButtonsHtml(skillId, source, skill);
  refreshIcons(lastBlock);
  attachInstallHandlers(lastBlock, source, skill);
}

function buildInstallButtonsHtml(skillId, source, skill) {
  var info = getInstalledInfo(skillId);

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

function attachInstallHandlers(container, source, skill) {
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

function sanitizeSkillHtml(rawHtml) {
  if (typeof DOMPurify !== "undefined") {
    return DOMPurify.sanitize(rawHtml);
  }
  return rawHtml;
}
