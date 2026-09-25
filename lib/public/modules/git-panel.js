import { currentGithubWorkMarkup, refreshGithubWork, resetGithubWork } from './session-github.js';
import { store } from './store.js';
import { refreshIcons, iconHtml } from './icons.js';
import { escapeHtml, showToast } from './utils.js';
import { openWorkingTreeDiff } from './filebrowser.js';
import { getWs } from './ws-ref.js';
import { hideGitPlacard, mergeStatusIntoSummary, renderGitPlacard } from './git-placard.js';
import {
  closeGitSurface,
  compactSessionTitle,
  splitFilePath,
  startAgentCommitSession,
  startAgentFileReview
} from './git-agent-sessions.js';

var currentStatus = null;
var currentSummary = null;
var busy = false;
var lastError = "";
var statusBasePath = null;
var expandedFileActionsPath = null;

// One timer drives both readings so there is never a second poll. The full
// status runs at the panel's existing cadence only while the panel is open;
// with the panel closed the placard settles for the cheap summary at a much
// slower cadence, and neither path ever does diff work.
var POLL_MS = 2500;
var SUMMARY_TICKS = 6;
var summaryTicks = 0;

// A project surface always has a /p/<slug>/ base path. Home and any surface
// without a project must not issue a repository request at all.
function hasProjectBasePath() {
  return String(store.get('basePath') || "").indexOf("/p/") === 0;
}

function placardMounted() {
  return !!document.getElementById("git-placard");
}

function apiPath(path) {
  return store.get('basePath') + "api/git/" + path;
}

function requestJson(url, options) {
  return fetch(url, options).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok || body.error) throw new Error(body.error || "Git request failed");
      return body;
    });
  });
}

function shortOrigin(origin) {
  if (!origin) return "No origin configured";
  return origin
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "");
}

function fileStatusLabel(file, staged) {
  if (file.conflicted) return "!";
  if (file.untracked) return "U";
  var code = staged ? file.code.charAt(0) : file.code.charAt(1);
  return code === "." ? "M" : code;
}

function renderFileMeta(file, directory) {
  var sessions = Array.isArray(file.sessions) ? file.sessions : [];
  var first = sessions.length > 0 ? sessions[0] : null;
  var html = '<div class="git-file-subline">' +
    (directory ? '<span class="git-file-dir">' + escapeHtml(directory) + '</span>' : '<span class="git-file-dir">Project root</span>');
  if (first) {
    var title = first.title || "Agent session";
    var compactTitle = compactSessionTitle(title);
    var timing = first.preExisting
      ? "This file already had changes when the session started"
      : "This file became changed during the session";
    html += '<span class="git-file-meta-separator">\u00b7</span>' +
      '<button type="button" class="git-session-link" data-git-session-id="' + (first.sessionId == null ? '' : first.sessionId) + '"' +
        (first.sessionId == null ? ' disabled' : '') + ' data-tip="Return to ' + escapeHtml(title) + '\n' + timing + '">' +
        '<span>' + escapeHtml(compactTitle) + (sessions.length > 1 ? ' +' + (sessions.length - 1) : '') + '</span></button>';
  }
  var actionsOpen = expandedFileActionsPath === file.path;
  html += '</div><div class="git-file-actions' + (actionsOpen ? ' open' : '') + '" aria-hidden="' + (actionsOpen ? 'false' : 'true') + '">' +
    '<button type="button" data-git-open-diff="' + encodeURIComponent(file.path) + '" class="git-file-text-action">' +
      iconHtml("file-diff") + '<span>Open diff</span></button>';
  if (first) {
    html += '<button type="button" data-git-session-key="' + encodeURIComponent(first.key) + '" data-git-path="' + encodeURIComponent(file.path) + '" class="git-file-text-action git-session-compare">' +
      iconHtml("history") + '<span>Compare to start</span></button>';
  }
  html += '<button type="button" data-git-agent-review="' + encodeURIComponent(file.path) + '" class="git-file-text-action' + (first ? ' git-file-text-action-wide' : '') + '">' +
      iconHtml("sparkles") + '<span>Review with Agent</span></button></div>';
  return html;
}

