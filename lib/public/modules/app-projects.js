// app-projects.js - Project list, switching, add/remove project modals
// Extracted from app.js (PR-29)

import { escapeHtml, showToast } from './utils.js';
import { refreshIcons } from './icons.js';
import { parseEmojis } from './markdown.js';
import { store } from './store.js';
import { resetModelPickerState } from './model-picker.js';
import { getWs, setWs } from './ws-ref.js';
import { getMessagesEl, getStatusDot } from './dom-refs.js';
import { userAvatarUrl } from './avatar.js';
import { showConfirm } from './app-misc.js';
// renderUserStrip is now reactive via store subscriber in sidebar-mates.js
import { renderIconStrip } from './sidebar-projects.js';
import { updateCrossProjectBlink, stopUrgentBlink, setActivity } from './app-favicon.js';
import { spawnDustParticles } from './sidebar.js';
import { isSearchOpen, closeSearch } from './session-search.js';
import { exitDmMode } from './app-dm.js';
import { isHomeHubVisible, hideHomeHub, showHomeHub } from './app-home-hub.js';
import { closeArticle as closeWhatsNewArticle } from './whats-new-article.js';
import { resetFileBrowser } from './filebrowser.js';
import { closeNotesBrowser } from './sticky-notes-browser.js';
import { hideMemory } from './mate-memory.js';
import { isSchedulerOpen, closeScheduler, resetScheduler } from './scheduler.js';
import { connect, cancelReconnect, setStatus } from './app-connection.js';
import { setTurnCounter, setPrependAnchor, setActivityEl, setIsUserScrolledUp, hideSuggestionChips } from './app-rendering.js';
import { resetToolState, enableMainInput, resetTurnMetaCost } from './tools.js';
import { resetShellCommand } from './shell-command.js';
import { clearPendingImages } from './input.js';
import { clearAllMentionActive } from './sidebar-mates.js';
import { setRewindMode } from './rewind.js';
import { resetUsage, resetContext } from './app-panels.js';
import { resetRateLimitState } from './app-rate-limit.js';
import { closeSessionInfoPopover } from './app-header.js';
import { resetDebateState } from './debate.js';
import { removeDebateBottomBar } from './app-debate-ui.js';
import { closeProjectSettings } from './project-settings.js';
import { chooseProjectAfterRemoval } from './project-removal-target.js';
import { isProjectActivated, isProjectActivationPending, isProjectContextConnected, projectWsPath } from './project-activation.js';
import { rememberHomePrimarySurface } from './home-surface.js';

// --- Module-owned state ---
var cachedProjects = [];
var cachedProjectCount = 0;
var cachedRemovedProjects = [];
var pendingRemoveSlug = null;
var pendingRemoveName = null;

// Add-project modal state
var addProjectModal = null;
var addProjectInput = null;
var addProjectCreateInput = null;
var addProjectCloneInput = null;
var addProjectCloneProgress = null;
var addProjectSuggestions = null;
var addProjectError = null;
var addProjectOk = null;
var addProjectCancel = null;
var addProjectModeBtns = null;
var addProjectPanels = null;
var addProjectRemoved = null;
var addProjectPrefixEl = null;
var addProjectPrefixValue = "";
var addProjectDebounce = null;
var addProjectActiveIdx = -1;
var addProjectMode = "existing";

