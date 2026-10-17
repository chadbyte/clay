import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { captureSessionAction, sessionActionCurrent } from './pane-binding.js';

var ctx;
var rewindMode = false;
var pendingRewindUuid = null;
var rewindPreviewInFlight = false;
var rewindExecuting = false;
var rewindBannerEl = null;
var rewindScrollHandler = null;
var rewindModal, rewindSummary, rewindFilesList, rewindConfirmBtn, rewindCancelBtn, rewindModeOptions;
var cachedPreview = null;

export function setRewindMode(on) {
  rewindMode = on;
  var appEl = ctx.$("app");
  if (on) {
    appEl.classList.add("rewind-mode");
    if (!rewindBannerEl) {
      rewindBannerEl = document.createElement("div");
      rewindBannerEl.className = "rewind-mode-banner";
      rewindBannerEl.innerHTML =
        '<i data-lucide="rotate-ccw"></i>' +
        '<span class="rewind-banner-text">Select a message to rewind to</span>' +
        '<button class="rewind-exit-btn" title="Exit rewind mode"><i data-lucide="x"></i></button>';
      rewindBannerEl.querySelector(".rewind-exit-btn").addEventListener("click", function() {
        setRewindMode(false);
      });
      ctx.$("app").appendChild(rewindBannerEl);
      refreshIcons();
    }
    buildRewindTimeline();
  } else {
    appEl.classList.remove("rewind-mode");
    if (rewindBannerEl) {
      rewindBannerEl.remove();
      rewindBannerEl = null;
    }
    removeRewindTimeline();
  }
}

export function isRewindMode() {
  return rewindMode;
}

export function getPendingRewindUuid() {
  return pendingRewindUuid;
}

export function clearPendingRewindUuid() {
  pendingRewindUuid = null;
}

export function onRewindComplete() {
  rewindExecuting = false;
  rewindPreviewInFlight = false;
  pendingRewindUuid = null;
}

export function onRewindError() {
  rewindExecuting = false;
  rewindPreviewInFlight = false;
}

function initiateRewind(uuid) {
  if (ctx.processing) {
    ctx.addSystemMessage("Cannot rewind while processing. Stop the current operation first.", true);
    return;
  }
  if (!uuid) {
    ctx.addSystemMessage("No rewind point found for this turn.", true);
    return;
  }
  if (rewindPreviewInFlight) {
    // Debounce: ignore clicks while a preview is already in flight
    return;
  }
  if (rewindExecuting) {
    ctx.addSystemMessage("Rewind already in progress.", true);
    return;
  }
  pendingRewindUuid = uuid;
  store.set({ rewindAction: captureSessionAction() });
  rewindPreviewInFlight = true;
  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({ type: "rewind_preview", uuid: uuid }));
  }
}

function getSelectedMode() {
  if (!rewindModeOptions) return "both";
  var checked = rewindModeOptions.querySelector('input[name="rewind-mode"]:checked');
  return checked ? checked.value : "both";
}

function updateSummaryForMode() {
  if (!cachedPreview) return;
  var mode = getSelectedMode();
  var fileCount = cachedPreview.fileCount;
  var insertions = cachedPreview.insertions;
  var deletions = cachedPreview.deletions;

  if (mode === "chat") {
    rewindSummary.textContent = "Conversation will be rewound. Files will not be changed.";
    rewindFilesList.style.display = "none";
  } else if (fileCount > 0) {
    var summary = fileCount + " file" + (fileCount !== 1 ? "s" : "") + " will be restored.";
    if (insertions || deletions) summary += " (+" + insertions + " / -" + deletions + " lines)";
    if (mode === "files") summary += " Conversation will not be changed.";
    rewindSummary.textContent = summary;
    rewindFilesList.style.display = "";
  } else {
    if (mode === "files") {
      rewindSummary.textContent = "No file changes to restore.";
    } else {
      rewindSummary.textContent = "No file changes to restore. Conversation will be rewound.";
    }
    rewindFilesList.style.display = "none";
  }
}

