var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function FakeElement(tag) {
  this.tagName = tag.toUpperCase();
  this.children = [];
  this.attributes = {};
  this.listeners = {};
  this.className = "";
  this.textContent = "";
  this.disabled = false;
  this.dataset = {};
  this.value = "";
  this.tabIndex = 0;
  var element = this;
  this.classList = {
    add: function () {
      for (var i = 0; i < arguments.length; i++) if ((" " + element.className + " ").indexOf(" " + arguments[i] + " ") === -1) element.className += (element.className ? " " : "") + arguments[i];
    },
    remove: function () {},
    toggle: function () {},
  };
}
FakeElement.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
FakeElement.prototype.insertBefore = function (child, before) { var index = this.children.indexOf(before); if (index === -1) return this.appendChild(child); this.children.splice(index, 0, child); child.parentNode = this; return child; };
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };
FakeElement.prototype.click = function () { if (this.listeners.click) this.listeners.click({ currentTarget: this }); };
FakeElement.prototype.focus = function (options) { this.focusOptions = options; };
FakeElement.prototype.querySelector = function (selector) {
  var className = selector.charAt(0) === "." ? selector.slice(1) : null;
  var role = selector.match(/^\[role="([^"]+)"\]$/);
  var nodes = flatten(this);
  for (var i = 1; i < nodes.length; i++) {
    if (className && (" " + nodes[i].className + " ").indexOf(" " + className + " ") !== -1) return nodes[i];
    if (role && nodes[i].attributes.role === role[1]) return nodes[i];
  }
  return null;
};
FakeElement.prototype.querySelectorAll = function (selector) {
  var className = selector.charAt(0) === "." ? selector.slice(1) : null;
  if (!className) return [];
  return flatten(this).filter(function (node) { return (" " + node.className + " ").indexOf(" " + className + " ") !== -1; });
};

function flatten(root) {
  var result = [root];
  for (var i = 0; i < root.children.length; i++) result = result.concat(flatten(root.children[i]));
  return result;
}

test("Home debate proposal card is safe, accessible, keyboard-native, and server-confirmed", async function () {
  var originals = { document: global.document, requestAnimationFrame: global.requestAnimationFrame, lucide: global.lucide };
  global.document = {
    createElement: function (tag) { return new FakeElement(tag); },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
  };
  global.requestAnimationFrame = function () { return 1; };
  global.lucide = { createIcons: function () {} };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    storeModule.createStore({ cachedMatesList: [{ id: "panel-1", name: "Analyst" }] });
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var calls = [];
    var message = { role: "proposal", status: "pending", proposal: { proposalId: "dp-1", topic: "<img src=x onerror=bad>", panelists: [{ mateId: "panel-1", role: "Skeptic" }] } };
    var card = module.createHomeDebateProposalCard(message, function (selected, action, opener) { calls.push([selected, action, opener]); });
    var nodes = flatten(card);
    var start = nodes.find(function (node) { return node.attributes["aria-label"] === "Approve and start this debate"; });
    var cancel = nodes.find(function (node) { return node.attributes["aria-label"] === "Cancel this debate proposal"; });
    assert.ok(start);
    assert.ok(cancel);
    assert.equal(card.attributes["aria-label"], "Debate proposal: <img src=x onerror=bad>");
    assert.equal(nodes.some(function (node) { return Object.prototype.hasOwnProperty.call(node, "innerHTML") && node.innerHTML; }), false);
    start.click();
    assert.deepEqual(calls[0], [message, "start", start]);
    module.markHomeDebateProposalSubmitting(message, start);
    assert.equal(message.status, "submitting");
    assert.equal(start.disabled, true);
    assert.equal(cancel.disabled, true);
    assert.equal(start.textContent, "Starting…");
    var resolved = module.resolveHomeDebateProposal([message], { proposalId: "dp-1", action: "start" });
    var resolvedCard = module.createHomeDebateProposalCard(resolved[0], function () {});
    var status = flatten(resolvedCard).find(function (node) { return node.attributes.role === "status"; });
    assert.equal(status.textContent, "Debate started");
  } finally {
    global.document = originals.document;
    global.requestAnimationFrame = originals.requestAnimationFrame;
    global.lucide = originals.lucide;
  }
});

