import { escapeHtml, copyToClipboard } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks } from './markdown.js';
import { renderUnifiedDiff, renderSplitDiff, renderPatchDiff, reconstructPatchSources } from './diff.js';
import { openFile } from './filebrowser.js';
import { mateAvatarUrl } from './avatar.js';
import { getChatLayout } from './theme.js';
import { store } from './store.js';
import { VENDOR_NAMES } from './app-rendering.js';
import { startThinkingSegment, appendThinkingText, stopThinkingSegment, resetThinkingTurn, clearThinkingState, saveThinkingState, restoreThinkingState, updateThinkingTokenEstimate } from './thinking-lifecycle.js';

var ctx;

// During history replay, individual tool renders (todos, file edits, command
// outputs) must not auto-scroll. The history_done handler arms sticky-bottom
// which pins the viewport to the true bottom after the whole replay settles.
// Per-tool scroll calls during replay fight that and re-anchor the user to
// whichever tool widget grew last (commonly the todo widget).
function maybeScrollToBottom() {
  if (store.get('replayingHistory')) return;
  if (ctx && ctx.scrollToBottom) ctx.scrollToBottom();
}

// --- Plan mode state ---
var inPlanMode = false;
var planContent = null;
var currentPlanCardEl = null;

// --- Todo state ---
var todoItems = [];
var todoWidgetEl = null;
var todoWidgetVisible = true; // whether in-chat widget is in viewport
var todoObserver = null;
// When a session is resumed without a live SDK process and still has
// pending/in_progress items, the widget is rendered in compact mode
// (header + count only) so it doesn't anchor visual position mid-page
// or extend the sticky-bottom settle window with a tall element.
var todoDeadCompact = false;
var todoMeta = {
  variant: "tasks",
  title: "Tasks",
  icon: "list-checks",
  showProgress: true,
  showCompletedCount: true,
  stickyEnabled: true,
};

// --- Tool tracking ---
var tools = {};
var pendingPermissions = {};

// --- Tool group tracking ---
var currentToolGroup = null;
var toolGroupCounter = 0;
var toolGroups = {};

// --- Tool helpers ---
var PLAN_MODE_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1 };
var TODO_TOOLS = { TodoWrite: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1 };
var HIDDEN_RESULT_TOOLS = { EnterPlanMode: 1, ExitPlanMode: 1, TaskCreate: 1, TaskUpdate: 1, TaskList: 1, TaskGet: 1, TodoWrite: 1 };

// --- Tool group helpers ---
function closeToolGroup() {
  if (currentToolGroup) {
    currentToolGroup.closed = true;
  }
  currentToolGroup = null;
}

function findToolGroup(groupId) {
  return toolGroups[groupId] || null;
}

function toolGroupSummary(group) {
  var names = group.toolNames;
  var count = names.length;
  var allDone = group.doneCount >= count;

  // Count by tool name
  var counts = {};
  for (var i = 0; i < names.length; i++) {
    counts[names[i]] = (counts[names[i]] || 0) + 1;
  }
  var uniqueNames = Object.keys(counts);

  if (uniqueNames.length === 1) {
    var name = uniqueNames[0];
    var n = counts[name];
    if (allDone) {
      switch (name) {
        case "Read": return "Read " + n + " file" + (n > 1 ? "s" : "");
        case "Edit": return "Edited " + n + " file" + (n > 1 ? "s" : "");
        case "Write": return "Wrote " + n + " file" + (n > 1 ? "s" : "");
        case "Bash": return "Ran " + n + " command" + (n > 1 ? "s" : "");
        case "Grep": return "Searched " + n + " pattern" + (n > 1 ? "s" : "");
        case "Glob": return "Found " + n + " pattern" + (n > 1 ? "s" : "");
        case "Task": return "Ran " + n + " task" + (n > 1 ? "s" : "");
        case "WebSearch": return "Searched " + n + " quer" + (n > 1 ? "ies" : "y");
        case "WebFetch": return "Fetched " + n + " URL" + (n > 1 ? "s" : "");
        default: return "Ran " + n + " tool" + (n > 1 ? "s" : "");
      }
    }
    switch (name) {
      case "Read": return "Reading " + n + " file" + (n > 1 ? "s" : "") + "...";
      case "Edit": return "Editing " + n + " file" + (n > 1 ? "s" : "") + "...";
      case "Write": return "Writing " + n + " file" + (n > 1 ? "s" : "") + "...";
      case "Bash": return "Running " + n + " command" + (n > 1 ? "s" : "") + "...";
      case "Grep": return "Searching " + n + " pattern" + (n > 1 ? "s" : "") + "...";
      case "Glob": return "Finding " + n + " pattern" + (n > 1 ? "s" : "") + "...";
      case "Task": return "Running " + n + " task" + (n > 1 ? "s" : "") + "...";
      case "WebSearch": return "Searching " + n + " quer" + (n > 1 ? "ies" : "y") + "...";
      case "WebFetch": return "Fetching " + n + " URL" + (n > 1 ? "s" : "") + "...";
      default: return "Running " + n + " tool" + (n > 1 ? "s" : "") + "...";
    }
  }

  // Mixed tools
  if (allDone) return "Ran " + count + " tools";
  return "Running " + count + " tools...";
}

function updateToolGroupHeader(group) {
  if (!group || !group.el) return;
  var label = group.el.querySelector(".tool-group-label");
  if (label) label.textContent = toolGroupSummary(group);

  var allDone = group.doneCount >= group.toolCount;
  var statusIcon = group.el.querySelector(".tool-group-status-icon");
  var bullet = group.el.querySelector(".tool-group-bullet");

  if (allDone) {
    group.el.classList.add("done");
    if (group.errorCount > 0) {
      statusIcon.innerHTML = '<span class="err-icon">' + iconHtml("alert-triangle") + '</span>';
      if (bullet) bullet.classList.add("error");
    } else {
      statusIcon.innerHTML = '<span class="check">' + iconHtml("check") + '</span>';
    }
    refreshIcons();
  }

  // Show group header only when 2+ visible tools (or always in mate DM)
  var header = group.el.querySelector(".tool-group-header");
  var isMate = group.el.classList.contains("mate-tool-group");
  if (isMate) {
    // Mate DM: hide entire group when no tools, show collapsed when tools exist
    if (group.toolCount === 0) {
      group.el.style.display = "none";
    } else {
      group.el.style.display = "";
      header.style.display = "";
      if (!group.userToggled) {
        group.el.classList.add("collapsed");
      }
    }
  } else if (group.toolCount >= 2) {
    header.style.display = "";
    // When 2+ tools, ensure collapsed by default (unless user already toggled)
    if (!group.userToggled && !group.el.classList.contains("expanded-by-user")) {
      group.el.classList.add("collapsed");
    }
  } else {
    header.style.display = "none";
    group.el.classList.remove("collapsed");
  }
}

function isPlanFile(filePath) {
  return filePath && filePath.indexOf(".claude/plans/") !== -1;
}

export function toolSummary(name, input) {
  if (!input || typeof input !== "object") return "";
  switch (name) {
    case "Read": return shortPath(input.file_path);
    case "Edit": return shortPath(input.file_path);
    case "Write": return shortPath(input.file_path);
    case "Bash": return (input.command || "").substring(0, 80);
    case "Glob": return input.pattern || "";
    case "Grep": return (input.pattern || "") + (input.path ? " in " + shortPath(input.path) : "");
    case "WebFetch": return input.url || "";
    case "WebSearch": return input.query || "";
    case "Task": return input.description || "";
    case "EnterPlanMode": return "";
    case "ExitPlanMode": return "";
    default: return JSON.stringify(input).substring(0, 60);
  }
}

export function toolActivityText(name, input) {
  if (name === "Bash" && input && input.description) return input.description;
  if (name === "Read" && input && input.file_path) return "Reading " + shortPath(input.file_path);
  if (name === "Edit" && input && input.file_path) return "Editing " + shortPath(input.file_path);
  if (name === "Write" && input && input.file_path) return "Writing " + shortPath(input.file_path);
  if (name === "Grep" && input && input.pattern) return "Searching for " + input.pattern;
  if (name === "Glob" && input && input.pattern) return "Finding " + input.pattern;
  if (name === "WebSearch" && input && input.query) return "Searching: " + input.query;
  if (name === "WebFetch") return "Fetching URL...";
  if (name === "Task" && input && input.description) return input.description;
  if (name === "EnterPlanMode") return "Entering plan mode...";
  if (name === "ExitPlanMode") return "Finalizing the plan...";
  return "Running " + name + "...";
}

// The sublabel for a call that has finished. `toolActivityText` is written in
// the present progressive for a call in flight, so re-asserting it after a
// result has arrived leaves a finished card claiming to still be running —
// which is how a failed custom tool ended up reading "Running
// send_to_partner..." beside its own error output.
//
// Only ever used where a result exists, so a genuinely in-flight call is never
// relabelled. A failure states so plainly; a success keeps whatever specific
// description the activity text produced ("Reading foo.js"), because that still
// describes the call accurately, and only the generic present-progressive
// fallback is replaced.
export function toolTerminalText(name, input, isError) {
  if (isError) return name + " failed";
  var activity = toolActivityText(name, input);
  return activity === "Running " + name + "..." ? name : activity;
}

function shortPath(p) {
  if (!p) return "";
  var parts = p.split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : p;
}

