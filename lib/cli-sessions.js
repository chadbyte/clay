var fs = require("fs");
var path = require("path");
var os = require("os");
var readline = require("readline");

/**
 * Compute the encoded project directory name used by the Claude CLI.
 * Replaces all "/" with "-", e.g. "/Users/foo/project" -> "-Users-foo-project"
 */
function encodeCwd(cwd) {
  return cwd.replace(/\//g, "-");
}

/**
 * Parse the first ~20 lines of a CLI session JSONL file to extract metadata.
 * Returns null if the file can't be parsed or has no user messages.
 */
function parseSessionFile(filePath, maxLines) {
  if (maxLines == null) maxLines = 20;
  return new Promise(function (resolve) {
    var sessionId = path.basename(filePath, ".jsonl");
    var result = {
      sessionId: sessionId,
      firstPrompt: "",
      model: null,
      gitBranch: null,
      startTime: null,
      lastActivity: null,
    };

    var lineCount = 0;
    var foundUser = false;
    var stream;
    try {
      stream = fs.createReadStream(filePath, { encoding: "utf8" });
    } catch (e) {
      return resolve(null);
    }

    var rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", function (line) {
      lineCount++;
      if (lineCount > maxLines) {
        rl.close();
        stream.destroy();
        return;
      }

      var obj;
      try { obj = JSON.parse(line); } catch (e) { return; }

      // Skip file-history-snapshot and other non-message records
      if (obj.type === "user" && obj.message && obj.message.role === "user") {
        if (!foundUser) {
          foundUser = true;
          result.sessionId = obj.sessionId || sessionId;
          result.gitBranch = obj.gitBranch || null;
          if (obj.timestamp) result.startTime = obj.timestamp;
          var content = obj.message.content || "";
          if (typeof content === "string") {
            result.firstPrompt = content.substring(0, 100);
          } else if (Array.isArray(content)) {
            for (var i = 0; i < content.length; i++) {
              if (content[i].type === "text" && content[i].text) {
                result.firstPrompt = content[i].text.substring(0, 100);
                break;
              }
            }
          }
        }
        // Track latest user timestamp for lastActivity
        if (obj.timestamp) result.lastActivity = obj.timestamp;
      }

      // Extract model from first assistant message
      if (!result.model && obj.message && obj.message.role === "assistant" && obj.message.model) {
        result.model = obj.message.model;
      }
    });

    rl.on("close", function () {
      if (!foundUser) return resolve(null);

      // Use file mtime as fallback for lastActivity, or as a better proxy
      // since we only read the first ~20 lines
      try {
        var stat = fs.statSync(filePath);
        var mtime = stat.mtime.toISOString();
        // File mtime is always more accurate for "last activity" since we
        // don't read the entire file
        result.lastActivity = mtime;
      } catch (e) {}

      resolve(result);
    });

    rl.on("error", function () {
      resolve(null);
    });

    stream.on("error", function () {
      rl.close();
      resolve(null);
    });
  });
}

/**
 * List CLI sessions for a given project directory.
 * Reads ~/.claude/projects/{encoded-cwd}/ and parses JSONL metadata.
 * Returns array sorted by lastActivity descending (most recent first).
 */
function listCliSessions(cwd) {
  var encoded = encodeCwd(cwd);
  var projectDir = path.join(os.homedir(), ".claude", "projects", encoded);

  return new Promise(function (resolve) {
    fs.readdir(projectDir, { withFileTypes: true }, function (err, entries) {
      if (err) return resolve([]);

      var jsonlFiles = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isFile() && entries[i].name.endsWith(".jsonl")) {
          jsonlFiles.push(path.join(projectDir, entries[i].name));
        }
      }

      if (jsonlFiles.length === 0) return resolve([]);

      var pending = jsonlFiles.length;
      var results = [];

      for (var j = 0; j < jsonlFiles.length; j++) {
        parseSessionFile(jsonlFiles[j]).then(function (session) {
          if (session) results.push(session);
          pending--;
          if (pending === 0) {
            results.sort(function (a, b) {
              var ta = a.lastActivity || "";
              var tb = b.lastActivity || "";
              return ta < tb ? 1 : ta > tb ? -1 : 0;
            });
            resolve(results);
          }
        });
      }
    });
  });
}

/**
 * Get the most recent CLI session for a given project directory.
 * Returns the session object or null if none found.
 */
function getMostRecentCliSession(cwd) {
  return listCliSessions(cwd).then(function (sessions) {
    return sessions.length > 0 ? sessions[0] : null;
  });
}

/**
 * Extract user message text from a CLI JSONL content field.
 * Content can be a string or an array of content blocks.
 */
function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  var parts = [];
  for (var i = 0; i < content.length; i++) {
    if (content[i].type === "text" && content[i].text) {
      parts.push(content[i].text);
    }
  }
  return parts.join("");
}

/**
 * Read a full CLI session JSONL file and convert it to relay-compatible
 * history entries (user_message, delta, tool_start, tool_executing, tool_result).
 * Returns a Promise that resolves to an array of history entries.
 */
function readCliSessionHistory(cwd, sessionId) {
  var encoded = encodeCwd(cwd);
  var filePath = path.join(os.homedir(), ".claude", "projects", encoded, sessionId + ".jsonl");

  return new Promise(function (resolve) {
    var history = [];
    var stream;
    try {
      stream = fs.createReadStream(filePath, { encoding: "utf8" });
    } catch (e) {
      return resolve([]);
    }

    var rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    var toolCounter = 0;

    rl.on("line", function (line) {
      var obj;
      try { obj = JSON.parse(line); } catch (e) { return; }

      if (!obj.message) return;

      // User prompt
      if (obj.type === "user" && obj.message.role === "user") {
        // Skip tool_result records (they have type "user" but content is tool results)
        var content = obj.message.content;
        if (Array.isArray(content) && content.length > 0 && content[0].type === "tool_result") {
          return;
        }
        var text = extractText(content);
        if (text) {
          history.push({ type: "user_message", text: text });
        }
        return;
      }

      // Assistant message
      if (obj.message.role === "assistant" && Array.isArray(obj.message.content)) {
        for (var i = 0; i < obj.message.content.length; i++) {
          var block = obj.message.content[i];

          if (block.type === "text" && block.text) {
            history.push({ type: "delta", text: block.text });
          }

          if (block.type === "tool_use") {
            var toolId = "cli-tool-" + (++toolCounter);
            var toolName = block.name || "Tool";
            history.push({ type: "tool_start", id: toolId, name: toolName });
            history.push({
              type: "tool_executing",
              id: toolId,
              name: toolName,
              input: block.input || {},
            });
            // Emit ask_user_answered so the client re-enables input after replaying AskUserQuestion
            if (toolName === "AskUserQuestion") {
              history.push({ type: "ask_user_answered", toolId: toolId });
            }
            history.push({ type: "tool_result", id: toolId, content: "" });
          }
        }
      }
    });

    rl.on("close", function () {
      resolve(history);
    });

    rl.on("error", function () {
      resolve([]);
    });

    stream.on("error", function () {
      rl.close();
      resolve([]);
    });
  });
}

module.exports = {
  listCliSessions: listCliSessions,
  getMostRecentCliSession: getMostRecentCliSession,
  readCliSessionHistory: readCliSessionHistory,
  // Exported for testing
  parseSessionFile: parseSessionFile,
  encodeCwd: encodeCwd,
  extractText: extractText,
};