export function initProjects() {
  // Init add-project modal DOM refs
  addProjectModal = document.getElementById("add-project-modal");
  addProjectInput = document.getElementById("add-project-input");
  addProjectCreateInput = document.getElementById("add-project-create-input");
  addProjectCloneInput = document.getElementById("add-project-clone-input");
  addProjectCloneProgress = document.getElementById("add-project-clone-progress");
  addProjectSuggestions = document.getElementById("add-project-suggestions");
  addProjectError = document.getElementById("add-project-error");
  addProjectOk = document.getElementById("add-project-ok");
  addProjectCancel = document.getElementById("add-project-cancel");
  addProjectModeBtns = addProjectModal.querySelectorAll(".add-project-mode-btn");
  addProjectPanels = addProjectModal.querySelectorAll(".add-project-panel");
  addProjectRemoved = document.getElementById("add-project-removed");
  addProjectPrefixEl = document.getElementById("add-project-prefix");

  // Mode button click listeners
  for (var mbi = 0; mbi < addProjectModeBtns.length; mbi++) {
    addProjectModeBtns[mbi].addEventListener("click", function () {
      if (this.disabled) return;
      switchAddProjectMode(this.dataset.mode);
    });
  }

  // Existing project input listeners
  addProjectInput.addEventListener("focus", function () {
    var val = addProjectInput.value;
    if ((val || addProjectPrefixValue) && addProjectSuggestions.children.length === 0) {
      requestBrowseDir(val);
    } else if (addProjectSuggestions.children.length > 0) {
      addProjectSuggestions.classList.remove("hidden");
    }
  });

  addProjectModal.querySelector(".confirm-dialog").addEventListener("click", function (e) {
    if (e.target === addProjectInput || addProjectInput.contains(e.target)) return;
    if (e.target === addProjectSuggestions || addProjectSuggestions.contains(e.target)) return;
    addProjectSuggestions.classList.add("hidden");
    addProjectActiveIdx = -1;
  });

  addProjectInput.addEventListener("input", function () {
    var val = addProjectInput.value;
    addProjectError.classList.add("hidden");
    if (addProjectDebounce) clearTimeout(addProjectDebounce);
    addProjectDebounce = setTimeout(function () {
      requestBrowseDir(val);
    }, 200);
  });

  addProjectInput.addEventListener("keydown", function (e) {
    var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length > 0) {
        var next = addProjectActiveIdx < items.length - 1 ? addProjectActiveIdx + 1 : 0;
        setActiveIdx(next);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length > 0) {
        var prev = addProjectActiveIdx > 0 ? addProjectActiveIdx - 1 : items.length - 1;
        setActiveIdx(prev);
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      var target = addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length
        ? items[addProjectActiveIdx]
        : items.length > 0 ? items[0] : null;
      if (target) {
        var fullP = target.dataset.path + "/";
        addProjectInput.value = stripPrefix(fullP);
        addProjectError.classList.add("hidden");
        requestBrowseDir(addProjectInput.value);
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (addProjectActiveIdx >= 0 && addProjectActiveIdx < items.length) {
        var fullPicked = items[addProjectActiveIdx].dataset.path + "/";
        addProjectInput.value = stripPrefix(fullPicked);
        addProjectError.classList.add("hidden");
        requestBrowseDir(addProjectInput.value);
        return;
      }
      submitAddProject();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeAddProjectModal();
      return;
    }
  });

  // Enter key on create/clone inputs
  addProjectCreateInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitAddProject(); }
    if (e.key === "Escape") { e.preventDefault(); closeAddProjectModal(); }
  });

  addProjectCloneInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitAddProject(); }
    if (e.key === "Escape") { e.preventDefault(); closeAddProjectModal(); }
  });

  addProjectOk.addEventListener("click", function () { submitAddProject(); });
  addProjectCancel.addEventListener("click", function () { closeAddProjectModal(); });

  // Close on backdrop click
  addProjectModal.querySelector(".confirm-backdrop").addEventListener("click", function () {
    closeAddProjectModal();
  });

  // Project list add button
  var projectListAddBtn = document.getElementById("project-list-add");
  if (projectListAddBtn) {
    projectListAddBtn.addEventListener("click", function () {
      openAddProjectModal();
    });
  }
}

// --- State accessors ---

export function getCachedProjects() { return cachedProjects; }
export function setCachedProjects(v) { cachedProjects = v; }
export function getCachedProjectCount() { return cachedProjectCount; }
export function setCachedProjectCount(v) { cachedProjectCount = v; }
export function getCachedRemovedProjects() { return cachedRemovedProjects; }
export function setCachedRemovedProjects(v) { cachedRemovedProjects = v; }

// --- Functions ---

