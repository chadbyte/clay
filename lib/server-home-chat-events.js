// Canonical session event projection for the embedded Home transcript.

function homeDebateQuestions(input) {
  var source = input && Array.isArray(input.questions) && input.questions[0] ? input.questions[0] : null;
  if (!source) return [];
  var question = { header: source.header || "", question: source.question || "", multiSelect: false, options: [] };
  var options = Array.isArray(source.options) ? source.options.slice(0, 6) : [];
  for (var i = 0; i < options.length; i++) question.options.push({ label: options[i].label || "Option", description: options[i].description || "" });
  return [question];
}

var HOME_DEBATE_EVENT_TYPES = {
  debate_started: true, debate_turn: true, debate_activity: true, debate_stream: true,
  debate_turn_done: true, debate_hand_raised: true, debate_comment_queued: true,
  debate_stop_requested: true, debate_stop_cancelled: true,
  debate_comment_injected: true, debate_conclude_confirm: true, debate_user_floor: true,
  debate_user_floor_done: true, debate_user_resume: true, debate_resumed: true,
  debate_tool_decision: true, debate_ended: true,
};

function findDebateHeader(messages) {
  for (var i = messages.length - 1; i >= 0; i--) if (messages[i].role === "debate_header") return messages[i];
  return null;
}

function findDebateTurn(messages, event) {
  for (var i = messages.length - 1; i >= 0; i--) {
    var message = messages[i];
    if (message.role !== "debate_turn") continue;
    if (event.turnId && message.turnId === event.turnId) return message;
    if (!event.turnId && message.status === "active" && (!event.mateId || message.mateId === event.mateId)) return message;
  }
  return null;
}

function debateIdentity(source, fallback) {
  var prior = fallback || {};
  return {
    avatarStyle: source.avatarStyle || prior.avatarStyle || "imprint",
    avatarSeed: source.avatarSeed || prior.avatarSeed || source.mateId || "mate",
    avatarColor: source.avatarColor || prior.avatarColor || "",
    avatarCustom: source.avatarCustom || prior.avatarCustom || "",
  };
}

function appendToolDecision(messages, event) {
  var entry = { decisionId: event.decisionId || null, mateId: event.mateId || null, mateName: event.mateName || "Mate", toolName: event.toolName || "Tool", action: event.action || "Use " + (event.toolName || "tool"), command: typeof event.command === "string" ? event.command : "", commandTruncated: event.commandTruncated === true, decision: event.decision === "allowed" ? "allowed" : "blocked", reason: event.reason || (event.decision === "allowed" ? "Read-only investigation" : "Not verified as read-only") };
  for (var i = messages.length - 1; i >= 0; i--) {
    var priorEntries = messages[i].role === "debate_tool_decision" ? (Array.isArray(messages[i].entries) ? messages[i].entries : [messages[i]]) : [];
    for (var j = 0; j < priorEntries.length; j++) if (entry.decisionId && priorEntries[j].decisionId === entry.decisionId) return;
  }
  var last = messages.length ? messages[messages.length - 1] : null;
  if (last && last.role === "debate_tool_decision") {
    if (!Array.isArray(last.entries)) last.entries = [];
    last.entries.push(entry);
    return;
  }
  messages.push(Object.assign({ role: "debate_tool_decision", entries: [entry] }, entry));
}

