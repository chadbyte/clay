import { store } from './store.js';
import { mateAvatarUrl, userAvatarUrl } from './avatar.js';
import { createAssistantBubble, createUserBubble, renderAssistantBubbleText, finalizeAssistantBubble } from './chat-bubble-renderer.js';

function textElement(tag, className, text) {
  var element = document.createElement(tag);
  element.className = className;
  element.textContent = text || "";
  return element;
}

function mateById(mateId) {
  var mates = store.get('cachedMatesList') || [];
  for (var i = 0; i < mates.length; i++) if (mates[i] && mates[i].id === mateId) return mates[i];
  return null;
}

function debateIdentity(message, prior) {
  var cached = mateById(message.speakerMateId || message.mateId);
  var previous = prior || {};
  var cachedProfile = cached && cached.profile ? cached.profile : (cached || {});
  var name = message.mateName || previous.mateName || cachedProfile.displayName || (cached && cached.name) || "Mate";
  return {
    mateId: message.speakerMateId || message.mateId || previous.mateId || null,
    mateName: name,
    avatarCatalogId: message.avatarCatalogId || previous.avatarCatalogId || cachedProfile.avatarCatalogId || "",
    avatarStyle: message.avatarStyle || previous.avatarStyle || cachedProfile.avatarStyle || "imprint",
    avatarSeed: message.avatarSeed || previous.avatarSeed || cachedProfile.avatarSeed || message.speakerMateId || message.mateId || name,
    avatarColor: message.avatarColor || previous.avatarColor || cachedProfile.avatarColor || "",
    avatarCustom: message.avatarCustom || previous.avatarCustom || cachedProfile.avatarCustom || "",
  };
}

function mateForTurn(message) {
  var identity = debateIdentity(message, message);
  return {
    id: identity.mateId,
    name: identity.mateName,
    profile: {
      displayName: identity.mateName,
      avatarCatalogId: identity.avatarCatalogId,
      avatarStyle: identity.avatarStyle,
      avatarSeed: identity.avatarSeed,
      avatarColor: identity.avatarColor,
      avatarCustom: identity.avatarCustom,
    },
  };
}

function findHeader(messages) {
  for (var i = messages.length - 1; i >= 0; i--) if (messages[i].role === "debate_header") return messages[i];
  return null;
}

export function isHomeDebateLive(messages) {
  var header = findHeader(messages || []);
  return !!(header && header.phase === "live");
}

export function homeDebatePhase(messages) {
  var header = findHeader(messages || []);
  return header ? header.phase || "live" : null;
}

function findTurn(messages, msg) {
  for (var i = messages.length - 1; i >= 0; i--) {
    var turn = messages[i];
    if (turn.role !== "debate_turn") continue;
    if (msg.turnId && turn.turnId === msg.turnId) return turn;
    if (!msg.turnId && turn.status === "active" && (!msg.speakerMateId || turn.mateId === msg.speakerMateId)) return turn;
  }
  return null;
}

function decisionEntry(source) {
  return { decisionId: source.decisionId || null, mateId: source.speakerMateId || source.mateId || null, mateName: source.mateName || "Mate", toolName: source.toolName || "Tool", action: source.action || "Use " + (source.toolName || "tool"), command: typeof source.command === "string" ? source.command : "", commandTruncated: source.commandTruncated === true, decision: source.decision === "allowed" ? "allowed" : "blocked", reason: source.reason || (source.decision === "allowed" ? "Read-only investigation" : "Not verified as read-only") };
}

function appendToolDecision(messages, source) {
  var entry = decisionEntry(source);
  for (var i = messages.length - 1; i >= 0; i--) {
    var priorEntries = messages[i].role === "debate_tool_decision" ? (Array.isArray(messages[i].entries) ? messages[i].entries : [messages[i]]) : [];
    for (var j = 0; j < priorEntries.length; j++) if (entry.decisionId && priorEntries[j].decisionId === entry.decisionId) return;
  }
  var last = messages.length ? messages[messages.length - 1] : null;
  if (last && last.role === "debate_tool_decision") {
    last.entries = (Array.isArray(last.entries) ? last.entries : []).concat([entry]);
    return;
  }
  messages.push(Object.assign({ role: "debate_tool_decision", entries: [entry] }, entry));
}