// --- AskUserQuestion ---
export function renderAskUserQuestion(toolId, input) {
  ctx.finalizeAssistantBlock();
  stopThinking();
  closeToolGroup();

  var questions = input.questions || [];
  if (questions.length === 0) return;

  var container = document.createElement("div");
  container.className = "ask-user-container";
  container.dataset.toolId = toolId;

  // Mate DM: wrap in avatar + content layout (same as msg-assistant)
  var mateContentWrap = null;
  if (ctx.isMateDm && ctx.isMateDm()) {
    container.classList.add("mate-ask-user");
    var mateName = ctx.getMateName();
    var mateAvatar = ctx.getMateAvatarUrl();

    var avi = document.createElement("img");
    avi.className = "dm-bubble-avatar";
    avi.src = mateAvatar;
    container.appendChild(avi);

    mateContentWrap = document.createElement("div");
    mateContentWrap.className = "dm-bubble-content";

    var headerEl = document.createElement("div");
    headerEl.className = "dm-bubble-header";
    headerEl.innerHTML =
      '<span class="dm-bubble-name">' + escapeHtml(mateName) + '</span>' +
      '<span class="dm-bubble-time">' + String(new Date().getHours()).padStart(2, "0") + ":" + String(new Date().getMinutes()).padStart(2, "0") + '</span>';
    mateContentWrap.appendChild(headerEl);
  }

  var answers = {};
  var multiSelections = {};

  questions.forEach(function (q, qIdx) {
    var qDiv = document.createElement("div");
    qDiv.className = "ask-user-question";

    if (q.header) {
      var qHeader = document.createElement("div");
      qHeader.className = "ask-user-question-header";
      qHeader.textContent = q.header;
      qDiv.appendChild(qHeader);
    }

    var qText = document.createElement("div");
    qText.className = "ask-user-question-text";
    qText.textContent = q.question || "";
    qDiv.appendChild(qText);

    var optionsDiv = document.createElement("div");
    optionsDiv.className = "ask-user-options";

    var isMulti = q.multiSelect || false;
    if (isMulti) multiSelections[qIdx] = new Set();

    (q.options || []).forEach(function (opt) {
      var btn = document.createElement("button");
      btn.className = "ask-user-option";
      btn.innerHTML =
        '<div class="option-label"></div>' +
        (opt.description ? '<div class="option-desc"></div>' : '');
      btn.querySelector(".option-label").textContent = opt.label;
      if (opt.description) btn.querySelector(".option-desc").textContent = opt.description;
      if (opt.markdown) {
        var pre = document.createElement("pre");
        pre.className = "option-markdown";
        pre.textContent = opt.markdown;
        btn.appendChild(pre);
      }

      btn.addEventListener("click", function () {
        if (container.classList.contains("answered")) return;

        if (isMulti) {
          var set = multiSelections[qIdx];
          if (set.has(opt.label)) {
            set.delete(opt.label);
            btn.classList.remove("selected");
          } else {
            set.add(opt.label);
            btn.classList.add("selected");
          }
        } else {
          optionsDiv.querySelectorAll(".ask-user-option").forEach(function (b) {
            b.classList.remove("selected");
          });
          btn.classList.add("selected");
          answers[qIdx] = opt.label;
          var otherInput = qDiv.querySelector(".ask-user-other input");
          if (otherInput) otherInput.value = "";
        }
      });

      optionsDiv.appendChild(btn);
    });

    qDiv.appendChild(optionsDiv);

    // "Other" text input
    var otherDiv = document.createElement("div");
    otherDiv.className = "ask-user-other";
    var otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.placeholder = "Other...";
    otherInput.addEventListener("input", function () {
      if (container.classList.contains("answered")) return;
      if (otherInput.value.trim()) {
        optionsDiv.querySelectorAll(".ask-user-option").forEach(function (b) {
          b.classList.remove("selected");
        });
        if (isMulti) multiSelections[qIdx] = new Set();
        answers[qIdx] = otherInput.value.trim();
      }
    });
    otherInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
      }
    });
    otherDiv.appendChild(otherInput);
    qDiv.appendChild(otherDiv);
    container.appendChild(qDiv);
  });

  // Submit button: always show
  var submitBtn = document.createElement("button");
  submitBtn.className = "ask-user-submit";
  submitBtn.textContent = "Submit";
  submitBtn.addEventListener("click", function () {
    submitAskUserAnswer(container, toolId, questions, answers, multiSelections);
  });
  container.appendChild(submitBtn);

  // Skip button
  var skipBtn = document.createElement("button");
  skipBtn.className = "ask-user-skip";
  skipBtn.textContent = "Skip";
  skipBtn.addEventListener("click", function () {
    if (container.classList.contains("answered")) return;
    container.classList.add("answered");
    enableMainInput();
    if (ctx.ws && ctx.connected) {
      ctx.ws.send(JSON.stringify({ type: "stop" }));
    }
  });
  container.appendChild(skipBtn);

  // Mate DM: move all content into the bubble content wrapper
  if (mateContentWrap) {
    var children = [];
    for (var ci = 0; ci < container.childNodes.length; ci++) {
      if (container.childNodes[ci] !== container.querySelector(".dm-bubble-avatar")) {
        children.push(container.childNodes[ci]);
      }
    }
    for (var cj = 0; cj < children.length; cj++) {
      mateContentWrap.appendChild(children[cj]);
    }
    container.appendChild(mateContentWrap);
  }

  ctx.addToMessages(container);
  disableMainInput();
  ctx.setActivity(null);
  maybeScrollToBottom();
}

export function disableMainInput() {
  ctx.inputEl.disabled = true;
  ctx.inputEl.placeholder = "Answer the question above to continue...";
}

export function enableMainInput() {
  ctx.inputEl.disabled = false;
  if (document.body.classList.contains("mate-dm-active") && document.body.dataset.mateName) {
    ctx.inputEl.placeholder = "Message " + document.body.dataset.mateName + "...";
  } else {
    var _v = store.get('currentVendor') || "claude";
    ctx.inputEl.placeholder = "Message " + (VENDOR_NAMES[_v] || VENDOR_NAMES.claude) + "...";
  }
}

function submitAskUserAnswer(container, toolId, questions, answers, multiSelections) {
  if (container.classList.contains("answered")) return;

  var result = {};
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    if (q.multiSelect && multiSelections[i] && multiSelections[i].size > 0) {
      result[i] = Array.from(multiSelections[i]).join(", ");
    } else if (answers[i]) {
      result[i] = answers[i];
    }
  }

  if (Object.keys(result).length === 0) return;

  container.classList.add("answered");
  enableMainInput();
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  // Show user's answers inline
  showAnswerSummary(container, questions, result);

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({
      type: "ask_user_response",
      toolId: toolId,
      answers: result,
    }));
  }
}

function showAnswerSummary(container, questions, answers) {
  if (!answers || Object.keys(answers).length === 0) return;
  var existing = container.querySelector(".ask-user-answer-summary");
  if (existing) return;
  var summary = document.createElement("div");
  summary.className = "ask-user-answer-summary";
  for (var key in answers) {
    if (!answers.hasOwnProperty(key)) continue;
    var row = document.createElement("div");
    row.className = "ask-user-answer-row";
    var qi = parseInt(key, 10);
    var label = (questions && questions[qi] && questions[qi].question) ? questions[qi].question : "Answer";
    row.innerHTML = '<span class="ask-user-answer-label">' + escapeHtml(label) + '</span>' +
      '<span class="ask-user-answer-value">' + escapeHtml(String(answers[key])) + '</span>';
    summary.appendChild(row);
  }
  // Insert before submit button
  var submitBtn = container.querySelector(".ask-user-submit");
  if (submitBtn) {
    submitBtn.parentNode.insertBefore(summary, submitBtn);
  } else {
    container.appendChild(summary);
  }
}

export function markAskUserAnswered(toolId, answers) {
  var container = document.querySelector('.ask-user-container[data-tool-id="' + toolId + '"]');
  if (container && !container.classList.contains("answered")) {
    container.classList.add("answered");
    enableMainInput();
    // Restore answers from history replay
    if (answers && Object.keys(answers).length > 0) {
      // Find matching questions from the tool_executing input
      var questions = null;
      var askQuestions = container.querySelectorAll(".ask-user-question");
      if (askQuestions.length > 0) {
        questions = [];
        for (var qi = 0; qi < askQuestions.length; qi++) {
          var qTextEl = askQuestions[qi].querySelector(".ask-user-question-text");
          questions.push({ question: qTextEl ? qTextEl.textContent : "" });
        }
      }
      showAnswerSummary(container, questions, answers);
      // Also mark selected options to match the answers
      for (var key in answers) {
        if (!answers.hasOwnProperty(key)) continue;
        var idx = parseInt(key, 10);
        if (askQuestions[idx]) {
          var answerVal = String(answers[key]);
          var options = askQuestions[idx].querySelectorAll(".ask-user-option");
          var matched = false;
          for (var oi = 0; oi < options.length; oi++) {
            var labelEl = options[oi].querySelector(".option-label");
            if (labelEl && labelEl.textContent === answerVal) {
              options[oi].classList.add("selected");
              matched = true;
            }
          }
          // If not matched to an option, fill the "Other" input
          if (!matched) {
            var otherInput = askQuestions[idx].querySelector(".ask-user-other input");
            if (otherInput) otherInput.value = answerVal;
          }
        }
      }
    }
  }
}

// --- Permission request ---
function permissionInputSummary(toolName, input) {
  if (!input || typeof input !== "object") return "";
  switch (toolName) {
    case "Bash": return input.command || input.description || "";
    case "Edit": return shortPath(input.file_path);
    case "Write": return shortPath(input.file_path);
    case "Read": return shortPath(input.file_path);
    case "Glob": return input.pattern || "";
    case "Grep": return (input.pattern || "") + (input.path ? " in " + shortPath(input.path) : "");
    default: return toolSummary(toolName, input);
  }
}

export function renderPermissionRequest(requestId, toolName, toolInput, decisionReason, mateId, vendor) {
  if (pendingPermissions[requestId]) return;
  ctx.finalizeAssistantBlock();
  stopThinking();
  closeToolGroup();

  // ExitPlanMode: render as plan confirmation instead of generic permission
  if (toolName === "ExitPlanMode") {
    renderPlanPermission(requestId);
    return;
  }

  // Channel layout or Mate DM: conversational "Can I ...?" style
  if ((ctx.isMateDm && ctx.isMateDm()) || getChatLayout() === "channel") {
    renderConversationalPermission(requestId, toolName, toolInput, mateId, vendor);
    return;
  }

  // Bubble layout: formal "Permission Required" dialog
  renderFormalPermission(requestId, toolName, toolInput, decisionReason);
}

