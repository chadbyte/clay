var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function Element(tag) {
  this.tagName = tag.toUpperCase(); this.children = []; this.className = ""; this.textContent = ""; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.disabled = false;
}
Element.prototype.appendChild = function (child) { this.children.push(child); child.parentNode = this; return child; };
Element.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
Element.prototype.addEventListener = function (name, handler) { this.listeners[name] = handler; };
Element.prototype.click = function () { if (this.listeners.click) this.listeners.click(); };
Element.prototype.focus = function (options) { this.focusOptions = options; };
Element.prototype.querySelector = function (selector) { var nodes = flatten(this); for (var i = 0; i < nodes.length; i++) { if (selector === "button" && nodes[i].tagName === "BUTTON") return nodes[i]; if (selector === '[role="status"]' && nodes[i].attributes.role === "status") return nodes[i]; if (selector === '[role="alert"]' && nodes[i].attributes.role === "alert") return nodes[i]; } return null; };
function flatten(node) { var result = [node]; for (var i = 0; i < node.children.length; i++) result = result.concat(flatten(node.children[i])); return result; }

test("Home Mate proposal is safe, accessible, and sends exact approval correlation", async function () {
  var originalDocument = global.document;
  var cards = [];
  global.document = {
    createElement: function (tag) { return new Element(tag); },
    querySelectorAll: function () { return cards; },
  };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-mate-creation.js")).href);
    var sent = [];
    var message = { role: "mate_proposal", status: "pending", proposal: { proposalId: "p1", name: "Atlas", bio: "Planning partner", relationship: "Partner", activities: ["Planning"], communicationStyle: ["Direct"], autonomy: "Ask before changes", identityMarkdown: "<img src=x onerror=bad()>" } };
    message.proposal.scheduleTimezone = "UTC";
    message.proposal.scheduleIntent = { message: "send my briefing", scheduleRule: { anchorDate: "2031-01-01", time: "09:00", recurrence: null } };
    var responder = module.createHomeMateProposalResponder(function (payload) { sent.push(payload); return true; }, function () { return { mateId: "clay", sessionId: "session-1", requestId: "request-1" }; });
    var card = module.createHomeMateProposalCard(message, responder);
    cards.push(card);
    assert.equal(card.attributes["aria-label"], "New Mate proposal: Atlas");
    assert.equal(flatten(card).some(function (node) { return node.textContent === "<img src=x onerror=bad()>"; }), true);
    assert.equal(flatten(card).some(function (node) { return node.tagName === "IMG"; }), false);
    var facts = flatten(card).find(function (node) { return node.className === "home-mate-proposal-facts"; });
    assert.deepEqual(facts.children.filter(function (node) { return node.tagName === "DT"; }).map(function (node) { return node.textContent; }), ["Relationship", "Activities", "Communication", "Autonomy", "Schedule"]);
    var scheduleItem = facts.children[facts.children.length - 1];
    assert.equal(scheduleItem.children[0].textContent, "January 1, 2031 at 9 AM: send my briefing");
    assert.equal(scheduleItem.children[1].tagName, "DETAILS");
    assert.equal(scheduleItem.children[1].children[0].tagName, "SUMMARY");
    assert.equal(scheduleItem.children[1].children[0].textContent, "Exact timing");
    assert.equal(scheduleItem.children[1].children[1].textContent, "On January 1, 2031 at 09:00 (UTC): send my briefing");
    var cases = [
      { timezone: "Pacific/Auckland", rule: { recurrence: { every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] } }, summary: "Every weekday morning at 9: send my briefing", expected: "Every weekday at 09:00 (Pacific/Auckland), starting January 1, 2031: send my briefing" },
      { rule: { recurrence: { every: 2, unit: "week", weekdays: [1, 3] }, recurrenceEnd: { type: "after", count: 5 }, interval: { every: 2, unit: "hour", end: { type: "until", time: "17:00" } } }, summary: "Every 2 weeks on Monday, Wednesday at 9 AM, for 5 deliveries, then every 2 hours until 5 PM: send my briefing", expected: "Every 2 weeks on Monday, Wednesday at 09:00 (UTC), starting January 1, 2031; for 5 deliveries; every 2 hours until 17:00: send my briefing" },
      { rule: { recurrence: { every: 1, unit: "day" }, recurrenceEnd: { type: "until", date: "2031-01-05" }, interval: { every: 30, unit: "minute", end: { type: "after", count: 3 } } }, summary: "Every morning at 9, through January 5, 2031, then every 30 minutes, 3 deliveries a day: send my briefing", expected: "Every day at 09:00 (UTC), starting January 1, 2031; through January 5, 2031; every 30 minutes, 3 deliveries per day: send my briefing" },
      { rule: { interval: { every: 1, unit: "hour", end: null } }, summary: "January 1, 2031 at 9 AM, then every 1 hour until the end of the day: send my briefing", expected: "On January 1, 2031 at 09:00 (UTC); every 1 hour until end of day: send my briefing" },
    ];
    cases.forEach(function (example) {
      var variant = { status: "pending", proposal: Object.assign({}, message.proposal, { scheduleTimezone: example.timezone || "UTC", scheduleIntent: { message: "send my briefing", scheduleRule: Object.assign({ anchorDate: "2031-01-01", time: "09:00", recurrence: null }, example.rule) } }) };
      var variantCard = module.createHomeMateProposalCard(variant, responder);
      var variantFacts = flatten(variantCard).find(function (node) { return node.className === "home-mate-proposal-facts"; });
      assert.equal(variantFacts.children.length, facts.children.length);
      var scheduleItem = variantFacts.children[variantFacts.children.length - 1];
      assert.equal(scheduleItem.children[0].textContent, example.summary);
      assert.doesNotMatch(scheduleItem.children[0].textContent, /UTC|Pacific\/Auckland|09:00|starting/);
      assert.equal(scheduleItem.children[1].children[1].textContent, example.expected);
    });
    [
      ["00:00", "midnight"], ["12:00", "noon"], ["00:15", "12:15 AM"],
      ["12:30", "12:30 PM"], ["09:05", "9:05 AM"], ["21:45", "9:45 PM"],
    ].forEach(function (example) {
      var variant = { status: "pending", proposal: Object.assign({}, message.proposal, { scheduleIntent: { message: "send my briefing", scheduleRule: { anchorDate: "2031-01-01", time: example[0], recurrence: null } } }) };
      var variantCard = module.createHomeMateProposalCard(variant, responder);
      var summary = flatten(variantCard).find(function (node) { return node.className === "home-mate-proposal-schedule-summary"; });
      assert.equal(summary.textContent, "January 1, 2031 at " + example[1] + ": send my briefing");
    });
    var create = flatten(card).find(function (node) { return node.className === "home-mate-proposal-create"; });
    create.click();
    assert.equal(message.status, "submitting");
    assert.deepEqual(sent[0], { type: "home_mate_creation_proposal_response", proposalId: "p1", action: "create", mateId: "clay", sessionId: "session-1", requestId: "request-1" });
    var restored = module.resolveHomeMateProposal([message], { proposalId: "p1", action: "create", createdMateId: "mate-new", mateName: "Atlas" });
    assert.equal(restored[0].status, "created");
    var opened = [];
    var resolvedCard = module.createHomeMateProposalCard(restored[0], responder, function (created) { opened.push(created.mateId); });
    assert.equal(flatten(resolvedCard).some(function (node) { return node.textContent === "Mate created" && node.attributes.role === "status"; }), true);
    var open = flatten(resolvedCard).find(function (node) { return node.className === "home-mate-proposal-open"; });
    assert.equal(open.textContent, "Open Atlas");
    assert.equal(open.attributes["aria-label"], "Open conversation with Atlas");
    open.click();
    assert.deepEqual(opened, ["mate-new"]);
  } finally { global.document = originalDocument; }
});

