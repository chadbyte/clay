// app-dm.js - DM mode, mate project switching, mate onboarding
// Extracted from app.js (PR-24)

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { getMessagesEl, getInputEl } from './dom-refs.js';
import { userAvatarUrl, mateAvatarUrl } from './avatar.js';
import { buildDmMessage, buildDmTypingIndicator } from './dm-render.js';
import { connect } from './app-connection.js';
import { resetClientState, renderProjectList, getCachedProjects } from './app-projects.js';
import { scrollToBottom } from './app-rendering.js';
import { autoResize } from './input.js';
import { showDebateSticky } from './app-debate-ui.js';
import { updateDmBadge, setCurrentDmUser, closeDmUserPicker } from './sidebar-mates.js';
import { hideHomeHub, showHomeHub } from './app-home-hub.js';
import { openHomeChat } from './home-mate-chat.js';
import { hideNotes } from './sticky-notes.js';
import { showMateSidebar, hideMateSidebar } from './mate-sidebar.js';
import { hideKnowledge } from './mate-knowledge.js';
import { hideMemory } from './mate-memory.js';
import { closeFileViewer } from './filebrowser.js';
import { closeTerminal } from './terminal.js';
import { openMobileSheet, setMobileSheetMateData } from './sidebar-mobile.js';
import { getProfileLang } from './profile.js';
import { isSchedulerOpen, closeScheduler } from './scheduler.js';
import { syncResizeHandles } from './sidebar.js';

var MATE_ONBOARDING_KEY = "clay-mate-onboarding-shown";
var CLAUDE_CODE_AVATAR = "/claude-code-avatar.png";
var bgMateIoTimers = {};
var dmTypingTimer = null;

export function initDm() {
  // --- Reactive UI sync for dmMode ---
  store.subscribe(function (state, prev) {
    if (state.dmMode !== prev.dmMode) {
      var isMate = state.dmTargetUser && state.dmTargetUser.isMate;
      var mainCol = document.getElementById("main-column");
      var sidebarCol = document.getElementById("sidebar-column");
      var resizeHandle = document.getElementById("sidebar-resize-handle");
      if (state.dmMode) {
        if (!isMate && mainCol) mainCol.classList.add("dm-mode");
        if (sidebarCol) sidebarCol.classList.add("dm-mode");
        if (resizeHandle) resizeHandle.classList.add("dm-mode");
      } else {
        if (mainCol) mainCol.classList.remove("dm-mode");
        if (sidebarCol) sidebarCol.classList.remove("dm-mode");
        if (resizeHandle) resizeHandle.classList.remove("dm-mode");
      }
    }
  });

  // --- Mobile mate title bar click handlers ---
  var mobileBack = document.getElementById("mate-mobile-back");
  var mobileTitle = document.getElementById("mate-mobile-title");
  var mobileMore = document.getElementById("mate-mobile-more");
  if (mobileBack) {
    mobileBack.addEventListener("click", function (e) {
      e.stopPropagation();
      exitDmMode();
    });
  }
  if (mobileMore) {
    mobileMore.addEventListener("click", function (e) {
      e.stopPropagation();
      openMobileSheet("mate-profile");
    });
  }
  if (mobileTitle) {
    mobileTitle.addEventListener("click", function () {
      openMobileSheet("mate-profile");
    });
  }
}

