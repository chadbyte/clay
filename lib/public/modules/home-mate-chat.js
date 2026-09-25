import { stopSTT } from './stt-controller.js';
// home-mate-chat.js - Embedded conversation surface for the selected mate.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { renderAssistantBubbleText, finalizeAssistantBubble, disposeChatBubbleTree } from './chat-bubble-renderer.js';
import { createHomeOrdinaryBubble, createHomeOrdinaryTyping, createCapsuleTurnNote } from './home-chat-identity.js';
import { openHomeMateSettings, closeHomeMateSettings } from './home-mate-settings.js';
import { forgetHomeSession, rememberHomeMate, rememberHomeSession } from './home-surface.js';
import { isOwnedHomeSessionMessage, resolveHomeSessionIdentity, appendHomeStreamText, finalizeHomeAssistant } from './home-chat-stream-state.js';
import { bindHomeComposerSubmission } from './home-composer-focus.js';
import { confirmedHomeSessionModel } from './home-session-model-confirmation.js';
import { createHomeDebateTranscriptCard, createHomeDebateResponder, normalizeHomeTranscript, applyHomeDebateProposal, resolveHomeDebateProposal, applyHomeDebateQuestion, resolveHomeDebateQuestion, failHomeDebateQuestion, hasPendingHomeDebateQuestion, restoreHomeDebateProposalFocus, restoreHomeDebateQuestionFocus, requestHomeDebateComposerFocus, restoreHomeDebateComposerFocus, clearHomeDebatePlanningPending, isHomeDebatePlanningPending, syncHomeDebatePlanningPending, createHomeDebatePlanningPendingRow } from './home-debate-planning.js';
import { applyHomeDebateEvent, createHomeDebateLiveCard, homeDebatePhase } from './home-debate-live.js';
import { renderHomeDebateControls } from './home-debate-controls.js';
import { beginHomeDebateLaunch, resetHomeDebateLaunch, settleHomeDebateLaunch, syncHomeDebateLaunchHistory, isHomeDebateLaunching, createHomeDebateLaunchRow } from './home-debate-launch.js';
import { setHomeSubSurface } from './home-sub-surface.js';
import { createWorkspaceAssignmentCard, applyHomeWorkspaceAssignment } from './workspace-assignment-card.js';
import { markHomeChatActivity, followHomeChatNextRender, captureHomeChatScroll, restoreHomeChatScroll } from './home-chat-scroll.js';
import { createHomeMateProposalCard, createHomeMateProposalResponder, applyHomeMateProposal, resolveHomeMateProposal, restoreHomeMateProposalFocus } from './home-mate-creation.js';
import { findHomeMate, getHomeMateName } from './home-mate-selection.js';
import { renderHomeChatEmptyState } from './home-chat-empty-state.js';
var messages = [], streamingText = "", streaming = false, bound = false, animateSwitch = false;
var chatEl = null, stageEl = null, messagesEl = null, suggestionsEl = null, inputEl = null, sendBtn = null;
var sessionModelEl = null, sessionModelValueEl = null, sessionModelChooseEl = null, sessionRequestSequence = 0, activeSessionRequestId = null, mateCreationActive = false;
function sendMessage(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(message));
  return true;
}
var respondToDebateTranscript = createHomeDebateResponder(sendMessage, function () { return { mateId: store.get('homeChatMateId'), sessionId: store.get('homeChatSessionId'), requestId: activeSessionRequestId }; }, function (message) { renderHomeChat(); if (message && message.role === "question") restoreHomeDebateQuestionFocus(message.toolId); });
var respondToMateProposal = createHomeMateProposalResponder(sendMessage, function () { return { mateId: store.get('homeChatMateId'), sessionId: store.get('homeChatSessionId'), requestId: activeSessionRequestId }; }, function () { renderHomeChat(); });
function getMate(mateId) { return findHomeMate(store.get('cachedMatesList') || [], mateId); }
function resizeInput() {
  if (!inputEl) return;
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(108, inputEl.scrollHeight) + "px";
}
function nextSessionRequestId() {
  sessionRequestSequence++;
  return "home-session-" + Date.now() + "-" + sessionRequestSequence;
}
function resetHomeSessionModel(sessionId) {
  activeSessionRequestId = nextSessionRequestId();
  store.set({
    homeChatSessionId: sessionId || null,
    homeChatSessionModel: null,
    homeChatSessionVendor: null,
    homeChatSessionModelLoading: true,
  });
  renderSessionModel();
}
function requestHomeSession(message, sessionId) {
  var requestId = nextSessionRequestId();
  message.requestId = requestId;
  if (!sendMessage(message)) return false;
  activeSessionRequestId = requestId;
  store.set({
    homeChatSessionId: sessionId || null,
    homeChatSessionModel: null,
    homeChatSessionVendor: null,
    homeChatSessionModelLoading: true,
  });
  renderSessionModel();
  return requestId;
}
function currentSessionModelLabel() {
  if (!store.get('homeChatMateId') || store.get('homeChatSessionModelLoading')) return "Loading model…";
  var model = store.get('homeChatSessionModel');
  if (model) return (store.get('homeChatSessionVendor') || "Vendor") + " · " + model;
  return "Choose model";
}
function hasCommittedSessionModel() {
  return !store.get('homeChatSessionModelLoading') && !!store.get('homeChatSessionModel');
}
function renderSessionModel() {
  if (!sessionModelEl || !sessionModelValueEl || !sessionModelChooseEl) return;
  var label = currentSessionModelLabel();
  var needsChoice = label === "Choose model";
  var canChangeDraft = !!store.get('homeChatSessionId') && !store.get('homeChatSessionModelLoading') && messages.length === 0 && !streaming;
  sessionModelValueEl.textContent = needsChoice ? "" : label;
  sessionModelValueEl.classList.toggle("hidden", needsChoice);
  sessionModelChooseEl.classList.toggle("hidden", !needsChoice && !canChangeDraft);
  sessionModelChooseEl.setAttribute("aria-label", canChangeDraft ? "Choose a model for this draft conversation and future new conversations." : "Choose a model for the current Mate. Used for new conversations.");
  sessionModelEl.title = "Model for this conversation: " + label;
  sessionModelEl.setAttribute("aria-label", "Model for this conversation: " + label);
}
function submitMessage() {
  stopSTT();
  var mateId = store.get('homeChatMateId');
  var text = inputEl ? inputEl.value.trim() : "";
  if (!mateId || !text || streaming || hasPendingHomeDebateQuestion(messages) || !hasCommittedSessionModel()) return false;
  if (!sendMessage({ type: "home_mate_send", mateId: mateId, sessionId: store.get('homeChatSessionId'), requestId: activeSessionRequestId, text: text })) return false;
  messages.push({ role: "user", text: text, ts: Date.now() });
  streamingText = "";
  streaming = true;
  followHomeChatNextRender();
  inputEl.value = "";
  resizeInput();
  renderHomeChat();
  return true;
}
function submitSuggestion(text) {
  if (!inputEl || !text) return;
  inputEl.value = text;
  resizeInput();
  submitMessage();
}
export function startNewHomeConversation() {
  stopSTT();
  setHomeSubSurface("chat");
  var mateId = store.get('homeChatMateId');
  if (!mateId || streaming) return;
  resetHomeDebateLaunch();
  mateCreationActive = false;
  if (!requestHomeSession({ type: "home_mate_new_session", mateId: mateId }, null)) return;
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
  renderHomeChat();
}
export function startHomeCapsuleCreation(mateId, description) {
  stopSTT();
  if (!mateId || mateId !== store.get('homeChatMateId') || !description || streaming) return false;
  setHomeSubSurface("chat"); resetHomeDebateLaunch();
  mateCreationActive = false;
  closeHomeMateSettings();
  rememberHomeMate(mateId);
  messages = []; streamingText = ""; streaming = true; animateSwitch = true;
  if (inputEl) inputEl.value = "";
  var requestId = requestHomeSession({
    type: "home_mate_new_session",
    mateId: mateId,
    intent: { type: "capsule_creation", description: description },
  }, null);
  if (!requestId) {
    streaming = false; renderHomeChat();
    return false;
  }
  renderHomeChat();
  return true;
}
function bindComposer() {
  if (bound || !inputEl || !sendBtn) return;
  bound = true;
  inputEl.addEventListener("input", function () {
    resizeInput();
    sendBtn.disabled = streaming || hasPendingHomeDebateQuestion(messages) || !store.get('homeChatMateId') || !hasCommittedSessionModel() || !inputEl.value.trim();
  });
  bindHomeComposerSubmission(inputEl, sendBtn, submitMessage);
  sessionModelChooseEl.addEventListener("click", function () {
    var mate = getMate(store.get('homeChatMateId'));
    if (mate) openHomeMateSettings(mate.id, sessionModelChooseEl, { section: "model", sessionId: store.get('homeChatSessionId') });
  });
  window.addEventListener("clay:home-mate-model-confirmed", function (event) {
    handleHomeMateModelConfirmed(event.detail || {});
  });
}
function ensureDom() {
  if (!chatEl) chatEl = document.getElementById("home-mate-chat");
  if (!stageEl) stageEl = chatEl ? chatEl.querySelector(".home-mate-chat-stage") : null;
  if (!messagesEl) messagesEl = document.getElementById("home-mate-chat-messages");
  if (!suggestionsEl) suggestionsEl = document.getElementById("home-mate-chat-suggestions");
  if (!inputEl) inputEl = document.getElementById("home-mate-chat-input");
  if (!sendBtn) sendBtn = document.getElementById("home-mate-chat-send");
  if (!sessionModelEl) sessionModelEl = document.getElementById("home-mate-chat-session-model");
  if (!sessionModelValueEl) sessionModelValueEl = document.getElementById("home-mate-chat-session-model-value");
  if (!sessionModelChooseEl) sessionModelChooseEl = document.getElementById("home-mate-chat-session-model-choose");
  bindComposer();
  return !!(chatEl && stageEl && messagesEl && suggestionsEl && inputEl && sendBtn);
}
function formatTime(timestamp) { var date = timestamp ? new Date(timestamp) : null; return date ? date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0") : ""; }
function appendMessage(message, mate, mateName, finalize) {
  if (message.role === "capsule_turn") return createCapsuleTurnNote(message);
  if (message.role === "assignment") return createWorkspaceAssignmentCard(message.assignment, { home: true, context: { mateId: store.get('homeChatMateId'), sessionId: store.get('homeChatSessionId'), requestId: activeSessionRequestId } });
  if (message.role === "mate_proposal") return createHomeMateProposalCard(message, respondToMateProposal, function (created) { openHomeChat(created.mateId); });
  if (message.role === "proposal" || message.role === "question") return createHomeDebateTranscriptCard(message, respondToDebateTranscript);
  if (["debate_header", "debate_turn", "debate_user", "debate_tool_decision"].indexOf(message.role) !== -1) return createHomeDebateLiveCard(message, finalize);
  var isUser = message.role === "user";
  var timeText = formatTime(typeof message.ts === "number" ? message.ts : 0);
  var row = createHomeOrdinaryBubble(message, mate, mateName, timeText);
  if (!isUser) {
    if (finalize) finalizeAssistantBubble(row, message.text || "", true);
    else renderAssistantBubbleText(row, message.text || "", false);
  }
  if (timeText) row.title = timeText;
  return row;
}
function renderEmptyState(mate, mateName) {
  renderHomeChatEmptyState(messagesEl, suggestionsEl, mate, mateName, submitSuggestion);
}
export function renderHomeChat() {
  if (!ensureDom()) return;
  var scrollSnapshot = captureHomeChatScroll(animateSwitch);
  var mateId = store.get('homeChatMateId');
  var mate = getMate(mateId);
  var mateName = getHomeMateName(mate);
  var debateLaunching = isHomeDebateLaunching();
  var hasConversation = debateLaunching || messages.length > 0 || streaming || !!streamingText;
  chatEl.classList.toggle("is-empty", !hasConversation);
  chatEl.classList.toggle("has-conversation", hasConversation);
  disposeChatBubbleTree(messagesEl);
  messagesEl.innerHTML = "";
  suggestionsEl.innerHTML = "";
  if (hasConversation) {
    var transcript = document.createElement("div");
    transcript.className = "home-mate-chat-transcript home-chat-bubble-layout";
    for (var i = 0; i < messages.length; i++) transcript.appendChild(appendMessage(messages[i], mate, mateName, !streaming));
    if (isHomeDebatePlanningPending()) transcript.appendChild(createHomeDebatePlanningPendingRow());
    if (debateLaunching) {
      transcript.appendChild(createHomeDebateLaunchRow());
    } else if (streamingText) {
      transcript.appendChild(appendMessage({ role: "assistant", text: streamingText, ts: Date.now() }, mate, mateName, false));
    } else if (streaming && mate) {
      transcript.appendChild(createHomeOrdinaryTyping(mate, mateName));
    }
    messagesEl.appendChild(transcript);
  } else {
    renderEmptyState(mate, mateName);
  }
  var awaitingQuestion = hasPendingHomeDebateQuestion(messages);
  var debatePhase = homeDebatePhase(messages);
  inputEl.disabled = !mateId || awaitingQuestion || !hasCommittedSessionModel(); if (debateLaunching || mateCreationActive || !!debatePhase) inputEl.disabled = true;
  inputEl.placeholder = debateLaunching ? "Preparing your debate…" : (mateCreationActive ? "Use the interview cards above" : (debatePhase ? "Debate session" : (awaitingQuestion ? "Answer the question above to continue" : (mateId ? "Message " + mateName : "Message"))));
  sendBtn.disabled = !mateId || streaming || awaitingQuestion || !hasCommittedSessionModel();
  if (debateLaunching || mateCreationActive || !!debatePhase || !inputEl.value.trim()) sendBtn.disabled = true;
  renderSessionModel();
  renderHomeDebateControls(messages, activeSessionRequestId, function () { store.set({ homeDebateTopicFormOpen: true }); setHomeSubSurface("debates"); });
  if (animateSwitch) {
    messagesEl.classList.remove("is-switching");
    void messagesEl.offsetWidth;
    messagesEl.classList.add("is-switching");
    animateSwitch = false;
  }
  restoreHomeChatScroll(scrollSnapshot);
}
export function openHomeChat(mateId) {
  stopSTT();
  if (!mateId) return;
  setHomeSubSurface("chat");
  resetHomeDebateLaunch();
  mateCreationActive = false;
  if (store.get('homeChatMateId') && store.get('homeChatMateId') !== mateId) closeHomeMateSettings();
  var preferredSession = (store.get('homeActiveSessionByMate') || {})[mateId] || null;
  resetHomeSessionModel(preferredSession);
  store.set({ homeChatMateId: mateId });
  rememberHomeMate(mateId);
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
  if (inputEl) inputEl.value = "";
  renderHomeChat();
  if (store.get('homeSurfaceLoaded')) resumeHomeChat();
}
export function openHomeConversation(mateId, sessionId) {
  stopSTT();
  if (!mateId || !sessionId) return;
  setHomeSubSurface("chat");
  resetHomeDebateLaunch();
  mateCreationActive = false;
  closeHomeMateSettings();
  resetHomeSessionModel(sessionId);
  store.set({ homeChatMateId: mateId });
  rememberHomeMate(mateId);
  rememberHomeSession(mateId, sessionId);
  messages = [];
  streamingText = "";
  streaming = false;
  animateSwitch = true;
  if (inputEl) inputEl.value = "";
  renderHomeChat();
  if (store.get('homeSurfaceLoaded')) resumeHomeChat();
}
export function openHomeMateAction(kind, initialTopic) {
  stopSTT();
  if (kind !== "debate" && kind !== "mate") return false;
  var mates = store.get('cachedMatesList') || [];
  var clay = null;
  for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].builtinKey === "clay") clay = mates[i];
  if (!clay || streaming) return false;
  requestHomeDebateComposerFocus();
  closeHomeMateSettings();
  store.set({ homeChatMateId: clay.id });
  rememberHomeMate(clay.id);
  messages = []; streamingText = ""; streaming = false; animateSwitch = true;
  resetHomeDebateLaunch();
  var payload = kind === "mate" ? { type: "home_mate_creation_plan", mateId: clay.id } : { type: "home_mate_debate_plan", mateId: clay.id, topic: typeof initialTopic === "string" ? initialTopic.trim().slice(0, 1000) : "" };
  var requestId = requestHomeSession(payload, null);
  if (!requestId) return false;
  setHomeSubSurface("chat");
  if (kind === "debate") beginHomeDebateLaunch(requestId);
  else { streaming = true; mateCreationActive = true; }
  renderHomeChat();
  return true;
}
export function resumeHomeChat() {
  var mateId = store.get('homeChatMateId');
  if (!mateId) return;
  sendMessage({ type: "home_mate_sessions_list", mateId: mateId });
  var sessionId = store.get('homeChatSessionId') || (store.get('homeActiveSessionByMate') || {})[mateId];
  if (sessionId) requestHomeSession({ type: "home_mate_session_open", mateId: mateId, sessionId: sessionId }, sessionId);
  else requestHomeSession({ type: "home_mate_open", mateId: mateId }, null);
}
export function closeHomeChat() {
  stopSTT();
  resetHomeDebateLaunch();
  sendMessage({ type: "home_mate_close" });
  streaming = false;
  streamingText = "";
  renderHomeChat();
}
export function handleHomeMateHistory(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  syncHomeDebateLaunchHistory(msg);
  store.set({
    homeChatSessionId: msg.sessionId || null,
    homeChatSessionModel: typeof msg.model === "string" && msg.model ? msg.model : null,
    homeChatSessionVendor: typeof msg.vendor === "string" && msg.vendor ? msg.vendor : null,
    homeChatSessionModelLoading: false,
  });
  if (msg.sessionId) rememberHomeSession(msg.mateId, msg.sessionId);
  syncHomeDebatePlanningPending(msg);
  mateCreationActive = msg.mateCreation === true;
  messages = normalizeHomeTranscript(msg.messages);
  streamingText = "";
  streaming = msg.isProcessing === true;
  renderHomeChat();
  if (msg.debatePlanning) restoreHomeDebateComposerFocus(inputEl);
  if (msg.mateCreation) for (var i = messages.length - 1; i >= 0; i--) if (messages[i].role === "question" && messages[i].status === "pending") { restoreHomeDebateQuestionFocus(messages[i].toolId); break; }
}
export function handleHomeDebateTranscript(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  markHomeChatActivity();
  settleHomeDebateLaunch(msg);
  if (msg.type === "home_debate_proposal" || msg.type === "home_debate_question" || msg.type === "home_debate_event" || msg.type === "home_mate_creation_proposal" || msg.type === "home_mate_creation_question") messages = finalizeHomeAssistant(messages, streamingText, "", Date.now());
  if (msg.type === "home_debate_event") messages = applyHomeDebateEvent(messages, msg);
  if (msg.type === "home_debate_proposal") messages = applyHomeDebateProposal(messages, msg);
  if (msg.type === "home_debate_proposal_resolved") messages = resolveHomeDebateProposal(messages, msg);
  if (msg.type === "home_debate_question") messages = applyHomeDebateQuestion(messages, msg);
  if (msg.type === "home_debate_question_resolved") messages = resolveHomeDebateQuestion(messages, msg);
  if (msg.type === "home_mate_creation_question") messages = applyHomeDebateQuestion(messages, msg);
  if (msg.type === "home_mate_creation_question_resolved") messages = resolveHomeDebateQuestion(messages, msg);
  if (msg.type === "home_mate_creation_proposal") messages = applyHomeMateProposal(messages, msg);
  if (msg.type === "home_mate_creation_proposal_resolved") messages = resolveHomeMateProposal(messages, msg);
  if (msg.type === "home_mate_error" && /^question_/.test(msg.code || "")) messages = failHomeDebateQuestion(messages, msg);
  if (msg.type === "home_debate_proposal" || msg.type === "home_debate_question" || msg.type === "home_debate_event" || msg.type === "home_mate_creation_proposal" || msg.type === "home_mate_creation_question") { clearHomeDebatePlanningPending(); streaming = false; streamingText = ""; }
  if ((msg.type === "home_debate_question_resolved" || msg.type === "home_mate_creation_question_resolved") && msg.status === "expired") clearHomeDebatePlanningPending();
  renderHomeChat();
  if (msg.proposalId) restoreHomeDebateProposalFocus(msg.proposalId);
  if (msg.proposalId && msg.type === "home_mate_creation_proposal_resolved") restoreHomeMateProposalFocus(msg.proposalId);
  if (msg.toolId && msg.type === "home_mate_creation_question") restoreHomeDebateQuestionFocus(msg.toolId);
  if (msg.toolId && msg.type === "home_debate_question_resolved") restoreHomeDebateQuestionFocus(msg.toolId);
  if (msg.toolId && msg.type === "home_mate_error") restoreHomeDebateQuestionFocus(msg.toolId);
}
export function handleHomeMateDelta(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  markHomeChatActivity();
  settleHomeDebateLaunch(msg);
  if (msg.sessionId && msg.sessionId !== store.get('homeChatSessionId')) {
    store.set({ homeChatSessionId: msg.sessionId });
    rememberHomeSession(msg.mateId, msg.sessionId);
  }
  updateHomeSessionMetadata(msg);
  streaming = true;
  updateSessionProcessing(msg.mateId, msg.sessionId, true);
  streamingText = appendHomeStreamText(streamingText, msg.text);
  renderHomeChat();
}
export function handleHomeWorkspaceAssignment(msg) {
  if (!isCurrentSessionMessage(msg) || !msg.assignment) return;
  markHomeChatActivity();
  messages = applyHomeWorkspaceAssignment(messages, msg);
  renderHomeChat();
}
// A tool call ended the mate's spoken burst: seal what has streamed so far
// into its own bubble; later deltas start a fresh one. Streaming stays on;
// the turn is not over.
export function handleHomeMateSegment(msg) {
  if (!isCurrentSessionMessage(msg) || !streamingText) return;
  messages.push({ role: "assistant", text: streamingText, ts: Date.now() });
  streamingText = "";
  renderHomeChat();
}