test("Home debate proposal selects per-participant models and submits debate-only overrides", async function () {
  var originals = { document: global.document, requestAnimationFrame: global.requestAnimationFrame, lucide: global.lucide };
  global.document = {
    createElement: function (tag) { return new FakeElement(tag); },
    getElementById: function () { return null; }, querySelector: function () { return null; }, querySelectorAll: function () { return []; }, addEventListener: function () {},
  };
  global.requestAnimationFrame = function () { return 1; };
  global.lucide = { createIcons: function () {} };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    storeModule.createStore({ cachedMatesList: [{ id: "moderator", name: "Clay" }, { id: "panel", name: "Architect" }] });
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var calls = [];
    var proposal = {
      proposalId: "dp-models", topic: "Architecture", panelists: [{ mateId: "panel", role: "Architect" }],
      modelSelections: [
        { mateId: "moderator", role: "moderator", selectedModel: "sonnet", models: [{ value: "sonnet", label: "Sonnet" }, { value: "opus", label: "Opus" }] },
        { mateId: "panel", role: "panelist", selectedModel: "gpt-5.6", models: [{ value: "gpt-5.6", label: "GPT-5.6" }] },
      ],
    };
    var message = { role: "proposal", status: "pending", proposal: proposal };
    var card = module.createHomeDebateProposalCard(message, function () { calls.push(Array.prototype.slice.call(arguments)); });
    var selects = card.querySelectorAll(".home-debate-model-select");
    assert.equal(selects.length, 2);
    assert.equal(selects[0].attributes["aria-label"], "Model for Clay");
    selects[0].value = "opus";
    var start = flatten(card).find(function (node) { return node.attributes["aria-label"] === "Approve and start this debate"; });
    start.click();
    assert.deepEqual(calls[0][4], [{ mateId: "moderator", model: "opus" }, { mateId: "panel", model: "gpt-5.6" }]);
    module.markHomeDebateProposalSubmitting(message, start);
    assert.equal(selects[0].disabled, true);
  } finally {
    global.document = originals.document;
    global.requestAnimationFrame = originals.requestAnimationFrame;
    global.lucide = originals.lucide;
  }
});

test("Home transcript proposal state rejects duplicates and restores cancel status", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var proposal = { proposalId: "dp-restore", topic: "Restored" };
  var messages = module.normalizeHomeTranscript([{ role: "assistant", text: "Ready" }, { role: "proposal", proposal: proposal, status: "cancelled" }]);
  messages = module.applyHomeDebateProposal(messages, { proposal: proposal });
  assert.equal(messages.length, 2);
  assert.equal(messages[1].status, "cancelled");
});

test("Home AskUserQuestion card safely submits options or Other and restores persisted state", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var calls = [];
    var message = { role: "question", toolId: "tool-<unsafe>", status: "pending", questions: [{ header: "Direction", question: "Which outcome? <script>bad()</script>", options: [{ label: "Decision", description: "Choose one path" }, { label: "Trade-offs", description: "Compare costs" }] }] };
    var card = module.createHomeDebateQuestionCard(message, function (selected, action, opener, answers) { calls.push({ selected: selected, action: action, opener: opener, answers: answers }); });
    var nodes = flatten(card);
    var option = nodes.find(function (node) { return node.className === "home-debate-question-option"; });
    var submit = nodes.find(function (node) { return node.className === "home-debate-question-submit"; });
    assert.equal(card.dataset.toolId, "tool-<unsafe>");
    assert.equal(nodes.some(function (node) { return Object.prototype.hasOwnProperty.call(node, "innerHTML") && node.innerHTML; }), false);
    option.click();
    assert.equal(option.attributes["aria-pressed"], "true");
    submit.click();
    assert.deepEqual(calls[0].answers, { 0: "Decision" });
    var restored = module.normalizeHomeTranscript([{ role: "question", toolId: "tool-1", questions: message.questions, status: "pending" }]);
    assert.equal(module.hasPendingHomeDebateQuestion(restored), true);
    restored = module.resolveHomeDebateQuestion(restored, { toolId: "tool-1", status: "expired", error: "Expired" });
    assert.equal(restored[0].status, "expired");
    assert.equal(module.hasPendingHomeDebateQuestion(restored), false);
  } finally {
    global.document = originalDocument;
  }
});