export function updateProjectList(msg) {
  if (typeof msg.projectCount === "number") cachedProjectCount = msg.projectCount;

  // Compare projects before caching to detect actual changes
  var projectsChanged = false;
  if (msg.projects) {
    var projectsJson = JSON.stringify(msg.projects);
    if (projectsJson !== _lastProjectsJson) {
      projectsChanged = true;
      _lastProjectsJson = projectsJson;
    }
    cachedProjects = msg.projects;
  }
  if (msg.removedProjects) cachedRemovedProjects = msg.removedProjects;
  else if (msg.removedProjects === undefined) { /* keep cached */ }
  else cachedRemovedProjects = [];

  // Only re-render project strip + title bar if data or active slug changed
  var currentSlug = store.get('currentSlug');
  var slugChanged = currentSlug !== _lastRenderedSlug;
  if (projectsChanged || slugChanged) {
    _lastRenderedSlug = currentSlug;
    var count = cachedProjectCount || 0;
    renderProjectList();
    var projectHint = document.getElementById("project-hint");
    if (count === 1 && projectHint) {
      try {
        if (!localStorage.getItem("clay-project-hint-dismissed")) {
          projectHint.classList.remove("hidden");
        }
      } catch (e) {}
    } else if (projectHint) {
      projectHint.classList.add("hidden");
    }
  }

  // Update topbar with server-wide presence (renderTopbarPresence has its own guard)
  if (msg.serverUsers) {
    var newOnlineIds = msg.serverUsers.map(function (u) { return u.id; });
    var prevOnlineIds = store.get('cachedOnlineIds') || [];
    store.set({ cachedOnlineIds: newOnlineIds });
    renderTopbarPresence(msg.serverUsers);
    // renderUserStrip is handled by the store subscriber (fingerprint-guarded)
  }

  // Update user strip (DM targets) - renderUserStrip has its own fingerprint guard
  if (msg.allUsers) {
    store.set({ cachedAllUsers: msg.allUsers });
    if (msg.dmFavorites) store.set({ cachedDmFavorites: msg.dmFavorites });
    if (msg.dmConversations) store.set({ cachedDmConversations: msg.dmConversations });
    // renderUserStrip is handled by the store subscriber
    var st2 = store.snap();
    var refreshedMyUser = st2.cachedAllUsers.find(function (u) { return u.id === st2.myUserId; });
    if (refreshedMyUser) {
      document.body.dataset.myDisplayName = refreshedMyUser.displayName || refreshedMyUser.username || "";
      document.body.dataset.myAvatarUrl = userAvatarUrl(refreshedMyUser, 36);
      var myMessageAvatars = document.querySelectorAll('.dm-bubble-avatar-me');
      for (var avatarIndex = 0; avatarIndex < myMessageAvatars.length; avatarIndex++) {
        myMessageAvatars[avatarIndex].src = document.body.dataset.myAvatarUrl;
      }
    }
    // Render my avatar (always present, hidden behind user-island)
    var meEl = document.getElementById("icon-strip-me");
    if (meEl && !meEl.hasChildNodes()) {
      var myUser = st2.cachedAllUsers.find(function (u) { return u.id === st2.myUserId; });
      if (myUser) {
        var meAvatar = document.createElement("img");
        meAvatar.className = "icon-strip-me-avatar";
        meAvatar.src = userAvatarUrl(myUser, 34);
        meEl.appendChild(meAvatar);
      }
    }
  }
}

var _lastTopbarUserIds = [];
var _lastProjectsJson = "";
var _lastRenderedSlug = null;
export function renderTopbarPresence(serverUsers) {
  var countEl = document.getElementById("client-count");
  if (!countEl) return;
  if (serverUsers.length > 1) {
    // Skip re-render if user list unchanged
    var newIds = serverUsers.map(function (u) { return u.id; }).sort();
    if (newIds.length === _lastTopbarUserIds.length && newIds.every(function (id, i) { return id === _lastTopbarUserIds[i]; })) return;
    _lastTopbarUserIds = newIds;
    countEl.innerHTML = "";
    for (var cui = 0; cui < serverUsers.length; cui++) {
      var cu = serverUsers[cui];
      var cuImg = document.createElement("img");
      cuImg.className = "client-avatar";
      cuImg.src = userAvatarUrl(cu, 24);
      cuImg.alt = cu.displayName;
      cuImg.dataset.tip = cu.displayName + " (@" + cu.username + ")";
      if (cui > 0) cuImg.style.marginLeft = "-6px";
      countEl.appendChild(cuImg);
    }
    countEl.classList.remove("hidden");
  } else {
    _lastTopbarUserIds = [];
    countEl.classList.add("hidden");
  }
}

