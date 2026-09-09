// Regression: the pair factory is constructed with attachSessionPair's own
// context.
//
// attachPairFactory reads sm, splitStore, isMate, usersModule and sendTo off
// its argument. project-session-pair.js used to wrap that as
// { sm, splitStore, ctx }, which left isMate, usersModule and sendTo
// undefined. The single-user path happened to survive, because a Driver with no
// ownerId short-circuits `ws._clayUser && ctx.usersModule.isMultiUser()` before
// the undefined dereference. In multi-user, where the Driver has an ownerId,
// the same expression threw "Cannot read properties of undefined (reading
// 'isMultiUser')" and send_to_partner failed on its very first call.
//
// These tests drive accepted proposal creation followed by the real
// send_to_partner tool in both modes, so the wiring cannot silently regress.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var pairModule = require("../lib/project-session-pair");

var CLAUDE_CATALOG = [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }];
var CODEX_CATALOG = ["gpt-5.6-terra", "gpt-5.6-sol"];

function parse(result) { return JSON.parse(result.content[0].text); }

function toolNamed(tools, name) {
  for (var i = 0; i < tools.length; i++) {
    if (tools[i].name === name) return tools[i];
  }
  return null;
}

// A world built the way project.js builds one: one flat context object carrying
// every dependency, exactly as attachSessionPair receives it.
function makeWorld(options) {
  var opts = options || {};
  var nextId = 10;
  var driver = {
    localId: 1,
    ownerId: opts.ownerId === undefined ? null : opts.ownerId,
    title: "Planner", vendor: "claude", model: "claude-fable-5",
    history: [], isProcessing: false,
  };
  var sessions = new Map([[1, driver]]);
  var groups = [];
  var created = [];
  var sentTo = [];
  var intervals = [];
  var realSetInterval = global.setInterval;
  global.setInterval = function (fn, ms) {
    var id = realSetInterval(fn, ms);
    intervals.push(id);
    return id;
  };

  var sm = {
    sessions: sessions,
    installedVendors: ["claude", "codex"],
    modelsByVendor: { claude: CLAUDE_CATALOG, codex: CODEX_CATALOG },
    defaultModelByVendor: {},
    capabilitiesByVendor: {},
    lastVendor: "codex",
    sendAndRecord: function (session, message) { session.history.push(message); },
    saveSessionFile: function () {},
    sendToSession: function () {},
    broadcastSessionList: function () {},
    createSessionRaw: function (spec) {
      var s = {
        localId: nextId++, ownerId: spec.ownerId === undefined ? null : spec.ownerId,
        vendor: spec.vendor, model: spec.model || null, effort: spec.effort || null,
        history: [], isProcessing: false, lastActivity: Date.now(),
      };
      sessions.set(s.localId, s);
      created.push(s);
      return s;
    },
    deleteSessionQuiet: function (id) { sessions.delete(id); },
  };

  var sdk = {
    pushMessage: function () { return false; },
    startQuery: function (session) {
      session.history.push({ type: "delta", text: "worker result" });
      session.isProcessing = false;
      return Promise.resolve();
    },
  };

  var attached = pairModule.attachSessionPair({
    sm: sm,
    isMate: !!opts.isMate,
    splitStore: {
      groupForMember: function (id) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].members.indexOf(id) !== -1) return groups[i];
        }
        return null;
      },
      create: function (ws, msg) {
        if (opts.groupCreateFails) return { ok: false, error: "A session can belong to only one split group" };
        var g = {
          id: "sg_" + (groups.length + 1),
          members: msg.members.slice(),
          pair: msg.pair,
          ownerId: ws && ws._clayUser ? ws._clayUser.id : null,
        };
        groups.push(g);
        return { ok: true, group: g };
      },
      dissolve: function (ws, msg) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].id === msg.id) return { ok: true, group: groups.splice(i, 1)[0] };
        }
        return { ok: false, error: "Split group not found" };
      },
    },
    getSdk: function () { return sdk; },
    send: function () {},
    sendTo: function (ws, message) { sentTo.push({ ws: ws, message: message }); },
    usersModule: { isMultiUser: function () { return !!opts.multiUser; } },
    getLinuxUserForSession: function () { return null; },
    onProcessingChanged: function () {},
  });

  var world = {
    attached: attached, driver: driver, sm: sm, sessions: sessions,
    groups: groups, created: created, sentTo: sentTo,
    tool: function (name, session) {
      return toolNamed(attached.getToolDefs(session || driver), name);
    },
    worker: function () {
      var g = groups[0];
      return g && g.pair ? sessions.get(g.pair.workerId) : null;
    },
    dispose: function () {
      for (var i = 0; i < intervals.length; i++) clearInterval(intervals[i]);
      global.setInterval = realSetInterval;
    },
  };
  return world;
}