test("Mate creation question uses the shared card with a distinct response protocol", async function () {
  var originalDocument = global.document;
  global.document = { createElement: function (tag) { return new Element(tag); } };
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/home-debate-planning.js")).href);
    var sent = [];
    var message = { role: "question", flow: "mate_creation", toolId: "q1", status: "pending", questions: [{ question: "What kind of Mate would you like?", options: [] }] };
    var responder = module.createHomeDebateResponder(function (payload) { sent.push(payload); return true; }, function () { return { mateId: "clay", sessionId: "s1", requestId: "r1" }; });
    var card = module.createHomeDebateQuestionCard(message, responder);
    assert.match(card.attributes["aria-label"], /^Mate creation interview question:/);
    var input = flatten(card).find(function (node) { return node.tagName === "TEXTAREA"; });
    var submit = flatten(card).find(function (node) { return node.className === "home-debate-question-submit"; });
    input.value = "A research partner";
    input.listeners.input();
    submit.click();
    assert.equal(sent[0].type, "home_mate_creation_question_response");
    assert.deepEqual(sent[0].answers, { 0: "A research partner" });
  } finally { global.document = originalDocument; }
});

test("visible Mate creation entries reuse the Clay project interview", function () {
  var app = fs.readFileSync(path.join(__dirname, "../lib/public/app.js"), "utf8");
  var planning = fs.readFileSync(path.join(__dirname, "../lib/public/modules/project-debate-planning-workspace.js"), "utf8");
  assert.match(app, /function startClayMateCreation\(\)[\s\S]*click\(\)/);
  assert.match(app, /openMateWizard: function \(\) \{ startClayMateCreation\(\); \}/);
  assert.match(app, /case "createMate": startClayMateCreation\(\); break;/);
  assert.doesNotMatch(app, /from '\.\/modules\/mate-wizard\.js'/);
  assert.doesNotMatch(app, /initMateWizard\(/);
  assert.match(planning, /openMateWorkspace\(clay\.id\)/);
});
