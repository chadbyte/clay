// Durable fixture state is scoped to a real session, never a connection startup.
var fs = require("node:fs");
var path = require("node:path");
var randomUUID = require("node:crypto").randomUUID;
function create(root, options) {
  options = options || {};
  fs.mkdirSync(root, { recursive: true });
  var ownedSessionId = null, turns = [];
  function fileFor(sessionId) {
    if (typeof sessionId !== "string" || !sessionId) throw new Error("Exact fixture session required");
    return path.join(root, encodeURIComponent(sessionId) + ".json");
  }
  function read(sessionId) { return JSON.parse(fs.readFileSync(fileFor(sessionId), "utf8")); }
  function publish() {
    var file = fileFor(ownedSessionId);
    var staged = file + "." + process.pid + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(staged, JSON.stringify(turns), { flag: "wx" });
      if (options.beforeRename) options.beforeRename(file, staged);
      fs.renameSync(staged, file);
    } finally {
      if (fs.existsSync(staged)) fs.unlinkSync(staged);
    }
  }
  return {
    start: function () {
      ownedSessionId = "fixture-session-" + randomUUID(); turns = []; publish();
      return ownedSessionId;
    },
    resume: function (sessionId) {
      var loaded = read(sessionId);
      ownedSessionId = sessionId; turns = loaded;
      return turns;
    },
    append: function (turn) {
      if (!ownedSessionId) throw new Error("Fixture connection does not own a session");
      if (turns.some(function (existing) { return existing.turnId === turn.turnId; })) return;
      turns.push(turn); publish();
    },
    read: read,
  };
}
module.exports = { create: create };
