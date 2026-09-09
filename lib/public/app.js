import { avatarUrl, userAvatarUrl, mateAvatarUrl } from './modules/avatar.js';
import { showToast, escapeHtml } from './modules/utils.js';
import { refreshIcons, iconHtml } from './modules/icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks, closeMermaidModal, parseEmojis } from './modules/markdown.js';
import { initSidebar, updatePageTitle, spawnDustParticles } from './modules/sidebar.js';
import {
  renderSessionList, handleSearchResults, updateSessionPresence,
  updateSessionBadge
} from './modules/sidebar-sessions.js';
import {
  renderIconStrip, getEmojiCategories, updateProjectBadge
} from './modules/sidebar-projects.js';
import {
  renderUserStrip, closeDmUserPicker, setCurrentDmUser,
  updateDmBadge, setMentionActive, clearAllMentionActive,
  onMentionActiveChange
} from './modules/sidebar-mates.js';
import {
  openMobileSheet, setMobileSheetMateData, refreshMobileChatSheet
} from './modules/sidebar-mobile.js';
import { initMateSidebar, showMateSidebar, hideMateSidebar, renderMateSessionList, updateMateSidebarProfile, handleMateSearchResults } from './modules/mate-sidebar.js';
import { initMateKnowledge, requestKnowledgeList, renderKnowledgeList, handleKnowledgeContent, hideKnowledge } from './modules/mate-knowledge.js';
import { initMateMemory, renderMemoryList, hideMemory } from './modules/mate-memory.js';
import { initRewind, setRewindMode, showRewindModal, clearPendingRewindUuid, addRewindButton, onRewindComplete, onRewindError } from './modules/rewind.js';
import { initNotifications, showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './modules/notifications.js';
import { initInput, clearPendingImages, handleInputSync, autoResize, builtinCommands, sendMessage, hasSendableContent, setScheduleBtnDisabled, setScheduleDelayMs, clearScheduleDelay } from './modules/input.js';
import { initQrCode, triggerShare } from './modules/qrcode.js';
import { initFileBrowser, loadRootDirectory, refreshTree, handleFsList, handleFsRead, handleDirChanged, refreshIfOpen, handleFileChanged, handleFileHistory, handleGitDiff, handleFileAt, getPendingNavigate, closeFileViewer, resetFileBrowser } from './modules/filebrowser.js';
import { initGitPanel } from './modules/git-panel.js';
import { initWorkerPaneLock } from './modules/worker-pane-lock.js';
import { initTerminal, openTerminal, closeTerminal, resetTerminals, handleTermList, handleTermCreated, handleTermOutput, handleTermResized, handleTermExited, handleTermClosed, sendTerminalCommand } from './modules/terminal.js';
import { initContextSources, updateTerminalList, updateBrowserTabList, handleContextSourcesState, getActiveSources, hasActiveSources } from './modules/context-sources.js';
import { initStickyNotes, handleNotesList, handleNoteCreated, handleNoteUpdated, handleNoteDeleted, hideNotes, showNotes, isNotesVisible, createNote, setBrowserRefresh } from './modules/sticky-notes.js';
import { initNotesBrowser, openNotesBrowser, closeNotesBrowser, isNotesBrowserOpen, renderNotesBrowser, registerExclusiveClosers } from './modules/sticky-notes-browser.js';
import { initTheme, getThemeColor, getComputedVar, onThemeChange, getCurrentTheme, getChatLayout } from './modules/theme.js';
import { initTools, resetToolState, saveToolState, restoreToolState, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionResolved, markPermissionCancelled, renderElicitationRequest, markElicitationResolved, renderPlanBanner, renderPlanCard, handleTodoWrite, handleTaskCreate, handleTaskUpdate, startThinking, appendThinking, stopThinking, resetThinkingGroup, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, addTurnMeta, resetTurnMetaCost, enableMainInput, getTools, getPlanContent, setPlanContent, isPlanFilePath, getTodoTools, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, updateSubagentProgress, initSubagentStop, closeToolGroup, removeToolFromGroup } from './modules/tools.js';
import { initServerSettings, updateSettingsStats, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleAutoContinueChanged, handleRestartResult, handleShutdownResult, handleSharedEnv, handleSharedEnvSaved, handleGlobalClaudeMdRead, handleGlobalClaudeMdWrite } from './modules/server-settings.js';
import { initProjectSettings, handleInstructionsRead, handleInstructionsWrite, handleProjectEnv, handleProjectEnvSaved, isProjectSettingsOpen, handleProjectSharedEnv, handleProjectSharedEnvSaved, handleProjectOwnerChanged } from './modules/project-settings.js';
import { initSkills, handleSkillInstalled, handleSkillUninstalled } from './modules/skills.js';
import { initMcp } from './modules/mcp-ui.js';
import { initScheduler, resetScheduler, handleLoopRegistryUpdated, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled, openSchedulerToTab, isSchedulerOpen, closeScheduler, enterCraftingMode, exitCraftingMode, handleLoopRegistryFiles, getUpcomingSchedules } from './modules/scheduler.js';
import { initPlaybook, openPlaybook, getPlaybooks, getPlaybookForTip, isCompleted as isPlaybookCompleted } from './modules/playbook.js';
import { initSTT } from './modules/stt.js';
import { initProfile, getProfileLang } from './modules/profile.js';
import { initUserSettings } from './modules/user-settings.js';
import { initToolPalettes } from './modules/tool-palette.js';
import { initProjectLogs, closeProjectLogs } from './modules/project-logs.js';
import { initProjectSwitcher } from './modules/project-switcher.js';
import { initSplitView } from './modules/split-view.js';
import { initPaneBridge } from './modules/pane-bridge.js';
import { initAdmin, checkAdminAccess } from './modules/admin.js';
import { initSessionSearch, toggleSearch, closeSearch, isSearchOpen, handleFindInSessionResults, onHistoryPrepended as onSessionSearchHistoryPrepended } from './modules/session-search.js';
import { initTooltips, registerTooltip } from './modules/tooltip.js';
import { initCommandPalette, handlePaletteSessionSwitch, setPaletteVersion } from './modules/command-palette.js';
import { initLongPress } from './modules/longpress.js';
import { initShellCommand } from './modules/shell-command.js';
import { initConnection, connect as _connConnect, setStatus as _connSetStatus, scheduleReconnect as _connScheduleReconnect, cancelReconnect as _connCancelReconnect } from './modules/app-connection.js';
import { processMessage as _msgProcessMessage } from './modules/app-messages.js';
import { getWs as _getWsRef, setWs as _setWsRef } from './modules/ws-ref.js';
import { initHomeHub, showHomeHub as _hubShowHomeHub, hideHomeHub as _hubHideHomeHub, isHomeHubVisible, renderHomeMateSwitcher, updateHomeIconBadge } from './modules/app-home-hub.js';
import { initHomeSidebar } from './modules/home-sidebar.js';
import { openHomeMateAction } from './modules/home-mate-chat.js';
import { initHomeSurfaceBoot } from './modules/home-surface-boot.js';
import { rememberHomePrimarySurface } from './modules/home-surface.js';
import { initRateLimit, handleRateLimitEvent as _rlHandleRateLimitEvent, updateRateLimitUsage as _rlUpdateRateLimitUsage, addScheduledMessageBubble as _rlAddScheduledMessageBubble, removeScheduledMessageBubble as _rlRemoveScheduledMessageBubble, handleFastModeState as _rlHandleFastModeState, getScheduledMsgEl, resetRateLimitState } from './modules/app-rate-limit.js';
import { initCursors, handleRemoteCursorMove as _curHandleRemoteCursorMove, handleRemoteCursorLeave as _curHandleRemoteCursorLeave, handleRemoteSelection as _curHandleRemoteSelection, clearRemoteCursors as _curClearRemoteCursors, initCursorToggle } from './modules/app-cursors.js';
import { initFavicon, updateFavicon as _favUpdateFavicon, setSendBtnMode as _favSetSendBtnMode, blinkIO as _favBlinkIO, blinkSessionDot as _favBlinkSessionDot, updateCrossProjectBlink as _favUpdateCrossProjectBlink, startUrgentBlink as _favStartUrgentBlink, stopUrgentBlink as _favStopUrgentBlink, setActivity as _favSetActivity } from './modules/app-favicon.js';
import { initHeader, closeSessionInfoPopover as _hdrCloseSessionInfoPopover, updateHistorySentinel as _hdrUpdateHistorySentinel, requestMoreHistory as _hdrRequestMoreHistory, prependOlderHistory as _hdrPrependOlderHistory } from './modules/app-header.js';
import { initSessionActions } from './modules/session-actions.js';
import { initMisc, flushPendingExtMessages, showImageModal as _miscShowImageModal, closeImageModal as _miscCloseImageModal, showConfirm as _miscShowConfirm, hideConfirm as _miscHideConfirm, showForceChangePinOverlay as _miscShowForceChangePinOverlay, sendExtensionCommand as _miscSendExtensionCommand, handleExtensionResult as _miscHandleExtensionResult } from './modules/app-misc.js';
import { showPasteModal } from './modules/paste-modal.js';
import { initSkillInstall, requireSkills as _siRequireSkills, handleSkillInstallWs as _siHandleSkillInstallWs } from './modules/app-skills-install.js';
import { initDebateUi, showDebateConcludeConfirm as _debShowDebateConcludeConfirm, exitDebateConcludeMode as _debExitDebateConcludeMode, handleDebateConcludeSend as _debHandleDebateConcludeSend, showDebateEndedMode as _debShowDebateEndedMode, exitDebateEndedMode as _debExitDebateEndedMode, showDebateUserFloor as _debShowDebateUserFloor, exitDebateFloorMode as _debExitDebateFloorMode, handleDebateFloorSend as _debHandleDebateFloorSend, renderDebateUserFloorDone as _debRenderDebateUserFloorDone, showDebateSticky as _debShowDebateSticky, showDebateBottomBar as _debShowDebateBottomBar, removeDebateBottomBar as _debRemoveDebateBottomBar, sendDebateStickyComment as _debSendDebateStickyComment, updateDebateRound as _debUpdateDebateRound } from './modules/app-debate-ui.js';
import { initLoopUi, updateLoopInputVisibility as _loopUpdateLoopInputVisibility, updateLoopButton as _loopUpdateLoopButton, showLoopBanner as _loopShowLoopBanner, updateLoopBanner as _loopUpdateLoopBanner, updateRalphBars as _loopUpdateRalphBars, showRalphCraftingBar as _loopShowRalphCraftingBar, showRalphApprovalBar as _loopShowRalphApprovalBar, updateRalphApprovalStatus as _loopUpdateRalphApprovalStatus, openRalphPreviewModal as _loopOpenRalphPreviewModal, showExecModal as _loopShowExecModal, closeExecModal as _loopCloseExecModal, updateExecModalStatus as _loopUpdateExecModalStatus } from './modules/app-loop-ui.js';
import { initBackgroundTasksUi } from './modules/background-tasks-ui.js';
import { initLoopWizard, openRalphWizard as _loopOpenRalphWizard, closeRalphWizard as _loopCloseRalphWizard, getWizardSource as _loopGetWizardSource } from './modules/app-loop-wizard.js';
import { initAppNotifications, handleNotificationsState as _notifHandleState, handleNotificationCreated as _notifHandleCreated, handleNotificationDismissed as _notifHandleDismissed, handleNotificationDismissedAll as _notifHandleDismissedAll } from './modules/app-notifications.js';
import { initWhatsNew, handleWhatsNewState as _wnHandleState, handleWhatsNewSeenResult as _wnHandleSeenResult } from './modules/whats-new.js';
import { initWhatsNewArticle, openArticle as openWhatsNewArticle } from './modules/whats-new-article.js';
import { initHeaderTuiFont } from './modules/header-tui-font.js';
import { createStore, store } from './modules/store.js';
import { initPanels, updateConfigChip as _panUpdateConfigChip, getModelEffortLevels as _panGetModelEffortLevels, accumulateUsage as _panAccumulateUsage, updateUsagePanel as _panUpdateUsagePanel, resetUsage as _panResetUsage, toggleUsagePanel as _panToggleUsagePanel, formatTokens as _panFormatTokens, updateStatusPanel as _panUpdateStatusPanel, requestProcessStats as _panRequestProcessStats, toggleStatusPanel as _panToggleStatusPanel, accumulateContext as _panAccumulateContext, updateContextPanel as _panUpdateContextPanel, resetContext as _panResetContext, resetContextData as _panResetContextData, minimizeContext as _panMinimizeContext, expandContext as _panExpandContext, toggleContextPanel as _panToggleContextPanel, getContextView as _panGetContextView, renderCtxPopover as _panRenderCtxPopover, hideCtxPopover as _panHideCtxPopover, formatBytes as _panFormatBytes, formatUptime as _panFormatUptime, getModelSupportsEffort as _panGetModelSupportsEffort, getSessionUsage, setSessionUsage, getContextData, setContextData, setContextView as _panSetContextView, applyContextView as _panApplyContextView } from './modules/app-panels.js';
import { initProjects, updateProjectList as _projUpdateProjectList, renderProjectList as _projRenderProjectList, renderTopbarPresence as _projRenderTopbarPresence, switchProject as _projSwitchProject, resetClientState as _projResetClientState, confirmRemoveProject as _projConfirmRemoveProject, handleRemoveProjectCheckResult as _projHandleRemoveProjectCheckResult, handleRemoveProjectResult as _projHandleRemoveProjectResult, openAddProjectModal as _projOpenAddProjectModal, closeAddProjectModal as _projCloseAddProjectModal, handleBrowseDirResult as _projHandleBrowseDirResult, handleAddProjectResult as _projHandleAddProjectResult, handleCloneProgress as _projHandleCloneProgress, showUpdateAvailable as _projShowUpdateAvailable, getCachedProjects, setCachedProjects, getCachedProjectCount, getCachedRemovedProjects, setCachedRemovedProjects } from './modules/app-projects.js';
import { initRendering, addToMessages as _renAddToMessages, scrollToBottom as _renScrollToBottom, forceScrollToBottom as _renForceScrollToBottom, addUserMessage as _renAddUserMessage, getMsgTime as _renGetMsgTime, shouldGroupMessage as _renShouldGroupMessage, ensureAssistantBlock as _renEnsureAssistantBlock, addCopyHandler as _renAddCopyHandler, appendDelta as _renAppendDelta, flushStreamBuffer as _renFlushStreamBuffer, finalizeAssistantBlock as _renFinalizeAssistantBlock, addSystemMessage as _renAddSystemMessage, addConflictMessage as _renAddConflictMessage, addContextOverflowMessage as _renAddContextOverflowMessage, showClaudePreThinking as _renShowClaudePreThinking, showMatePreThinking as _renShowMatePreThinking, removeMatePreThinking as _renRemoveMatePreThinking, showSuggestionChips as _renShowSuggestionChips, hideSuggestionChips as _renHideSuggestionChips, getGhostSuggestion as _renGetGhostSuggestion, getTurnCounter, setTurnCounter, getPrependAnchor, setPrependAnchor, getActivityEl, setActivityEl, getIsUserScrolledUp, setIsUserScrolledUp, getStickyBottom, armStickyBottom, disarmStickyBottom } from './modules/app-rendering.js';
import { initDm, openDm as _dmOpenDm, enterDmMode as _dmEnterDmMode, exitDmMode as _dmExitDmMode, handleMateCreatedInApp as _dmHandleMateCreatedInApp, buildMateInterviewPrompt as _dmBuildMateInterviewPrompt, updateMateIconStatus as _dmUpdateMateIconStatus, connectMateProject as _dmConnectMateProject, disconnectMateProject as _dmDisconnectMateProject, appendDmMessage as _dmAppendDmMessage, showDmTypingIndicator as _dmShowDmTypingIndicator, handleDmSend as _dmHandleDmSend } from './modules/app-dm.js';
import { initMention, handleMentionStart, handleMentionStream, handleMentionDone, handleMentionError, handleMentionActivity, renderMentionUser, renderMentionResponse } from './modules/mention.js';
import { initDebate, handleDebatePreparing, handleDebateStarted, handleDebateResumed, handleDebateTurn, handleDebateActivity, handleDebateStream, handleDebateTurnDone, handleDebateCommentQueued, handleDebateCommentInjected, handleDebateEnded, handleDebateError, renderDebateStarted, renderDebateTurnDone, renderDebateEnded, renderDebateCommentInjected, renderDebateUserResume, openDebateModal, closeDebateModal, handleDebateBriefReady, renderDebateBriefReady, isDebateActive, resetDebateState, exportDebateAsPdf, renderMcpDebateProposal } from './modules/debate.js';

// --- Base path for multi-project routing ---
  var bootParams = new URLSearchParams(location.search);
  var paneMode = bootParams.get("pane") === "1";
  var paneSessionId = Number(bootParams.get("session"));
  if (!Number.isSafeInteger(paneSessionId) || paneSessionId < 1) paneSessionId = null;
  if (paneMode) document.body.classList.add("pane-mode");
  var slugMatch = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
  var homeProjectSlug = document.body.dataset.homeProjectSlug || null;
  var connectionSlug = slugMatch ? slugMatch[1] : homeProjectSlug;
  var basePath = connectionSlug ? "/p/" + connectionSlug + "/" : "/";
  var wsPath = connectionSlug ? "/p/" + connectionSlug + "/ws" : "/ws";
  if (paneMode) {
    wsPath += "?pane=1";
    if (paneSessionId) wsPath += "&session=" + paneSessionId;
  }

// --- DOM refs ---
  var $ = function (id) { return document.getElementById(id); };
  var messagesEl = $("messages");
  var inputEl = $("input");
  var sendBtn = $("send-btn");
  function getStatusDot() {
    return document.querySelector("#icon-strip-projects .icon-strip-item.active .icon-strip-status") ||
           document.querySelector("#icon-strip-projects .icon-strip-wt-item.active .icon-strip-status") ||
           document.querySelector("#icon-strip-users .icon-strip-mate.active .icon-strip-status");
  }
  var headerTitleEl = $("header-title");
  var headerRenameBtn = $("header-rename-btn");
  var slashMenu = $("slash-menu");
  var suggestionChipsEl = $("suggestion-chips");
  var sidebar = $("sidebar");
  var sidebarOverlay = $("sidebar-overlay");
  var sessionListEl = $("session-list");
  var newSessionBtn = $("new-session-btn");
  var hamburgerBtn = $("hamburger-btn");
  var sidebarToggleBtn = $("sidebar-toggle-btn");
  var sidebarExpandBtn = $("sidebar-expand-btn");
  var imagePreviewBar = $("image-preview-bar");
  var connectOverlay = $("connect-overlay");

  // --- DM Mode ---
  // dmMode, dmUnread, cachedAllUsers, cachedOnlineIds, cachedDmFavorites,
  // cachedDmConversations, dmRemovedUsers, cachedMatesList, cachedAvailableBuiltins,
  // dmTargetUser, dmKey -> store
  var dmMessageCache = []; // cached DM messages for quick debate context

  var CLAUDE_CODE_AVATAR = "/claude-code-avatar.png";

  // --- Mate project switching ---
  // mateProjectSlug, savedMainSlug, returningFromMateDm, pendingMateInterview -> store


  // --- Home Hub (delegated to app-home-hub.js) ---
  function showHomeHub(fromHistory) { _hubShowHomeHub(fromHistory); }
  function hideHomeHub() { _hubHideHomeHub(); }
  function startClayMateCreation() {
    showHomeHub();
    openHomeMateAction("mate");
  }

  // --- DM (delegated to app-dm.js) ---
  function openDm(userId) { _dmOpenDm(userId); }
  function enterDmMode(key, targetUser, messages) { _dmEnterDmMode(key, targetUser, messages); }
  function exitDmMode(skipProjectSwitch) { _dmExitDmMode(skipProjectSwitch); }
  function handleMateCreatedInApp(mate, msg) { _dmHandleMateCreatedInApp(mate, msg); }
  function buildMateInterviewPrompt(mate) { return _dmBuildMateInterviewPrompt(mate); }
  function updateMateIconStatus(msg) { _dmUpdateMateIconStatus(msg); }
  function connectMateProject(slug) { _dmConnectMateProject(slug); }
  function disconnectMateProject() { _dmDisconnectMateProject(); }
  function appendDmMessage(msg) { _dmAppendDmMessage(msg); }
  function showDmTypingIndicator(show) { _dmShowDmTypingIndicator(show); }
  function handleDmSend() { _dmHandleDmSend(); }

  // --- Project List ---
  var projectListSection = $("project-list-section");
  var projectListEl = $("project-list");
  var projectListAddBtn = $("project-list-add");
  var projectHint = $("project-hint");
  var projectHintDismiss = $("project-hint-dismiss");
  // cachedProjects, cachedProjectCount, cachedRemovedProjects -> modules/app-projects.js
  // currentProjectOwnerId -> store
  var currentSlug = connectionSlug || null; // kept for pre-store init

  // updateProjectList, renderTopbarPresence, renderProjectList -> modules/app-projects.js
  function updateProjectList(msg) { _projUpdateProjectList(msg); }
  function renderTopbarPresence(serverUsers) { _projRenderTopbarPresence(serverUsers); }
  function renderProjectList() { _projRenderProjectList(); }
  // projectListAddBtn listener -> modules/app-projects.js (initProjects)

  // Prevent Cmd+Z / Cmd+Shift+Z from triggering browser back/forward (Arc, etc.)
  // Always block browser default for Cmd+Z and manually invoke undo/redo via execCommand
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      var el = document.activeElement;
      var tag = el && el.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || (el && el.isContentEditable)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          document.execCommand("redo", false, null);
        } else {
          document.execCommand("undo", false, null);
        }
      }
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeImageModal();
    }
  });

  if (projectHintDismiss) {
    projectHintDismiss.addEventListener("click", function () {
      projectHint.classList.add("hidden");
      try { localStorage.setItem("clay-project-hint-dismissed", "1"); } catch (e) {}
    });
  }

  // Modal close handlers (replaces inline onclick)
  $("mermaid-modal").querySelector(".confirm-backdrop").addEventListener("click", closeMermaidModal);
  $("mermaid-modal").querySelector(".mermaid-modal-btn[title='Close']").addEventListener("click", closeMermaidModal);
  $("image-modal").querySelector(".confirm-backdrop").addEventListener("click", closeImageModal);
  $("image-modal").querySelector(".image-modal-close").addEventListener("click", closeImageModal);

  // showImageModal, closeImageModal -> modules/app-misc.js
  function showImageModal(src) { _miscShowImageModal(src); }
  function closeImageModal() { _miscCloseImageModal(); }

  // --- State ---
  // connected, processing, activeSessionId, sessionDrafts -> store
  // loopActive, loopAvailable, loopIteration, loopMaxIterations, loopBannerName,
  // ralphPhase, ralphCraftingSessionId, ralphCraftingSource, ralphFilesReady, ralphPreviewContent -> modules/app-loop-ui.js
  // wizardStep, wizardSource, wizardData, loopModeChoice, promptAuthor, judgeAuthor -> modules/app-loop-wizard.js
  // slashCommands, cliSessionId -> store
  var projectName = ""; // kept for pre-store localStorage init
  // turnCounter -> modules/app-rendering.js

  // Restore cached project name and icon for instant display (before WS connects)
  try {
    var _cachedProjectName = localStorage.getItem("clay-project-name-" + (currentSlug || "default"));
    if (_cachedProjectName) {
      projectName = _cachedProjectName;
      if (headerTitleEl) headerTitleEl.textContent = _cachedProjectName;
      var _tbp = $("title-bar-project-name");
      if (_tbp) _tbp.textContent = _cachedProjectName;
    }
    var _cachedProjectIcon = localStorage.getItem("clay-project-icon-" + (currentSlug || "default"));
    if (_cachedProjectIcon) {
      var _tbi = $("title-bar-project-icon");
      if (_tbi) {
        _tbi.textContent = _cachedProjectIcon;
        parseEmojis(_tbi);
        _tbi.classList.add("has-icon");
      }
    }
  } catch (e) {}
  // messageUuidMap, historyFrom, historyTotal -> store
  // prependAnchor, replayingHistory, isUserScrolledUp, scrollThreshold -> modules/app-rendering.js
  // loadingMore -> moved to store
  // historySentinelObserver -> modules/app-header.js

  // builtinCommands -> modules/input.js

  // --- Header session rename, session info popover -> modules/app-header.js
  function closeSessionInfoPopover() { _hdrCloseSessionInfoPopover(); }

  // --- Confirmation modal -> modules/app-misc.js
  function showConfirm(text, onConfirm, okLabel, destructive) { _miscShowConfirm(text, onConfirm, okLabel, destructive); }
  function hideConfirm() { _miscHideConfirm(); }

  // --- Initialize store (single source of truth for client state) ---
  createStore({
    // session / routing
    basePath: basePath,
    wsPath: wsPath,
    paneMode: paneMode,
    paneSessionId: paneSessionId,
    panePinPending: paneMode && !!paneSessionId,
    splitPanes: null,
    splitGroups: [],
    splitDelegations: {},
    dmMode: false,
    historyFrom: 0,
    loadingMore: false,
    historyTotal: 0,
    replayingHistory: false,
    projectName: projectName,
    cwd: "",
    currentSlug: currentSlug,
    activeProjectSlug: null,
    sessionActivatedProjectSlug: null,
    socketPath: null,
    pendingHomeProjectSlug: null,
    currentProjectOwnerId: null,
    isOsUsers: false,
    skipPermsEnabled: false,
    slashCommands: [],
    processing: false,
    activeSessionId: null,
    activeBackgroundTasks: [],
    sessionVendorBound: false,
    cliSessionId: null,
    isHeadlessMode: false,
    savedMainSlug: null,
    connected: false,
    pendingOutboundMessages: [],
    homeChatMateId: null,
    homeChatSessionId: null,
    homeChatSessionModel: null,
    homeChatSessionVendor: null,
    homeChatSessionModelLoading: false,
    homeMateSessions: {},
    homeActiveSessionByMate: {},
    homePreferredMateId: null,
    homeSidebarCollapsed: false,
    homeChatScope: "all",
    homeSubSurface: "chat",
    homeDebatesStatus: "idle",
    homeDebates: [],
    homeDebatesRequestId: null,
    homeDebatesError: "",
    homeSurfaceLoaded: false,
    homePrimarySurface: null,
    homeSurfaceProjectSlug: null,
    homeSurfaceIntent: null,
    homeSurfaceBootResolved: false,
    homeSurfaceRestoreRequested: false,
    dockActiveToolId: null,
    dockOpen: false,
    homeDockPreferenceLoaded: false,
    dockFocus: false,
    dockLibraryOpen: false,
    dockBackstageOpen: false,
    dockWidth: null,
    dockHasActivity: false,
    dockActivityToolId: null,
    projectLogsOpen: false,
    projectLogsWide: false,
    projectLogsFullscreen: false,
    projectLogsEntries: [],
    projectLogsSelectedRef: null,
    projectLogsView: 'list',
    projectLogsCategory: '',
    projectLogsContextMode: '',
    projectLogsIsWorktree: false,
    projectLogsListScroll: 0,
    projectLogsListRequestId: null,
    projectLogsReadRequestId: null,
    projectLogsCommentRequestId: null,
    projectLogsCommentStatusEl: null,
    projectLogsDeleteRequestId: null,
    projectLogsCanDelete: false,
    projectLogsUnread: 0,
    projectLogsSeenRevisions: {},
    installedTools: [],
    capsulesEnabled: false,
    capsulesPreferenceLoaded: false,
    homeToolRegistryLoaded: false,
    toolScanErrors: [],

    // dm
    dmTargetUser: null,
    dmKey: null,
    cachedMatesList: [],
    cachedDmFavorites: [],
    cachedAvailableBuiltins: [],
    projectMateDmsEnabled: false,
    returningFromMateDm: false,
    pendingMateInterview: null,
    pendingTermCommand: null,
    shellCommandMode: false,
    shellCommandRunning: false,
    pendingShellCommandId: null,
    mateProjectSlug: null,
    myUserId: null,
    isMultiUserMode: false,
    dmUnread: {},
    dmRemovedUsers: {},
    cachedAllUsers: [],
    cachedOnlineIds: [],
    cachedDmConversations: [],
    sessionDrafts: {},
    messageUuidMap: [],
    // rendering
    currentMsgTs: null,
    richContextUsage: null,
    currentMsgEl: null,
    currentFullText: "",
    matePreThinkingEl: null,
    thinkingState: null,
    // panels
    fileViewerFullscreen: false,
    markdownSlidesActive: false,
    markdownSlideIndex: 0,
    markdownSlideCount: 0,
    markdownSlideLevel: 1,
    markdownSlidePreferredLevel: 1,
    markdownSlideLevelExplicit: false,
    currentModel: "",
    currentModels: [],
    modelListVendor: "",
    modelListStatus: "idle",
    modelListError: "",
    modelRequestId: "",
    modelSelectionPending: null,
    modelSelectionError: "",
    // Project's last-used vendor; seeds the sidebar's "New session" button.
    lastVendor: "",
    // Static adapter metadata sent before any vendor is initialized.
    vendorInfo: {},
    // How Claude sessions open: "gui" (default) or "tui". The server sends
    // claude_open_mode_changed on connect; this seeds it beforehand so the
    // new-session menu doesn't flash the TUI-only entry.
    claudeOpenMode: "gui",
    currentMode: "default",
    currentEffort: "medium",
    currentBetas: [],
    currentThinking: "adaptive",
    currentThinkingBudget: 10000,
    sessionFullAccess: false,
    codexApproval: null,
    codexSandbox: null,
    codexWebSearch: null,
    ctxPopoverVisible: false,
    headerContextEl: null,
    // loop
    loopActive: false,
    loopAvailable: false,
    loopIteration: 0,
    loopMaxIterations: 0,
    loopBannerName: null,
    ralphPhase: "idle",
    ralphCraftingSessionId: null,
    ralphCraftingSource: null,
    ralphFilesReady: { promptReady: false, judgeReady: false, bothReady: false },
    ralphPreviewContent: { prompt: "", judge: "" },
    execModalShown: false,
    // debate
    debateStickyState: null,
    debateFloorMode: false,
    debateConcludeMode: false,
    debateEndedMode: false,
    // skills
    knownInstalledSkills: {},
    // permissions (RBAC)
    permissions: null,
    // loop wizard
    wizardData: { name: "", task: "", maxIterations: null, cron: null }
  });

  // --- Rewind (module) ---
  initRewind({
    $: $,
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get processing() { return store.get('processing'); },
    messagesEl: messagesEl,
    addSystemMessage: addSystemMessage,
  });

  // --- Theme (module) ---
  initTheme();

  // --- Tooltips ---
  initTooltips();

  // --- Long-press context menu for touch devices ---
  initLongPress();

  // --- Sidebar (module) ---
  var sidebarCtx = {
    $: $,
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get projectName() { return store.get('projectName'); },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    sidebar: sidebar,
    sidebarOverlay: sidebarOverlay,
    sidebarToggleBtn: sidebarToggleBtn,
    sidebarExpandBtn: sidebarExpandBtn,
    hamburgerBtn: hamburgerBtn,
    newSessionBtn: newSessionBtn,
    headerTitleEl: headerTitleEl,
    showConfirm: showConfirm,
    onFilesTabOpen: function () { loadRootDirectory(); },
    requestKnowledgeList: function () { requestKnowledgeList(); },
    switchProject: function (slug) { switchProject(slug); },
    openTerminal: function () { openTerminal(); },
    showHomeHub: function () { showHomeHub(); },
    openRalphWizard: function (source) { openRalphWizard(source); },
    getUpcomingSchedules: getUpcomingSchedules,
    get multiUser() { return store.get('isMultiUserMode'); },
    get myUserId() { return store.get('myUserId'); },
    get projectOwnerId() { return store.get('currentProjectOwnerId'); },
    get ownerLocked() { return store.get('ownerLocked'); },
    openDm: function (userId) { openDm(userId); },
    openMateWizard: function () { startClayMateCreation(); },
    openAddProjectModal: function () { openAddProjectModal(); },
    sendWs: function (msg) { var _ws = _getWsRef(); if (_ws && _ws.readyState === 1) _ws.send(JSON.stringify(msg)); },
    onDmRemoveUser: function (userId) { var dr = Object.assign({}, store.get('dmRemovedUsers')); dr[userId] = true; store.set({ dmRemovedUsers: dr }); },
    getHistoryFrom: function () { return store.get('historyFrom'); },
    get permissions() { return store.get('permissions'); },
    get projectList() { return getCachedProjects() || []; },
    availableBuiltins: function () { return store.get('cachedAvailableBuiltins') || []; },
  };
  // Render the customizable tool palettes BEFORE initSidebar so the
  // buttons exist in the DOM when sidebar.js (and later terminal.js /
  // mcp-ui.js / etc.) attach click handlers by ID.
  initToolPalettes();
  initProjectLogs();
  initSidebar(sidebarCtx);
  var wsGetter = function () { return _getWsRef(); };
  initMateSidebar(wsGetter);
  initMateKnowledge(wsGetter);
  initMateMemory(wsGetter, { onShow: function () { hideKnowledge(); hideNotes(); } });
  initCommandPalette({
    switchProject: function (slug) { switchProject(slug); },
    currentSlug: function () { return store.get('currentSlug'); },
    matesList: function () { return store.get('cachedMatesList') || []; },
    availableBuiltins: function () { return store.get('cachedAvailableBuiltins') || []; },
    allUsers: function () { return store.get('cachedAllUsers') || []; },
    dmConversations: function () { return store.get('cachedDmConversations') || []; },
    myUserId: function () { return store.get('myUserId'); },
    selectSession: function (id) {
      // Close any open panels before switching
      if (isSchedulerOpen()) closeScheduler();
      var stickyPanel = document.getElementById("sticky-notes-panel");
      if (stickyPanel && !stickyPanel.classList.contains("hidden")) {
        var stickyBtn = document.getElementById("sticky-notes-sidebar-btn");
        if (stickyBtn) stickyBtn.click();
      }
      var _ws = _getWsRef();
      if (_ws && _ws.readyState === 1) {
        _ws.send(JSON.stringify({ type: "switch_session", id: id }));
      }
    },
    openDm: function (userId) { openDm(userId); },
    runAction: function (action) {
      switch (action) {
        case "createMate": startClayMateCreation(); break;
        case "openSettings":
          var sb = document.getElementById("server-settings-btn");
          if (sb) sb.click();
          break;
        case "showHome": showHomeHub(); break;
      }
    },
  });

  // Project switcher (Cmd/Ctrl+E). Init after command palette so its
  // keydown listener registers later — capture-phase ordering doesn't
  // matter here but it keeps related bootstrap steps adjacent.
  initProjectSwitcher();
  initSplitView();
  initPaneBridge();

  // --- Favicon, IO blink, status/activity -> modules/app-favicon.js
  function startPixelAnim() {}
  function stopPixelAnim() {}
  function updateFavicon(bgColor) { _favUpdateFavicon(bgColor); }
  function setSendBtnMode(mode) { _favSetSendBtnMode(mode); }
  function blinkIO() { _favBlinkIO(); }
  function blinkSessionDot(sessionId) { _favBlinkSessionDot(sessionId); }
  function updateCrossProjectBlink() { _favUpdateCrossProjectBlink(); }
  function startUrgentBlink() { _favStartUrgentBlink(); }
  function stopUrgentBlink() { _favStopUrgentBlink(); }
  function setStatus(status) { _connSetStatus(status); }
  function setActivity(text) { _favSetActivity(text); }

  // --- Pre-thinking (delegated to app-rendering.js) ---
  function showClaudePreThinking() { _renShowClaudePreThinking(); }
  function showMatePreThinking() { _renShowMatePreThinking(); }
  function removeMatePreThinking() { _renRemoveMatePreThinking(); }

  // --- Config chip, usage, status, context panels (delegated to app-panels.js) ---
  // currentModels, currentModel, currentMode, currentEffort, currentBetas,
  // currentThinking, currentThinkingBudget, sessionUsage, contextData,
  // headerContextEl, richContextUsage, ctxPopoverVisible -> modules/app-panels.js
  // skipPermsEnabled, isOsUsers -> store

  function updateConfigChip() { _panUpdateConfigChip(); }
  function getModelEffortLevels() { return _panGetModelEffortLevels(); }
  function getModelSupportsEffort() { return _panGetModelSupportsEffort(); }
  function formatTokens(n) { return _panFormatTokens(n); }
  function updateUsagePanel() { _panUpdateUsagePanel(); }
  function accumulateUsage(cost, usage) { _panAccumulateUsage(cost, usage); }
  function resetUsage() { _panResetUsage(); }
  function toggleUsagePanel() { _panToggleUsagePanel(); }
  function formatBytes(n) { return _panFormatBytes(n); }
  function formatUptime(s) { return _panFormatUptime(s); }
  function updateStatusPanel(data) { _panUpdateStatusPanel(data); }
  function requestProcessStats() { _panRequestProcessStats(); }
  function toggleStatusPanel() { _panToggleStatusPanel(); }
  function updateContextPanel() { _panUpdateContextPanel(); }
  function accumulateContext(cost, usage, modelUsage, lastStreamInputTokens) { _panAccumulateContext(cost, usage, modelUsage, lastStreamInputTokens); }
  function resetContext() { _panResetContext(); }
  function resetContextData() { _panResetContextData(); }
  function minimizeContext() { _panMinimizeContext(); }
  function expandContext() { _panExpandContext(); }
  function toggleContextPanel() { _panToggleContextPanel(); }
  function getContextView() { return _panGetContextView(); }
  function renderCtxPopover() { _panRenderCtxPopover(); }
  function hideCtxPopover() { _panHideCtxPopover(); }

  // addToMessages, scrollToBottom, forceScrollToBottom -> modules/app-rendering.js
  function addToMessages(el) { _renAddToMessages(el); }

  var newMsgBtn = $("new-msg-btn");
  var newMsgBtnDefault = "\u2193 Latest";
  var newMsgBtnActivity = "\u2193 New activity";

  // The composer grows for mobile tabs, safe areas, multiline input, and the
  // keyboard. Keep the jump button immediately above its real height instead
  // of relying on one fixed bottom offset.
  function positionNewMsgButton() {
    var inputArea = $("input-area");
    if (!inputArea) return;
    newMsgBtn.style.bottom = (inputArea.offsetHeight + 12) + "px";
  }
  var inputAreaForNewMsgBtn = $("input-area");
  if (inputAreaForNewMsgBtn && window.ResizeObserver) {
    new ResizeObserver(positionNewMsgButton).observe(inputAreaForNewMsgBtn);
  } else {
    window.addEventListener("resize", positionNewMsgButton);
  }
  positionNewMsgButton();

  messagesEl.addEventListener("scroll", function () {
    // While sticky-bottom is armed (e.g. just after history_done or a "New
    // activity" click), suppress "user scrolled up" detection. Growth-induced
    // scroll events from deferred layout are not the user — the ResizeObserver
    // is busy re-pinning to bottom. Real user input (wheel/touch/PageUp)
    // disarms the flag separately, so this gate doesn't block genuine intent.
    if (getStickyBottom()) return;
    var distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    var scrolledUp = distFromBottom > 150;
    setIsUserScrolledUp(scrolledUp);
    if (scrolledUp) {
      if (newMsgBtn.classList.contains("hidden")) {
        newMsgBtn.textContent = newMsgBtnDefault;
      }
      newMsgBtn.classList.remove("hidden");
    } else {
      newMsgBtn.classList.add("hidden");
      newMsgBtn.textContent = newMsgBtnDefault;
    }
  });

  newMsgBtn.addEventListener("click", function () {
    forceScrollToBottom();
  });

  // Scroll to bottom when returning to the app (e.g. switching back from another
  // Android app or tab). Without this the browser restores a stale scroll offset
  // and leaves the user stranded mid-session instead of at the latest message.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      scrollToBottom();
    }
  });

  // Fork session from a user message
  messagesEl.addEventListener("click", function(e) {
    var btn = e.target.closest(".msg-action-fork");
    if (!btn) return;
    var msgEl = btn.closest("[data-uuid]");
    if (!msgEl || !msgEl.dataset.uuid) return;
    var forkUuid = msgEl.dataset.uuid;
    showConfirm("Fork session from this message?", function() {
      var _ws = _getWsRef();
      if (_ws && _ws.readyState === 1) {
        _ws.send(JSON.stringify({ type: "fork_session", uuid: forkUuid }));
      }
    }, "Fork", false);
  });

  function scrollToBottom() { _renScrollToBottom(); }
  function forceScrollToBottom() { _renForceScrollToBottom(); }

  // --- Misc module (modals, PWA, extension bridge, force PIN) ---
  initMisc();

  // --- Favicon module ---
  initFavicon();

  // --- Header module (rename, info popover, history) ---
  initHeader();
  initSessionActions();

  // --- Skill Install module ---
  initSkillInstall();

  // --- Debate UI module ---
  initDebateUi();

  initLoopUi();
  initBackgroundTasksUi();
  initLoopWizard();

  // --- Notifications module ---
  initAppNotifications();

  // --- What's New viewer ---
  initWhatsNewArticle();
  initWhatsNew({
    // "Read more" in the carousel opens the dedicated article viewer
    // for the chosen entry, jumping straight to the body content
    // (skipping the home list).
    onReadMore: function (entryId) {
      if (entryId) openWhatsNewArticle(entryId);
    },
  });

  // --- Panels module ---
  initPanels();

  // --- Header TUI font controls (visible only when TUI session active) ---
  initHeaderTuiFont();

  // --- Rendering module ---
  initRendering();

  // --- Tools module ---
  initTools({
    $: $,
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get turnCounter() { return getTurnCounter(); },
    messagesEl: messagesEl,
    inputEl: inputEl,
    finalizeAssistantBlock: function() { finalizeAssistantBlock(); },
    addToMessages: function(el) { addToMessages(el); },
    scrollToBottom: function() { scrollToBottom(); },
    setActivity: function(text) { setActivity(text); },
    stopUrgentBlink: function() { stopUrgentBlink(); },
    showImageModal: showImageModal,
    getContextPercent: function() {
      var cd = getContextData();
      return cd.contextWindow > 0 ? Math.round((cd.input / cd.contextWindow) * 100) : 0;
    },
    isMateDm: function () { return store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate; },
    getMateName: function () { return store.get('dmTargetUser') ? (store.get('dmTargetUser').displayName || "Mate") : "Mate"; },
    getMateAvatarUrl: function () { return document.body.dataset.mateAvatarUrl || ""; },
    getClaudeAvatar: function () { return CLAUDE_CODE_AVATAR; },
    getMateById: function (id) {
      var ml = store.get('cachedMatesList');
      if (!id || !ml) return null;
      for (var i = 0; i < ml.length; i++) {
        if (ml[i].id === id) return ml[i];
      }
      return null;
    },
  });

  // isPlanFile, toolSummary, toolActivityText, shortPath -> modules/tools.js

  // AskUserQuestion, PermissionRequest, Plan, Todo, Thinking, Tool items -> modules/tools.js

  // --- DOM: Messages (delegated to app-rendering.js) ---
  function addUserMessage(text, images, pastes, fromUserId, fromUserName) { _renAddUserMessage(text, images, pastes, fromUserId, fromUserName); }
  function getMsgTime() { return _renGetMsgTime(); }
  function shouldGroupMessage(senderClass) { return _renShouldGroupMessage(senderClass); }
  function ensureAssistantBlock() { return _renEnsureAssistantBlock(); }
  function addCopyHandler(msgEl, rawText) { _renAddCopyHandler(msgEl, rawText); }
  function appendDelta(text) { _renAppendDelta(text); }
  function flushStreamBuffer() { _renFlushStreamBuffer(); }
  function finalizeAssistantBlock() { _renFinalizeAssistantBlock(); }
  function addSystemMessage(text, isError) { _renAddSystemMessage(text, isError); }
  function addConflictMessage(msg) { _renAddConflictMessage(msg); }
  function addContextOverflowMessage(msg) { _renAddContextOverflowMessage(msg); }

  // pendingTermCommand -> store

  // --- Rate Limit ---


  // --- Rate Limit / Scheduled Messages / Fast Mode (delegated to app-rate-limit.js) ---
  function handleRateLimitEvent(msg) { _rlHandleRateLimitEvent(msg); }
  function updateRateLimitUsage(msg) { _rlUpdateRateLimitUsage(msg); }
  function addScheduledMessageBubble(text, resetsAt) { _rlAddScheduledMessageBubble(text, resetsAt); }
  function removeScheduledMessageBubble() { _rlRemoveScheduledMessageBubble(); }
  function handleFastModeState(state) { _rlHandleFastModeState(state); }

  // --- Prompt suggestion chips (delegated to app-rendering.js) ---
  function showSuggestionChips(suggestion) { _renShowSuggestionChips(suggestion); }
  function hideSuggestionChips() { _renHideSuggestionChips(); }

  // resetClientState, switchProject -> modules/app-projects.js
  function resetClientState() { _projResetClientState(); }
  function switchProject(slug) { _projSwitchProject(slug); }

  window.addEventListener("popstate", function () {
    var m = location.pathname.match(/^\/p\/([a-z0-9_-]+)/);
    var newSlug = m ? m[1] : null;
    if (!newSlug) {
      showHomeHub(true);
      return;
    }
    rememberHomePrimarySurface("project", newSlug);
    if (isHomeHubVisible()) hideHomeHub();
    if (newSlug && newSlug !== store.get('currentSlug')) {
      resetFileBrowser();
      closeNotesBrowser();
      if (isSchedulerOpen()) closeScheduler();
      resetScheduler(newSlug);
      store.set({ currentSlug: newSlug });
      basePath = "/p/" + newSlug + "/";
      wsPath = "/p/" + newSlug + "/ws";
      store.set({ basePath: basePath, wsPath: wsPath });
      resetClientState();
      connect();
    }
  });

  // --- WebSocket (delegated to app-connection.js) ---
  function connect() { _connConnect(); }
  function scheduleReconnect() { _connScheduleReconnect(); }

  function showUpdateAvailable(msg) { _projShowUpdateAvailable(msg); }

  function processMessage(msg) { _msgProcessMessage(msg); }

  // processMessage body moved to modules/app-messages.js (PR-23)


  // --- Progressive history loading -> modules/app-header.js
  function updateHistorySentinel() { _hdrUpdateHistorySentinel(); }
  function requestMoreHistory() { _hdrRequestMoreHistory(); }
  function prependOlderHistory(items, meta) { _hdrPrependOlderHistory(items, meta); }

  // --- Input module (sendMessage, autoResize, paste/image, slash menu, input handlers) ---
  initInput({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get processing() { return store.get('processing'); },
    get basePath() { return basePath; },
    inputEl: inputEl,
    sendBtn: sendBtn,
    slashMenu: slashMenu,
    messagesEl: messagesEl,
    imagePreviewBar: imagePreviewBar,
    slashCommands: function() { return store.get('slashCommands'); },
    messageUuidMap: function() { return store.get('messageUuidMap'); },
    addUserMessage: addUserMessage,
    addSystemMessage: addSystemMessage,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
    toggleContextPanel: toggleContextPanel,
    resetContextData: resetContextData,
    showImageModal: showImageModal,
    hideSuggestionChips: hideSuggestionChips,
    getGhostSuggestion: function () { return _renGetGhostSuggestion(); },
    setSendBtnMode: setSendBtnMode,
    isDmMode: function () { return store.get('dmMode') && !(store.get('dmTargetUser') && store.get('dmTargetUser').isMate); },
    getDmKey: function () { return store.get('dmKey'); },
    handleDmSend: function () { handleDmSend(); },
    isDebateEndedMode: function () { return store.get('debateEndedMode'); },
    handleDebateEndedSend: function () { handleDebateEndedSend(); },
    isDebateConcludeMode: function () { return store.get('debateConcludeMode'); },
    handleDebateConcludeSend: function () { handleDebateConcludeSend(); },
    isDebateFloorMode: function () { return store.get('debateFloorMode'); },
    handleDebateFloorSend: function () { handleDebateFloorSend(); },
    isMateDm: function () { return store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate; },
    getDmMateId: function () { var _dmt = store.get('dmTargetUser'); return (store.get('dmMode') && _dmt && _dmt.isMate) ? _dmt.id : null; },
    getMateName: function () { return store.get('dmTargetUser') ? (store.get('dmTargetUser').displayName || "Mate") : "Mate"; },
    getMateAvatarUrl: function () { return document.body.dataset.mateAvatarUrl || ""; },
    showMatePreThinking: function () { showMatePreThinking(); },
    showClaudePreThinking: function () { showClaudePreThinking(); },
    myUserId: function () { return store.get('myUserId'); },
    myDisplayName: function () {
      var u = null;
      try { u = JSON.parse(localStorage.getItem("clay_my_user") || "null"); } catch (e) {}
      return (u && (u.displayName || u.username)) || document.body.dataset.myDisplayName || "Me";
    },
  });

  initShellCommand();

  // --- @Mention module ---
  initMention({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    inputEl: inputEl,
    messagesEl: messagesEl,
    matesList: function () { return store.get('cachedMatesList') || []; },
    availableBuiltins: function () { return store.get('cachedAvailableBuiltins') || []; },
    allUsers: function () { return store.get('cachedAllUsers') || []; },
    myUserId: function () { return store.get('myUserId'); },
    scrollToBottom: scrollToBottom,
    addUserMessage: addUserMessage,
    addCopyHandler: addCopyHandler,
    addToMessages: addToMessages,
    showImageModal: showImageModal,
    showPasteModal: showPasteModal,
  });

  // --- Debate module ---
  initDebate({
    get ws() { return _getWsRef(); },
    sendWs: function (obj) { var _ws = _getWsRef(); if (_ws && _ws.readyState === 1) _ws.send(JSON.stringify(obj)); },
    messagesEl: messagesEl,
    addToMessages: function (el) { addToMessages(el); },
    scrollToBottom: scrollToBottom,
    addCopyHandler: addCopyHandler,
    matesList: function () { return store.get('cachedMatesList') || []; },
    availableBuiltins: function () { return store.get('cachedAvailableBuiltins') || []; },
    currentMateId: function () {
      if (store.get('dmTargetUser') && store.get('dmTargetUser').isMate) return store.get('dmTargetUser').id;
      return store.get('homeChatMateId') || null;
    },
    requireSkills: requireSkills,
    showDebateEndedMode: function (msg) { showDebateEndedMode(msg); },
  });

  // --- STT module (voice input via Web Speech API) ---
  initSTT({
    inputEl: inputEl,
    addSystemMessage: addSystemMessage,
    scrollToBottom: scrollToBottom,
  });

  // --- User profile (Discord-style popover on user island) ---
  initProfile({
    basePath: basePath,
  });

  // --- User settings (full-screen overlay) ---
  initUserSettings({
    basePath: basePath,
  });

  // --- Force PIN change overlay -> modules/app-misc.js
  function showForceChangePinOverlay() { _miscShowForceChangePinOverlay(); }

  // --- Admin (multi-user mode) ---
  // isMultiUserMode, isHeadlessMode, myUserId -> store
  initAdmin({
    get projectList() { return getCachedProjects(); },
  });
  fetch("/api/me").then(function (r) { return r.json(); }).then(function (d) {
    if (d.multiUser) {
      store.set({ isMultiUserMode: true });
      // The shared strip also hosts other users in multi-user deployments;
      // the project Mate DM preference therefore hides only Mate shortcuts.
      if (document.body) document.body.classList.add('is-multi-user');
    }
    if (d.user && d.user.id) { store.set({ myUserId: d.user.id }); }
    if (d.permissions) store.set({ permissions: d.permissions });
    if (d.mustChangePin) showForceChangePinOverlay();
    // Single-user mode: clear user strip skeletons immediately (no presence message will arrive)
    if (!store.get('isMultiUserMode')) {
      var usersContainer = document.getElementById("icon-strip-users");
      if (usersContainer) {
        usersContainer.innerHTML = "";
        usersContainer.classList.add("hidden");
      }
    }
    initCursorToggle();
    // Apply RBAC UI gating
    var _perms = store.get('permissions');
    if (_perms) {
      if (!_perms.terminal) {
        var termBtn = document.getElementById("terminal-toggle-btn");
        if (termBtn) termBtn.style.display = "none";
        var termSideBtn = document.getElementById("terminal-sidebar-btn");
        if (termSideBtn) termSideBtn.style.display = "none";
        var shellCommandBtn = document.getElementById("shell-command-btn");
        if (shellCommandBtn) shellCommandBtn.style.display = "none";
        var mobileShellCommandBtn = document.getElementById("input-more-shell");
        if (mobileShellCommandBtn) mobileShellCommandBtn.style.display = "none";
      }
      if (!_perms.fileBrowser) {
        var fbBtn = document.getElementById("file-browser-btn");
        if (fbBtn) fbBtn.style.display = "none";
        var gitPlacardEl = document.getElementById("git-placard");
        if (gitPlacardEl) gitPlacardEl.style.display = "none";
      }
      if (!_perms.skills) {
        var sBtn = document.getElementById("skills-btn");
        if (sBtn) sBtn.style.display = "none";
        var msBtn = document.getElementById("mate-skills-btn");
        if (msBtn) msBtn.style.display = "none";
      }
      if (!_perms.scheduledTasks) {
        var schBtn = document.getElementById("home-scheduler-btn");
        if (schBtn) schBtn.style.display = "none";
        var schToolBtn = document.getElementById("scheduler-btn");
        if (schToolBtn) schToolBtn.style.display = "none";
      }
      if (!_perms.createProject) {
        var addProjBtn = document.getElementById("icon-strip-add");
        if (addProjBtn) addProjBtn.style.display = "none";
      }
    }
  }).catch(function () {});
  // Hide server settings and update controls for non-admin users in multi-user mode
  checkAdminAccess().then(function (isAdmin) {
    if (store.get('isMultiUserMode') && !isAdmin) {
      var settingsBtn = document.getElementById("server-settings-btn");
      if (settingsBtn) settingsBtn.style.display = "none";
      var updatePill = document.getElementById("update-pill-wrap");
      if (updatePill) updatePill.style.display = "none";
    }
  });

  // --- Notifications module (viewport, banners, notifications, debug, service worker) ---
  initNotifications({
    $: $,
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    messagesEl: messagesEl,
    sessionListEl: sessionListEl,
    scrollToBottom: scrollToBottom,
    forceScrollToBottom: forceScrollToBottom,
    basePath: basePath,
    toggleUsagePanel: toggleUsagePanel,
    toggleStatusPanel: toggleStatusPanel,
  });

  // --- Server Settings ---
  initServerSettings({
    get ws() { return _getWsRef(); },
    get projectName() { return store.get('projectName'); },
    get currentSlug() { return store.get('currentSlug'); },
    wsPath: wsPath,
    get currentModels() { return store.get('currentModels'); },
    set currentModels(v) { store.set({ currentModels: v }); },
    get currentModel() { return store.get('currentModel'); },
    get currentMode() { return store.get('currentMode'); },
    get currentEffort() { return store.get('currentEffort'); },
    get currentBetas() { return store.get('currentBetas'); },
    get currentThinking() { return store.get('currentThinking'); },
    get currentThinkingBudget() { return store.get('currentThinkingBudget'); },
    setContextView: function (v) { _panSetContextView(v); },
    applyContextView: function (v) { _panApplyContextView(v); },
  });

  // --- Project Settings ---
  initProjectSettings({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get currentModels() { return store.get('currentModels'); },
    get currentModel() { return store.get('currentModel'); },
    get currentMode() { return store.get('currentMode'); },
    get currentEffort() { return store.get('currentEffort'); },
    get currentBetas() { return store.get('currentBetas'); },
    get currentThinking() { return store.get('currentThinking'); },
    get currentThinkingBudget() { return store.get('currentThinkingBudget'); },
  }, getEmojiCategories());

  // --- QR code ---
  initQrCode();
  var sharePill = document.getElementById("share-pill");
  if (sharePill) sharePill.addEventListener("click", triggerShare);

  // --- File browser ---
  initFileBrowser({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get activeSessionId() { return store.get('activeSessionId'); },
    get cwd() { return store.get('cwd'); },
    messagesEl: messagesEl,
    fileTreeEl: $("file-tree"),
    fileViewerEl: $("file-viewer"),
  });
  initGitPanel();
  initWorkerPaneLock();

  // --- Terminal ---
  initTerminal({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    terminalContainerEl: $("terminal-container"),
    terminalBodyEl: $("terminal-body"),
    fileViewerEl: $("file-viewer"),
  });

  // --- Context Sources ---
  initContextSources({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
  });

  // --- Chrome Extension Bridge -> modules/app-misc.js
  function sendExtensionCommand(command, args, requestId) { _miscSendExtensionCommand(command, args, requestId); }
  function handleExtensionResult(requestId, result) { _miscHandleExtensionResult(requestId, result); }

  // --- Playbook Engine ---
  initPlaybook();

  // Auto-open playbook from URL param (e.g. ?playbook=push-notifications)
  (function () {
    var params = new URLSearchParams(window.location.search);
    var pbId = params.get("playbook");
    if (pbId) {
      // Small delay to ensure DOM and playbook registry are ready
      setTimeout(function () { openPlaybook(pbId); }, 300);
      // Clean up URL
      params.delete("playbook");
      var clean = params.toString();
      var newUrl = window.location.pathname + (clean ? "?" + clean : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }
  })();

  // --- In-session search (Cmd+F / Ctrl+F) ---
  initSessionSearch({
    messagesEl: messagesEl,
    get ws() { return _getWsRef(); },
    getHistoryFrom: function () { return store.get('historyFrom'); },
  });
  var findInSessionBtn = $("find-in-session-btn");
  if (findInSessionBtn) {
    findInSessionBtn.addEventListener("click", function () {
      toggleSearch();
    });
  }

  // --- Sticky Notes ---
  // The canvas reads the socket from ws-ref and the connection flag from the
  // store directly, so it needs no injected context.
  initStickyNotes();
  initNotesBrowser();
  // The browser refreshes from note messages without the canvas module having
  // to import it, which would be a cycle.
  setBrowserRefresh(function () { if (isNotesBrowserOpen()) renderNotesBrowser(); });
  // Opening the browser claims the single right workbench slot. Registered here
  // so the browser module never imports the other tools.
  registerExclusiveClosers([closeProjectLogs, closeScheduler, closeFileViewer, closeTerminal]);

  // --- Sticky Notes sidebar button (create new note) ---
  var stickyNotesSidebarBtn = $("sticky-notes-sidebar-btn");
  if (stickyNotesSidebarBtn) {
    stickyNotesSidebarBtn.addEventListener("click", function () {
      closeProjectLogs();
      if (isSchedulerOpen()) closeScheduler();
      if (isNotesBrowserOpen()) closeNotesBrowser();
      showNotes();
      createNote();
    });
  }

  // Sticky Notes badge click → archive toggle
  var stickyNotesBadge = $("sticky-notes-sidebar-count");
  if (stickyNotesBadge) {
    stickyNotesBadge.addEventListener("click", function (e) {
      e.stopPropagation();
      closeProjectLogs();
      if (isSchedulerOpen()) closeScheduler();
      if (isNotesBrowserOpen()) {
        closeNotesBrowser();
      } else {
        openNotesBrowser();
      }
    });
  }

  // Close the notes browser / scheduler panel when switching to other sidebar panels
  var fileBrowserBtn = $("file-browser-btn");
  var gitPlacardMoreBtn = $("git-placard-more");
  var terminalSidebarBtn = $("terminal-sidebar-btn");
  if (fileBrowserBtn) fileBrowserBtn.addEventListener("click", function () { closeProjectLogs(); if (isNotesBrowserOpen()) closeNotesBrowser(); if (isSchedulerOpen()) closeScheduler(); });
  if (gitPlacardMoreBtn) gitPlacardMoreBtn.addEventListener("click", function () { closeProjectLogs(); if (isNotesBrowserOpen()) closeNotesBrowser(); if (isSchedulerOpen()) closeScheduler(); });
  if (terminalSidebarBtn) terminalSidebarBtn.addEventListener("click", function () { closeProjectLogs(); if (isNotesBrowserOpen()) closeNotesBrowser(); if (isSchedulerOpen()) closeScheduler(); });

  // --- Ralph Loop UI (delegated to app-loop-ui.js + app-loop-wizard.js) ---
  function updateLoopInputVisibility(loop) { _loopUpdateLoopInputVisibility(loop); }
  function updateLoopButton() { _loopUpdateLoopButton(); }
  function showLoopBanner(show) { _loopShowLoopBanner(show); }
  function updateLoopBanner(iteration, maxIterations, phase) { _loopUpdateLoopBanner(iteration, maxIterations, phase); }
  function updateRalphBars() { _loopUpdateRalphBars(); }
  function showRalphCraftingBar(show) { _loopShowRalphCraftingBar(show); }
  function showRalphApprovalBar(show) { _loopShowRalphApprovalBar(show); }
  function updateRalphApprovalStatus() { _loopUpdateRalphApprovalStatus(); }
  function openRalphPreviewModal() { _loopOpenRalphPreviewModal(); }
  function showExecModal() { _loopShowExecModal(); }
  function closeExecModal() { _loopCloseExecModal(); }
  function updateExecModalStatus() { _loopUpdateExecModalStatus(); }

  // --- Notifications (delegated to app-notifications.js) ---
  function handleNotificationsState(msg) { _notifHandleState(msg); }
  function handleNotificationCreated(msg) { _notifHandleCreated(msg); }
  function handleNotificationDismissed(msg) { _notifHandleDismissed(msg); }
  function handleNotificationDismissedAll() { _notifHandleDismissedAll(); }

  // --- Skill install dialog (delegated to app-skills-install.js) ---
  // knownInstalledSkills, pendingSkillInstalls -> modules/app-skills-install.js
  function requireSkills(opts, cb) { _siRequireSkills(opts, cb); }
  function handleSkillInstallWs(msg) { _siHandleSkillInstallWs(msg); }


  // Debate button in mate sidebar (only visible in DM mode)
  var debateBtn = document.getElementById("mate-debate-btn");
  if (debateBtn) {
    debateBtn.addEventListener("click", function () {
      var contextMessages = dmMessageCache.map(function (m) {
        return { text: m.text, isMate: m.from !== store.get('myUserId') };
      });
      openDebateModal({ dmContext: contextMessages });
    });
  }

  // --- Ralph Wizard (delegated to app-loop-wizard.js) ---
  function openRalphWizard(source) { _loopOpenRalphWizard(source); }
  function closeRalphWizard() { _loopCloseRalphWizard(); }

  // --- Debate UI (delegated to app-debate-ui.js) ---
  // debateStickyState, debateHandRaiseOpen, debateFloorMode, debateConcludeMode, debateEndedMode -> modules/app-debate-ui.js
  function showDebateConcludeConfirm(msg) { _debShowDebateConcludeConfirm(msg); }
  function exitDebateConcludeMode() { _debExitDebateConcludeMode(); }
  function handleDebateConcludeSend() { _debHandleDebateConcludeSend(); }
  function showDebateEndedMode(msg) { _debShowDebateEndedMode(msg); }
  function exitDebateEndedMode() { _debExitDebateEndedMode(); }
  function showDebateUserFloor(msg) { _debShowDebateUserFloor(msg); }
  function exitDebateFloorMode() { _debExitDebateFloorMode(); }
  function handleDebateFloorSend() { _debHandleDebateFloorSend(); }
  function renderDebateUserFloorDone(msg) { _debRenderDebateUserFloorDone(msg); }
  function showDebateSticky(phase, msg) { _debShowDebateSticky(phase, msg); }
  function showDebateBottomBar(mode, msg) { _debShowDebateBottomBar(mode, msg); }
  function removeDebateBottomBar() { _debRemoveDebateBottomBar(); }
  function sendDebateStickyComment() { _debSendDebateStickyComment(); }
  function updateDebateRound(round) { _debUpdateDebateRound(round); }

  // --- Ralph Preview Modal (delegated to app-loop-ui.js) ---

  // --- MCP Servers ---
  initMcp();

  // --- Skills ---
  initSkills();

  // --- Scheduler ---
  initScheduler({
    get ws() { return _getWsRef(); },
    get connected() { return store.get('connected'); },
    get activeSessionId() { return store.get('activeSessionId'); },
    basePath: basePath,
    currentSlug: currentSlug, // init-time snapshot, scheduler uses for initial setup
    openRalphWizard: function (source) { openRalphWizard(source); },
    requireClayRalph: function (cb) {
      requireSkills({
        title: "Skill Installation Required",
        reason: "This feature requires the following skill to be installed.",
        skills: [{ name: "clay-ralph", url: "https://github.com/chadbyte/clay-ralph", scope: "global" }]
      }, cb);
    },
    getProjects: function () { return getCachedProjects(); },
  });

  // --- Remove/Add project (delegated to app-projects.js) ---
  function confirmRemoveProject(slug, name) { _projConfirmRemoveProject(slug, name); }
  function handleRemoveProjectCheckResult(msg) { _projHandleRemoveProjectCheckResult(msg); }
  function handleRemoveProjectResult(msg) { _projHandleRemoveProjectResult(msg); }
  function openAddProjectModal() { _projOpenAddProjectModal(); }
  function closeAddProjectModal() { _projCloseAddProjectModal(); }
  function handleBrowseDirResult(msg) { _projHandleBrowseDirResult(msg); }
  function handleAddProjectResult(msg) { _projHandleAddProjectResult(msg); }
  function handleCloneProgress(msg) { _projHandleCloneProgress(msg); }

  // --- PWA install prompt -> modules/app-misc.js (set up in initMisc)


  // --- Remote Cursors (delegated to app-cursors.js) ---
  function handleRemoteCursorMove(msg) { _curHandleRemoteCursorMove(msg); }
  function handleRemoteCursorLeave(msg) { _curHandleRemoteCursorLeave(msg); }
  function handleRemoteSelection(msg) { _curHandleRemoteSelection(msg); }
  function clearRemoteCursors() { _curClearRemoteCursors(); }

  // --- Cursors module ---
  initCursors();

  // --- Rate Limit module ---
  initRateLimit();

  // --- Projects module ---
  initProjects();

  // --- Home Hub module ---
  initHomeHub();
  initHomeSidebar();
  initHomeSurfaceBoot();

  // Mates live on the home hub now, so keep that pane and the C button
  // badge in sync with the mate list, unread DMs, and mention activity.
  store.subscribe(function (state, prev) {
    if (state.cachedMatesList !== prev.cachedMatesList || state.dmUnread !== prev.dmUnread) {
      renderHomeMateSwitcher();
      updateHomeIconBadge();
    }
  });
  onMentionActiveChange(function () {
    renderHomeMateSwitcher();
  });
  updateHomeIconBadge();

  // --- DM module ---
  initDm();

  // --- Messages module (uses direct imports, no ctx injection needed) ---

  // --- Connection module ---
  initConnection();

  // --- Init ---
  lucide.createIcons();
  connect();
  if (slugMatch && location.hash === "#scheduler") {
    // Restore scheduler view after refresh
    setTimeout(function () { openSchedulerToTab("calendar"); }, 500);
  } else if (slugMatch) {
    inputEl.focus();
  }
