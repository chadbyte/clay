// Mode-aware prompts, catalogs and services of the modules the Agent behavior
// policy governs, using the real modules with injected dependencies only.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var attachGate = require("../lib/agent-behavior-gate").attachAgentBehavior;
var notesModule = require("../lib/project-session-notes");
var issuesMcp = require("../lib/issues-mcp-server");
var logsMcp = require("../lib/project-logs-mcp-server");
var guidance = require("../lib/issues-filing-guidance");
var userKnowledge = require("../lib/project-user-knowledge");
var pairPrompt = require("../lib/project-session-pair-prompt");

var SESSION = { localId: 1, ownerId: "u1" };

function gateFor(settings, extra) {
  return attachGate(Object.assign({ isMate: false, isMultiUser: function () { return true; }, getPolicy: function () { return settings; } }, extra || {}));
}

function notesFor(gate) {
  var sessions = new Map([[1, SESSION]]);
  return notesModule.attachSessionNotes({
    agentBehavior: gate,
    nm: { list: function () { return [{ id: "n1", text: "Check the cache", state: "open", createdAt: 1 }]; } },
    canUseSession: function (s) { return sessions.get(s.localId) === s; },
    send: function () {},
  });
}

var NOTE_MARK = "short linked Sticky Note";

test("default notes prompt and catalog are byte-identical with and without a gate", function () {
  var plain = notesFor(null);
  var gated = notesFor(gateFor({}));
  assert.equal(gated.getSystemPrompt(SESSION, gateFor({}).view(SESSION)), plain.getSystemPrompt(SESSION));
  var a = plain.getToolDefs(SESSION).map(function (t) { return t.description; });
  var b = gated.getToolDefs(SESSION).map(function (t) { return t.description; });
  assert.deepEqual(b, a);
  assert.ok(plain.getSystemPrompt(SESSION).indexOf(NOTE_MARK) !== -1, "the shipped default keeps the Issue-linked note exception");
});

