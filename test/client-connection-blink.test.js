var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.join(__dirname, "..");
var connection = fs.readFileSync(path.join(root, "lib/public/modules/app-connection.js"), "utf8");
var notes = fs.readFileSync(path.join(root, "lib/public/modules/sticky-notes.js"), "utf8");
var notesCss = fs.readFileSync(path.join(root, "lib/public/css/sticky-notes.css"), "utf8");
var sessions = fs.readFileSync(path.join(root, "lib/public/modules/sidebar-sessions.js"), "utf8");
var globalWs = fs.readFileSync(path.join(root, "lib/server-global-ws.js"), "utf8");

function slice(source, from, to) {
  var start = source.indexOf(from);
  assert.notEqual(start, -1, "anchor not found: " + from);
  var end = to ? source.indexOf(to, start) : source.length;
  assert.notEqual(end, -1, "end anchor not found: " + to);
  return source.slice(start, end);
}

// --- Overlay grace --------------------------------------------------------

test("the startup overlay still appears immediately on the first connection", function () {
  var branch = slice(connection, "if (state.connected !== prev.connected)", "// Processing state changed");
  assert.match(branch, /if \(!hasConnectedOnce\) \{[\s\S]*showOverlayNow\(\);/,
    "before the first successful connection the overlay is revealed without delay");
  // The delayed path is only for reconnects.
  assert.match(branch, /\} else \{\s*\n\s*overlayGraceTimer = setTimeout\(/);
});

test("a brief reconnect never reveals the opaque overlay", function () {
  assert.match(connection, /var OVERLAY_GRACE_MS = (\d+);/);
  var graceMs = Number(/var OVERLAY_GRACE_MS = (\d+);/.exec(connection)[1]);
  assert.ok(graceMs >= 750 && graceMs <= 1000, "grace delay is in the agreed 750-1000ms range, got " + graceMs);

  // The scheduled reveal re-checks live state before showing anything.
  var scheduled = slice(connection, "overlayGraceTimer = setTimeout(", "OVERLAY_GRACE_MS);");
  assert.match(scheduled, /overlayGraceTimer = null;/);
  assert.match(scheduled, /if \(!store\.get\('connected'\)\) showOverlayNow\(\);/,
    "the overlay is shown only if still disconnected when the delay elapses");

  // Reconnecting cancels the pending reveal and hides immediately.
  var connectedBranch = slice(connection, "if (state.connected) {", "} else {");
  assert.match(connectedBranch, /clearOverlayGrace\(\);/);
  assert.match(connectedBranch, /connectOverlay\.classList\.add\("hidden"\)/);
  assert.ok(connectedBranch.indexOf("clearOverlayGrace()") < connectedBranch.indexOf('classList.add("hidden")'),
    "the pending reveal is cancelled before hiding");

  // The disconnect path clears any earlier timer so timers cannot stack.
  var disconnectedBranch = slice(connection, "if (sendBtn) sendBtn.disabled = true;", "// Processing state changed");
  assert.match(disconnectedBranch, /clearOverlayGrace\(\);/);

  assert.match(connection, /function clearOverlayGrace\(\) \{[\s\S]*clearTimeout\(overlayGraceTimer\);[\s\S]*overlayGraceTimer = null;/);
});

test("the status dot still reports the state during the grace period", function () {
  // The dot branch is keyed on connected/processing and is untouched by the
  // grace delay, so a reconnect is always visible without covering the screen.
  var dotBranch = slice(connection, "// Status dot (depends on both connected and processing)", "// Connected state changed");
  assert.match(dotBranch, /state\.connected !== prev\.connected \|\| state\.processing !== prev\.processing/);
  assert.equal(dotBranch.indexOf("overlayGraceTimer"), -1, "the dot is not gated behind the overlay delay");

  // The composer stays disabled: there is no outbound queue, so enabling it
  // during a reconnect would silently drop the message.
  var disconnectedBranch = slice(connection, "if (sendBtn) sendBtn.disabled = true;", "clearOverlayGrace();");
  assert.match(disconnectedBranch, /sendBtn\.disabled = true/);
});

// --- Heartbeat ------------------------------------------------------------

test("exactly one heartbeat timer exists per live socket", function () {
  assert.match(connection, /var HEARTBEAT_MS = (\d+);/);
  var beat = Number(/var HEARTBEAT_MS = (\d+);/.exec(connection)[1]);
  assert.ok(beat > 0 && beat < 60000, "heartbeat is shorter than a typical 60s proxy idle timeout, got " + beat);

  // Starting always clears first, so a restart cannot leave two timers.
  var start = slice(connection, "export function startHeartbeat(socket, attemptEpoch)", "export function initConnection");
  assert.ok(start.indexOf("stopHeartbeat();") < start.indexOf("heartbeatTimer = setInterval("),
    "startHeartbeat clears any existing timer before creating one");
  assert.match(start, /if \(!socket\) return;/);

  // The timer is bound to the socket it was started for and stops itself if
  // that socket is no longer the live one.
  assert.match(start, /if \(!socket \|\| socket\.readyState !== 1 \|\| getWs\(\) !== socket \|\| !lifecycle\.current\(attemptEpoch\)\) \{\s*\n\s*stopHeartbeat\(\);\s*\n\s*return;/);
  assert.match(start, /socket\.send\(JSON\.stringify\(\{ type: "ping" \}\)\)/);

  // A half-open socket must be replaced when the server does not acknowledge
  // the heartbeat. Browser OPEN state alone does not prove delivery.
  assert.match(start, /heartbeatDeadlineTimer = setTimeout\([\s\S]*getWs\(\) === socket[\s\S]*forceReplaceSocket\("heartbeat_timeout"/,
    "a missed pong directly replaces the stale socket through the bounded retry path");
  assert.match(connection, /if \(msg\.type === "pong" && heartbeatDeadlineTimer && heartbeatAwaitingSocket === newWs\) \{[\s\S]*clearTimeout\(heartbeatDeadlineTimer\)/,
    "a pong cancels the reconnect deadline");
});

test("the heartbeat is cleared on close and before a new socket is created", function () {
  var onclose = slice(connection, "newWs.onclose = function (e)", "newWs.onerror");
  assert.match(onclose, /stopHeartbeat\(\);/);

  // connect() tears the previous timer down before replacing the socket.
  var connectFn = slice(connection, "export function connect()", "newWs.onopen");
  assert.ok(connectFn.indexOf("stopHeartbeat();") < connectFn.indexOf("new WebSocket("),
    "the old heartbeat stops before a new socket is opened");

  var onopen = slice(connection, "newWs.onopen = function ()", "newWs.onclose");
  assert.match(onopen, /startHeartbeat\(newWs, attemptEpoch\);/);

  assert.match(connection, /function stopHeartbeat\(\) \{[\s\S]*clearInterval\(heartbeatTimer\);[\s\S]*heartbeatTimer = null;/);
});

test("connection callbacks are epoch-bound and resume replaces stale health deadlines", function () {
  var onmessage = slice(connection, "newWs.onmessage = function (event)", "\n}");
  assert.match(onmessage, /if \(getWs\(\) !== newWs \|\| !lifecycle\.current\(attemptEpoch\)\) return;/);
  assert.match(connection, /lifecycle\.setOffline\(true\);\s*\n\s*suspendSocketForOffline\(\);/);
  assert.match(connection, /function suspendSocketForOffline\(\) \{[\s\S]*socket\.onmessage = null;[\s\S]*setWs\(null\);/);
  assert.match(connection, /if \(socket && socket\.readyState === 1\) startHeartbeat\(socket, lifecycle\.getEpoch\(\)\);\s*\n\s*probeReconnect\("online"\)/);
  assert.match(connection, /if \(socket && socket\.readyState === 1\) startHeartbeat\(socket, lifecycle\.getEpoch\(\)\);\s*\n\s*probeReconnect\("visible"\)/);
  assert.match(connection, /if \(lifecycle\.isOffline\(\) \|\| !lifecycle\.current\(lifecycle\.getEpoch\(\)\)\) return;/);
  assert.match(connection, /var socket = getWs\(\);\s*\n\s*if \(socket && socket\.readyState === 0\) return;/);
  assert.match(connection, /recordConnectionDiagnostic\("error", 0, null\);\s*\n\s*forceReplaceSocket\("error", 0, attemptEpoch\);/);
  assert.match(connection, /var authFinished = lifecycle\.finishAuth\(authEpoch, authToken\);\s*\n\s*if \(authFinished && lifecycle\.canProceed\(authEpoch\)\) connect\(\);/);
});

test("the heartbeat uses the protocol the server already speaks", function () {
  // The global socket answers ping with pong; the client must not invent a
  // new message type.
  assert.match(globalWs, /if \(msg\.type === "ping"\) \{\s*\n\s*sendTo\(ws, \{ type: "pong" \}\);/);
});

// --- Diagnostics ----------------------------------------------------------

test("diagnostics are bounded structured records without close payloads", function () {
  var onclose = slice(connection, "newWs.onclose = function (e)", "newWs.onerror");
  assert.match(onclose, /recordConnectionDiagnostic\("close", e && e\.code/);
  assert.doesNotMatch(onclose, /e\.reason/);
  assert.match(connection, /latencyMs: typeof latency === "number" \? Math\.max\(0, Math\.min\(latency, 600000\)\) : null/);

  var onopen = slice(connection, "newWs.onopen = function ()", "newWs.onclose");
  assert.match(onopen, /reconnected after " \+ \(Date\.now\(\) - disconnectedAt\) \+ "ms"/);
  assert.match(onopen, /if \(hasConnectedOnce && disconnectedAt\)/, "the first connection is not logged as a reconnect");

  // No per-message logging.
  var onmessage = slice(connection, "newWs.onmessage = function (event)", "\n}");
  assert.equal(/console\.(log|warn|info)/.test(onmessage), false, "the message path stays silent");
});

// --- Sticky notes reconciliation -----------------------------------------

test("handleNotesList reconciles by id instead of clearing the container", function () {
  var handler = slice(notes, "export function handleNotesList(msg)", "export function handleNoteCreated");
  assert.equal(handler.indexOf('container.innerHTML = ""'), -1, "the container is never wiped");
  assert.equal(handler.indexOf("notes.clear()"), -1, "the keyed map is never dropped wholesale");

  // Existing nodes are patched in place; only missing ones are built.
  assert.match(handler, /var entry = notes\.get\(data\.id\);/);
  assert.match(handler, /if \(entry && entry\.el && entry\.el\.parentNode === container\) \{\s*\n\s*patchNote\(entry, data\);\s*\n\s*continue;/);
  assert.match(handler, /var el = renderNote\(data\);[\s\S]*container\.appendChild\(el\);[\s\S]*created = true;/);

  // Stale nodes are removed rather than left behind.
  assert.match(handler, /if \(!seen\[id\]\) staleIds\.push\(id\);/);
  assert.match(handler, /stale\.el\.parentNode\.removeChild\(stale\.el\);/);
  assert.match(handler, /notes\.delete\(staleIds\[i\]\);/);

  // A pure patch pass must not trigger a document-wide Lucide scan.
  assert.match(handler, /if \(created\) refreshIcons\(\);/);
});

test("an unchanged note keeps its rendered markdown, focus, and draft", function () {
  var patch = slice(notes, "function patchNote(entry, next)", "export function handleNoteUpdated");

  // Markdown is replaced only when the text actually changed.
  assert.match(patch, /var textChanged = nextText !== \(previous\.text \|\| ""\);/);
  assert.match(patch, /if \(rendered && !editing && !hasDraft && textChanged\)/);

  // Focus and uncommitted drafts both block the rewrite.
  assert.match(patch, /var editing = rendered === document\.activeElement \|\| textarea === document\.activeElement;/);
  assert.match(patch, /var hasDraft = !!\(textarea && textarea\.value !== \(previous\.text \|\| ""\)\);/);

  // Geometry, z-order, colour, and opacity still apply unconditionally.
  assert.match(patch, /el\.style\.zIndex = 100 \+ \(next\.zIndex \|\| 0\);/);
  assert.match(patch, /el\.style\.left = next\.x \+ "px";/);
  assert.match(patch, /el\.dataset\.color = next\.color \|\| "purple";/);
  assert.match(patch, /el\.style\.setProperty\("--note-opacity", next\.opacity\);/);

  // Icons are only re-scanned when the minimize button icon actually swapped.
  assert.match(patch, /var iconsReplaced = false;/);
  assert.match(patch, /if \(minBtn && !wasMinimized\)/);
  assert.match(patch, /if \(minBtn && wasMinimized\)/);
  assert.match(patch, /return iconsReplaced;/);

  var updated = slice(notes, "export function handleNoteUpdated(msg)", "export function handleNoteWritten");
  assert.match(updated, /if \(patchNote\(entry, msg\.note\)\) refreshIcons\(\);/,
    "a geometry-only update does not refresh icons");
  assert.equal(/rendered\.innerHTML = renderMiniMarkdown/.test(updated), false,
    "handleNoteUpdated no longer rewrites markdown directly");
});

test("floating notes isolate live blur and never blink repeatedly", function () {
  var noteRule = slice(notesCss, ".sticky-note {", ".sticky-note:hover");
  assert.match(noteRule, /backdrop-filter: blur\(7px\)/,
    "translucent notes retain the depth cue from their live backdrop");
  assert.match(noteRule, /contain: layout style;/,
    "note layout changes stay inside the floating surface without clipping its shadow");
  assert.match(noteRule, /will-change: transform, backdrop-filter;/,
    "the browser can keep each moving blur on a stable compositor layer");
  assert.match(notesCss, /\.sticky-note\.sticky-note-attention \{\s*animation: sticky-note-attention-pulse 1\.1s ease-out 1;/,
    "a real note update gets one gentle cue rather than three flashes");
  var pulse = slice(notesCss, "@keyframes sticky-note-attention-pulse", ".sticky-note.dragging");
  assert.match(pulse, /0% \{[\s\S]*100% \{/);
  assert.equal(/50%/.test(pulse), false, "the cue only fades out and never oscillates");
});

// --- Session list dirty guard --------------------------------------------

test("an identical session_list frame does not tear down the sidebar", function () {
  assert.match(sessions, /function sessionRenderFingerprint\(sessions\)/);

  // The fingerprint covers the whole payload plus every other store value the
  // render reads, so nothing semantic can be missed by cherry-picking fields.
  var fingerprint = slice(sessions, "function sessionRenderFingerprint(sessions)", "export function renderSessionList");
  assert.match(fingerprint, /JSON\.stringify\(\[sessions, store\.get\('splitGroups'\) \|\| \[\], store\.get\('splitPanes'\) \|\| null\]\)/);
  assert.match(fingerprint, /catch \(e\) \{\s*\n\s*return null;/, "a non-serializable payload falls back to rendering");

  // Only an argument-carrying call can be skipped; a null re-render is driven
  // by other state and must always run.
  var guard = slice(sessions, "export function renderSessionList(sessions)", "// If mobile chat sheet is open");
  assert.match(guard, /if \(sessions\) \{/);
  assert.match(guard, /if \(incoming !== null && incoming === lastRenderFingerprint\) return;/);
  assert.match(guard, /cachedSessions = sessions;/);
  assert.ok(guard.indexOf("if (incoming !== null") < guard.indexOf("cachedSessions = sessions;"),
    "the guard runs before the cache is replaced");

  // The fingerprint is recorded from what was actually rendered.
  assert.match(sessions, /lastRenderFingerprint = sessionRenderFingerprint\(cachedSessions\);/);
  var tail = slice(sessions, "  if (updatePageTitle) updatePageTitle();\n  syncHeaderSearchUi();", "// --- Search results ---");
  assert.match(tail, /lastRenderFingerprint = sessionRenderFingerprint\(cachedSessions\);/,
    "every completed render refreshes the fingerprint, including null-argument renders");
});

// --- Project rules --------------------------------------------------------

test("the edited client modules follow the project style rules", function () {
  [["app-connection.js", connection], ["sticky-notes.js", notes], ["sidebar-sessions.js", sessions]].forEach(function (pair) {
    assert.equal(/=>/.test(pair[1]), false, "no arrow functions in " + pair[0]);
    assert.equal(/^\s*(const|let)\s/m.test(pair[1]), false, "var only in " + pair[0]);
  });
  assert.equal(/localStorage/.test(notes), false, "sticky notes store no settings client-side");
});