function applyDebateHistoryEvent(messages, event) {
  var header = findDebateHeader(messages);
  if (event.type === "debate_tool_decision") {
    appendToolDecision(messages, event);
    return;
  }
  if (event.type === "debate_started") {
    messages.push({ role: "debate_header", phase: "live", topic: event.topic || "Debate", format: event.format || "free_discussion", moderatorId: event.moderatorId || null, moderatorName: event.moderatorName || "Clay", panelists: Array.isArray(event.panelists) ? event.panelists : [], round: 1, interaction: null });
    return;
  }
  if (event.type === "debate_turn") {
    messages.push(Object.assign({ role: "debate_turn", turnId: event.turnId || "turn:" + messages.length, mateId: event.mateId || null, mateName: event.mateName || "Mate", speakerRole: event.role || "panelist", round: event.round || 1, text: "", activity: "", status: "active" }, debateIdentity(event)));
    if (header) { header.phase = "live"; header.round = event.round || header.round || 1; header.interaction = null; }
    return;
  }
  var turn = findDebateTurn(messages, event);
  if (event.type === "debate_activity" && turn) turn.activity = event.activity || "Thinking";
  if (event.type === "debate_stream" && turn) turn.text += event.delta || "";
  if (event.type === "debate_turn_done") {
    if (!turn) {
      turn = Object.assign({ role: "debate_turn", turnId: event.turnId || "turn:" + messages.length, mateId: event.mateId || null, mateName: event.mateName || "Mate", speakerRole: event.role || "panelist", round: event.round || 1, text: "", activity: "", status: "active" }, debateIdentity(event));
      messages.push(turn);
    }
    Object.assign(turn, debateIdentity(event, turn));
    turn.text = event.text || turn.text;
    turn.activity = "";
    turn.status = "done";
  }
  if (event.type === "debate_hand_raised" && header) header.handRaised = true;
  if (event.type === "debate_stop_requested" && header) header.stopping = true;
  if (event.type === "debate_stop_cancelled" && header) header.stopping = false;
  if (event.type === "debate_conclude_confirm" && header) header.interaction = "conclude";
  if (event.type === "debate_user_floor" && header) header.interaction = "user_floor";
  if (event.type === "debate_user_floor_done") {
    messages.push({ role: "debate_user", text: event.text || "" });
    if (header) { header.interaction = null; header.handRaised = false; }
  }
  if (event.type === "debate_comment_injected") messages.push({ role: "debate_user", text: event.text || "" });
  if (event.type === "debate_user_resume") messages.push({ role: "debate_user", text: event.text || "" });
  if (event.type === "debate_resumed" && header) { header.phase = "live"; header.interaction = null; header.round = event.round || header.round; }
  if (event.type === "debate_ended" && header) { header.phase = event.reason === "interrupted" ? "interrupted" : "ended"; header.reason = event.reason || "ended"; header.interaction = null; header.stopping = false; }
}

function applyAssignmentHistoryEvent(messages, event) {
  var assignment = event && event.assignment;
  if (!assignment || !assignment.assignmentId) return;
  for (var i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assignment" || !messages[i].assignment || messages[i].assignment.assignmentId !== assignment.assignmentId) continue;
    messages[i] = { role: "assignment", assignment: assignment };
    return;
  }
  messages.push({ role: "assignment", assignment: assignment });
}