test("Home freeform debate question renders one labeled textarea without options or Other", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var calls = [];
    var message = { role: "question", toolId: "topic-freeform", status: "pending", questions: [{ header: "Topic", question: "What would you like the debate to be about?", options: [] }] };
    var card = module.createHomeDebateQuestionCard(message, function (selected, action, opener, answers) { calls.push(answers); });
    var nodes = flatten(card);
    var textarea = nodes.find(function (node) { return node.tagName === "TEXTAREA"; });
    var submit = nodes.find(function (node) { return node.className === "home-debate-question-submit"; });
    assert.ok(textarea);
    assert.equal(submit.disabled, true);
    assert.equal(nodes.some(function (node) { return node.className === "home-debate-question-option"; }), false);
    assert.equal(nodes.some(function (node) { return node.textContent === "Other"; }), false);
    assert.equal(nodes.some(function (node) { return node.textContent === "Your answer"; }), true);
    textarea.value = "도시 주거 정책";
    textarea.listeners.input();
    assert.equal(submit.disabled, false);
    var prevented = false;
    textarea.listeners.keydown({ key: "Enter", ctrlKey: true, metaKey: false, preventDefault: function () { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(calls, [{ 0: "도시 주거 정책" }]);
  } finally {
    global.document = originalDocument;
  }
});

test("answered debate question keeps an ephemeral preparing state until the next correlated event", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    module.clearHomeDebatePlanningPending();
    var changes = 0;
    var message = { role: "question", toolId: "pending-next", status: "pending", questions: [{ question: "Topic?", options: [] }] };
    var responder = module.createHomeDebateResponder(function () { return true; }, function () { return {}; }, function () { changes++; });
    var card = module.createHomeDebateQuestionCard(message, responder);
    var nodes = flatten(card);
    var input = nodes.find(function (node) { return node.tagName === "TEXTAREA"; });
    var submit = nodes.find(function (node) { return node.className === "home-debate-question-submit"; });
    input.value = "Housing";
    input.listeners.input();
    submit.click();
    assert.equal(message.status, "submitting");
    assert.equal(module.isHomeDebatePlanningPending(), true);
    assert.equal(changes, 1);
    var row = module.createHomeDebatePlanningPendingRow();
    var activityNodes = flatten(row);
    assert.equal(row.attributes.role, "status");
    assert.equal(row.attributes["aria-live"], "polite");
    assert.equal(row.attributes["aria-atomic"], "true");
    assert.equal(row.attributes["aria-label"], "Clay is preparing the next question");
    assert.match(row.className, /home-debate-activity-next/);
    assert.equal(activityNodes.some(function (node) { return node.textContent === "Clay"; }), true);
    assert.equal(activityNodes.some(function (node) { return node.textContent === "Preparing the next question"; }), true);
    assert.equal(activityNodes.filter(function (node) { return node.tagName === "I"; }).length, 3);
    assert.equal(module.createHomeDebatePlanningPendingRow().attributes["aria-live"], "off");
    module.syncHomeDebatePlanningPending({ debatePhase: "planning", isProcessing: true, messages: [{ role: "question", status: "answered" }] });
    assert.equal(module.isHomeDebatePlanningPending(), true);
    module.syncHomeDebatePlanningPending({ debatePhase: "planning", isProcessing: false, messages: [{ role: "question", status: "answered" }] });
    assert.equal(module.isHomeDebatePlanningPending(), true);
    module.clearHomeDebatePlanningPending();
    assert.equal(module.isHomeDebatePlanningPending(), false);
  } finally { global.document = originalDocument; }
});