export function renderProjectList() {
  var iconStripProjects = cachedProjects.filter(function (p) {
    return !p.isMate;
  }).map(function (p) {
    return {
      slug: p.slug,
      name: p.title || p.project,
      icon: p.icon || null,
      isProcessing: p.isProcessing,
      onlineUsers: p.onlineUsers || [],
      unread: p.unread || 0,
      pendingPermissions: p.pendingPermissions || 0,
      isWorktree: p.isWorktree || false,
      parentSlug: p.parentSlug || null,
      branch: p.branch || null,
      worktreeExternal: p.worktreeExternal === true,
    };
  });
  var st = store.snap();
  var iconStripActiveSlug = (st.mateProjectSlug && st.savedMainSlug) ? st.savedMainSlug : st.currentSlug;
  renderIconStrip(iconStripProjects, iconStripActiveSlug);
  // Update title bar project name and icon if it changed
  if (!st.mateProjectSlug) {
    for (var pi = 0; pi < cachedProjects.length; pi++) {
      if (cachedProjects[pi].slug === st.currentSlug) {
        var updatedName = cachedProjects[pi].title || cachedProjects[pi].project;
        var tbName = document.getElementById("title-bar-project-name");
        if (tbName && updatedName) tbName.textContent = updatedName;
        var tbIcon = document.getElementById("title-bar-project-icon");
        if (tbIcon) {
          var pIcon = cachedProjects[pi].icon || null;
          if (pIcon) {
            tbIcon.textContent = pIcon;
            parseEmojis(tbIcon);
            tbIcon.classList.add("has-icon");
            try { localStorage.setItem("clay-project-icon-" + (st.currentSlug || "default"), pIcon); } catch (e) {}
          } else {
            tbIcon.textContent = "";
            tbIcon.classList.remove("has-icon");
            try { localStorage.removeItem("clay-project-icon-" + (st.currentSlug || "default")); } catch (e) {}
          }
        }
        break;
      }
    }
  }
  // Re-apply current socket status to the active icon's dot
  var dot = getStatusDot();
  if (dot) {
    if (st.connected && st.processing) { dot.classList.add("connected"); dot.classList.add("processing"); }
    else if (st.connected) { dot.classList.add("connected"); }
  }
  updateCrossProjectBlink();
}

export function resetClientState() {
  resetModelPickerState();
  if (isSearchOpen()) closeSearch();
  getMessagesEl().innerHTML = "";
  store.set({ currentMsgEl: null });
  store.set({ currentFullText: "" });
  resetToolState();
  clearPendingImages();
  resetShellCommand();
  clearAllMentionActive();
  setActivityEl(null);
  store.set({ processing: false });
  setTurnCounter(0);
  store.set({ messageUuidMap: [] });
  store.set({ historyFrom: 0 });
  store.set({ historyTotal: 0 });
  setPrependAnchor(null);
  store.set({ loadingMore: false });
  setIsUserScrolledUp(false);
  document.getElementById("new-msg-btn").classList.add("hidden");
  setRewindMode(false);
  setActivity(null);
  setStatus("connected");
  if (!store.get('loopActive')) enableMainInput();
  resetUsage();
  resetTurnMetaCost();
  resetContext();
  resetRateLimitState();
  var headerCtx = store.get('headerContextEl');
  if (headerCtx) { headerCtx.remove(); store.set({ headerContextEl: null }); }
  hideSuggestionChips();
  closeSessionInfoPopover();
  stopUrgentBlink();
  // Clear debate UI and state from previous session
  store.set({ debateStickyState: null });
  resetDebateState();
  var debateBadges = document.querySelectorAll(".debate-header-badge");
  for (var dbi = 0; dbi < debateBadges.length; dbi++) debateBadges[dbi].remove();
  removeDebateBottomBar();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();
  var debateSticky = document.getElementById("debate-sticky");
  if (debateSticky) { debateSticky.classList.add("hidden"); debateSticky.innerHTML = ""; }
  var debateFloat = document.getElementById("debate-info-float");
  if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
}