export function normalizeHomeDebateMessages(raw) {
  var messages = [];
  for (var i = 0; i < (raw || []).length; i++) {
    var item = raw[i];
    if (!item || ["debate_header", "debate_turn", "debate_user", "debate_tool_decision"].indexOf(item.role) === -1) continue;
    messages.push(Object.assign({}, item, { entries: Array.isArray(item.entries) ? item.entries.map(function (entry) { return Object.assign({}, entry); }) : item.entries }));
  }
  return messages;
}

export function applyHomeDebateEvent(messages, msg) {
  var next = messages.slice();
  var type = msg.eventType;
  var header = findHeader(next);
  if (type === "debate_tool_decision") {
    appendToolDecision(next, msg);
    return next;
  }
  if (type === "debate_started") {
    next.push({ role: "debate_header", phase: "live", topic: msg.topic || "Debate", format: msg.format || "free_discussion", moderatorId: msg.moderatorId || null, moderatorName: msg.moderatorName || "Clay", panelists: Array.isArray(msg.panelists) ? msg.panelists : [], round: 1, interaction: null, handRaised: false });
    return next;
  }
  if (type === "debate_turn") {
    next.push(Object.assign({ role: "debate_turn", turnId: msg.turnId || "turn:" + next.length, speakerRole: msg.role || "panelist", round: msg.round || 1, text: "", activity: "", status: "active" }, debateIdentity(msg)));
    if (header) next[next.indexOf(header)] = Object.assign({}, header, { phase: "live", round: msg.round || header.round || 1, interaction: null });
    return next;
  }
  var turn = findTurn(next, msg);
  if (turn) {
    var turnIndex = next.indexOf(turn);
    if (type === "debate_activity") next[turnIndex] = Object.assign({}, turn, { activity: msg.activity || "Thinking" });
    if (type === "debate_stream") next[turnIndex] = Object.assign({}, turn, { text: (turn.text || "") + (msg.delta || ""), activity: "" });
    if (type === "debate_turn_done") next[turnIndex] = Object.assign({}, turn, debateIdentity(msg, turn), { text: msg.text || turn.text || "", activity: "", status: "done" });
  } else if (type === "debate_turn_done") {
    next.push(Object.assign({ role: "debate_turn", turnId: msg.turnId || "turn:" + next.length, speakerRole: msg.role || "panelist", round: msg.round || 1, text: msg.text || "", activity: "", status: "done" }, debateIdentity(msg)));
  }
  header = findHeader(next);
  if (!header) return next;
  var headerIndex = next.indexOf(header);
  if (type === "debate_hand_raised") next[headerIndex] = Object.assign({}, header, { handRaised: true });
  if (type === "debate_stop_requested") next[headerIndex] = Object.assign({}, header, { stopping: true });
  if (type === "debate_stop_cancelled") next[headerIndex] = Object.assign({}, header, { stopping: false });
  if (type === "debate_conclude_confirm") next[headerIndex] = Object.assign({}, header, { interaction: "conclude" });
  if (type === "debate_user_floor") next[headerIndex] = Object.assign({}, header, { interaction: "user_floor" });
  if (type === "debate_user_floor_done") {
    next.push({ role: "debate_user", text: msg.text || "" });
    next[headerIndex] = Object.assign({}, header, { interaction: null, handRaised: false });
  }
  if (type === "debate_comment_injected") next.push({ role: "debate_user", text: msg.text || "" });
  if (type === "debate_user_resume") next.push({ role: "debate_user", text: msg.text || "" });
  if (type === "debate_resumed") next[headerIndex] = Object.assign({}, header, { phase: "live", interaction: null, round: msg.round || header.round });
  if (type === "debate_ended") next[headerIndex] = Object.assign({}, header, { phase: msg.reason === "interrupted" ? "interrupted" : "ended", reason: msg.reason || "ended", interaction: null, stopping: false });
  return next;
}

