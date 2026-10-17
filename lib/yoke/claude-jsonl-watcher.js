// claude-jsonl-watcher.js
//
// Tails the per-session jsonl that Claude Code writes to
// ~/.claude/projects/<encoded-cwd>/<cliSessionId>.jsonl, parsing new lines
// for title events:
//
//   {"type":"ai-title","aiTitle":"..."}          - auto-generated after the
//                                                  first exchange
//   {"type":"custom-title","customTitle":"..."}  - explicit /title or
//                                                  similar override
//
// Used by Clay TUI sessions to mirror claude's session naming into the
// sidebar so they don't sit as "New Session" forever.
//
// Public API:
//   start(jsonlPath, onTitle) -> stop()
//     onTitle(title, source) where source is "ai-title" or "custom-title".
//     stop() detaches the watcher and clears any timer.

var fs = require("fs");
var path = require("path");

function pickLatestTitle(lines, current) {
  // Walk lines in order; the final ai-title and custom-title win. Custom
  // beats ai because users explicitly chose it.
  var ai = current.aiTitle || null;
  var custom = current.customTitle || null;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i].trim();
    if (!raw || raw[0] !== "{") continue;
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) { continue; }
    if (!obj || !obj.type) continue;
    if (obj.type === "ai-title" && typeof obj.aiTitle === "string") {
      ai = obj.aiTitle;
    } else if (obj.type === "custom-title" && typeof obj.customTitle === "string") {
      custom = obj.customTitle;
    }
  }
  current.aiTitle = ai;
  current.customTitle = custom;
  return custom || ai;
}

// Pull the latest visible "text" block from any new assistant entries.
// Thinking and tool_use blocks are skipped - they're internals, not the
// response surface. Returns the most recent text seen, or null.
function extractLatestAssistantText(lines, seenUuids) {
  var latest = null;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i].trim();
    if (!raw || raw[0] !== "{") continue;
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) { continue; }
    if (!obj || obj.type !== "assistant" || !obj.message) continue;
    if (obj.uuid && seenUuids[obj.uuid]) continue;
    if (obj.uuid) seenUuids[obj.uuid] = true;
    var blocks = obj.message.content || [];
    if (!Array.isArray(blocks)) continue;
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      if (b && b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        latest = b.text;
      }
    }
  }
  return latest;
}

/**
 * Watch a Claude Code session jsonl for title and response updates.
 *
 *   start(jsonlPath, { onTitle, onResponse }) -> stop()
 *
 * onTitle(text, source)   fires on ai-title / custom-title updates.
 * onResponse(text)        fires on new assistant text blocks (debounced so
 *                         a multi-block turn coalesces to one callback,
 *                         using only the *final* visible text). Pre-existing
 *                         entries from before start() are ignored - the
 *                         initial scan seeds the "seen" set so we don't
 *                         spam notifications when the watcher boots up.
 */
function start(jsonlPath, opts) {
  if (!jsonlPath) return function () {};
  var onTitle = (opts && typeof opts.onTitle === "function") ? opts.onTitle : null;
  var onResponse = (opts && typeof opts.onResponse === "function") ? opts.onResponse : null;
  if (!onTitle && !onResponse) return function () {};

  var pos = 0;
  var leftover = "";
  var current = { aiTitle: null, customTitle: null };
  var lastTitleEmitted = null;
  var seenAssistantUuids = {};
  var didInitialScan = false;
  var responseDebounceTimer = null;
  var pendingResponseText = null;
  var lastResponseEmitted = null;
  var watcher = null;
  var pollTimer = null;
  var stopped = false;

  var RESPONSE_DEBOUNCE_MS = 1500;
  function maybeFireResponse() {
    if (responseDebounceTimer) clearTimeout(responseDebounceTimer);
    responseDebounceTimer = setTimeout(function () {
      responseDebounceTimer = null;
      if (!pendingResponseText) return;
      if (pendingResponseText === lastResponseEmitted) return;
      var t = pendingResponseText;
      pendingResponseText = null;
      lastResponseEmitted = t;
      try { if (onResponse) onResponse(t); } catch (e) {}
    }, RESPONSE_DEBOUNCE_MS);
  }

  function readNew() {
    if (stopped) return;
    try {
      var stat = fs.statSync(jsonlPath);
      if (stat.size <= pos) return;
      var fd = fs.openSync(jsonlPath, "r");
      var len = stat.size - pos;
      var buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      fs.closeSync(fd);
      pos = stat.size;
      var chunk = leftover + buf.toString("utf8");
      var parts = chunk.split("\n");
      // Last fragment may be a partial line; hold it for next read.
      leftover = parts.pop();

      // Title side: fire whenever we see a new value.
      if (onTitle) {
        var resolved = pickLatestTitle(parts, current);
        if (resolved && resolved !== lastTitleEmitted) {
          lastTitleEmitted = resolved;
          try { onTitle(resolved, current.customTitle === resolved ? "custom-title" : "ai-title"); } catch (e) {}
        }
      }

      // Response side: collect new assistant text blocks. Initial scan
      // seeds the "seen" set silently so old history doesn't fire.
      var latest = extractLatestAssistantText(parts, seenAssistantUuids);
      if (onResponse && didInitialScan && latest) {
        pendingResponseText = latest;
        maybeFireResponse();
      }
    } catch (e) {
      // File may not exist yet; readNew is called again on the next event.
    }
  }

  function arm() {
    if (stopped) return;
    if (watcher) return;
    try {
      watcher = fs.watch(jsonlPath, { persistent: false }, function () {
        readNew();
      });
      watcher.on("error", function () {
        try { watcher.close(); } catch (e) {}
        watcher = null;
        // Fall back to polling; some filesystems (network mounts) don't
        // deliver fs.watch events reliably.
      });
    } catch (e) {
      // Path doesn't exist yet; rely on the poll loop to retry once it appears.
    }
  }

  // Initial pass to capture anything already written before we attached.
  // didInitialScan stays false during this pass so onResponse doesn't fire
  // for old history; subsequent reads (live updates) will emit.
  readNew();
  didInitialScan = true;
  arm();

  // Poll every 2s as a safety net for fs.watch misses and for the
  // "file doesn't exist yet" boot case.
  pollTimer = setInterval(function () {
    if (!watcher) arm();
    readNew();
  }, 2000);

  return function stop() {
    stopped = true;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (responseDebounceTimer) { clearTimeout(responseDebounceTimer); responseDebounceTimer = null; }
    if (watcher) { try { watcher.close(); } catch (e) {} watcher = null; }
  };
}

// Resolve the jsonl path for a (cwd, cliSessionId) without depending on
// utils.js so this module stays self-contained.
function jsonlPathFor(home, cwd, cliSessionId) {
  if (!home || !cwd || !cliSessionId) return null;
  var encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(home, ".claude", "projects", encoded, cliSessionId + ".jsonl");
}

module.exports = {
  start: start,
  jsonlPathFor: jsonlPathFor,
};