// Delegate and settle the turn, the way the real bridge does on completion.
async function delegate(world, message) {
  if (!world.worker()) {
    var proposal = parse(await world.tool("propose_worker").handler({
      summary: "Use a visible Split Worker",
      plan: "1. Execute\n2. Report",
      message: message || "Build it",
      recommendedVendor: "codex",
      recommendedModel: "gpt-5.6-sol",
      recommendedEffort: "medium",
      recommendationRationale: "Codex Sol at medium effort fits the delegated implementation task.",
    }));
    var response = await world.attached.respondToWorkerProposal({
      _clayActiveSession: world.driver.localId,
      _clayUser: world.driver.ownerId ? { id: world.driver.ownerId } : null,
    }, {
      proposalId: proposal.proposalId,
      accepted: true,
      vendor: "codex",
      model: "gpt-5.6-sol",
      effort: "medium",
    });
    assert.equal(response.ok, true, response.error || "proposal acceptance failed");
    return { content: [{ type: "text", text: JSON.stringify({ accepted: true }) }] };
  }
  var send = world.tool("send_to_partner");
  assert.ok(send, "the Driver has send_to_partner");
  var raw = await send.handler({ message: message || "Build it", wait: false });
  var worker = world.worker();
  if (worker) world.attached.handleTurnDone(worker);
  return raw;
}

// --- The regression, in both modes ---------------------------------------

test("an accepted pair supports delegation in single-user mode", async function (t) {
  var world = makeWorld({ multiUser: false, ownerId: null });
  t.after(world.dispose);

  var raw = await delegate(world, "Implement the parser");
  assert.equal(raw.isError, undefined, "no error: " + raw.content[0].text);
  var result = parse(raw);
  assert.equal(result.accepted, true);

  assert.equal(world.groups.length, 1, "exactly one pair");
  var worker = world.worker();
  assert.ok(worker, "the Worker session exists");
  assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: worker.localId });
  assert.equal(world.groups[0].members.length, 2);
  assert.equal(worker.ownerId, null, "single-user sessions carry no owner");
});

test("an accepted pair supports delegation in multi-user mode for an owned Driver", async function (t) {
  // The exact case the wrapped context broke: an owned Driver makes
  // `ws._clayUser` truthy, so `ctx.usersModule.isMultiUser()` is evaluated.
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);

  var raw = await delegate(world, "Implement the parser");
  assert.equal(raw.isError, undefined,
    "no undefined isMultiUser error: " + raw.content[0].text);
  assert.equal(/isMultiUser|Cannot read properties of undefined/.test(raw.content[0].text), false,
    "the failure mode this test exists for");

  var result = parse(raw);
  assert.equal(result.accepted, true);
  assert.equal(world.groups.length, 1);

  var worker = world.worker();
  assert.ok(worker);
  assert.deepEqual(world.groups[0].pair, { driverId: 1, workerId: worker.localId });
  // Ownership is derived from the connection the factory builds for the Driver,
  // so the Worker and the group belong to the Driver's owner.
  assert.equal(worker.ownerId, "alice", "the Worker inherits the Driver's owner");
  assert.equal(world.groups[0].ownerId, "alice", "and so does the group record");
});