function renderFileRow(file, staged) {
  var parts = splitFilePath(file.path);
  var pathKey = encodeURIComponent(file.path);
  var statusClass = file.conflicted ? " conflicted" : (file.untracked ? " untracked" : "");
  var action = staged ? "unstage" : "stage";
  var actionTitle = staged ? "Unstage file — keep its changes" : "Stage file for commit";
  var actionIcon = staged ? "minus" : "plus";
  var actionsOpen = expandedFileActionsPath === file.path;
  return '<div class="git-file-row' + (actionsOpen ? ' active' : '') + '">' +
    '<span class="git-file-status' + statusClass + '">' + escapeHtml(fileStatusLabel(file, staged)) + '</span>' +
    '<div class="git-file-main" data-git-file-item="' + pathKey + '" tabindex="0" aria-label="File actions for ' + escapeHtml(parts.name) + '" aria-expanded="' + (actionsOpen ? 'true' : 'false') + '">' +
      '<div class="git-file-name">' + escapeHtml(parts.name) + '</div>' +
      renderFileMeta(file, parts.dir) +
    '</div>' +
    '<button type="button" class="git-icon-btn git-file-action" data-git-action="' + action + '" data-git-path="' + pathKey + '" data-tip="' + actionTitle + '" aria-label="' + actionTitle + '"' + (busy ? ' disabled' : '') + '>' +
      iconHtml(actionIcon) +
    '</button>' +
  '</div>';
}

function renderFileSection(title, files, staged, onlySection) {
  if (files.length === 0) return "";
  var bulkAction = staged ? "unstage_all" : "stage_all";
  var bulkLabel = staged ? "Unstage all" : "Stage all";
  var sectionClass = staged ? " git-section-staged" : " git-section-changes";
  if (onlySection) sectionClass += " git-section-only";
  var html = '<section class="git-section' + sectionClass + '">' +
    '<div class="git-section-header"><span>' + title + '</span><span class="git-section-count">' + files.length + '</span>' +
      '<button type="button" class="git-action-btn" data-git-action="' + bulkAction + '"' + (busy ? ' disabled' : '') + '>' + bulkLabel + '</button>' +
    '</div><div class="git-file-list">';
  for (var i = 0; i < files.length; i++) html += renderFileRow(files[i], staged);
  return html + '</div></section>';
}

function renderRepository(status) {
  var staged = [];
  var unstaged = [];
  for (var i = 0; i < status.files.length; i++) {
    if (status.files[i].staged) staged.push(status.files[i]);
    if (status.files[i].unstaged || status.files[i].untracked) unstaged.push(status.files[i]);
  }
  var branchLabel = status.detached ? "Detached at " + String(status.oid || "").slice(0, 8) : (status.branch || "No commits yet");
  var badges = "";
  if (status.isWorktree) badges += '<span class="git-badge">Linked worktree</span>';
  else if (status.worktrees && status.worktrees.length > 1) badges += '<span class="git-badge">Main checkout</span>';
  if (status.detached) badges += '<span class="git-badge detached">Detached HEAD</span>';

  var pullDisabled = busy || !status.upstream;
  var pushDisabled = busy || !status.origin || status.detached;
  var html = lastError ? '<div class="git-panel-error">' + escapeHtml(lastError) + '</div>' : '';
  html += '<div class="git-repo-card">' +
    '<div class="git-repo-primary">' + iconHtml("git-branch") +
      '<div style="min-width:0"><div class="git-repo-name">' + escapeHtml(status.name || "Repository") + '</div>' +
      '<div class="git-branch-name">' + escapeHtml(branchLabel) + '</div></div>' +
    '</div>' +
    (badges ? '<div class="git-badges">' + badges + '</div>' : '') +
    '<div class="git-repo-path">' + iconHtml("folder") + '<span>' + escapeHtml(status.root || "") + '</span></div>' +
    (status.isWorktree ? '<div class="git-repo-path">' + iconHtml("trees") + '<span>Main: ' + escapeHtml(status.mainWorktree || "") + '</span></div>' : '') +
    '<div class="git-origin">' + iconHtml("cloud") + '<span>' + escapeHtml(shortOrigin(status.origin)) + '</span></div>' +
  '</div>' +
  '<div class="git-sync-row">' +
    '<button type="button" class="git-action-btn" data-git-action="pull"' + (pullDisabled ? ' disabled' : '') + '>' + iconHtml("download") + ' Pull' +
      (status.behind ? '<span class="git-sync-count">' + status.behind + '</span>' : '') + '</button>' +
    '<button type="button" class="git-action-btn" data-git-action="push"' + (pushDisabled ? ' disabled' : '') + '>' + iconHtml("upload") + ' Push' +
      (status.ahead ? '<span class="git-sync-count">' + status.ahead + '</span>' : '') + '</button>' +
  '</div>';

  if (status.files.length === 0) {
    html += '<div class="git-panel-empty" style="min-height:80px">' + iconHtml("check-circle-2") + '<span>Working tree clean</span></div>';
  } else {
    html += '<button type="button" class="git-review-all" data-git-review-all>' +
      '<span>' + iconHtml("scan-search") + '<strong>Review all changes</strong></span>' +
      '<span class="git-review-count">' + status.files.length + ' files ' + iconHtml("chevron-right") + '</span>' +
    '</button>';
    html += renderFileSection("Staged changes", staged, true, unstaged.length === 0);
    html += renderFileSection("Changes", unstaged, false, staged.length === 0);
  }

  if (staged.length > 0) {
    html += '<div class="git-agent-commit">' +
      '<div class="git-agent-commit-copy"><span class="git-agent-commit-icon">' + iconHtml("sparkles") + '</span>' +
        '<div><strong>Commit with Agent</strong><span>Review and commit exactly ' + staged.length + ' staged file' + (staged.length === 1 ? '' : 's') + '.</span></div></div>' +
      '<button type="button" class="git-action-btn git-agent-commit-btn" data-git-agent-commit' + (busy ? ' disabled' : '') + '>' +
        iconHtml("message-square-code") + ' Commit ' + staged.length + ' file' + (staged.length === 1 ? '' : 's') + '</button>' +
    '</div>';
  } else if (status.files.length > 0) {
    html += '<div class="git-agent-commit git-next-action">' +
      '<button type="button" class="git-action-btn git-agent-commit-btn" data-git-review-all>' +
        iconHtml("scan-search") + ' Review ' + status.files.length + ' changed file' + (status.files.length === 1 ? '' : 's') + '</button>' +
    '</div>';
  } else if (status.ahead > 0) {
    html += '<div class="git-agent-commit git-next-action"><button type="button" class="git-action-btn git-agent-commit-btn" data-git-action="push">' +
      iconHtml("upload") + ' Push ' + status.ahead + ' commit' + (status.ahead === 1 ? '' : 's') + '</button></div>';
  }
  return html;
}