test("Sticky Notes Off removes the board and its instructions; On request writes only on request", function () {
  var off = gateFor({ notes: "off" });
  assert.equal(notesFor(off).getSystemPrompt(SESSION, off.view(SESSION)), "");
  var request = gateFor({ notes: "request" });
  var prompt = notesFor(request).getSystemPrompt(SESSION, request.view(SESSION));
  assert.match(prompt, /Check the cache/, "the board is still readable On request");
  assert.match(prompt, /only when the user's message asks/);
  assert.doesNotMatch(prompt, new RegExp(NOTE_MARK), "On request never carries the automatic Issue note rule");
  assert.doesNotMatch(prompt, /Create a note proactively/);
  var descriptions = notesFor(request).getToolDefs(SESSION).map(function (t) { return t.description; }).join("\n");
  assert.doesNotMatch(descriptions, new RegExp(NOTE_MARK));
  assert.doesNotMatch(descriptions, /confirmed Issue link notes/);
});

test("the linked-note checkbox removes only the automatic Issue note rule", function () {
  var gate = gateFor({ issueLinkedNotes: false });
  var notes = notesFor(gate);
  var prompt = notes.getSystemPrompt(SESSION, gate.view(SESSION));
  assert.doesNotMatch(prompt, new RegExp(NOTE_MARK));
  assert.doesNotMatch(prompt, /Issue link notes/);
  assert.match(prompt, /Create a note proactively only when the user explicitly asks/);
  var write = notes.getToolDefs(SESSION).find(function (t) { return t.name === "write_note"; });
  assert.doesNotMatch(write.description, /confirmed Issue link notes and/);
});

test("Issues Auto with Notes On request does not tell the Driver to write notes", function () {
  var gate = gateFor({ issues: "auto", notes: "request" });
  var view = gate.view(SESSION);
  assert.equal(view.issueLinkedNotes, false);
  var options = { linked: view.issueLinkedNotes, mode: "auto" };
  var contract = issuesMcp.contract(options);
  assert.doesNotMatch(contract, /Sticky Note/);
  assert.match(contract, /Automatic Issue filing/, "Issues keeps its own automatic filing");
  var defs = issuesMcp.getToolDefs(null, options);
  defs.forEach(function (d) { assert.doesNotMatch(d.description, /Sticky Note/); });
  var attention = logsMcp.attentionContract(view);
  assert.doesNotMatch(attention, /Sticky Note/);
  assert.doesNotMatch(attention, new RegExp(guidance.NOTE_GUIDANCE.slice(0, 40)));
  var notePrompt = notesFor(gate).getSystemPrompt(SESSION, view);
  assert.doesNotMatch(notePrompt, new RegExp(NOTE_MARK));
});

test("Issues On request replaces automatic filing; default Issues text is unchanged", function () {
  assert.equal(issuesMcp.contract(undefined), issuesMcp.CONTRACT);
  assert.equal(issuesMcp.contract({ mode: "auto", linked: true }), issuesMcp.CONTRACT);
  var request = issuesMcp.contract({ mode: "request", linked: true });
  assert.match(request, /On request/);
  assert.doesNotMatch(request, /Automatic Issue filing/);
  assert.doesNotMatch(request, /proactively search or reuse/);
  assert.doesNotMatch(request, /Sticky Note/);
});

test("the Logbook contract follows Notes, Issues and learning settings", function () {
  var auto = gateFor({}).view(SESSION);
  assert.equal(logsMcp.attentionContract(auto), logsMcp.ATTENTION_CONTRACT);
  var noNotes = logsMcp.attentionContract(gateFor({ notes: "off" }).view(SESSION));
  assert.doesNotMatch(noNotes, /Sticky Note/);
  assert.match(noNotes, /Project Logs are the durable continuity record/);
  var issuesOff = logsMcp.attentionContract(gateFor({ issues: "off" }).view(SESSION));
  assert.doesNotMatch(issuesOff, /Issue/);
  assert.equal(logsMcp.attentionContract(null), logsMcp.ATTENTION_CONTRACT);
});

function userKnowledgeFor(gate) {
  var bound = {
    list: function () { return { items: [{ ref: "me:1", category: "style", summary: "Prefers short answers" }] }; },
    isClay: function () { return false; },
    read: function () { return {}; }, report: function () { return { queued: true }; },
  };
  var reads = { count: 0 };
  var module = userKnowledge.attachProjectUserKnowledge({
    agentBehavior: gate, slug: "p",
    service: { bind: function () { reads.count++; return bound; } },
    isMultiUser: function () { return true; }, sendTo: function () {}, schedule: function () {},
  });
  return { module: module, reads: reads };
}

test("Me use and Me collection are separate in the prompt and the tool descriptions", function () {
  var plain = userKnowledgeFor(null).module;
  var defaultGate = gateFor({});
  var gated = userKnowledgeFor(defaultGate).module;
  assert.equal(gated.getSystemPrompt(SESSION, defaultGate.view(SESSION)), plain.getSystemPrompt(SESSION));
  assert.deepEqual(gated.getDynamicToolDefs(SESSION).map(function (t) { return t.description; }), plain.getDynamicToolDefs(SESSION).map(function (t) { return t.description; }));

  var noUse = gateFor({ meUse: "off" });
  var fixture = userKnowledgeFor(noUse);
  var promptNoUse = fixture.module.getSystemPrompt(SESSION, noUse.view(SESSION));
  assert.doesNotMatch(promptNoUse, /Prefers short answers/, "no knowledge is injected");
  assert.doesNotMatch(promptNoUse, /consult relevant User Knowledge/);
  assert.match(promptNoUse, /report_user_observation/, "collection guidance remains");
  assert.equal(fixture.reads.count, 1);

  var noCollect = gateFor({ meCollection: "off" });
  var promptNoCollect = userKnowledgeFor(noCollect).module.getSystemPrompt(SESSION, noCollect.view(SESSION));
  assert.match(promptNoCollect, /Prefers short answers/);
  assert.doesNotMatch(promptNoCollect, /Report durable explicit preferences/);

  var both = gateFor({ meUse: "request", meCollection: "off" });
  var untouched = userKnowledgeFor(both);
  assert.equal(untouched.module.getSystemPrompt(SESSION, both.view(SESSION)), "");
  assert.equal(untouched.reads.count, 0, "an Off or On request Me never reads knowledge, so the conversation is not marked owner-only");
});

function pairFor(proposalCalls) {
  var driver = { localId: 1, ownerId: "u1", vendor: "claude", model: "claude-opus-4" };
  return pairPrompt.attachSessionPairPrompt({
    sm: { sessions: new Map([[1, driver]]), defaultModelByVendor: {}, installedVendors: ["claude"] },
    store: { groupForMember: function () { return null; } },
    isMate: false,
    rolesFor: function () { return null; },
    workerProposal: function () { return { getSystemPrompt: function (session, mode) { proposalCalls.push(mode); return "PROPOSAL_TEXT"; } }; },
  });
}

test("Worker proposals Off or On request drop the proactive delegation nudge only", function () {
  var calls = [];
  var pair = pairFor(calls);
  var driver = { localId: 1, ownerId: "u1", vendor: "claude", model: "claude-opus-4" };
  var autoView = gateFor({}).view(driver);
  var autoText = pair.getSystemPrompt(driver, autoView);
  var offText = pair.getSystemPrompt(driver, gateFor({ workerProposals: "off" }).view(driver));
  var requestText = pair.getSystemPrompt(driver, gateFor({ workerProposals: "request" }).view(driver));
  assert.match(autoText, /propose_worker before substantial execution/);
  assert.equal(offText, "");
  assert.equal(requestText, "");
  assert.equal(pair.getSystemPrompt(driver), autoText, "no behavior argument keeps today's prompt");
});

test("the Worker proposal prompt keeps Worker management text when proposals are restricted", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/project-worker-proposal.js"), "utf8");
  assert.match(source, /function getSystemPrompt\(session, mode\)/);
  assert.match(source, /if \(!proactive\) return MANAGEMENT_ONLY/);
});

