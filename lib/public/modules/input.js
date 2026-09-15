import { iconHtml, refreshIcons } from './icons.js';
import { setRewindMode, isRewindMode } from './rewind.js';
import { renderPicker as renderContextPicker } from './context-sources.js';
import { checkForMention, showMentionMenu, hideMentionMenu, isMentionMenuVisible, mentionMenuKeydown, setMentionAtIdx, parseMentionFromInput, clearMentionState, stickyReapplyMention, sendMention, sendUserMention, renderMentionUser, renderUserMention, removeMentionChip } from './mention.js';
import { store } from './store.js';
import { sendAcknowledgedMessage } from './message-delivery.js';
import { mateAvatarUrl } from './avatar.js';
import { tuiIsActive, tuiSubmitText } from './session-tui-view.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { showToast } from './utils.js';
import { isShellCommandMode, submitShellCommand } from './shell-command.js';
import { showPasteModal } from './paste-modal.js';
import { prepareAutonomousPayload } from './autonomous-run.js';

var ctx;

// --- State ---
var pendingImages = []; // [{data: base64, mediaType: "image/png"}]
var pendingPastes = []; // [{text: string, preview: string}]
var pendingFiles = []; // [{name: string, path: string}]
var uploadingCount = 0;
var slashActiveIdx = -1;
var slashFiltered = [];
var isComposing = false;
var isRemoteInput = false;
var scheduleDelayMs = 0; // 0 = no schedule, >0 = delay in ms
var _setScheduleDelayFn = null; // set by initInput

export function hasSendableContent() {
  return !!(
    (ctx && ctx.inputEl && ctx.inputEl.value.trim()) ||
    pendingPastes.length > 0 ||
    pendingImages.length > 0 ||
    pendingFiles.length > 0
  );
}

export function getScheduleDelay() {
  return scheduleDelayMs;
}

export function setScheduleDelayMs(ms) {
  scheduleDelayMs = ms;
  // Trigger visual update if initInput has been called
  if (_setScheduleDelayFn) _setScheduleDelayFn(ms);
}

export function clearScheduleDelay() {
  scheduleDelayMs = 0;
  var btn = document.getElementById("schedule-btn");
  if (btn) {
    btn.classList.remove("schedule-active", "schedule-expanded");
    var lbl = btn.querySelector(".schedule-delay-label");
    if (lbl) lbl.remove();
    var inp = btn.querySelector(".schedule-inline-input");
    if (inp) inp.remove();
    btn.title = "Schedule message";
  }
}

export function setScheduleBtnDisabled(disabled) {
  var btn = document.getElementById("schedule-btn");
  if (!btn) return;
  btn.disabled = disabled;
  if (disabled) {
    btn.style.opacity = "0.3";
    btn.style.pointerEvents = "none";
  } else {
    btn.style.opacity = "";
    btn.style.pointerEvents = "";
  }
}

export var builtinCommands = [
  { name: "clear", desc: "Clear conversation" },
  { name: "context", desc: "Context window usage" },
  { name: "rewind", desc: "Toggle rewind mode" },
  { name: "usage", desc: "Toggle usage panel" },
  { name: "status", desc: "Process status and resource usage" },
];

function commitVendorForTurn() {
  var committedVendor = store.get('currentVendor');
  var activeIndicator = document.getElementById("active-vendor-indicator");
  var activeIcon = document.getElementById("active-vendor-icon");
  if (committedVendor) {
    if (activeIndicator && activeIcon) {
      activeIcon.src = VENDOR_AVATARS[committedVendor] || VENDOR_AVATARS.claude;
      activeIcon.alt = VENDOR_NAMES[committedVendor] || VENDOR_NAMES.claude;
      activeIndicator.title = (VENDOR_NAMES[committedVendor] || VENDOR_NAMES.claude) + " session";
      activeIndicator.classList.remove("hidden");
    }
  }
  store.set({ vendorSelectionLocked: false, sessionHasHistory: true });
}

function showPreThinkingForTurn() {
  if (ctx.isMateDm && ctx.isMateDm()) {
    ctx.showMatePreThinking();
  } else if (ctx.showClaudePreThinking) {
    ctx.showClaudePreThinking();
  }
}