export function openDm(targetUserId, opts) {
  var mates = store.get('cachedMatesList') || [];
  var isMateTarget = typeof targetUserId === "string" && targetUserId.indexOf("mate_") === 0;
  for (var i = 0; i < mates.length && !isMateTarget; i++) {
    if (mates[i] && mates[i].id === targetUserId) isMateTarget = true;
  }
  if (isMateTarget) {
    showHomeHub();
    openHomeChat(targetUserId);
    return;
  }
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  // Persist DM state for refresh recovery
  try { localStorage.setItem("clay-active-dm", targetUserId); } catch (e) {}
  // Opening an existing mate DM does not require the clay-mate-interview
  // skill — that skill is only used during new mate creation / reshaping.
  // Showing onboarding + gating a skill version check here caused the
  // "Skill Installation Required" modal to pop on every refresh / project
  // switch via the localStorage DM-restore fallback in app-connection.js.
  var skipOnboarding = !!(opts && opts.skipOnboarding);
  if (!skipOnboarding && typeof targetUserId === "string" && targetUserId.indexOf("mate_") === 0) {
    showMateOnboarding(function () {
      var ws2 = getWs();
      if (ws2) ws2.send(JSON.stringify({ type: "dm_open", targetUserId: targetUserId }));
    });
    return;
  }
  ws.send(JSON.stringify({ type: "dm_open", targetUserId: targetUserId }));
}

function showMateOnboarding(callback) {
  try {
    if (localStorage.getItem(MATE_ONBOARDING_KEY)) { callback(); return; }
  } catch (e) {}

  var overlay = document.createElement("div");
  overlay.className = "mate-onboarding-overlay";
  overlay.innerHTML =
    '<div class="mate-onboarding-card">' +
      '<h2 class="mate-onboarding-title">Meet your Mates</h2>' +
      '<p class="mate-onboarding-desc">' +
        'Mates are AI teammates powered by your Claude Code.<br>Each one has a distinct role, builds its own knowledge, and gets sharper over time.' +
      '</p>' +
      '<ul class="mate-onboarding-features">' +
        '<li><span class="mate-onboarding-bullet">\uD83C\uDFAD</span><div><strong>Specialized personas</strong><br><span class="mate-onboarding-sub">Architect, reviewer, researcher, chief of staff, and more</span></div></li>' +
        '<li><span class="mate-onboarding-bullet">\uD83D\uDD04</span><div><strong>Persistent memory</strong><br><span class="mate-onboarding-sub">Every conversation makes them smarter about you and your work</span></div></li>' +
        '<li><span class="mate-onboarding-bullet">\uD83D\uDCAC</span><div><strong>Shared context across the team</strong><br><span class="mate-onboarding-sub">What one mate learns, the others can reference</span></div></li>' +
        '<li><span class="mate-onboarding-bullet">\uD83D\uDCDA</span><div><strong>Self-growing knowledge base</strong><br><span class="mate-onboarding-sub">They accumulate notes, decisions, and observations on their own</span></div></li>' +
      '</ul>' +
      '<button class="mate-onboarding-btn">Let\u2019s go</button>' +
    '</div>';

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(function () {
    overlay.classList.add("visible");
  });

  function dismissOnboarding() {
    try { localStorage.setItem(MATE_ONBOARDING_KEY, "1"); } catch (e) {}
    fetch("/api/user/mate-onboarded", { method: "POST" }).catch(function () {});
    overlay.classList.remove("visible");
    setTimeout(function () { overlay.remove(); callback(); }, 200);
  }

  overlay.querySelector(".mate-onboarding-btn").addEventListener("click", dismissOnboarding);

  // Click outside to dismiss
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) dismissOnboarding();
  });
}

