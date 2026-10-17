// Blank-session hygiene: decides which sessions are safe to reuse for a
// "New session" request and which abandoned blanks are safe to sweep.
// Pure decision logic only -- deletion/switching stays in sessions.js.

var sessionProvenance = require("./session-provenance");

var BLANK_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var transcriptHygiene = require("./yoke/claude-transcript-hygiene");

// A session is "blank" when nothing has ever happened in it and nothing is
// attached to it. Adopted external sessions are never blank (their transcript
// lives outside Clay), TUI sessions reap themselves via their PTY onExit, and
// spawn/loop children are managed by their own lifecycles.
function isBlankSession(s) {
  return !!s
    && (s.turnCount || 0) === 0
    && (!s.history || s.history.length === 0)
    && !s.isProcessing
    && !s.queryInstance
    && !s.adopted
    && !s.bookmarked
    && !s.spawn
    && !s.loop
    && !sessionProvenance.isWorker(s)
    && (s.mode || "gui") !== "tui"
    && s.terminalId == null;
}

// Newest blank owned by the same user. An exact vendor match wins; a
// vendor-less blank (default adapter, nothing decided yet) is an acceptable
// fallback -- the caller stamps the requested vendor onto it before use.
function findReusableBlankSession(sessions, opts) {
  var vendor = (opts && opts.vendor) || null;
  var ownerId = (opts && opts.ownerId) || null;
  var exact = null;
  var vendorless = null;
  sessions.forEach(function (s) {
    if (!isBlankSession(s)) return;
    if ((s.ownerId || null) !== ownerId) return;
    var v = s.vendor || null;
    if (v === vendor) {
      if (!exact || (s.createdAt || 0) > (exact.createdAt || 0)) exact = s;
    } else if (v === null) {
      if (!vendorless || (s.createdAt || 0) > (vendorless.createdAt || 0)) vendorless = s;
    }
  });
  return exact || vendorless;
}

// Blanks untouched for more than the grace period, excluding whatever a
// client is currently looking at.
function collectStaleBlankSessions(sessions, activeSessionId, now) {
  var cutoff = now - BLANK_SESSION_MAX_AGE_MS;
  var stale = [];
  sessions.forEach(function (s) {
    if (!isBlankSession(s)) return;
    if (s.localId === activeSessionId) return;
    if (Math.max(s.createdAt || 0, s.lastActivity || 0) >= cutoff) return;
    stale.push(s.localId);
  });
  return stale;
}

module.exports = {
  isBlankSession: isBlankSession,
  findReusableBlankSession: findReusableBlankSession,
  collectStaleBlankSessions: collectStaleBlankSessions,
  extractClaudeUserText: transcriptHygiene.extractClaudeUserText,
  isClaudeWarmupTranscript: transcriptHygiene.isClaudeWarmupTranscript,
  BLANK_SESSION_MAX_AGE_MS: BLANK_SESSION_MAX_AGE_MS,
};
