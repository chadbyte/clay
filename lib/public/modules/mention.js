import { mateAvatarUrl, userAvatarUrl } from './avatar.js';
import { renderMarkdown, highlightCodeBlocks } from './markdown.js';
import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { getProjectAssistantPlaceholder } from './project-chat-identity.js';

var ctx;

// --- State ---
var mentionActive = false;       // @ autocomplete is visible
var mentionAtIdx = -1;           // position of the @ in input
var mentionFiltered = [];        // filtered candidate list (mates + users)
var mentionActiveIdx = -1;       // highlighted item in dropdown
// "kind" = "mate" | "user". Both keep the same chip UX so most existing code
// branches only on the kind at send time. Variable names retain "Mate" prefix
// for backwards compatibility with consumers like input.js / app-messages.js.
var selectedMateKind = null;     // "mate" | "user" | null
var selectedMateId = null;       // mate id OR user id
var selectedMateName = null;     // display name
var selectedMateColor = null;    // avatar color for sticky re-apply
var selectedMateAvatar = null;   // avatar src for sticky re-apply

// Streaming state
var currentMentionEl = null;     // current mention response DOM element
var mentionFullText = "";        // accumulated response text
var mentionStreamBuffer = "";    // stream smoothing buffer
var mentionDrainTimer = null;
var activeMentionMeta = null;    // { mateId, mateName, avatarColor, avatarStyle, avatarSeed } for reconnect

// --- Init ---
export function initMention(_ctx) {
  ctx = _ctx;
}

// --- @ detection ---
// Called from input.js on each input event.
// Returns { active, query, startIdx } if @ mention is being typed.
export function checkForMention(value, cursorPos) {
  // Look backwards from cursor to find an unmatched @
  var i = cursorPos - 1;
  while (i >= 0) {
    var ch = value.charAt(i);
    if (ch === "@") {
      // @ must be at start of input or preceded by whitespace
      if (i === 0 || /\s/.test(value.charAt(i - 1))) {
        var query = value.substring(i + 1, cursorPos);
        // Don't activate if query contains whitespace (user moved past mention)
        if (/\s/.test(query)) break;
        return { active: true, query: query, startIdx: i };
      }
      break;
    }
    if (/\s/.test(ch)) break; // whitespace before finding @ means no mention
    i--;
  }
  return { active: false, query: "", startIdx: -1 };
}

// --- Autocomplete dropdown ---
// Build the unified candidate list of mates + users. Each candidate is
// normalized to { kind, id, name, color, avatarSrc, vendor, bio, primary, raw }.
// Plain @mention targets. Vendor-only entries with no persona or memory; the
// server-side handler (lib/project-mate-interaction.js) recognises these IDs
// and routes them through the matching vendor adapter directly.
var PLAIN_MENTION_CANDIDATES = [
  {
    kind: "mate",
    id: "plain:claude",
    name: "Claude Code",
    color: "#cc785c",
    avatarSrc: "/claude-code-avatar.png",
    vendor: "claude",
    bio: "Plain Claude Code, no persona, no memory",
    primary: false,
    plain: true,
    raw: null,
  },
  {
    kind: "mate",
    id: "plain:codex",
    name: "Codex",
    color: "#10a37f",
    avatarSrc: "/codex-avatar.png",
    vendor: "codex",
    bio: "Plain Codex, no persona, no memory",
    primary: false,
    plain: true,
    raw: null,
  },
];

function buildMentionCandidates() {
  var candidates = [];

  // Plain vendor mentions (always available, regardless of Mates toggle).
  // Hide the plain entry that matches the current session's vendor: there is
  // no point asking Claude for a second opinion while you are already in a
  // Claude session, and likewise for Codex.
  var sessionVendor = store.get('currentVendor') || "claude";
  for (var pi = 0; pi < PLAIN_MENTION_CANDIDATES.length; pi++) {
    if (PLAIN_MENTION_CANDIDATES[pi].vendor === sessionVendor) continue;
    candidates.push(PLAIN_MENTION_CANDIDATES[pi]);
  }

  // Mate mentions are a project collaboration capability, not a Mate DM.
  var mates = ctx.matesList ? ctx.matesList() : [];
  for (var mi = 0; mi < mates.length; mi++) {
    var m = mates[mi];
    if (m.status === "interviewing") continue;
    candidates.push({
      kind: "mate",
      id: m.id,
      name: (m.profile && m.profile.displayName) || m.name || "Mate",
      color: (m.profile && m.profile.avatarColor) || "#5857fc",
      avatarSrc: mateAvatarUrl(m, 24),
      vendor: m.vendor || "claude",
      bio: m.bio || (m.profile && m.profile.bio) || "",
      primary: !!m.primary,
      raw: m,
    });
  }

  // Users: every other signed-in user.
  // We use the cached user list pushed by the server in projects_updated.
  var allUsers = ctx.allUsers ? ctx.allUsers() : [];
  var myId = ctx.myUserId ? ctx.myUserId() : null;
  for (var ui = 0; ui < allUsers.length; ui++) {
    var u = allUsers[ui];
    if (!u || !u.id) continue;
    if (myId && u.id === myId) continue; // never @-mention yourself
    candidates.push({
      kind: "user",
      id: u.id,
      name: u.displayName || u.username || "User",
      color: u.avatarColor || "#5857fc",
      avatarSrc: userAvatarUrl(u, 24),
      vendor: null,
      bio: u.username ? "@" + u.username : "",
      primary: false,
      raw: u,
    });
  }

  return candidates;
}