export function switchProject(slug) {
  if (!slug) return;
  document.cookie = "clay_last_project=" + encodeURIComponent(slug) + "; Path=/; SameSite=Strict; Max-Age=31536000";
  var st = store.snap();
  var ws = getWs();
  var targetWsPath = projectWsPath(slug);
  var homeVisible = isHomeHubVisible();
  var alreadyInProject = isProjectActivated(st, slug, ws);
  var wasDm = st.dmMode;
  var wasMate = st.dmMode && st.dmTargetUser && st.dmTargetUser.isMate;
  if (st.dmMode) exitDmMode(wasMate);
  closeWhatsNewArticle();
  if (homeVisible && alreadyInProject) {
    rememberHomePrimarySurface("project", slug);
    hideHomeHub();
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", "/p/" + slug + "/");
    } else {
      history.pushState(null, "", "/p/" + slug + "/");
    }
    return;
  }
  if (alreadyInProject) {
    if (wasDm && ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "switch_session", id: store.get('activeSessionId') }));
    }
    return;
  }
  if (homeVisible) store.set({ pendingHomeProjectSlug: slug });
  if (isProjectActivationPending(store.snap(), slug, ws)) return;
  resetFileBrowser();
  closeNotesBrowser();
  hideMemory();
  if (isSchedulerOpen()) closeScheduler();
  resetScheduler(slug);
  store.set({ currentSlug: slug });
  store.set({ basePath: "/p/" + slug + "/" });
  store.set({ wsPath: targetWsPath });
  if (!homeVisible) {
    if (document.documentElement.classList.contains("pwa-standalone")) {
      history.replaceState(null, "", "/p/" + slug + "/");
    } else {
      history.pushState(null, "", "/p/" + slug + "/");
    }
  }
  resetClientState();
  connect();
}

export function completePendingProjectActivation() {
  var slug = store.get('pendingHomeProjectSlug');
  if (!slug || !isProjectActivated(store.snap(), slug, getWs())) return false;
  store.set({ pendingHomeProjectSlug: null });
  rememberHomePrimarySurface("project", slug);
  if (document.documentElement.classList.contains("pwa-standalone")) {
    history.replaceState(null, "", "/p/" + slug + "/");
  } else {
    history.pushState(null, "", "/p/" + slug + "/");
  }
  return true;
}

export function confirmCurrentProjectSessionActivation() {
  var slug = store.get('activeProjectSlug');
  if (!slug || !isProjectContextConnected(store.snap(), slug, getWs())) return false;
  store.set({ sessionActivatedProjectSlug: slug });
  return true;
}

export function finishProjectSessionActivation() {
  var confirmed = confirmCurrentProjectSessionActivation();
  if (!confirmed) return false;
  if (!store.get('pendingHomeProjectSlug')) return true;
  return completePendingProjectActivation();
}

export function showUpdateAvailable(msg) {
  // Update the settings panel button only (top bar pill replaced by notification center)
  var settingsUpdBtn = document.getElementById("settings-update-check");
  if (settingsUpdBtn && msg.version) {
    settingsUpdBtn.innerHTML = "";
    var ic = document.createElement("i");
    ic.setAttribute("data-lucide", "arrow-up-circle");
    settingsUpdBtn.appendChild(ic);
    settingsUpdBtn.appendChild(document.createTextNode(" Update available (v" + msg.version + ")"));
    settingsUpdBtn.classList.add("settings-btn-update-available");
    settingsUpdBtn.disabled = false;
    refreshIcons();
  }
}

// --- Remove project ---

export function confirmRemoveProject(slug, name) {
  pendingRemoveSlug = slug;
  pendingRemoveName = name;
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "remove_project_check", slug: slug }));
  }
}

export function handleRemoveProjectCheckResult(msg) {
  var slug = msg.slug || pendingRemoveSlug;
  var name = msg.name || pendingRemoveName || slug;
  if (!slug) return;

  if (msg.count > 0) {
    showRemoveProjectTaskDialog(slug, name, msg.count);
  } else {
    var isWt = slug.indexOf("--") !== -1;
    var confirmMsg = isWt
      ? 'Delete worktree "' + name + '"? The branch and working directory will be removed from disk.'
      : 'Remove "' + name + '"? You can re-add it later.';
    showConfirm(confirmMsg, function () {
      var iconEl = document.querySelector('.icon-strip-item[data-slug="' + slug + '"]');
      if (iconEl) {
        var rect = iconEl.getBoundingClientRect();
        spawnDustParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      setTimeout(function () {
        var ws = getWs();
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
        }
      }, 1000);
    }, "Remove", true);
  }
  pendingRemoveSlug = null;
  pendingRemoveName = null;
}

