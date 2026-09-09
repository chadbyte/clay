// app-messages.js - WebSocket message router
// Extracted from app.js (PR-23)
// All dependencies are direct imports; no context injection needed.

import { store } from './store.js';
import { acknowledgeMessage, replayPendingMessages } from './message-delivery.js';
import { getWs } from './ws-ref.js';

// --- Leaf module imports ---
import { showToast } from './utils.js';
import { refreshIcons, iconHtml } from './icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks } from './markdown.js';
import { updatePageTitle } from './sidebar.js';
import { renderSessionList, updateSessionPresence, handleSearchResults, updateSessionBadge } from './sidebar-sessions.js';
import { updateDmBadge, setMentionActive, renderUserStrip } from './sidebar-mates.js';
import { renderSidebarPresence } from './sidebar-presence.js';
import { refreshMobileChatSheet } from './sidebar-mobile.js';
import { renderMateSessionList, handleMateSearchResults, updateMateSidebarProfile } from './mate-sidebar.js';
import { openHomeChat, handleHomeMateHistory, handleHomeMateDelta, handleHomeMateSegment, handleHomeMateDone, handleHomeMateError, handleHomeMateSessionsState } from './home-mate-chat.js';
import { handleHomeSurfaceState } from './home-surface.js';
import { handleHomeMateMemoryState, handleHomeMateKnowledgeState } from './home-mate-settings.js';
import { renderKnowledgeList, handleKnowledgeContent } from './mate-knowledge.js';
import { renderMemoryList } from './mate-memory.js';
import { handlePaletteSessionSwitch, setPaletteVersion } from './command-palette.js';
import { handleFindInSessionResults } from './session-search.js';
import { syncPaneTitles, maybeRestoreSplitGroup, openGroup } from './split-view.js';
import { showPairDialog, handlePairCreated, handleSplitDelegation, showWorkerDelegationNotice, hideWorkerDelegationNotice } from './split-pair-ui.js';
import { handleSessionActionMessage } from './session-actions.js';
import { renderWorkerProposal, updateWorkerProposal } from './worker-proposal.js';
import { handleInputSync, autoResize, builtinCommands, setScheduleBtnDisabled, sendShellResultToAgent } from './input.js';
import { startThinking, appendThinking, stopThinking, resetThinkingGroup, createToolItem, updateToolExecuting, updateToolResult, markAllToolsDone, closeToolGroup, removeToolFromGroup, resetToolState, getTools, getPlanContent, setPlanContent, renderPlanBanner, renderPlanCard, getTodoTools, handleTodoWrite, handleTaskCreate, handleTaskUpdate, applyDeadSessionTodoCompaction, isPlanFilePath, enableMainInput, addTurnMeta, updateSubagentActivity, addSubagentToolEntry, markSubagentDone, initSubagentStop, updateSubagentProgress, updateSubagentTaskStatus, renderAskUserQuestion, markAskUserAnswered, renderPermissionRequest, markPermissionCancelled, markPermissionResolved, renderElicitationRequest, markElicitationResolved, renderUserDialogRequest, markUserDialogResolved, updateThinkingTokens } from './tools.js';
import { finishThinkingTurn, resumeThinkingAfterReplay } from './thinking-lifecycle.js';
import { showDoneNotification, playDoneSound, isNotifAlertEnabled, isNotifSoundEnabled } from './notifications.js';
import { handleFsList, handleFsRead, handleFileChanged, handleDirChanged, handleFileHistory, handleGitDiff, handleFileAt, refreshIfOpen, getPendingNavigate, handleFsSearch, presentMarkdownEdit } from './filebrowser.js';
import { beginMarkdownTurn, finishMarkdownTurn, markdownPathFromToolInput } from './markdown-live-edit.js';
import { forwardPaneMarkdownPresentation } from './pane-bridge.js';
import { isProjectSettingsOpen, handleInstructionsRead, handleInstructionsWrite, handleProjectEnv, handleProjectEnvSaved, handleProjectSharedEnv, handleProjectSharedEnvSaved, handleProjectOwnerChanged } from './project-settings.js';
import { updateSettingsStats, updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleInheritGroupsChanged, handleAutoContinueChanged, handleRestartResult, handleShutdownResult, handleSharedEnv, handleSharedEnvSaved, handleGlobalClaudeMdRead, handleGlobalClaudeMdWrite } from './server-settings.js';
import { handleTermList, handleTermCreated, sendTerminalCommand, handleTermOutput, handleTermResized, handleTermExited, handleTermClosed } from './terminal.js';
import { attachTuiView, detachTuiView, setTuiSuspendedView, tuiHandleTermOutput, tuiHandleTermResized, tuiHandleTermExited, tuiHandleTermClosed } from './session-tui-view.js';
import { handleTuiTranscriptState } from './tui-grab.js';
import { tuiModalHandleTermOutput, tuiModalHandleTermResized, tuiModalHandleTermExited, tuiModalHandleTermClosed } from './tui-attention.js';
import { updateTerminalList, handleContextSourcesState, updateEmailAccountList, updateEmailUnreadCounts, handleEmailTestResult, handleEmailAddResult, handleEmailRemoveResult } from './context-sources.js';
import { refreshEmailSettings } from './user-settings.js';
import { handleNotesList, handleNoteCreated, handleNoteUpdated, handleNoteDeleted, handleNoteWritten } from './sticky-notes.js';
import { handleProjectLogsState, handleProjectLogEntry, handleProjectLogCommented, handleProjectLogCommentReviewed, handleProjectLogDeleted, handleProjectLogUpdated, handleProjectLogsError } from './project-logs.js';
import { handleSkillInstalled, handleSkillUninstalled } from './skills.js';
import { showRewindModal, onRewindComplete, setRewindMode, onRewindError, clearPendingRewindUuid, addRewindButton } from './rewind.js';
import { checkAdminAccess } from './admin.js';
import { mateAvatarUrl } from './avatar.js';
import { showImageModal, sendExtensionCommand, handleMcpToolCallMessage } from './app-misc.js';
import { handleMcpServersState } from './mcp-ui.js';
import { handleShellCommandResult } from './shell-command.js';
import { handleLoopRegistryUpdated, handleScheduleRunStarted, handleScheduleRunFinished, handleLoopScheduled, isSchedulerOpen, enterCraftingMode, exitCraftingMode, handleLoopRegistryFiles } from './scheduler.js';
import { renderGeneratedImage, renderImageGenerationProgress, clearImageGenerationProgress, clearAllImageGenerationProgress } from './generated-images.js';