export function showMentionMenu(query) {
  var candidates = buildMentionCandidates();
  if (candidates.length === 0) {
    hideMentionMenu();
    return;
  }

  var lowerQuery = (query || "").toLowerCase();
  mentionFiltered = candidates.filter(function (c) {
    if (!lowerQuery) return true;
    if (c.name.toLowerCase().indexOf(lowerQuery) !== -1) return true;
    if (c.kind === "user" && c.raw && c.raw.username && c.raw.username.toLowerCase().indexOf(lowerQuery) !== -1) return true;
    return false;
  });

  if (mentionFiltered.length === 0) {
    hideMentionMenu();
    return;
  }

  mentionActive = true;
  mentionActiveIdx = 0;

  var menuEl = document.getElementById("mention-menu");
  if (!menuEl) return;

  menuEl.innerHTML = '<div class="mention-hint">Mention a Mate or teammate &mdash; the coding agent stays out of this exchange until your next message<button class="mention-close-btn" aria-label="Close">&times;</button></div>' +
  mentionFiltered.map(function (c, i) {
    var vendorIcons = { claude: "/claude-code-avatar.png", codex: "/codex-avatar.png" };
    var vendorBadge = (c.kind === "mate" && vendorIcons[c.vendor]) ? '<img class="mention-item-vendor-badge" src="' + vendorIcons[c.vendor] + '" alt="' + escapeHtml(c.vendor) + '">' : '';
    var kindBadge = c.kind === "user"
      ? ' <span class="mention-item-badge mention-item-badge-user">USER</span>'
      : (c.plain ? ' <span class="mention-item-badge">PLAIN</span>'
        : (c.primary ? ' <span class="mention-item-badge">SYSTEM</span>' : ''));
    return '<div class="mention-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
      '<div class="mention-item-avatar-wrap"><img class="mention-item-avatar" src="' + escapeHtml(c.avatarSrc) + '" width="24" height="24" />' + vendorBadge + '</div>' +
      '<div class="mention-item-info">' +
        '<span class="mention-item-name">' + escapeHtml(c.name) + kindBadge + '</span>' +
        (c.bio ? '<span class="mention-item-bio">' + escapeHtml(c.bio) + '</span>' : '') +
      '</div>' +
      '<span class="mention-item-dot" style="background:' + escapeHtml(c.color) + '"></span>' +
      '</div>';
  }).join("");
  menuEl.classList.add("visible");

  var closeBtn = menuEl.querySelector(".mention-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    hideMentionMenu();
    clearMentionState();
    if (ctx && ctx.inputEl) {
      ctx.inputEl.value = ctx.inputEl.value.replace(/@\S*$/, "");
      ctx.inputEl.focus();
    }
  });

  menuEl.querySelectorAll(".mention-item").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      selectMentionItem(parseInt(el.dataset.idx));
    });
  });
}

export function hideMentionMenu() {
  mentionActive = false;
  mentionActiveIdx = -1;
  mentionFiltered = [];
  var menuEl = document.getElementById("mention-menu");
  if (menuEl) {
    menuEl.classList.remove("visible");
    menuEl.innerHTML = "";
  }
}

export function isMentionMenuVisible() {
  return mentionActive && mentionFiltered.length > 0;
}

export function mentionMenuKeydown(e) {
  if (!mentionActive || mentionFiltered.length === 0) return false;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    mentionActiveIdx = (mentionActiveIdx + 1) % mentionFiltered.length;
    updateMentionHighlight();
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    mentionActiveIdx = (mentionActiveIdx - 1 + mentionFiltered.length) % mentionFiltered.length;
    updateMentionHighlight();
    return true;
  }
  if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
    e.preventDefault();
    selectMentionItem(mentionActiveIdx);
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    hideMentionMenu();
    return true;
  }
  return false;
}