function createHeader(message) {
  var card = document.createElement("section");
  card.className = "home-debate-live-header";
  card.setAttribute("aria-label", "Debate: " + (message.topic || "Untitled debate"));
  var top = document.createElement("div");
  top.className = "home-debate-live-header-top";
  var title = document.createElement("div");
  title.appendChild(textElement("span", "home-debate-live-kicker", message.phase === "live" ? "Live debate" : "Debate"));
  title.appendChild(textElement("h3", "home-debate-live-topic", message.topic || "Untitled debate"));
  top.appendChild(title);
  top.appendChild(textElement("span", "home-debate-live-round", "Round " + (message.round || 1)));
  card.appendChild(top);
  var panel = [message.moderatorName || "Clay"];
  for (var i = 0; i < (message.panelists || []).length; i++) panel.push(message.panelists[i].name || "Mate");
  card.appendChild(textElement("p", "home-debate-live-panel", panel.join(" · ")));
  if (message.phase !== "live") {
    var statusText = "Debate ended";
    if (message.phase === "interrupted") statusText = "Debate interrupted when Clay restarted";
    else if (message.reason === "error") statusText = "The debate stopped after an error. Start a new debate to continue.";
    else if (message.reason === "stopped" || message.reason === "user_stopped") statusText = "Debate stopped";
    var status = textElement("p", "home-debate-live-status", statusText);
    status.setAttribute("role", "status");
    card.appendChild(status);
  }
  return card;
}

function createTurn(message, finalize) {
  var mate = mateForTurn(message);
  var name = message.mateName || mate.name || "Mate";
  var role = message.speakerRole || "panelist";
  var roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  var row = createAssistantBubble({ avatarUrl: mateAvatarUrl(mate, 36), name: name, time: "" });
  row.classList.add("home-chat-message", "home-debate-live-turn");
  row.setAttribute("role", "article");
  row.setAttribute("aria-label", name + ", " + roleLabel + ", round " + (message.round || 1));
  var header = row.querySelector(".dm-bubble-header");
  if (header) header.appendChild(textElement("span", "home-debate-live-turn-meta", roleLabel + " · Round " + (message.round || 1)));
  var contentWrap = row.querySelector(".dm-bubble-content");
  var markdown = row.querySelector(".md-content");
  if (message.status === "active" && contentWrap) {
    var activity = textElement("div", "home-debate-live-activity", message.activity || (message.text ? "Speaking" : "Preparing"));
    activity.setAttribute("role", "status");
    activity.setAttribute("aria-label", name + " is " + (message.activity || (message.text ? "speaking" : "preparing")).toLowerCase());
    var dots = document.createElement("span");
    dots.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 3; i++) dots.appendChild(document.createElement("i"));
    activity.appendChild(dots);
    if (markdown && typeof contentWrap.insertBefore === "function") contentWrap.insertBefore(activity, markdown);
    else contentWrap.appendChild(activity);
  }
  if (finalize || message.status === "done") finalizeAssistantBubble(row, message.text || "", true);
  else renderAssistantBubbleText(row, message.text || "", false);
  return row;
}

function createUserTurn(message) {
  var users = store.get('cachedAllUsers') || [];
  var myUserId = store.get('myUserId');
  var current = null;
  for (var i = 0; i < users.length; i++) if (users[i] && users[i].id === myUserId) current = users[i];
  var user = createUserBubble({ text: message.text || "", name: "You", avatarUrl: userAvatarUrl(current || { id: myUserId || "you", avatarSeed: myUserId || "you" }, 36), time: "" });
  user.classList.add("home-chat-message", "home-debate-live-user");
  user.setAttribute("role", "article");
  user.setAttribute("aria-label", "You, participant");
  var header = user.querySelector(".dm-bubble-header");
  if (header) header.appendChild(textElement("span", "home-debate-live-turn-meta", "Participant"));
  return user;
}

