import { resetProjectDebateWorkspace } from './project-debate-workspace.js';
import { mateAvatarUrl } from './avatar.js';
import { renderMarkdown, highlightCodeBlocks, buildPrintHtml, getPrintCss } from './markdown.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

var ctx;

// --- State ---
var debateActive = false;
var debateTopic = "";
var debateRound = 0;
var debatePhase = "idle";  // idle | live | ended

// Current turn streaming state
var currentTurnEl = null;
var currentTurnMateId = null;
var turnFullText = "";
var turnStreamBuffer = "";
var turnDrainTimer = null;

// --- Init ---
export function initDebate(_ctx) {
  ctx = _ctx;

  var pdfBtn = document.getElementById("debate-pdf-btn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", function () {
      pdfBtn.disabled = true;
      exportDebateAsPdf().then(function () {
        pdfBtn.disabled = false;
      }).catch(function (err) {
        pdfBtn.disabled = false;
        console.error("Debate PDF export failed:", err);
      });
    });
  }
}

export function resetDebateState() {
  resetProjectDebateWorkspace();
  debateActive = false;
  debateTopic = "";
  debateRound = 0;
  debatePhase = "idle";
  flushTurnStream();
  currentTurnEl = null;
  currentTurnMateId = null;
  showPdfBtn(false);
  // Remove preparing indicator if present
  if (ctx && ctx.messagesEl) {
    var prep = ctx.messagesEl.querySelector(".debate-preparing-indicator");
    if (prep) prep.remove();
  }
}

function buildAvatarUrl(meta) {
  return mateAvatarUrl({
    id: meta.mateId,
    profile: {
      avatarStyle: meta.avatarStyle || "imprint",
      avatarSeed: meta.avatarSeed || meta.mateId || "mate",
      avatarColor: meta.avatarColor || "#5857fc",
      avatarCustom: meta.avatarCustom || "",
    },
  }, 32);
}

// --- Float info panel ---
function showDebateInfoFloat(msg) {
  var floatEl = document.getElementById("debate-info-float");
  if (!floatEl) return;

  var html = '<div class="debate-info-float-inner">';
  html += '<span class="debate-info-mod">' + iconHtml("mic") + ' ' + escapeHtml(msg.moderatorName || "Moderator") + '</span>';
  html += '<span class="debate-info-sep">|</span>';
  html += '<span class="debate-info-label">Panel:</span>';

  if (msg.panelists) {
    for (var i = 0; i < msg.panelists.length; i++) {
      var p = msg.panelists[i];
      if (i > 0) html += '<span class="debate-info-comma">,</span>';
      html += '<span class="debate-info-chip">';
      html += '<img class="debate-info-avatar" src="' + buildAvatarUrl(p) + '" width="14" height="14" />';
      html += '<span>' + escapeHtml(p.name || "") + '</span>';
      if (p.role) html += '<span class="debate-info-role">(' + escapeHtml(p.role) + ')</span>';
      html += '</span>';
    }
  }

  html += '</div>';
  floatEl.innerHTML = html;
  floatEl.classList.remove("hidden");
  refreshIcons();
}

function showPdfBtn(visible) {
  var btn = document.getElementById("debate-pdf-btn");
  if (btn) {
    if (visible) btn.classList.remove("hidden");
    else btn.classList.add("hidden");
  }
}

function hideDebateInfoFloat() {
  var floatEl = document.getElementById("debate-info-float");
  if (floatEl) {
    floatEl.classList.add("hidden");
    floatEl.innerHTML = "";
  }
}

// --- Handlers ---

export function handleDebateResumed(msg) {
  debateActive = true;
  debatePhase = "live";
  if (msg.topic) debateTopic = msg.topic;
  if (msg.round) debateRound = msg.round;

  // Show float info panel again if we have it
  showDebateInfoFloat(msg);
  showPdfBtn(true);
}

