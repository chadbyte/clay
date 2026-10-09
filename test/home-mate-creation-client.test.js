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
    var responder = module.createHomeMateProposalResponder(function (payload) { sent.push(payload); return true; }, function () { return { mateId: "clay", sessionId: "session-1", requestId: "request-1" }; });
    var card = module.createHomeMateProposalCard(message, responder);
    cards.push(card);
    assert.equal(card.attributes["aria-label"], "New Mate proposal: Atlas");
    assert.equal(flatten(card).some(function (node) { return node.textContent === "<img src=x onerror=bad()>"; }), true);
    assert.equal(flatten(card).some(function (node) { return node.tagName === "IMG"; }), false);
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
