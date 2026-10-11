var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");

test("Worker proposal card exposes runtime controls and sends one decision message", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/worker-proposal.js"), "utf8");
  assert.match(source, /worker-proposal-vendor/);
  assert.match(source, /worker-proposal-model/);
  assert.match(source, /worker-proposal-effort-btn/);
  assert.match(source, /type: "worker_proposal_response"/);
  assert.match(source, /Run with Split Worker/);
  assert.match(source, /Replace Split Worker/);
  assert.match(source, /Awaiting your choice/);
  assert.match(source, /Why this runtime/);
  assert.match(source, /Driver recommendation auto-accepted under Full auto/);
  assert.match(source, /status === "completed"\) return "Completed"/);
  assert.doesNotMatch(source, /Suggested by Fable/);
});

test("resolved audit cards prefer the selected runtime over the Driver recommendation", async function () {
  var module = await import(pathToFileURL(path.join(root, "lib/public/modules/worker-proposal-state.js")).href);
  var pending = module.workerProposalSelection({
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
  });
  assert.deepStrictEqual(pending, {
    selected: false,
    vendor: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
  });

  var manualOverride = module.workerProposalSelection({
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
    selectedVendor: "claude",
    selectedModel: "claude-sonnet-5",
    selectedEffort: "medium",
  });
  assert.deepStrictEqual(manualOverride, {
    selected: true,
    vendor: "claude",
    model: "claude-sonnet-5",
    effort: "medium",
  });
  var synced = null;
  module.syncWorkerProposalSelection({
    selectedVendor: "claude",
    selectedModel: "claude-sonnet-5",
    selectedEffort: "medium",
  }, function (selection) { synced = selection; });
  assert.deepStrictEqual(synced, manualOverride, "a selection-bearing update synchronizes the visible controls");

  var automaticModel = module.workerProposalSelection({
    recommendedVendor: "codex",
    recommendedModel: "gpt-5.6-sol",
    recommendedEffort: "high",
    selectedVendor: "codex",
    selectedModel: "",
    selectedEffort: "low",
  });
  assert.equal(automaticModel.model, "", "an explicitly selected automatic model never falls back to the recommendation");
  var source = fs.readFileSync(path.join(root, "lib/public/modules/worker-proposal.js"), "utf8");
  assert.match(source, /syncWorkerProposalSelection\(msg, card\._syncWorkerProposalSelection\)/);
});

test("message routing renders and updates Worker proposal lifecycle events", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  assert.match(source, /case "worker_proposal":\s*renderWorkerProposal\(msg\)/);
  assert.match(source, /case "worker_proposal_update":\s*updateWorkerProposal\(msg\)/);
  assert.match(source, /msg\.name\.indexOf\("propose_worker"\)/);
});

test("proposal tools are provider-approved while runtime auto-accept remains card-audited", function () {
  var source = fs.readFileSync(path.join(root, "lib/sdk-bridge.js"), "utf8");
  assert.match(source, /propose_worker: true/);
  assert.match(source, /replace_partner: true/);
  assert.match(source, /partner_status: true/);
  var proposal = fs.readFileSync(path.join(root, "lib/project-worker-proposal.js"), "utf8");
  assert.match(proposal, /skipPermissionsEnabled/);
  assert.match(proposal, /recommendationCanAutoAccept/);
  assert.match(proposal, /sm\.sendAndRecord\(session, proposal\);[\s\S]*skipPermissionsEnabled/);
  assert.match(proposal, /decisionMode: autoAccepted \? "driver_recommendation" : "user"/);
});

test("Worker proposal card keeps responsive controls inside split panes", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/css/worker-proposal.css"), "utf8");
  assert.match(source, /width: min\(var\(--content-width\), calc\(100% - 40px\)\)/);
  assert.match(source, /@media \(max-width: 720px\)/);
  assert.match(source, /grid-template-columns: minmax\(0, .8fr\) minmax\(0, 1.2fr\)/);
});

test("composer exposes direct Worker creation and handoff controls", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var actions = fs.readFileSync(path.join(root, "lib/public/modules/session-actions.js"), "utf8");
  assert.doesNotMatch(html, /id="header-session-actions-btn"/);
  assert.match(html, /id="composer-add-worker-btn"[^>]*aria-label="Add Split Worker"/);
  assert.match(html, /id="composer-handoff-btn"[^>]*aria-label="Continue in another agent"/);
  assert.match(actions, /openPairDialog/);
});

test("composer session actions follow the icon-only context control", function () {
  var html = fs.readFileSync(path.join(root, "lib/public/index.html"), "utf8");
  var panels = fs.readFileSync(path.join(root, "lib/public/modules/app-panels.js"), "utf8");
  var contextAt = html.indexOf('id="context-sources-btn-wrap"');
  var workerAt = html.indexOf('id="composer-add-worker-btn"');
  var handoffAt = html.indexOf('id="composer-handoff-btn"');

  assert.ok(contextAt > 0 && contextAt < workerAt && workerAt < handoffAt);
  assert.doesNotMatch(html, /class="ctx-label"/);
  assert.match(panels, /statusArea\.insertBefore\(hCtxEl, statusArea\.firstChild\)/);
});

test("Split Worker labels do not rename distinct Worker proposal or runtime protocol", function () {
  // Session titles are assigned where a pair is created, which is
  // session-pair-factory.js; project-session-pair.js operates an existing one.
  var factorySource = fs.readFileSync(path.join(root, "lib/session-pair-factory.js"), "utf8");
  var proposalSource = fs.readFileSync(path.join(root, "lib/project-worker-proposal.js"), "utf8");
  var capsuleSource = fs.readFileSync(path.join(root, "lib/tool-capsule-source.js"), "utf8");

  assert.match(factorySource, /Split Worker · /);
  assert.match(factorySource, /Driver · /);
  assert.match(proposalSource, /visible Split Worker/);
  assert.match(proposalSource, /type: "worker_proposal"/);
  assert.match(proposalSource, /name: "propose_worker"/);
  assert.match(capsuleSource, /runtime === "worker"/);
});