function historyToHomeChat(history, debateSetupMode, mateCreationMode) {
  var messages = [];
  var pending = "";
  var interviewMode = debateSetupMode === true || mateCreationMode === true;
  function flushAssistant() {
    if (!pending) return;
    if (!interviewMode) messages.push({ role: "assistant", text: pending });
    pending = "";
  }
  for (var i = 0; i < history.length; i++) {
    var event = history[i];
    if (!event) continue;
    if (event.type === "project_assignment_proposal" || event.type === "project_assignment_status") {
      flushAssistant();
      applyAssignmentHistoryEvent(messages, event);
      continue;
    }
    if (debateSetupMode === true && HOME_DEBATE_EVENT_TYPES[event.type]) {
      flushAssistant();
      applyDebateHistoryEvent(messages, event);
      continue;
    }
    if (event.type === "capsule_turn") {
      // A Capsule engagement delivery. The transcript shows a short system
      // note; the full delivery prompt is model-facing, not conversation.
      flushAssistant();
      messages.push({
        role: "capsule_turn",
        text: (event.toolName || event.toolId || "Capsule") + (event.kind === "start" ? ": a new game started." : ": your Mate is taking its turn."),
      });
      continue;
    }
    if (event.type === "user_message" && event.text && event.askUserAnswer !== true && !interviewMode) {
      flushAssistant();
      messages.push({ role: "user", text: event.text });
    } else if (!interviewMode && (event.type === "tool_start" || event.type === "tool_executing" || event.type === "tool_result")) {
      // A tool call ends the current spoken burst. Without this flush the
      // text on both sides of the call concatenates into one run-on bubble,
      // which is exactly how a Capsule game transcript turns into a wall.
      flushAssistant();
    } else if (event.type === "delta" && typeof event.text === "string" && !interviewMode) {
      pending += event.text;
    } else if (event.type === "result" || event.type === "done") {
      flushAssistant();
    } else if (event.type === "error" && event.text) {
      flushAssistant();
      messages.push({ role: "assistant", text: "[error] " + event.text });
    } else if (event.type === "debate_proposal" && event.proposal) {
      flushAssistant();
      messages.push({ role: "proposal", proposal: event.proposal, status: "pending" });
    } else if (event.type === "debate_proposal_resolved" && event.proposalId) {
      for (var j = messages.length - 1; j >= 0; j--) {
        if (messages[j].role === "proposal" && messages[j].proposal && messages[j].proposal.proposalId === event.proposalId) {
          messages[j].status = event.action === "start" ? "started" : (event.action === "cancel" ? "cancelled" : "pending");
          messages[j].error = event.action === "error" ? (event.error || "The debate could not be started.") : "";
          break;
        }
      }
    } else if (event.type === "mate_creation_proposal" && event.proposal) {
      flushAssistant();
      messages.push({ role: "mate_proposal", proposal: event.proposal, status: "pending" });
    } else if (event.type === "mate_creation_proposal_resolved" && event.proposalId) {
      for (var mpi = messages.length - 1; mpi >= 0; mpi--) {
        if (messages[mpi].role === "mate_proposal" && messages[mpi].proposal && messages[mpi].proposal.proposalId === event.proposalId) {
          messages[mpi].status = event.action === "create" ? "created" : (event.action === "cancel" ? "cancelled" : "pending");
          messages[mpi].mateId = event.mateId || null;
          messages[mpi].error = event.action === "error" ? (event.error || "The Mate could not be created.") : "";
          break;
        }
      }
    } else if (interviewMode && event.type === "tool_executing" && event.name === "AskUserQuestion" && event.id && event.input) {
      flushAssistant();
      messages.push({ role: "question", flow: mateCreationMode === true ? "mate_creation" : "debate", toolId: event.id, questions: homeDebateQuestions(event.input), status: "pending", error: "" });
    } else if ((event.type === "ask_user_answered" || event.type === "home_debate_question_expired" || event.type === "home_mate_creation_question_expired") && event.toolId) {
      for (var k = messages.length - 1; k >= 0; k--) {
        if (messages[k].role === "question" && messages[k].toolId === event.toolId) {
          messages[k].status = event.type === "ask_user_answered" ? "answered" : "expired";
          messages[k].answers = event.answers || null;
          messages[k].error = event.error || "";
          break;
        }
      }
    }
  }
  flushAssistant();
  return messages;
}

// The authoritative text for the bubble being finalized: only the deltas
// since the last conversational boundary. Tool calls and Capsule turn
// deliveries are boundaries too, or a session that is never driven by typed
// user messages (a Capsule game) would collapse into one run-on bubble.
function latestAssistantText(history) {
  var text = "";
  for (var i = (history || []).length - 1; i >= 0; i--) {
    var event = history[i];
    if (!event) continue;
    if (event.type === "delta" && typeof event.text === "string") text = event.text + text;
    if (event.type === "user_message" || event.type === "capsule_turn" || event.type === "tool_start" || event.type === "tool_executing" || event.type === "tool_result" || event.type === "debate_proposal" || event.type === "debate_proposal_resolved" || event.type === "project_assignment_proposal" || event.type === "project_assignment_status") break;
  }
  return text;
}

function cleanActivityText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function searchToolLabel(name, input) {
  var query = cleanActivityText(input && input.query, 96);
  if (name === "search_workspace_history") return query ? "Searching conversations for \u201c" + query + "\u201d" : "Searching conversations";
  if (name === "read_project_session") return "Reading a matching conversation";
  if (name === "list_workspace_activity") return "Reviewing recent workspace activity";
  if (name === "list_project_sessions") return "Reviewing project conversations";
  if (name === "list_projects") return "Reviewing your projects";
  if (name === "search_project_history") return query ? "Searching a project for \u201c" + query + "\u201d" : "Searching a project";
  if (name === "search_project_logs") return query ? "Searching project logs for \u201c" + query + "\u201d" : "Searching project logs";
  if (name === "list_project_logs") return "Reviewing project logs";
  if (name === "read_project_log" || name === "read_project_log_revision" || name === "project_log_history") return "Reading a project log";
  return "Using " + (cleanActivityText(name, 64) || "a workspace tool");
}