function renderFormalPermission(requestId, toolName, toolInput, decisionReason) {
  var container = document.createElement("div");
  container.className = "permission-container";
  container.dataset.requestId = requestId;

  // Header
  var header = document.createElement("div");
  header.className = "permission-header";
  header.innerHTML =
    '<span class="permission-icon">' + iconHtml("shield") + '</span>' +
    '<span class="permission-title">Permission Required</span>';

  // Body
  var body = document.createElement("div");
  body.className = "permission-body";

  var summary = document.createElement("div");
  summary.className = "permission-summary";
  var summaryText = permissionInputSummary(toolName, toolInput);
  summary.innerHTML =
    '<span class="permission-tool-name"></span>' +
    (summaryText ? '<span class="permission-tool-desc"></span>' : '');
  summary.querySelector(".permission-tool-name").textContent = toolName;
  if (summaryText) {
    summary.querySelector(".permission-tool-desc").textContent = summaryText;
  }
  body.appendChild(summary);

  if (decisionReason) {
    var reason = document.createElement("div");
    reason.className = "permission-reason";
    reason.textContent = decisionReason;
    body.appendChild(reason);
  }

  // Collapsible details
  var details = document.createElement("details");
  details.className = "permission-details";
  var detailsSummary = document.createElement("summary");
  detailsSummary.textContent = "Details";
  var detailsPre = document.createElement("pre");
  detailsPre.textContent = JSON.stringify(toolInput, null, 2);
  details.appendChild(detailsSummary);
  details.appendChild(detailsPre);
  body.appendChild(details);

  // Actions
  var actions = document.createElement("div");
  actions.className = "permission-actions";

  var allowBtn = document.createElement("button");
  allowBtn.className = "permission-btn permission-allow";
  allowBtn.textContent = "Allow Once";
  allowBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "allow");
  });

  var allowAlwaysBtn = document.createElement("button");
  allowAlwaysBtn.className = "permission-btn permission-allow-session";
  allowAlwaysBtn.textContent = "Allow for Session";
  allowAlwaysBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "allow_always");
  });

  var denyBtn = document.createElement("button");
  denyBtn.className = "permission-btn permission-deny";
  denyBtn.textContent = "Deny";
  denyBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "deny");
  });

  actions.appendChild(allowBtn);
  actions.appendChild(allowAlwaysBtn);
  actions.appendChild(denyBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(actions);
  ctx.addToMessages(container);

  pendingPermissions[requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  maybeScrollToBottom();
}

function renderPlanPermission(requestId) {
  if (pendingPermissions[requestId]) return;
  var container = document.createElement("div");
  container.className = "permission-container plan-permission";
  container.dataset.requestId = requestId;

  // Header
  var header = document.createElement("div");
  header.className = "permission-header plan-permission-header";
  header.innerHTML =
    '<span class="permission-icon">' + iconHtml("check-circle") + '</span>' +
    '<span class="permission-title">Plan Approval</span>';

  // Body (plan content already visible above, no need to repeat)
  var body = document.createElement("div");
  body.className = "permission-body";

  // Actions row 1: main buttons
  var actions = document.createElement("div");
  actions.className = "permission-actions plan-permission-actions";

  // Option 1: Clear context & auto-accept
  var clearBtn = document.createElement("button");
  clearBtn.className = "permission-btn plan-btn-clear";
  var contextPct = ctx.getContextPercent ? ctx.getContextPercent() : 0;
  clearBtn.innerHTML = iconHtml("refresh-cw") + ' <span>Clear context' +
    (contextPct > 0 ? ' <span class="plan-ctx-pct">(' + contextPct + '% used)</span>' : '') +
    ' &amp; auto-accept</span>';
  clearBtn.addEventListener("click", function () {
    sendPlanResponse(container, requestId, "allow_clear_context");
  });

  // Option 2: Auto-accept edits
  var approveBtn = document.createElement("button");
  approveBtn.className = "permission-btn permission-allow";
  approveBtn.textContent = "Auto-accept edits";
  approveBtn.addEventListener("click", function () {
    sendPlanResponse(container, requestId, "allow_accept_edits");
  });

  // Option 3: Manually approve edits
  var manualBtn = document.createElement("button");
  manualBtn.className = "permission-btn permission-allow-session";
  manualBtn.textContent = "Manually approve";
  manualBtn.addEventListener("click", function () {
    sendPlanResponse(container, requestId, "allow");
  });

  // Option 4: Reject
  var rejectBtn = document.createElement("button");
  rejectBtn.className = "permission-btn permission-deny";
  rejectBtn.textContent = "Reject";
  rejectBtn.addEventListener("click", function () {
    sendPlanResponse(container, requestId, "deny");
  });

  actions.appendChild(clearBtn);
  actions.appendChild(approveBtn);
  actions.appendChild(manualBtn);
  actions.appendChild(rejectBtn);

  // Feedback input row (Option 4: tell Claude what to change)
  var feedbackRow = document.createElement("div");
  feedbackRow.className = "plan-feedback-row";
  var feedbackInput = document.createElement("input");
  feedbackInput.type = "text";
  feedbackInput.className = "plan-feedback-input";
  feedbackInput.placeholder = "Tell Claude what to change...";
  var feedbackSendBtn = document.createElement("button");
  feedbackSendBtn.className = "plan-feedback-send";
  feedbackSendBtn.innerHTML = iconHtml("arrow-up");
  feedbackSendBtn.disabled = true;

  feedbackInput.addEventListener("input", function () {
    feedbackSendBtn.disabled = !feedbackInput.value.trim();
  });
  feedbackInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && feedbackInput.value.trim()) {
      e.preventDefault();
      submitPlanFeedback();
    }
  });
  feedbackSendBtn.addEventListener("click", function () {
    if (feedbackInput.value.trim()) submitPlanFeedback();
  });

  function submitPlanFeedback() {
    var text = feedbackInput.value.trim();
    if (!text) return;
    sendPlanResponse(container, requestId, "deny_with_feedback", text);
  }

  feedbackRow.appendChild(feedbackInput);
  feedbackRow.appendChild(feedbackSendBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(actions);
  container.appendChild(feedbackRow);
  ctx.addToMessages(container);

  pendingPermissions[requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  maybeScrollToBottom();
  // Focus the feedback input after render
  setTimeout(function () { feedbackInput.focus(); }, 50);
}

function sendPlanResponse(container, requestId, decision, feedback) {
  if (container.classList.contains("resolved")) return;
  container.classList.add("resolved");
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  var labelMap = {
    "allow": "Approved (manual)",
    "allow_accept_edits": "Approved (auto-accept)",
    "allow_clear_context": "Approved (clear + auto-accept)",
    "deny": "Rejected",
    "deny_with_feedback": "Feedback sent",
  };
  var label = labelMap[decision] || decision;
  var isDeny = decision === "deny" || decision === "deny_with_feedback";
  var resolvedClass = isDeny ? "resolved-denied" : "resolved-allowed";
  container.classList.add(resolvedClass);

  // Replace actions + feedback with decision label
  var actionsEl = container.querySelector(".plan-permission-actions");
  if (actionsEl) {
    actionsEl.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
  }
  var feedbackRowEl = container.querySelector(".plan-feedback-row");
  if (feedbackRowEl) feedbackRowEl.remove();

  if (ctx.ws && ctx.connected) {
    var payload = {
      type: "permission_response",
      requestId: requestId,
      decision: decision,
    };
    if (feedback) payload.feedback = feedback;
    if (decision === "allow_clear_context" && planContent) {
      payload.planContent = planContent;
    }
    ctx.ws.send(JSON.stringify(payload));
  }

  delete pendingPermissions[requestId];
}

function matePermissionInfo(toolName, toolInput) {
  var input = toolInput && typeof toolInput === "object" ? toolInput : {};
  var verb = "use " + toolName;
  var target = "";

  switch (toolName) {
    case "Write": verb = "write to"; target = shortPath(input.file_path); break;
    case "Edit": verb = "edit"; target = shortPath(input.file_path); break;
    case "Read": verb = "read"; target = shortPath(input.file_path); break;
    case "Bash": verb = "run"; target = input.description || (input.command || "").substring(0, 80); break;
    case "Grep": verb = "search"; target = input.pattern || ""; break;
    case "Glob": verb = "search for files in"; target = input.pattern || ""; break;
    case "WebFetch": verb = "fetch"; target = input.url || ""; break;
    case "WebSearch": verb = "search the web for"; target = input.query || ""; break;
  }
  return { verb: verb, target: target };
}

function resolvePermissionIdentity(mateId, vendor) {
  // Mate DM: use DM target mate info
  if (ctx.isMateDm && ctx.isMateDm()) {
    var name = ctx.getMateName();
    var avatar = ctx.getMateAvatarUrl();
    // Override if specific mateId provided (e.g. @mention)
    if (mateId && ctx.getMateById) {
      var mentionMate = ctx.getMateById(mateId);
      if (mentionMate) {
        name = (mentionMate.profile && mentionMate.profile.displayName) || mentionMate.displayName || mentionMate.name || name;
        avatar = mateAvatarUrl(mentionMate, 36);
      }
    }
    return { name: name, avatar: avatar };
  }
  // Channel with Mate mention
  if (mateId && ctx.getMateById) {
    var mate = ctx.getMateById(mateId);
    if (mate) {
      return {
        name: (mate.profile && mate.profile.displayName) || mate.displayName || mate.name || "Mate",
        avatar: mateAvatarUrl(mate, 36)
      };
    }
  }
  // Project chat: use vendor name and avatar
  var vendorAvatars = {
    claude: "/claude-code-avatar.png",
    codex: "/codex-avatar.png",
    antigravity: "/antigravity-avatar.png",
    opencode: "/opencode-avatar.svg",
    kimi: "/kimi-avatar.svg",
    grok: "/grok-avatar.svg",
    copilot: "/copilot-avatar.svg",
    qwen: "/qwen-avatar.svg",
    junie: "/junie-avatar.svg",
    kiro: "/kiro-avatar.svg",
  };
  var vendorName = (vendor && VENDOR_NAMES[vendor]) || VENDOR_NAMES.claude;
  return {
    name: vendorName,
    avatar: (vendor && vendorAvatars[vendor]) || vendorAvatars.claude,
  };
}

function renderConversationalPermission(requestId, toolName, toolInput, mateId, vendor) {
  var identity = resolvePermissionIdentity(mateId, vendor);
  var info = matePermissionInfo(toolName, toolInput);
  var askMsg = "Can I " + info.verb + (info.target ? " " + info.target : "") + "?";

  var container = document.createElement("div");
  container.className = "permission-container mate-permission";
  container.dataset.requestId = requestId;

  // Avatar (left column)
  var avi = document.createElement("img");
  avi.className = "dm-bubble-avatar dm-bubble-avatar-mate";
  avi.src = identity.avatar;
  avi.alt = "";
  container.appendChild(avi);

  // Content (right column)
  var content = document.createElement("div");
  content.className = "dm-bubble-content";

  // Name + time header
  var headerRow = document.createElement("div");
  headerRow.className = "dm-bubble-header";
  headerRow.innerHTML =
    '<span class="dm-bubble-name">' + escapeHtml(identity.name) + '</span>' +
    '<span class="dm-bubble-time">' + String(new Date().getHours()).padStart(2, "0") + ":" + String(new Date().getMinutes()).padStart(2, "0") + '</span>';
  content.appendChild(headerRow);

  // Ask text
  var askEl = document.createElement("div");
  askEl.className = "mate-perm-ask";
  askEl.textContent = askMsg;
  content.appendChild(askEl);

  // Collapsible details
  var details = document.createElement("details");
  details.className = "mate-perm-details";
  var summary = document.createElement("summary");
  summary.textContent = "Details";
  var pre = document.createElement("pre");
  pre.textContent = JSON.stringify(toolInput, null, 2);
  details.appendChild(summary);
  details.appendChild(pre);
  content.appendChild(details);

  // Buttons
  var actions = document.createElement("div");
  actions.className = "permission-actions mate-permission-actions";

  var allowBtn = document.createElement("button");
  allowBtn.className = "mate-permission-reply mate-permission-allow";
  allowBtn.textContent = "Sure";
  allowBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "allow");
  });

  var alwaysBtn = document.createElement("button");
  alwaysBtn.className = "mate-permission-reply mate-permission-always";
  alwaysBtn.textContent = "Allow for session";
  alwaysBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "allow_always");
  });

  var denyBtn = document.createElement("button");
  denyBtn.className = "mate-permission-reply mate-permission-deny";
  denyBtn.textContent = "No";
  denyBtn.addEventListener("click", function () {
    sendPermissionResponse(container, requestId, "deny");
  });

  actions.appendChild(allowBtn);
  actions.appendChild(alwaysBtn);
  actions.appendChild(denyBtn);
  content.appendChild(actions);

  container.appendChild(content);

  ctx.addToMessages(container);
  pendingPermissions[requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  maybeScrollToBottom();
}