function render() {
  var body = document.getElementById("git-panel-body");
  if (!body) return;
  var previousChangesList = body.querySelector(".git-section-changes .git-file-list");
  var previousStagedList = body.querySelector(".git-section-staged .git-file-list");
  var changesScrollTop = previousChangesList ? previousChangesList.scrollTop : 0;
  var stagedScrollTop = previousStagedList ? previousStagedList.scrollTop : 0;
  if (!currentStatus) {
    body.innerHTML = '<div class="git-panel-loading"><span class="git-panel-spinner"></span> Reading repository</div>';
  } else if (currentStatus.loadError) {
    body.innerHTML = '<div class="git-panel-empty">' + iconHtml("circle-alert") + '<span>' + escapeHtml(currentStatus.loadError) + '</span></div>';
  } else if (!currentStatus.isRepository) {
    body.innerHTML = '<div class="git-panel-empty">' + iconHtml("folder-git-2") + '<span>This project is not a Git repository.</span></div>';
  } else {
    body.innerHTML = currentGithubWorkMarkup() + renderRepository(currentStatus);
  }
  refreshIcons(body);
  var changesList = body.querySelector(".git-section-changes .git-file-list");
  var stagedList = body.querySelector(".git-section-staged .git-file-list");
  if (changesList) changesList.scrollTop = changesScrollTop;
  if (stagedList) stagedList.scrollTop = stagedScrollTop;
  syncPlacard();
}

// The placard is a projection of whichever reading is current. A full status
// supersedes the summary when it exists, so the two never disagree.
function syncPlacard() {
  if (!placardMounted()) return;
  if (currentStatus && currentStatus.isRepository) {
    currentSummary = mergeStatusIntoSummary(currentStatus, currentSummary);
  }
  if (!currentSummary || !currentSummary.isRepository) {
    hideGitPlacard();
    return;
  }
  renderGitPlacard(currentSummary);
}

// Cheap placard-only reading. Used on sidebar lifecycle (connect, reconnect,
// project switch) and on the slow tick while the full panel is closed.
export function refreshGitSummary() {
  if (busy || !hasProjectBasePath() || !placardMounted()) return Promise.resolve(currentSummary);
  var basePath = store.get('basePath');
  return requestJson(basePath + "api/git/summary", { cache: "no-store" }).then(function (summary) {
    if (store.get('basePath') !== basePath) return currentSummary;
    currentSummary = summary && summary.isRepository ? summary : null;
    syncPlacard();
    return currentSummary;
  }).catch(function () {
    // An unavailable or forbidden repository shows nothing rather than an
    // error placeholder; the full panel still reports errors when opened.
    if (store.get('basePath') !== basePath) return currentSummary;
    currentSummary = null;
    syncPlacard();
    return null;
  });
}