function transformEvent(event, mateId, session, requestId, stableSessionId) {
  if (!event || typeof event.type !== "string") return null;
  var metadata = { mateId: mateId, sessionId: stableSessionId || null, requestId: requestId || null, model: session && session.model ? session.model : null, vendor: session && session.vendor ? session.vendor : null };
  if ((event.type === "project_assignment_proposal" || event.type === "project_assignment_status") && event.assignment) {
    return Object.assign({
      type: event.type === "project_assignment_proposal" ? "home_project_assignment_proposal" : "home_project_assignment_status",
      assignment: event.assignment,
    }, metadata);
  }
  if (session && session.homeClayEntryMode === "search") {
    if (event.type === "turn_start") session._homeClayResultProjected = false;
    if (event.type === "result") session._homeClayResultProjected = true;
    if (event.type === "done" && session._homeClayResultProjected === true) {
      session._homeClayResultProjected = false;
      return null;
    }
    if (event.type === "thinking_start") {
      session._homeClayActivitySequence = (session._homeClayActivitySequence || 0) + 1;
      session._homeClayThinkingActivityId = "thinking:" + session._homeClayActivitySequence;
      return Object.assign({ type: "home_clay_activity", activityId: session._homeClayThinkingActivityId, phase: "thinking", status: "active", label: "Thinking through your request", step: session._homeClayActivityStep || 0 }, metadata);
    }
    if (event.type === "thinking_stop") {
      var duration = typeof event.duration === "number" && isFinite(event.duration) ? Math.max(0, event.duration) : 0;
      return Object.assign({ type: "home_clay_activity", activityId: session._homeClayThinkingActivityId || "thinking", phase: "thinking", status: "done", label: duration ? "Thought through the request in " + duration.toFixed(1) + "s" : "Thought through the request", step: session._homeClayActivityStep || 0 }, metadata);
    }
    if (event.type === "tool_start") {
      session._homeClayActivityStep = (session._homeClayActivityStep || 0) + 1;
      session._homeClayActivitySequence = (session._homeClayActivitySequence || 0) + 1;
      session._homeClayToolActivityId = "tool:" + session._homeClayActivitySequence;
      return Object.assign({ type: "home_clay_activity", activityId: session._homeClayToolActivityId, phase: "searching", status: "active", label: searchToolLabel(event.name, null), step: session._homeClayActivityStep }, metadata);
    }
    if (event.type === "tool_executing") return Object.assign({ type: "home_clay_activity", activityId: session._homeClayToolActivityId || "tool:" + (session._homeClayActivityStep || 1), phase: "searching", status: "active", label: searchToolLabel(event.name, event.input), step: session._homeClayActivityStep || 1 }, metadata);
    if (event.type === "tool_result") return Object.assign({ type: "home_clay_activity", activityId: session._homeClayToolActivityId || "tool:" + (session._homeClayActivityStep || 1), phase: event.is_error ? "reconsidering" : "reviewing", status: event.is_error ? "error" : "done", label: event.is_error ? "That lead did not work; trying another route" : "Reviewed the search results", step: session._homeClayActivityStep || 1 }, metadata);
    if (event.type === "permission_request") return Object.assign({ type: "home_mate_permission_request", permissionRequestId: event.requestId, toolName: event.toolName, toolInput: event.toolInput, decisionReason: event.decisionReason || "" }, metadata);
    if (event.type === "permission_resolved") return Object.assign({ type: "home_mate_permission_resolved", permissionRequestId: event.requestId, decision: event.decision || "deny" }, metadata);
    if (event.type === "permission_cancel") return Object.assign({ type: "home_mate_permission_cancelled", permissionRequestId: event.requestId }, metadata);
  }
  if (session && session.homeDebatePlanning === true && HOME_DEBATE_EVENT_TYPES[event.type]) {
    var live = { type: "home_debate_event", eventType: event.type };
    var fields = ["turnId", "decisionId", "decision", "toolName", "command", "commandTruncated", "topic", "format", "moderatorId", "moderatorName", "panelists", "mateName", "role", "round", "activity", "delta", "text", "reason", "action", "avatarStyle", "avatarSeed", "avatarColor", "avatarCustom"];
    for (var fi = 0; fi < fields.length; fi++) if (Object.prototype.hasOwnProperty.call(event, fields[fi])) live[fields[fi]] = event[fields[fi]];
    if (event.mateId) live.speakerMateId = event.mateId;
    return Object.assign(live, metadata);
  }
  if (session && session.debateSetupMode === true && session.homeDebatePhase !== "live") {
    if (event.type === "delta") return null;
    if (event.type === "result" || event.type === "done") return Object.assign({ type: "home_mate_done", text: "" }, metadata);
  }
  if (session && session.mateCreationMode === true) {
    if (event.type === "delta") return null;
    if (event.type === "result" || event.type === "done") return Object.assign({ type: "home_mate_done", text: "" }, metadata);
  }
  if (session && session.homeDebatePlanning === true && session.homeDebatePhase === "live" && (event.type === "delta" || event.type === "result" || event.type === "done" || event.type === "error")) {
    return null;
  }
  if (event.type === "delta" && typeof event.text === "string") return Object.assign({ type: "home_mate_delta", text: event.text }, metadata);
  if (event.type === "result" || event.type === "done") return Object.assign({ type: "home_mate_done", text: session ? latestAssistantText(session.history) : "" }, metadata);
  if (event.type === "error") return Object.assign({ type: "home_mate_error", text: event.text || "Unknown error" }, metadata);
  if (event.type === "debate_proposal" && event.proposal) {
    return Object.assign({ type: "home_debate_proposal", proposal: event.proposal }, metadata);
  }
  if (event.type === "debate_proposal_resolved" && event.proposalId) return Object.assign({ type: "home_debate_proposal_resolved", proposalId: event.proposalId, action: event.action || "cancel", error: event.error || "" }, metadata);
  if (session && session.mateCreationMode === true && event.type === "mate_creation_proposal" && event.proposal) return Object.assign({ type: "home_mate_creation_proposal", proposal: event.proposal }, metadata);
  if (session && session.mateCreationMode === true && event.type === "mate_creation_proposal_resolved" && event.proposalId) return Object.assign({ type: "home_mate_creation_proposal_resolved", proposalId: event.proposalId, action: event.action || "cancel", mateId: event.mateId || null, mateName: event.mateName || null, error: event.error || "" }, metadata);
  if (session && session.debateSetupMode === true && event.type === "tool_executing" && event.name === "AskUserQuestion" && event.id && event.input) {
    return Object.assign({ type: "home_debate_question", toolId: event.id, questions: homeDebateQuestions(event.input) }, metadata);
  }
  if (session && session.debateSetupMode === true && event.type === "ask_user_answered" && event.toolId) return Object.assign({ type: "home_debate_question_resolved", toolId: event.toolId, status: "answered", answers: event.answers || null }, metadata);
  if (session && session.debateSetupMode === true && event.type === "home_debate_question_expired" && event.toolId) return Object.assign({ type: "home_debate_question_resolved", toolId: event.toolId, status: "expired", error: event.error || "This question expired. Ask Clay to repeat it." }, metadata);
  if (session && session.mateCreationMode === true && event.type === "tool_executing" && event.name === "AskUserQuestion" && event.id && event.input) return Object.assign({ type: "home_mate_creation_question", toolId: event.id, questions: homeDebateQuestions(event.input) }, metadata);
  if (session && session.mateCreationMode === true && event.type === "ask_user_answered" && event.toolId) return Object.assign({ type: "home_mate_creation_question_resolved", toolId: event.toolId, status: "answered", answers: event.answers || null }, metadata);
  if (session && session.mateCreationMode === true && event.type === "home_mate_creation_question_expired" && event.toolId) return Object.assign({ type: "home_mate_creation_question_resolved", toolId: event.toolId, status: "expired", error: event.error || "This question expired. Ask Clay to repeat it." }, metadata);
  if ((event.type === "tool_start" || event.type === "tool_executing") && event.name !== "AskUserQuestion") {
    // A tool call ends the current spoken burst: the client seals the bubble
    // it has streamed so far, and later text starts a fresh one. Without this
    // a session driven by tool play (a Capsule game) streams into one
    // ever-growing run-on bubble. Last so every special surface above (search
    // activity, debates, interviews, AskUserQuestion) keeps precedence.
    return Object.assign({ type: "home_mate_segment" }, metadata);
  }
  return null;
}

module.exports = { historyToHomeChat: historyToHomeChat, transformEvent: transformEvent };