function sendPermissionResponse(container, requestId, decision) {
  if (container.classList.contains("resolved")) return;
  container.classList.add("resolved");
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  var label = decision === "deny" ? "Denied" : decision === "allow_always" ? "Allowed for session" : "Allowed";
  var resolvedClass = decision === "deny" ? "resolved-denied" : "resolved-allowed";
  container.classList.add(resolvedClass);

  // Replace actions with decision label
  var actions = container.querySelector(".permission-actions");
  if (actions) {
    actions.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
  }

  if (ctx.ws && ctx.connected) {
    ctx.ws.send(JSON.stringify({
      type: "permission_response",
      requestId: requestId,
      decision: decision,
    }));
  }

  delete pendingPermissions[requestId];
}

export function markPermissionResolved(requestId, decision) {
  var container = pendingPermissions[requestId];
  if (!container) {
    // Find by data attribute (history replay)
    container = ctx.messagesEl.querySelector('[data-request-id="' + requestId + '"]');
  }
  if (!container || container.classList.contains("resolved")) return;

  container.classList.add("resolved");

  // Plan-specific decisions
  var planLabelMap = {
    "allow_accept_edits": "Approved (auto-accept)",
    "allow_clear_context": "Approved (clear + auto-accept)",
    "deny_with_feedback": "Feedback sent",
  };
  var isDeny = decision === "deny" || decision === "deny_with_feedback";
  var resolvedClass = isDeny ? "resolved-denied" : "resolved-allowed";
  container.classList.add(resolvedClass);

  var label = planLabelMap[decision] || (decision === "deny" ? "Denied" : decision === "allow_always" ? "Allowed for session" : "Allowed");
  var actions = container.querySelector(".permission-actions") || container.querySelector(".plan-permission-actions");
  if (actions) {
    actions.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
  }
  // Remove feedback row if present (plan permission)
  var feedbackRow = container.querySelector(".plan-feedback-row");
  if (feedbackRow) feedbackRow.remove();

  delete pendingPermissions[requestId];
}

export function markPermissionCancelled(requestId) {
  var container = pendingPermissions[requestId];
  if (!container) {
    container = ctx.messagesEl.querySelector('[data-request-id="' + requestId + '"]');
  }
  if (!container || container.classList.contains("resolved")) return;

  container.classList.add("resolved", "resolved-cancelled");
  var actions = container.querySelector(".permission-actions");
  if (actions) {
    actions.innerHTML = '<span class="permission-decision-label">Cancelled</span>';
  }

  delete pendingPermissions[requestId];
}

// --- MCP elicitation rendering ---

var pendingElicitations = {};

export function renderElicitationRequest(msg) {
  if (pendingElicitations[msg.requestId]) return;
  ctx.finalizeAssistantBlock();
  stopThinking();
  closeToolGroup();

  var container = document.createElement("div");
  container.className = "permission-container elicitation-container";
  container.dataset.requestId = msg.requestId;

  // Header
  var header = document.createElement("div");
  header.className = "permission-header";
  header.innerHTML =
    '<span class="permission-icon">' + iconHtml("key") + '</span>' +
    '<span class="permission-title">' + escapeHtml(msg.serverName || "MCP Server") + ' requests input</span>';

  // Body
  var body = document.createElement("div");
  body.className = "permission-body";

  if (msg.message) {
    var messageEl = document.createElement("div");
    messageEl.className = "permission-reason";
    messageEl.textContent = msg.message;
    body.appendChild(messageEl);
  }

  // Form fields (form mode) or URL button (url mode)
  var formData = {};

  if (msg.mode === "url" && msg.url) {
    var urlInfo = document.createElement("div");
    urlInfo.className = "elicitation-url-info";
    urlInfo.style.cssText = "margin-top: 8px; font-size: 12px; color: var(--text-muted);";
    urlInfo.textContent = "Opens: " + msg.url;
    body.appendChild(urlInfo);
  } else if (msg.requestedSchema && msg.requestedSchema.properties) {
    var formEl = document.createElement("div");
    formEl.className = "elicitation-form";
    formEl.style.cssText = "margin-top: 8px; display: flex; flex-direction: column; gap: 8px;";

    var props = msg.requestedSchema.properties;
    var required = msg.requestedSchema.required || [];
    var propNames = Object.keys(props);
    for (var i = 0; i < propNames.length; i++) {
      var propName = propNames[i];
      var prop = props[propName];
      var isRequired = required.indexOf(propName) !== -1;

      var fieldWrapper = document.createElement("div");
      fieldWrapper.style.cssText = "display: flex; flex-direction: column; gap: 2px;";

      var label = document.createElement("label");
      label.style.cssText = "font-size: 12px; font-weight: 500; color: var(--text-secondary);";
      label.textContent = propName + (isRequired ? " *" : "");
      if (prop.description) {
        label.title = prop.description;
      }

      var input;
      if (prop.type === "boolean") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.propName = propName;
        input.dataset.propType = "boolean";
      } else if (prop.enum) {
        input = document.createElement("select");
        input.dataset.propName = propName;
        input.dataset.propType = "enum";
        input.style.cssText = "padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text-primary); font-size: 13px;";
        for (var ei = 0; ei < prop.enum.length; ei++) {
          var opt = document.createElement("option");
          opt.value = prop.enum[ei];
          opt.textContent = prop.enum[ei];
          input.appendChild(opt);
        }
      } else {
        input = document.createElement("input");
        input.type = prop.type === "number" || prop.type === "integer" ? "number" : "text";
        input.dataset.propName = propName;
        input.dataset.propType = prop.type || "string";
        input.placeholder = prop.description || propName;
        input.style.cssText = "padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text-primary); font-size: 13px;";
      }

      fieldWrapper.appendChild(label);
      fieldWrapper.appendChild(input);
      formEl.appendChild(fieldWrapper);
    }
    body.appendChild(formEl);
  }

  // Actions
  var actions = document.createElement("div");
  actions.className = "permission-actions";

  var acceptBtn = document.createElement("button");
  acceptBtn.className = "permission-btn permission-allow";

  if (msg.mode === "url" && msg.url) {
    acceptBtn.textContent = "Open & Approve";
    acceptBtn.addEventListener("click", function () {
      window.open(msg.url, "_blank");
      sendElicitationResponse(container, msg.requestId, "accept", {});
    });
  } else {
    acceptBtn.textContent = "Submit";
    acceptBtn.addEventListener("click", function () {
      // Collect form values
      var content = {};
      var inputs = container.querySelectorAll("[data-prop-name]");
      for (var j = 0; j < inputs.length; j++) {
        var inp = inputs[j];
        var name = inp.dataset.propName;
        var pType = inp.dataset.propType;
        if (pType === "boolean") {
          content[name] = inp.checked;
        } else if (pType === "number" || pType === "integer") {
          content[name] = Number(inp.value);
        } else {
          content[name] = inp.value;
        }
      }
      sendElicitationResponse(container, msg.requestId, "accept", content);
    });
  }

  var denyBtn = document.createElement("button");
  denyBtn.className = "permission-btn permission-deny";
  denyBtn.textContent = "Deny";
  denyBtn.addEventListener("click", function () {
    sendElicitationResponse(container, msg.requestId, "reject", null);
  });

  actions.appendChild(acceptBtn);
  actions.appendChild(denyBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(actions);
  ctx.addToMessages(container);

  pendingElicitations[msg.requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  maybeScrollToBottom();
}

function sendElicitationResponse(container, requestId, action, content) {
  if (container.classList.contains("resolved")) return;
  container.classList.add("resolved");
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  var label = action === "reject" ? "Denied" : "Submitted";
  var resolvedClass = action === "reject" ? "resolved-denied" : "resolved-allowed";
  container.classList.add(resolvedClass);

  var actions = container.querySelector(".permission-actions");
  if (actions) {
    actions.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
  }

  if (ctx.ws && ctx.connected) {
    var msg = {
      type: "elicitation_response",
      requestId: requestId,
      action: action,
    };
    if (action === "accept" && content) {
      msg.content = content;
    }
    ctx.ws.send(JSON.stringify(msg));
  }

  delete pendingElicitations[requestId];
}

export function markElicitationResolved(requestId, action) {
  var container = pendingElicitations[requestId];
  if (!container) {
    container = ctx.messagesEl.querySelector('.elicitation-container[data-request-id="' + requestId + '"]');
  }
  if (!container || container.classList.contains("resolved")) return;

  container.classList.add("resolved");
  var isDeny = action === "reject";
  container.classList.add(isDeny ? "resolved-denied" : "resolved-allowed");

  var label = isDeny ? "Denied" : "Submitted";
  var actionsEl = container.querySelector(".permission-actions");
  if (actionsEl) {
    actionsEl.innerHTML = '<span class="permission-decision-label">' + label + '</span>';
  }
  delete pendingElicitations[requestId];
}

// --- Host user dialog (SDK request_user_dialog) ---
// Generic, defensive renderer. We declare only kinds we handle in
// supportedDialogKinds (server side), but treat the payload as opaque: render
// a human message + any provided choices, fall back to Proceed/Cancel, and
// log the raw payload so unseen shapes can be refined. Cancel is always safe.

var pendingUserDialogs = {};

function sendUserDialogResponse(container, requestId, behavior, result) {
  if (container.classList.contains("resolved")) return;
  container.classList.add("resolved");
  if (ctx.stopUrgentBlink) ctx.stopUrgentBlink();

  var isCancel = behavior !== "completed";
  container.classList.add(isCancel ? "resolved-denied" : "resolved-allowed");

  var actions = container.querySelector(".permission-actions");
  if (actions) {
    actions.innerHTML = '<span class="permission-decision-label">' + (isCancel ? "Cancelled" : "Submitted") + '</span>';
  }

  if (ctx.ws && ctx.connected) {
    var msg = {
      type: "user_dialog_response",
      requestId: requestId,
      behavior: isCancel ? "cancelled" : "completed",
    };
    if (!isCancel) msg.result = result;
    ctx.ws.send(JSON.stringify(msg));
  }

  delete pendingUserDialogs[requestId];
}

export function renderUserDialogRequest(msg) {
  if (pendingUserDialogs[msg.requestId]) return;
  ctx.finalizeAssistantBlock();
  stopThinking();
  closeToolGroup();

  var payload = msg.payload || {};
  try { console.log("[user_dialog] kind=" + msg.dialogKind + " payload=", payload); } catch (e) {}

  var container = document.createElement("div");
  container.className = "permission-container user-dialog-container";
  container.dataset.requestId = msg.requestId;

  // Header
  var titleText = payload.title || "Claude needs a decision";
  var header = document.createElement("div");
  header.className = "permission-header";
  header.innerHTML =
    '<span class="permission-icon">' + iconHtml("key") + '</span>' +
    '<span class="permission-title">' + escapeHtml(titleText) + '</span>';

  // Body: best-effort human message from common payload fields
  var body = document.createElement("div");
  body.className = "permission-body";
  var messageText = payload.message || payload.prompt || payload.question || payload.text || "";
  if (messageText) {
    var messageEl = document.createElement("div");
    messageEl.className = "permission-reason";
    messageEl.textContent = String(messageText);
    body.appendChild(messageEl);
  }
  var kindEl = document.createElement("div");
  kindEl.className = "user-dialog-kind";
  kindEl.style.cssText = "margin-top: 6px; font-size: 11px; color: var(--text-muted);";
  kindEl.textContent = msg.dialogKind || "dialog";
  body.appendChild(kindEl);

  // Actions
  var actions = document.createElement("div");
  actions.className = "permission-actions";

  // If the payload carries explicit choices, render one button per choice.
  var choices = Array.isArray(payload.options) ? payload.options
    : Array.isArray(payload.choices) ? payload.choices
    : null;

  if (choices && choices.length) {
    for (var i = 0; i < choices.length; i++) {
      (function (choice) {
        var label = (choice && (choice.label || choice.title || choice.name)) || String(choice);
        var value = (choice && ("value" in choice)) ? choice.value : choice;
        var btn = document.createElement("button");
        btn.className = "permission-btn permission-allow";
        btn.textContent = label;
        btn.addEventListener("click", function () {
          sendUserDialogResponse(container, msg.requestId, "completed", value);
        });
        actions.appendChild(btn);
      })(choices[i]);
    }
  } else {
    var proceedBtn = document.createElement("button");
    proceedBtn.className = "permission-btn permission-allow";
    proceedBtn.textContent = "Proceed";
    proceedBtn.addEventListener("click", function () {
      sendUserDialogResponse(container, msg.requestId, "completed", {});
    });
    actions.appendChild(proceedBtn);
  }

  var cancelBtn = document.createElement("button");
  cancelBtn.className = "permission-btn permission-deny";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", function () {
    sendUserDialogResponse(container, msg.requestId, "cancelled", null);
  });
  actions.appendChild(cancelBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(actions);
  ctx.addToMessages(container);

  pendingUserDialogs[msg.requestId] = container;
  refreshIcons();
  ctx.setActivity(null);
  maybeScrollToBottom();
}

