var test = require("node:test");
var assert = require("node:assert/strict");
var fork = require("node:child_process").fork;
var path = require("node:path");
var WebSocket = require("ws");
var http = require("node:http");
var attachNetworkSettings = require("../lib/server-network-settings").attachNetworkSettings;

function startFixture() {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, "fixtures/network-settings-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    var errors = "";
    var timer = setTimeout(function () { child.kill(); reject(new Error("Fixture startup timed out: " + errors)); }, 15000);
    child.stderr.on("data", function (chunk) { errors += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", function (code) { clearTimeout(timer); reject(new Error("Fixture exited: " + code + errors)); });
    var logs = [];
    child.on("message", function (message) { if (message && message.originRejectedLog) logs.push(message.originRejectedLog); });
    child.once("message", function (message) { clearTimeout(timer); resolve({ child: child, port: message.port, logs: logs }); });
  });
}

function connect(fixture, origin, cookie, extra, pathname) {
  return new Promise(function (resolve, reject) {
    var headers = Object.assign({ Host: "localhost:2633" }, extra);
    if (origin !== undefined) headers.Origin = origin;
    if (cookie) headers.Cookie = "relay_auth_user=" + cookie;
    var ws = new WebSocket("ws://127.0.0.1:" + fixture.port + (pathname || "/ws"), { headers: headers, handshakeTimeout: 5000 });
    ws.once("open", function () { ws.close(); resolve(101); });
    ws.once("unexpected-response", function (req, res) { res.resume(); ws.terminate(); resolve(res.statusCode); });
    ws.on("error", reject);
  });
}

test("Network settings authorize, persist, and apply to real WebSocket upgrades", { timeout: 30000 }, async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  var endpoint = "http://127.0.0.1:" + fixture.port + "/api/server/network";
  function request(method, cookie, body, extra) {
    var headers = Object.assign({ "Content-Type": "application/json", "X-Clay-Network-Settings": "1" }, extra);
    if (cookie) headers.Cookie = "relay_auth_user=" + cookie;
    return fetch(endpoint, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  assert.equal((await request("GET")).status, 401);
  assert.equal((await request("GET", "network-member")).status, 403);
  assert.equal((await request("PUT", "network-member", { allowedOrigins: [] })).status, 403);
  assert.equal((await request("PUT", "network-admin", { allowedOrigins: [] }, { "X-Clay-Network-Settings": "" })).status, 403);
  assert.equal((await request("PUT", "network-admin", { allowedOrigins: [] }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await request("PUT", "network-admin", { allowedOrigins: ["*"] })).status, 400);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin"), 403);
  await new Promise(function (resolve) { setTimeout(resolve, 100); });
  assert.equal(fixture.logs.length, 1);
  assert.match(fixture.logs[0], /origin "https:\/\/tunnel\.example" \(Host "localhost:2633"\).*Server Settings > Network/);
  assert.doesNotMatch(fixture.logs[0], /relay_auth|network-admin/);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin", {}, "/api/speech/live"), 403);
  assert.equal(await connect(fixture, "http://evil.example:2633", "network-admin"), 403);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin", { "X-Forwarded-Host": "tunnel.example", "X-Forwarded-Proto": "https" }), 403);
  assert.equal(await connect(fixture, "http://localhost:2633", "network-admin"), 101);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin", { Host: "tunnel.example" }), 101);
  assert.equal(await connect(fixture, undefined, "network-admin"), 101);
  var saved = await request("PUT", "network-admin", { allowedOrigins: ["https://TUNNEL.example:443/"] });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { allowedOrigins: ["https://tunnel.example"], invalid: [] });
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin"), 101);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin", {}, "/p/sample/ws"), 101);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin", {}, "/api/speech/live"), 101);
  var voice = await fetch("http://127.0.0.1:" + fixture.port + "/api/speech/settings", {
    headers: { Cookie: "relay_auth_user=network-admin", Origin: "https://tunnel.example" },
  });
  assert.equal(voice.status, 200);
  assert.equal(await connect(fixture, "https://tunnel.example"), 401);
  assert.equal(await connect(fixture, "null", "network-admin"), 403);
  var reloaded = new Promise(function (resolve) { fixture.child.once("message", resolve); });
  fixture.child.send("reload");
  assert.equal((await reloaded).config.unrelatedSetting, "retained");
  assert.deepEqual(await (await request("GET", "network-admin")).json(), { allowedOrigins: ["https://tunnel.example"], invalid: [] });
  assert.equal((await request("PUT", "network-admin", { allowedOrigins: [] })).status, 200);
  assert.equal(await connect(fixture, "https://tunnel.example", "network-admin"), 403);
  assert.equal(await connect(fixture, "https://other.example", "network-admin"), 403);
  await new Promise(function (resolve) { setTimeout(resolve, 100); });
  assert.equal(fixture.logs.length, 1, "repeated rejections stay rate limited");
});