test("Home live debate reducer renders multiple speaker identities without transcript controls", async function () {
  var originalDocument = global.document;
  var originalWindow = global.window;
  var storageKey = "local" + "Storage";
  var originalStorage = global[storageKey];
  var originalMarked = global.marked;
  var originalMermaid = global.mermaid;
  var originalPurifier = global.DOMPurify;
  var originalNodeFilter = global.NodeFilter;
  global.document = {
    createElement: function (tag) { return new FakeElement(tag); },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createTreeWalker: function () { return { nextNode: function () { return null; } }; },
    addEventListener: function () {},
  };
  global.window = { addEventListener: function () {}, matchMedia: function () { return { matches: false }; } };
  global[storageKey] = { getItem: function () { return null; }, setItem: function () {} };
  global.marked = { use: function () {}, parse: function (value) { return value; } };
  global.mermaid = { initialize: function () {} };
  global.DOMPurify = { sanitize: function (value) { return value; } };
  global.NodeFilter = { SHOW_TEXT: 4 };
  try {
    var storeModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/store.js")).href);
    storeModule.store.set({ cachedMatesList: [], cachedAllUsers: [{ id: "user-a", displayName: "Ari", avatarSeed: "ari" }], myUserId: "user-a" });
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-live.js")).href);
    var messages = [];
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_started", topic: "<b>Housing</b>", moderatorId: "builtin:clay", moderatorName: "Clay", panelists: [{ mateId: "panel-1", name: "Panel", role: "Analyst" }] });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_turn", turnId: "d:1", speakerMateId: "builtin:clay", mateName: "Clay", role: "moderator", round: 1, avatarStyle: "imprint", avatarSeed: "clay-seed", avatarCustom: "data:image/svg+xml,clay-exact" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_activity", turnId: "d:1", activity: "Thinking" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_stream", turnId: "d:1", delta: "Hello " });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_turn_done", turnId: "d:1", text: "Hello panel" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_stop_requested" });
    assert.equal(messages[0].stopping, true);
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_stop_cancelled" });
    assert.equal(messages[0].stopping, false);
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_tool_decision", decisionId: "tool-safe", speakerMateId: "panel-1", mateName: "Panel", toolName: "Bash", action: "Run read-only shell commands (rg)", command: "rg -n housing lib", decision: "allowed", reason: "Read-only investigation" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_tool_decision", decisionId: "tool-safe", speakerMateId: "panel-1", mateName: "Panel", toolName: "Bash", action: "Run read-only shell commands (rg)", decision: "allowed", reason: "Read-only investigation" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_tool_decision", decisionId: "tool-safe-2", speakerMateId: "panel-1", mateName: "Panel", toolName: "Bash", action: "Run read-only shell commands (rg)", command: "rg -n housing test", decision: "allowed", reason: "Read-only investigation" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_tool_decision", decisionId: "tool-blocked", speakerMateId: "panel-1", mateName: "Panel", toolName: "Edit", action: "Edit a project file", decision: "blocked", reason: "Would modify project files" });
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_turn", turnId: "d:2", speakerMateId: "panel-1", mateName: "Panel", role: "Analyst", round: 1, avatarStyle: "imprint", avatarSeed: "panel-seed", avatarCustom: "data:image/svg+xml,panel-exact" });
    assert.equal(messages.filter(function (message) { return message.role === "debate_turn"; }).length, 2);
    assert.equal(messages.filter(function (message) { return message.role === "debate_tool_decision"; }).length, 1);
    var planningModule = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var restored = module.normalizeHomeDebateMessages(planningModule.normalizeHomeTranscript(messages));
    assert.equal(restored.filter(function (message) { return message.role === "debate_tool_decision"; }).length, 1);
    assert.equal(messages[1].text, "Hello panel");
    assert.equal(messages[1].status, "done");
    assert.equal(module.isHomeDebateLive(messages), true);
    var header = module.createHomeDebateLiveCard(messages[0], true);
    var headerNodes = flatten(header);
    assert.equal(headerNodes.some(function (node) { return node.textContent === "<b>Housing</b>"; }), true);
    assert.equal(headerNodes.some(function (node) { return node.tagName === "BUTTON"; }), false);
    var finalized = module.createHomeDebateLiveCard(messages[1], true);
    var finalizedNodes = flatten(finalized);
    assert.equal(finalized.attributes["aria-label"], "Clay, Moderator, round 1");
    assert.equal(finalizedNodes.find(function (node) { return node.tagName === "IMG"; }).src, "data:image/svg+xml,clay-exact");
    assert.equal(finalizedNodes.some(function (node) { return node.textContent === "Clay"; }), true);
    assert.equal(finalizedNodes.some(function (node) { return node.textContent === "Moderator · Round 1"; }), true);
    assert.equal(finalizedNodes.some(function (node) { return node.className === "home-debate-live-activity"; }), false);

    var toolDecision = module.createHomeDebateLiveCard(messages[2], true);
    var toolDecisionNodes = flatten(toolDecision);
    assert.equal(toolDecision.attributes.role, "status");
    assert.equal(toolDecisionNodes.some(function (node) { return node.textContent === "Moderator access"; }), true);
    assert.equal(toolDecisionNodes.some(function (node) { return node.textContent === "Run read-only shell commands (rg)"; }), true);
    assert.equal(toolDecisionNodes.some(function (node) { return node.textContent === "Would modify project files"; }), true);
    assert.equal(toolDecisionNodes.some(function (node) { return node.textContent === "\u00d72"; }), true);
    assert.equal(toolDecisionNodes.some(function (node) { return node.tagName === "SUMMARY" && node.textContent === "Audit 2 commands"; }), true);
    assert.equal(toolDecisionNodes.some(function (node) { return node.tagName === "CODE" && node.textContent === "rg -n housing lib"; }), true);
    assert.equal(toolDecisionNodes.some(function (node) { return node.textContent.indexOf("<") !== -1; }), false);

    var active = module.createHomeDebateLiveCard(messages[3], false);
    var activeNodes = flatten(active);
    var activeContent = active.querySelector(".dm-bubble-content");
    var activity = active.querySelector(".home-debate-live-activity");
    var markdown = active.querySelector(".md-content");
    assert.equal(active.attributes["aria-label"], "Panel, Analyst, round 1");
    assert.equal(activeNodes.find(function (node) { return node.tagName === "IMG"; }).src, "data:image/svg+xml,panel-exact");
    assert.equal(activeNodes.some(function (node) { return node.textContent === "Panel"; }), true);
    assert.equal(activeNodes.some(function (node) { return node.textContent === "Analyst · Round 1"; }), true);
    assert.equal(activity.parentNode, activeContent);
    assert.ok(activeContent.children.indexOf(activity) < activeContent.children.indexOf(markdown));
    assert.equal(flatten(activity).filter(function (node) { return node.tagName === "I"; }).length, 3);

    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_user_floor_done", text: "I want to add one constraint." });
    var userMessage = messages.filter(function (message) { return message.role === "debate_user"; }).pop();
    var user = module.createHomeDebateLiveCard(userMessage, true);
    var userNodes = flatten(user);
    assert.equal(user.attributes["aria-label"], "You, participant");
    assert.equal(userNodes.some(function (node) { return node.textContent === "You"; }), true);
    assert.equal(userNodes.some(function (node) { return node.textContent === "Participant"; }), true);
    assert.ok(userNodes.find(function (node) { return node.tagName === "IMG"; }).src);
    assert.equal(user.children[0], user.querySelector(".dm-bubble-avatar"));
    assert.equal(user.children[1].children[0], user.querySelector(".dm-bubble-header"));
    assert.equal(user.children[1].children[1], user.querySelector(".bubble"));
    assert.notEqual(finalizedNodes.find(function (node) { return node.tagName === "IMG"; }).src, activeNodes.find(function (node) { return node.tagName === "IMG"; }).src);
    messages = module.applyHomeDebateEvent(messages, { eventType: "debate_ended", reason: "user_stopped" });
    assert.equal(module.homeDebatePhase(messages), "ended");
  } finally {
    global.document = originalDocument;
    global.window = originalWindow;
    global[storageKey] = originalStorage;
    global.marked = originalMarked;
    global.mermaid = originalMermaid;
    global.DOMPurify = originalPurifier;
    global.NodeFilter = originalNodeFilter;
  }
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/home-debate-live.css"), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /home-debate-tool-decision[\s\S]*var\(--text-secondary\)/);
  assert.match(css, /home-debate-tool-decision-mark[\s\S]*var\(--success\)/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*home-debate-tool-decision/);
  assert.match(css, /grid-template-columns:\s*34px minmax\(0, 1fr\)/);
  assert.match(css, /home-debate-live-turn > \.dm-bubble-avatar[\s\S]*display:\s*block/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*grid-template-columns:\s*32px minmax\(0, 1fr\)/);
});