function selectMentionItem(idx) {
  if (idx < 0 || idx >= mentionFiltered.length) return;
  var c = mentionFiltered[idx];
  // mentionFiltered now holds normalized candidates ({ kind, id, name, color, avatarSrc, ... }).
  // Use a smaller avatar for the chip than the dropdown (20 vs 24).
  var avatarSrc = c.kind === "mate" && c.raw ? mateAvatarUrl(c.raw, 20) : c.avatarSrc;

  selectedMateKind = c.kind;
  selectedMateId = c.id;
  selectedMateName = c.name;
  selectedMateColor = c.color;
  selectedMateAvatar = avatarSrc;

  // Remove the @query text from the textarea, keep remaining text
  if (ctx.inputEl && mentionAtIdx >= 0) {
    var val = ctx.inputEl.value;
    var cursorPos = ctx.inputEl.selectionStart;
    var before = val.substring(0, mentionAtIdx);
    var after = val.substring(cursorPos);
    ctx.inputEl.value = (before + after).trim();
    ctx.inputEl.selectionStart = ctx.inputEl.selectionEnd = 0;
    ctx.inputEl.focus();
  }

  // Show visual chip in input area
  showInputMentionChip(selectedMateName, selectedMateColor, avatarSrc);

  hideMentionMenu();
}

function ensureChipContrast(hex) {
  if (!hex || hex.charAt(0) !== "#") return hex;
  var r = parseInt(hex.substring(1, 3), 16);
  var g = parseInt(hex.substring(3, 5), 16);
  var b = parseInt(hex.substring(5, 7), 16);
  // Relative luminance (sRGB)
  var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  var isDark = document.documentElement.classList.contains("dark") ||
               document.body.classList.contains("dark-mode");
  if (isDark) {
    // Dark mode: lighten if too dark
    return lum < 0.4 ? color_mix_lighten(r, g, b, 0.35) : hex;
  }
  // Light mode: darken if too bright
  return lum > 0.55 ? color_mix_darken(r, g, b, 0.4) : hex;
}

function color_mix_darken(r, g, b, amount) {
  var f = 1 - amount;
  return "#" + [Math.round(r * f), Math.round(g * f), Math.round(b * f)]
    .map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
}

function color_mix_lighten(r, g, b, amount) {
  return "#" + [Math.round(r + (255 - r) * amount), Math.round(g + (255 - g) * amount), Math.round(b + (255 - b) * amount)]
    .map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
}

function showInputMentionChip(name, color, avatarSrc) {
  removeInputMentionChip();
  var textColor = ensureChipContrast(color);
  var chip = document.createElement("div");
  chip.id = "input-mention-chip";
  chip.innerHTML =
    '<img class="input-mention-chip-avatar" src="' + escapeHtml(avatarSrc) + '" width="18" height="18" />' +
    '<span class="input-mention-chip-name" style="color:' + escapeHtml(textColor) + '">@' + escapeHtml(name) + '</span>' +
    '<button class="input-mention-chip-remove" type="button" aria-label="Remove mention">&times;</button>';
  chip.style.setProperty("--chip-color", color);

  // Insert before the textarea wrapper inside input-row
  var inputRow = document.getElementById("input-row");
  var textareaWrap = document.getElementById("input-textarea-wrap");
  if (inputRow && textareaWrap) {
    inputRow.insertBefore(chip, textareaWrap);
  }

  // Swap the textarea placeholder so the user sees "Ask @{name}..." while a
  // mention is queued. Restoration is handled only while this prompt owns it.
  if (ctx && ctx.inputEl) {
    ctx.inputEl.placeholder = "Ask @" + name + "...";
  }

  chip.querySelector(".input-mention-chip-remove").addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    removeMentionChip();
  });
}

function removeInputMentionChip() {
  var existing = document.getElementById("input-mention-chip");
  if (existing) existing.remove();
  if (existing && ctx && ctx.inputEl && !ctx.inputEl.disabled && /^Ask @/.test(ctx.inputEl.placeholder || "")) {
    ctx.inputEl.placeholder = getProjectAssistantPlaceholder(store.snap(), store.get('currentVendor'));
  }
}

export function removeMentionChip() {
  removeInputMentionChip();
  selectedMateKind = null;
  selectedMateId = null;
  selectedMateName = null;
  selectedMateColor = null;
  selectedMateAvatar = null;
  if (ctx.inputEl) ctx.inputEl.focus();
}