// Project switch and reconnect both land here, so no stale repository ever
// survives into another project and nothing flashes before detection lands.
export function resetGitSurface() {
  resetGithubWork();
  currentStatus = null;
  currentSummary = null;
  lastError = "";
  expandedFileActionsPath = null;
  statusBasePath = store.get('basePath');
  summaryTicks = 0;
  hideGitPlacard();
  render();
}

export function refreshGitStatus() {
  refreshGithubWork();
  if (busy) return Promise.resolve(currentStatus);
  var basePath = store.get('basePath');
  if (statusBasePath !== basePath) {
    statusBasePath = basePath;
    currentStatus = null;
    currentSummary = null;
    lastError = "";
    expandedFileActionsPath = null;
    hideGitPlacard();
    render();
  }
  var refreshBtn = document.getElementById("git-panel-refresh");
  if (refreshBtn) refreshBtn.classList.add("spinning");
  return requestJson(basePath + "api/git/status", { cache: "no-store" }).then(function (status) {
    if (statusBasePath !== basePath) return status;
    currentStatus = status;
    if (expandedFileActionsPath && !status.files.some(function (file) { return file.path === expandedFileActionsPath; })) {
      expandedFileActionsPath = null;
    }
    lastError = "";
    render();
    return status;
  }).catch(function (err) {
    if (statusBasePath !== basePath) return;
    lastError = err.message;
    if (!currentStatus) currentStatus = { isRepository: false, loadError: err.message };
    render();
  }).finally(function () {
    if (refreshBtn) refreshBtn.classList.remove("spinning");
  });
}

function actionLabel(action) {
  if (action === "stage" || action === "stage_all") return "Staged changes";
  if (action === "unstage" || action === "unstage_all") return "Unstaged changes";
  if (action === "pull") return "Pulled changes";
  if (action === "push") return "Pushed changes";
  return "Git action completed";
}

