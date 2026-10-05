var spawn = require("child_process").spawn;
var path = require("path");
var os = require("os");
var buildUserEnv = require("./build-user-env").buildUserEnv;
var wrapSpawnAsUser = require("./os-users").wrapSpawnAsUser;

function createRuntime(options) {
  var identity = options.identity;
  var env = buildUserEnv(identity);
  if (process.platform === "win32" && !identity) {
    ["SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "COMSPEC", "PATHEXT"].forEach(function (key) { if (process.env[key]) env[key] = process.env[key]; });
  }
  var opts = { cwd: identity ? identity.home : os.homedir(), env: env, stdio: ["pipe", "pipe", "ignore"] };
  if (identity) { opts.uid = identity.uid; opts.gid = identity.gid; }
  var spec = wrapSpawnAsUser(process.execPath, [path.join(__dirname, "shared-browser-worker.js")], opts);
  var child = spawn(spec.command, spec.args, spec.options);
  var closed = false;
  var nextId = 0;
  var pending = new Map();
  var buffer = "";
  function send(message) {
    if (closed || !child.stdin.writable || child.stdin.writableLength > 256 * 1024) throw new Error("Browser is not connected");
    child.stdin.write(JSON.stringify(message) + "\n");
  }
  function fail(message) {
    pending.forEach(function (entry) { clearTimeout(entry.timer); entry.reject(new Error(message)); });
    pending.clear();
    if (!closed) options.onEvent({ type: "error", error: message });
  }
  child.stdin.on("error", function () {});
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", function (chunk) {
    buffer += chunk;
    if (buffer.length > 8 * 1024 * 1024) { fail("Browser response too large"); child.kill(); return; }
    var at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      var line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try {
        var message = JSON.parse(line);
        if (message.type === "result") {
          var entry = pending.get(message.id);
          if (entry) { clearTimeout(entry.timer); pending.delete(message.id); if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.value); }
        } else options.onEvent(message);
      } catch (e) {}
    }
  });
  child.on("error", function () { fail("Browser process could not start"); });
  child.on("exit", function () { fail("Browser process ended"); });
  send({ type: "start" });
  return {
    control: function (epoch) {
      return new Promise(function (resolve, reject) {
        var id = ++nextId;
        var timer = setTimeout(function () { pending.delete(id); reject(new Error("Browser control handoff timed out")); }, 30000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try { send({ type: "control", id: id, epoch: epoch }); }
        catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
      });
    },
    viewing: function (value) { try { send({ type: "viewing", value: value }); } catch (e) {} },
    request: function (action, event, epoch, activity) {
      return new Promise(function (resolve, reject) {
        if (pending.size >= 80) { reject(new Error("Browser is busy")); return; }
        var id = ++nextId;
        var timer = setTimeout(function () { pending.delete(id); reject(new Error("Browser action timed out")); }, 30000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try { send({ type: "command", id: id, action: action, event: event, epoch: epoch, activity: activity }); }
        catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
      });
    },
    close: function () {
      if (closed) return;
      closed = true;
      fail("Browser closed");
      child.stdin.end();
      var timer = setTimeout(function () { child.kill("SIGKILL"); }, 5000);
      timer.unref();
      child.once("exit", function () { clearTimeout(timer); });
    },
  };
}
module.exports = { createRuntime: createRuntime };