// --- App module imports ---
import { scrollToBottom, addToMessages, addUserMessage, addSystemMessage, removeMatePreThinking, appendDelta, finalizeAssistantBlock, addConflictMessage, addContextOverflowMessage, showSuggestionChips, armStickyBottom, VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { setActivity, startUrgentBlink, stopUrgentBlink, blinkSessionDot, updateCrossProjectBlink } from './app-favicon.js';
import { setStatus } from './app-connection.js';
import { handleWhatsNewState, handleWhatsNewSeenResult, setKnownEntries as setWhatsNewKnownEntries } from './whats-new.js';
import { closeArticle as closeWhatsNewArticle } from './whats-new-article.js';
import { resolvePaneSession, resolveSwitchedVendor } from './pane-session.js';
import { selectDefaultVendorForBlankSession } from './vendor-selection.js';
import { getModelInfoUpdate, modelEntryValue, modelEntryMatches, handleModelSelectionResult, requestVendorModels } from './model-picker.js';
import { getModelEffortLevels, accumulateUsage, updateUsagePanel, accumulateContext, updateContextPanel, renderCtxPopover, updateStatusPanel } from './app-panels.js';
import { updateProjectList, resetClientState, showUpdateAvailable, handleRemoveProjectCheckResult, handleRemoveProjectResult, handleBrowseDirResult, handleAddProjectResult, handleCloneProgress, finishProjectSessionActivation } from './app-projects.js';
import { updateHistorySentinel, prependOlderHistory } from './app-header.js';
import { hideHomeHub, showHomeHub } from './app-home-hub.js';
import { handleToolsState, handleToolInstalled, handleToolRemoved, handleToolStorageResult, handleToolLlmResult, handleToolsError, handleToolControlRequest, handleToolServerState, handleToolServerEvent, handleCapsuleGameSession } from './home-tools.js';
import { handleHomeDockState } from './home-dock.js';
import { handleToolFrameUrlState } from './home-tool-frame.js';
import { enterDmMode, exitDmMode, handleMateCreatedInApp, updateMateIconStatus, appendDmMessage, showDmTypingIndicator, buildMateInterviewPrompt } from './app-dm.js';
import { handleRateLimitEvent, updateRateLimitUsage, addScheduledMessageBubble, removeScheduledMessageBubble, handleFastModeState } from './app-rate-limit.js';
import { handleRemoteCursorMove, handleRemoteCursorLeave, handleRemoteSelection, clearRemoteCursors } from './app-cursors.js';
import { showLoopBanner, updateLoopBanner, updateLoopInputVisibility, showRalphApprovalBar, updateRalphApprovalStatus, openRalphPreviewModal, showExecModal, updateExecModalStatus } from './app-loop-ui.js';
import { showDebateSticky, showDebateConcludeConfirm, showDebateUserFloor, exitDebateFloorMode, exitDebateConcludeMode, exitDebateEndedMode, updateDebateRound, renderDebateUserFloorDone } from './app-debate-ui.js';
import { handleSkillInstallWs } from './app-skills-install.js';
import { handleNotificationsState, handleNotificationCreated, handleNotificationDismissed, handleNotificationDismissedAll, showUpdateBanner } from './app-notifications.js';
import { handleUpdateSnoozed } from './update-snooze.js';
import { autoStartLoginIfNeeded, handleVendorLoginReady, handleVendorLoginState, handleVendorLoginError, handleAuthRefreshed } from './vendor-login.js';
import { handleDebatePreparing, handleDebateBriefReady, renderDebateBriefReady, handleDebateStarted, renderDebateStarted, handleDebateTurn, handleDebateActivity, handleDebateStream, handleDebateTurnDone, handleDebateCommentQueued, handleDebateCommentInjected, renderDebateCommentInjected, handleDebateResumed, handleDebateEnded, renderDebateEnded, handleDebateError, isDebateActive, renderMcpDebateProposal, renderDebateUserResume } from './debate.js';
import { handleMentionStart, handleMentionActivity, handleMentionStream, handleMentionDone, handleMentionError, renderMentionUser, renderMentionResponse, renderUserMention } from './mention.js';

// --- DOM refs (cached once, stable for page lifetime) ---
var messagesEl = document.getElementById("messages");
var headerTitleEl = document.getElementById("header-title");
var inputEl = document.getElementById("input");
var connectOverlay = document.getElementById("connect-overlay");

export function processMessage(msg) {
    if (msg.type === "access_revoked") {
      window.location.assign("/");
      return;
    }
    // Preserve original timestamp from history replay
    store.set({ currentMsgTs: msg._ts || null });
    var isMateDm = store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate;

    // Mate DM: update mate icon status indicators
    if (isMateDm) updateMateIconStatus(msg);

    // Mate DM: intercept mate-specific messages
    if (isMateDm) {
      if (msg.type === "session_list") {
        renderMateSessionList(msg.sessions || []);
        refreshMobileChatSheet();
        // Override title bar with mate name and re-apply color
        var _mdn = (store.get('dmTargetUser').displayName || "New Mate");
        if (headerTitleEl) headerTitleEl.textContent = _mdn;
        var _tbpn = document.getElementById("title-bar-project-name");
        if (_tbpn) _tbpn.textContent = _mdn;
        var _mc2 = (store.get('dmTargetUser').profile && store.get('dmTargetUser').profile.avatarColor) || store.get('dmTargetUser').avatarColor || "#5857fc";
        var _tbc2 = document.querySelector(".title-bar-content");
        if (_tbc2) { _tbc2.style.background = _mc2; _tbc2.classList.add("mate-dm-active"); }
        document.body.classList.add("mate-dm-active");
        // Still let normal session_list handler run below
      }
      if (msg.type === "search_results") {
        handleMateSearchResults(msg);
        return;
      }
      if (msg.type === "knowledge_list") {
        renderKnowledgeList(msg.files);
        return;
      }
      if (msg.type === "knowledge_content") {
        handleKnowledgeContent(msg);
        return;
      }
      if (msg.type === "knowledge_saved" || msg.type === "knowledge_deleted" || msg.type === "knowledge_promoted" || msg.type === "knowledge_depromoted") {
        return;
      }
      if (msg.type === "memory_list") {
        renderMemoryList(msg.entries, msg.summary);
        return;
      }
      if (msg.type === "memory_deleted") {
        return;
      }
      // On done: scan DOM for [[MATE_READY: name]], update name, strip marker
      if (msg.type === "done") {
        setTimeout(function () { scrollToBottom(); }, 100);
        setTimeout(function () { scrollToBottom(); }, 400);
        setTimeout(function () {
          var fullText = messagesEl ? messagesEl.textContent : "";
          var readyMatch = fullText.match(/\[\[MATE_READY:\s*(.+?)\]\]/);
          if (readyMatch) {
            var newName = readyMatch[1].trim();
            store.get('dmTargetUser').displayName = newName;
            updateMateSidebarProfile({ profile: { displayName: newName, avatarColor: store.get('dmTargetUser').avatarColor, avatarStyle: store.get('dmTargetUser').avatarStyle, avatarSeed: store.get('dmTargetUser').avatarSeed } });
            if (getWs() && getWs().readyState === 1) {
              getWs().send(JSON.stringify({
                type: "mate_update",
                mateId: store.get('dmTargetUser').id,
                updates: { name: newName, status: "ready", profile: { displayName: newName } },
              }));
            }
          }
          var walker = document.createTreeWalker(messagesEl, NodeFilter.SHOW_TEXT, null, false);
          var node;
          while (node = walker.nextNode()) {
            if (node.nodeValue.indexOf("[[MATE_READY:") !== -1) {
              node.nodeValue = node.nodeValue.replace(/\[\[MATE_READY:\s*.+?\]\]/g, "").trim();
            }
          }
        }, 100);
      }
    }

    switch (msg.type) {
      case "message_ack":
        var acknowledgedEl = msg.clientMessageId
          ? messagesEl.querySelector('[data-client-message-id="' + msg.clientMessageId + '"]')
          : null;
        acknowledgeMessage(msg.clientMessageId);
        if (!acknowledgedEl && msg.message) {
          addUserMessage(msg.message.text, msg.message.images || null, msg.message.pastes || null, msg.message.from, msg.message.fromName);
          var acknowledgedUsers = messagesEl.querySelectorAll(".msg-user");
          if (acknowledgedUsers.length > 0) {
            acknowledgedUsers[acknowledgedUsers.length - 1].dataset.clientMessageId = msg.clientMessageId;
          }
        }
        break;

      case "history_meta":
        store.set({ historyFrom: msg.from, historyTotal: msg.total, replayingHistory: true });
        updateHistorySentinel();
        break;

      case "history_prepend":
        prependOlderHistory(msg.items, msg.meta);
        break;

      case "history_done":
        store.set({ replayingHistory: false });
        resumeThinkingAfterReplay(store.get('sessionIsProcessing'));
        // Batched syntax highlight + mermaid pass for the entire replayed
        // transcript. Per-message highlights are skipped during replay
        // (see markdown.js) to avoid cascading reflows that the sticky-
        // bottom observer chases for several seconds on long sessions.
        if (messagesEl) {
          highlightCodeBlocks(messagesEl);
          renderMermaidBlocks(messagesEl);
        }
        // Compact dead-session todo widgets (unfinished items will never
        // resolve — the agent isn't coming back) so they don't anchor
        // visual position mid-page on resume.
        if (!store.get('sessionIsProcessing')) {
          applyDeadSessionTodoCompaction();
        }
        // Restore cached rich context usage BEFORE updateContextPanel runs
        if (msg.contextUsage) {
          store.set({ richContextUsage: msg.contextUsage });
        }
        // Restore accurate context data from the last result in full history
        if (msg.lastUsage || msg.lastModelUsage) {
          accumulateContext(msg.lastCost, msg.lastUsage, msg.lastModelUsage, msg.lastStreamInputTokens);
        }
        updateContextPanel();
        updateUsagePanel();
        // Render + finalize any incomplete turn from the replayed history
        var _hs = store.snap();
        if (_hs.currentMsgEl && _hs.currentFullText) {
          var replayContentEl = _hs.currentMsgEl.querySelector(".md-content");
          if (replayContentEl) {
            replayContentEl.innerHTML = renderMarkdown(_hs.currentFullText);
          }
        }
        markAllToolsDone();
        finalizeAssistantBlock();
        stopUrgentBlink();
        // Clean up debate UI if debate is not active after replay
        if (!isDebateActive()) {
          var dbBar = document.getElementById("debate-bottom-bar");
          if (dbBar) dbBar.remove();
          var dhBar = document.getElementById("debate-hand-raise-bar");
          if (dhBar) dhBar.remove();
          var dbBadges = document.querySelectorAll(".debate-header-badge");
          for (var dbi = 0; dbi < dbBadges.length; dbi++) dbBadges[dbi].remove();
          // Clean up all debate mode banners if debate is not active on this session
          var _ds = store.snap();
          if (_ds.debateFloorMode) exitDebateFloorMode();
          if (_ds.debateConcludeMode) exitDebateConcludeMode();
          if (_ds.debateEndedMode) exitDebateEndedMode();
          var dbBanner = document.getElementById("debate-floor-banner");
          if (dbBanner) dbBanner.remove();
        }
        // Resume landing position: arm sticky-bottom for ~1.5s so deferred
        // layout (tool widgets via tools.js, markdown/syntax highlighting,
        // image loads, IntersectionObserver-driven todo sticky reflows)
        // can't strand the user mid-conversation. The ResizeObserver
        // re-pins on every height change while armed. Disarms early on
        // any real user scroll input.
        // Skip arming when we have a pending in-conversation navigate
        // target (file-edit deeplink) — the navigate block below scrolls
        // that element into view, and sticky-bottom would fight it.
        var nav = getPendingNavigate();
        var hasNavTarget = nav && (nav.toolId || nav.assistantUuid);
        if (hasNavTarget) {
          // Navigate block below will scrollIntoView on the target — don't
          // arm sticky-bottom or it would fight that scroll.
          scrollToBottom();
        } else {
          // Quiet window: ResizeObserver extends this for as long as
          // layout keeps shifting (long sessions, late-rendering tool
          // widgets, image loads), bounded by an internal hard ceiling.
          armStickyBottom(750);
        }
        // Scroll to tool element if navigating from file edit history
        if (hasNavTarget) {
          requestAnimationFrame(function() {
            // Prefer scrolling to the exact tool element
            var target = nav.toolId ? messagesEl.querySelector('[data-tool-id="' + nav.toolId + '"]') : null;
            if (!target && nav.assistantUuid) {
              target = messagesEl.querySelector('[data-uuid="' + nav.assistantUuid + '"]');
            }
            if (target) {
              // Auto-expand parent tool group if collapsed
              var parentGroup = target.closest(".tool-group");
              if (parentGroup) parentGroup.classList.remove("collapsed");
              target.scrollIntoView({ behavior: "smooth", block: "center" });
              target.classList.add("message-blink");
              setTimeout(function() { target.classList.remove("message-blink"); }, 2000);
            }
          });
        }
        break;

      case "restore_mate_dm":
        if (msg.mateId && !store.get('returningFromMateDm')) {
          if (store.get('dmMode')) {
            store.set({ dmMode: false });
          }
          messagesEl.innerHTML = "";
          showHomeHub();
          openHomeChat(msg.mateId);
        }
        // Clear the flag and notify server that mate DM is closed
        if (store.get('returningFromMateDm')) {
          store.set({ returningFromMateDm: false });
          if (getWs() && getWs().readyState === 1) {
            try { getWs().send(JSON.stringify({ type: "set_mate_dm", mateId: null })); } catch(e) {}
          }
        }
        break;

      case "info":
        if (msg.text && !msg.project && !msg.cwd) {
          addSystemMessage(msg.text, false);
          break;
        }
        // Project switch: tear down any active TUI overlay before we
        // start receiving the new project's session_switched. The TUI
        // host lives on document.body (it's position: fixed), so it
        // survives project navigation unless we detach explicitly here.
        detachTuiView();
        store.set({ projectName: msg.project || msg.cwd, vendorInfo: msg.vendors || {} });
        if (msg.cwd) store.set({ cwd: msg.cwd });
        if (msg.slug) store.set({ currentSlug: msg.slug, activeProjectSlug: msg.slug });
        try { var _is = store.snap(); localStorage.setItem("clay-project-name-" + (_is.currentSlug || "default"), _is.projectName); } catch (e) {}
        // In mate DM, keep title as mate name and re-apply mate color
        if (store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate) {
          var _mateDN = store.get('dmTargetUser').displayName || "New Mate";
          headerTitleEl.textContent = _mateDN;
          var tbProjectName = document.getElementById("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = _mateDN;
          // Re-apply mate title bar styling (may be lost during project switch)
          var _mc = (store.get('dmTargetUser').profile && store.get('dmTargetUser').profile.avatarColor) || store.get('dmTargetUser').avatarColor || "#5857fc";
          var _tbc = document.querySelector(".title-bar-content");
          if (_tbc) { _tbc.style.background = _mc; _tbc.classList.add("mate-dm-active"); }
          document.body.classList.add("mate-dm-active");
        } else {
          headerTitleEl.textContent = store.get('projectName');
          var tbProjectName = document.getElementById("title-bar-project-name");
          if (tbProjectName) tbProjectName.textContent = msg.title || store.get('projectName');
        }
        updatePageTitle();
        if (msg.version) {
          setPaletteVersion(msg.version);
          var serverVersionEl = document.getElementById("settings-server-version");
          if (serverVersionEl) serverVersionEl.textContent = msg.version;
        }
        if (msg.projectOwnerId !== undefined) store.set({ currentProjectOwnerId: msg.projectOwnerId });
        if (msg.ownerLocked !== undefined) store.set({ ownerLocked: !!msg.ownerLocked });
        if (msg.osUsers !== undefined) store.set({ isOsUsers: !!msg.osUsers });
        if (msg.lanHost) window.__lanHost = msg.lanHost;
        if (msg.dangerouslySkipPermissions) {
          store.set({ skipPermsEnabled: true });
          var spBanner = document.getElementById("skip-perms-pill");
          if (spBanner) spBanner.classList.remove("hidden");
        }
        updateProjectList(msg);
        break;

      case "update_available":
        // The server already refuses to send this frame to anyone who is not
        // admin-grade, so this check is defence in depth for the UI, not the
        // access control.
        if (store.get('isMultiUserMode')) {
          checkAdminAccess().then(function (isAdmin) {
            if (!isAdmin) return;
            showUpdateAvailable(msg);
            showUpdateBanner(msg);
          });
        } else {
          showUpdateAvailable(msg);
          showUpdateBanner(msg);
        }
        break;

      case "update_snoozed":
        handleUpdateSnoozed(msg);
        break;

      case "up_to_date":
        var utdBtn = document.getElementById("settings-update-check");
        if (utdBtn) {
          utdBtn.innerHTML = "";
          var utdIcon = document.createElement("i");
          utdIcon.setAttribute("data-lucide", "check");
          utdBtn.appendChild(utdIcon);
          utdBtn.appendChild(document.createTextNode(" Up to date (v" + msg.version + ")"));
          utdBtn.disabled = true;
          refreshIcons();
          setTimeout(function () {
            utdBtn.innerHTML = "";
            var rwIcon = document.createElement("i");
            rwIcon.setAttribute("data-lucide", "refresh-cw");
            utdBtn.appendChild(rwIcon);
            utdBtn.appendChild(document.createTextNode(" Check for updates"));
            utdBtn.disabled = false;
            utdBtn.classList.remove("settings-btn-update-available");
            refreshIcons();
          }, 3000);
        }
        break;

      case "update_started":
        var updNowBtn = document.getElementById("update-now");
        if (updNowBtn) {
          updNowBtn.innerHTML = '<i data-lucide="loader"></i> Updating...';
          updNowBtn.disabled = true;
          refreshIcons();
          var spinIcon = updNowBtn.querySelector(".lucide");
          if (spinIcon) spinIcon.classList.add("icon-spin-inline");
        }
        // Block the entire screen with the connect overlay
        connectOverlay.classList.remove("hidden");
        break;

      case "home_mate_history":
        handleHomeMateHistory(msg);
        break;

      case "home_mate_sessions_state":
        handleHomeMateSessionsState(msg);
        break;

      case "home_mate_delta":
        handleHomeMateDelta(msg);
        break;

      case "home_mate_done":
        handleHomeMateDone(msg);
        break;

      case "home_mate_error":
        handleHomeMateError(msg);
        break;

      case "home_mate_memory_state":
        handleHomeMateMemoryState(msg);
        break;

      case "home_mate_knowledge_state":
        handleHomeMateKnowledgeState(msg);
        break;

      case "slash_commands":
        var reserved = new Set(builtinCommands.map(function (c) { return c.name; }));
        store.set({ slashCommands: (msg.commands || []).filter(function (name) {
          return !reserved.has(name);
        }).map(function (name) {
          return { name: name, desc: "Skill" };
        }) });
        break;

      case "tui_transcript_state":
        // Assistant text index for a Claude TUI session — drives the
        // hover-to-grab overlay in lib/public/modules/tui-grab.js.
        handleTuiTranscriptState(msg);
        break;

      case "model_info": {
        // Installation state applies across vendors. Keep it even when the
        // model payload itself is stale for the active session.
        var _vendorState = {};
        if (msg.availableVendors) _vendorState.availableVendors = msg.availableVendors;
        if (msg.installedVendors) _vendorState.installedVendors = msg.installedVendors;
        if (Object.keys(_vendorState).length > 0) {
          store.set(_vendorState);
          selectDefaultVendorForBlankSession();
        }
        // Drop stale model_info from a vendor that doesn't match the active
        // session's vendor. On high-latency connections, the server's default-
        // adapter model_info can arrive after session_switched has already
        // bound the session to a different vendor. Applying it would replace
        // currentModels with the wrong vendor's list and trigger app-panels
        // to request models for the "wrong" vendor, which feeds back into a
        // ping-pong loop of vendor flapping. See issue #336.
        var _modelLoadUpdate = getModelInfoUpdate(msg);
        if (!_modelLoadUpdate) break;

        var _modelVal = msg.model;
        if (_modelVal && typeof _modelVal === "object") _modelVal = _modelVal.value || _modelVal.displayName || "";
        var _miUpdate = Object.assign({ currentModels: msg.models || [] }, _modelLoadUpdate);
        if (Object.prototype.hasOwnProperty.call(msg, "model")) {
          // Keep the user's existing selection only if it actually belongs to
          // this vendor's model list. Otherwise (e.g. switching to a Codex
          // session while currentModel is still a Claude model) snap to the
          // server-provided default so the chip doesn't show a cross-vendor
          // model.
          var _curModel = store.get('currentModel');
          var _curInList = !!_curModel && (msg.models || []).some(function (m) {
            return modelEntryMatches(m, _curModel);
          });
          var _incomingInList = !_modelVal || (msg.models || []).length === 0 || (msg.models || []).some(function (m) {
            return modelEntryMatches(m, _modelVal);
          });
          if (!_incomingInList) {
            console.warn("[model-state] Ignoring model not listed for vendor " + (msg.vendor || store.get('currentVendor')) + ": " + _modelVal);
            _miUpdate.currentModel = _curInList ? _curModel : modelEntryValue((msg.models || [])[0]);
          } else if (store.get('vendorSelectionLocked') && _curInList) {
            // Keep the user's existing (valid) selection; only update models list
          } else {
            _miUpdate.currentModel = _modelVal || "";
          }
        } else {
          _miUpdate.currentModel = store.get('currentModel');
        }
        if (msg.vendor && !store.get('vendorSelectionLocked')) _miUpdate.currentVendor = msg.vendor;
        if (msg.capabilities) _miUpdate.vendorCapabilities = msg.capabilities;
        store.set(_miUpdate);
        break;
      }

      case "model_selection_result":
        handleModelSelectionResult(msg);
        break;

      case "config_state": {
        if ((msg.sessionId != null && msg.sessionId !== store.get('activeSessionId')) || (msg.vendor && msg.vendor !== store.get('currentVendor'))) break;
        var _cs = {};
        if (msg.model) {
          var _knownModels = store.get('currentModels') || [];
          var _modelKnown = _knownModels.length === 0 || _knownModels.some(function(model) { return modelEntryMatches(model, msg.model); });
          if (_modelKnown) {
            _cs.currentModel = msg.model;
          } else {
            console.warn("[model-state] Ignoring model not listed for current vendor: " + msg.model);
            var _existingModel = store.get('currentModel');
            var _existingKnown = _knownModels.some(function(model) { return modelEntryMatches(model, _existingModel); });
            _cs.currentModel = _existingKnown ? _existingModel : modelEntryValue(_knownModels[0]);
          }
        }
        if (msg.mode) _cs.currentMode = msg.mode;
        if (msg.effort) _cs.currentEffort = msg.effort;
        if (msg.betas) _cs.currentBetas = msg.betas;
        if (msg.thinking) _cs.currentThinking = msg.thinking;
        if (msg.thinkingBudget) _cs.currentThinkingBudget = msg.thinkingBudget;
        store.set(_cs);
        // Validate effort against current model's supported levels
        var _csRead = store.snap();
        if (_csRead.currentModels.length > 0) {
          var levels = getModelEffortLevels();
          var effortValid = false;
          for (var ei = 0; ei < levels.length; ei++) {
            if (levels[ei] === _csRead.currentEffort) { effortValid = true; break; }
          }
          if (!effortValid) store.set({ currentEffort: "medium" });
        }
        } break;

      case "codex_config":
        store.set({
          codexApproval: msg.approval,
          codexSandbox: msg.sandbox,
          codexWebSearch: msg.webSearch,
        });
        break;

      case "client_count":
        // Sidebar presence: current project's online users
        if (msg.users) {
          renderSidebarPresence(msg.users);
        }
        // Non-multi-user mode: simple count in topbar
        if (!msg.users) {
          var countEl = document.getElementById("client-count");
          var countTextEl = document.getElementById("client-count-text");
          if (countEl && countTextEl) {
            if (msg.count > 1) {
              countTextEl.textContent = msg.count + " connected";
              countEl.classList.remove("hidden");
            } else {
              countEl.classList.add("hidden");
            }
          }
        }
        break;

      case "toast":
        showToast(msg.message, msg.level, msg.detail);
        break;

      case "skill_installed":
        handleSkillInstalled(msg);
        if (msg.success) { var _kis = Object.assign({}, store.get('knownInstalledSkills')); _kis[msg.skill] = true; store.set({ knownInstalledSkills: _kis }); }
        handleSkillInstallWs(msg);
        break;

      case "skill_uninstalled":
        handleSkillUninstalled(msg);
        if (msg.success) { var _kis2 = Object.assign({}, store.get('knownInstalledSkills')); delete _kis2[msg.skill]; store.set({ knownInstalledSkills: _kis2 }); }
        break;

      case "loop_registry_updated":
        handleLoopRegistryUpdated(msg);
        break;

      case "schedule_run_started":
        handleScheduleRunStarted(msg);
        break;

      case "schedule_run_finished":
        handleScheduleRunFinished(msg);
        break;

      case "loop_scheduled":
        handleLoopScheduled(msg);
        break;

      case "schedule_move_result":
        if (msg.ok) {
          showToast("Task moved", "success");
        } else {
          showToast(msg.error || "Failed to move task", "error");
        }
        break;

      case "remove_project_check_result":
        handleRemoveProjectCheckResult(msg);
        break;

      case "tools_state":
        handleToolsState(msg);
        break;

      case "home_dock_state":
        handleHomeDockState(msg);
        break;

      case "home_surface_state":
        handleHomeSurfaceState(msg);
        break;

      case "tool_installed":
        handleToolInstalled(msg);
        break;

      case "tool_removed":
        handleToolRemoved(msg);
        break;

      case "tool_storage_result":
        handleToolStorageResult(msg);
        break;

      case "tool_llm_result":
        handleToolLlmResult(msg);
        break;

      case "tools_error":
        handleToolsError(msg);
        break;

      case "tool_control_request":
        handleToolControlRequest(msg);
        break;

      case "tool_server_state":
        handleToolServerState(msg);
        break;

      case "tool_server_event":
        handleToolServerEvent(msg);
        break;

      case "tool_frame_url_state":
        handleToolFrameUrlState(msg);
        break;

      case "capsule_game_session":
        handleCapsuleGameSession(msg);
        break;

      case "home_mate_segment":
        handleHomeMateSegment(msg);
        break;

      case "input_sync":
        if (!store.get('dmMode')) handleInputSync(msg.text);
        break;

      case "session_list":
        renderMateSessionList(msg.sessions || []);
        renderSessionList(msg.sessions || []);
        syncPaneTitles();
        var panePin = resolvePaneSession(store.get('paneMode'), store.get('panePinPending'), store.get('paneSessionId'), msg.sessions);
        if (panePin.consumed) {
          store.set({ panePinPending: false });
          if (panePin.sessionId && getWs() && getWs().readyState === 1) {
            getWs().send(JSON.stringify({ type: "switch_session", id: panePin.sessionId }));
          }
        }
        handlePaletteSessionSwitch();
        break;

      case "split_groups":
        store.set({ splitGroups: msg.groups || [] });
        renderSessionList(null);
        maybeRestoreSplitGroup();
        syncPaneTitles();
        break;

      case "split_group_result":
        if (!msg.ok && msg.error) showToast(msg.error, "error");
        break;

      case "pair_session_options":
        showPairDialog(msg);
        break;

      case "pair_session_created":
        var createdPairGroup = handlePairCreated(msg);
        if (createdPairGroup) openGroup(createdPairGroup);
        break;

      case "session_handoff_result":
      case "handoff_session_options":
      case "handoff_context":
      case "handoff_created":
        handleSessionActionMessage(msg);
        break;

      case "worker_proposal":
        renderWorkerProposal(msg);
        break;

      case "worker_proposal_update":
        updateWorkerProposal(msg);
        break;

      case "split_delegation":
        handleSplitDelegation(msg);
        syncPaneTitles();
        break;

      case "session_presence":
        updateSessionPresence(msg.presence || {});
        break;

      // Project's last-used vendor. Seeds the sidebar's "New session" button
      // on connect and keeps other tabs in sync after someone picks a vendor.
      case "last_vendor":
        store.set({ lastVendor: msg.vendor || "" });
        break;

      case "cursor_move":
        handleRemoteCursorMove(msg);
        break;

      case "cursor_leave":
        handleRemoteCursorLeave(msg);
        break;

      case "text_select":
        handleRemoteSelection(msg);
        break;

      case "session_io":
        blinkSessionDot(msg.id);
        break;

      case "session_unread":
        updateSessionBadge(msg.id, msg.count);
        break;

      case "search_results":
        handleSearchResults(msg);
        break;

      case "search_content_results":
        if (msg.source === "find_in_session") {
          handleFindInSessionResults(msg);
        }
        break;

      case "session_switched":
        closeWhatsNewArticle();
        // Save draft from outgoing session
        var _prevSid = store.get('activeSessionId');
        if (_prevSid && inputEl.value) {
          store.get('sessionDrafts')[_prevSid] = inputEl.value;
        } else if (_prevSid) {
          delete store.get('sessionDrafts')[_prevSid];
        }
        // runtimeMode/runtimeTerminalId take precedence over the session's
        // born mode so the user's current claudeOpenMode preference applies
        // to existing sessions too (born-GUI viewed under TUI pref runs
        // claude --resume in xterm; born-TUI viewed under GUI pref was
        // in-place converted to GUI by the server before this message).
        var _effectiveMode = msg.runtimeMode || msg.mode || "gui";
        var _effectiveTerminalId = (typeof msg.runtimeTerminalId === "number")
          ? msg.runtimeTerminalId
          : (typeof msg.terminalId === "number" ? msg.terminalId : null);
        store.set({ activeSessionId: msg.id, cliSessionId: msg.cliSessionId || null, currentModel: msg.model || "", currentEffort: msg.effort || store.get('currentEffort'), vendorCapabilities: msg.capabilities || {}, sessionIsProcessing: !!msg.isProcessing, activeSessionMode: _effectiveMode, activeTerminalId: _effectiveTerminalId, sessionHasHistory: !!msg.hasHistory, sessionVendorBound: !!msg.vendor || !!msg.hasHistory, sessionFullAccess: msg.permissionMode === "bypassPermissions", currentMode: msg.permissionMode || store.get('currentMode') });
        replayPendingMessages(msg.id);
        // TUI sessions swap the chat UI for an embedded xterm running
        // `claude` inside a real PTY. Mount or tear down before the rest of
        // the chat-side bookkeeping runs so we don't waste work on hidden DOM.
        // With a split open the native app is hidden behind the pane iframes,
        // but the TUI host is position:fixed on body -- attaching it here
        // would overlay the split. Members render inside their own panes.
        if (_effectiveMode === "tui" && typeof _effectiveTerminalId === "number" && !store.get('splitPanes')) {
          attachTuiView(_effectiveTerminalId, msg.id, msg.vendor || null);
        } else {
          detachTuiView();
        }
        // Born-TUI session with no live PTY: read-only transcript + Resume bar
        // (the composer is hidden; clicking Resume spawns claude --resume).
        setTuiSuspendedView(!!msg.tuiSuspended, msg.id);
        if (msg.vendor) {
          // session_switched is authoritative. The lock rejects stale
          // model_info responses; it must not block an intentional switch to
          // a blank session owned by another vendor.
          store.set({ currentVendor: resolveSwitchedVendor(store.get('currentVendor'), msg.vendor) });
          // Sessions with history have their vendor structurally bound to
          // the session: lock so a late-arriving default-adapter model_info
          // can't flip the UI back. Previously this branch unlocked, which
          // is what allowed the feedback loop in issue #336.
          if (msg.hasHistory) {
            store.set({ vendorSelectionLocked: true });
          }
        } else if (msg.hasHistory) {
          // Existing session without explicit vendor: reset to claude
          store.set({ currentVendor: "claude" });
          store.set({ vendorSelectionLocked: false });
        } else if (!msg.hasHistory) {
          // New session without vendor: use mate's default vendor if in DM mode
          var _dmTarget = store.get('dmTargetUser');
          if (_dmTarget && _dmTarget.isMate) {
            var _mateList = store.get('cachedMatesList') || [];
            for (var _mi = 0; _mi < _mateList.length; _mi++) {
              if (_mateList[_mi].id === _dmTarget.id && _mateList[_mi].vendor) {
                store.set({ currentVendor: _mateList[_mi].vendor });
                break;
              }
            }
          }
        }
        if (!msg.hasHistory && !msg.vendor) {
          selectDefaultVendorForBlankSession();
        }
        if (!msg.model) requestVendorModels(store.get('currentVendor') || "claude", true);
        // Show the committed session vendor next to the model chip.
        var _avi = document.getElementById("active-vendor-indicator");
        var _avIcon = document.getElementById("active-vendor-icon");
        if (_avi && _avIcon) {
          if (msg.vendor && VENDOR_AVATARS[msg.vendor]) {
            _avIcon.src = VENDOR_AVATARS[msg.vendor];
            _avIcon.alt = VENDOR_NAMES[msg.vendor] || msg.vendor;
            _avi.title = (VENDOR_NAMES[msg.vendor] || msg.vendor) + " session";
            _avi.classList.remove("hidden");
          } else {
            _avi.classList.add("hidden");
          }
        }
        // Session presence is now tracked server-side (user-presence.json)
        clearRemoteCursors();
        resetClientState();

        updateLoopInputVisibility(msg.loop);
        // Restore input area visibility (may have been hidden by auth_required)
        var inputAreaSw = document.getElementById("input-area");
        if (inputAreaSw) inputAreaSw.classList.remove("hidden");
        // Restore draft for incoming session
        var draft = store.get('sessionDrafts')[store.get('activeSessionId')] || "";
        inputEl.value = draft;
        autoResize();
        if (!("ontouchstart" in window)) {
          inputEl.focus();
        }
        // Reload survival: a restored active session that is a split-group
        // member reopens its group (no-op when a split is already open).
        maybeRestoreSplitGroup();
        if (finishProjectSessionActivation()) hideHomeHub();
        break;

      case "session_full_access_changed":
        if (msg.id === store.get('activeSessionId')) {
          store.set({ sessionFullAccess: !!msg.enabled, currentMode: msg.permissionMode || "default" });
        }
        break;

      case "session_full_access_result":
        if (!msg.ok && msg.error) showToast(msg.error, "error");
        break;

      case "session_id":
        store.set({ cliSessionId: msg.cliSessionId });
        break;

      case "message_uuid":
        var uuidTarget;
        if (msg.messageType === "user") {
          var allUsers = messagesEl.querySelectorAll(".msg-user:not([data-uuid])");
          if (allUsers.length > 0) uuidTarget = allUsers[allUsers.length - 1];
        } else {
          var allAssistants = messagesEl.querySelectorAll(".msg-assistant:not([data-uuid])");
          if (allAssistants.length > 0) uuidTarget = allAssistants[allAssistants.length - 1];
        }
        if (uuidTarget) {
          uuidTarget.dataset.uuid = msg.uuid;
          if (msg.messageType === "user" && (store.get('vendorCapabilities') || {}).rewind !== false) addRewindButton(uuidTarget);
        }
        store.get('messageUuidMap').push({ uuid: msg.uuid, type: msg.messageType });
        break;

      case "user_message":
        if (msg._internal) break;
        if (!store.get('replayingHistory')) beginMarkdownTurn();
        resetThinkingGroup();
        if (msg.planContent) {
          setPlanContent(msg.planContent);
          renderPlanCard(msg.planContent);
          addUserMessage("Execute the following plan. Do NOT re-enter plan mode — just implement it step by step.", msg.images || null, msg.pastes || null, msg.from, msg.fromName);
        } else {
          addUserMessage(msg.text, msg.images || null, msg.pastes || null, msg.from, msg.fromName, msg.delegated ? msg : null);
        }
        if (msg.clientMessageId) {
          var replayedUsers = messagesEl.querySelectorAll(".msg-user");
          if (replayedUsers.length > 0) replayedUsers[replayedUsers.length - 1].dataset.clientMessageId = msg.clientMessageId;
        }
        // Split Worker pane: a delegated instruction starts (or replays into) a
        // driven turn; surface the composer notice. Cleared on "done".
        if (msg.delegated) showWorkerDelegationNotice(msg.delegatedByTitle || null);
        break;

      case "plan_content":
        setPlanContent(msg.content || "");
        renderPlanCard(msg.content || "");
        break;

      case "context_preview":
        // Show a Context Card with tab screenshot between user message and assistant response
        if (msg.tab) {
          var card = document.createElement("div");
          card.className = "context-card";

          // Header
          var header = document.createElement("div");
          header.className = "context-card-header";
          var icon = document.createElement("span");
          icon.className = "context-card-icon";
          icon.innerHTML = iconHtml("globe");
          header.appendChild(icon);
          var label = document.createElement("span");
          label.textContent = "Viewing tab";
          header.appendChild(label);
          card.appendChild(header);

          // Screenshot
          if (msg.tab.screenshotUrl) {
            var img = document.createElement("img");
            img.className = "context-card-screenshot";
            img.src = msg.tab.screenshotUrl;
            img.loading = "lazy";
            img.addEventListener("click", function () { showImageModal(this.src); });
            card.appendChild(img);
          }

          // Meta: title + domain
          var tabTitle = msg.tab.title || "";
          var tabDomain = "";
          try { tabDomain = new URL(msg.tab.url).hostname; } catch (e) {}
          if (tabTitle || tabDomain) {
            var meta = document.createElement("div");
            meta.className = "context-card-meta";
            if (msg.tab.favIconUrl) {
              var fav = document.createElement("img");
              fav.className = "context-card-favicon";
              fav.src = msg.tab.favIconUrl;
              fav.width = 14;
              fav.height = 14;
              fav.onerror = function () { this.style.display = "none"; };
              meta.appendChild(fav);
            }
            var titleEl = document.createElement("span");
            titleEl.className = "context-card-title";
            titleEl.textContent = tabTitle;
            meta.appendChild(titleEl);
            if (tabDomain) {
              var domainEl = document.createElement("span");
              domainEl.className = "context-card-domain";
              domainEl.textContent = tabDomain;
              meta.appendChild(domainEl);
            }
            card.appendChild(meta);
          }

          messagesEl.appendChild(card);
          scrollToBottom();
        }
        break;

      case "status":
        if (msg.status === "processing") {
          setStatus("processing");
          // Session became live — undo any dead-session todo compaction
          // applied at history_done time.
          store.set({ sessionIsProcessing: true });
          applyDeadSessionTodoCompaction();
          // Server confirmed the turn started: pre-thinking dots have done
          // their job, drop them so they aren't stranded if no further
          // events make it through.
          removeMatePreThinking();
          if (!(store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate) && !store.get('matePreThinkingEl')) {
            setActivity("thinking");
          }
        }
        break;

      case "compacting":
        // Compacting means the SDK is mid-turn doing context compaction.
        // Pre-thinking dots have served their purpose, clear them so the
        // user sees the compaction indicator instead.
        removeMatePreThinking();
        if (msg.active) {
          setActivity("compacting");
        } else if (!(store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate)) {
          setActivity("thinking");
        }
        break;

      case "thinking_start":
        removeMatePreThinking();
        startThinking();
        break;

      case "thinking_delta":
        if (typeof msg.text === "string") appendThinking(msg.text);
        break;

      case "thinking_stop":
        stopThinking(msg.duration);
        if (!(store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate)) {
          setActivity("thinking");
        }
        break;

      case "delta":
        if (typeof msg.text !== "string") break;
        removeMatePreThinking();
        stopThinking();
        setActivity(null);
        appendDelta(msg.text);
        break;

      case "tool_start":
        removeMatePreThinking();
        stopThinking();
        setActivity(null);
        markAllToolsDone();
        if (msg.name === "EnterPlanMode") {
          renderPlanBanner("enter");
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "ExitPlanMode") {
          if (getPlanContent()) {
            renderPlanCard(getPlanContent());
          }
          renderPlanBanner("exit");
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "propose_debate" || (msg.name && msg.name.indexOf("propose_debate") !== -1) || (msg.name && msg.name.indexOf("propose_worker") !== -1)) {
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "ask_user_questions") {
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (msg.name === "present_markdown_edit" || (msg.name && msg.name.indexOf("present_markdown_edit") !== -1)) {
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else if (getTodoTools()[msg.name]) {
          getTools()[msg.id] = { el: null, name: msg.name, input: null, done: true, hidden: true };
        } else {
          createToolItem(msg.id, msg.name);
        }
        break;

      case "tool_executing":
        if (msg.name === "ImageGen") renderImageGenerationProgress(msg);
        if ((msg.name === "propose_debate" || (msg.name && msg.name.indexOf("propose_debate") !== -1)) && msg.input) {
          var _dpTool = getTools()[msg.id];
          if (_dpTool) {
            if (_dpTool.el) _dpTool.el.style.display = "none";
            _dpTool.done = true;
            _dpTool.hidden = true;
            removeToolFromGroup(msg.id);
          }
          finalizeAssistantBlock();
          renderMcpDebateProposal(msg.id, msg.input);
          startUrgentBlink();
        } else if (msg.name === "AskUserQuestion" && msg.input && msg.input.questions) {
          var askTool = getTools()[msg.id];
          if (askTool) {
            if (askTool.el) askTool.el.style.display = "none";
            askTool.done = true;
            removeToolFromGroup(msg.id);
          }
          renderAskUserQuestion(msg.id, msg.input);
          startUrgentBlink();
        } else if (msg.name === "Write" && msg.input && isPlanFilePath(msg.input.file_path)) {
          setPlanContent(msg.input.content || "");
          updateToolExecuting(msg.id, msg.name, msg.input);
        } else if (msg.name === "Edit" && msg.input && isPlanFilePath(msg.input.file_path)) {
          var pc = getPlanContent() || "";
          if (msg.input.old_string && pc.indexOf(msg.input.old_string) !== -1) {
            if (msg.input.replace_all) {
              setPlanContent(pc.split(msg.input.old_string).join(msg.input.new_string || ""));
            } else {
              setPlanContent(pc.replace(msg.input.old_string, msg.input.new_string || ""));
            }
          }
          updateToolExecuting(msg.id, msg.name, msg.input);
        } else if (msg.name === "TodoWrite") {
          handleTodoWrite(msg.input);
        } else if (msg.name === "TaskCreate") {
          handleTaskCreate(msg.input);
        } else if (msg.name === "TaskUpdate") {
          handleTaskUpdate(msg.input);
        } else if (getTodoTools()[msg.name]) {
          // TaskList, TaskGet - silently skip
        } else {
          var t = getTools()[msg.id];
          if (t && t.hidden) break;
          updateToolExecuting(msg.id, msg.name, msg.input);
        }
        break;

      case "tool_result": {
          var tr = getTools()[msg.id];
          if (tr && tr.hidden) break; // skip hidden plan tools
          if (msg.is_error && tr && tr.name === "ImageGen") clearImageGenerationProgress(msg.id);
          // Always call updateToolResult for Edit (to show diff from input), or when content exists
          if (msg.content != null || msg.images || (tr && tr.name === "Edit" && tr.input && tr.input.old_string)) {
            updateToolResult(msg.id, msg.content || "", msg.is_error || false, msg.images);
          }
          // Refresh file browser if an Edit/Write tool modified the open file.
          // Multi-file Codex changes expose file_paths instead of file_path.
          var changedMarkdownPath = tr && tr.input ? markdownPathFromToolInput(tr.input) : null;
          var changedFilePath = tr && tr.input ? (tr.input.file_path || changedMarkdownPath) : null;
          if (!msg.is_error && tr && (tr.name === "Edit" || tr.name === "Write") && changedFilePath) {
            refreshIfOpen(changedFilePath);
          }
        }
        break;

      case "generated_image":
        renderGeneratedImage(msg);
        break;

      case "ask_user_answered":
        markAskUserAnswered(msg.toolId, msg.answers);
        stopUrgentBlink();
        break;

      case "permission_request":
        setActivity(null);
        renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason, msg.mateId, msg.vendor);
        startUrgentBlink();
        break;

      case "permission_cancel":
        markPermissionCancelled(msg.requestId);
        stopUrgentBlink();
        break;

      case "permission_resolved":
        markPermissionResolved(msg.requestId, msg.decision);
        stopUrgentBlink();
        break;

      case "permission_request_pending":
        setActivity(null);
        renderPermissionRequest(msg.requestId, msg.toolName, msg.toolInput, msg.decisionReason, msg.mateId, msg.vendor);
        startUrgentBlink();
        break;

      case "elicitation_request":
        renderElicitationRequest(msg);
        startUrgentBlink();
        break;

      case "elicitation_resolved":
        markElicitationResolved(msg.requestId, msg.action);
        stopUrgentBlink();
        break;

      case "user_dialog_request":
        renderUserDialogRequest(msg);
        startUrgentBlink();
        break;

      case "user_dialog_resolved":
        markUserDialogResolved(msg.requestId, msg.behavior);
        stopUrgentBlink();
        break;

      case "slash_command_result":
        finalizeAssistantBlock();
        var cmdBlock = document.createElement("div");
        cmdBlock.className = "assistant-block";
        cmdBlock.style.maxWidth = "var(--content-width)";
        cmdBlock.style.margin = "12px auto";
        cmdBlock.style.padding = "0 20px";
        var pre = document.createElement("pre");
        pre.style.cssText = "background:var(--code-bg);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;font-family:'SF Mono',Menlo,Monaco,monospace;font-size:12px;line-height:1.55;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto;margin:0";
        pre.textContent = msg.text;
        cmdBlock.appendChild(pre);
        addToMessages(cmdBlock);
        scrollToBottom();
        break;

      case "subagent_activity":
        updateSubagentActivity(msg.parentToolId, msg.text);
        break;

      case "subagent_tool":
        addSubagentToolEntry(msg.parentToolId, msg.toolName, msg.toolId, msg.text);
        break;

      case "subagent_done":
        markSubagentDone(msg.parentToolId, msg.status, msg.summary, msg.usage);
        break;

      case "task_started":
        initSubagentStop(msg.parentToolId, msg.taskId);
        break;

      case "task_progress":
        updateSubagentProgress(msg.parentToolId, msg.usage, msg.lastToolName, msg.summary);
        break;

      case "task_updated":
        updateSubagentTaskStatus(msg.parentToolId, msg.patch);
        break;

      case "active_background_tasks":
        store.set({ activeBackgroundTasks: Array.isArray(msg.tasks) ? msg.tasks : [] });
        break;

      case "result":
        // Result marks turn end. Drop pre-thinking even if no delta/tool
        // event ever arrived (e.g. tool-only turn whose progress signals
        // were missed by the client).
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        markAllToolsDone();
        closeToolGroup();
        clearAllImageGenerationProgress();
        finalizeAssistantBlock();
        addTurnMeta(msg.cost, msg.duration);
        accumulateUsage(msg.cost, msg.usage);
        accumulateContext(msg.cost, msg.usage, msg.modelUsage, msg.lastStreamInputTokens);
        break;

      case "context_usage":
        if (msg.data && !store.get('replayingHistory')) {
          store.set({ richContextUsage: msg.data });
          // UI sync handled by store subscriber in app-panels.js
        }
        break;

      case "done":
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        hideWorkerDelegationNotice();
        markAllToolsDone();
        closeToolGroup();
        finalizeAssistantBlock();
        setStatus("connected");
        if (!store.get('loopActive')) enableMainInput();
        resetToolState();
        finishMarkdownTurn();
        stopUrgentBlink();
        if (document.hidden) {
          if (isNotifAlertEnabled() && !window._pushSubscription) showDoneNotification();
          if (isNotifSoundEnabled()) playDoneSound();
        }
        break;

      case "stderr":
        addSystemMessage(msg.text, false);
        break;

      case "error":
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        addSystemMessage(msg.text, true);
        break;

      case "system_info":
        addSystemMessage(msg.text, false);
        break;

      case "sdk_notification":
        addSystemMessage(msg.text, false);
        break;

      case "thinking_tokens":
        updateThinkingTokens(msg.estimatedTokens);
        break;

      case "informational":
        // level: info | notice | suggestion | warning
        if (msg.content) addSystemMessage(msg.content, msg.level === "warning");
        break;

      case "permission_denied": {
        var deniedText = (msg.toolName ? msg.toolName + ": " : "")
          + "tool call denied"
          + (msg.reason ? " — " + msg.reason : (msg.message ? " — " + msg.message : ""))
          + ".";
        addSystemMessage(deniedText, false);
        break;
      }

      case "model_refusal": {
        var refusalText;
        if (msg.refusalKind === "fallback") {
          refusalText = "The model declined this request and automatically retried"
            + (msg.fallbackModel ? " with " + msg.fallbackModel : " with a fallback model")
            + (msg.originalModel ? " (originally " + msg.originalModel + ")" : "")
            + ".";
          if (msg.category) refusalText += " Category: " + msg.category + ".";
          addSystemMessage(refusalText, false);
        } else {
          refusalText = "The model declined to respond to this request.";
          if (msg.explanation) refusalText += " " + msg.explanation;
          else if (msg.content) refusalText += " " + msg.content;
          if (msg.category) refusalText += " (Category: " + msg.category + ")";
          addSystemMessage(refusalText, true);
        }
        break;
      }

      case "process_conflict":
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        addConflictMessage(msg);
        break;

      case "session_writer_conflict":
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        markAllToolsDone();
        closeToolGroup();
        addSystemMessage(msg.text || "This session is already open in another process.", true);
        break;

      case "context_overflow":
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        addContextOverflowMessage(msg);
        break;

      case "auth_required":
        removeMatePreThinking();
        setActivity(null);
        finishThinkingTurn();
        markAllToolsDone();
        closeToolGroup();
        appendDelta((msg.text || "Authentication required.") + "\n");
        setStatus("connected");
        if (!store.get('loopActive')) enableMainInput();
        // Open the login flow only for a live auth failure. Older Clay
        // versions recorded this transient event in session history; replaying
        // one must not reopen a login terminal after the user signed in.
        if (!store.get('replayingHistory')) autoStartLoginIfNeeded(msg);
        break;

      case "vendor_login_ready":
        handleVendorLoginReady(msg);
        break;

      case "vendor_login_state":
        handleVendorLoginState(msg);
        break;

      case "vendor_login_error":
        handleVendorLoginError(msg);
        break;

      case "auth_refreshed":
        handleAuthRefreshed(msg);
        break;

      case "rate_limit":
        handleRateLimitEvent(msg);
        break;

      case "rate_limit_usage":
        updateRateLimitUsage(msg);
        break;

      case "scheduled_message_queued":
        addScheduledMessageBubble(msg.text, msg.resetsAt);
        setScheduleBtnDisabled(true);
        break;

      case "scheduled_message_sent":
        removeScheduledMessageBubble();
        setScheduleBtnDisabled(false);
        setStatus("processing");
        break;

      case "scheduled_message_cancelled":
        removeScheduledMessageBubble();
        setScheduleBtnDisabled(false);
        break;

      case "auto_continue_scheduled":
        // Scheduler auto-continue, just show info
        break;

      case "auto_continue_fired":
        setStatus("processing");
        break;

      case "prompt_suggestion":
        showSuggestionChips(msg.suggestion);
        break;

      case "fast_mode_state":
        handleFastModeState(msg.state);
        break;

      case "process_killed":
        addSystemMessage("Process " + msg.pid + " has been terminated. You can retry your message now.", false);
        break;

      case "rewind_preview_result":
        showRewindModal(msg);
        break;

      case "rewind_complete":
        onRewindComplete();
        setRewindMode(false);
        var rewindText = "Rewound to earlier point. Files have been restored.";
        if (msg.mode === "chat") rewindText = "Conversation rewound to earlier point.";
        else if (msg.mode === "files") rewindText = "Files restored to earlier point.";
        addSystemMessage(rewindText, false);
        break;

      case "rewind_error":
        onRewindError();
        clearPendingRewindUuid();
        addSystemMessage(msg.text || "Rewind failed.", true);
        break;

      case "fork_complete":
        addSystemMessage("Session forked successfully.");
        break;

      case "fs_list_result":
        handleFsList(msg);
        break;

      case "fs_search_result":
        handleFsSearch(msg);
        break;

      case "fs_read_result":
        if (msg.path === "CLAUDE.md" && isProjectSettingsOpen()) {
          handleInstructionsRead(msg);
        } else {
          handleFsRead(msg);
        }
        break;

      case "fs_write_result":
        handleInstructionsWrite(msg);
        break;

      case "project_env_result":
        handleProjectEnv(msg);
        break;

      case "set_project_env_result":
        handleProjectEnvSaved(msg);
        break;

      case "global_claude_md_result":
        handleGlobalClaudeMdRead(msg);
        break;

      case "write_global_claude_md_result":
        handleGlobalClaudeMdWrite(msg);
        break;

      case "shared_env_result":
        handleSharedEnv(msg);
        handleProjectSharedEnv(msg);
        break;

      case "set_shared_env_result":
        handleSharedEnvSaved(msg);
        handleProjectSharedEnvSaved(msg);
        break;

      case "fs_file_changed":
        handleFileChanged(msg);
        break;

      case "markdown_edit_present":
        if (!store.get('replayingHistory') && !store.get('dmMode')) {
          if (store.get('paneMode')) forwardPaneMarkdownPresentation(msg);
          else if (!store.get('splitPanes')) presentMarkdownEdit(msg);
        }
        break;

      case "fs_dir_changed":
        handleDirChanged(msg);
        break;

      case "fs_file_history_result":
        handleFileHistory(msg);
        break;

      case "fs_git_diff_result":
        handleGitDiff(msg);
        break;

      case "fs_file_at_result":
        handleFileAt(msg);
        break;

      case "term_list":
        handleTermList(msg);
        updateTerminalList(msg.terminals);
        break;

      case "shell_command_result":
        handleShellCommandResult(msg);
        if (!msg.error) sendShellResultToAgent(msg);
        break;

      case "context_sources_state":
        handleContextSourcesState(msg);
        break;

      case "email_accounts_list":
        updateEmailAccountList(msg);
        refreshEmailSettings();
        break;

      case "email_unread_update":
        updateEmailUnreadCounts(msg);
        break;

      case "email_account_test_result":
        handleEmailTestResult(msg);
        break;

      case "email_account_add_result":
        handleEmailAddResult(msg);
        break;

      case "email_account_remove_result":
        handleEmailRemoveResult(msg);
        break;

      case "extension_command":
        sendExtensionCommand(msg.command, msg.args, msg.requestId);
        break;

      case "mcp_tool_call":
        handleMcpToolCallMessage(msg);
        break;

      case "mcp_servers_state":
        handleMcpServersState(msg);
        break;

      case "term_created":
        // Login terminals never come through here: they are created by the
        // server-owned flow and announced with vendor_login_ready instead.
        handleTermCreated(msg);
        if (store.get('pendingTermCommand')) {
          var cmd = store.get('pendingTermCommand');
          store.set({ pendingTermCommand: null });
          // Small delay to let terminal initialize
          setTimeout(function() {
            sendTerminalCommand(cmd);
          }, 300);
        }
        break;

      case "term_output":
        // Three potential consumers in priority order: the inline TUI
        // modal (transient overlay opened from an attention banner), the
        // full-bleed TUI session view (active session is TUI), and the
        // bottom-panel shell terminal. First match wins.
        if (!tuiModalHandleTermOutput(msg) && !tuiHandleTermOutput(msg)) handleTermOutput(msg);
        break;

      case "term_resized":
        if (!tuiModalHandleTermResized(msg) && !tuiHandleTermResized(msg)) handleTermResized(msg);
        break;

      case "term_exited":
        if (!tuiModalHandleTermExited(msg) && !tuiHandleTermExited(msg)) handleTermExited(msg);
        break;

      case "term_closed":
        if (!tuiModalHandleTermClosed(msg) && !tuiHandleTermClosed(msg)) handleTermClosed(msg);
        break;

      // tui_attention now flows through the notification center as a
      // standard notification_created event; no special case here.

      case "notes_list":
        handleNotesList(msg);
        break;

      case "note_created":
        handleNoteCreated(msg);
        break;

      case "note_updated":
        handleNoteUpdated(msg);
        break;

      case "note_written":
        showToast((msg.byTitle || "Agent") + ' left a note: "' + (msg.preview || "") + '"');
        handleNoteWritten(msg);
        break;

      case "note_deleted":
        handleNoteDeleted(msg);
        break;

      case "project_logs_state":
        handleProjectLogsState(msg);
        break;

      case "project_log_entry":
        handleProjectLogEntry(msg);
        break;

      case "project_log_commented":
        handleProjectLogCommented(msg);
        break;

      case "project_log_comment_reviewed":
        handleProjectLogCommentReviewed(msg);
        break;

      case "project_log_deleted":
        handleProjectLogDeleted(msg);
        break;

      case "project_log_updated":
        handleProjectLogUpdated(msg);
        break;

      case "project_logs_error":
        handleProjectLogsError(msg);
        break;

      case "process_stats":
        updateStatusPanel(msg);
        updateSettingsStats(msg);
        break;

      case "browse_dir_result":
        handleBrowseDirResult(msg);
        break;

      case "add_project_result":
        handleAddProjectResult(msg);
        break;

      case "clone_project_progress":
        handleCloneProgress(msg);
        break;

      case "remove_project_result":
        handleRemoveProjectResult(msg);
        break;

      case "reorder_projects_result":
        if (!msg.ok) {
          showToast(msg.error || "Failed to reorder projects", "error");
        }
        break;

      case "set_project_title_result":
        if (!msg.ok) {
          showToast(msg.error || "Failed to rename project", "error");
        }
        break;

      case "set_project_icon_result":
        if (!msg.ok) {
          showToast(msg.error || "Failed to set icon", "error");
        }
        break;

      case "projects_updated":
        updateProjectList(msg);
        renderUserStrip();
        break;

      case "project_owner_changed":
        store.set({ currentProjectOwnerId: msg.ownerId });
        handleProjectOwnerChanged(msg);
        break;

      // --- DM ---
      case "dm_history":
        // Attach projectSlug to targetUser for mate DMs
        if (msg.projectSlug && msg.targetUser) {
          msg.targetUser.projectSlug = msg.projectSlug;
        }
        enterDmMode(msg.dmKey, msg.targetUser, msg.messages);
        // Auto-send first interview prompt after mate DM opens
        if (store.get('pendingMateInterview') && msg.targetUser && msg.targetUser.isMate && msg.projectSlug) {
          var interviewMate = store.get('pendingMateInterview');
          store.set({ pendingMateInterview: null });
          // Wait for mate project WS to connect, then send interview prompt
          var checkMateReady = setInterval(function () {
            if (getWs() && getWs().readyState === 1 && store.get('mateProjectSlug')) {
              clearInterval(checkMateReady);
              var interviewText = buildMateInterviewPrompt(interviewMate);
              getWs().send(JSON.stringify({ type: "message", text: interviewText }));
            }
          }, 100);
          setTimeout(function () { clearInterval(checkMateReady); }, 5000);
        }
        break;

      case "dm_message":
        if (store.get('dmMode') && msg.dmKey === store.get('dmKey')) {
          showDmTypingIndicator(false); // hide typing when message arrives
          appendDmMessage(msg.message);
          scrollToBottom();
        } else if (msg.message) {
          // DM notification when not in that DM
          var fromId = msg.message.from;
          if (fromId && fromId !== store.get('myUserId')) {
            var _du = Object.assign({}, store.get('dmUnread'));
            _du[fromId] = (_du[fromId] || 0) + 1;
            store.set({ dmUnread: _du });
            // renderUserStrip is handled by the store subscriber
            updateDmBadge(fromId, _du[fromId]);
          }
        }
        break;

      case "dm_typing":
        if (store.get('dmMode') && msg.dmKey === store.get('dmKey')) {
          showDmTypingIndicator(msg.typing);
        }
        break;

      case "dm_list":
        // Could be used for DM list view later
        break;

      case "dm_favorites_updated":
        // Track users explicitly removed from favorites
        var _cdf = store.get('cachedDmFavorites');
        if (_cdf && msg.dmFavorites) {
          for (var ri = 0; ri < _cdf.length; ri++) {
            if (msg.dmFavorites.indexOf(_cdf[ri]) === -1) {
              store.get('dmRemovedUsers')[_cdf[ri]] = true;
            }
          }
        }
        // Clear removed flag for users being added back
        if (msg.dmFavorites) {
          for (var ai = 0; ai < msg.dmFavorites.length; ai++) {
            delete store.get('dmRemovedUsers')[msg.dmFavorites[ai]];
          }
        }
        store.set({ cachedDmFavorites: msg.dmFavorites || [] });
        // renderUserStrip is handled by the store subscriber
        break;

      case "mate_created":
        handleMateCreatedInApp(msg.mate, msg);
        break;

      case "mate_deleted":
        store.set({ cachedMatesList: store.get('cachedMatesList').filter(function (m) { return m.id !== msg.mateId; }) });
        if (msg.availableBuiltins) store.set({ cachedAvailableBuiltins: msg.availableBuiltins });
        // renderUserStrip is handled by the store subscriber
        // If currently in DM with this mate, exit DM mode
        if (store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').id === msg.mateId) {
          exitDmMode();
        }
        break;

      case "mate_updated":
        if (msg.mate) {
          var _cml = store.get('cachedMatesList').slice();
          for (var mi = 0; mi < _cml.length; mi++) {
            if (_cml[mi].id === msg.mate.id) {
              _cml[mi] = msg.mate;
              break;
            }
          }
          store.set({ cachedMatesList: _cml });
          // renderUserStrip is handled by the store subscriber
          // Update mate sidebar if currently viewing this mate
          if (store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').isMate && store.get('dmTargetUser').id === msg.mate.id) {
            updateMateSidebarProfile(msg.mate);
            // Sync dmTargetUser so subsequent renders use fresh data
            var mp2 = msg.mate.profile || {};
            store.get('dmTargetUser').displayName = mp2.displayName || msg.mate.name || store.get('dmTargetUser').displayName;
            store.get('dmTargetUser').avatarStyle = mp2.avatarStyle || store.get('dmTargetUser').avatarStyle;
            store.get('dmTargetUser').avatarSeed = mp2.avatarSeed || store.get('dmTargetUser').avatarSeed;
            store.get('dmTargetUser').avatarColor = mp2.avatarColor || store.get('dmTargetUser').avatarColor;
            store.get('dmTargetUser').avatarCustom = mp2.avatarCustom || "";
            store.get('dmTargetUser').profile = mp2;
            // Refresh body dataset so new chat bubbles use the updated avatar
            document.body.dataset.mateAvatarUrl = mateAvatarUrl(store.get('dmTargetUser'), 36);
            document.body.dataset.mateName = mp2.displayName || msg.mate.name || "";
            // Update existing chat bubble avatars
            var mateAvis = document.querySelectorAll(".dm-bubble-avatar-mate");
            for (var mbi = 0; mbi < mateAvis.length; mbi++) {
              mateAvis[mbi].src = document.body.dataset.mateAvatarUrl;
            }
          }
          // Update DM header if currently chatting with this mate
          if (store.get('dmMode') && store.get('dmTargetUser') && store.get('dmTargetUser').id === msg.mate.id) {
            var updatedName = (msg.mate.profile && msg.mate.profile.displayName) || msg.mate.name;
            if (updatedName) {
              var dmHeaderName = document.getElementById("dm-header-name");
              if (dmHeaderName) dmHeaderName.textContent = updatedName;
              var dmInput = document.getElementById("dm-input");
              if (dmInput) dmInput.placeholder = "Message " + updatedName;
            }
          }
        }
        break;

      case "mate_list":
        store.set({ cachedMatesList: msg.mates || [], cachedAvailableBuiltins: msg.availableBuiltins || [] });
        // renderUserStrip is handled by the store subscriber
        break;

      case "mate_available_builtins":
        // Handled via mate_list.availableBuiltins now
        break;

      case "mate_error":
        showToast(msg.error || "Mate operation failed", "error");
        break;

      // --- @Mention ---
      case "mention_processing":
        // Broadcast: show/hide activity dot on mate avatar across all tabs
        if (msg.mateId) {
          setMentionActive(msg.mateId, msg.active);
          var mateContainers = document.querySelectorAll('.icon-strip-mate[data-user-id="' + msg.mateId + '"]');
          for (var mi = 0; mi < mateContainers.length; mi++) {
            var dot = mateContainers[mi].querySelector(".icon-strip-status");
            if (msg.active) {
              if (dot) dot.classList.add("processing");
              mateContainers[mi].classList.add("mention-active");
            } else {
              if (dot) dot.classList.remove("processing");
              mateContainers[mi].classList.remove("mention-active");
            }
          }
          updateCrossProjectBlink();
        }
        break;

      case "mention_start":
        handleMentionStart(msg);
        break;

      case "mention_activity":
        handleMentionActivity(msg);
        break;

      case "mention_stream":
        handleMentionStream(msg);
        break;

      case "mention_done":
        handleMentionDone(msg);
        break;

      case "mention_error":
        handleMentionError(msg);
        if (msg.error) showToast("@Mention: " + msg.error, "error");
        break;

      case "mention_user":
        // Finalize current assistant block so mention renders in correct DOM position
        finalizeAssistantBlock();
        renderMentionUser(msg);
        break;

      case "mention_response":
        finalizeAssistantBlock();
        renderMentionResponse(msg);
        break;

      case "user_mention":
        // User-to-user side conversation entry. Renders for any session viewer
        // (sender's other tabs and the mentioned user, if they are watching the
        // session). On the sender's own tab, the server uses sendToSessionOthers
        // so we never get a duplicate here.
        finalizeAssistantBlock();
        renderUserMention(msg);
        break;
      case "user_mention_error":
        if (msg.error) showToast("@Mention: " + msg.error, "error");
        break;

      // --- Debate ---
      case "debate_preparing":
        if (!store.get('replayingHistory')) showDebateSticky("preparing", msg);
        handleDebatePreparing(msg);
        break;

      case "debate_brief_ready":
        if (store.get('replayingHistory')) {
          renderDebateBriefReady(msg);
        } else {
          handleDebateBriefReady(msg);
        }
        break;

      case "debate_started":
        if (!store.get('replayingHistory')) showDebateSticky("live", msg);
        if (store.get('replayingHistory')) {
          renderDebateStarted(msg);
        } else {
          handleDebateStarted(msg);
        }
        break;

      case "debate_turn":
        handleDebateTurn(msg);
        if (msg.round) updateDebateRound(msg.round);
        break;

      case "debate_activity":
        handleDebateActivity(msg);
        break;

      case "debate_stream":
        handleDebateStream(msg);
        break;

      case "debate_turn_done":
        if (msg.round) updateDebateRound(msg.round);
        handleDebateTurnDone(msg);
        break;

      case "debate_tool_decision":
        addSystemMessage((msg.action || "Use " + (msg.toolName || "tool")) + " · " + (msg.decision === "allowed" ? "Allowed" : "Blocked") + (msg.reason ? " — " + msg.reason : "") + (msg.command ? "\n$ " + msg.command : ""), msg.decision !== "allowed");
        break;

      case "debate_stop_requested":
        addSystemMessage("Debate will stop after the current speaker finishes.", false);
        break;

      case "debate_stop_cancelled":
        addSystemMessage("Debate stop cancelled.", false);
        break;

      case "debate_hand_raised":
        // Visual feedback: hand is raised, waiting for floor
        break;

      case "debate_comment_queued":
        handleDebateCommentQueued(msg);
        break;

      case "debate_comment_injected":
        if (store.get('replayingHistory')) {
          renderDebateCommentInjected(msg);
        } else {
          handleDebateCommentInjected(msg);
        }
        break;

      case "debate_conclude_confirm":
        if (!store.get('replayingHistory')) showDebateConcludeConfirm(msg);
        break;

      case "debate_user_floor":
        if (!store.get('replayingHistory')) showDebateUserFloor(msg);
        break;

      case "debate_user_floor_done":
        renderDebateUserFloorDone(msg);
        break;

      case "debate_user_resume":
        renderDebateUserResume(msg);
        break;

      case "debate_resumed":
        handleDebateResumed(msg);
        if (!store.get('replayingHistory')) showDebateSticky("live", msg);
        break;

      case "debate_ended":
        if (!store.get('replayingHistory')) showDebateSticky("ended", msg);
        if (store.get('replayingHistory')) {
          renderDebateEnded(msg);
        } else {
          handleDebateEnded(msg);
        }
        break;

      case "debate_error":
        handleDebateError(msg);
        if (msg.error) showToast("Debate: " + msg.error, "error");
        break;

      case "daemon_config":
        if (msg.config && msg.config.headless) store.set({ isHeadlessMode: true });
        updateDaemonConfig(msg.config);
        break;

      case "set_pin_result":
        handleSetPinResult(msg);
        break;

      case "set_keep_awake_result":
        handleKeepAwakeChanged(msg);
        break;

      case "keep_awake_changed":
        handleKeepAwakeChanged(msg);
        break;

      case "set_inherit_groups_result":
      case "inherit_groups_changed":
        handleInheritGroupsChanged(msg);
        break;

      case "set_auto_continue_result":
      case "auto_continue_changed":
        handleAutoContinueChanged(msg);
        break;

      case "whats_new_state":
        // Keep a known-entries cache for the home page feed (which shows
        // both seen and unseen entries), then queue unseen ones for the
        // carousel.
        if (msg && Array.isArray(msg.entries)) setWhatsNewKnownEntries(msg.entries);
        handleWhatsNewState(msg);
        break;

      case "whats_new_seen_result":
        handleWhatsNewSeenResult(msg);
        break;

      case "set_claude_open_mode_result":
      case "claude_open_mode_changed":
        if (msg.claudeOpenMode === "tui" || msg.claudeOpenMode === "gui") {
          store.set({ claudeOpenMode: msg.claudeOpenMode });
          // Reflect into the user-settings toggle if it's already in the DOM.
          var _comToggle = document.getElementById("us-claude-open-mode");
          if (_comToggle) _comToggle.checked = msg.claudeOpenMode === "tui";
        }
        break;

      case "claude_allow_list":
        // Initial state for the user-settings allow-list editor.
        var _alTa = document.getElementById("us-claude-allow-list");
        if (_alTa && Array.isArray(msg.user)) {
          _alTa.value = msg.user.join("\n");
        }
        var _alManaged = document.getElementById("us-claude-allow-managed");
        if (_alManaged && Array.isArray(msg.managed)) {
          _alManaged.innerHTML = "";
          for (var _ali = 0; _ali < msg.managed.length; _ali++) {
            var _alCode = document.createElement("code");
            _alCode.textContent = msg.managed[_ali];
            _alManaged.appendChild(_alCode);
            if (_ali < msg.managed.length - 1) _alManaged.appendChild(document.createTextNode(" "));
          }
        }
        break;

      case "set_claude_user_allow_list_result":
        var _alStatus = document.getElementById("us-claude-allow-status");
        if (_alStatus) {
          if (msg.ok) {
            _alStatus.textContent = "Saved (applies on next claude invocation)";
            _alStatus.classList.remove("error");
            setTimeout(function () {
              if (_alStatus.textContent.indexOf("Saved") === 0) _alStatus.textContent = "";
            }, 4000);
          } else {
            _alStatus.textContent = "Save failed: " + (msg.error || "unknown");
            _alStatus.classList.add("error");
          }
        }
        break;

      case "restart_server_result":
        handleRestartResult(msg);
        break;

      case "shutdown_server_result":
        handleShutdownResult(msg);
        break;

      // --- Ralph Loop ---
      case "loop_available":
        store.set({ loopAvailable: msg.available, loopActive: msg.active, loopIteration: msg.iteration || 0, loopMaxIterations: msg.maxIterations || 20, loopBannerName: msg.name || null });

        var _la = store.snap();
        if (_la.loopActive) {
          showLoopBanner(true);
          if (_la.loopIteration > 0) {
            updateLoopBanner(_la.loopIteration, _la.loopMaxIterations, "running");
          }
          inputEl.disabled = true;
          inputEl.placeholder = (_la.loopBannerName || "Loop") + " is running...";
        }
        break;

      case "loop_started":
        store.set({ loopActive: true, ralphPhase: "executing", loopIteration: 0, loopMaxIterations: msg.maxIterations, loopBannerName: msg.name || null });
        showLoopBanner(true);

        var _lbn = store.get('loopBannerName');
        addSystemMessage((_lbn || "Loop") + " started (max " + msg.maxIterations + " iterations)", false);
        inputEl.disabled = true;
        inputEl.placeholder = (_lbn || "Loop") + " is running...";
        break;

      case "loop_iteration":
        store.set({ loopIteration: msg.iteration, loopMaxIterations: msg.maxIterations });
        updateLoopBanner(msg.iteration, msg.maxIterations, "running");

        var _libn = store.get('loopBannerName');
        addSystemMessage((_libn || "Loop") + " iteration #" + msg.iteration + " started", false);
        inputEl.disabled = true;
        inputEl.placeholder = (_libn || "Loop") + " is running...";
        break;

      case "loop_judging":
        var _ljs = store.snap();
        updateLoopBanner(_ljs.loopIteration, _ljs.loopMaxIterations, "judging");
        addSystemMessage("Judging iteration #" + msg.iteration + "...", false);
        inputEl.disabled = true;
        inputEl.placeholder = (_ljs.loopBannerName || "Loop") + " is judging...";
        break;

      case "loop_verdict":
        addSystemMessage("Judge: " + msg.verdict.toUpperCase() + " - " + (msg.summary || ""), false);
        break;

      case "loop_stopping":
        var _lss = store.snap();
        updateLoopBanner(_lss.loopIteration, _lss.loopMaxIterations, "stopping");
        break;

      case "loop_finished":
        var _lfbn = store.get('loopBannerName');
        store.set({ loopActive: false, ralphPhase: "done", loopBannerName: null });
        showLoopBanner(false);

        enableMainInput();
        updateLoopInputVisibility(null);
        var loopLabel = _lfbn || "Loop";
        var finishMsg = msg.reason === "pass"
          ? loopLabel + " completed successfully after " + msg.iterations + " iteration(s)."
          : msg.reason === "max_iterations"
            ? loopLabel + " reached maximum iterations (" + msg.iterations + ")."
            : msg.reason === "stopped"
              ? loopLabel + " stopped."
              : loopLabel + " ended with error.";
        addSystemMessage(finishMsg, false);
        break;

      case "loop_error":
        addSystemMessage((store.get('loopBannerName') || "Loop") + " error: " + msg.text, true);
        break;

      // --- Ralph Wizard / Crafting ---
      case "ralph_phase":
        var _rps = { ralphPhase: msg.phase || "idle" };
        if (msg.craftingSessionId) _rps.ralphCraftingSessionId = msg.craftingSessionId;
        if (msg.source !== undefined) _rps.ralphCraftingSource = msg.source;
        store.set(_rps);
        if (msg.wizardData) store.set({ wizardData: msg.wizardData });


        break;

      case "ralph_crafting_started":
        store.set({ ralphPhase: "crafting", ralphCraftingSessionId: msg.sessionId || store.get('activeSessionId'), ralphCraftingSource: msg.source || null });


        if (msg.source !== "ralph") {
          // Task sessions open in the scheduler calendar window
          enterCraftingMode(msg.sessionId, msg.taskId);
        }
        // Ralph crafting sessions show in session list as part of the loop group
        break;

      case "ralph_files_status":
        store.set({ ralphFilesReady: {
          promptReady: msg.promptReady,
          judgeReady: msg.judgeReady,
          bothReady: msg.bothReady,
        } });
        if (msg.bothReady) {
          var _rfs = store.snap();
          if (_rfs.ralphPhase === "crafting" || _rfs.ralphPhase === "approval") {
            store.set({ ralphPhase: "approval" });
            if (_rfs.ralphCraftingSource !== "ralph" || isSchedulerOpen()) {
              // Task crafting in scheduler: switch from crafting chat to detail view showing files
              exitCraftingMode(msg.taskId);
            } else {
              showRalphApprovalBar(true);
              // Auto-show execution modal (one-time) for Ralph source
              if (!store.get('execModalShown') && _rfs.ralphCraftingSource === "ralph") {
                showExecModal();
              }
            }
          }
        }
        updateRalphApprovalStatus();
        updateExecModalStatus();
        break;

      case "loop_registry_files_content":
        handleLoopRegistryFiles(msg);
        break;

      case "ralph_files_content":
        store.set({ ralphPreviewContent: { prompt: msg.prompt || "", judge: msg.judge || "" } });
        openRalphPreviewModal();
        break;

      case "loop_registry_error":
        addSystemMessage("Error: " + msg.text, true);
        break;

      // --- Notifications ---
      case "notifications_state":
        handleNotificationsState(msg);
        break;
      case "notification_created":
        handleNotificationCreated(msg);
        break;
      case "notification_dismissed":
        handleNotificationDismissed(msg);
        break;
      case "notification_dismissed_all":
        handleNotificationDismissedAll();
        break;
    }
}