// --- Send ---
export function sendMessage() {
  // Debate ended mode intercept: route to resume handler
  if (ctx.isDebateEndedMode && ctx.isDebateEndedMode() && ctx.handleDebateEndedSend) {
    ctx.handleDebateEndedSend();
    return;
  }
  // Debate conclude mode intercept: route to conclude handler
  if (ctx.isDebateConcludeMode && ctx.isDebateConcludeMode() && ctx.handleDebateConcludeSend) {
    ctx.handleDebateConcludeSend();
    return;
  }
  // Debate floor mode intercept: route to floor response handler
  if (ctx.isDebateFloorMode && ctx.isDebateFloorMode() && ctx.handleDebateFloorSend) {
    ctx.handleDebateFloorSend();
    return;
  }
  if (isShellCommandMode()) {
    var shellText = ctx.inputEl.value.trim();
    if (!shellText || !submitShellCommand(shellText)) return;
    ctx.inputEl.value = "";
    sendInputSync();
    autoResize();
    return;
  }
  // DM mode intercept: if in DM mode, route to DM handler instead
  if (ctx.isDmMode && ctx.isDmMode() && ctx.handleDmSend) {
    ctx.handleDmSend();
    return;
  }
  var text = ctx.inputEl.value.trim();
  var images = pendingImages.slice();
  if (!text && images.length === 0 && pendingPastes.length === 0 && pendingFiles.length === 0) return;
  if (uploadingCount > 0) return; // wait for uploads to finish
  hideSlashMenu();
  if (ctx.hideSuggestionChips) ctx.hideSuggestionChips();

  // TUI session: on mobile the GUI composer stays visible so the native IME
  // can compose Korean/CJK (xterm's hidden textarea can't on mobile WebKit).
  // Forward the typed line straight to the PTY instead of the SDK message
  // path - no chat bubble, the terminal renders its own echo. Attached files
  // were uploaded to a path (uploadFile -> pendingFiles); the claude CLI
  // accepts file paths in the prompt, so append them (quoted if they contain
  // spaces). Pasted inline images have no path and aren't supported here.
  if (tuiIsActive()) {
    var tuiParts = [];
    if (text) tuiParts.push(text);
    for (var pf = 0; pf < pendingFiles.length; pf++) {
      var pfPath = pendingFiles[pf].path;
      if (pfPath) tuiParts.push(/\s/.test(pfPath) ? '"' + pfPath + '"' : pfPath);
    }
    tuiSubmitText(tuiParts.join(" "));
    ctx.inputEl.value = "";
    sendInputSync();
    clearPendingImages();
    autoResize();
    return;
  }

  if (text === "/clear") {
    ctx.inputEl.value = "";
    clearPendingImages();
    autoResize();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
    }
    return;
  }

  if (text === "/rewind") {
    ctx.inputEl.value = "";
    clearPendingImages();
    autoResize();
    if (ctx.messageUuidMap().length === 0) {
      ctx.addSystemMessage("No rewind points available in this session.", true);
    } else {
      setRewindMode(!isRewindMode());
    }
    return;
  }

  if (text === "/context") {
    ctx.inputEl.value = "";
    clearPendingImages();
    autoResize();
    if (ctx.toggleContextPanel) ctx.toggleContextPanel();
    return;
  }

  if (text === "/usage") {
    ctx.inputEl.value = "";
    clearPendingImages();
    autoResize();
    if (ctx.toggleUsagePanel) ctx.toggleUsagePanel();
    return;
  }

  if (text === "/status") {
    ctx.inputEl.value = "";
    clearPendingImages();
    autoResize();
    if (ctx.toggleStatusPanel) ctx.toggleStatusPanel();
    return;
  }

  if (!ctx.connected) {
    ctx.addSystemMessage("Not connected — message not sent.", true);
    return;
  }

  // Check for @mention: if a mate or user was selected, route to mention handler.
  // Exception: if we're in a DM with the same mate, send as regular message instead.
  // (User mentions never short-circuit to DM mode; user-to-user side conversations
  // are scoped to the active session, not pulled into DMs.)
  var mention = parseMentionFromInput(text);
  if (mention && mention.kind === "user") {
    hideMentionMenu();
    if (ctx.hideSuggestionChips) ctx.hideSuggestionChips();
    var uMentionImages = pendingImages.slice();
    var uMentionPastes = pendingPastes.map(function (p) { return p.text; });
    var uMentionFiles = pendingFiles.slice();
    var uMentionText = mention.text;
    if (uMentionFiles.length > 0) {
      var uFilePaths = uMentionFiles.map(function (f) { return "[Uploaded file: " + f.path + "]"; }).join("\n");
      uMentionText = uMentionText ? uFilePaths + "\n\n" + uMentionText : uFilePaths;
    }
    // Optimistic local render so the sender sees their own message immediately.
    // The server uses sendToSessionOthers, so this tab does not get a duplicate echo.
    var myUserId = ctx.myUserId ? ctx.myUserId() : null;
    var myDisplayName = ctx.myDisplayName ? ctx.myDisplayName() : "Me";
    renderUserMention({
      from: myUserId,
      fromName: myDisplayName,
      targetUserId: mention.userId,
      targetName: mention.mateName,
      text: uMentionText,
      images: uMentionImages.length > 0 ? uMentionImages : null,
      pastes: uMentionPastes.length > 0 ? uMentionPastes : null,
    });
    sendUserMention(mention.userId, uMentionText, uMentionPastes, uMentionImages);
    ctx.inputEl.value = "";
    stickyReapplyMention();
    sendInputSync();
    clearPendingImages();
    autoResize();
    ctx.inputEl.focus();
    return;
  }
  if (mention) {
    var dmMateId = ctx.getDmMateId ? ctx.getDmMateId() : null;
    if (dmMateId && dmMateId === mention.mateId) {
      // In DM with this mate — strip mention chip and send as normal message
      hideMentionMenu();
      removeMentionChip();
      text = mention.text;
      // Fall through to normal message send below
    } else {
      hideMentionMenu();
      if (ctx.hideSuggestionChips) ctx.hideSuggestionChips();
      var mentionImages = pendingImages.slice();
      var mentionPastes = pendingPastes.map(function (p) { return p.text; });
      // Prepend file paths to mention text (same pattern as regular messages)
      var mentionFiles = pendingFiles.slice();
      var mentionText = mention.text;
      if (mentionFiles.length > 0) {
        var mFilePaths = mentionFiles.map(function (f) { return "[Uploaded file: " + f.path + "]"; }).join("\n");
        mentionText = mentionText ? mFilePaths + "\n\n" + mentionText : mFilePaths;
      }
      // Render user message with mention chip (same as history replay)
      renderMentionUser({ mateName: mention.mateName, text: mentionText, images: mentionImages.length > 0 ? mentionImages : null, pastes: mentionPastes.length > 0 ? mentionPastes : null });
      sendMention(mention.mateId, mentionText, mentionPastes, mentionImages);
      ctx.inputEl.value = "";
      stickyReapplyMention();
      sendInputSync();
      clearPendingImages();
      autoResize();
      ctx.inputEl.focus();
      return;
    }
  }

  // Prepend file paths to text
  var files = pendingFiles.slice();
  if (files.length > 0) {
    var filePaths = files.map(function (f) { return "[Uploaded file: " + f.path + "]"; }).join("\n");
    text = text ? filePaths + "\n\n" + text : filePaths;
  }

  var pastes = pendingPastes.map(function (p) { return p.text; });

  // Scheduled message: queue message with timer delay
  if (scheduleDelayMs > 0) {
    var resetsAt = Date.now() + scheduleDelayMs;
    ctx.ws.send(JSON.stringify({ type: "schedule_message", text: text || "", resetsAt: resetsAt }));
    clearScheduleDelay();
    ctx.inputEl.value = "";
    sendInputSync();
    clearPendingImages();
    autoResize();
    ctx.inputEl.focus();
    return;
  }

  var payload = { type: "message", text: text || "" };
  if (images.length > 0) {
    payload.images = images;
  }
  if (pastes.length > 0) {
    payload.pastes = pastes;
  }
  // Include selected vendor for session binding (server uses on first message)
  var _selVendor = store.get("currentVendor") || null;
  if (_selVendor) payload.vendor = _selVendor;
  if (!prepareAutonomousPayload(payload)) return;
  ctx.currentMsgTs = Date.now();
  sendAcknowledgedMessage(payload);

  // A turn blocked on an unanswered tool-permission request looks like a
  // black hole: the new message queues silently while the dots keep
  // bouncing, so users re-send the same text (and both copies land once
  // the permission is answered). Point them at the pending card instead.
  var pendingPerm = document.querySelector("#messages .permission-container:not(.resolved)");
  if (pendingPerm) {
    pendingPerm.scrollIntoView({ behavior: "smooth", block: "center" });
    pendingPerm.classList.add("permission-attention");
    setTimeout(function () { pendingPerm.classList.remove("permission-attention"); }, 2600);
    showToast("A tool permission request is still waiting — your message is queued until you answer it.", "error");
  }

  ctx.inputEl.value = "";
  sendInputSync();
  clearPendingImages();
  autoResize();
  ctx.inputEl.focus();
  // Input cleared — switch back to stop mode if still processing
  if (ctx.processing && ctx.setSendBtnMode) {
    ctx.setSendBtnMode("stop");
  }
}