export function showRewindModal(data) {
  if (!sessionActionCurrent(store.get('rewindAction'))) return;
  rewindPreviewInFlight = false;

  // Ignore stale preview results that don't match current pending UUID
  if (data.uuid && pendingRewindUuid && data.uuid !== pendingRewindUuid) {
    return;
  }
  // Ignore if a rewind is already executing
  if (rewindExecuting) {
    return;
  }

  var p = data.preview || data;
  var filePaths = p.filesChanged || p.filePaths || p.files || [];
  var fileCount = filePaths.length;
  var insertions = p.insertions || 0;
  var deletions = p.deletions || 0;

  cachedPreview = { fileCount: fileCount, insertions: insertions, deletions: deletions };

  // Reset radio to default
  if (rewindModeOptions) {
    var defaultRadio = rewindModeOptions.querySelector('input[value="both"]');
    if (defaultRadio) defaultRadio.checked = true;
  }

  if (fileCount > 0) {
    var summary = fileCount + " file" + (fileCount !== 1 ? "s" : "") + " will be restored.";
    if (insertions || deletions) summary += " (+" + insertions + " / -" + deletions + " lines)";
    rewindSummary.textContent = summary;
  } else {
    rewindSummary.textContent = "No file changes to restore. Conversation will be rewound.";
  }

  var diffs = data.diffs || {};
  rewindFilesList.innerHTML = "";
  if (filePaths.length > 0) {
    rewindFilesList.style.display = "";
    for (var i = 0; i < filePaths.length; i++) {
      var fp = filePaths[i];
      var section = document.createElement("div");
      section.className = "rewind-file-section expanded";

      var header = document.createElement("div");
      header.className = "rewind-file-header";
      header.innerHTML = '<span class="rewind-file-chevron"><i data-lucide="chevron-right"></i></span>';

      var pathSpan = document.createElement("span");
      pathSpan.className = "rewind-file-path";
      pathSpan.textContent = fp;
      pathSpan.title = fp;
      header.appendChild(pathSpan);

      header.addEventListener("click", function(sec) {
        return function() { sec.classList.toggle("expanded"); };
      }(section));

      section.appendChild(header);

      var diffContainer = document.createElement("div");
      diffContainer.className = "rewind-file-diff";
      var diffText = diffs[fp];
      if (diffText) {
        diffContainer.appendChild(renderDiffPre(diffText));
      } else {
        var noDiff = document.createElement("div");
        noDiff.className = "rewind-no-diff";
        noDiff.textContent = "No diff available (file may be untracked)";
        diffContainer.appendChild(noDiff);
      }
      section.appendChild(diffContainer);

      rewindFilesList.appendChild(section);
    }
    refreshIcons();
  } else {
    rewindFilesList.style.display = "none";
  }

  rewindModal.classList.remove("hidden");
}

export function hideRewindModal() {
  rewindModal.classList.add("hidden");
  pendingRewindUuid = null;
  rewindPreviewInFlight = false;
}

export function renderDiffPre(text) {
  var pre = document.createElement("pre");
  pre.className = "diff-content";
  var lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var span = document.createElement("span");
    if (line.startsWith("@@")) {
      span.className = "diff-hunk";
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      span.className = "diff-file-header";
    } else if (line.startsWith("+")) {
      span.className = "diff-add";
    } else if (line.startsWith("-")) {
      span.className = "diff-del";
    } else {
      span.className = "diff-ctx";
    }
    span.textContent = line;
    pre.appendChild(span);
    if (i < lines.length - 1) pre.appendChild(document.createTextNode("\n"));
  }
  return pre;
}