test("Markdown viewer and Sketch prompts follow their own settings", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-ab-docs-"));
  try {
    var documents = require("../lib/project-session-document").attachSessionDocument({ cwd: root, sendToSession: function () {}, getOsUserInfoForSession: function () { return null; } });
    var both = documents.getSystemPrompt(SESSION);
    assert.match(both, /present_markdown_edit/);
    assert.match(both, /clay-sketch/);
    var noSketch = documents.getSystemPrompt(SESSION, gateFor({ sketch: "off" }).view(SESSION));
    assert.match(noSketch, /present_markdown_edit/);
    assert.doesNotMatch(noSketch, /clay-sketch/);
    var noMarkdown = documents.getSystemPrompt(SESSION, gateFor({ markdownViewer: "request" }).view(SESSION));
    assert.doesNotMatch(noMarkdown, /present_markdown_edit/);
    assert.match(noMarkdown, /clay-sketch/);
    assert.equal(documents.getSystemPrompt(SESSION, gateFor({ sketch: "off", markdownViewer: "off" }).view(SESSION)), "");
    assert.equal(documents.getSystemPrompt(SESSION, gateFor({}).view(SESSION)), both);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("skill discovery excludes only the names a caller lists", function () {
  var skillDiscovery = require("../lib/yoke/skill-discovery");
  var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-ab-skills-"));
  try {
    var base = { homeDir: home, env: {}, scopedHome: true };
    var names = skillDiscovery.discoverSkills(home, base).map(function (s) { return s.name; });
    assert.ok(names.indexOf("clay-sketch") !== -1, "the bundled skill is present by default");
    var filtered = skillDiscovery.discoverSkills(home, Object.assign({ excludeSkills: ["clay-sketch"] }, base)).map(function (s) { return s.name; });
    assert.equal(filtered.indexOf("clay-sketch"), -1);
    assert.deepEqual(filtered, names.filter(function (n) { return n !== "clay-sketch"; }));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
  var scope = require("../lib/session-skill-scope");
  var bound = scope.bind({ localId: 1, ownerId: null }, new Map(), { env: {} }, function () { return true; }, false, ["clay-sketch"]);
  assert.deepEqual(bound.excludeSkills, ["clay-sketch"]);
  assert.equal(scope.bind({ localId: 1 }, new Map(), { env: {} }, function () { return true; }, false).excludeSkills, undefined);
});

// --- Project Logs learning records at the service call --------------------

function logsFixture(settings) {
  var logsStore = require("../lib/project-logs-store");
  var attachService = require("../lib/project-logs-service").attachProjectLogsService;
  var base = fs.mkdtempSync(path.join(os.tmpdir(), "clay-ab-logs-"));
  var session = { localId: 11, cliSessionId: "cli-11", ownerId: "owner", vendor: "claude" };
  var manager = { sessions: new Map([[11, session]]) };
  var projects = new Map([["app", { getStatus: function () { return { slug: "app", path: "/srv/app", projectOwnerId: "owner", visibility: "private" }; }, getSessionManager: function () { return manager; } }]]);
  var cache = new Map();
  var service = attachService({
    getProjects: function () { return projects; }, isMultiUser: function () { return true; },
    canAccessProject: function (userId, status) { return status.projectOwnerId === userId; },
    findUserById: function (id) { return { id: id, displayName: id }; },
    openStore: function (cwd) { if (!cache.has(cwd)) cache.set(cwd, logsStore.createProjectLogsStore({ root: cwd, baseDir: base })); return cache.get(cwd); },
  });
  var current = { value: settings };
  var gate = attachGate({ isMate: false, isMultiUser: function () { return true; }, getPolicy: function () { return current.value; } });
  var attached = require("../lib/project-logs").attachProjectLogs({
    agentBehavior: gate, service: service, sm: manager, projectSlug: "app", getProjectOwnerId: function () { return "owner"; },
    sendTo: function () {}, getClients: function () { return []; },
  });
  return { attached: attached, session: session, current: current, gate: gate, cleanup: function () { fs.rmSync(base, { recursive: true, force: true }); } };
}

function logTool(fixture, name) {
  return fixture.attached.getDynamicToolDefs(fixture.session).find(function (t) { return t.name === name; });
}

test("Learning records Off refuses learning writes at the service but allows other categories", async function () {
  var fixture = logsFixture({ logsLearning: "off" });
  try {
    var create = fixture.attached.getToolDefs(fixture.session).find(function (t) { return t.name === "create_log"; });
    var refused = await create.handler({ kind: "learning", title: "Idempotency", summary: "Clarified retries." });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /Learning records are turned off/);
    var spelled = await create.handler({ kind: "  Learning ", title: "Spelled differently", summary: "x" });
    assert.equal(spelled.isError, true, "the category is normalized before comparison");
    var ok = await create.handler({ kind: "decision", title: "Cache decision", summary: "Adopted an append-only cache log." });
    assert.equal(ok.isError, undefined, JSON.stringify(ok));

    fixture.current.value = {};
    var learning = await create.handler({ kind: "learning", title: "Idempotency", summary: "Clarified retries." });
    assert.equal(learning.isError, undefined, "Auto allows learning again");
    var ref = JSON.parse(learning.content[0].text).ref;
    fixture.current.value = { logsLearning: "off" };
    var update = fixture.attached.getToolDefs(fixture.session).find(function (t) { return t.name === "update_log"; });
    var blocked = await update.handler({ ref: ref, summary: "Refined summary of the retry concept." });
    assert.equal(blocked.isError, true, "an existing learning entry cannot be revised while learning is Off");
    var otherRef = JSON.parse(ok.content[0].text).ref;
    var allowed = await update.handler({ ref: otherRef, summary: "Revised decision summary for the cache log." });
    assert.equal(allowed.isError, undefined, JSON.stringify(allowed));
  } finally { fixture.cleanup(); }
});

test("Logs prompt: Auto keeps today's text, learning is conditional, Off and On request add nothing", function () {
  var fixture = logsFixture({});
  try {
    var plain = fixture.attached.getSystemPrompt(fixture.session);
    var auto = fixture.attached.getSystemPrompt(fixture.session, fixture.gate.view(fixture.session));
    assert.equal(auto, plain);
    assert.match(plain, /learning/);
    fixture.current.value = { logsLearning: "request" };
    var noLearning = fixture.attached.getSystemPrompt(fixture.session, fixture.gate.view(fixture.session));
    assert.doesNotMatch(noLearning, /Capture durable user learning moments/);
    assert.match(noLearning, /Project Logs/);
    fixture.current.value = { logs: "off" };
    assert.equal(fixture.attached.getSystemPrompt(fixture.session, fixture.gate.view(fixture.session)), "");
    fixture.current.value = { logs: "request" };
    assert.equal(fixture.attached.getSystemPrompt(fixture.session, fixture.gate.view(fixture.session)), "");
  } finally { fixture.cleanup(); }
});

test("Log feedback is not delivered to a Driver whose Logbook is Off", function () {
  var delivery = require("../lib/project-log-feedback-delivery");
  var session = { localId: 5, ownerId: "u1", cliSessionId: "cli-5", isProcessing: false, history: [] };
  var started = [];
  var gate = gateFor({ logs: "off" });
  var service = delivery.attachProjectLogFeedbackDelivery({
    agentBehavior: gate,
    sm: { sessions: new Map([[5, session]]), sendAndRecord: function () {}, sendToSession: function () {}, broadcastSessionList: function () {} },
    getSdk: function () { return { pushMessage: function () { started.push("push"); return true; }, startQuery: function () { started.push("start"); return Promise.resolve(); } }; },
  });
  var entry = { ref: "log:1", pendingFeedbackCount: 1, updatedBy: { type: "session", sessionKey: "cli-5", userId: "u1" } };
  assert.equal(service.deliver(entry), false);
  assert.deepEqual(started, []);
});

// --- Fresh and resumed provider queries through the real SDK bridge ---------

test('fresh and resumed Codex queries rebuild the catalog and prompt, and a held tool is refused when Off', async function () {
  var liveQuery = require('./helpers/live-query-fixture.cjs');
  var createBridge = require('../lib/sdk-bridge').createSDKBridge;
  var policy = { value: {} };
  var gate = attachGate({ isMate: false, isMultiUser: function () { return true; }, getPolicy: function () { return policy.value; } });
  var executed = [];
  function defs() {
    return [
      { name: 'write_note', description: 'Write a note.', inputSchema: { type: 'object' }, handler: function (args) { executed.push(args.text); return Promise.resolve({ content: [{ type: 'text', text: 'written' }] }); } },
      { name: 'search_user_knowledge', description: 'Search.', inputSchema: { type: 'object' }, handler: function () { return Promise.resolve({ content: [{ type: 'text', text: '[]' }] }); } },
    ];
  }
  var session = { localId: 1, ownerId: 'u1', vendor: 'codex', mode: 'gui', history: [], cliSessionId: 'thread-1', pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sessions = new Map([[1, session]]);
  var captures = [];
  var sm = { sessions: sessions, modelsByVendor: { codex: [] }, capabilitiesByVendor: { codex: {} }, availableModels: [], saveSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function () {}, sendToSession: function () {} };
  var adapter = { vendor: 'codex', createQuery: function (options) { captures.push(options); return Promise.resolve(liveQuery.create()); } };
  var bridge = createBridge({
    cwd: process.cwd(), slug: 'ab', isMate: false, sessionManager: sm, adapter: adapter, adapters: { codex: adapter }, send: function () {},
    getSessionToolDefs: function (s) { return gate.filterTools(s, defs()); },
    getSessionSystemPrompt: function (s) { return gate.notice(s); },
    canUseSessionTools: function () { return sessions.get(1) === session; },
  });
  function catalogNames(capture) { return capture.dynamicTools.map(function (t) { return t.name; }).filter(function (name) { return name !== 'ask_user_questions'; }); }
  await bridge.startQuery(session, 'first', null, null);
  assert.deepEqual(catalogNames(captures[0]), ['write_note', 'search_user_knowledge']);
  assert.doesNotMatch(captures[0].appendSystemPrompt || '', /Personal agent behavior/, 'nothing is restricted yet');
  assert.equal((await captures[0].callDynamicTool('write_note', { text: 'before' })).content[0].text, 'written');

  policy.value = { notes: 'off', meUse: 'request' };
  var refused = await captures[0].callDynamicTool('write_note', { text: 'after' });
  assert.equal(refused.isError, true, 'the running query still holds the old catalog but the call is refused');
  assert.deepEqual(executed, ['before']);

  await liveQuery.retire(session);
  await bridge.startQuery(session, 'resumed', null, null);
  assert.deepEqual(catalogNames(captures[1]), ['search_user_knowledge']);
  assert.match(captures[1].dynamicTools.find(function (t) { return t.name === 'search_user_knowledge'; }).description, /Me knowledge|Use what Clay knows about me is On request/);
  assert.match(captures[1].appendSystemPrompt, /Off, do not do these: using Sticky Notes/);
  assert.match(captures[1].appendSystemPrompt, /On request, only when the user's message asks for it: searching or reading Me knowledge/);
  await assert.rejects(captures[1].callDynamicTool('write_note', { text: 'removed' }), /not found/);

  policy.value = {};
  await liveQuery.retire(session);
  await bridge.startQuery(session, 'resumed again', null, null);
  assert.deepEqual(catalogNames(captures[2]), ['write_note', 'search_user_knowledge']);
  assert.equal((await captures[2].callDynamicTool('write_note', { text: 'restored' })).content[0].text, 'written');
  await liveQuery.retire(session);
});

test("Issues Off also removes the linked-note rule from the Notes contract", function () {
  var gate = gateFor({ issues: "off", notes: "auto", issueLinkedNotes: true });
  var view = gate.view(SESSION);
  assert.equal(view.issueLinkedNotes, false);
  var notes = notesFor(gate);
  assert.doesNotMatch(notes.getSystemPrompt(SESSION, view), new RegExp(NOTE_MARK));
  assert.doesNotMatch(logsMcp.attentionContract(view), /Issue/);
});

test("Learning records Off also refuses relabelling a comment review as learning", async function () {
  var fixture = logsFixture({ logsLearning: "off" });
  try {
    var review = fixture.attached.getToolDefs(fixture.session).find(function (t) { return t.name === "review_log_comment"; });
    var refused = await review.handler({ ref: "log:none", commentId: "c1", action: "incorporate", kind: "learning" });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /Learning records are turned off/);
  } finally { fixture.cleanup(); }
});

test("Claude queries get a filtered bundled-skill plugin only when skills are excluded", function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-ab-claude-"));
  try {
    var build = require("../lib/yoke/adapters/claude").contractTestKit.buildWorkerQueryOptions;
    var claudeOpts = { originalHome: home };
    function bundled(plugins) {
      return plugins.map(function (p) { return p.path; }).filter(function (p) { return /shared-clay-builtin/.test(p); });
    }
    function skillNames(pluginPath) { return fs.readdirSync(path.join(pluginPath, "skills")).sort(); }
    var plain = bundled(build({ env: {} }, claudeOpts, home).plugins);
    assert.equal(plain.length, 1);
    assert.ok(skillNames(plain[0]).indexOf("clay-sketch") !== -1, "unfiltered bridge keeps every bundled skill");
    var filtered = bundled(build({ env: {}, skillOptions: { excludeSkills: ["clay-sketch", "clay-agent-browser"] } }, claudeOpts, home).plugins);
    assert.equal(filtered.length, 1);
    assert.notEqual(filtered[0], plain[0], "the unfiltered bridge is not reused or mutated");
    assert.deepEqual(skillNames(filtered[0]).filter(function (n) { return /^clay-(sketch|agent-browser)$/.test(n); }), []);
    assert.ok(fs.existsSync(path.join(filtered[0], ".claude-plugin", "plugin.json")));
    assert.ok(skillNames(plain[0]).indexOf("clay-sketch") !== -1, "still present after a filtered query");
    var resumed = bundled(build({ env: {}, skillOptions: { excludeSkills: ["clay-sketch"] } }, claudeOpts, home).plugins);
    assert.deepEqual(skillNames(resumed[0]).indexOf("clay-sketch"), -1);
    assert.ok(skillNames(resumed[0]).indexOf("clay-agent-browser") !== -1, "only the listed skill is removed");
    var back = bundled(build({ env: {}, skillOptions: {} }, claudeOpts, home).plugins);
    assert.equal(back[0], plain[0], "no exclusion returns to the original bridge (Mate and default queries)");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