test("Home debate responder sends exact session correlation once and locks the question", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var sent = [];
  var message = { role: "question", toolId: "ask-1", status: "pending" };
  var opener = { textContent: "Submit answer", tagName: "BUTTON", disabled: false, parentNode: { children: [{ tagName: "BUTTON", disabled: false }, { tagName: "INPUT", disabled: false }] } };
  var respond = module.createHomeDebateResponder(function (payload) { sent.push(payload); return true; }, function () { return { mateId: "builtin:clay", sessionId: "cli-1", requestId: "req-1" }; });
  respond(message, "answer", opener, { 0: "Decision" });
  respond(message, "answer", opener, { 0: "Duplicate" });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: "home_debate_question_response", toolId: "ask-1", answers: { 0: "Decision" }, mateId: "builtin:clay", sessionId: "cli-1", requestId: "req-1" });
  assert.equal(message.status, "submitting");
  assert.equal(opener.parentNode.children[0].disabled, true);
});

test("Home debate question resolution restores focus without scrolling and errors remain retryable", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var target = { focusOptions: null, focus: function (options) { this.focusOptions = options; } };
  var originalDocument = global.document;
  try {
    global.document = { querySelectorAll: function () { return [{ dataset: { toolId: "ask-focus" }, querySelector: function () { return target; } }]; } };
    module.restoreHomeDebateQuestionFocus("ask-focus");
    assert.deepEqual(target.focusOptions, { preventScroll: true });
    var messages = [{ role: "question", toolId: "ask-focus", status: "submitting", questions: [] }];
    messages = module.failHomeDebateQuestion(messages, { text: "Try again" });
    assert.equal(messages[0].status, "pending");
    assert.equal(messages[0].error, "Try again");
  } finally {
    global.document = originalDocument;
  }
});