export function markUserDialogResolved(requestId, behavior) {
  var container = pendingUserDialogs[requestId];
  if (!container) {
    container = ctx.messagesEl.querySelector('.user-dialog-container[data-request-id="' + requestId + '"]');
  }
  if (!container || container.classList.contains("resolved")) return;

  container.classList.add("resolved");
  var isCancel = behavior !== "completed";
  container.classList.add(isCancel ? "resolved-denied" : "resolved-allowed");

  var actionsEl = container.querySelector(".permission-actions");
  if (actionsEl) {
    actionsEl.innerHTML = '<span class="permission-decision-label">' + (isCancel ? "Cancelled" : "Submitted") + '</span>';
  }
  delete pendingUserDialogs[requestId];
}

// --- Live thinking-token estimate ---
// Annotates the active thinking block's label with a running token estimate.
// No-op when no thinking block is active.
export function updateThinkingTokens(estimatedTokens) {
  updateThinkingTokenEstimate(estimatedTokens);
}

// --- Plan mode rendering ---
export function renderPlanBanner(type) {
  ctx.finalizeAssistantBlock();
  stopThinking();
  closeToolGroup();

  var el = document.createElement("div");
  el.className = "plan-banner";

  if (type === "enter") {
    inPlanMode = true;
    planContent = null;
    currentPlanCardEl = null;
    el.innerHTML =
      '<span class="plan-banner-icon">' + iconHtml("map") + '</span>' +
      '<span class="plan-banner-text">Entered plan mode</span>' +
      '<span class="plan-banner-hint">Exploring codebase and designing implementation...</span>';
    el.classList.add("plan-enter");
  } else {
    inPlanMode = false;
    el.innerHTML =
      '<span class="plan-banner-icon">' + iconHtml("check-circle") + '</span>' +
      '<span class="plan-banner-text">Plan ready for review</span>';
    el.classList.add("plan-exit");
  }

  ctx.addToMessages(el);
  refreshIcons();
  maybeScrollToBottom();
  return el;
}

export function renderPlanCard(content) {
  ctx.finalizeAssistantBlock();
  closeToolGroup();
  planContent = content;

  var el = currentPlanCardEl && currentPlanCardEl.isConnected ? currentPlanCardEl : null;
  var header;
  var body;
  var isNew = !el;
  if (!el) {
    el = document.createElement("div");
    el.className = "plan-card";

    header = document.createElement("div");
    header.className = "plan-card-header";
    header.innerHTML =
      '<span class="plan-card-icon">' + iconHtml("file-text") + '</span>' +
      '<span class="plan-card-title">Implementation Plan</span>' +
      '<button class="plan-card-copy" title="Copy plan">' + iconHtml("copy") + '</button>' +
      '<span class="plan-card-chevron">' + iconHtml("chevron-down") + '</span>';

    body = document.createElement("div");
    body.className = "plan-card-body";

    header.addEventListener("click", function () {
      el.classList.toggle("collapsed");
    });

    el.appendChild(header);
    el.appendChild(body);
    ctx.addToMessages(el);
    currentPlanCardEl = el;
  } else {
    header = el.querySelector(".plan-card-header");
    body = el.querySelector(".plan-card-body");
  }

  body.innerHTML = renderMarkdown(content);
  highlightCodeBlocks(body);
  renderMermaidBlocks(body);

  var copyBtn = header.querySelector(".plan-card-copy");
  if (copyBtn) {
    copyBtn.onclick = function (e) {
      e.stopPropagation();
      copyToClipboard(content).then(function () {
        copyBtn.innerHTML = iconHtml("check");
        refreshIcons();
        setTimeout(function () {
          copyBtn.innerHTML = iconHtml("copy");
          refreshIcons();
        }, 1500);
      });
    };
  }

  refreshIcons();
  if (isNew) maybeScrollToBottom();
  return el;
}

// --- Todo rendering ---
function todoStatusIcon(status) {
  switch (status) {
    case "completed": return iconHtml("check-circle");
    case "in_progress": return iconHtml("loader", "icon-spin");
    default: return iconHtml("circle");
  }
}

export function handleTodoWrite(input) {
  if (!input || !Array.isArray(input.todos)) return;
  todoMeta = normalizeTodoMeta(input.meta);
  todoItems = input.todos.map(function (t, i) {
    return {
      id: t.id || String(i + 1),
      content: t.content || t.subject || "",
      status: t.status || "pending",
      activeForm: t.activeForm || "",
    };
  });
  // A fresh TodoWrite during replay is just historical state. After replay
  // ends, applyDeadSessionTodoCompaction (called from history_done) decides
  // whether to compact. During live operation, sessionIsProcessing is true
  // and applyDeadSessionTodoCompaction is a no-op for compaction.
  renderTodoWidget();
  applyDeadSessionTodoCompaction();
}

export function handleTaskCreate(input) {
  if (!input) return;
  todoMeta = normalizeTodoMeta();
  var id = String(todoItems.length + 1);
  todoItems.push({
    id: id,
    content: input.subject || input.description || "",
    status: "pending",
    activeForm: input.activeForm || "",
  });
  renderTodoWidget();
}

export function handleTaskUpdate(input) {
  if (!input || !input.taskId) return;
  todoMeta = normalizeTodoMeta();
  for (var i = 0; i < todoItems.length; i++) {
    if (todoItems[i].id === input.taskId) {
      if (input.status === "deleted") {
        todoItems.splice(i, 1);
      } else {
        if (input.status) todoItems[i].status = input.status;
        if (input.subject) todoItems[i].content = input.subject;
        if (input.activeForm) todoItems[i].activeForm = input.activeForm;
      }
      break;
    }
  }
  renderTodoWidget();
}

function normalizeTodoMeta(meta) {
  if (meta && meta.variant === "plan") {
    return {
      variant: "plan",
      title: "Plan",
      icon: "map",
      showProgress: false,
      showCompletedCount: false,
      stickyEnabled: false,
    };
  }
  return {
    variant: "tasks",
    title: "Tasks",
    icon: "list-checks",
    showProgress: true,
    showCompletedCount: true,
    stickyEnabled: true,
  };
}

