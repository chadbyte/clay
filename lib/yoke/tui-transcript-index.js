// tui-transcript-index.js
//
// Build a per-session index of assistant text messages from a Claude Code
// TUI transcript (~/.claude/projects/{encoded-cwd}/{cliSessionId}.jsonl).
//
// The TUI message-grab feature uses this index on the client to map a
// hovered xterm region back to its original markdown source. We only
// extract assistant text blocks. Tool calls and tool results render in
// the terminal in a shape that's quite different from their JSONL form,
// so matching them would be noisy and not particularly useful.
//
// Codex sessions don't write transcripts at all; callers should skip
// indexing for non-claude vendors.

var fs = require("fs");
var path = require("path");
var utils = require("../utils");
var { REAL_HOME } = require("../config");

var encodeCwd = utils.encodeCwd;

// Min length of a normalized assistant message to bother indexing.
// Anything shorter ("ok", "sure", "yes") would generate too many false
// positives when matched against a hovered terminal block.
var MIN_MATCH_LEN = 20;

// Claude Code writes its JSONL under the *running user's* home, which
// is not the daemon's home in OS-isolation mode (where each Clay user
// gets a real Linux account like /home/clay-name). Callers from the
// project context resolve the session owner's home and pass it in;
// when no home is provided we fall back to REAL_HOME for single-user
// installs.
function transcriptFilePath(home, cwd, cliSessionId) {
  if (!cwd || !cliSessionId) return null;
  var base = home || REAL_HOME;
  return path.join(base, ".claude", "projects", encodeCwd(cwd), cliSessionId + ".jsonl");
}

// matchKey is just whitespace-normalized raw markdown. We intentionally
// do NOT strip markdown decoration here.
//
// Reasoning: TUI rendering drops markdown markers (**bold** -> bold,
// `code` -> code, [text](url) -> text, etc.) and the visible text is
// therefore always a substring of the JSONL source's character stream.
// If we strip server-side we risk getting the rules wrong on corner
// cases (double-backtick code spans, list-bullet rendering quirks,
// nested formatting) and the resulting matchKey diverges from both
// sides at once. Leaving the source alone and letting the client do a
// multi-offset substring probe against block text is more robust and
// much less code.
function normalizeForMatch(s) {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

// Stable per-message id. Claude's JSONL usually carries one of these but
// fall back to the parsed line index so the client always has a handle.
function messageId(obj, index) {
  if (obj && obj.uuid) return String(obj.uuid);
  if (obj && obj.message && obj.message.id) return String(obj.message.id);
  return "msg-" + index;
}

// Parse a single JSONL line into one assistant-text record, or null
// when the line isn't one we index (user prompts, tool_use blocks,
// tool_result records, etc.). Text-only assistant blocks get joined
// in order so a multi-block response surfaces as a single grabbable
// message.
function parseAssistantTextLine(line, index) {
  var obj;
  try { obj = JSON.parse(line); } catch (e) { return null; }
  if (!obj || !obj.message) return null;
  if (obj.message.role !== "assistant") return null;
  if (!Array.isArray(obj.message.content)) return null;

  var text = "";
  for (var i = 0; i < obj.message.content.length; i++) {
    var block = obj.message.content[i];
    if (block && block.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  text = text.trim();
  if (!text) return null;

  var normalized = normalizeForMatch(text);
  if (normalized.length < MIN_MATCH_LEN) return null;

  return {
    id: messageId(obj, index),
    text: text,
    matchKey: normalized,
  };
}

// Read the whole transcript and return the assistant text index. The
// transcripts are small enough (KB to a few MB) that a sync read on
// session open or on a watcher-driven update is fine. We also return
// the mtime/size so callers can short-circuit re-reads when nothing
// changed.
function readAssistantIndex(home, cwd, cliSessionId) {
  var file = transcriptFilePath(home, cwd, cliSessionId);
  if (!file) return { messages: [], mtimeMs: 0, byteLength: 0 };
  var raw;
  var stat;
  try {
    raw = fs.readFileSync(file, "utf8");
    stat = fs.statSync(file);
  } catch (e) {
    return { messages: [], mtimeMs: 0, byteLength: 0 };
  }
  var lines = raw.split("\n");
  var messages = [];
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    var entry = parseAssistantTextLine(lines[i], i);
    if (entry) messages.push(entry);
  }
  return {
    messages: messages,
    mtimeMs: stat.mtimeMs || 0,
    byteLength: stat.size || raw.length,
  };
}

module.exports = {
  MIN_MATCH_LEN: MIN_MATCH_LEN,
  transcriptFilePath: transcriptFilePath,
  readAssistantIndex: readAssistantIndex,
  parseAssistantTextLine: parseAssistantTextLine,
  normalizeForMatch: normalizeForMatch,
};