function createToolDecision(message) {
  var entries = Array.isArray(message.entries) && message.entries.length ? message.entries : [decisionEntry(message)];
  var groups = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = decisionEntry(entries[i]);
    var key = [entry.mateName, entry.action, entry.toolName, entry.decision, entry.reason].join("\u0000");
    var group = null;
    for (var j = 0; j < groups.length; j++) if (groups[j].key === key) group = groups[j];
    if (group) group.count += 1;
    else groups.push({ key: key, entry: entry, count: 1 });
  }
  var block = document.createElement("section");
  block.className = "home-debate-tool-decisions";
  block.setAttribute("role", "status");
  block.setAttribute("aria-label", "Moderator access decisions");
  var heading = textElement("div", "home-debate-tool-decisions-heading", "Moderator access");
  heading.appendChild(textElement("span", "home-debate-tool-decisions-count", entries.length + (entries.length === 1 ? " check" : " checks")));
  block.appendChild(heading);
  var list = document.createElement("div");
  list.className = "home-debate-tool-decisions-list";
  for (var gi = 0; gi < groups.length; gi++) {
    var allowed = groups[gi].entry.decision === "allowed";
    var row = document.createElement("div");
    row.className = "home-debate-tool-decision home-debate-tool-decision-" + (allowed ? "allowed" : "blocked");
    var mark = textElement("span", "home-debate-tool-decision-mark", allowed ? "\u2713" : "\u00d7");
    mark.setAttribute("aria-hidden", "true");
    row.appendChild(mark);
    row.appendChild(textElement("span", "home-debate-tool-decision-action", groups[gi].entry.action));
    row.appendChild(textElement("span", "home-debate-tool-decision-tool", groups[gi].entry.toolName));
    row.appendChild(textElement("span", "home-debate-tool-decision-outcome", allowed ? "Allowed" : "Blocked"));
    row.appendChild(textElement("span", "home-debate-tool-decision-reason", groups[gi].entry.reason));
    if (groups[gi].count > 1) row.appendChild(textElement("span", "home-debate-tool-decision-repeat", "\u00d7" + groups[gi].count));
    list.appendChild(row);
  }
  block.appendChild(list);
  var commands = entries.filter(function (entry) { return typeof entry.command === "string" && entry.command; });
  if (commands.length) {
    var audit = document.createElement("details");
    audit.className = "home-debate-command-audit";
    audit.appendChild(textElement("summary", "home-debate-command-audit-summary", "Audit " + commands.length + (commands.length === 1 ? " command" : " commands")));
    var commandList = document.createElement("div");
    commandList.className = "home-debate-command-audit-list";
    for (var ci = 0; ci < commands.length; ci++) {
      var commandRow = document.createElement("div");
      commandRow.className = "home-debate-command-audit-row";
      commandRow.appendChild(textElement("span", "home-debate-command-audit-meta", (commands[ci].mateName || "Mate") + " · " + (commands[ci].decision === "allowed" ? "Allowed" : "Blocked")));
      commandRow.appendChild(textElement("code", "home-debate-command-audit-code", commands[ci].command + (commands[ci].commandTruncated ? "\n… command truncated at 4000 characters" : "")));
      commandList.appendChild(commandRow);
    }
    audit.appendChild(commandList);
    block.appendChild(audit);
  }
  return block;
}

export function createHomeDebateLiveCard(message, finalize) {
  if (message.role === "debate_header") return createHeader(message);
  if (message.role === "debate_user") return createUserTurn(message);
  if (message.role === "debate_tool_decision") return createToolDecision(message);
  return createTurn(message, finalize);
}

export function createHomeTypingIndicator() {
  var typing = document.createElement("div");
  typing.className = "home-chat-typing";
  typing.setAttribute("aria-label", "Mate is responding");
  typing.innerHTML = "<span></span><span></span><span></span>";
  return typing;
}