function renderTodoWidget() {
  if (todoItems.length === 0) {
    if (todoWidgetEl) { todoWidgetEl.remove(); todoWidgetEl = null; }
    if (todoObserver) { todoObserver.disconnect(); todoObserver = null; }
    todoWidgetVisible = true;
    todoMeta = normalizeTodoMeta();
    updateTodoSticky();
    return;
  }

  var isNew = !todoWidgetEl;
  if (isNew) {
    todoWidgetEl = document.createElement("div");
    todoWidgetEl.className = "todo-widget";
  }
  todoWidgetEl.className = "todo-widget"
    + (todoMeta.variant === "plan" ? " todo-widget-plan" : "")
    + (todoDeadCompact ? " todo-widget-dead-compact" : "");

  var completed = 0;
  for (var i = 0; i < todoItems.length; i++) {
    if (todoItems[i].status === "completed") completed++;
  }

  var countText = todoMeta.showCompletedCount
    ? (completed + "/" + todoItems.length)
    : (todoItems.length + " " + (todoItems.length === 1 ? "step" : "steps"));

  var html = '<div class="todo-header">' +
    '<span class="todo-header-icon">' + iconHtml(todoMeta.icon) + '</span>' +
    '<span class="todo-header-title">' + todoMeta.title + '</span>' +
    '<span class="todo-header-count">' + countText + '</span>' +
    '</div>';
  if (todoMeta.showProgress) {
    html += '<div class="todo-progress"><div class="todo-progress-bar" style="width:' +
      (todoItems.length > 0 ? Math.round(completed / todoItems.length * 100) : 0) + '%"></div></div>';
  }
  html += '<div class="todo-items">';
  for (var i = 0; i < todoItems.length; i++) {
    var t = todoItems[i];
    var statusClass = t.status === "completed" ? "completed" : t.status === "in_progress" ? "in-progress" : "pending";
    html += '<div class="todo-item ' + statusClass + '">' +
      '<span class="todo-item-icon">' + todoStatusIcon(t.status) + '</span>' +
      '<span class="todo-item-text">' + escapeHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content) + '</span>' +
      '</div>';
  }
  html += '</div>';

  todoWidgetEl.innerHTML = html;

  if (isNew) {
    ctx.addToMessages(todoWidgetEl);
    setupTodoObserver();
    // Click-to-expand for compact mode. Toggling the override class lets
    // the user inspect items without permanently un-compacting the widget.
    todoWidgetEl.addEventListener("click", function (e) {
      if (!todoWidgetEl.classList.contains("todo-widget-dead-compact")) return;
      // Only expand on header click, not on items inside an already-expanded view
      var header = e.target.closest(".todo-header");
      if (!header) return;
      todoWidgetEl.classList.toggle("todo-widget-dead-expanded");
    });
  }
  updateTodoSticky();
  refreshIcons();
  maybeScrollToBottom();
}

export function applyDeadSessionTodoCompaction() {
  // Called after history_done and on status changes. Decides whether the
  // current session is "dead" (resumed, no live SDK process) and whether
  // the todo widget has unfinished items that will never resolve.
  var isLive = !!store.get('sessionIsProcessing');
  var hasUnfinished = false;
  for (var i = 0; i < todoItems.length; i++) {
    var s = todoItems[i].status;
    if (s === "in_progress" || s === "pending") { hasUnfinished = true; break; }
  }
  todoDeadCompact = !isLive && hasUnfinished;
  if (todoWidgetEl) {
    todoWidgetEl.classList.toggle("todo-widget-dead-compact", todoDeadCompact);
    if (!todoDeadCompact) todoWidgetEl.classList.remove("todo-widget-dead-expanded");
  }
}

function setupTodoObserver() {
  if (todoObserver) { todoObserver.disconnect(); todoObserver = null; }
  if (!todoWidgetEl) return;

  var messagesEl = document.getElementById("messages");
  if (!messagesEl) return;

  todoObserver = new IntersectionObserver(function (entries) {
    todoWidgetVisible = entries[0].isIntersecting;
    updateTodoStickyVisibility();
  }, { root: messagesEl, threshold: 0 });

  todoObserver.observe(todoWidgetEl);
}

function updateTodoStickyVisibility() {
  var stickyEl = document.getElementById("todo-sticky");
  if (!stickyEl) return;
  if (!todoMeta.stickyEnabled) {
    stickyEl.classList.add("hidden");
    return;
  }

  if (todoWidgetVisible) {
    stickyEl.classList.add("hidden");
  } else {
    // Only show if there are active (non-completed) tasks
    var hasActive = false;
    for (var i = 0; i < todoItems.length; i++) {
      if (todoItems[i].status !== "completed") { hasActive = true; break; }
    }
    if (hasActive) {
      stickyEl.classList.remove("hidden");
    }
  }
}

function updateTodoSticky() {
  var stickyEl = document.getElementById("todo-sticky");
  if (!stickyEl) return;
  if (!todoMeta.stickyEnabled) {
    stickyEl.classList.add("hidden");
    stickyEl.innerHTML = "";
    return;
  }

  // Hide if no active tasks (all completed or empty)
  var hasActive = false;
  for (var i = 0; i < todoItems.length; i++) {
    if (todoItems[i].status !== "completed") { hasActive = true; break; }
  }
  if (!hasActive) {
    stickyEl.classList.add("hidden");
    return;
  }

  var completed = 0;
  for (var i = 0; i < todoItems.length; i++) {
    if (todoItems[i].status === "completed") completed++;
  }
  var pct = Math.round(completed / todoItems.length * 100);
  var wasCollapsed = stickyEl.innerHTML === "" ? true : stickyEl.classList.contains("collapsed");

  var inProgressItem = null;
  for (var j = 0; j < todoItems.length; j++) {
    if (todoItems[j].status === "in_progress") { inProgressItem = todoItems[j]; break; }
  }

  var html = '<div class="todo-sticky-inner">' +
    '<div class="todo-sticky-header">' +
    '<span class="todo-sticky-icon">' + iconHtml("list-checks") + '</span>' +
    '<span class="todo-sticky-title">Tasks</span>' +
    (inProgressItem ? '<span class="todo-sticky-active">' + iconHtml("loader", "icon-spin") + ' ' + escapeHtml(inProgressItem.activeForm || inProgressItem.content) + '</span>' : '') +
    '<span class="todo-sticky-count">' + completed + '/' + todoItems.length + '</span>' +
    '<span class="todo-sticky-chevron">' + iconHtml("chevron-down") + '</span>' +
    '</div>' +
    '<div class="todo-sticky-progress"><div class="todo-sticky-progress-bar" style="width:' + pct + '%"></div></div>' +
    '<div class="todo-sticky-items">';

  for (var i = 0; i < todoItems.length; i++) {
    var t = todoItems[i];
    var statusClass = t.status === "completed" ? "completed" : t.status === "in_progress" ? "in-progress" : "pending";
    html += '<div class="todo-sticky-item ' + statusClass + '">' +
      '<span class="todo-sticky-item-icon">' + todoStatusIcon(t.status) + '</span>' +
      '<span class="todo-sticky-item-text">' + escapeHtml(t.status === "in_progress" && t.activeForm ? t.activeForm : t.content) + '</span>' +
      '</div>';
  }

  html += '</div></div>';
  stickyEl.innerHTML = html;

  // Only show sticky when in-chat widget is not visible in viewport
  if (todoWidgetVisible) {
    stickyEl.classList.add("hidden");
  } else {
    stickyEl.classList.remove("hidden");
  }
  if (wasCollapsed) stickyEl.classList.add("collapsed");

  stickyEl.querySelector(".todo-sticky-header").addEventListener("click", function () {
    stickyEl.classList.toggle("collapsed");
  });

  refreshIcons();
}

// --- Thinking ---
export function startThinking() {
  ctx.finalizeAssistantBlock();
  var el = startThinkingSegment();
  if (!ctx.isMateDm()) {
    ctx.setActivity("thinking");
  }
  return el;
}

export function appendThinking(text) {
  appendThinkingText(text);
}

export function stopThinking(duration) {
  stopThinkingSegment(duration);
}

export function resetThinkingGroup() {
  resetThinkingTurn();
}

// --- Tool items ---
export function createToolItem(id, name) {
  ctx.finalizeAssistantBlock();
  stopThinking();

  // Group management: create new group or reuse existing open group
  if (!currentToolGroup || currentToolGroup.closed) {
    toolGroupCounter++;
    var groupEl = document.createElement("div");
    groupEl.className = "tool-group";
    var isMateToolGroup = ctx.isMateDm();
    if (isMateToolGroup) groupEl.classList.add("mate-tool-group");
    groupEl.dataset.groupId = "g" + toolGroupCounter;

    var toolGroupInner =
      '<div class="tool-group-header" style="display:none">' +
      '<span class="tool-group-chevron">' + iconHtml("chevron-right") + '</span>' +
      '<span class="tool-group-bullet"></span>' +
      '<span class="tool-group-label">Running...</span>' +
      '<span class="tool-group-status-icon">' + iconHtml("loader", "icon-spin") + '</span>' +
      '</div>' +
      '<div class="tool-group-items"></div>';

    if (isMateToolGroup) {
      var mateAvatar = ctx.getMateAvatarUrl();
      groupEl.innerHTML =
        '<img class="dm-bubble-avatar dm-bubble-avatar-mate" src="' + escapeHtml(mateAvatar) + '" alt="">' +
        '<div class="dm-bubble-content">' + toolGroupInner + '</div>';
    } else {
      groupEl.innerHTML = toolGroupInner;
    }

    groupEl.querySelector(".tool-group-header").addEventListener("click", function () {
      groupEl.classList.toggle("collapsed");
      if (currentToolGroup) currentToolGroup.userToggled = true;
    });

    ctx.addToMessages(groupEl);
    refreshIcons();

    currentToolGroup = {
      el: groupEl,
      id: "g" + toolGroupCounter,
      toolNames: [],
      toolCount: 0,
      doneCount: 0,
      errorCount: 0,
      closed: false,
    };
    toolGroups[currentToolGroup.id] = currentToolGroup;
  }

  var el = document.createElement("div");
  el.className = "tool-item";
  el.dataset.toolId = id;
  el.innerHTML =
    '<div class="tool-header">' +
    '<span class="tool-chevron">' + iconHtml("chevron-right") + '</span>' +
    '<span class="tool-bullet"></span>' +
    '<span class="tool-name"></span>' +
    '<span class="tool-desc"></span>' +
    '<span class="tool-status-icon">' + iconHtml("loader", "icon-spin") + '</span>' +
    '</div>' +
    '<div class="tool-subtitle">' +
    '<span class="tool-connector">&#9492;</span>' +
    '<span class="tool-subtitle-text">Running...</span>' +
    '</div>';

  el.querySelector(".tool-name").textContent = name;

  // Append to group instead of messages directly
  currentToolGroup.el.querySelector(".tool-group-items").appendChild(el);
  currentToolGroup.toolNames.push(name);
  currentToolGroup.toolCount++;
  updateToolGroupHeader(currentToolGroup);

  refreshIcons();
  maybeScrollToBottom();

  tools[id] = { el: el, name: name, input: null, done: false, groupId: currentToolGroup.id };
  ctx.setActivity("Running " + name + "...");
}

