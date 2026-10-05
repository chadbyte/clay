// Private, human-controlled browser transport for a single vendor login.
var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var spawn = require("child_process").spawn;
var buildUserEnv = require("./build-user-env").buildUserEnv;
var wrapSpawnAsUser = require("./os-users").wrapSpawnAsUser;

function loginUrl(value, vendor) {
  try {
    var url = new URL(value);
    var hosts = vendor === "codex" ? ["auth.openai.com"] : ["claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"];
    if (url.protocol !== "https:" || url.username || url.password || hosts.indexOf(url.hostname) < 0) return null;
    if (!url.searchParams.get("state") || !url.searchParams.get("code_challenge")) return null;
    var callback = new URL(url.searchParams.get("redirect_uri"));
    if (callback.protocol !== "http:" || ["localhost", "127.0.0.1", "[::1]"].indexOf(callback.hostname) < 0) return null;
    return url.href;
  } catch (e) { return null; }
}

function createLoginBrowser(options) {
  var id = crypto.randomUUID();
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-login-"));
  fs.chmodSync(dir, 0o700);
  var info = options.osUserInfo;
  if (info) fs.chownSync(dir, info.uid, info.gid);
  var urlFile = path.join(dir, "url");
  var opener = path.resolve(__dirname, "../bin/login-browser-open.js");
  var wrapper = path.join(dir, process.platform === "win32" ? "open.cmd" : "open");
  var quote = function (value) { return "'" + value.replace(/'/g, "'\\''") + "'"; };
  var script = process.platform === "win32"
    ? '@"' + process.execPath + '" "' + opener + '" %*\r\n'
    : "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(opener) + ' "$@"\n';
  fs.writeFileSync(wrapper, script, { mode: 0o700 });
  if (info) fs.chownSync(wrapper, info.uid, info.gid);
  var child = null;
  var peer = options.ws;
  var closed = false;
  var started = false;
  var status = "Waiting for the sign-in page…";
  var statusPhase = "loading";
  var tail = "";
  var pollBusy = false;
  var waitTimer = setTimeout(function () {
    if (!started && !closed) {
      status = "Still waiting for the CLI sign-in page. Use terminal sign-in if it needs attention.";
      send({ type: "vendor_login_browser_status", text: status, phase: statusPhase });
    }
  }, 30000);
  waitTimer.unref();

  function send(message) {
    if (closed || !peer || peer.readyState !== 1 || !options.canAccess(peer)) return;
    if (message.type === "vendor_login_browser_frame" && peer.bufferedAmount > 1024 * 1024) return;
    options.sendTo(peer, Object.assign({ vendor: options.vendor, browserId: id }, message));
  }
  function write(message) {
    if (child && child.stdin.writable && child.stdin.writableLength < 65536) child.stdin.write(JSON.stringify(message) + "\n");
  }
  function start(url) {
    if (closed || started) return;
    started = true;
    clearTimeout(waitTimer);
    status = "Opening a private sign-in browser…";
    send({ type: "vendor_login_browser_status", text: status, phase: statusPhase });
    var env = buildUserEnv(info);
    if (process.platform === "win32" && !info) {
      ["SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "COMSPEC", "PATHEXT"].forEach(function (key) {
        if (process.env[key]) env[key] = process.env[key];
      });
    }
    var opts = { cwd: info ? info.home : os.homedir(), env: env, stdio: ["pipe", "pipe", "ignore"] };
    if (info) { opts.uid = info.uid; opts.gid = info.gid; }
    var spec = wrapSpawnAsUser(process.execPath, [path.join(__dirname, "vendor-login-browser-worker.js")], opts);
    child = spawn(spec.command, spec.args, spec.options);
    var buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", function (chunk) {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) { child.kill(); return; }
      var at;
      while ((at = buffer.indexOf("\n")) >= 0) {
        var line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        try {
          var message = JSON.parse(line);
          if (message.type === "status") {
            status = message.text;
            statusPhase = message.phase || "loading";
            send({ type: "vendor_login_browser_status", text: status, phase: statusPhase });
          } else if (message.type === "frame") {
            send({ type: "vendor_login_browser_frame", data: message.data, origin: message.origin, width: message.width, height: message.height });
            write({ type: "viewing", value: !!(peer && peer.readyState === 1 && options.canAccess(peer)) });
          }
        } catch (e) {}
      }
    });
    child.on("error", function () {
      statusPhase = "error";
      status = "The sign-in browser could not start. Use terminal sign-in to continue.";
      send({ type: "vendor_login_browser_status", text: status, phase: statusPhase });
    });
    child.on("exit", function () {
      if (closed) return;
      statusPhase = "error";
      status = "The sign-in browser closed. You can retry or use terminal sign-in.";
      send({ type: "vendor_login_browser_status", text: status, phase: statusPhase });
    });
    child.stdin.on("error", function () {});
    write({ type: "start", url: url });
  }
  function acceptUrl(value) {
    var url = loginUrl(value, options.vendor);
    if (url) start(url);
  }
  var timer = setInterval(function () {
    if (closed || started || pollBusy) return;
    pollBusy = true;
    fs.readFile(urlFile, "utf8", function (err, value) {
      pollBusy = false;
      if (!err && value.length <= 16384) acceptUrl(value);
    });
  }, 250);
  timer.unref();
  return {
    id: id,
    env: { BROWSER: wrapper, CLAY_LOGIN_URL_FILE: urlFile },
    output: function (chunk) {
      // Codex also prints the complete URL when the platform opener ignores BROWSER.
      tail = (tail + chunk).slice(-32768);
      var matches = tail.match(/https:\/\/[^\s\x1b<>"']+(?=[\s\x1b<>"'])/g) || [];
      for (var i = 0; i < matches.length; i++) acceptUrl(matches[i]);
    },
    attach: function (ws) {
      peer = ws;
      send({ type: "vendor_login_browser_status", text: status, phase: statusPhase });
      write({ type: "viewing", value: true });
    },
    input: function (ws, event) {
      if (ws !== peer || !options.canAccess(ws) || !event || typeof event !== "object") return;
      write({ type: "input", event: event });
    },
    close: function () {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearTimeout(waitTimer);
      if (child) {
        child.stdin.end();
        var killTimer = setTimeout(function () { child.kill("SIGKILL"); }, 5000);
        killTimer.unref();
        child.once("exit", function () { clearTimeout(killTimer); });
      }
      fs.rmSync(dir, { recursive: true, force: true });
      tail = "";
      peer = null;
    },
  };
}

module.exports = { createLoginBrowser: createLoginBrowser, loginUrl: loginUrl };
