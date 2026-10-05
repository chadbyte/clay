import { skillState, basePath, getInstalledInfo, scopeLabel } from './skills-state.js';
import { renderDetail } from './skills-detail.js';
import { uninstallSkill } from './skills-actions.js';
export { handleSkillInstalled, handleSkillUninstalled } from './skills-actions.js';
import { openMcpSkillsWorkbench, closeMcpSkillsWorkbench } from './mcp-skills-workbench.js';
import { iconHtml, refreshIcons } from './icons.js';
import { escapeHtml } from './utils.js';
import { store } from './store.js';

var modal;
var contentEl;
export function initSkills() {

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
    backBtn.setAttribute("aria-label", "Back to skills");
    backBtn.addEventListener("click", showListView);
  }

  if (backdrop) {
    backdrop.addEventListener("click", closeSkillsModal);
  }

  store.subscribe(function (state, previous) {
    var next = state.mcpSkillsWorkbench || {}; var old = previous.mcpSkillsWorkbench || {};
    if (state.skillsRefreshVersion !== previous.skillsRefreshVersion && skillState().activeTab === 'installed' && skillState().currentView === 'list') loadInstalledSkills();
    if (next.open && next.tab === 'skills' && (!old.open || old.tab !== 'skills')) activateSkills();
  });

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
    searchInput.setAttribute("aria-label", "Search skills");
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim();
      skillState().searchQuery = q;
      updateSearchControls();
      if (skillState().searchTimer) clearTimeout(skillState().searchTimer);
      if (!q) {
        // Clear search — restore tab view
        var tabsEl = modal.querySelector(".skills-tabs");
        if (tabsEl) tabsEl.style.display = "";
        loadSkills(skillState().activeTab);
        return;
      }
      // Hide tabs during search
      var tabsEl2 = modal.querySelector(".skills-tabs");
      if (tabsEl2) tabsEl2.style.display = "none";
      skillState().searchTimer = setTimeout(function () {
        loadSearchResults(q);
      }, 300);
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", function () {
      if (searchInput) { searchInput.value = ""; }
      skillState().searchQuery = "";
      updateSearchControls();
      if (skillState().searchTimer) clearTimeout(skillState().searchTimer);
      var tabsEl = modal.querySelector(".skills-tabs");
      if (tabsEl) tabsEl.style.display = "";
      loadSkills(skillState().activeTab);
      if (searchInput) searchInput.focus();
    });
  }

  // "/" key focuses search when modal is open
  document.addEventListener("keydown", function (e) {
    if (e.target && (e.target.matches("input, textarea") || e.target.isContentEditable)) return;
    if (e.key === "/" && modal && !modal.classList.contains("hidden") && skillState().currentView === "list") {
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
        if (tabName === skillState().activeTab && skillState().currentView === "list" && !skillState().searchQuery) return;
        skillState().activeTab = tabName;
        skillState().currentView = "list";
        // Clear search when switching tabs
        skillState().searchQuery = "";
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
      if (skillState().currentView === "detail") {
        showListView();
      } else {
        closeSkillsModal();
      }
    }
  });
}

function fetchInstalledSkills() {
  return fetch(basePath() + "api/installed-skills")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      skillState().installedSkills = data.installed || {};
    })
    .catch(function () {
      skillState().installedSkills = {};
    });
}

function openSkillsModal() { openMcpSkillsWorkbench("skills"); }

function activateSkills() {
  if (!modal) return;
  var target = String(store.get('currentSlug')) + ':' + String(store.get('myUserId'));
  if (skillState().loadedFor === target) return;
  skillState().loadedFor = target;
  updateTabUI();
  refreshIcons(modal);
  skillState().currentView = "list";
  var backBtn = document.getElementById("skills-back-btn");
  if (backBtn) backBtn.classList.add("hidden");
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl) tabsEl.style.display = "";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "";
  var searchInput = document.getElementById("skills-search-input");
  if (searchInput) { searchInput.value = ""; skillState().searchQuery = ""; }
  // Load the current project inventory once; installation events refresh it.
  fetchInstalledSkills().then(function () {
    loadSkills(skillState().activeTab);
  });
}

function closeSkillsModal() {
  if (!modal) return;
  closeMcpSkillsWorkbench();
}

function updateTabUI() {
  var tabs = modal.querySelectorAll(".skills-tab");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].dataset.tab === skillState().activeTab) {
      tabs[i].classList.add("active");
    } else {
      tabs[i].classList.remove("active");
    }
  }
}

function loadSkills(tab) {
  // Always ensure tabs and search are visible when loading list view
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl && !skillState().searchQuery) tabsEl.style.display = "";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "";

  // Installed tab — uses local data, not skills.sh
  if (tab === "installed") {
    loadInstalledSkills();
    return;
  }

  // Check cache
  if (skillState().skillsData[tab]) {
    renderList(skillState().skillsData[tab], tab);
    return;
  }

  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Loading skills...</div>';

  fetch("/api/skills?tab=" + encodeURIComponent(tab))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var skills = data.skills || [];
      skillState().skillsData[tab] = skills;
      renderList(skills, tab);
    })
    .catch(function (err) {
      contentEl.innerHTML = '<div class="skills-empty">Failed to load skills</div>';
    });
}

function loadInstalledSkills() {
  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Loading installed skills...</div>';

  fetch(basePath() + "api/installed-skills")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      skillState().installedSkills = data.installed || {};
      renderInstalledList(skillState().installedSkills);
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
          '<span class="skills-installed-badge">' + iconHtml("check") + ' ' + (info.source === "clay-builtin" ? "Built-in" : scopeLabel(info.scope)) + '</span>' +
        '</div>' +
        (desc ? '<div class="skills-installed-item-desc">' + escapeHtml(desc) + '</div>' : '') +
      '</div>' +
      '<div class="skills-installed-item-actions">' +
        (info.source === "clay-builtin" ? "" : buildUninstallButtons(name, info.scope)) +
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
  if (q !== skillState().searchQuery) return;

  // Check cache
  if (skillState().searchCache[q]) {
    renderList(skillState().searchCache[q], "search");
    return;
  }

  contentEl.innerHTML = '<div class="skills-loading"><div class="skills-spinner"></div> Searching...</div>';

  fetch("/api/skills/search?q=" + encodeURIComponent(q))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (q !== skillState().searchQuery) return; // stale
      var skills = data.skills || [];
      skillState().searchCache[q] = skills;
      renderList(skills, "search");
    })
    .catch(function (err) {
      if (q !== skillState().searchQuery) return;
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
    contentEl.innerHTML = '<div class="skills-empty">' + (skillState().searchQuery ? "No matching skills" : "No skills found") + '</div>';
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
      installedBadge = '<span class="skills-installed-badge">' + iconHtml("check") + ' ' + (info.source === "clay-builtin" ? "Built-in" : scopeLabel(info.scope)) + '</span>';
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
  skillState().currentView = "detail";

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
  skillState().currentView = "list";
  var tabsEl = modal.querySelector(".skills-tabs");
  if (tabsEl) tabsEl.style.display = skillState().searchQuery ? "none" : "";
  var searchEl = document.getElementById("skills-search");
  if (searchEl) searchEl.style.display = "";
  var backBtn = document.getElementById("skills-back-btn");
  if (backBtn) backBtn.classList.add("hidden");
  if (skillState().searchQuery) {
    loadSearchResults(skillState().searchQuery);
  } else {
    loadSkills(skillState().activeTab);
  }
}