export function handleHomeMateDone(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  markHomeChatActivity();
  settleHomeDebateLaunch(msg);
  if (msg.sessionId && msg.sessionId !== store.get('homeChatSessionId')) {
    store.set({ homeChatSessionId: msg.sessionId });
    rememberHomeSession(msg.mateId, msg.sessionId);
  }
  updateHomeSessionMetadata(msg);
  messages = finalizeHomeAssistant(messages, streamingText, msg.text, Date.now());
  streamingText = "";
  streaming = false;
  updateSessionProcessing(msg.mateId, msg.sessionId, false);
  renderHomeChat();
}
export function handleHomeMateSessionIdentity(msg) {
  var nextSessionId = resolveHomeSessionIdentity({
    mateId: store.get('homeChatMateId'),
    requestId: activeSessionRequestId,
    sessionId: store.get('homeChatSessionId'),
  }, msg);
  if (!nextSessionId) return;
  store.set({ homeChatSessionId: nextSessionId });
  rememberHomeSession(msg.mateId, nextSessionId);
}
export function handleHomeMateError(msg) {
  if (!isCurrentSessionMessage(msg)) return;
  markHomeChatActivity();
  settleHomeDebateLaunch(msg);
  clearHomeDebatePlanningPending();
  if (msg.code === "session_not_found") {
    forgetHomeSession(msg.mateId);
    requestHomeSession({ type: "home_mate_open", mateId: msg.mateId }, null);
    return;
  }
  if (msg.code === "model_unavailable") {
    store.set({ homeChatSessionModel: null, homeChatSessionModelLoading: false });
  }
  if (streamingText) messages.push({ role: "assistant", text: streamingText, ts: Date.now() });
  streamingText = "";
  streaming = false;
  messages.push({ role: "assistant", text: msg.text || "Chat unavailable.", ts: Date.now() });
  renderHomeChat();
}
export function handleHomeMateModelConfirmed(msg) {
  var confirmed = confirmedHomeSessionModel({
    mateId: store.get('homeChatMateId'),
    sessionId: store.get('homeChatSessionId'),
  }, msg);
  if (!confirmed) {
    if (!msg.requestedSessionId && !store.get('homeChatSessionModel')) resumeHomeChat();
    return;
  }
  store.set({
    homeChatSessionId: confirmed.sessionId,
    homeChatSessionVendor: confirmed.vendor,
    homeChatSessionModel: confirmed.model,
    homeChatSessionModelLoading: false,
  });
  rememberHomeSession(msg.mateId, confirmed.sessionId);
  renderHomeChat();
}
function isCurrentSessionMessage(msg) {
  return isOwnedHomeSessionMessage({
    mateId: store.get('homeChatMateId'),
    requestId: activeSessionRequestId,
    sessionId: store.get('homeChatSessionId'),
  }, msg);
}
function updateHomeSessionMetadata(msg) {
  var update = {};
  if (Object.prototype.hasOwnProperty.call(msg, "model")) {
    update.homeChatSessionModel = typeof msg.model === "string" && msg.model ? msg.model : null;
    update.homeChatSessionModelLoading = false;
  }
  if (Object.prototype.hasOwnProperty.call(msg, "vendor")) {
    update.homeChatSessionVendor = typeof msg.vendor === "string" && msg.vendor ? msg.vendor : null;
  }
  if (Object.keys(update).length) store.set(update);
}
export function handleHomeMateSessionsState(msg) {
  if (!msg.mateId) return;
  var sessions = Object.assign({}, store.get('homeMateSessions') || {});
  sessions[msg.mateId] = Array.isArray(msg.sessions) ? msg.sessions : [];
  store.set({ homeMateSessions: sessions });
}
function updateSessionProcessing(mateId, sessionId, processing) {
  if (!mateId || !sessionId) return;
  var byMate = Object.assign({}, store.get('homeMateSessions') || {});
  var sessions = Array.isArray(byMate[mateId]) ? byMate[mateId].slice() : [], changed = false;
  for (var i = 0; i < sessions.length; i++) {
    if (!sessions[i] || sessions[i].id !== sessionId || sessions[i].isProcessing === processing) continue;
    sessions[i] = Object.assign({}, sessions[i], { isProcessing: processing });
    changed = true;
  }
  if (!changed) return;
  byMate[mateId] = sessions; store.set({ homeMateSessions: byMate });
}