export function enterDmMode(key, targetUser, messages) {
  console.log("[DEBUG enterDmMode] key=" + key, "isMate=" + (targetUser && targetUser.isMate), "messages=" + (messages ? messages.length : 0));
  if (targetUser && targetUser.isMate) {
    showHomeHub();
    openHomeChat(targetUser.id);
    return;
  }
  var s = store.snap();
  // Clean up previous DM/mate state before entering new one
  if (s.dmMode) {
    hideMateSidebar();
    hideKnowledge();
    hideMemory();
    // Reset dm-header-bar
    var prevHeader = document.getElementById("dm-header-bar");
    if (prevHeader) {
      prevHeader.style.display = "";
      prevHeader.style.background = "";
      var prevTag = prevHeader.querySelector(".dm-header-mate-tag");
      if (prevTag) prevTag.remove();
    }
    // dm-mode CSS classes stay managed by the store subscriber.
    // Reset chat title bar
    var prevTitleBar = document.querySelector(".title-bar-content");
    if (prevTitleBar) {
      prevTitleBar.style.background = "";
      prevTitleBar.classList.remove("mate-dm-active");
    }
  }

  store.set({ dmMode: true, dmKey: key, dmTargetUser: targetUser });

  // Clear unread for this user
  if (targetUser) {
    store.get('dmUnread')[targetUser.id] = 0;
    updateDmBadge(targetUser.id, 0);
  }

  // Update icon strip active state
  setCurrentDmUser(targetUser ? targetUser.id : null);
  var activeProj = document.querySelector("#icon-strip-projects .icon-strip-item.active");
  if (activeProj) activeProj.classList.remove("active");
  var homeIcon = document.querySelector(".icon-strip-home");
  if (homeIcon) homeIcon.classList.remove("active");
  // Re-render user strip to show active state
  var cp = getCachedProjects();
  if (cp && cp.length > 0) {
    renderProjectList();
  }

  // Hide home hub if visible
  hideHomeHub();

  // Hide sticky notes if visible
  hideNotes();

  var isMate = targetUser && targetUser.isMate;

  // dm-mode CSS classes are handled by the store subscriber above.
  // Sync resize handles after DM sidebar appears
  setTimeout(function () { syncResizeHandles(); }, 50);
  if (isMate && targetUser.projectSlug) {
    // Mate DM: switch to mate's project (same as project switching)
    showMateSidebar(targetUser.id, targetUser);
    // Close file viewer and terminal panel BEFORE switching WS (needs old WS still open)
    try { closeFileViewer(); } catch(e) {}
    closeTerminal();
    var termBtn = document.getElementById("terminal-toggle-btn");
    if (termBtn) termBtn.style.display = "none";
    // Apply mate color to chat title bar and panels
    var mateColor = (targetUser.profile && targetUser.profile.avatarColor) || targetUser.avatarColor || "#5857fc";
    document.body.style.setProperty("--mate-color", mateColor);
    document.body.style.setProperty("--mate-color-tint", mateColor + "0a");
    document.body.classList.add("mate-dm-active");
    // Build mate avatar URL for DM bubble injection
    var mp = targetUser.profile || {};
    var mateAvUrlDm = mateAvatarUrl(targetUser, 36);
    var myUser = store.get('cachedAllUsers').find(function (u) { return u.id === store.get('myUserId'); });
    var myAvatarUrl = userAvatarUrl(myUser || { id: store.get('myUserId') }, 36);
    var myDisplayName = (myUser && myUser.displayName) || "";
    document.body.dataset.mateAvatarUrl = mateAvUrlDm;
    document.body.dataset.mateName = mp.displayName || targetUser.displayName || targetUser.name || "";
    document.body.dataset.myAvatarUrl = myAvatarUrl;
    document.body.dataset.myDisplayName = myDisplayName;
    var titleBarContent = document.querySelector(".title-bar-content");
    if (titleBarContent) {
      titleBarContent.style.background = mateColor;
      titleBarContent.classList.add("mate-dm-active");
    }
    // Populate mobile title bar for mate DM (CSS handles visibility via media query)
    var mateMobileTitle = document.getElementById("mate-mobile-title");
    if (mateMobileTitle) {
      var mateMobileAvatar = document.getElementById("mate-mobile-avatar");
      var mateMobileName = document.getElementById("mate-mobile-name");
      var mateMobileStatus = document.getElementById("mate-mobile-status");
      if (mateMobileAvatar) mateMobileAvatar.src = mateAvUrlDm;
      if (mateMobileName) mateMobileName.textContent = (mp.displayName || targetUser.displayName || targetUser.name || "");
      if (mateMobileStatus) mateMobileStatus.textContent = "online";
      mateMobileTitle.classList.remove("hidden");
      // Store mate data for profile sheet
      setMobileSheetMateData({
          id: targetUser.id,
          displayName: mp.displayName || targetUser.displayName || targetUser.name || "",
          description: mp.description || targetUser.description || "",
          avatarUrl: mateAvUrlDm,
          color: mateColor
        });
    }
    // Switch to mate project WS LAST, after all UI setup is complete.
    // Must be last because connect() changes ws to CONNECTING state,
    // and earlier code (closeFileViewer etc.) needs the old WS still open.
    connectMateProject(targetUser.projectSlug);
  }

  // Hide user-island in human DM, keep visible in Mate DM
  var userIsland = document.getElementById("user-island");
  if (userIsland && !isMate) userIsland.classList.add("dm-hidden");

  // Render DM messages
  store.set({ dmMessageCache: messages ? messages.slice() : [] });
  var messagesEl = getMessagesEl();
  messagesEl.innerHTML = "";
  if (messages && messages.length > 0) {
    for (var i = 0; i < messages.length; i++) {
      appendDmMessage(messages[i]);
    }
  }
  scrollToBottom();

  // Focus input
  var inputEl = getInputEl();
  if (inputEl) {
    var targetName = targetUser ? ((targetUser.profile && targetUser.profile.displayName) || targetUser.displayName || targetUser.name || "") : "";
    inputEl.placeholder = "Message " + targetName;
    inputEl.focus();
  }

  // Populate DM header bar with user avatar, name, and personal color
  if (targetUser) {
    var dmHeaderBar = document.getElementById("dm-header-bar");
    var dmAvatar = document.getElementById("dm-header-avatar");
    var dmName = document.getElementById("dm-header-name");
    if (isMate) {
      // Mate uses project chat title bar, hide DM header
      if (dmHeaderBar) dmHeaderBar.style.display = "none";
    } else {
      if (dmHeaderBar) dmHeaderBar.style.display = "";
      if (dmAvatar) {
        dmAvatar.src = userAvatarUrl(targetUser, 28);
      }
      if (dmName) dmName.textContent = targetUser.displayName;
      if (dmHeaderBar && targetUser.avatarColor) {
        dmHeaderBar.style.background = targetUser.avatarColor;
      }
      // Remove mate tag for regular DM
      var existingTag = dmHeaderBar ? dmHeaderBar.querySelector(".dm-header-mate-tag") : null;
      if (existingTag) existingTag.remove();
    }
  }
}