function updateMentionHighlight() {
  var menuEl = document.getElementById("mention-menu");
  if (!menuEl) return;
  menuEl.querySelectorAll(".mention-item").forEach(function (el, i) {
    el.classList.toggle("active", i === mentionActiveIdx);
  });
  var activeEl = menuEl.querySelector(".mention-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

// Store the @ position when check detects mention
export function setMentionAtIdx(idx) {
  mentionAtIdx = idx;
}

// --- Mention send ---
// Returns { kind, mateId, userId, mateName, text } if input has an @mention, or null.
// `mateId` and `userId` are kept as separate fields so call sites can dispatch
// to the right server message type without inspecting `kind` (legacy callers
// that only read `mateId` keep working for mate mentions).
export function parseMentionFromInput(text) {
  if (!selectedMateId || !selectedMateName) return null;
  // The chip is shown separately; textarea contains only the message text
  var mentionText = (text || "").trim();
  if (!mentionText) return null;
  var kind = selectedMateKind || "mate";
  return {
    kind: kind,
    mateId: kind === "mate" ? selectedMateId : null,
    userId: kind === "user" ? selectedMateId : null,
    mateName: selectedMateName,
    text: mentionText,
  };
}

export function clearMentionState() {
  selectedMateKind = null;
  selectedMateId = null;
  selectedMateName = null;
  selectedMateColor = null;
  selectedMateAvatar = null;
  mentionAtIdx = -1;
  removeInputMentionChip();
}

// Re-apply the same mention after sending (sticky mention).
// Keeps the chip visible so the next message also goes to the same target.
export function stickyReapplyMention() {
  if (!selectedMateId || !selectedMateName) return;
  var kind = selectedMateKind;
  var id = selectedMateId;
  var name = selectedMateName;
  var color = selectedMateColor || "#5857fc";
  var avatarSrc = selectedMateAvatar || "";
  // Reset index but keep selection
  mentionAtIdx = -1;
  removeInputMentionChip();
  selectedMateKind = kind;
  selectedMateId = id;
  selectedMateName = name;
  selectedMateColor = color;
  selectedMateAvatar = avatarSrc;
  showInputMentionChip(name, color, avatarSrc);
}

// Send a mate @mention. Existing call sites keep using this verbatim.
export function sendMention(mateId, text, pastes, images) {
  if (!ctx.ws || !ctx.connected) return;
  var payload = { type: "mention", mateId: mateId, text: text };
  if (pastes && pastes.length > 0) payload.pastes = pastes;
  if (images && images.length > 0) payload.images = images;
  ctx.ws.send(JSON.stringify(payload));
}

// Send a user-to-user @mention. Server stores it in session.history, broadcasts
// to other session viewers, fires an alarm-center notification + push for the
// target user, and queues the transcript for the next coding-agent turn.
export function sendUserMention(userId, text, pastes, images) {
  if (!ctx.ws || !ctx.connected) return;
  var payload = { type: "user_mention", targetUserId: userId, text: text };
  if (pastes && pastes.length > 0) payload.pastes = pastes;
  if (images && images.length > 0) payload.images = images;
  ctx.ws.send(JSON.stringify(payload));
}

// --- Mention response rendering ---

// Recreate the mention block if it was lost (e.g. session switch)
function ensureMentionBlock() {
  if (currentMentionEl && currentMentionEl.parentNode) {
    // If other elements (e.g. permission requests) were added after the mention
    // block, move it to the bottom to maintain chronological order.
    var parent = currentMentionEl.parentNode;
    if (parent.lastElementChild !== currentMentionEl) {
      parent.appendChild(currentMentionEl);
      if (ctx.scrollToBottom) ctx.scrollToBottom();
    }
    return;
  }
  if (!activeMentionMeta) return;
  // Recreate from saved meta
  handleMentionStart(activeMentionMeta);
  // Re-render any accumulated text
  if (mentionFullText) {
    var contentEl = currentMentionEl.querySelector(".mention-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(mentionFullText);
      highlightCodeBlocks(contentEl);
    }
    // Hide activity bar since we have text
    var bar = currentMentionEl.querySelector(".mention-activity-bar");
    if (bar) bar.style.display = "none";
  }
}

export function handleMentionStart(msg) {
  // Save meta for potential reconnect after session switch
  activeMentionMeta = {
    mateId: msg.mateId,
    mateName: msg.mateName,
    avatarColor: msg.avatarColor,
    avatarStyle: msg.avatarStyle,
    avatarSeed: msg.avatarSeed,
  };

  var avatarSrc = buildMentionAvatarUrl(msg);

  if (isDmLayout()) {
    // DM-style: render as DM-style assistant message (Mate DM or Wide view)
    currentMentionEl = document.createElement("div");
    currentMentionEl.className = "msg-assistant msg-mention-dm";

    var avi = document.createElement("img");
    avi.className = "dm-bubble-avatar dm-bubble-avatar-mate";
    avi.src = avatarSrc;
    currentMentionEl.appendChild(avi);

    var contentWrap = document.createElement("div");
    contentWrap.className = "dm-bubble-content";

    var header = document.createElement("div");
    header.className = "dm-bubble-header";
    var nameSpan = document.createElement("span");
    nameSpan.className = "dm-bubble-name";
    nameSpan.style.color = msg.avatarColor || "#5857fc";
    nameSpan.textContent = msg.mateName || "Mate";
    header.appendChild(nameSpan);

    var badge = document.createElement("span");
    badge.className = "mention-badge";
    badge.textContent = "@MENTION";
    header.appendChild(badge);

    var stopBtn = document.createElement("button");
    stopBtn.className = "mention-stop-btn";
    stopBtn.title = "Stop";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "mention_stop", mateId: msg.mateId }));
      }
    });
    header.appendChild(stopBtn);
    contentWrap.appendChild(header);

    // Activity indicator
    var activityDiv = document.createElement("div");
    activityDiv.className = "activity-inline mention-activity-bar";
    activityDiv.innerHTML =
      '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
      '<span class="activity-text">Thinking...</span>';
    contentWrap.appendChild(activityDiv);

    // Content area for streamed markdown
    var contentDiv = document.createElement("div");
    contentDiv.className = "md-content mention-content";
    contentDiv.dir = "auto";
    contentWrap.appendChild(contentDiv);

    currentMentionEl.appendChild(contentWrap);
  } else {
    // Project chat: mention block style
    currentMentionEl = document.createElement("div");
    currentMentionEl.className = "msg-mention";
    currentMentionEl.style.setProperty("--mention-color", msg.avatarColor || "#5857fc");

    var header = document.createElement("div");
    header.className = "mention-header";

    var avatar = document.createElement("img");
    avatar.className = "mention-avatar";
    avatar.src = avatarSrc;
    avatar.width = 20;
    avatar.height = 20;
    header.appendChild(avatar);

    var nameSpan = document.createElement("span");
    nameSpan.className = "mention-name";
    nameSpan.textContent = msg.mateName || "Mate";
    header.appendChild(nameSpan);

    var stopBtn = document.createElement("button");
    stopBtn.className = "mention-stop-btn";
    stopBtn.title = "Stop";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", function () {
      if (ctx.ws && ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "mention_stop", mateId: msg.mateId }));
      }
    });
    header.appendChild(stopBtn);

    currentMentionEl.appendChild(header);

    // Activity indicator
    var activityDiv = document.createElement("div");
    activityDiv.className = "activity-inline mention-activity-bar";
    activityDiv.innerHTML =
      '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
      '<span class="activity-text">Thinking...</span>';
    currentMentionEl.appendChild(activityDiv);

    // Content area for streamed markdown
    var contentDiv = document.createElement("div");
    contentDiv.className = "md-content mention-content";
    contentDiv.dir = "auto";
    currentMentionEl.appendChild(contentDiv);
  }

  mentionFullText = "";
  mentionStreamBuffer = "";

  if (ctx.messagesEl) {
    ctx.messagesEl.appendChild(currentMentionEl);
    refreshIcons();
    if (ctx.scrollToBottom) ctx.scrollToBottom();
  }
}