function runAction(action, paths) {
  if (busy) return;
  var payload = { action: action };
  if (paths) payload.paths = paths;
  busy = true;
  lastError = "";
  render();
  requestJson(apiPath("action"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(function (result) {
    currentStatus = result.status;
    showToast(actionLabel(action), null, result.output || "");
  }).catch(function (err) {
    lastError = err.message;
    showToast("Git action failed", "warn", err.message);
  }).finally(function () {
    busy = false;
    render();
  });
}

function openFileDiff(filePath, reviewIndex) {
  requestJson(apiPath("file-diff?path=" + encodeURIComponent(filePath)), { cache: "no-store" }).then(function (result) {
    var paths = currentStatus ? currentStatus.files.map(function (file) { return file.path; }) : [filePath];
    var index = typeof reviewIndex === "number" ? reviewIndex : paths.indexOf(filePath);
    if (index < 0) index = 0;
    result.review = {
      index: index,
      total: paths.length,
      previous: index > 0 ? function () { openFileDiff(paths[index - 1], index - 1); } : null,
      next: index + 1 < paths.length ? function () { openFileDiff(paths[index + 1], index + 1); } : null,
      askAgent: function () { startAgentFileReview(filePath); },
    };
    openWorkingTreeDiff(result);
  }).catch(function (err) {
    showToast("Unable to open Git diff", "warn", err.message);
  });
}

function openSessionDiff(sessionKey, filePath) {
  var url = apiPath("session-diff?session=" + encodeURIComponent(sessionKey) + "&path=" + encodeURIComponent(filePath));
  requestJson(url, { cache: "no-store" }).then(function (result) {
    openWorkingTreeDiff(result);
    showToast("Compared with start of " + (result.sessionTitle || "session"));
  }).catch(function (err) {
    showToast("Unable to compare session changes", "warn", err.message);
  });
}

function returnToSession(sessionId) {
  var ws = getWs();
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  ws.send(JSON.stringify({ type: "switch_session", id: sessionId }));
  closeGitSurface();
}

function toggleFileActions(fileMain) {
  if (!fileMain) return;
  var filePath = decodeURIComponent(fileMain.dataset.gitFileItem);
  var fileActions = fileMain.querySelector(".git-file-actions");
  var wasOpen = fileActions && fileActions.classList.contains("open");
  var openActions = document.querySelectorAll("#git-panel-body .git-file-actions.open");
  for (var openIndex = 0; openIndex < openActions.length; openIndex++) {
    openActions[openIndex].classList.remove("open");
    openActions[openIndex].setAttribute("aria-hidden", "true");
    var openMain = openActions[openIndex].closest(".git-file-main");
    var openRow = openActions[openIndex].closest(".git-file-row");
    if (openMain) openMain.setAttribute("aria-expanded", "false");
    if (openRow) openRow.classList.remove("active");
  }
  if (fileActions && !wasOpen) {
    expandedFileActionsPath = filePath;
    fileActions.classList.add("open");
    fileActions.setAttribute("aria-hidden", "false");
    fileMain.setAttribute("aria-expanded", "true");
    var fileRow = fileMain.closest(".git-file-row");
    if (fileRow) fileRow.classList.add("active");
  } else {
    expandedFileActionsPath = null;
  }
}

// Sidebar lifecycle. A project switch resets everything and asks once; a
// reconnect re-asks without resetting the surface the user is looking at.
// Entering a Mate DM hides the placard, since that surface has no repository.
function initGitLifecycle() {
  statusBasePath = store.get('basePath');
  store.subscribe(function (state, prev) {
    if (state.basePath !== prev.basePath || state.currentSlug !== prev.currentSlug) {
      resetGitSurface();
      if (!state.dmMode) refreshGitSummary();
      return;
    }
    if (state.dmMode !== prev.dmMode) {
      if (state.dmMode) { hideGitPlacard(); resetGithubWork(); }
      else refreshGitSummary();
      return;
    }
    if (state.connected && !prev.connected && !state.dmMode) refreshGitSummary();
  });
  if (!store.get('dmMode')) refreshGitSummary();
}

export function initGitPanel() {
  var body = document.getElementById("git-panel-body");
  var refreshBtn = document.getElementById("git-panel-refresh");
  if (!body || !refreshBtn) return;
  initGitLifecycle();
  refreshBtn.addEventListener("click", function () { refreshGitStatus(); });
  body.addEventListener("click", function (event) {
    var openDiff = event.target.closest("[data-git-open-diff]");
    if (openDiff) {
      openFileDiff(decodeURIComponent(openDiff.dataset.gitOpenDiff));
      return;
    }
    var agentReview = event.target.closest("[data-git-agent-review]");
    if (agentReview) {
      startAgentFileReview(decodeURIComponent(agentReview.dataset.gitAgentReview));
      return;
    }
    var reviewAll = event.target.closest("[data-git-review-all]");
    if (reviewAll) {
      if (currentStatus && currentStatus.files.length > 0) openFileDiff(currentStatus.files[0].path, 0);
      return;
    }
    var sessionCompare = event.target.closest(".git-session-compare");
    if (sessionCompare) {
      openSessionDiff(decodeURIComponent(sessionCompare.dataset.gitSessionKey), decodeURIComponent(sessionCompare.dataset.gitPath));
      return;
    }
    var sessionLink = event.target.closest(".git-session-link");
    if (sessionLink) {
      if (!sessionLink.disabled) returnToSession(parseInt(sessionLink.dataset.gitSessionId, 10));
      return;
    }
    var agentCommitButton = event.target.closest("[data-git-agent-commit]");
    if (agentCommitButton) {
      if (!agentCommitButton.disabled && !busy && currentStatus) {
        startAgentCommitSession(currentStatus.files.filter(function (file) { return file.staged; }).length);
      }
      return;
    }
    var actionButton = event.target.closest("[data-git-action]");
    if (actionButton) {
      if (!actionButton.disabled) {
        var action = actionButton.dataset.gitAction;
        var filePath = actionButton.dataset.gitPath ? decodeURIComponent(actionButton.dataset.gitPath) : null;
        runAction(action, filePath ? [filePath] : null);
      }
      return;
    }
    var fileRow = event.target.closest(".git-file-row");
    var fileItem = fileRow ? fileRow.querySelector("[data-git-file-item]") : null;
    if (fileItem) toggleFileActions(fileItem);
  });
  body.addEventListener("keydown", function (event) {
    var fileItem = event.target.closest("[data-git-file-item]");
    if (!fileItem || event.target !== fileItem || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    toggleFileActions(fileItem);
  });
  setInterval(function () {
    var panel = document.getElementById("sidebar-panel-git");
    var panelOpen = !!(panel && !panel.classList.contains("hidden"));
    if (panelOpen) {
      summaryTicks = 0;
      if (store.get('connected') && !busy) refreshGitStatus();
      return;
    }
    summaryTicks++;
    if (summaryTicks < SUMMARY_TICKS) return;
    summaryTicks = 0;
    if (document.hidden || store.get('dmMode') || !store.get('connected') || busy) return;
    refreshGithubWork();
    refreshGitSummary();
  }, POLL_MS);
}