export function exitDmMode(skipProjectSwitch) {
  if (!store.get('dmMode')) return;
  var wasMate = store.get('dmTargetUser') && store.get('dmTargetUser').isMate;
  store.set({ dmMode: false, dmKey: null, dmTargetUser: null });
  try { localStorage.removeItem("clay-active-dm"); } catch (e) {}
  setCurrentDmUser(null);

  // dm-mode CSS classes are handled by the store subscriber.
  // Re-sync resize handle positions after DM width changes (defer to let layout settle)
  setTimeout(function () { syncResizeHandles(); }, 100);
  hideMateSidebar();
  hideKnowledge();
  hideMemory();
  if (isSchedulerOpen()) closeScheduler();
  // Restore terminal button
  var termBtn = document.getElementById("terminal-toggle-btn");
  if (termBtn) termBtn.style.display = "";
  // Reset DM header
  var dmHeaderBar = document.getElementById("dm-header-bar");
  if (dmHeaderBar) {
    dmHeaderBar.style.display = "";
    dmHeaderBar.style.background = "";
    var mateTag = dmHeaderBar.querySelector(".dm-header-mate-tag");
    if (mateTag) mateTag.remove();
  }
  // Reset chat title bar and mate color
  document.body.style.removeProperty("--mate-color");
  document.body.style.removeProperty("--mate-color-tint");
  document.body.classList.remove("mate-dm-active");
  delete document.body.dataset.mateAvatarUrl;
  delete document.body.dataset.mateName;
  delete document.body.dataset.myAvatarUrl;
  // Remove injected DM bubble avatars
  var messagesEl = getMessagesEl();
  var bubbleAvatars = messagesEl.querySelectorAll(".dm-bubble-avatar");
  for (var ba = 0; ba < bubbleAvatars.length; ba++) bubbleAvatars[ba].remove();
  var titleBarContent = document.querySelector(".title-bar-content");
  if (titleBarContent) {
    titleBarContent.style.background = "";
    titleBarContent.classList.remove("mate-dm-active");
  }
  // Hide mobile mate title bar
  var mateMobileTitle = document.getElementById("mate-mobile-title");
  if (mateMobileTitle) mateMobileTitle.classList.add("hidden");

  // Restore user-island (covers my avatar again)
  var userIsland = document.getElementById("user-island");
  if (userIsland) userIsland.classList.remove("dm-hidden");

  var inputEl = getInputEl();
  if (inputEl) inputEl.placeholder = "";

  // Switch back to main project (same as project switching)
  if (wasMate && !skipProjectSwitch) {
    disconnectMateProject();
  } else if (wasMate && skipProjectSwitch) {
    // Just clean up mate state, caller will handle project switch
    store.set({ returningFromMateDm: true, mateProjectSlug: null, savedMainSlug: null });
    showDebateSticky("hide", null);
    var debateFloat = document.getElementById("debate-info-float");
    if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
  } else {
    // Human DM: just re-request state from main project
    var ws = getWs();
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "switch_session", id: store.get('activeSessionId') }));
      ws.send(JSON.stringify({ type: "note_list_request" }));
    }
  }
  renderProjectList();
}

