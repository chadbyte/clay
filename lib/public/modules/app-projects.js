import { prepareContextualWorkspaceDeparture } from './contextual-clay-workspace.js';
import { checkComposerDeparture, saveSessionRichDraft } from './session-rich-drafts.js';
// app-projects.js - Project list, switching, add/remove project modals
// Extracted from app.js (PR-29)

import { showProjectsHub, hideProjectsHub, completeProjectsOnboarding } from './projects-hub.js';
import { showToast } from './utils.js';
import { refreshIcons } from './icons.js';
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
import { resetFileBrowser } from './filebrowser.js';
import { closeNotesBrowser } from './sticky-notes-browser.js';
import { hideMemory } from './mate-memory.js';
import { isSchedulerOpen, closeScheduler, resetScheduler } from './scheduler.js';
import { closeScheduledTasks } from './scheduled-tasks.js';
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
import { clearProjectSplitState } from './split-session-boundary.js';
import { isMateHeaderWorkspace, renderOrdinaryProjectHeader } from './project-header-identity.js';

// --- Module-owned state ---
var cachedProjects = [];
var cachedProjectCount = 0;
var cachedRemovedProjects = [];
var pendingRemoveSlug = null;
var pendingRemoveName = null;


// --- State accessors ---

export function getCachedProjects() { return cachedProjects; }
export function setCachedProjects(v) { cachedProjects = v; store.set({ projectsHubList: v, projectListLoaded: true }); }
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
    store.set({ projectsHubList: cachedProjects, projectListLoaded: true });
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
      controlRuntimeId: p.controlRuntimeId || null,
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
  if (!st.mateProjectSlug && !isMateHeaderWorkspace(st)) {
    renderOrdinaryProjectHeader(Object.assign({}, st, { projectsHubList: cachedProjects }));
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
  store.set({ pendingScheduleAdmissions: {}, pendingScheduleAdmission: null });
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
  if (slug !== store.get('currentSlug')) {
    try { checkComposerDeparture(); saveSessionRichDraft(); }
    catch (error) { showToast(error.message, 'warn'); return; }
  }
  if (prepareContextualWorkspaceDeparture(slug) === false) return;
  var target = cachedProjects.find(function (project) { return project.slug === slug; });
  if (target && target.contentAccess === false && target.administrativeAccess === true) {
    window.location.assign("/p/" + encodeURIComponent(slug) + "/");
    return;
  }
  document.cookie = "clay_last_project=" + encodeURIComponent(slug) + "; Path=/; SameSite=Strict; Max-Age=31536000";
  var st = store.snap();
  var ws = getWs();
  var targetWsPath = projectWsPath(slug);
  var homeVisible = store.get('projectsHubVisible');
  var alreadyInProject = isProjectActivated(st, slug, ws);
  var wasDm = st.dmMode;
  var wasMate = st.dmMode && st.dmTargetUser && st.dmTargetUser.isMate;
  if (st.dmMode) exitDmMode(wasMate);
  if (homeVisible && alreadyInProject) {
    rememberHomePrimarySurface("project", slug);
    hideProjectsHub();
    completeProjectsOnboarding();
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
  if (store.get('currentSlug') !== slug) clearProjectSplitState();
  resetFileBrowser();
  if (typeof closeScheduledTasks === "function") closeScheduledTasks();
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
  hideProjectsHub();
  completeProjectsOnboarding();
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
  if (!store.get('pendingHomeProjectSlug')) return !store.get('projectsHubVisible');
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
      closeProjectSettings({ cleanup: true });

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
      setCachedProjects(cachedProjects.filter(function (p) { return p.slug !== msg.slug; }));
      cachedProjectCount = cachedProjects.length;
      store.set({ currentSlug: null });
      renderProjectList();
      resetClientState();

      if (targetSlug) {
        switchProject(targetSlug);
      } else {
        store.set({ wsPath: "/ws", basePath: "/", activeProjectSlug: null });
        showProjectsHub();
        connect();
      }
    } else {
      showToast(msg.slug.indexOf("--") !== -1 ? "Worktree removed" : "Project removed", "success");
    }
  } else {
    showToast(msg.error || "Failed to remove project", "error");
  }
}