export function handleMentionActivity(msg) {
  ensureMentionBlock();
  if (!currentMentionEl) return;
  var bar = currentMentionEl.querySelector(".mention-activity-bar");
  if (msg.activity) {
    // Show or update activity
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "activity-inline mention-activity-bar";
      bar.innerHTML =
        '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
        '<span class="activity-text"></span>';
      var contentEl = currentMentionEl.querySelector(".mention-content");
      if (contentEl) {
        currentMentionEl.insertBefore(bar, contentEl);
      } else {
        currentMentionEl.appendChild(bar);
      }
      refreshIcons();
    }
    var textEl = bar.querySelector(".activity-text");
    if (textEl) {
      textEl.textContent = msg.activity === "thinking" ? "Thinking..." : msg.activity;
    }
    bar.style.display = "";
  } else {
    if (bar) bar.style.display = "none";
  }
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleMentionStream(msg) {
  ensureMentionBlock();
  if (!currentMentionEl) return;

  // Hide activity bar on first text delta
  var bar = currentMentionEl.querySelector(".mention-activity-bar");
  if (bar) bar.style.display = "none";

  mentionStreamBuffer += msg.delta;
  if (!mentionDrainTimer) {
    mentionDrainTimer = requestAnimationFrame(drainMentionStream);
  }
}

function drainMentionStream() {
  mentionDrainTimer = null;
  if (!currentMentionEl || mentionStreamBuffer.length === 0) return;

  var len = mentionStreamBuffer.length;
  var n;
  if (len > 200) n = Math.ceil(len / 4);
  else if (len > 80) n = 8;
  else if (len > 30) n = 5;
  else if (len > 10) n = 2;
  else n = 1;

  var chunk = mentionStreamBuffer.slice(0, n);
  mentionStreamBuffer = mentionStreamBuffer.slice(n);
  mentionFullText += chunk;

  var contentEl = currentMentionEl.querySelector(".mention-content");
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(mentionFullText);
    highlightCodeBlocks(contentEl);
  }

  if (ctx.scrollToBottom) ctx.scrollToBottom();

  if (mentionStreamBuffer.length > 0) {
    mentionDrainTimer = requestAnimationFrame(drainMentionStream);
  }
}

function flushMentionStream() {
  if (mentionDrainTimer) {
    cancelAnimationFrame(mentionDrainTimer);
    mentionDrainTimer = null;
  }
  if (mentionStreamBuffer.length > 0) {
    mentionFullText += mentionStreamBuffer;
    mentionStreamBuffer = "";
  }
  if (currentMentionEl) {
    var contentEl = currentMentionEl.querySelector(".mention-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(mentionFullText);
      highlightCodeBlocks(contentEl);
    }
  }
}