export function handleMateCreatedInApp(mate, msg) {
  if (!mate) return;
  var newMates = (store.get('cachedMatesList') || []).filter(function (existing) { return existing && existing.id !== mate.id; }).concat([mate]);
  var updates = { cachedMatesList: newMates };
  if (msg && msg.availableBuiltins) updates.cachedAvailableBuiltins = msg.availableBuiltins;
  if (msg && msg.dmFavorites) updates.cachedDmFavorites = msg.dmFavorites;
  store.set(updates);
  // renderUserStrip is handled by the store subscriber
  // Built-in mates handle their own onboarding via CLAUDE.md, skip auto-interview
  if (!mate.builtinKey && !(msg && msg.interviewComplete === true)) {
    store.set({ pendingMateInterview: mate });
  }
  if (!(msg && msg.interviewComplete === true)) {
    showHomeHub();
    openHomeChat(mate.id);
  }
}


export function buildMateInterviewPrompt(mate) {
  var sd = mate.seedData || {};
  var parts = [];
  var spokenLang = getProfileLang() || "en-US";
  parts.push("Spoken Language: " + spokenLang);
  if (sd.relationship) parts.push("Relationship: " + sd.relationship);
  if (sd.activity && sd.activity.length > 0) parts.push("Activities: " + sd.activity.join(", "));
  if (sd.communicationStyle && sd.communicationStyle.length > 0) {
    var styleLabels = {
      direct_concise: "direct and concise",
      soft_detailed: "soft and detailed",
      witty: "witty",
      encouraging: "encouraging",
      formal: "formal",
      no_nonsense: "no-nonsense",
    };
    var styles = sd.communicationStyle.map(function (s) { return styleLabels[s] || s.replace(/_/g, " "); });
    parts.push("Communication: " + styles.join(", "));
  }
  return "Use the /clay-mate-interview skill to start the interview.\n\n" +
    "Mate ID: " + mate.id + "\n" +
    "Mate Directory: .claude/mates/" + mate.id + "\n\n" +
    "Seed Data:\n" + parts.join("\n");
}