export function updateToolExecuting(id, name, input) {
  var tool = tools[id];
  if (!tool) return;

  tool.input = input;
  var descEl = tool.el.querySelector(".tool-desc");
  descEl.textContent = toolSummary(name, input);

  // Make file path clickable for Read/Edit/Write tools
  var filePath = input && input.file_path;
  if (filePath && (name === "Read" || name === "Edit" || name === "Write")) {
    descEl.classList.add("tool-desc-link");
    descEl.dataset.filePath = filePath;
    descEl.insertAdjacentHTML("beforeend", '<span class="tool-desc-link-icon">' + iconHtml("external-link") + '</span>');
    refreshIcons();
    (function (toolName, toolInput) {
      descEl.onclick = function (e) {
        e.stopPropagation();
        if (toolName === "Edit" && toolInput && (toolInput.old_string || toolInput.new_string)) {
          openFile(filePath, { diff: { oldStr: toolInput.old_string || "", newStr: toolInput.new_string || "" } });
        } else {
          openFile(filePath);
        }
      };
    })(name, input);
  }

  ctx.setActivity(toolActivityText(name, input));

  var subtitleText = tool.el.querySelector(".tool-subtitle-text");
  if (subtitleText) subtitleText.textContent = toolActivityText(name, input);

  maybeScrollToBottom();
}

// Shared chrome (filename header + unified/split toggle) for diff renderings.
// makeUnified and makeSplit are factories that return a fresh body element.
function buildDiffChrome(filePath, linkOldStr, linkNewStr, makeUnified, makeSplit) {
  var wrapper = document.createElement("div");
  wrapper.className = "edit-diff";

  var header = document.createElement("div");
  header.className = "edit-diff-header";

  var pathSpan = document.createElement("span");
  pathSpan.className = "edit-diff-path edit-diff-path-link";
  pathSpan.textContent = filePath || "";
  if (filePath) {
    (function (fp, os, ns) {
      pathSpan.addEventListener("click", function (e) {
        e.stopPropagation();
        openFile(fp, { diff: { oldStr: os || "", newStr: ns || "" } });
      });
    })(filePath, linkOldStr, linkNewStr);
  }
  header.appendChild(pathSpan);

  var isMobile = "ontouchstart" in window;
  var isSplit = false;

  var unifiedBtn = document.createElement("button");
  unifiedBtn.className = "edit-diff-toggle active";
  unifiedBtn.innerHTML = iconHtml("list");
  unifiedBtn.title = "Unified view";

  var splitBtn = document.createElement("button");
  splitBtn.className = "edit-diff-toggle";
  splitBtn.innerHTML = iconHtml("columns-2");
  splitBtn.title = "Split view";

  var toggleWrap = document.createElement("span");
  toggleWrap.className = "edit-diff-toggles";
  if (isMobile) toggleWrap.style.display = "none";
  toggleWrap.appendChild(unifiedBtn);
  toggleWrap.appendChild(splitBtn);
  header.appendChild(toggleWrap);

  wrapper.appendChild(header);

  var currentBody = makeUnified();
  wrapper.appendChild(currentBody);

  unifiedBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!isSplit) return;
    isSplit = false;
    unifiedBtn.classList.add("active");
    splitBtn.classList.remove("active");
    wrapper.removeChild(currentBody);
    currentBody = makeUnified();
    wrapper.appendChild(currentBody);
    refreshIcons();
  });

  splitBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (isSplit) return;
    isSplit = true;
    splitBtn.classList.add("active");
    unifiedBtn.classList.remove("active");
    wrapper.removeChild(currentBody);
    currentBody = makeSplit();
    wrapper.appendChild(currentBody);
    refreshIcons();
  });

  return wrapper;
}

function renderEditDiff(oldStr, newStr, filePath) {
  var lang = getLanguageFromPath(filePath);
  return buildDiffChrome(
    filePath,
    oldStr,
    newStr,
    function () { return renderUnifiedDiff(oldStr, newStr, lang); },
    function () { return renderSplitDiff(oldStr, newStr, lang); }
  );
}

function renderPatchDiffBlock(patchText, filePath) {
  var lang = getLanguageFromPath(filePath);
  var sources = reconstructPatchSources(patchText);
  return buildDiffChrome(
    filePath,
    sources.oldStr,
    sources.newStr,
    function () { return renderPatchDiff(patchText, lang); },
    function () { return renderSplitDiff(sources.oldStr, sources.newStr, lang); }
  );
}

function isDiffContent(text) {
  var lines = text.split("\n");
  var hasHunkHeader = false;
  var hasPatchLine = false;
  for (var i = 0; i < Math.min(lines.length, 20); i++) {
    var l = lines[i];
    if (l.startsWith("@@")) hasHunkHeader = true;
    if (l.startsWith("---") || l.startsWith("+++")) hasPatchLine = true;
    if ((l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---"))) {
      hasPatchLine = true;
    }
  }
  return (hasHunkHeader && hasPatchLine) || hasPatchLine;
}

function getLanguageFromPath(filePath) {
  if (!filePath) return null;
  var parts = filePath.split("/");
  var filename = parts[parts.length - 1].toLowerCase();
  var dotIdx = filename.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === filename.length - 1) return null;
  var ext = filename.substring(dotIdx + 1);
  var map = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript", mts: "typescript",
    py: "python", rb: "ruby", rs: "rust", go: "go",
    java: "java", kt: "kotlin", kts: "kotlin",
    cs: "csharp", cpp: "cpp", cc: "cpp", c: "c", h: "c", hpp: "cpp",
    css: "css", scss: "scss", less: "less",
    html: "xml", htm: "xml", xml: "xml", svg: "xml",
    json: "json", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "bash", bash: "bash", zsh: "bash",
    sql: "sql", swift: "swift", php: "php",
    toml: "ini", ini: "ini", conf: "ini",
    lua: "lua", r: "r", pl: "perl",
    ex: "elixir", exs: "elixir",
    erl: "erlang", hs: "haskell",
    graphql: "graphql", gql: "graphql",
  };
  return map[ext] || null;
}

function parseLineNumberedContent(text) {
  var lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (lines.length === 0) return null;

  var pattern = /^\s*(\d+)[→\t](.*)$/;
  var checkCount = Math.min(lines.length, 5);
  var matchCount = 0;
  for (var i = 0; i < checkCount; i++) {
    if (pattern.test(lines[i])) matchCount++;
  }
  if (matchCount < Math.ceil(checkCount * 0.6)) return null;

  var numbers = [];
  var code = [];
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(pattern);
    if (m) {
      numbers.push(m[1]);
      code.push(m[2]);
    } else {
      numbers.push("");
      code.push(lines[i]);
    }
  }
  return { numbers: numbers, code: code };
}

var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

function isImagePath(filePath) {
  if (!filePath) return false;
  var dotIdx = filePath.lastIndexOf(".");
  if (dotIdx === -1) return false;
  return IMAGE_EXTS.has(filePath.substring(dotIdx).toLowerCase());
}

export function updateToolResult(id, content, isError, images) {
  var tool = tools[id];
  if (!tool) return;

  // Re-render the sublabel from the now-complete input (streaming can have
  // built it from a partial one), but in its terminal form: a result has
  // arrived, so this call is no longer running.
  var subtitleText = tool.el.querySelector(".tool-subtitle-text");
  if (subtitleText && tool.input) {
    subtitleText.textContent = toolTerminalText(tool.name, tool.input, isError);
  }

  var resultBlock = document.createElement("div");
  var displayContent = content || "(no output)";
  displayContent = displayContent.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (displayContent.length > 10000) displayContent = displayContent.substring(0, 10000) + "\n... (truncated)";

  var hasEditDiff = !isError && tool.name === "Edit" && tool.input && tool.input.old_string && tool.input.new_string;
  var expandByDefault = hasEditDiff || (!isError && tool.name === "Edit" && isDiffContent(displayContent));
  if (expandByDefault) {
    resultBlock.className = "tool-result-block";
    tool.el.classList.add("expanded");
  } else {
    resultBlock.className = "tool-result-block collapsed";
  }

  if (hasEditDiff) {
    resultBlock.appendChild(renderEditDiff(tool.input.old_string, tool.input.new_string, tool.input.file_path));
  } else if (!isError && isDiffContent(displayContent)) {
    var patchFilePath = tool.input && tool.input.file_path ? tool.input.file_path : null;
    if (patchFilePath) {
      resultBlock.appendChild(renderPatchDiffBlock(displayContent, patchFilePath));
    } else {
      resultBlock.appendChild(renderPatchDiff(displayContent, null));
    }
  } else if (!isError && tool.name === "Read" && tool.input && tool.input.file_path && isImagePath(tool.input.file_path)) {
    // Image file: show inline preview
    var imgWrap = document.createElement("div");
    imgWrap.className = "tool-result-image";
    var img = document.createElement("img");
    if (images && images.length > 0) {
      img.src = "data:" + images[0].mediaType + ";base64," + images[0].data;
    } else {
      img.src = "api/file?path=" + encodeURIComponent(tool.input.file_path);
    }
    img.alt = tool.input.file_path.split("/").pop();
    img.draggable = false;
    img.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (ctx.showImageModal) ctx.showImageModal(this.src);
    });
    imgWrap.appendChild(img);
    resultBlock.appendChild(imgWrap);
    resultBlock.className = "tool-result-block";
    tool.el.classList.add("expanded");
  } else if (!isError && tool.name === "Read" && tool.input && tool.input.file_path) {
    var parsed = parseLineNumberedContent(displayContent);
    if (parsed) {
      var lang = getLanguageFromPath(tool.input.file_path);
      var viewer = document.createElement("div");
      viewer.className = "code-viewer";

      var gutter = document.createElement("pre");
      gutter.className = "code-gutter";
      gutter.textContent = parsed.numbers.join("\n");

      var codeBlock = document.createElement("pre");
      codeBlock.className = "code-content";
      var codeText = parsed.code.join("\n");

      if (lang) {
        try {
          var highlighted = hljs.highlight(codeText, { language: lang });
          var codeEl = document.createElement("code");
          codeEl.className = "hljs language-" + lang;
          codeEl.innerHTML = highlighted.value;
          codeBlock.appendChild(codeEl);
        } catch (e) {
          codeBlock.textContent = codeText;
        }
      } else {
        codeBlock.textContent = codeText;
      }

      viewer.appendChild(gutter);
      viewer.appendChild(codeBlock);

      // Sync vertical scroll between gutter and code
      viewer.addEventListener("scroll", function () {
        gutter.scrollTop = viewer.scrollTop;
        codeBlock.scrollTop = viewer.scrollTop;
      });

      resultBlock.appendChild(viewer);
    } else {
      var pre = document.createElement("pre");
      pre.textContent = displayContent;
      resultBlock.appendChild(pre);
    }
  } else {
    var pre = document.createElement("pre");
    if (isError) pre.className = "is-error";
    pre.textContent = displayContent;
    resultBlock.appendChild(pre);
  }
  tool.el.appendChild(resultBlock);

  tool.el.querySelector(".tool-header").addEventListener("click", function () {
    resultBlock.classList.toggle("collapsed");
    tool.el.classList.toggle("expanded");
  });

  markToolDone(id, isError);
  maybeScrollToBottom();
}