export function handleMentionDone(msg) {
  flushMentionStream();
  if (currentMentionEl) {
    var bar = currentMentionEl.querySelector(".mention-activity-bar");
    if (bar) bar.style.display = "none";
    // Remove stop button
    var stopBtn = currentMentionEl.querySelector(".mention-stop-btn");
    if (stopBtn) stopBtn.remove();
    // Add copy handler so user can "click to grab this"
    if (ctx.addCopyHandler && mentionFullText) {
      ctx.addCopyHandler(currentMentionEl, mentionFullText);
    }
  }
  currentMentionEl = null;
  activeMentionMeta = null;
  mentionFullText = "";
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleMentionError(msg) {
  flushMentionStream();
  if (currentMentionEl) {
    var bar = currentMentionEl.querySelector(".mention-activity-bar");
    if (bar) bar.style.display = "none";
    var stopBtn = currentMentionEl.querySelector(".mention-stop-btn");
    if (stopBtn) stopBtn.remove();
    var contentEl = currentMentionEl.querySelector(".mention-content");
    if (contentEl) {
      contentEl.innerHTML = '<div class="mention-error">Error: ' + escapeHtml(msg.error || "Unknown error") + '</div>';
    }
  }
  currentMentionEl = null;
  activeMentionMeta = null;
  mentionFullText = "";
}

// --- Helpers ---
function isMateDm() {
  return document.body.classList.contains("mate-dm-active");
}

function isWideView() {
  return document.body.classList.contains("wide-view");
}

function isDmLayout() {
  return isMateDm() || isWideView();
}

function getMyAvatarSrc() {
  if (document.body.dataset.myAvatarUrl) return document.body.dataset.myAvatarUrl;
  var myUser = (store.get('cachedAllUsers') || []).find(function (u) { return u.id === store.get('myUserId'); });
  return userAvatarUrl(myUser || {}, 36);
}

function getMyDisplayName() {
  if (document.body.dataset.myDisplayName) return document.body.dataset.myDisplayName;
  var myUser = (store.get('cachedAllUsers') || []).find(function (u) { return u.id === store.get('myUserId'); });
  return (myUser && (myUser.displayName || myUser.username)) || "Me";
}

function timeStr() {
  var now = new Date();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}

function buildMentionAvatarUrl(meta) {
  return mateAvatarUrl({
    id: meta.mateId,
    profile: {
      avatarStyle: meta.avatarStyle || "imprint",
      avatarSeed: meta.avatarSeed || meta.mateId,
      avatarColor: meta.avatarColor || "#5857fc",
      avatarCustom: meta.avatarCustom || "",
    },
  }, 36);
}

function buildUserAvatarUrlFromEntry(entry, who) {
  // who = "from" | "target"
  var seed = entry[who + "AvatarSeed"] || entry[who === "from" ? "fromName" : "targetName"] || entry[who === "from" ? "from" : "targetUserId"];
  return userAvatarUrl({
    id: entry[who === "from" ? "from" : "targetUserId"],
    avatarStyle: entry[who + "AvatarStyle"] || "imprint",
    avatarSeed: seed || "user",
    avatarColor: entry[who + "AvatarColor"] || "#5857fc",
    avatarCustom: entry[who + "AvatarCustom"] || "",
  }, 36);
}

// Render a user-to-user @mention bubble (live receive AND history replay).
// Shape mirrors renderMentionUser (the user-side @mate render) but tags the
// target user explicitly so it's clear who the side conversation is between.
// `entry` shape:
//   { type: "user_mention", from, fromName, targetUserId, targetName,
//     targetUsername?, targetAvatarStyle?, targetAvatarSeed?,
//     text, pastes?, images?, _ts? }
export function renderUserMention(entry) {
  var div = document.createElement("div");
  div.className = "msg-user msg-user-mention";

  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dir = "auto";

  // Images
  if (entry.images && entry.images.length > 0) {
    var imgRow = document.createElement("div");
    imgRow.className = "bubble-images";
    for (var ii = 0; ii < entry.images.length; ii++) {
      var img = document.createElement("img");
      if (entry.images[ii].url) {
        img.src = entry.images[ii].url;
      } else if (entry.images[ii].data) {
        img.src = "data:" + entry.images[ii].mediaType + ";base64," + entry.images[ii].data;
      }
      img.loading = "lazy";
      img.className = "bubble-img";
      img.addEventListener("click", function () {
        if (ctx.showImageModal) ctx.showImageModal(this.src);
      });
      img.addEventListener("error", function () {
        var placeholder = document.createElement("div");
        placeholder.className = "bubble-img-expired";
        placeholder.textContent = "Image deleted";
        this.parentNode.replaceChild(placeholder, this);
      });
      imgRow.appendChild(img);
    }
    bubble.appendChild(imgRow);
  }

  // Pastes
  if (entry.pastes && entry.pastes.length > 0) {
    var pasteRow = document.createElement("div");
    pasteRow.className = "bubble-pastes";
    for (var pi = 0; pi < entry.pastes.length; pi++) {
      (function (pasteText) {
        var chip = document.createElement("div");
        chip.className = "bubble-paste";
        var preview = pasteText.substring(0, 60).replace(/\n/g, " ");
        if (pasteText.length > 60) preview += "...";
        chip.innerHTML = '<span class="bubble-paste-preview">' + escapeHtml(preview) + '</span><span class="bubble-paste-label">PASTED</span>';
        chip.addEventListener("click", function (e) {
          e.stopPropagation();
          if (ctx.showPasteModal) ctx.showPasteModal(pasteText);
        });
        pasteRow.appendChild(chip);
      })(entry.pastes[pi]);
    }
    bubble.appendChild(pasteRow);
  }

  var targetName = entry.targetName || "user";
  var fromName = entry.fromName || "Someone";
  var textEl = document.createElement("span");
  textEl.innerHTML =
    '<span class="mention-chip mention-chip-user">@' + escapeHtml(targetName) + '</span> ' +
    escapeHtml(entry.text || "");
  bubble.appendChild(textEl);

  // Sender avatar (from)
  var avi = document.createElement("img");
  avi.className = "dm-bubble-avatar dm-bubble-avatar-me";
  avi.src = buildUserAvatarUrlFromEntry(entry, "from");
  div.appendChild(avi);

  var contentWrap = document.createElement("div");
  contentWrap.className = "dm-bubble-content";

  var header = document.createElement("div");
  header.className = "dm-bubble-header";
  var nameSpan = document.createElement("span");
  nameSpan.className = "dm-bubble-name";
  nameSpan.textContent = fromName;
  header.appendChild(nameSpan);

  var sideTag = document.createElement("span");
  sideTag.className = "mention-badge mention-badge-user";
  sideTag.textContent = "@" + targetName.toUpperCase();
  sideTag.title = "Side conversation with " + targetName + ". The coding agent will see this on the next message.";
  header.appendChild(sideTag);

  var ts = document.createElement("span");
  ts.className = "dm-bubble-time";
  ts.textContent = timeStr();
  header.appendChild(ts);

  contentWrap.appendChild(header);
  contentWrap.appendChild(bubble);
  div.appendChild(contentWrap);

  if (ctx.addToMessages) ctx.addToMessages(div);
  else if (ctx.messagesEl) ctx.messagesEl.appendChild(div);
  refreshIcons();
}

// --- History replay: render saved mention entries ---
export function renderMentionUser(entry) {
  // Render user message with @mention indicator
  var div = document.createElement("div");
  div.className = "msg-user";

  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.dir = "auto";

  // Render images (same pattern as addUserMessage in app.js)
  if (entry.images && entry.images.length > 0) {
    var imgRow = document.createElement("div");
    imgRow.className = "bubble-images";
    for (var ii = 0; ii < entry.images.length; ii++) {
      var img = document.createElement("img");
      if (entry.images[ii].url) {
        img.src = entry.images[ii].url;
      } else if (entry.images[ii].data) {
        img.src = "data:" + entry.images[ii].mediaType + ";base64," + entry.images[ii].data;
      }
      img.loading = "lazy";
      img.className = "bubble-img";
      img.addEventListener("click", function () {
        if (ctx.showImageModal) ctx.showImageModal(this.src);
      });
      img.addEventListener("error", function () {
        var placeholder = document.createElement("div");
        placeholder.className = "bubble-img-expired";
        placeholder.textContent = "Image deleted";
        this.parentNode.replaceChild(placeholder, this);
      });
      imgRow.appendChild(img);
    }
    bubble.appendChild(imgRow);
  }

  // Render pastes
  if (entry.pastes && entry.pastes.length > 0) {
    var pasteRow = document.createElement("div");
    pasteRow.className = "bubble-pastes";
    for (var pi = 0; pi < entry.pastes.length; pi++) {
      (function (pasteText) {
        var chip = document.createElement("div");
        chip.className = "bubble-paste";
        var preview = pasteText.substring(0, 60).replace(/\n/g, " ");
        if (pasteText.length > 60) preview += "...";
        chip.innerHTML = '<span class="bubble-paste-preview">' + escapeHtml(preview) + '</span><span class="bubble-paste-label">PASTED</span>';
        chip.addEventListener("click", function (e) {
          e.stopPropagation();
          if (ctx.showPasteModal) ctx.showPasteModal(pasteText);
        });
        pasteRow.appendChild(chip);
      })(entry.pastes[pi]);
    }
    bubble.appendChild(pasteRow);
  }

  var textEl = document.createElement("span");
  textEl.innerHTML = '<span class="mention-chip">@' + escapeHtml(entry.mateName || "Mate") + '</span> ' + escapeHtml(entry.text || "");
  bubble.appendChild(textEl);

  // Always render avatar + header structure (CSS controls visibility)
  var avi = document.createElement("img");
  avi.className = "dm-bubble-avatar dm-bubble-avatar-me";
  avi.src = getMyAvatarSrc();
  div.appendChild(avi);

  var contentWrap = document.createElement("div");
  contentWrap.className = "dm-bubble-content";

  var header = document.createElement("div");
  header.className = "dm-bubble-header";
  var nameSpan = document.createElement("span");
  nameSpan.className = "dm-bubble-name";
  nameSpan.textContent = getMyDisplayName();
  header.appendChild(nameSpan);
  var ts = document.createElement("span");
  ts.className = "dm-bubble-time";
  ts.textContent = timeStr();
  header.appendChild(ts);
  contentWrap.appendChild(header);
  contentWrap.appendChild(bubble);
  div.appendChild(contentWrap);

  // Action bar below bubble (same as regular user messages)
  var actions = document.createElement("div");
  actions.className = "msg-actions";
  var ts2 = timeStr();
  actions.innerHTML =
    '<span class="msg-action-time">' + ts2 + '</span>' +
    '<button class="msg-action-btn msg-action-copy" type="button" title="Copy">' + iconHtml("copy") + '</button>' +
    '<button class="msg-action-btn msg-action-fork" type="button" title="Fork">' + iconHtml("git-branch") + '</button>' +
    (((store.get('vendorCapabilities') || {}).rewind !== false) ? '<button class="msg-action-btn msg-action-rewind msg-user-rewind-btn" type="button" title="Rewind">' + iconHtml("rotate-ccw") + '</button>' : '') +
    '<button class="msg-action-btn msg-action-hidden msg-action-edit" type="button" title="Edit">' + iconHtml("pencil") + '</button>';
  div.appendChild(actions);

  // Copy handler
  var rawText = (entry.mateName ? "@" + entry.mateName + " " : "") + (entry.text || "");
  actions.querySelector(".msg-action-copy").addEventListener("click", function () {
    var self = this;
    copyToClipboard(rawText);
    self.innerHTML = iconHtml("check");
    refreshIcons();
    setTimeout(function () { self.innerHTML = iconHtml("copy"); refreshIcons(); }, 1200);
  });

  if (ctx.addToMessages) ctx.addToMessages(div);
  else if (ctx.messagesEl) ctx.messagesEl.appendChild(div);
  refreshIcons();
}

export function renderMentionResponse(entry) {
  var avatarSrc = buildMentionAvatarUrl(entry);

  // DM-style message layout (Mate DM or Wide view)
  if (isDmLayout()) {
    var el = document.createElement("div");
    el.className = "msg-assistant msg-mention-dm";

    var avi = document.createElement("img");
    avi.className = "dm-bubble-avatar dm-bubble-avatar-mate";
    avi.src = avatarSrc;
    el.appendChild(avi);

    var contentWrap = document.createElement("div");
    contentWrap.className = "dm-bubble-content";

    var header = document.createElement("div");
    header.className = "dm-bubble-header";
    var nameSpan = document.createElement("span");
    nameSpan.className = "dm-bubble-name";
    nameSpan.style.color = entry.avatarColor || "#5857fc";
    nameSpan.textContent = entry.mateName || "Mate";
    header.appendChild(nameSpan);

    var badge = document.createElement("span");
    badge.className = "mention-badge";
    badge.textContent = "@MENTION";
    header.appendChild(badge);

    var ts = document.createElement("span");
    ts.className = "dm-bubble-time";
    ts.textContent = timeStr();
    header.appendChild(ts);
    contentWrap.appendChild(header);

    var contentDiv = document.createElement("div");
    contentDiv.className = "md-content mention-content";
    contentDiv.dir = "auto";
    contentDiv.innerHTML = renderMarkdown(entry.text || "");
    highlightCodeBlocks(contentDiv);
    contentWrap.appendChild(contentDiv);
    el.appendChild(contentWrap);

    if (ctx.addToMessages) ctx.addToMessages(el);
    else if (ctx.messagesEl) ctx.messagesEl.appendChild(el);
  } else {
    // Project chat: use mention block style
    var el = document.createElement("div");
    el.className = "msg-mention";
    el.style.setProperty("--mention-color", entry.avatarColor || "#5857fc");

    var mheader = document.createElement("div");
    mheader.className = "mention-header";

    var avatar = document.createElement("img");
    avatar.className = "mention-avatar";
    avatar.src = avatarSrc;
    avatar.width = 20;
    avatar.height = 20;
    mheader.appendChild(avatar);

    var mname = document.createElement("span");
    mname.className = "mention-name";
    mname.textContent = entry.mateName || "Mate";
    mheader.appendChild(mname);

    el.appendChild(mheader);

    var contentDiv = document.createElement("div");
    contentDiv.className = "md-content mention-content";
    contentDiv.dir = "auto";
    contentDiv.innerHTML = renderMarkdown(entry.text || "");
    highlightCodeBlocks(contentDiv);
    el.appendChild(contentDiv);

    if (ctx.addToMessages) ctx.addToMessages(el);
    else if (ctx.messagesEl) ctx.messagesEl.appendChild(el);
  }

  // Add copy handler
  if (ctx.addCopyHandler && entry.text) {
    ctx.addCopyHandler(el, entry.text);
  }
}