function showRemoveProjectTaskDialog(slug, name, taskCount) {
  var otherProjects = cachedProjects.filter(function (p) { return p.slug !== slug; });

  var modal = document.createElement("div");
  modal.className = "remove-project-task-modal";
  modal.innerHTML =
    '<div class="remove-project-task-backdrop"></div>' +
    '<div class="remove-project-task-dialog">' +
      '<div class="remove-project-task-title">Remove project "' + (name || slug) + '"</div>' +
      '<div class="remove-project-task-text">This project has <strong>' + taskCount + '</strong> task' + (taskCount > 1 ? 's' : '') + '/schedule' + (taskCount > 1 ? 's' : '') + '.</div>' +
      '<div class="remove-project-task-options">' +
        (otherProjects.length > 0
          ? '<div class="remove-project-task-label">Move tasks to:</div>' +
            '<select class="remove-project-task-select" id="rpt-move-target">' +
              otherProjects.map(function (p) {
                return '<option value="' + p.slug + '">' + (p.title || p.project || p.slug) + '</option>';
              }).join("") +
            '</select>' +
            '<button class="remove-project-task-btn move" id="rpt-move-btn">Move &amp; Remove</button>'
          : '') +
        '<button class="remove-project-task-btn delete" id="rpt-delete-btn">Delete all &amp; Remove</button>' +
        '<button class="remove-project-task-btn cancel" id="rpt-cancel-btn">Cancel</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  var backdrop = modal.querySelector(".remove-project-task-backdrop");
  var moveBtn = modal.querySelector("#rpt-move-btn");
  var deleteBtn = modal.querySelector("#rpt-delete-btn");
  var cancelBtn = modal.querySelector("#rpt-cancel-btn");
  var selectEl = modal.querySelector("#rpt-move-target");

  function close() { modal.remove(); }
  backdrop.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);

  if (moveBtn) {
    moveBtn.addEventListener("click", function () {
      var targetSlug = selectEl ? selectEl.value : null;
      var ws = getWs();
      if (ws && ws.readyState === 1 && targetSlug) {
        ws.send(JSON.stringify({ type: "remove_project", slug: slug, moveTasksTo: targetSlug }));
      }
      close();
    });
  }

  deleteBtn.addEventListener("click", function () {
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "remove_project", slug: slug }));
    }
    close();
  });
}

export function handleRemoveProjectResult(msg) {
  if (msg.ok) {
    var currentSlug = store.get('currentSlug');
    if (msg.slug === currentSlug) {
      var isWorktree = msg.slug.indexOf("--") !== -1;
      var targetSlug = chooseProjectAfterRemoval(cachedProjects, msg.slug);

      showToast(isWorktree ? "Worktree removed" : "Project removed", "success");
      closeProjectSettings();

      // Suppress disconnect overlay and reconnect by detaching the WS
      var ws = getWs();
      if (ws) { ws.onclose = null; ws.onerror = null; ws.close(); setWs(null); }
      cancelReconnect();
      store.set({ connected: false });
      document.getElementById("connect-overlay").classList.add("hidden");
      if (!isWorktree) {
        var removedProj = null;
        for (var ri = 0; ri < cachedProjects.length; ri++) {
          if (cachedProjects[ri].slug === msg.slug) { removedProj = cachedProjects[ri]; break; }
        }
        if (removedProj) {
          cachedRemovedProjects.push({
            path: removedProj.path || "",
            title: removedProj.title || null,
            icon: removedProj.icon || null,
            removedAt: Date.now(),
          });
        }
      }
      cachedProjects = cachedProjects.filter(function (p) { return p.slug !== msg.slug; });
      cachedProjectCount = cachedProjects.length;
      store.set({ currentSlug: null });
      renderProjectList();
      resetClientState();

      if (targetSlug) {
        switchProject(targetSlug);
      } else {
        showHomeHub();
      }
    } else {
      showToast(msg.slug.indexOf("--") !== -1 ? "Worktree removed" : "Project removed", "success");
    }
  } else {
    showToast(msg.error || "Failed to remove project", "error");
  }
}

// --- Add project modal ---