export function handleAcceptedOrdinaryMessage() {
  if (!ctx) return;
  commitVendorForTurn();
  showPreThinkingForTurn();
}

export function sendTextMessage(text) {
  if (!ctx || !ctx.inputEl || typeof text !== "string" || !text.trim()) return false;
  clearPendingImages();
  ctx.inputEl.value = text;
  sendMessage();
  return true;
}

export function sendShellResultToAgent(msg) {
  if (!ctx || !ctx.connected || !msg || msg.error || !msg.command) return false;
  if (String(msg.sessionId) !== String(store.get("activeSessionId"))) return false;
  var payload = {
    type: "message",
    text: "$ " + msg.command,
    shellCommandResponse: true,
  };
  var selectedVendor = store.get("currentVendor") || null;
  if (selectedVendor) payload.vendor = selectedVendor;
  ctx.ws.send(JSON.stringify(payload));
  commitVendorForTurn();
  showPreThinkingForTurn();
  return true;
}

export function autoResize() {
  ctx.inputEl.style.height = "auto";
  ctx.inputEl.style.height = Math.min(ctx.inputEl.scrollHeight, 120) + "px";
  // Defensive: sync send/stop button whenever input size changes
  if (ctx.processing && ctx.setSendBtnMode) {
    ctx.setSendBtnMode(hasSendableContent() ? "send" : "stop");
  }
}

// --- File path extraction from clipboard ---
function extractFilePaths(cd) {
  var paths = [];

  // 1. Check text/uri-list for file:// URIs (Finder on some browsers)
  var uriList = cd.getData("text/uri-list");
  if (uriList) {
    var lines = uriList.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line && !line.startsWith("#") && line.startsWith("file://")) {
        paths.push(decodeURIComponent(line.replace("file://", "")));
      }
    }
    if (paths.length > 0) return paths;
  }

  // 2. Check if text/plain looks like file path(s) while files are present
  //    (Finder Cmd+C puts filename in text/plain, Cmd+Option+C puts full path)
  if (cd.files && cd.files.length > 0) {
    var plainText = cd.getData("text/plain");
    if (plainText) {
      var textLines = plainText.split(/\r?\n/).filter(function (l) { return l.trim(); });
      for (var i = 0; i < textLines.length; i++) {
        var p = textLines[i].trim();
        if (p.startsWith("/") || p.startsWith("~")) {
          paths.push(p);
        }
      }
      if (paths.length > 0) return paths;
    }
    // 3. Fallback: files present but no path in text, use filenames
    for (var i = 0; i < cd.files.length; i++) {
      var f = cd.files[i];
      if (f.name && f.type.indexOf("image/") !== 0) {
        paths.push(f.name);
      }
    }
  }

  return paths;
}

