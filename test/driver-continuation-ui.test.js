var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

var root = path.join(__dirname, "..");

test("production continuation card requires one explicit native-button decision", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/driver-continuation.js"), "utf8");
  var stateSource = fs.readFileSync(path.join(root, "lib/public/modules/driver-continuation-state.js"), "utf8");
  assert.match(source, /type: "driver_continuation_response"/);
  assert.match(source, /beginRequest/);
  assert.match(source, /stay\.type = "button"/);
  assert.match(source, /proceed\.type = "button"/);
  assert.match(source, /Stay here/);
  assert.match(source, /Continue in new session/);
  assert.doesNotMatch(source + stateSource, /autoaccept|autoAccept|localStorage|confirm\(|alert\(|prompt\(/);
  assert.doesNotMatch(source, /\._continuationState/);
  assert.match(source, /store\.get\("driverContinuations"\)/);
  assert.match(source, /state\.driverContinuations === previous\.driverContinuations\) return/);
  assert.match(source, /requestId/);
  assert.match(source, /setTimeout\(function \(\)/);
  assert.match(source, /Connection lost before Clay confirmed/);
  assert.match(source, /driver-continuation-source/);
  assert.match(source, /Observed evidence/);
  assert.match(source, /Completed milestone/);
  assert.match(source, /Why a fresh session helps/);
  assert.match(source, /current_context_pressure/);
  assert.match(source, /recorded_compaction/);
});

test("production transcript router restores proposal, updates, and successor context", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/app-messages.js"), "utf8");
  assert.match(source, /case "driver_continuation_proposal":\s*renderDriverContinuation\(msg\)/);
  assert.match(source, /case "driver_continuation_update":\s*case "driver_continuation_result":\s*updateDriverContinuation\(msg\)/);
  assert.match(source, /case "driver_continuation_context":\s*renderDriverContinuationContext\(msg\)/);
});

test("browser fixture renders the production card and mock transport rather than lifecycle JSON", function () {
  var source = fs.readFileSync(path.join(root, "test/fixtures/driver-continuation-browser.html"), "utf8");
  assert.match(source, /from "\.\.\/\.\.\/lib\/public\/modules\/driver-continuation\.js"/);
  assert.match(source, /renderDriverContinuation\(proposal\)/);
  assert.match(source, /setWs\(socket\)/);
  assert.match(source, /document\.querySelectorAll\("\.driver-continuation-card"\)\.length/);
  assert.match(source, /renderDriverContinuationContext/);
  assert.match(source, /triggerEvidence: \{ kind: "current_context_pressure"/);
  assert.match(source, /milestone:/);
  assert.match(source, /benefit:/);
  assert.doesNotMatch(source, /from "\.\.\/\.\.\/lib\/public\/modules\/driver-continuation-state\.js"/);
});

test("production client lifecycle blocks double clicks, stale responses, and offline actions", async function () {
  var module = await import(pathToFileURL(path.join(root, "lib/public/modules/driver-continuation-state.js")).href);
  var identity = { projectSlug: "clay", sourceOriginId: "origin", proposalId: "proposal", sourceSessionId: 7, status: "pending" };
  var state = module.authoritativeState(identity);
  var inflight = module.beginRequest(state, "decision", "request-1", true);
  assert.strictEqual(inflight.requestId, "request-1");
  assert.strictEqual(module.beginRequest(inflight, "decision", "request-2", true), null);
  assert.strictEqual(module.applyResponse(inflight, Object.assign({}, identity, { requestId: "stale", status: "declined" })), null);
  var retry = module.applyResponse(inflight, Object.assign({}, identity, { requestId: "request-1", sourceSessionId: null, error: "Retry" }));
  assert.strictEqual(retry.status, "pending");
  assert.strictEqual(retry.sourceSessionId, 7, "an error without a current server ID must not erase the replayed source identity");
  var normalized = module.applyResponse(module.beginRequest(retry, "decision", "request-normalize", true),
    Object.assign({}, identity, { requestId: "request-normalize", sourceSessionId: 19, status: "declined" }));
  assert.strictEqual(normalized.sourceSessionId, 19, "a successful response normalizes the daemon-local replay ID");
  assert.strictEqual(module.beginRequest(retry, "decision", "request-2", false), null);
  var failed = module.failRequest(module.beginRequest(retry, "decision", "request-3", true), "request-3", "Disconnected");
  assert.strictEqual(failed.inflight, false);
  assert.strictEqual(failed.error, "Disconnected");
  var replayed = module.authoritativeState(identity);
  assert.strictEqual(replayed.inflight, false, "history replay restores server authority rather than stale DOM state");
  assert.match(module.sendContinuationPayload({ readyState: 1, send: function () { return false; } }, {}).error, /not accepted/);
  assert.match(module.sendContinuationPayload({ readyState: 1, send: function () { throw new Error("closed"); } }, {}).error, /could not be sent/);
});

test("card is compact, mobile responsive, and keyboard focused", function () {
  var source = fs.readFileSync(path.join(root, "lib/public/css/driver-continuation.css"), "utf8");
  assert.match(source, /width: min\(680px, calc\(100% - 24px\)\)/);
  assert.match(source, /@media \(max-width: 600px\)/);
  assert.match(source, /:focus-visible/);
});

test("provider permission covers proposing only; acceptance remains a server card response", function () {
  var bridge = fs.readFileSync(path.join(root, "lib/sdk-bridge.js"), "utf8");
  var server = fs.readFileSync(path.join(root, "lib/project-driver-continuation.js"), "utf8");
  assert.match(bridge, /mcp__clay-continuation__propose_driver_continuation/);
  assert.match(server, /msg\.type !== "driver_continuation_response"/);
  assert.match(server, /msg\.accepted !== true/);
  assert.doesNotMatch(server, /autoAccepted|autoApproved/);
});
