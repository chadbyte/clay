import { iconHtml, refreshIcons } from './icons.js';
import { setRewindMode, isRewindMode } from './rewind.js';

var ctx;

// --- State ---
var pendingImages = []; // [{data: base64, mediaType: "image/png"}]
var pendingPastes = []; // [{text: string, preview: string}]
var slashActiveIdx = -1;
var slashFiltered = [];
var isComposing = false;
var isRemoteInput = false;

export var builtinCommands = [
  { name: "clear", desc: "Clear conversation" },
  { name: "context", desc: "Context window usage" },
  { name: "rewind", desc: "Toggle rewind mode" },
  { name: "usage", desc: "Toggle usage panel" },
  { name: "status", desc: "Process status and resource usage" },
];

// --- Send ---
export function sendMessage() {
  var text = ctx.inputEl.value.trim();
  var images = pendingImages.slice();
  if (!text && images.length === 0 && pendingPastes.length === 0) return;
  hideSlashMenu();

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

  var pastes = pendingPastes.map(function (p) { return p.text; });
  ctx.addUserMessage(text, images.length > 0 ? images : null, pastes.length > 0 ? pastes : null);

  var payload = { type: "message", text: text || "" };
  if (images.length > 0) {
    payload.images = images;
  }
  if (pastes.length > 0) {
    payload.pastes = pastes;
  }
  ctx.ws.send(JSON.stringify(payload));

  ctx.inputEl.value = "";
  sendInputSync();
  clearPendingImages();
  autoResize();
  updateSendBtnVisibility();
  ctx.inputEl.focus();
}

export function autoResize() {
  ctx.inputEl.style.height = "auto";
  ctx.inputEl.style.height = Math.min(ctx.inputEl.scrollHeight, 120) + "px";
}

/**
 * Show/hide send button based on whether input has content.
 * When processing (stop mode), always show.
 */
export function updateSendBtnVisibility() {
  if (!ctx.sendBtn) return;
  var hasContent = ctx.inputEl.value.trim().length > 0;
  var isStopMode = ctx.sendBtn.classList.contains("stop");
  if (hasContent || isStopMode) {
    ctx.sendBtn.classList.remove("hidden-empty");
  } else {
    ctx.sendBtn.classList.add("hidden-empty");
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
function insertTextAtCursor(text) {
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
  renderInputPreviews();
}

function removePendingPaste(idx) {
  pendingPastes.splice(idx, 1);
  renderInputPreviews();
}

function renderInputPreviews() {
  var bar = ctx.imagePreviewBar;
  bar.innerHTML = "";
  if (pendingImages.length === 0 && pendingPastes.length === 0) {
    bar.classList.remove("visible");
    return;
  }
  bar.classList.add("visible");

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

  // Pasted content chips
  for (var j = 0; j < pendingPastes.length; j++) {
    (function (idx) {
      var chip = document.createElement("div");
      chip.className = "pasted-chip";
      var preview = document.createElement("span");
      preview.className = "pasted-chip-preview";
      preview.textContent = pendingPastes[idx].preview;
      var label = document.createElement("span");
      label.className = "pasted-chip-label";
      label.textContent = "PASTED";
      var removeBtn = document.createElement("button");
      removeBtn.className = "pasted-chip-remove";
      removeBtn.innerHTML = iconHtml("x");
      removeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        removePendingPaste(idx);
      });
      chip.appendChild(preview);
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      bar.appendChild(chip);
    })(j);
  }

  refreshIcons();
}

var MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
var RESIZE_MAX_DIM = 1920;
var RESIZE_QUALITY = 0.85;

function readImageBlob(blob) {
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
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "input_sync", text: ctx.inputEl.value }));
  }
}

export function handleInputSync(text) {
  isRemoteInput = true;
  ctx.inputEl.value = text;
  autoResize();
  updateSendBtnVisibility();
  isRemoteInput = false;
}

// --- Attach menu ---
var attachMenuOpen = false;

function toggleAttachMenu() {
  var menu = document.getElementById("attach-menu");
  if (!menu) return;
  attachMenuOpen = !attachMenuOpen;
  menu.classList.toggle("hidden", !attachMenuOpen);
}

function closeAttachMenu() {
  var menu = document.getElementById("attach-menu");
  if (menu) menu.classList.add("hidden");
  attachMenuOpen = false;
}

function createFileInput(accept, capture, multiple) {
  var input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  if (capture) input.setAttribute("capture", capture);
  if (multiple) input.multiple = true;
  input.style.display = "none";
  document.body.appendChild(input);

  input.addEventListener("change", function () {
    if (input.files) {
      for (var i = 0; i < input.files.length; i++) {
        if (input.files[i].type.indexOf("image/") === 0) {
          readImageBlob(input.files[i]);
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

  // Attach button
  var isTouchDevice = "ontouchstart" in window;
  var attachBtn = document.getElementById("attach-btn");
  if (attachBtn) {
    attachBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      // Desktop: skip menu, open file picker directly
      if (!isTouchDevice) {
        createFileInput("image/*", null, true);
        return;
      }
      toggleAttachMenu();
    });
  }

  var cameraBtn = document.getElementById("attach-camera");
  if (cameraBtn) {
    cameraBtn.addEventListener("click", function () {
      closeAttachMenu();
      createFileInput("image/*", "environment");
    });
  }

  var photosBtn = document.getElementById("attach-photos");
  if (photosBtn) {
    photosBtn.addEventListener("click", function () {
      closeAttachMenu();
      createFileInput("image/*", null, true);
    });
  }

  // Close attach menu when clicking outside
  document.addEventListener("click", function (e) {
    if (attachMenuOpen) {
      var wrap = document.getElementById("attach-wrap");
      if (wrap && !wrap.contains(e.target)) {
        closeAttachMenu();
      }
    }
  });

  // Paste handler
  document.addEventListener("paste", function (e) {
    var cd = e.clipboardData;
    if (!cd) return;

    var found = false;

    // Try clipboardData.files first (better Safari/iOS support)
    if (cd.files && cd.files.length > 0) {
      for (var i = 0; i < cd.files.length; i++) {
        if (cd.files[i].type.indexOf("image/") === 0) {
          found = true;
          readImageBlob(cd.files[i]);
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
        var preview = pastedText.substring(0, 50).replace(/\n/g, " ");
        if (pastedText.length > 50) preview += "...";
        pendingPastes.push({ text: pastedText, preview: preview });
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
    updateSendBtnVisibility();
    var val = ctx.inputEl.value;
    if (val.startsWith("/") && !val.includes(" ") && val.length > 1) {
      showSlashMenu(val.substring(1));
    } else if (val === "/") {
      showSlashMenu("");
    } else {
      hideSlashMenu();
    }
  });

  ctx.inputEl.addEventListener("compositionstart", function () { isComposing = true; });
  ctx.inputEl.addEventListener("compositionend", function () { isComposing = false; });

  ctx.inputEl.addEventListener("keydown", function (e) {
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
      sendMessage();
    }
  });

  // Mobile: switch enterkeyhint to "enter" so keyboard shows return key
  if ("ontouchstart" in window) {
    ctx.inputEl.setAttribute("enterkeyhint", "enter");
  }

  // Send/Stop button
  ctx.sendBtn.addEventListener("click", function () {
    if (ctx.processing && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "stop" }));
      return;
    }
    sendMessage();
  });
  ctx.sendBtn.addEventListener("dblclick", function (e) { e.preventDefault(); });

  // Hide send button initially (no input yet)
  updateSendBtnVisibility();
}