test("cross-origin preflight on the real server cannot authorize a Network settings PUT", { timeout: 30000 }, async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  var endpoint = "http://127.0.0.1:" + fixture.port + "/api/server/network";
  var preflight = await fetch(endpoint, { method: "OPTIONS", headers: {
    Origin: "https://evil.example", Cookie: "relay_auth_user=network-admin",
    "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-clay-network-settings",
  } });
  var methods = (preflight.headers.get("access-control-allow-methods") || "").toUpperCase().split(/\s*,\s*/);
  var headers = (preflight.headers.get("access-control-allow-headers") || "").toLowerCase().split(/\s*,\s*/);
  assert.equal(methods.indexOf("PUT"), -1);
  assert.equal(methods.indexOf("*"), -1);
  assert.equal(headers.indexOf("x-clay-network-settings"), -1);
  assert.equal(headers.indexOf("*"), -1);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  var direct = await fetch(endpoint, { method: "PUT", body: "{\"allowedOrigins\":[\"https://evil.example\"]}", headers: {
    Cookie: "relay_auth_user=network-admin", "Content-Type": "application/json", "X-Clay-Network-Settings": "1", "Sec-Fetch-Site": "cross-site",
  } });
  assert.equal(direct.status, 403);
  assert.deepEqual((await (await fetch(endpoint, { headers: { Cookie: "relay_auth_user=network-admin" } })).json()).allowedOrigins, []);
});

test("single-user settings enforce PIN authentication and report validation and persistence failures", async function (t) {
  var config = { allowedOrigins: ["https://existing.example"] };
  var opts = { onSetAllowedOrigins: function () { throw new Error("Disk full"); } };
  var handler = attachNetworkSettings({
    users: { isMultiUser: function () { return false; } },
    isRequestAuthed: function (req) { return req.headers.cookie === "pin=valid"; },
    getConfiguredOrigins: function () { return config.allowedOrigins; },
    opts: opts,
  });
  var server = http.createServer(function (req, res) { handler.handleRequest(req, res, req.url); });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { server.closeAllConnections(); server.close(); });
  var endpoint = "http://127.0.0.1:" + server.address().port + "/api/server/network";
  var headers = { Cookie: "pin=valid", "Content-Type": "application/json", "X-Clay-Network-Settings": "1" };
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { method: "PUT", headers: headers, body: "{" })).status, 400);
  assert.equal((await fetch(endpoint, { method: "PUT", headers: headers, body: "x".repeat(220001) })).status, 413);
  var body = JSON.stringify({ allowedOrigins: ["https://new.example"] });
  assert.equal((await fetch(endpoint, { method: "PUT", headers: headers, body: body })).status, 500);
  assert.deepEqual(await (await fetch(endpoint, { headers: headers })).json(), { allowedOrigins: config.allowedOrigins, invalid: [] });
  delete opts.onSetAllowedOrigins;
  assert.equal((await fetch(endpoint, { method: "PUT", headers: headers, body: body })).status, 503);
});

function attachSaving(config) {
  return attachNetworkSettings({
    users: { isMultiUser: function () { return false; } },
    isRequestAuthed: function () { return true; },
    getConfiguredOrigins: function () { return config.allowedOrigins; },
    opts: { onSetAllowedOrigins: function (values) { config.allowedOrigins = values; } },
  });
}

async function listen(t, handler) {
  var server = http.createServer(function (req, res) { handler.handleRequest(req, res, req.url); });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { server.closeAllConnections(); server.close(); });
  return server.address().port;
}

test("request bodies decode multibyte characters split across chunks", async function (t) {
  var config = { allowedOrigins: [] };
  var port = await listen(t, attachSaving(config));
  var body = Buffer.from(JSON.stringify({ allowedOrigins: ["https://café.example"] }));
  var split = body.indexOf(Buffer.from("é")) + 1;
  var response = await new Promise(function (resolve, reject) {
    var req = http.request({ port: port, host: "127.0.0.1", method: "PUT", path: "/api/server/network", headers: {
      "Content-Type": "application/json", "X-Clay-Network-Settings": "1", "Content-Length": body.length,
    } }, function (res) {
      var text = "";
      res.setEncoding("utf8");
      res.on("data", function (chunk) { text += chunk; });
      res.on("end", function () { resolve({ status: res.statusCode, data: JSON.parse(text) }); });
    });
    req.on("error", reject);
    req.write(body.subarray(0, split));
    setTimeout(function () { req.end(body.subarray(split)); }, 50);
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.allowedOrigins, ["https://xn--caf-dma.example"]);
  assert.deepEqual(config.allowedOrigins, ["https://xn--caf-dma.example"]);
});

test("validation failures report the failing entry index and leave settings unchanged", async function (t) {
  var config = { allowedOrigins: ["https://kept.example", "clay.example"] };
  var port = await listen(t, attachSaving(config));
  var endpoint = "http://127.0.0.1:" + port + "/api/server/network";
  var loaded = await (await fetch(endpoint)).json();
  assert.deepEqual(loaded.allowedOrigins, ["https://kept.example", "clay.example"]);
  assert.equal(loaded.invalid[0].index, 1);
  assert.match(loaded.invalid[0].reason, /must start with http:\/\/ or https:\/\//);
  var response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json", "X-Clay-Network-Settings": "1" },
    body: JSON.stringify({ allowedOrigins: ["https://ok.example", "https://clay.example/app"] }) });
  assert.equal(response.status, 400);
  var data = await response.json();
  assert.equal(data.index, 1);
  assert.match(data.reason, /path/);
  assert.match(data.error, /^Entry 2 /);
  assert.deepEqual(config.allowedOrigins, ["https://kept.example", "clay.example"]);
});
