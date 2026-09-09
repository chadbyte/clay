var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;
var WebSocket = require("ws");

function startFixture() {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, "fixtures/worktree-access-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    var errors = "";
    child.stderr.on("data", function (chunk) { errors += chunk.toString(); });
    child.once("error", reject);
    child.on("message", function onReady(message) {
      if (!message || !message.port) return;
      child.removeListener("message", onReady);
      resolve({ child: child, port: message.port, token: message.token, fullToken: message.fullToken, adminToken: message.adminToken, errors: function () { return errors; } });
    });
  });
}

function request(fixture, pathname, token) {
  return fetch("http://127.0.0.1:" + fixture.port + pathname, {
    headers: { Cookie: "relay_auth_user=" + (token || fixture.token) },
    redirect: "manual",
  });
}

function openSocket(fixture, slug, token) {
  return new Promise(function (resolve, reject) {
    var socket = new WebSocket("ws://127.0.0.1:" + fixture.port + "/p/" + slug + "/ws", {
      headers: { Cookie: "relay_auth_user=" + (token || fixture.token) },
    });
    socket.once("open", function () { resolve(socket); });
    socket.once("unexpected-response", function (req, response) { reject(new Error("Unexpected status " + response.statusCode)); });
    socket.once("error", reject);
  });
}

function waitForMessage(socket, type) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("Timed out waiting for " + type)); }, 5000);
    socket.on("message", function onMessage(data) {
      var message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.removeListener("message", onMessage);
      resolve(message);
    });
  });
}

function waitForChild(child, key) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("Timed out waiting for child")); }, 5000);
    child.on("message", function onMessage(message) {
      if (!message || !message[key]) return;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      resolve(message);
    });
  });
}

test("HTTP, WebSocket, listing, and live revocation enforce an exact worktree grant", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });

  assert.equal((await request(fixture, "/p/project--feature-c/")).status, 200);
  assert.equal((await request(fixture, "/p/project/")).status, 302);
  assert.equal((await request(fixture, "/p/project--feature-d/")).status, 302);
  await assert.rejects(openSocket(fixture, "project"), /Unexpected status 403/);
  await assert.rejects(openSocket(fixture, "project--feature-d"), /Unexpected status 403/);
  var info = await (await request(fixture, "/info")).json();
  assert.deepEqual(info.projects.map(function (project) { return project.slug; }), ["project--feature-c"]);

  var socket = await openSocket(fixture, "project--feature-c");
  var infoMessage = await waitForMessage(socket, "info");
  assert.deepEqual(infoMessage.projects.map(function (project) { return project.slug; }), ["project--feature-c"]);
  var createDenied = waitForMessage(socket, "create_worktree_result");
  socket.send(JSON.stringify({ type: "create_worktree", parentSlug: "project", branch: "forged", dirName: "forged" }));
  assert.match((await createDenied).error, /another worktree/);
  var revokedMessage = waitForMessage(socket, "access_revoked");
  var closed = new Promise(function (resolve) { socket.once("close", function (code) { resolve(code); }); });
  var childRevoked = waitForChild(fixture.child, "revoked");
  fixture.child.send("revoke");
  await childRevoked;
  assert.equal((await revokedMessage).slug, "project--feature-c");
  assert.equal(await closed, 1008);
  assert.equal((await request(fixture, "/p/project--feature-c/")).status, 302);

  await assert.rejects(openSocket(fixture, "project--feature-c"), /Unexpected status 403/);
}, { timeout: 20000 });

test("a full parent member keeps HTTP and WebSocket access to every worktree", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  assert.equal((await request(fixture, "/p/project/", fixture.fullToken)).status, 200);
  assert.equal((await request(fixture, "/p/project--feature-c/", fixture.fullToken)).status, 200);
  assert.equal((await request(fixture, "/p/project--feature-d/", fixture.fullToken)).status, 200);
  var socket = await openSocket(fixture, "project--feature-d", fixture.fullToken);
  var infoMessage = await waitForMessage(socket, "info");
  assert.deepEqual(infoMessage.projects.map(function (project) { return project.slug; }).sort(), [
    "project", "project--feature-c", "project--feature-d",
  ]);
  socket.close();
}, { timeout: 20000 });

test("root renders the real app shell with an authorized ordinary project", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });

  var restrictedResponse = await request(fixture, "/", fixture.token);
  var restrictedHtml = await restrictedResponse.text();
  assert.equal(restrictedResponse.status, 200);
  assert.match(restrictedHtml, /<body class="capsules-disabled" data-home-project-slug="project--feature-c">/);

  var preferredResponse = await request(fixture, "/", fixture.fullToken);
  var preferredHtml = await preferredResponse.text();
  assert.match(preferredHtml, /<body class="capsules-disabled" data-home-project-slug="project--feature-d">/);

  var adminResponse = await request(fixture, "/", fixture.adminToken);
  var adminHtml = await adminResponse.text();
  assert.match(adminHtml, /<body class="capsules-disabled" data-home-project-slug="project">/);
}, { timeout: 20000 });

test("root keeps the app shell usable when only a Mate context exists", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  var cleared = waitForChild(fixture.child, "clearedOrdinary");
  fixture.child.send("clear-ordinary");
  await cleared;

  var response = await request(fixture, "/", fixture.fullToken);
  var html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<body class="capsules-disabled">/);
  assert.doesNotMatch(html, /data-home-project-slug=/);
}, { timeout: 20000 });