test("debate planning restores the composer with preventScroll without stealing later intentional focus", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
  var originalDocument = global.document;
  var opener = { id: "home-sidebar-debate" };
  var body = { classList: { contains: function (name) { return name === "home-active"; } } };
  var focusOptions = null;
  var input = { disabled: false, focus: function (options) { focusOptions = options; } };
  try {
    global.document = { activeElement: opener, body: body };
    module.requestHomeDebateComposerFocus();
    global.document.activeElement = { id: "home-sidebar-expand" };
    input.disabled = true;
    module.restoreHomeDebateComposerFocus(input);
    assert.equal(focusOptions, null);
    input.disabled = false;
    module.restoreHomeDebateComposerFocus(input);
    assert.deepEqual(focusOptions, { preventScroll: true });
    focusOptions = null;
    global.document.activeElement = opener;
    module.requestHomeDebateComposerFocus();
    global.document.activeElement = { id: "capsules-button" };
    module.restoreHomeDebateComposerFocus(input);
    assert.equal(focusOptions, null);
  } finally {
    global.document = originalDocument;
  }
});

test("Home archive New debate selects builtin Clay while the sidebar only opens the archive", function () {
  var root = path.join(__dirname, "..");
  var chat = fs.readFileSync(path.join(root, "lib/public/modules/home-mate-chat.js"), "utf8");
  var sidebar = fs.readFileSync(path.join(root, "lib/public/modules/home-sidebar.js"), "utf8");
  var archive = fs.readFileSync(path.join(root, "lib/public/modules/home-debates-archive.js"), "utf8");
  var router = fs.readFileSync(path.join(root, "lib/public/modules/app-message-router.js"), "utf8");
  var project = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
  var sdkBridge = fs.readFileSync(path.join(root, "lib/sdk-bridge.js"), "utf8");
  var schema = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");
  var debateEngine = fs.readFileSync(path.join(root, "lib/project-debate.js"), "utf8");
  var sessions = fs.readFileSync(path.join(root, "lib/sessions.js"), "utf8");
  var css = fs.readFileSync(path.join(root, "lib/public/css/home-debate-planning.css"), "utf8");
  assert.match(chat, /builtinKey === "clay"/);
  assert.match(chat, /type: "home_mate_debate_plan"/);
  assert.doesNotMatch(chat, /openDebateModal|clay:home-debate/);
  assert.match(sidebar, /openHomeDebatesArchive\(\);[\s\S]*closeNarrowDrawer\(false\)/);
  var debateSidebarHandler = sidebar.slice(sidebar.indexOf("function openDebatesFromSidebar"), sidebar.indexOf("function startMateCreationFromSidebar"));
  assert.doesNotMatch(debateSidebarHandler, /home_mate_debate_plan|openHomeMateAction/);
  assert.match(archive, /function startNewDebate\(\)[\s\S]*homeDebateTopicFormOpen: true/);
  assert.match(archive, /openHomeMateAction\("debate", topic\.slice\(0, 1000\)\)/);
  assert.match(router, /home_debate_question[\s\S]*handleHomeDebateTranscript/);
  assert.match(router, /home_debate_proposal_resolved[\s\S]*handleHomeDebateTranscript/);
  assert.match(project, /home_debate_question_response[\s\S]*opts\.onDmMessage\(ws, msg(?:, slug)?\)/);
  assert.match(project, /onUserInputRequest: function \(session, request, respond\)[\s\S]*_askUser\.createHandler\(session\)/);
  assert.doesNotMatch(project, /_askUser\.getToolDefs\(session\)/);
  assert.match(sdkBridge, /requestedUserInputMode = session\.debateSetupMode \|\| session\.mateCreationMode \? "fallback" : "auto"/);
  assert.match(sdkBridge, /yoke\.userInput\.fallbackToolDefs\(sessionUserInputHandler, \{ maxQuestions: scheduleQuestionLimit \}\)/);
  assert.match(schema, /"home_debate_question_response"[\s\S]*"home_debate_question"[\s\S]*"home_debate_question_resolved"/);
  assert.match(debateEngine, /var reuseHomeSession = session\.homeDebatePlanning === true[\s\S]*if \(reuseHomeSession\)[\s\S]*session\.homeDebatePhase = "live"[\s\S]*else \{[\s\S]*createSession\(liveOpts, targetWs \|\| null\)/);
  assert.match(project, /home_debate_question_response" \|\| msg\.type === "home_debate_control"[\s\S]*opts\.onDmMessage\(ws, msg(?:, slug)?\)/);
  assert.match(schema, /"home_debate_control"[\s\S]*"home_debate_event"/);
  assert.match(sessions, /if \(session\.homeDebatePlanning === true\) return;/);
  assert.match(css, /\.home-debate-proposal button:focus-visible/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-debate-proposal/);
  assert.match(css, /\.home-debate-question button:focus-visible/);
});

test("Home debate launch immediately renders a dedicated correlated loading transcript", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-launch.js")).href);
    module.resetHomeDebateLaunch();
    module.beginHomeDebateLaunch("plan-loading");
    assert.equal(module.isHomeDebateLaunching(), true);
    var row = module.createHomeDebateLaunchRow();
    var nodes = flatten(row);
    assert.equal(row.attributes.role, "status");
    assert.equal(row.attributes["aria-live"], "polite");
    assert.equal(row.attributes["aria-atomic"], "true");
    assert.equal(row.attributes["aria-label"], "Clay is preparing your debate");
    assert.match(row.className, /home-debate-activity-launch/);
    assert.equal(nodes.some(function (node) { return node.textContent === "Clay"; }), true);
    assert.equal(nodes.some(function (node) { return node.textContent === "Preparing your debate"; }), true);
    var avatar = nodes.find(function (node) { return node.className === "home-debate-activity-avatar"; });
    assert.equal(avatar.src, "/clay-studio-symbol.png");
    assert.equal(avatar.alt, "");
    assert.equal(nodes.filter(function (node) { return node.tagName === "I"; }).length, 3);
    assert.equal(module.createHomeDebateLaunchRow().attributes["aria-live"], "off");
    assert.equal(module.settleHomeDebateLaunch({ requestId: "stale" }), false);
    assert.equal(module.isHomeDebateLaunching(), true);
    module.syncHomeDebateLaunchHistory({ requestId: "plan-loading", debatePlanning: true, messages: [] });
    assert.equal(module.isHomeDebateLaunching(), true);
    assert.equal(module.settleHomeDebateLaunch({ requestId: "plan-loading", type: "home_debate_question" }), true);
    assert.equal(module.isHomeDebateLaunching(), false);
  } finally {
    global.document = originalDocument;
  }
  var chat = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-mate-chat.js"), "utf8");
  assert.match(chat, /var hasConversation = debateLaunching \|\| messages\.length/);
  assert.match(chat, /if \(debateLaunching \|\| mateCreationActive \|\| !!debatePhase\) inputEl\.disabled = true/);
  assert.match(chat, /debateLaunching \? "Preparing your debate…"/);
  assert.match(chat, /if \(debateLaunching\) \{\s*transcript\.appendChild\(createHomeDebateLaunchRow\(\)\)/);
  var launch = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-debate-launch.js"), "utf8");
  var planning = fs.readFileSync(path.join(__dirname, "../lib/public/modules/home-debate-planning.js"), "utf8");
  var css = fs.readFileSync(path.join(__dirname, "../lib/public/css/home-debate-planning.css"), "utf8");
  var activityCss = css.slice(css.indexOf(".home-debate-activity"), css.indexOf(".home-debate-proposal"));
  assert.match(launch, /createHomeDebateActivityRow\("Preparing your debate", "Clay is preparing your debate"/);
  assert.match(planning, /createHomeDebateActivityRow\("Preparing the next question", "Clay is preparing the next question"/);
  assert.match(activityCss, /display: grid/);
  assert.match(activityCss, /align-self: flex-start/);
  assert.match(activityCss, /var\(--text-primary\)/);
  assert.match(activityCss, /var\(--accent\)/);
  assert.match(activityCss, /var\(--border\)/);
  assert.doesNotMatch(activityCss, /justify-content:\s*center|min-height:\s*120px|#[0-9a-f]{3,8}|serif/i);
  assert.doesNotMatch(css, /\.home-debate-preparing|\.home-debate-planning-pending/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.home-debate-activity-dots i/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.home-debate-activity/);
});