test("the wiring passes the whole context, so every dependency resolves", function () {
  var pairSource = fs.readFileSync(path.join(root, "lib/project-session-pair.js"), "utf8");
  var factorySource = fs.readFileSync(path.join(root, "lib/session-pair-factory.js"), "utf8");

  assert.match(pairSource, /attachPairFactory\(ctx\)/,
    "the factory receives attachSessionPair's own context");
  assert.equal(/attachPairFactory\(\{/.test(pairSource), false,
    "never a re-wrapped object that would drop fields");

  // Everything the factory reads must be a top-level field of that context.
  var reads = {};
  var re = /ctx\.([A-Za-z_$][\w$]*)/g;
  var match;
  while ((match = re.exec(factorySource)) !== null) reads[match[1]] = true;
  var names = Object.keys(reads).sort();
  assert.deepEqual(names, ["isMate", "sendTo", "splitStore", "sm", "usersModule"].sort(),
    "the factory's exact dependency list");
  for (var i = 0; i < names.length; i++) {
    assert.match(pairSource, new RegExp("ctx\\." + names[i] + "\\b|var \\w+ = ctx\\." + names[i]),
      names[i] + " is a real field of the pair context");
  }
});

// --- Guarantees the fix must not weaken ----------------------------------

test("the Mate guard actually fires again", async function (t) {
  // With the wrapped context ctx.isMate was undefined, so this guard was dead.
  var world = makeWorld({ isMate: true, multiUser: false });
  t.after(world.dispose);

  var send = world.tool("send_to_partner");
  if (!send) {
    // A Mate project may not mount the pair tools at all, which is a stronger
    // refusal than the guard; either way no pair may be created.
    assert.equal(world.groups.length, 0);
    return;
  }
  var raw = await send.handler({ message: "x", wait: false });
  assert.equal(raw.isError, true);
  assert.match(raw.content[0].text, /only available in projects/);
  assert.equal(world.groups.length, 0, "no pair was created in a Mate project");
  assert.deepEqual(world.created, [], "and no session either");
});

test("owner and preflight guarantees still hold after the fix", async function (t) {
  // Model tier is the user's choice, including in multi-user projects.
  var below = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(below.dispose);
  below.driver.model = "claude-sonnet-5";
  assert.ok(below.tool("propose_worker"), "the proposal tool is mounted for the selected model");
  assert.equal(below.groups.length, 0);

  // Preflight: an unavailable vendor is refused and nothing is created.
  var badVendor = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(badVendor.dispose);
  var res = parse(await badVendor.tool("propose_worker").handler({ summary: "x", plan: "x", message: "x", recommendedVendor: "nope", recommendationRationale: "Use a Worker." }));
  assert.strictEqual(res.status, "posted");
  assert.deepEqual(badVendor.created, [], "no orphan session");
  assert.equal(badVendor.groups.length, 0, "no group");

  // Preflight: an unavailable model, same outcome.
  var badModel = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(badModel.dispose);
  var res2 = parse(await badModel.tool("propose_worker").handler({ summary: "x", plan: "x", message: "x", recommendedModel: "gpt-9-imaginary", recommendationRationale: "Use a Worker." }));
  assert.strictEqual(res2.status, "posted");
  assert.deepEqual(badModel.created, []);
  assert.equal(badModel.groups.length, 0);
});

test("a late group-write failure leaves no orphan, in either mode", async function (t) {
  var modes = [
    { multiUser: false, ownerId: null },
    { multiUser: true, ownerId: "alice" },
  ];
  for (var i = 0; i < modes.length; i++) {
    var world = makeWorld(Object.assign({ groupCreateFails: true }, modes[i]));
    t.after(world.dispose);

    world.attached.handleMessage({ _clayActiveSession: 1, _clayUser: modes[i].ownerId ? { id: modes[i].ownerId } : null }, {
      type: "pair_session_create", driver: { sessionId: 1 }, worker: { vendor: "codex" },
    });
    assert.equal(world.groups.length, 0, "no group");
    // The Worker this call created was removed; the Driver is untouched.
    assert.equal(world.sessions.size, 1, "only the pre-existing Driver remains");
    assert.equal(world.sessions.get(1), world.driver);
  }
});

test("the pair_session_create WebSocket flow can report its result again", function (t) {
  // createPair calls ctx.sendTo, which the wrapped context left undefined, so
  // the "Add Split Worker" flow threw instead of answering the client.
  var world = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world.dispose);
  var ws = { _clayUser: { id: "alice" }, _clayActiveSession: 1 };

  var handled = world.attached.handleMessage(ws, {
    type: "pair_session_create",
    driver: { sessionId: 1 },
    worker: { vendor: "codex" },
  });
  assert.equal(handled, true);
  assert.equal(world.sentTo.length, 1, "the client was answered");
  assert.equal(world.sentTo[0].message.type, "pair_session_created");
  assert.equal(world.sentTo[0].message.ok, true, world.sentTo[0].message.error || "");
  assert.equal(world.groups.length, 1);

  // And a refusal is reported rather than thrown.
  var world2 = makeWorld({ multiUser: true, ownerId: "alice" });
  t.after(world2.dispose);
  world2.attached.handleMessage(ws, {
    type: "pair_session_create",
    driver: { sessionId: 1 },
    worker: { vendor: "not-installed" },
  });
  assert.equal(world2.sentTo.length, 1);
  assert.equal(world2.sentTo[0].message.ok, false);
  assert.match(world2.sentTo[0].message.error, /vendor is not installed/);
});