export function markToolDone(id, isError) {
  var tool = tools[id];
  if (!tool || tool.done) return;

  tool.done = true;
  if (!tool.el) return; // hidden tool (plan mode)

  tool.el.classList.add("done");
  if (isError) tool.el.classList.add("error");

  var icon = tool.el.querySelector(".tool-status-icon");
  if (isError) {
    icon.innerHTML = '<span class="err-icon">' + iconHtml("alert-triangle") + '</span>';
  } else {
    icon.innerHTML = '<span class="check">' + iconHtml("check") + '</span>';
  }
  refreshIcons();

  // Update group state
  if (tool.groupId) {
    var group = findToolGroup(tool.groupId);
    if (group) {
      group.doneCount++;
      if (isError) group.errorCount++;
      updateToolGroupHeader(group);
    }
  }
}

export function markAllToolsDone() {
  for (var id in tools) {
    if (tools.hasOwnProperty(id) && !tools[id].done) {
      markToolDone(id, false);
    }
  }
}

// --- Sub-agent (Task tool) log ---
export function updateSubagentActivity(parentToolId, text) {
  var tool = tools[parentToolId];
  if (!tool || !tool.el) return;

  // Update subtitle text with current activity
  var subtitleText = tool.el.querySelector(".tool-subtitle-text");
  if (subtitleText) subtitleText.textContent = text;

  // Update or create the subagent log
  var log = tool.el.querySelector(".subagent-log");
  if (!log) {
    log = document.createElement("div");
    log.className = "subagent-log";
    tool.el.appendChild(log);
  }

  ctx.setActivity(text);
  maybeScrollToBottom();
}

export function addSubagentToolEntry(parentToolId, toolName, toolId, text) {
  var tool = tools[parentToolId];
  if (!tool || !tool.el) return;

  // Update subtitle
  var subtitleText = tool.el.querySelector(".tool-subtitle-text");
  if (subtitleText) subtitleText.textContent = text;

  // Create log if needed
  var log = tool.el.querySelector(".subagent-log");
  if (!log) {
    log = document.createElement("div");
    log.className = "subagent-log";
    tool.el.appendChild(log);
  }

  // Add entry
  var entry = document.createElement("div");
  entry.className = "subagent-log-entry";
  entry.innerHTML =
    '<span class="subagent-log-bullet"></span>' +
    '<span class="subagent-log-tool"></span>' +
    '<span class="subagent-log-text"></span>';
  entry.querySelector(".subagent-log-tool").textContent = toolName;
  entry.querySelector(".subagent-log-text").textContent = text;
  log.appendChild(entry);

  // Auto-scroll to latest entry
  log.scrollTop = log.scrollHeight;

  ctx.setActivity(text);
  maybeScrollToBottom();
}

function fmtTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function fmtDuration(ms) {
  var secs = Math.floor(ms / 1000);
  if (secs >= 60) return Math.floor(secs / 60) + "m " + (secs % 60) + "s";
  return secs + "s";
}

export function updateSubagentProgress(parentToolId, usage, lastToolName, summary) {
  var tool = tools[parentToolId];
  if (!tool || !tool.el) return;
  var progressEl = tool.el.querySelector(".subagent-progress");
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.className = "subagent-progress";
    var log = tool.el.querySelector(".subagent-log");
    if (log) tool.el.insertBefore(progressEl, log);
    else tool.el.appendChild(progressEl);
  }
  var parts = [];
  if (usage) {
    if (usage.total_tokens) parts.push(fmtTokens(usage.total_tokens) + " tokens");
    if (usage.tool_uses) parts.push(usage.tool_uses + " tools");
    if (usage.duration_ms) parts.push(fmtDuration(usage.duration_ms));
  }
  if (lastToolName) parts.push(lastToolName);
  progressEl.textContent = parts.join(" · ");

  // AI-generated progress summary (agentProgressSummaries)
  if (summary) {
    var summaryEl = tool.el.querySelector(".subagent-summary");
    if (!summaryEl) {
      summaryEl = document.createElement("div");
      summaryEl.className = "subagent-summary";
      progressEl.parentNode.insertBefore(summaryEl, progressEl.nextSibling);
    }
    summaryEl.textContent = summary;
  }
}

export function initSubagentStop(parentToolId, taskId) {
  var tool = tools[parentToolId];
  if (!tool || !tool.el) return;
  var header = tool.el.querySelector(".tool-header");
  if (!header || header.querySelector(".subagent-stop-btn")) return;
  var btn = document.createElement("button");
  btn.className = "subagent-stop-btn";
  btn.textContent = "Stop";
  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    if (ctx.ws) ctx.ws.send(JSON.stringify({ type: "stop_task", taskId: taskId, parentToolId: parentToolId }));
    btn.disabled = true;
    btn.textContent = "Stopping...";
  });
  header.appendChild(btn);
}

export function updateSubagentTaskStatus(parentToolId, patch) {
  var tool = tools[parentToolId];
  if (!tool || !tool.el) return;
  if (patch.description) {
    var summaryEl = tool.el.querySelector(".subagent-summary");
    if (!summaryEl) {
      var progressEl = tool.el.querySelector(".subagent-progress");
      if (progressEl) {
        summaryEl = document.createElement("div");
        summaryEl.className = "subagent-summary";
        progressEl.parentNode.insertBefore(summaryEl, progressEl.nextSibling);
      }
    }
    if (summaryEl) summaryEl.textContent = patch.description;
  }
  if (patch.status === "failed" || patch.status === "killed") {
    var subtitleText = tool.el.querySelector(".tool-subtitle-text");
    if (subtitleText) subtitleText.textContent = patch.status === "failed" ? "Agent failed" : "Agent killed";
    var stopBtn = tool.el.querySelector(".subagent-stop-btn");
    if (stopBtn) stopBtn.remove();
  }
}

export function markSubagentDone(parentToolId, status, summary, usage) {
  var tool = tools[parentToolId];
  if (!tool || !tool.el) return;

  var label = "Agent finished";
  if (status === "failed") label = "Agent failed";
  else if (status === "stopped") label = "Agent stopped";

  var subtitleText = tool.el.querySelector(".tool-subtitle-text");
  if (subtitleText) subtitleText.textContent = label;

  // Remove stop button
  var stopBtn = tool.el.querySelector(".subagent-stop-btn");
  if (stopBtn) stopBtn.remove();

  // Final usage update
  if (usage) updateSubagentProgress(parentToolId, usage, null);
}

var _lastCumulativeCost = 0;

export function resetTurnMetaCost() {
  _lastCumulativeCost = 0;
}

export function addTurnMeta(cost, duration) {
  closeToolGroup();
  var div = document.createElement("div");
  div.className = "turn-meta";
  div.dataset.turn = ctx.turnCounter;
  var parts = [];
  if (cost != null) {
    // cost is cumulative total_cost_usd from the SDK.
    // When the SDK session restarts, total_cost_usd resets to 0 so cost
    // can drop below _lastCumulativeCost.  In that case the entire cost
    // value IS the delta for this turn (fresh SDK session).
    var delta = cost - _lastCumulativeCost;
    if (delta < 0) delta = cost;
    _lastCumulativeCost = cost;
    var deltaStr = delta > 0 ? "+$" + delta.toFixed(4) : "$0.0000";
    parts.push(deltaStr + " \u2192 $" + cost.toFixed(4));
  }
  if (duration != null) parts.push((duration / 1000).toFixed(1) + "s");
  if (parts.length) {
    div.textContent = parts.join(" \u00b7 ");
    ctx.addToMessages(div);
    maybeScrollToBottom();
  }
}

// --- Tool group exports ---
export { closeToolGroup };

export function removeToolFromGroup(toolId) {
  var tool = tools[toolId];
  if (!tool || !tool.groupId) return;
  var group = findToolGroup(tool.groupId);
  if (!group) return;
  group.toolCount--;
  // Remove tool name from the names array (remove first occurrence)
  var idx = group.toolNames.indexOf(tool.name);
  if (idx !== -1) group.toolNames.splice(idx, 1);
  if (tool.done) group.doneCount--;
  updateToolGroupHeader(group);
}

// Expose state getters and reset
export function getTools() { return tools; }
export function isInPlanMode() { return inPlanMode; }
export function getPlanContent() { return planContent; }
export function setPlanContent(c) { planContent = c; }
export function isPlanFilePath(fp) { return isPlanFile(fp); }
export function getPlanModeTools() { return PLAN_MODE_TOOLS; }
export function getTodoTools() { return TODO_TOOLS; }
export function getHiddenResultTools() { return HIDDEN_RESULT_TOOLS; }

export function saveToolState() {
  return {
    tools: tools,
    thinkingState: saveThinkingState(),
    todoWidgetEl: todoWidgetEl,
    todoMeta: todoMeta,
    inPlanMode: inPlanMode,
    planContent: planContent,
    currentPlanCardEl: currentPlanCardEl,
    currentToolGroup: currentToolGroup,
    toolGroupCounter: toolGroupCounter,
    toolGroups: toolGroups,
    lastCumulativeCost: _lastCumulativeCost,
  };
}

export function restoreToolState(saved) {
  tools = saved.tools;
  restoreThinkingState(saved.thinkingState);
  todoWidgetEl = saved.todoWidgetEl;
  todoMeta = saved.todoMeta || normalizeTodoMeta();
  inPlanMode = saved.inPlanMode;
  planContent = saved.planContent;
  currentPlanCardEl = saved.currentPlanCardEl || null;
  currentToolGroup = saved.currentToolGroup;
  toolGroupCounter = saved.toolGroupCounter;
  toolGroups = saved.toolGroups;
  _lastCumulativeCost = saved.lastCumulativeCost || 0;
  if (todoWidgetEl) {
    setupTodoObserver();
  }
}

export function resetToolState() {
  tools = {};
  clearThinkingState();
  inPlanMode = false;
  planContent = null;
  currentPlanCardEl = null;
  todoItems = [];
  todoMeta = normalizeTodoMeta();
  todoWidgetEl = null;
  todoWidgetVisible = true;
  if (todoObserver) { todoObserver.disconnect(); todoObserver = null; }
  pendingPermissions = {};
  pendingElicitations = {};
  pendingUserDialogs = {};
  currentToolGroup = null;
  toolGroupCounter = 0;
  toolGroups = {};
  // NOTE: do NOT reset _lastCumulativeCost here — it must persist across
  // turns so addTurnMeta can compute per-turn deltas.  It is only cleared
  // on new conversation via resetTurnMetaCost().
  var stickyEl = document.getElementById("todo-sticky");
  if (stickyEl) { stickyEl.classList.add("hidden"); stickyEl.innerHTML = ""; }
}

export function initTools(_ctx) {
  ctx = _ctx;
}