export function handleDebatePreparing(msg) {
  debatePhase = "preparing";

  if (!ctx.messagesEl) return;

  // Remove any existing preparing indicator
  var existing = ctx.messagesEl.querySelector(".debate-preparing-indicator");
  if (existing) existing.remove();

  var el = document.createElement("div");
  el.className = "debate-preparing-indicator";

  var moderatorName = msg.moderatorName || "Moderator";
  var panelistNames = (msg.panelists || []).map(function (p) { return p.name; }).filter(Boolean).join(", ");

  el.innerHTML =
    '<div class="debate-preparing-inner">' +
      '<div class="debate-preparing-spinner">' + iconHtml("loader") + '</div>' +
      '<div class="debate-preparing-text">' +
        '<strong>' + escapeHtml(moderatorName) + '</strong> is setting up the debate' +
        (panelistNames ? ' with <strong>' + escapeHtml(panelistNames) + '</strong>' : '') +
        '<span class="debate-preparing-dots">...</span>' +
      '</div>' +
    '</div>';

  ctx.messagesEl.appendChild(el);
  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateStarted(msg) {
  // Remove preparing indicator when debate goes live
  if (ctx.messagesEl) {
    var prep = ctx.messagesEl.querySelector(".debate-preparing-indicator");
    if (prep) prep.remove();
  }

  debateActive = true;
  debateTopic = msg.topic || "";
  debateRound = 1;
  debatePhase = "live";

  // Show float info panel
  showDebateInfoFloat(msg);
  showPdfBtn(true);

  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateTurn(msg) {
  debateRound = msg.round || debateRound;

  if (!ctx.messagesEl) return;

  var turnEl = document.createElement("div");
  turnEl.className = "debate-turn";

  // Speaker header
  var speakerRow = document.createElement("div");
  speakerRow.className = "debate-speaker";

  var avi = document.createElement("img");
  avi.className = "debate-speaker-avatar";
  avi.src = buildAvatarUrl(msg);
  avi.width = 24;
  avi.height = 24;
  speakerRow.appendChild(avi);

  var nameSpan = document.createElement("span");
  nameSpan.className = "debate-speaker-name";
  nameSpan.textContent = msg.mateName || "Speaker";
  speakerRow.appendChild(nameSpan);

  var roleSpan = document.createElement("span");
  roleSpan.className = "debate-speaker-role";
  roleSpan.textContent = msg.role || "";
  speakerRow.appendChild(roleSpan);

  turnEl.appendChild(speakerRow);

  // Activity indicator
  var activityDiv = document.createElement("div");
  activityDiv.className = "activity-inline debate-activity-bar";
  activityDiv.innerHTML =
    '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
    '<span class="activity-text">Thinking...</span>';
  turnEl.appendChild(activityDiv);

  // Content area
  var contentDiv = document.createElement("div");
  contentDiv.className = "md-content debate-turn-content";
  contentDiv.dir = "auto";
  turnEl.appendChild(contentDiv);

  ctx.messagesEl.appendChild(turnEl);

  // Set as current streaming target
  currentTurnEl = turnEl;
  currentTurnMateId = msg.mateId;
  turnFullText = "";
  turnStreamBuffer = "";

  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateActivity(msg) {
  if (!currentTurnEl || msg.mateId !== currentTurnMateId) return;

  var bar = currentTurnEl.querySelector(".debate-activity-bar");
  if (msg.activity) {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "activity-inline debate-activity-bar";
      bar.innerHTML =
        '<span class="activity-icon">' + iconHtml("sparkles") + '</span>' +
        '<span class="activity-text"></span>';
      var contentEl = currentTurnEl.querySelector(".debate-turn-content");
      if (contentEl) {
        currentTurnEl.insertBefore(bar, contentEl);
      } else {
        currentTurnEl.appendChild(bar);
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

export function handleDebateStream(msg) {
  if (!currentTurnEl || msg.mateId !== currentTurnMateId) return;

  // Hide activity bar on first text
  var bar = currentTurnEl.querySelector(".debate-activity-bar");
  if (bar) bar.style.display = "none";

  turnStreamBuffer += msg.delta;
  if (!turnDrainTimer) {
    turnDrainTimer = requestAnimationFrame(drainTurnStream);
  }
}

function drainTurnStream() {
  turnDrainTimer = null;
  if (!currentTurnEl || turnStreamBuffer.length === 0) return;

  var len = turnStreamBuffer.length;
  var n;
  if (len > 200) n = Math.ceil(len / 4);
  else if (len > 80) n = 8;
  else if (len > 30) n = 5;
  else if (len > 10) n = 2;
  else n = 1;

  var chunk = turnStreamBuffer.slice(0, n);
  turnStreamBuffer = turnStreamBuffer.slice(n);
  turnFullText += chunk;

  var contentEl = currentTurnEl.querySelector(".debate-turn-content");
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(turnFullText);
    highlightCodeBlocks(contentEl);
  }

  if (ctx.scrollToBottom) ctx.scrollToBottom();

  if (turnStreamBuffer.length > 0) {
    turnDrainTimer = requestAnimationFrame(drainTurnStream);
  }
}

function flushTurnStream() {
  if (turnDrainTimer) {
    cancelAnimationFrame(turnDrainTimer);
    turnDrainTimer = null;
  }
  if (turnStreamBuffer.length > 0) {
    turnFullText += turnStreamBuffer;
    turnStreamBuffer = "";
  }
  if (currentTurnEl) {
    var contentEl = currentTurnEl.querySelector(".debate-turn-content");
    if (contentEl) {
      contentEl.innerHTML = renderMarkdown(turnFullText);
      highlightCodeBlocks(contentEl);
    }
  }
}

export function handleDebateTurnDone(msg) {
  flushTurnStream();

  if (currentTurnEl) {
    var bar = currentTurnEl.querySelector(".debate-activity-bar");
    if (bar) bar.style.display = "none";
    if (ctx.addCopyHandler && turnFullText) {
      ctx.addCopyHandler(currentTurnEl, turnFullText);
    }
  }

  currentTurnEl = null;
  currentTurnMateId = null;
  turnFullText = "";
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateCommentQueued(msg) {
  if (!ctx.messagesEl) return;

  var commentEl = document.createElement("div");
  commentEl.className = "debate-user-comment";

  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("hand") + " You raised your hand:";

  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = msg.text || "";

  commentEl.appendChild(label);
  commentEl.appendChild(textEl);
  ctx.messagesEl.appendChild(commentEl);

  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function handleDebateCommentInjected(msg) {
  // Comment was delivered to moderator, no extra UI needed
}

export function handleDebateEnded(msg) {
  debateActive = false;
  debatePhase = "ended";

  flushTurnStream();
  currentTurnEl = null;
  currentTurnMateId = null;

  // Hide float info panel and PDF button
  hideDebateInfoFloat();
  showPdfBtn(false);

  // Ensure debate bottom bar is removed
  var bottomBar = document.getElementById("debate-bottom-bar");
  if (bottomBar) bottomBar.remove();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();

  // Render status line in messages area
  if (ctx.messagesEl) {
    var existing = ctx.messagesEl.querySelector(".debate-ended-status-line");
    if (existing) existing.remove();
    var statusLine = document.createElement("div");
    statusLine.className = "debate-ended-status-line";
    var reasonText = msg.reason === "natural" ? "Debate concluded" :
                     msg.reason === "user_stopped" ? "Debate stopped by user" :
                     "Debate ended due to error";
    statusLine.innerHTML = iconHtml("check-circle") + " " + escapeHtml(reasonText) + " (" + (msg.rounds || 0) + " rounds)";
    ctx.messagesEl.appendChild(statusLine);
    refreshIcons();
  }

  // Show ended mode: native input area with banner
  if (ctx.showDebateEndedMode) ctx.showDebateEndedMode(msg);

  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

function renderEndedBanner(entry) {
  if (!ctx.messagesEl) return;

  // Remove existing ended banner (prevent duplicates)
  var existing = ctx.messagesEl.querySelector(".debate-ended-banner");
  if (existing) existing.remove();

  var endBanner = document.createElement("div");
  endBanner.className = "debate-ended-banner";

  var reasonText = entry.reason === "natural" ? "Debate concluded" :
                   entry.reason === "user_stopped" ? "Debate stopped by user" :
                   "Debate ended due to error";

  var statusRow = document.createElement("div");
  statusRow.className = "debate-ended-status";
  statusRow.innerHTML = iconHtml("check-circle") + " " + escapeHtml(reasonText) + " (" + (entry.rounds || 0) + " rounds)";
  endBanner.appendChild(statusRow);

  // Resume row
  var resumeRow = document.createElement("div");
  resumeRow.className = "debate-ended-resume";

  var resumeInput = document.createElement("textarea");
  resumeInput.className = "debate-ended-resume-input";
  resumeInput.rows = 1;
  resumeInput.placeholder = "Continue with a new direction...";
  resumeRow.appendChild(resumeInput);

  var resumeBtn = document.createElement("button");
  resumeBtn.className = "debate-ended-resume-btn";
  resumeBtn.textContent = "Resume";
  resumeBtn.addEventListener("click", function () {
    var text = resumeInput.value.trim();
    if (ctx.ws && ctx.ws.readyState === 1) {
      ctx.ws.send(JSON.stringify({ type: "debate_conclude_response", action: "continue", text: text }));
    }
    endBanner.remove();
  });
  resumeRow.appendChild(resumeBtn);

  var pdfBtn = document.createElement("button");
  pdfBtn.className = "debate-ended-resume-btn debate-ended-pdf-btn";
  pdfBtn.innerHTML = iconHtml("download") + " PDF";
  pdfBtn.addEventListener("click", function () {
    pdfBtn.disabled = true;
    exportDebateAsPdf().then(function () {
      pdfBtn.disabled = false;
    }).catch(function (err) {
      pdfBtn.disabled = false;
      console.error("Debate PDF export failed:", err);
    });
  });
  resumeRow.appendChild(pdfBtn);

  endBanner.appendChild(resumeRow);

  // Enter in textarea = resume
  resumeInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      resumeBtn.click();
    }
  });

  ctx.messagesEl.appendChild(endBanner);
  refreshIcons();
}

export function exportDebateAsPdf() {
  var popup = window.open("", "_blank", "width=900,height=700");
  if (!popup) {
    return Promise.resolve();
  }

  popup.document.write("<!DOCTYPE html><html><head><title>Preparing PDF\u2026</title></head><body><p style=\"font-family:sans-serif;padding:32px;color:#555\">Preparing PDF, please wait\u2026</p></body></html>");
  popup.document.close();

  // Build debate content HTML from DOM
  var contentParts = [];
  var topic = debateTopic || "Debate";

  // Title
  contentParts.push("<h1>" + escapeHtml(topic) + "</h1>");

  // Metadata from info float
  var floatEl = document.getElementById("debate-info-float");
  if (floatEl) {
    var modEl = floatEl.querySelector(".debate-info-mod");
    var chips = floatEl.querySelectorAll(".debate-info-chip");
    var metaParts = [];
    if (modEl) metaParts.push("<strong>Moderator:</strong> " + escapeHtml(modEl.textContent.trim()));
    if (chips.length > 0) {
      var panelNames = [];
      for (var c = 0; c < chips.length; c++) {
        panelNames.push(escapeHtml(chips[c].textContent.trim()));
      }
      metaParts.push("<strong>Panel:</strong> " + panelNames.join(", "));
    }
    if (metaParts.length > 0) {
      contentParts.push('<p class="debate-pdf-meta">' + metaParts.join(" &nbsp;|&nbsp; ") + "</p>");
    }
  }

  contentParts.push("<hr>");

  // Collect turns and user comments from DOM
  var els = ctx.messagesEl.querySelectorAll(".debate-turn, .debate-user-comment");
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.classList.contains("debate-turn")) {
      var nameEl = el.querySelector(".debate-speaker-name");
      var roleEl = el.querySelector(".debate-speaker-role");
      var avatarEl = el.querySelector(".debate-speaker-avatar");
      var contentEl = el.querySelector(".debate-turn-content");
      var speaker = nameEl ? nameEl.textContent.trim() : "Speaker";
      var role = roleEl ? roleEl.textContent.trim() : "";
      var avatarHtml = "";
      if (avatarEl && avatarEl.src) {
        avatarHtml = '<img class="debate-pdf-avatar" src="' + avatarEl.src + '" width="22" height="22" /> ';
      }
      var heading = avatarHtml + escapeHtml(speaker);
      if (role) heading += ' <span class="debate-pdf-role">(' + escapeHtml(role) + ')</span>';
      contentParts.push('<h2 class="debate-pdf-speaker">' + heading + "</h2>");
      if (contentEl) {
        var clone = contentEl.cloneNode(true);
        // Remove copy buttons from code blocks
        var copyBtns = clone.querySelectorAll(".code-copy-btn");
        for (var k = 0; k < copyBtns.length; k++) copyBtns[k].remove();
        contentParts.push(clone.innerHTML);
      }
    } else if (el.classList.contains("debate-user-comment")) {
      var textEl = el.querySelector(".debate-comment-text");
      var commentText = textEl ? escapeHtml(textEl.textContent.trim()) : "";
      if (commentText) {
        contentParts.push('<blockquote><strong>You:</strong> ' + commentText + '</blockquote>');
      }
    }
  }

  var contentHtml = contentParts.join("\n");
  var baseCss = getPrintCss();
  var debateCss = [
    ".debate-pdf-meta { color: #6b6860; font-size: 10pt; margin: 4pt 0 8pt; }",
    ".debate-pdf-speaker { display: flex; align-items: center; gap: 6pt; }",
    ".debate-pdf-avatar { width: 22pt; height: 22pt; border-radius: 50%; flex-shrink: 0; }",
    ".debate-pdf-role { color: #6b6860; font-weight: 400; font-size: 11pt; }",
  ].join("\n");

  var fullHtml = "<!DOCTYPE html>\n" +
    "<html lang=\"ko\"><head>\n" +
    "<meta charset=\"UTF-8\">\n" +
    "<title>" + escapeHtml(topic) + "</title>\n" +
    "<link rel=\"preconnect\" href=\"https://cdn.jsdelivr.net\">\n" +
    "<link rel=\"stylesheet\" href=\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css\">\n" +
    "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n" +
    "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n" +
    "<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400;0,500;1,400&display=swap\">\n" +
    "<style>\n" + baseCss + "\n" + debateCss + "\n</style>\n" +
    "</head><body>\n" +
    "<div class=\"file-viewer-markdown\">" + contentHtml + "</div>\n" +
    "</body></html>";

  return new Promise(function (resolve, reject) {
    try {
      popup.document.open();
      popup.document.write(fullHtml);
      popup.document.close();

      popup.onload = function () {
        var fontReady = popup.document.fonts ? popup.document.fonts.ready : Promise.resolve();
        var timeout = new Promise(function (r) { setTimeout(r, 3000); });
        Promise.race([fontReady, timeout]).then(function () {
          popup.focus();
          popup.print();
          if (typeof popup.onafterprint !== "undefined") {
            popup.onafterprint = function () { popup.close(); };
          } else {
            setTimeout(function () { popup.close(); }, 1000);
          }
          resolve();
        });
      };
    } catch (err) {
      popup.close();
      reject(err);
    }
  });
}

export function handleDebateError(msg) {
  if (ctx.messagesEl && debateActive) {
    var errEl = document.createElement("div");
    errEl.className = "debate-error";
    errEl.textContent = "Error: " + (msg.error || "Unknown error");
    ctx.messagesEl.appendChild(errEl);
    if (ctx.scrollToBottom) ctx.scrollToBottom();
  }
}

// --- History replay ---
export function renderDebateStarted(entry) {
  handleDebateStarted(entry);
}

export function renderDebateTurnDone(entry) {
  if (!ctx.messagesEl) return;

  var turnEl = document.createElement("div");
  turnEl.className = "debate-turn";

  var speakerRow = document.createElement("div");
  speakerRow.className = "debate-speaker";

  if (entry.avatarStyle || entry.avatarSeed || entry.mateId) {
    var avi = document.createElement("img");
    avi.className = "debate-speaker-avatar";
    avi.src = buildAvatarUrl(entry);
    avi.width = 24;
    avi.height = 24;
    speakerRow.appendChild(avi);
  }

  var nameSpan = document.createElement("span");
  nameSpan.className = "debate-speaker-name";
  nameSpan.textContent = entry.mateName || "Speaker";
  speakerRow.appendChild(nameSpan);

  var roleSpan = document.createElement("span");
  roleSpan.className = "debate-speaker-role";
  roleSpan.textContent = entry.role || "";
  speakerRow.appendChild(roleSpan);

  turnEl.appendChild(speakerRow);

  var contentDiv = document.createElement("div");
  contentDiv.className = "md-content debate-turn-content";
  contentDiv.dir = "auto";
  contentDiv.innerHTML = renderMarkdown(entry.text || "");
  highlightCodeBlocks(contentDiv);
  turnEl.appendChild(contentDiv);

  ctx.messagesEl.appendChild(turnEl);
}

export function renderDebateUserResume(entry) {
  if (!ctx.messagesEl) return;

  // Remove the ended banner since we're resuming
  var endedBanner = ctx.messagesEl.querySelector(".debate-ended-banner");
  if (endedBanner) endedBanner.remove();

  // Also remove conclude confirm if present
  var confirmEl = document.getElementById("debate-conclude-confirm");
  if (confirmEl) confirmEl.remove();

  var el = document.createElement("div");
  el.className = "debate-user-comment";

  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("play") + " Debate resumed:";

  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = entry.text || "";

  el.appendChild(label);
  el.appendChild(textEl);
  ctx.messagesEl.appendChild(el);
  refreshIcons();
  if (ctx.scrollToBottom) ctx.scrollToBottom();
}

export function renderDebateEnded(entry) {
  if (!ctx.messagesEl) return;

  debateActive = false;
  debatePhase = "ended";
  hideDebateInfoFloat();
  showPdfBtn(false);

  // Ensure debate bars are removed during history replay
  var bottomBar = document.getElementById("debate-bottom-bar");
  if (bottomBar) bottomBar.remove();
  var handBar = document.getElementById("debate-hand-raise-bar");
  if (handBar) handBar.remove();

  // Render status line
  var existing = ctx.messagesEl.querySelector(".debate-ended-status-line");
  if (existing) existing.remove();
  var statusLine = document.createElement("div");
  statusLine.className = "debate-ended-status-line";
  var reasonText = entry.reason === "natural" ? "Debate concluded" :
                   entry.reason === "user_stopped" ? "Debate stopped by user" :
                   "Debate ended due to error";
  statusLine.innerHTML = iconHtml("check-circle") + " " + escapeHtml(reasonText) + " (" + (entry.rounds || 0) + " rounds)";
  ctx.messagesEl.appendChild(statusLine);
  refreshIcons();

  // During history replay, don't activate ended mode banner.
  // The debate is already over; status line in messages is sufficient.
}

export function renderDebateCommentInjected(entry) {
  if (!ctx.messagesEl) return;

  var commentEl = document.createElement("div");
  commentEl.className = "debate-user-comment";

  var label = document.createElement("span");
  label.className = "debate-comment-label";
  label.innerHTML = iconHtml("hand") + " User comment:";

  var textEl = document.createElement("div");
  textEl.className = "debate-comment-text";
  textEl.textContent = entry.text || "";

  commentEl.appendChild(label);
  commentEl.appendChild(textEl);
  ctx.messagesEl.appendChild(commentEl);
  refreshIcons();
}

export function isDebateActive() {
  return debateActive;
}

// --- Debate modal (wizard) ---
var modalEl = null;
var selectedPanelists = [];
var wizardStep = 0;

function goToStep(step) {
  wizardStep = step;
  if (!modalEl) return;
  var pages = modalEl.querySelectorAll(".debate-wizard-page");
  var dots = modalEl.querySelectorAll(".debate-step-dot");
  for (var i = 0; i < pages.length; i++) {
    if (i === step) {
      pages[i].classList.add("active");
      if (dots[i]) dots[i].classList.add("active");
    } else {
      pages[i].classList.remove("active");
      if (dots[i]) dots[i].classList.remove("active");
    }
  }
  var backBtn = document.getElementById("debate-modal-back");
  var nextBtn = document.getElementById("debate-modal-next");
  var quickBtn = document.getElementById("debate-modal-quick");
  var startBtn = document.getElementById("debate-modal-start");
  var cancelBtn = document.getElementById("debate-modal-cancel");
  if (step === 0) {
    // Cancel + (Quick / Setup Panel) - buttons hidden until topic entered
    if (backBtn) backBtn.classList.add("hidden");
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    if (quickBtn) quickBtn.classList.add("hidden");
    if (nextBtn) nextBtn.classList.add("hidden");
    if (startBtn) startBtn.classList.add("hidden");
  } else {
    // Back + (Quick / Setup Detail)
    if (backBtn) backBtn.classList.remove("hidden");
    if (cancelBtn) cancelBtn.classList.add("hidden");
    if (quickBtn) quickBtn.classList.add("hidden");
    if (nextBtn) nextBtn.classList.add("hidden");
    if (startBtn) startBtn.classList.add("hidden");
  }
}

function updateStepButtons() {
  var topicInput = document.getElementById("debate-topic-input");
  var topic = topicInput ? topicInput.value.trim() : "";
  var quickBtn = document.getElementById("debate-modal-quick");
  var nextBtn = document.getElementById("debate-modal-next");
  var startBtn = document.getElementById("debate-modal-start");
  if (wizardStep === 0) {
    // Show buttons only when topic is filled
    if (topic) {
      if (quickBtn) quickBtn.classList.remove("hidden");
      if (nextBtn) nextBtn.classList.remove("hidden");
    } else {
      if (quickBtn) quickBtn.classList.add("hidden");
      if (nextBtn) nextBtn.classList.add("hidden");
    }
  } else if (wizardStep === 1) {
    // Show buttons only when at least 1 panelist selected
    if (selectedPanelists.length > 0) {
      if (quickBtn) quickBtn.classList.remove("hidden");
      if (startBtn) startBtn.classList.remove("hidden");
    } else {
      if (quickBtn) quickBtn.classList.add("hidden");
      if (startBtn) startBtn.classList.add("hidden");
    }
  }
}

export function openDebateModal(opts) {
  opts = opts || {};
  modalEl = document.getElementById("debate-modal");
  if (!modalEl) return;

  modalEl.classList.remove("hidden");
  goToStep(0);

  var topicInput = document.getElementById("debate-topic-input");
  if (topicInput) {
    topicInput.value = "";
    topicInput.focus();
    topicInput.oninput = function () { updateStepButtons(); };
  }

  // Build DM context string for quick start
  var dmContextStr = "";
  if (opts.dmContext && opts.dmContext.length) {
    var recent = opts.dmContext.slice(-20);
    var parts = [];
    for (var i = 0; i < recent.length; i++) {
      var m = recent[i];
      var speaker = m.isMate ? "Mate" : "User";
      var text = m.text || "";
      if (text.length > 500) text = text.substring(0, 500) + "...";
      parts.push(speaker + ": " + text);
    }
    dmContextStr = parts.join("\n");
  }

  // Populate panelist list from mates (exclude current mate = moderator)
  var panelList = document.getElementById("debate-panel-list");
  if (panelList) {
    panelList.innerHTML = "";
    selectedPanelists = [];
    var mates = ctx.matesList ? ctx.matesList() : [];
    var currentMateId = ctx.currentMateId ? ctx.currentMateId() : null;
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (m.status === "interviewing") continue;
      if (m.id === currentMateId) continue; // moderator, skip
      var item = createPanelItem(m);
      panelList.appendChild(item);
    }
  }

  // Close / Cancel / Backdrop
  var closeBtn = document.getElementById("debate-modal-close");
  if (closeBtn) closeBtn.onclick = closeDebateModal;
  var cancelBtn = document.getElementById("debate-modal-cancel");
  if (cancelBtn) cancelBtn.onclick = closeDebateModal;
  var backdrop = modalEl.querySelector(".debate-modal-backdrop");
  if (backdrop) backdrop.onclick = closeDebateModal;

  // Back button
  var backBtn = document.getElementById("debate-modal-back");
  if (backBtn) {
    backBtn.onclick = function () {
      if (wizardStep > 0) goToStep(wizardStep - 1);
      updateStepButtons();
    };
  }

  // Choose Panel (step 0 -> 1)
  var nextBtn = document.getElementById("debate-modal-next");
  if (nextBtn) {
    nextBtn.onclick = function () {
      goToStep(1);
      updateStepButtons();
    };
  }

  // Helper: build payload and send
  function fireDebate(quick) {
    var topic = topicInput ? topicInput.value.trim() : "";
    var currentMateId = ctx.currentMateId ? ctx.currentMateId() : null;
    if (!currentMateId || !topic) return;

    var debatePayload = {
      type: "debate_start",
      moderatorId: currentMateId,
      topic: topic,
      quickStart: !!quick,
    };

    if (quick && wizardStep === 0) {
      // Step 0 quick: delegate panelist selection to moderator
      debatePayload.panelists = [];
      debatePayload.delegatePanelists = true;
      debatePayload.dmContext = dmContextStr;
    } else {
      // Step 1: user picked panelists
      if (selectedPanelists.length === 0) return;
      debatePayload.panelists = selectedPanelists.map(function (id) {
        return { mateId: id, role: "", brief: "" };
      });
      if (quick) {
        debatePayload.dmContext = dmContextStr;
      }
    }

    function sendDebate() {
      if (ctx.ws) {
        var onMessage = function (evt) {
          try {
            var data = JSON.parse(evt.data);
            if (data.type === "session_switched") {
              ctx.ws.removeEventListener("message", onMessage);
              ctx.ws.send(JSON.stringify(debatePayload));
            }
          } catch (e) {}
        };
        ctx.ws.addEventListener("message", onMessage);
        ctx.ws.send(JSON.stringify({ type: "new_session" }));
      }
      closeDebateModal();
    }

    if (quick) {
      sendDebate();
    } else {
      if (ctx.requireSkills) {
        ctx.requireSkills({
          title: "Skill Installation Required",
          reason: "The Debate Setup skill is required to design this debate.",
          skills: [{ name: "clay-debate-setup", url: "https://github.com/chadbyte/clay-debate-setup", scope: "global" }]
        }, sendDebate);
      } else {
        sendDebate();
      }
    }
  }

  // Quick Start button (both steps)
  var quickBtn = document.getElementById("debate-modal-quick");
  if (quickBtn) {
    quickBtn.onclick = function () { fireDebate(true); };
  }

  // Design Debate button (step 1, full setup with skill)
  var startBtn = document.getElementById("debate-modal-start");
  if (startBtn) {
    startBtn.onclick = function () { fireDebate(false); };
  }

  refreshIcons();
}

function createPanelItem(mate) {
  var item = document.createElement("div");
  item.className = "debate-panel-item";
  item.dataset.mateId = mate.id;

  var cb = document.createElement("input");
  cb.type = "checkbox";
  item.appendChild(cb);

  var avi = document.createElement("img");
  avi.className = "debate-panel-item-avatar";
  avi.src = mateAvatarUrl(mate, 32);
  item.appendChild(avi);

  var info = document.createElement("div");
  info.className = "debate-panel-item-info";

  var nameSpan = document.createElement("div");
  nameSpan.className = "debate-panel-item-name";
  nameSpan.textContent = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
  info.appendChild(nameSpan);

  if (mate.bio) {
    var bioSpan = document.createElement("div");
    bioSpan.className = "debate-panel-item-bio";
    bioSpan.textContent = mate.bio;
    info.appendChild(bioSpan);
  }

  item.appendChild(info);

  // Toggle selection
  function toggle() {
    var idx = selectedPanelists.indexOf(mate.id);
    if (idx === -1) {
      selectedPanelists.push(mate.id);
      item.classList.add("selected");
      cb.checked = true;
    } else {
      selectedPanelists.splice(idx, 1);
      item.classList.remove("selected");
      cb.checked = false;
    }
    updateStepButtons();
  }

  item.addEventListener("click", function (e) {
    if (e.target === cb) return;
    toggle();
  });
  cb.addEventListener("change", function () {
    var idx = selectedPanelists.indexOf(mate.id);
    if (cb.checked && idx === -1) {
      selectedPanelists.push(mate.id);
      item.classList.add("selected");
    } else if (!cb.checked && idx !== -1) {
      selectedPanelists.splice(idx, 1);
      item.classList.remove("selected");
    }
    updateStepButtons();
  });

  return item;
}

export function closeDebateModal() {
  if (modalEl) {
    modalEl.classList.add("hidden");
  }
  selectedPanelists = [];
  var skipSetupToggle = document.getElementById("debate-skip-setup-toggle");
  if (skipSetupToggle) skipSetupToggle.checked = false;
  var skipSetupRow = document.getElementById("debate-skip-setup-row");
  if (skipSetupRow) skipSetupRow.classList.add("hidden");
}

// --- Quick Debate: start debate from DM context ---
var quickDebateEl = null;
var quickSelectedPanelists = [];

export function openQuickDebateModal(dmMessages) {
  closeQuickDebateModal();

  // Build DM context from recent messages (last 20, capped)
  var dmContext = "";
  if (dmMessages && dmMessages.length) {
    var recent = dmMessages.slice(-20);
    var parts = [];
    for (var i = 0; i < recent.length; i++) {
      var m = recent[i];
      var speaker = m.isMate ? "Mate" : "User";
      var text = m.text || "";
      if (text.length > 500) text = text.substring(0, 500) + "...";
      parts.push(speaker + ": " + text);
    }
    dmContext = parts.join("\n");
  }

  quickSelectedPanelists = [];

  // Create modal overlay
  quickDebateEl = document.createElement("div");
  quickDebateEl.className = "debate-modal-overlay";

  var html = '';
  html += '<div class="debate-modal-backdrop"></div>';
  html += '<div class="debate-modal-content quick-debate-modal">';
  html += '<div class="debate-modal-header">';
  html += '<h3>Quick Debate</h3>';
  html += '<button class="debate-modal-close-btn">&times;</button>';
  html += '</div>';

  // Optional topic override
  html += '<div class="debate-modal-field">';
  html += '<label>Topic <span style="color:var(--text-tertiary);font-weight:normal">(optional, auto-detected from conversation)</span></label>';
  html += '<input type="text" class="quick-debate-topic" placeholder="Leave blank to auto-detect..." maxlength="200" spellcheck="false">';
  html += '</div>';

  // Panelist selection
  html += '<div class="debate-modal-field">';
  html += '<label>Select Panelists</label>';
  html += '<div class="quick-debate-panel-list"></div>';
  html += '</div>';

  html += '<div class="debate-modal-actions">';
  html += '<button class="debate-modal-cancel-btn">Cancel</button>';
  html += '<button class="debate-modal-start-btn">Start Debate</button>';
  html += '</div>';

  html += '</div>';
  quickDebateEl.innerHTML = html;
  document.body.appendChild(quickDebateEl);

  // Populate panelist list
  var panelList = quickDebateEl.querySelector(".quick-debate-panel-list");
  var mates = ctx.matesList ? ctx.matesList() : [];
  var currentMateId = ctx.currentMateId ? ctx.currentMateId() : null;
  for (var j = 0; j < mates.length; j++) {
    var mate = mates[j];
    if (mate.status === "interviewing") continue;
    if (mate.id === currentMateId) continue;
    var item = createQuickPanelItem(mate);
    panelList.appendChild(item);
  }

  // Events
  quickDebateEl.querySelector(".debate-modal-backdrop").onclick = closeQuickDebateModal;
  quickDebateEl.querySelector(".debate-modal-close-btn").onclick = closeQuickDebateModal;
  quickDebateEl.querySelector(".debate-modal-cancel-btn").onclick = closeQuickDebateModal;

  quickDebateEl.querySelector(".debate-modal-start-btn").onclick = function () {
    if (quickSelectedPanelists.length === 0) return;
    if (!currentMateId) return;

    var topicInput = quickDebateEl.querySelector(".quick-debate-topic");
    var topic = topicInput ? topicInput.value.trim() : "";

    var debatePayload = {
      type: "debate_start",
      quickStart: true,
      moderatorId: currentMateId,
      topic: topic || "(auto-detect from conversation)",
      dmContext: dmContext,
      panelists: quickSelectedPanelists.map(function (id) {
        return { mateId: id, role: "", brief: "" };
      }),
    };

    // Create new session, then send debate_start
    if (ctx.ws) {
      var onMessage = function (evt) {
        try {
          var data = JSON.parse(evt.data);
          if (data.type === "session_switched") {
            ctx.ws.removeEventListener("message", onMessage);
            ctx.ws.send(JSON.stringify(debatePayload));
          }
        } catch (e) {}
      };
      ctx.ws.addEventListener("message", onMessage);
      ctx.ws.send(JSON.stringify({ type: "new_session" }));
    }

    closeQuickDebateModal();
  };

  // Focus topic input
  var topicEl = quickDebateEl.querySelector(".quick-debate-topic");
  if (topicEl) setTimeout(function () { topicEl.focus(); }, 50);

  refreshIcons();
}

function createQuickPanelItem(mate) {
  var item = document.createElement("div");
  item.className = "debate-panel-item";
  item.dataset.mateId = mate.id;

  var cb = document.createElement("input");
  cb.type = "checkbox";
  item.appendChild(cb);

  var avatarSrc = mateAvatarUrl(mate, 32);
  var avi = document.createElement("img");
  avi.className = "debate-panel-item-avatar";
  avi.src = avatarSrc;
  item.appendChild(avi);

  var info = document.createElement("div");
  info.className = "debate-panel-item-info";
  var nameSpan = document.createElement("div");
  nameSpan.className = "debate-panel-item-name";
  nameSpan.textContent = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
  info.appendChild(nameSpan);
  if (mate.bio) {
    var bioSpan = document.createElement("div");
    bioSpan.className = "debate-panel-item-bio";
    bioSpan.textContent = mate.bio;
    info.appendChild(bioSpan);
  }
  item.appendChild(info);

  function toggle() {
    var idx = quickSelectedPanelists.indexOf(mate.id);
    if (idx === -1) {
      quickSelectedPanelists.push(mate.id);
      item.classList.add("selected");
      cb.checked = true;
    } else {
      quickSelectedPanelists.splice(idx, 1);
      item.classList.remove("selected");
      cb.checked = false;
    }
  }

  item.addEventListener("click", function (e) {
    if (e.target === cb) return;
    toggle();
  });
  cb.addEventListener("change", function () {
    var idx = quickSelectedPanelists.indexOf(mate.id);
    if (cb.checked && idx === -1) { quickSelectedPanelists.push(mate.id); item.classList.add("selected"); }
    else if (!cb.checked && idx !== -1) { quickSelectedPanelists.splice(idx, 1); item.classList.remove("selected"); }
  });

  return item;
}

export function closeQuickDebateModal() {
  if (quickDebateEl) {
    quickDebateEl.remove();
    quickDebateEl = null;
  }
  quickSelectedPanelists = [];
}

// --- Debate Brief Card (inline proposal from DM) ---

export function handleDebateBriefReady(msg) {
  renderDebateBriefCard(msg, false);
}

export function renderDebateBriefReady(msg) {
  renderDebateBriefCard(msg, true);
}

function renderDebateBriefCard(msg, resolved) {
  var el = document.createElement("div");
  el.className = "debate-brief-card" + (resolved ? " resolved" : "");

  // Header
  var header = document.createElement("div");
  header.className = "debate-brief-card-header";
  header.innerHTML =
    '<span class="debate-brief-card-icon">' + iconHtml("message-circle") + '</span>' +
    '<span class="debate-brief-card-title">Debate Proposal</span>' +
    '<span class="debate-brief-card-chevron">' + iconHtml("chevron-down") + '</span>';

  // Body
  var body = document.createElement("div");
  body.className = "debate-brief-card-body";

  var topicHtml = '<div class="debate-brief-topic">' + escapeHtml(msg.topic || "Untitled") + '</div>';

  if (msg.context) {
    topicHtml += '<div class="debate-brief-context">' + escapeHtml(msg.context) + '</div>';
  }

  // Resolve mate avatars from matesList
  var mates = ctx.matesList ? ctx.matesList() : [];
  var mateMap = {};
  for (var mi = 0; mi < mates.length; mi++) {
    mateMap[mates[mi].id] = mates[mi];
  }

  var modMate = msg.moderatorId ? mateMap[msg.moderatorId] : null;
  var modAvatarSrc = modMate ? mateAvatarUrl(modMate, 24) : "";
  topicHtml += '<div class="debate-brief-moderator" style="display:flex;align-items:center;gap:8px;">' +
    iconHtml("mic") + ' <strong>Moderator:</strong> ';
  if (modAvatarSrc) {
    topicHtml += '<img src="' + escapeHtml(modAvatarSrc) + '" width="24" height="24" style="border-radius:50%;flex-shrink:0;">';
  }
  topicHtml += escapeHtml(msg.moderatorName || "Unknown") + '</div>';

  topicHtml += '<div class="debate-brief-panelists-label">' + iconHtml("users") + ' <strong>Panelists:</strong></div>';
  topicHtml += '<div class="debate-brief-panelists">';
  if (msg.panelists) {
    for (var i = 0; i < msg.panelists.length; i++) {
      var p = msg.panelists[i];
      var mate = p.mateId ? mateMap[p.mateId] : null;
      var avatarSrc = mate ? mateAvatarUrl(mate, 24) : "";
      topicHtml += '<div class="debate-brief-panelist" style="display:flex;align-items:center;gap:8px;">';
      if (avatarSrc) {
        topicHtml += '<img src="' + escapeHtml(avatarSrc) + '" width="24" height="24" style="border-radius:50%;flex-shrink:0;">';
      }
      topicHtml += '<span class="debate-brief-panelist-name">' + escapeHtml(p.name || "Unknown") + '</span>';
      if (p.role) {
        topicHtml += '<span class="debate-brief-panelist-role">' + escapeHtml(p.role) + '</span>';
      }
      topicHtml += '</div>';
    }
  }
  topicHtml += '</div>';

  if (msg.specialRequests) {
    topicHtml += '<div class="debate-brief-special">' +
      iconHtml("info") + ' ' + escapeHtml(msg.specialRequests) +
      '</div>';
  }

  body.innerHTML = topicHtml;

  // Actions
  var actions = document.createElement("div");
  actions.className = "debate-brief-actions";

  if (resolved) {
    actions.innerHTML = '<span class="debate-brief-resolved-label">' + iconHtml("check") + ' Debate started</span>';
  } else {
    var startBtn = document.createElement("button");
    startBtn.className = "debate-brief-start-btn";
    startBtn.innerHTML = iconHtml("play") + " Start Debate";

    var cancelBtn = document.createElement("button");
    cancelBtn.className = "debate-brief-cancel-btn";
    cancelBtn.textContent = "Cancel";

    startBtn.addEventListener("click", function () {
      if (ctx.sendWs) {
        ctx.sendWs({ type: "debate_confirm_brief" });
      }
      el.classList.add("resolved");
      actions.innerHTML = '<span class="debate-brief-resolved-label">' + iconHtml("check") + ' Starting debate...</span>';
      refreshIcons();
    });

    cancelBtn.addEventListener("click", function () {
      if (ctx.sendWs) {
        ctx.sendWs({ type: "debate_stop" });
      }
      el.classList.add("resolved");
      actions.innerHTML = '<span class="debate-brief-resolved-label debate-brief-cancelled">' + iconHtml("x") + ' Cancelled</span>';
      refreshIcons();
    });

    actions.appendChild(startBtn);
    actions.appendChild(cancelBtn);
  }

  // Collapse toggle
  header.addEventListener("click", function () {
    el.classList.toggle("collapsed");
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(actions);
  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();
}

// --- MCP-based debate proposal card ---
// Renders an inline card from the propose_debate MCP tool input.
// The card reuses the same visual structure as renderDebateBriefCard
// but sends debate_proposal_response instead of debate_confirm_brief.

export function renderMcpDebateProposal(toolId, input) {
  var panelists = [];
  try {
    panelists = typeof input.panelists === "string" ? JSON.parse(input.panelists) : (input.panelists || []);
  } catch (e) {
    panelists = [];
  }

  var el = document.createElement("div");
  el.className = "debate-brief-card";

  // Header
  var header = document.createElement("div");
  header.className = "debate-brief-card-header";
  header.innerHTML =
    '<span class="debate-brief-card-icon">' + iconHtml("message-circle") + '</span>' +
    '<span class="debate-brief-card-title">Debate Proposal</span>' +
    '<span class="debate-brief-card-chevron">' + iconHtml("chevron-down") + '</span>';

  // Body
  var body = document.createElement("div");
  body.className = "debate-brief-card-body";

  var topicHtml = '<div class="debate-brief-topic">' + escapeHtml(input.topic || "Untitled") + '</div>';

  if (input.context) {
    topicHtml += '<div class="debate-brief-context">' + escapeHtml(input.context) + '</div>';
  }

  // Resolve mate names from matesList
  var mates = ctx.matesList ? ctx.matesList() : [];
  var mateMap = {};
  for (var mi = 0; mi < mates.length; mi++) {
    mateMap[mates[mi].id] = mates[mi];
  }

  topicHtml += '<div class="debate-brief-panelists-label">' + iconHtml("users") + ' <strong>Panelists:</strong></div>';
  topicHtml += '<div class="debate-brief-panelists">';
  for (var i = 0; i < panelists.length; i++) {
    var p = panelists[i];
    var mate = mateMap[p.mateId];
    var mateName = mate ? (mate.displayName || mate.name || p.mateId) : p.mateId;
    var avatarSrc = mate ? mateAvatarUrl(mate, 24) : "";
    topicHtml += '<div class="debate-brief-panelist" style="display:flex;align-items:center;gap:8px;">';
    if (avatarSrc) {
      topicHtml += '<img src="' + escapeHtml(avatarSrc) + '" width="24" height="24" style="border-radius:50%;flex-shrink:0;">';
    }
    topicHtml += '<span class="debate-brief-panelist-name">' + escapeHtml(mateName) + '</span>';
    if (p.role) {
      topicHtml += '<span class="debate-brief-panelist-role">' + escapeHtml(p.role) + '</span>';
    }
    topicHtml += '</div>';
  }
  topicHtml += '</div>';

  if (input.specialRequests) {
    topicHtml += '<div class="debate-brief-special">' +
      iconHtml("info") + ' ' + escapeHtml(input.specialRequests) +
      '</div>';
  }

  body.innerHTML = topicHtml;

  // Actions
  var actions = document.createElement("div");
  actions.className = "debate-brief-actions";

  var startBtn = document.createElement("button");
  startBtn.className = "debate-brief-start-btn";
  startBtn.innerHTML = iconHtml("play") + " Start Debate";

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "debate-brief-cancel-btn";
  cancelBtn.textContent = "Cancel";

  startBtn.addEventListener("click", function () {
    if (ctx.sendWs) {
      ctx.sendWs({ type: "debate_proposal_response", proposalId: input.proposalId, action: "start" });
    }
    el.classList.add("resolved");
    actions.innerHTML = '<span class="debate-brief-resolved-label">' + iconHtml("check") + ' Starting debate...</span>';
    refreshIcons();
  });

  cancelBtn.addEventListener("click", function () {
    if (ctx.sendWs) {
      ctx.sendWs({ type: "debate_proposal_response", proposalId: input.proposalId, action: "cancel" });
    }
    el.classList.add("resolved");
    actions.innerHTML = '<span class="debate-brief-resolved-label debate-brief-cancelled">' + iconHtml("x") + ' Cancelled</span>';
    refreshIcons();
  });

  actions.appendChild(startBtn);
  actions.appendChild(cancelBtn);

  // Collapse toggle
  header.addEventListener("click", function () {
    el.classList.toggle("collapsed");
  });

  el.appendChild(header);
  el.appendChild(body);
  el.appendChild(actions);
  ctx.addToMessages(el);
  refreshIcons();
  ctx.scrollToBottom();
}