// --- Insert text at cursor in textarea ---
export function insertTextAtCursor(text) {
  var el = ctx.inputEl;
  el.focus();
  var start = el.selectionStart;
  var end = el.selectionEnd;
  var before = el.value.substring(0, start);
  var after = el.value.substring(end);
  // Add space before if cursor is right after non-space text
  if (before.length > 0 && before[before.length - 1] !== " " && before[before.length - 1] !== "\n") {
    text = " " + text;
  }
  el.value = before + text + after;
  el.selectionStart = el.selectionEnd = start + text.length;
  autoResize();
  sendInputSync();
}

// --- Image paste ---
function addPendingImage(dataUrl) {
  var commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return;
  var header = dataUrl.substring(0, commaIdx);
  var data = dataUrl.substring(commaIdx + 1);
  var typeMatch = header.match(/data:(image\/[^;,]+)/);
  if (!typeMatch || !data) return;
  pendingImages.push({ mediaType: typeMatch[1], data: data });
  renderInputPreviews();
}

function removePendingImage(idx) {
  pendingImages.splice(idx, 1);
  renderInputPreviews();
}

export function clearPendingImages() {
  pendingImages = [];
  pendingPastes = [];
  pendingFiles = [];
  renderInputPreviews();
}

function removePendingPaste(idx) {
  pendingPastes.splice(idx, 1);
  renderInputPreviews();
}

function pastePreview(text) {
  var preview = text.substring(0, 50).replace(/\n/g, " ");
  if (text.length > 50) preview += "...";
  return preview;
}

function editPendingPaste(idx) {
  showPasteModal(pendingPastes[idx].text, function (text) {
    if (!text) {
      removePendingPaste(idx);
      return;
    }
    pendingPastes[idx] = { text: text, preview: pastePreview(text) };
    renderInputPreviews();
  });
}

function removePendingFile(idx) {
  pendingFiles.splice(idx, 1);
  renderInputPreviews();
}

function renderInputPreviews() {
  var bar = ctx.imagePreviewBar;
  bar.innerHTML = "";
  if (pendingImages.length === 0 && pendingPastes.length === 0 && pendingFiles.length === 0 && uploadingCount === 0) {
    bar.classList.remove("visible");
    return;
  }
  bar.classList.add("visible");
  // Hide any ghost suggestion as soon as attached content appears — Enter
  // must not silently swallow the user's paste/image/file.
  if (ctx && ctx.hideSuggestionChips) ctx.hideSuggestionChips();

  // Image thumbnails
  for (var i = 0; i < pendingImages.length; i++) {
    (function (idx) {
      var wrap = document.createElement("div");
      wrap.className = "image-preview-thumb";
      var img = document.createElement("img");
      img.src = "data:" + pendingImages[idx].mediaType + ";base64," + pendingImages[idx].data;
      img.addEventListener("click", function () {
        if (ctx.showImageModal) ctx.showImageModal(this.src);
      });
      var removeBtn = document.createElement("button");
      removeBtn.className = "image-preview-remove";
      removeBtn.innerHTML = iconHtml("x");
      removeBtn.addEventListener("click", function () {
        removePendingImage(idx);
      });
      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      bar.appendChild(wrap);
    })(i);
  }

  // File chips
  for (var fi = 0; fi < pendingFiles.length; fi++) {
    (function (idx) {
      var chip = document.createElement("div");
      chip.className = "file-chip";
      var icon = document.createElement("span");
      icon.className = "file-chip-icon";
      icon.innerHTML = iconHtml("file");
      var nameSpan = document.createElement("span");
      nameSpan.className = "file-chip-name";
      nameSpan.textContent = pendingFiles[idx].name;
      var removeBtn = document.createElement("button");
      removeBtn.className = "file-chip-remove";
      removeBtn.innerHTML = iconHtml("x");
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        removePendingFile(idx);
      });
      chip.appendChild(icon);
      chip.appendChild(nameSpan);
      chip.appendChild(removeBtn);
      bar.appendChild(chip);
    })(fi);
  }

  // Uploading indicator
  if (uploadingCount > 0) {
    var chip = document.createElement("div");
    chip.className = "file-chip file-chip-uploading";
    var spinner = document.createElement("span");
    spinner.className = "file-chip-spinner";
    var label = document.createElement("span");
    label.className = "file-chip-name";
    label.textContent = "Uploading" + (uploadingCount > 1 ? " (" + uploadingCount + ")" : "") + "...";
    chip.appendChild(spinner);
    chip.appendChild(label);
    bar.appendChild(chip);
  }

  // Pasted content chips
  for (var j = 0; j < pendingPastes.length; j++) {
    (function (idx) {
      var chip = document.createElement("div");
      chip.className = "pasted-chip";
      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "pasted-chip-open";
      openBtn.setAttribute("aria-label", "Edit pasted content");
      var preview = document.createElement("span");
      preview.className = "pasted-chip-preview";
      preview.textContent = pendingPastes[idx].preview;
      var label = document.createElement("span");
      label.className = "pasted-chip-label";
      label.textContent = "PASTED";
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "pasted-chip-remove";
      removeBtn.setAttribute("aria-label", "Remove pasted content");
      removeBtn.innerHTML = iconHtml("x");
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        removePendingPaste(idx);
      });
      openBtn.addEventListener("click", function () {
        editPendingPaste(idx);
      });
      openBtn.appendChild(preview);
      openBtn.appendChild(label);
      chip.appendChild(openBtn);
      chip.appendChild(removeBtn);
      bar.appendChild(chip);
    })(j);
  }

  refreshIcons();
}

var MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
var RESIZE_MAX_DIM = 1920;
var RESIZE_QUALITY = 0.85;
var MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

// --- File upload ---
function uploadFile(file) {
  // Clipboard blobs may have no name; synthesize one so the server can store
  // and name the file (the attach button passes real File objects).
  var uploadName = file.name || ("upload-" + Date.now());
  if (file.size > MAX_UPLOAD_BYTES) {
    if (ctx.addSystemMessage) ctx.addSystemMessage("File too large (max 50MB): " + uploadName, true);
    return;
  }
  uploadingCount++;
  renderInputPreviews();
  var reader = new FileReader();
  reader.onload = function (ev) {
    var dataUrl = ev.target.result;
    var commaIdx = dataUrl.indexOf(",");
    var b64 = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : "";

    var xhr = new XMLHttpRequest();
    xhr.open("POST", ctx.basePath + "api/upload");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      uploadingCount--;
      if (xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          pendingFiles.push({ name: resp.name || uploadName, path: resp.path });
        } catch (e) {}
      } else {
        if (ctx.addSystemMessage) ctx.addSystemMessage("Upload failed: " + uploadName, true);
      }
      renderInputPreviews();
      if (ctx.processing && ctx.setSendBtnMode) {
        ctx.setSendBtnMode(hasSendableContent() ? "send" : "stop");
      }
    };
    xhr.onerror = function () {
      uploadingCount--;
      if (ctx.addSystemMessage) ctx.addSystemMessage("Upload failed: " + uploadName, true);
      renderInputPreviews();
      if (ctx.processing && ctx.setSendBtnMode) {
        ctx.setSendBtnMode(hasSendableContent() ? "send" : "stop");
      }
    };
    xhr.send(JSON.stringify({ name: uploadName, data: b64 }));
  };
  reader.readAsDataURL(file);
}

function readImageBlob(blob) {
  // TUI sessions take file PATHS in the prompt, not inline base64 images.
  // Upload the image to a path (pendingFiles) so the typed line can reference
  // it; the claude CLI then reads the file. No client-side resize needed.
  if (tuiIsActive()) {
    uploadFile(blob);
    return;
  }
  var reader = new FileReader();
  reader.onload = function (ev) {
    var dataUrl = ev.target.result;
    // Check base64 payload size (~3/4 of base64 length)
    var commaIdx = dataUrl.indexOf(",");
    var b64 = commaIdx !== -1 ? dataUrl.substring(commaIdx + 1) : "";
    var estimatedBytes = b64.length * 0.75;

    if (estimatedBytes <= MAX_IMAGE_BYTES) {
      addPendingImage(dataUrl);
      return;
    }

    // Resize via canvas
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth;
      var h = img.naturalHeight;
      var scale = Math.min(RESIZE_MAX_DIM / Math.max(w, h), 1);
      var nw = Math.round(w * scale);
      var nh = Math.round(h * scale);
      var canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      var cx = canvas.getContext("2d");
      cx.drawImage(img, 0, 0, nw, nh);
      var resized = canvas.toDataURL("image/jpeg", RESIZE_QUALITY);
      addPendingImage(resized);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(blob);
}

// --- Slash menu ---
function getAllCommands() {
  return builtinCommands.concat(ctx.slashCommands());
}

function showSlashMenu(filter) {
  var query = filter.toLowerCase();
  slashFiltered = getAllCommands().filter(function (c) {
    return c.name.toLowerCase().indexOf(query) !== -1;
  });
  if (slashFiltered.length === 0) { hideSlashMenu(); return; }

  slashActiveIdx = 0;
  ctx.slashMenu.innerHTML = slashFiltered.map(function (c, i) {
    return '<div class="slash-item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '">' +
      '<span class="slash-cmd">/' + c.name + '</span>' +
      '<span class="slash-desc">' + c.desc + '</span>' +
      '</div>';
  }).join("");
  ctx.slashMenu.classList.add("visible");

  ctx.slashMenu.querySelectorAll(".slash-item").forEach(function (el) {
    el.addEventListener("click", function () {
      selectSlashItem(parseInt(el.dataset.idx));
    });
  });
}

export function hideSlashMenu() {
  ctx.slashMenu.classList.remove("visible");
  ctx.slashMenu.innerHTML = "";
  slashActiveIdx = -1;
  slashFiltered = [];
}

function selectSlashItem(idx) {
  if (idx < 0 || idx >= slashFiltered.length) return;
  var cmd = slashFiltered[idx];
  ctx.inputEl.value = "/" + cmd.name + " ";
  hideSlashMenu();
  autoResize();
  ctx.inputEl.focus();
}

function updateSlashHighlight() {
  ctx.slashMenu.querySelectorAll(".slash-item").forEach(function (el, i) {
    el.classList.toggle("active", i === slashActiveIdx);
  });
  var activeEl = ctx.slashMenu.querySelector(".slash-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
}

// --- Input sync across devices ---
function sendInputSync() {
  if (isRemoteInput) return;
  if (!ctx.ws || !ctx.connected) return;
  // In DM mode, send typing indicator instead of input_sync
  if (ctx.isDmMode && ctx.isDmMode()) {
    var hasText = ctx.inputEl.value.length > 0;
    var dk = ctx.getDmKey ? ctx.getDmKey() : null;
    if (dk) ctx.ws.send(JSON.stringify({ type: "dm_typing", dmKey: dk, typing: hasText }));
    return;
  }
  ctx.ws.send(JSON.stringify({ type: "input_sync", text: ctx.inputEl.value }));
}

export function handleInputSync(text) {
  isRemoteInput = true;
  ctx.inputEl.value = text;
  autoResize();
  isRemoteInput = false;
  // Sync send/stop button state
  if (ctx.processing && ctx.setSendBtnMode) {
    ctx.setSendBtnMode(hasSendableContent() ? "send" : "stop");
  }
}

function createFileInput(accept, capture, multiple) {
  var input = document.createElement("input");
  input.type = "file";
  if (accept) input.accept = accept;
  if (capture) input.setAttribute("capture", capture);
  if (multiple) input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", function () {
    if (input.files) {
      for (var i = 0; i < input.files.length; i++) {
        if (input.files[i].type.indexOf("image/") === 0) {
          readImageBlob(input.files[i]);
        } else {
          uploadFile(input.files[i]);
        }
      }
    }
    document.body.removeChild(input);
  });

  input.click();
}

