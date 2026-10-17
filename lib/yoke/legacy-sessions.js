// The existing imported terminal format. Product session creation/deletion
// remains in the host; these are provider file/grammar projections only.
var fs = require("fs"), path = require("path");
var hygiene = require("./claude-transcript-hygiene");
function directory(home, cwd) { return path.join(home, ".claude", "projects", require("../utils").encodeCwd(cwd)); }
  function readHead(filePath) {
    var MAX_READ = 64 * 1024;
    try {
      var stat = fs.statSync(filePath);
      var fd = fs.openSync(filePath, "r");
      var bytesToRead = Math.min(stat.size, MAX_READ);
      var buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, 0);
      fs.closeSync(fd);
      var lines = buf.toString("utf8").split("\n");
      var events = [];
      for (var i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try {
          var event = JSON.parse(lines[i]);
          if (event && typeof event === "object") events.push(event);
        } catch (e) {}
      }
      return events;
    } catch (e) {
      return null;
    }
  }

function metadata(events, fp) {
      var userCount = 0;
      var firstUserText = null;
      var createdAtIso = null;
      for (var li = 0; li < events.length; li++) {
        var ev = events[li];
        if (ev.type === "user" && ev.message && ev.message.role === "user") {
          userCount++;
          if (firstUserText == null) {
            var c = ev.message.content;
            if (typeof c === "string") {
              firstUserText = c;
            } else if (Array.isArray(c)) {
              var parts = [];
              for (var ci = 0; ci < c.length; ci++) {
                if (c[ci] && c[ci].type === "text" && typeof c[ci].text === "string") parts.push(c[ci].text);
              }
              firstUserText = parts.join("");
            }
            if (ev.timestamp && !createdAtIso) createdAtIso = ev.timestamp;
          }
        }
      }

      if (userCount === 0) return null;
      // Defensive warmup skip (daemon also cleans these)
      if (hygiene.isClaudeWarmupTranscript(events)) return null;

      // Title: first user message trimmed/truncated. Fall back to a
      // neutral label so the sidebar entry is identifiable.
      var title = (firstUserText || "").trim().replace(/\s+/g, " ");
      if (title.length > 60) title = title.slice(0, 57) + "...";
      if (!title) title = "Imported CLI session";

      var createdAt = Date.now();
      if (createdAtIso) {
        var t = Date.parse(createdAtIso);
        if (!isNaN(t)) createdAt = t;
      }
      var lastActivity = createdAt;
      try { lastActivity = fs.statSync(fp).mtimeMs; } catch (e) {}

return { title: title, createdAt: createdAt, lastActivity: lastActivity };
}
function candidates(dir, known, deleted) {
  var files;
  try { files = fs.readdirSync(dir); } catch (error) { return []; }
  return files.filter(function(file) { return file.endsWith(".jsonl"); }).flatMap(function(file) {
    var id = file.slice(0, -6);
    if (known.has(id) || deleted.has(id)) return [];
    var filename = path.join(dir, file), events = readHead(filename);
    var value = events && metadata(events, filename);
    return value ? [Object.assign({ id: id, vendor: "claude" }, value)] : [];
  });
}
function obsolete(dir, session) {
  var filename = path.join(dir, session.cliSessionId + ".jsonl"), events = readHead(filename);
  return !fs.existsSync(filename) && (!session.history || session.history.length === 0) || events && hygiene.isClaudeWarmupTranscript(events);
}
module.exports = { candidates: candidates, obsolete: obsolete, directory: directory, readHead: readHead, metadata: metadata, isWarmup: hygiene.isClaudeWarmupTranscript };