function switchAddProjectMode(mode) {
  addProjectMode = mode;
  for (var mi = 0; mi < addProjectModeBtns.length; mi++) {
    var btn = addProjectModeBtns[mi];
    if (btn.dataset.mode === mode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }
  for (var pi = 0; pi < addProjectPanels.length; pi++) {
    var panel = addProjectPanels[pi];
    if (panel.dataset.panel === mode) {
      panel.classList.add("active");
    } else {
      panel.classList.remove("active");
    }
  }
  addProjectError.classList.add("hidden");
  addProjectCloneProgress.classList.add("hidden");
  if (mode === "existing") {
    addProjectOk.textContent = "Add";
  } else if (mode === "create") {
    addProjectOk.textContent = "Create";
  } else if (mode === "clone") {
    addProjectOk.textContent = "Clone";
  }
  setTimeout(function () {
    if (mode === "existing") {
      addProjectInput.focus();
    } else if (mode === "create") {
      addProjectCreateInput.focus();
    } else if (mode === "clone") {
      addProjectCloneInput.focus();
    }
  }, 50);
}

export function openAddProjectModal() {
  addProjectModal.classList.remove("hidden");
  addProjectCreateInput.value = "";
  addProjectCloneInput.value = "";
  addProjectError.classList.add("hidden");
  addProjectError.textContent = "";
  addProjectCloneProgress.classList.add("hidden");
  addProjectSuggestions.classList.add("hidden");
  addProjectSuggestions.innerHTML = "";
  addProjectActiveIdx = -1;
  addProjectOk.disabled = false;
  var existingBtn = addProjectModal.querySelector('.add-project-mode-btn[data-mode="existing"]');
  var st = store.snap();
  if (st.isOsUsers) {
    existingBtn.disabled = false;
    var myUser = st.cachedAllUsers.find(function (u) { return u.id === st.myUserId; });
    var isAdmin = myUser && myUser.role === "admin";
    if (!isAdmin && myUser && myUser.linuxUser) {
      // Non-admin: lock prefix to home directory
      addProjectPrefixValue = "/home/" + myUser.linuxUser + "/";
      addProjectPrefixEl.textContent = addProjectPrefixValue;
      addProjectPrefixEl.classList.remove("hidden");
      addProjectInput.value = "";
      addProjectInput.placeholder = "subdirectory";
    } else {
      // Admin: no prefix restriction
      addProjectPrefixValue = "";
      addProjectPrefixEl.classList.add("hidden");
      addProjectInput.value = "/";
      addProjectInput.placeholder = "/";
    }
    switchAddProjectMode("existing");
  } else {
    addProjectPrefixValue = "";
    addProjectPrefixEl.classList.add("hidden");
    addProjectInput.value = "/";
    addProjectInput.placeholder = "/";
    existingBtn.disabled = false;
    switchAddProjectMode("existing");
  }
  renderRemovedProjectsList();
}

function renderRemovedProjectsList() {
  if (!addProjectRemoved) return;
  addProjectRemoved.innerHTML = "";
  if (!cachedRemovedProjects || cachedRemovedProjects.length === 0) {
    addProjectRemoved.classList.add("hidden");
    return;
  }
  addProjectRemoved.classList.remove("hidden");
  for (var ri = 0; ri < cachedRemovedProjects.length; ri++) {
    var rp = cachedRemovedProjects[ri];
    var item = document.createElement("div");
    item.className = "add-project-removed-item";
    item.dataset.path = rp.path;
    item.addEventListener("click", function () {
      var p = this.dataset.path;
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "add_project", path: p }));
      }
      closeAddProjectModal();
    });
    var iconEl = document.createElement("span");
    iconEl.className = "add-project-removed-icon";
    iconEl.textContent = rp.icon || "\uD83D\uDCC1";
    item.appendChild(iconEl);
    var info = document.createElement("div");
    info.className = "add-project-removed-info";
    var nameEl = document.createElement("div");
    nameEl.className = "add-project-removed-name";
    nameEl.textContent = rp.title || rp.path.split("/").pop() || rp.path;
    info.appendChild(nameEl);
    var pathEl = document.createElement("div");
    pathEl.className = "add-project-removed-path";
    pathEl.textContent = rp.path;
    info.appendChild(pathEl);
    item.appendChild(info);
    addProjectRemoved.appendChild(item);
  }
  try { parseEmojis(addProjectRemoved); } catch (e) {}
}

