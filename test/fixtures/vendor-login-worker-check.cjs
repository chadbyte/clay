// Explicit integration check: real Chromium, human input, and a host-local callback.
// No provider accounts or credentials are used.
var assert = require("node:assert/strict");
var http = require("http");
var path = require("path");
var spawn = require("child_process").spawn;
var readline = require("readline");
var child = null;
var sent = false;
var finished = false;
var origin;
var server = http.createServer(function (req, res) {
  assert.ok(req.headers["user-agent"].includes("Chrome/"));
  assert.ok(!req.headers["user-agent"].includes("HeadlessChrome/"));
  var url = new URL(req.url, origin);
  res.setHeader("Content-Type", "text/html");
  res.end('<html><body><form><input name="code" style="position:absolute;left:30px;top:30px;width:200px;height:40px"><input type="hidden" name="passkeys" id="passkeys"><button>Continue</button></form><script>document.getElementById("passkeys").value=typeof PublicKeyCredential;</script></body></html>');
  if (url.searchParams.get("code") === "fixture") {
    assert.strictEqual(url.searchParams.get("passkeys"), "undefined");
    console.log("PASS: streamed browser accepted input and completed the host-local callback");
    finish(0);
  }
});
var timeout = setTimeout(function () { console.error("Browser callback timed out"); finish(1); }, 30000);

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (child) child.stdin.end();
  server.close();
  process.exitCode = code;
}

server.listen(0, "127.0.0.1", function () {
  origin = "http://127.0.0.1:" + server.address().port;
  child = spawn(process.execPath, [path.resolve(__dirname, "../../lib/vendor-login-browser-worker.js")], { stdio: ["pipe", "pipe", "pipe"] });
  child.on("error", function (err) { console.error(err.message); finish(1); });
  child.stdin.on("error", function () {});
  child.stderr.on("data", function (data) { process.stderr.write(data); });
  var lines = readline.createInterface({ input: child.stdout });
  lines.on("line", function (line) {
    var message = JSON.parse(line);
    if (message.type !== "frame" || message.origin !== origin || sent) return;
    sent = true;
    assert.ok(message.data.length > 100);
    [
      { kind: "resize", width: 390, height: 600 },
      { kind: "move", x: 50, y: 50 },
      { kind: "down", x: 70, y: 50 },
      { kind: "up", x: 70, y: 50 },
      { kind: "text", text: "fixture" },
      { kind: "key", key: "Enter" },
    ].forEach(function (event) { child.stdin.write(JSON.stringify({ type: "input", event: event }) + "\n"); });
  });
  child.stdin.write(JSON.stringify({ type: "start", url: origin + "/callback?redirect_uri=" + encodeURIComponent(origin + "/callback") }) + "\n");
});