// --- Rewind timeline ---
function buildRewindTimeline() {
  removeRewindTimeline();

  var userMsgs = ctx.messagesEl.querySelectorAll(".msg-user[data-uuid]");
  if (userMsgs.length === 0) return;

  var timeline = document.createElement("div");
  timeline.className = "rewind-timeline";
  timeline.id = "rewind-timeline";

  var track = document.createElement("div");
  track.className = "rewind-timeline-track";

  var viewport = document.createElement("div");
  viewport.className = "rewind-timeline-viewport";
  track.appendChild(viewport);

  for (var i = 0; i < userMsgs.length; i++) {
    var msg = userMsgs[i];
    var pct = userMsgs.length === 1 ? 50 : 6 + (i / (userMsgs.length - 1)) * 88;

    var bubble = msg.querySelector(".bubble");
    var msgText = bubble ? bubble.textContent.trim() : "";
    if (msgText.length > 18) msgText = msgText.substring(0, 18) + "\u2026";

    var marker = document.createElement("div");
    marker.className = "rewind-timeline-marker";
    marker.innerHTML = '<i data-lucide="message-square"></i><span class="marker-text">' + escapeHtml(msgText) + '</span>';
    marker.style.top = pct + "%";
    marker.dataset.uuid = msg.dataset.uuid;
    marker.dataset.offsetTop = msg.offsetTop;

    (function(targetMsg, markerEl) {
      markerEl.addEventListener("click", function() {
        targetMsg.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    })(msg, marker);

    track.appendChild(marker);
  }

  timeline.appendChild(track);

  // Position timeline to align with messages area
  var appEl = ctx.$("app");
  var titleBarEl = document.querySelector(".title-bar-content");
  var inputAreaEl = ctx.$("input-area");
  var appRect = appEl.getBoundingClientRect();
  var titleBarRect = titleBarEl ? titleBarEl.getBoundingClientRect() : { bottom: appRect.top };
  var inputRect = inputAreaEl.getBoundingClientRect();

  timeline.style.top = "4px";
  timeline.style.bottom = (appRect.bottom - inputRect.top + 4) + "px";

  appEl.appendChild(timeline);
  refreshIcons();

  rewindScrollHandler = function() { updateTimelineViewport(track, viewport); };
  ctx.messagesEl.addEventListener("scroll", rewindScrollHandler);
  updateTimelineViewport(track, viewport);
}

function updateTimelineViewport(track, viewport) {
  if (!track) return;
  var scrollH = ctx.messagesEl.scrollHeight;
  var viewH = ctx.messagesEl.clientHeight;
  if (scrollH <= viewH) {
    viewport.style.top = "0";
    viewport.style.height = "100%";
  } else {
    var viewTop = ctx.messagesEl.scrollTop / scrollH;
    var viewBot = (ctx.messagesEl.scrollTop + viewH) / scrollH;
    viewport.style.top = (viewTop * 100) + "%";
    viewport.style.height = ((viewBot - viewTop) * 100) + "%";
  }

  var markers = track.querySelectorAll(".rewind-timeline-marker");
  var vTop = ctx.messagesEl.scrollTop;
  var vBot = vTop + viewH;

  for (var i = 0; i < markers.length; i++) {
    var msgTop = parseInt(markers[i].dataset.offsetTop, 10);
    if (msgTop >= vTop && msgTop <= vBot) {
      markers[i].classList.add("in-view");
    } else {
      markers[i].classList.remove("in-view");
    }
  }
}

function removeRewindTimeline() {
  var existing = document.getElementById("rewind-timeline");
  if (existing) existing.remove();
  if (rewindScrollHandler) {
    ctx.messagesEl.removeEventListener("scroll", rewindScrollHandler);
    rewindScrollHandler = null;
  }
}

export function addRewindButton(msgEl) {
  if (msgEl.querySelector(".msg-user-rewind-btn")) return;
  var btn = document.createElement("button");
  btn.className = "msg-user-rewind-btn";
  btn.type = "button";
  btn.title = "Rewind to here";
  btn.innerHTML = iconHtml("rotate-ccw");
  msgEl.appendChild(btn);
  refreshIcons();
}

export function initRewind(_ctx) {
  ctx = _ctx;

  rewindModal = ctx.$("rewind-modal");
  rewindSummary = ctx.$("rewind-summary");
  rewindFilesList = ctx.$("rewind-files-list");
  rewindConfirmBtn = ctx.$("rewind-confirm");
  rewindCancelBtn = ctx.$("rewind-cancel");
  rewindModeOptions = ctx.$("rewind-mode-options");

  // Update summary when rewind mode radio changes
  if (rewindModeOptions) {
    rewindModeOptions.addEventListener("change", updateSummaryForMode);
  }

  // Click on rewind icon to rewind
  ctx.messagesEl.addEventListener("click", function(e) {
    var btn = e.target.closest(".msg-user-rewind-btn");
    if (!btn) return;
    var msgEl = btn.closest(".msg-user[data-uuid]");
    if (msgEl) initiateRewind(msgEl.dataset.uuid);
  });

  rewindConfirmBtn.addEventListener("click", function() {
    if (!sessionActionCurrent(store.get('rewindAction'))) { hideRewindModal(); return; }
    if (rewindExecuting) return;
    if (pendingRewindUuid && ctx.ws && ctx.connected) {
      rewindExecuting = true;
      var mode = getSelectedMode();
      ctx.ws.send(JSON.stringify({ type: "rewind_execute", uuid: pendingRewindUuid, mode: mode }));
    }
    hideRewindModal();
  });

  rewindCancelBtn.addEventListener("click", hideRewindModal);
  rewindModal.querySelector(".confirm-backdrop").addEventListener("click", hideRewindModal);
}