export function closeAddProjectModal() {
  addProjectModal.classList.add("hidden");
  addProjectInput.value = "";
  addProjectCreateInput.value = "";
  addProjectCloneInput.value = "";
  addProjectSuggestions.classList.add("hidden");
  addProjectSuggestions.innerHTML = "";
  addProjectError.classList.add("hidden");
  addProjectCloneProgress.classList.add("hidden");
  addProjectActiveIdx = -1;
  addProjectPrefixValue = "";
  addProjectPrefixEl.classList.add("hidden");
  if (addProjectDebounce) { clearTimeout(addProjectDebounce); addProjectDebounce = null; }
}

function getFullPath(inputVal) {
  return addProjectPrefixValue + inputVal;
}

function stripPrefix(fullPath) {
  if (addProjectPrefixValue && fullPath.indexOf(addProjectPrefixValue) === 0) {
    return fullPath.slice(addProjectPrefixValue.length);
  }
  return fullPath;
}

function requestBrowseDir(val) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "browse_dir", path: getFullPath(val) }));
}

export function handleBrowseDirResult(msg) {
  addProjectSuggestions.innerHTML = "";
  addProjectActiveIdx = -1;
  if (msg.error) {
    addProjectSuggestions.classList.add("hidden");
    return;
  }
  var entries = msg.entries || [];
  if (entries.length === 0) {
    addProjectSuggestions.classList.add("hidden");
    return;
  }
  for (var si = 0; si < entries.length; si++) {
    var entry = entries[si];
    var item = document.createElement("div");
    item.className = "add-project-suggestion-item";
    item.dataset.path = entry.path;
    item.innerHTML = '<i data-lucide="folder"></i><span class="add-project-suggestion-name">' +
      escapeHtml(entry.name) + '</span>';
    item.addEventListener("click", function (e) {
      var fullP = this.dataset.path + "/";
      addProjectInput.value = stripPrefix(fullP);
      addProjectInput.focus();
      addProjectError.classList.add("hidden");
      requestBrowseDir(addProjectInput.value);
    });
    addProjectSuggestions.appendChild(item);
  }
  addProjectSuggestions.classList.remove("hidden");
  refreshIcons();
}

export function handleAddProjectResult(msg) {
  addProjectCloneProgress.classList.add("hidden");
  if (msg.ok) {
    closeAddProjectModal();
    if (msg.existing) {
      showToast("Project already registered", "info");
    } else {
      var toastMsg = addProjectMode === "create" ? "Project created" : addProjectMode === "clone" ? "Project cloned" : "Project added";
      showToast(toastMsg, "success");
      if (msg.slug) {
        switchProject(msg.slug);
      }
    }
  } else {
    addProjectError.textContent = msg.error || "Failed to add project";
    addProjectError.classList.remove("hidden");
    addProjectOk.disabled = false;
  }
}

export function handleCloneProgress(msg) {
  if (msg.status === "cloning") {
    addProjectCloneProgress.classList.remove("hidden");
  }
}

function setActiveIdx(idx) {
  var items = addProjectSuggestions.querySelectorAll(".add-project-suggestion-item");
  addProjectActiveIdx = idx;
  for (var ai = 0; ai < items.length; ai++) {
    if (ai === idx) {
      items[ai].classList.add("active");
      items[ai].scrollIntoView({ block: "nearest" });
    } else {
      items[ai].classList.remove("active");
    }
  }
}

function submitAddProject() {
  addProjectError.classList.add("hidden");
  addProjectOk.disabled = true;

  if (addProjectMode === "existing") {
    var val = getFullPath(addProjectInput.value).replace(/\/+$/, "");
    if (!val) { addProjectOk.disabled = false; return; }
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "add_project", path: val }));
    }
  } else if (addProjectMode === "create") {
    var name = addProjectCreateInput.value.trim();
    if (!name) { addProjectOk.disabled = false; return; }
    var ws2 = getWs();
    if (ws2 && ws2.readyState === 1) {
      ws2.send(JSON.stringify({ type: "create_project", name: name }));
    }
  } else if (addProjectMode === "clone") {
    var url = addProjectCloneInput.value.trim();
    if (!url) { addProjectOk.disabled = false; return; }
    var ws3 = getWs();
    if (ws3 && ws3.readyState === 1) {
      ws3.send(JSON.stringify({ type: "clone_project", url: url }));
    }
  }
}