export function updateMateIconStatus(msg) {
  if (!store.get('mateProjectSlug')) return;
  var slug = store.get('mateProjectSlug');
  if (msg.type === "content" || msg.type === "tool" || msg.type === "tool_use" || msg.type === "thinking") {
    var ioDot = document.querySelector('.icon-strip-mate[data-mate-slug="' + slug + '"] .icon-strip-status');
    if (ioDot) {
      ioDot.classList.add("io");
      clearTimeout(bgMateIoTimers[slug]);
      bgMateIoTimers[slug] = setTimeout(function () { ioDot.classList.remove("io"); }, 80);
    }
  }
  if (msg.type === "status" && msg.status === "processing") {
    var dot = document.querySelector('.icon-strip-mate[data-mate-slug="' + slug + '"] .icon-strip-status');
    if (dot) dot.classList.add("processing");
    var mateSessionDot = document.querySelector(".mate-session-item.active .session-processing");
    if (mateSessionDot) mateSessionDot.style.display = "";
  }
  if (msg.type === "done") {
    var dot = document.querySelector('.icon-strip-mate[data-mate-slug="' + slug + '"] .icon-strip-status');
    if (dot) dot.classList.remove("processing");
    var mateSessionDot = document.querySelector(".mate-session-item.active .session-processing");
    if (mateSessionDot) mateSessionDot.style.display = "none";
  }
}

export function connectMateProject(slug) {
  var s = store.snap();
  store.set({ mateProjectSlug: slug });
  // Only save the main slug on the FIRST mate switch (preserve original main project)
  if (!s.savedMainSlug) store.set({ savedMainSlug: s.currentSlug });
  store.set({ currentSlug: slug, wsPath: "/p/" + slug + "/ws" });
  resetClientState();
  connect();
}

export function disconnectMateProject() {
  store.set({ mateProjectSlug: null });
  // Hide debate sticky when leaving mate DM
  showDebateSticky("hide", null);
  // Hide debate info float
  var debateFloat = document.getElementById("debate-info-float");
  if (debateFloat) { debateFloat.classList.add("hidden"); debateFloat.innerHTML = ""; }
  // Switch back to main project
  var savedMainSlug = store.get('savedMainSlug');
  if (savedMainSlug) {
    store.set({
      returningFromMateDm: true,
      currentSlug: savedMainSlug,
      basePath: "/p/" + savedMainSlug + "/",
      wsPath: "/p/" + savedMainSlug + "/ws",
      savedMainSlug: null
    });
    resetClientState();
    connect();
  }
}

export function appendDmMessage(msg) {
  var s = store.snap();
  if (s.dmMode) s.dmMessageCache.push(msg);
  var isMe = msg.from === s.myUserId;
  var messagesEl = getMessagesEl();
  var myUser = s.cachedAllUsers.find(function (user) { return user.id === s.myUserId; });
  var avatarUrl = isMe
    ? userAvatarUrl(myUser || { id: s.myUserId }, 36)
    : (s.dmTargetUser ? userAvatarUrl(s.dmTargetUser, 36) : "");
  var displayName = isMe
    ? (myUser ? myUser.displayName : "Me")
    : (s.dmTargetUser ? s.dmTargetUser.displayName : "User");
  messagesEl.appendChild(buildDmMessage(msg, {
    container: messagesEl,
    isMe: isMe,
    avatarUrl: avatarUrl,
    displayName: displayName,
  }));
}

export function showDmTypingIndicator(typing) {
  var existing = document.getElementById("dm-typing-indicator");
  if (!typing) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return; // already showing
  var dmTargetUser = store.get('dmTargetUser');
  if (!dmTargetUser) return;

  var messagesEl = getMessagesEl();
  messagesEl.appendChild(buildDmTypingIndicator({
    id: "dm-typing-indicator",
    avatarUrl: userAvatarUrl(dmTargetUser, 36),
  }));
  scrollToBottom();

  // Auto-hide after 5s in case stop signal is missed
  clearTimeout(dmTypingTimer);
  dmTypingTimer = setTimeout(function () {
    showDmTypingIndicator(false);
  }, 5000);
}

export function handleDmSend() {
  var s = store.snap();
  var inputEl = getInputEl();
  if (!s.dmMode || !s.dmKey || !inputEl) return false;
  var text = inputEl.value.trim();
  if (!text) return false;
  var ws = getWs();
  ws.send(JSON.stringify({ type: "dm_send", dmKey: s.dmKey, text: text }));
  inputEl.value = "";
  autoResize();
  return true;
}