// --- Init ---
export function initInput(_ctx) {
  ctx = _ctx;

  // File (clip) button — opens file picker for all types
  var attachFileBtn = document.getElementById("attach-file-btn");
  if (attachFileBtn) {
    attachFileBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      createFileInput(null, null, true);
    });
  }

  // Image button — opens image picker (OS handles camera/gallery choice)
  var attachImageBtn = document.getElementById("attach-image-btn");
  if (attachImageBtn) {
    attachImageBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      createFileInput("image/*", null, true);
    });
  }

  // Mobile "+" button -> unified bottom sheet with attach/image + context sources
  var moreBtn = document.getElementById("input-more-btn");
  var moreSheet = document.getElementById("input-more-sheet");
  function openMoreSheet() {
    if (!moreSheet) return;
    // Render context sources into mobile sheet containers
    try { renderContextPicker("-mobile"); } catch (e) {}
    moreSheet.classList.remove("hidden");
    requestAnimationFrame(function () { moreSheet.classList.add("open"); });
  }
  function closeMoreSheet() {
    if (!moreSheet) return;
    moreSheet.classList.remove("open");
    setTimeout(function () { moreSheet.classList.add("hidden"); }, 250);
  }
  if (moreBtn && moreSheet) {
    moreBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openMoreSheet();
    });
    var backdrop = moreSheet.querySelector(".input-more-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeMoreSheet);

    var moreAttach = document.getElementById("input-more-attach");
    if (moreAttach) moreAttach.addEventListener("click", function () {
      closeMoreSheet();
      createFileInput(null, null, true);
    });
    var moreImage = document.getElementById("input-more-image");
    if (moreImage) moreImage.addEventListener("click", function () {
      closeMoreSheet();
      createFileInput("image/*", null, true);
    });
  }

  // Schedule button — inline expand with minute input
  var scheduleBtn = document.getElementById("schedule-btn");
  var scheduleInlineInput = null;
  var scheduleInlineLabel = null;
  var scheduleOutsideHandler = null;

  function formatDelayLabel(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 60) return mins + "m";
    var hrs = Math.floor(mins / 60);
    var rem = mins % 60;
    return rem > 0 ? hrs + "h " + rem + "m" : hrs + "h";
  }

  function collapseScheduleBtn() {
    if (!scheduleBtn) return;
    scheduleBtn.classList.remove("schedule-expanded");
    if (scheduleInlineInput) { scheduleInlineInput.remove(); scheduleInlineInput = null; }
    if (scheduleInlineLabel) { scheduleInlineLabel.remove(); scheduleInlineLabel = null; }
    if (scheduleOutsideHandler) {
      document.removeEventListener("mousedown", scheduleOutsideHandler);
      scheduleOutsideHandler = null;
    }
  }

  function setScheduleDelay(ms) {
    scheduleDelayMs = ms;
    if (!scheduleBtn) return;
    collapseScheduleBtn();
    if (ms > 0) {
      scheduleBtn.classList.add("schedule-active", "schedule-expanded");
      scheduleBtn.title = "Scheduled: " + formatDelayLabel(ms) + " (click to clear)";
      scheduleInlineLabel = document.createElement("span");
      scheduleInlineLabel.className = "schedule-delay-label";
      scheduleInlineLabel.textContent = formatDelayLabel(ms);
      scheduleBtn.appendChild(scheduleInlineLabel);
    } else {
      scheduleBtn.classList.remove("schedule-active", "schedule-expanded");
      scheduleBtn.title = "Schedule message";
    }
  }
  _setScheduleDelayFn = setScheduleDelay;

  function expandScheduleInput() {
    if (!scheduleBtn) return;
    scheduleBtn.classList.add("schedule-expanded");
    scheduleInlineInput = document.createElement("input");
    scheduleInlineInput.type = "number";
    scheduleInlineInput.min = "1";
    scheduleInlineInput.max = "1440";
    scheduleInlineInput.placeholder = "min";
    scheduleInlineInput.className = "schedule-inline-input";
    scheduleBtn.appendChild(scheduleInlineInput);

    setTimeout(function () { scheduleInlineInput.focus(); }, 0);

    scheduleInlineInput.addEventListener("click", function (e) { e.stopPropagation(); });
    scheduleInlineInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var val = parseInt(scheduleInlineInput.value, 10);
        if (val >= 1 && val <= 1440) {
          setScheduleDelay(val * 60000);
        } else {
          collapseScheduleBtn();
        }
      } else if (e.key === "Escape") {
        collapseScheduleBtn();
      }
    });

    // Close on outside click
    setTimeout(function () {
      scheduleOutsideHandler = function (ev) {
        if (!scheduleBtn.contains(ev.target)) {
          if (scheduleInlineInput) {
            var val = parseInt(scheduleInlineInput.value, 10);
            if (val >= 1 && val <= 1440) {
              setScheduleDelay(val * 60000);
            } else {
              collapseScheduleBtn();
            }
          }
          document.removeEventListener("mousedown", scheduleOutsideHandler);
          scheduleOutsideHandler = null;
        }
      };
      document.addEventListener("mousedown", scheduleOutsideHandler);
    }, 0);
  }

  if (scheduleBtn) {
    scheduleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (scheduleDelayMs > 0) {
        setScheduleDelay(0);
        return;
      }
      if (scheduleInlineInput) {
        collapseScheduleBtn();
      } else {
        expandScheduleInput();
      }
    });
  }

  // Ask Mate button — insert @ to trigger mention menu
  var askMateBtn = document.getElementById("ask-mate-btn");
  if (askMateBtn) {
    askMateBtn.addEventListener("click", function () {
      var inputEl = document.getElementById("input");
      if (!inputEl) return;
      inputEl.focus();
      // Insert @ at cursor position
      var start = inputEl.selectionStart || 0;
      var end = inputEl.selectionEnd || 0;
      var val = inputEl.value;
      inputEl.value = val.substring(0, start) + "@" + val.substring(end);
      inputEl.selectionStart = inputEl.selectionEnd = start + 1;
      // Trigger the mention detection
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Mate avatar overlay on @ button.
    // The overlay is a quiet hint that you can @-mention a Mate for advice
    // on the current session. To keep it from feeling like constant motion
    // in the user's peripheral vision (see issue #325 item 2), the avatar
    // is picked once per session entry and does NOT rotate on a timer.
    // The avatar is rendered desaturated in CSS and only regains color on
    // hover, so the change moment itself stays visually quiet too.
    var _lastOverlayIdx = -1;

    function getAvailableMates() {
      var mates = store.get('cachedMatesList') || [];
      return mates.filter(function (m) { return m.status !== 'interviewing'; });
    }

    function pickNextMate(available) {
      if (available.length === 0) return null;
      if (available.length === 1) return available[0];
      var idx = Math.floor(Math.random() * available.length);
      if (idx === _lastOverlayIdx) idx = (idx + 1) % available.length;
      _lastOverlayIdx = idx;
      return available[idx];
    }

    function setOverlayAvatar(mate) {
      var img = askMateBtn.querySelector('.ask-mate-avatar');
      if (!mate) {
        if (img) img.remove();
        return;
      }
      var url = mateAvatarUrl(mate, 20);
      if (!img) {
        img = document.createElement('img');
        img.className = 'ask-mate-avatar fade-in';
        img.width = 20;
        img.height = 20;
        img.alt = '';
        img.src = url;
        askMateBtn.appendChild(img);
        return;
      }
      // Fade out, swap, fade in
      img.classList.remove('fade-in');
      img.classList.add('fade-out');
      setTimeout(function () {
        img.src = url;
        img.classList.remove('fade-out');
        img.classList.add('fade-in');
      }, 300);
    }

    function refreshMateOverlay() {
      var available = getAvailableMates();
      setOverlayAvatar(pickNextMate(available));
    }

    // Refresh on initial mate list load and on session transition only.
    store.subscribe(function (state, prev) {
      if (state.cachedMatesList !== prev.cachedMatesList) {
        refreshMateOverlay();
      } else if (state.activeSessionId !== prev.activeSessionId) {
        refreshMateOverlay();
      }
    });
  }

  // Paste handler
  document.addEventListener("paste", function (e) {
    // Don't intercept paste when typing in modals or other non-chat inputs
    var target = e.target;
    if (target && target.closest && target.closest(".sticky-note, #notes-archive, .confirm-modal, #paste-modal, .scheduler-detail, #debate-modal, .us-modal")) return;

    var cd = e.clipboardData;
    if (!cd) return;

    var found = false;

    // Try clipboardData.files first (better Safari/iOS support)
    if (cd.files && cd.files.length > 0) {
      for (var i = 0; i < cd.files.length; i++) {
        if (cd.files[i].type.indexOf("image/") === 0) {
          found = true;
          readImageBlob(cd.files[i]);
        } else if (cd.files[i].name) {
          found = true;
          uploadFile(cd.files[i]);
        }
      }
    }

    // Fall back to clipboardData.items
    if (!found && cd.items) {
      for (var i = 0; i < cd.items.length; i++) {
        if (cd.items[i].type.indexOf("image/") === 0) {
          var blob = cd.items[i].getAsFile();
          if (blob) {
            found = true;
            readImageBlob(blob);
          }
        } else if (cd.items[i].kind === "file") {
          var fileBlob = cd.items[i].getAsFile();
          if (fileBlob && fileBlob.name) {
            found = true;
            uploadFile(fileBlob);
          }
        }
      }
    }

    // File path paste: detect file:// URIs or Finder file references
    if (!found) {
      var filePaths = extractFilePaths(cd);
      if (filePaths.length > 0) {
        e.preventDefault();
        insertTextAtCursor(filePaths.join("\n"));
        found = true;
      }
    }

    // Long text paste → pasted chip
    if (!found) {
      var pastedText = cd.getData("text/plain");
      if (pastedText && pastedText.length >= 500) {
        e.preventDefault();
        pendingPastes.push({ text: pastedText, preview: pastePreview(pastedText) });
        renderInputPreviews();
        found = true;
      }
    }

    if (found) e.preventDefault();
  });

  // Input event handlers
  ctx.inputEl.addEventListener("input", function () {
    autoResize();
    sendInputSync();
    if (ctx.hideSuggestionChips) ctx.hideSuggestionChips();
    var val = ctx.inputEl.value;
    if (val.startsWith("/") && !val.includes(" ") && val.length > 1) {
      showSlashMenu(val.substring(1));
      hideMentionMenu();
    } else if (val === "/") {
      showSlashMenu("");
      hideMentionMenu();
    } else if (tuiIsActive()) {
      // TUI session: the composer is a plain conduit to the PTY. Mentions
      // (@mate) don't apply, so don't pop the menu on "@".
      hideSlashMenu();
      hideMentionMenu();
    } else {
      hideSlashMenu();
      // Check for @mention
      var mentionCheck = checkForMention(val, ctx.inputEl.selectionStart);
      if (mentionCheck.active) {
        setMentionAtIdx(mentionCheck.startIdx);
        showMentionMenu(mentionCheck.query);
      } else {
        hideMentionMenu();
      }
    }
    // Toggle send/stop button based on input content during processing
    if (ctx.processing && ctx.setSendBtnMode) {
      ctx.setSendBtnMode(hasSendableContent() ? "send" : "stop");
    }
  });

  ctx.inputEl.addEventListener("compositionstart", function () { isComposing = true; });
  ctx.inputEl.addEventListener("compositionend", function () { isComposing = false; });

  ctx.inputEl.addEventListener("keydown", function (e) {
    // @Mention menu keyboard navigation
    if (isMentionMenuVisible()) {
      if (mentionMenuKeydown(e)) return;
    }

    if (slashFiltered.length > 0 && ctx.slashMenu.classList.contains("visible")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx + 1) % slashFiltered.length;
        updateSlashHighlight();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashActiveIdx = (slashActiveIdx - 1 + slashFiltered.length) % slashFiltered.length;
        updateSlashHighlight();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectSlashItem(slashActiveIdx);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideSlashMenu();
        return;
      }
    }

    // Backspace on empty input: remove mention chip if present
    if (e.key === "Backspace" && ctx.inputEl.value === "" && document.getElementById("input-mention-chip")) {
      e.preventDefault();
      removeMentionChip();
      return;
    }

    // Ctrl+J: insert newline (like Claude CLI)
    if (e.key === "j" && e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      var ta = ctx.inputEl;
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      var val = ta.value;
      ta.value = val.substring(0, start) + "\n" + val.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      autoResize();
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
      // Mobile: Enter inserts newline, send via button only
      if ("ontouchstart" in window) {
        return;
      }
      e.preventDefault();
      // While Claude is processing and the user has nothing queued, Enter
      // must not adopt a ghost suggestion — pressing Enter while waiting
      // should be a no-op, not a send of a stale suggestion the user never
      // typed.
      if (ctx.processing && !hasSendableContent()) {
        return;
      }
      // If input has no sendable content but ghost suggestion is showing, adopt it.
      // Use hasSendableContent() instead of checking inputEl.value alone so that
      // pending images, pastes, or files block the ghost-text adoption — otherwise
      // pressing Enter with only a pasted image/block queued would send the
      // suggestion instead of the user's actual content.
      var ghost = ctx.getGhostSuggestion ? ctx.getGhostSuggestion() : "";
      if (!hasSendableContent() && ghost) {
        ctx.inputEl.value = ghost;
        if (ctx.hideSuggestionChips) ctx.hideSuggestionChips();
      }
      sendMessage();
    }
  });

  // Mobile: switch enterkeyhint to "enter" so keyboard shows return key
  if ("ontouchstart" in window) {
    ctx.inputEl.setAttribute("enterkeyhint", "enter");
  }

  // Send/Stop button — gate stop vs send on live state. If Claude is
  // processing and the user has nothing queued, the click is a Stop and
  // must not adopt a ghost suggestion. Otherwise it's a send.
  // (regression after #337 / 0753833)
  ctx.sendBtn.addEventListener("click", function () {
    if (ctx.processing && !hasSendableContent()) {
      if (ctx.connected) {
        ctx.ws.send(JSON.stringify({ type: "stop" }));
      }
      return;
    }
    // Adopt ghost suggestion if input is empty
    var ghost = ctx.getGhostSuggestion ? ctx.getGhostSuggestion() : "";
    if (!hasSendableContent() && ghost) {
      ctx.inputEl.value = ghost;
      if (ctx.hideSuggestionChips) ctx.hideSuggestionChips();
      sendMessage();
      return;
    }
    if (hasSendableContent()) {
      sendMessage();
      return;
    }
  });
  ctx.sendBtn.addEventListener("dblclick", function (e) { e.preventDefault(); });
}
