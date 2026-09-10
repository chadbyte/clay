var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;
var WebSocket = require("ws");

function startFixture() {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, "fixtures/project-list-access-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    var errors = "";
    child.stderr.on("data", function (chunk) { errors += chunk.toString(); });
    child.once("error", reject);
    child.on("message", function onReady(message) {
      if (!message || !message.port) return;
      child.removeListener("message", onReady);
      resolve({ child: child, port: message.port, tokens: message.tokens, errors: function () { return errors; } });
    });
  });
}

function request(fixture, pathname, token) {
  return fetch("http://127.0.0.1:" + fixture.port + pathname, {
    headers: { Cookie: "relay_auth_user=" + token },
    redirect: "manual",
  });
}

function openSocket(fixture, pathname, token) {
  return new Promise(function (resolve, reject) {
    var socket = new WebSocket("ws://127.0.0.1:" + fixture.port + pathname, {
      headers: { Cookie: "relay_auth_user=" + token },
    });
    socket._clayMessages = [];
    socket._clayWaiters = [];
    socket.on("message", function (data) {
      var message = JSON.parse(data.toString());
      for (var i = 0; i < socket._clayWaiters.length; i++) {
        if (socket._clayWaiters[i].type !== message.type) continue;
        var waiter = socket._clayWaiters.splice(i, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      socket._clayMessages.push(message);
    });
    socket.once("open", function () { resolve(socket); });
    socket.once("unexpected-response", function (req, response) { reject(new Error("Unexpected status " + response.statusCode)); });
    socket.once("error", reject);
  });
}

function waitForMessage(socket, type) {
  for (var i = 0; i < socket._clayMessages.length; i++) {
    if (socket._clayMessages[i].type === type) return Promise.resolve(socket._clayMessages.splice(i, 1)[0]);
  }
  return new Promise(function (resolve, reject) {
    var waiter = { type: type, resolve: resolve, timer: null };
    waiter.timer = setTimeout(function () {
      var index = socket._clayWaiters.indexOf(waiter);
      if (index >= 0) socket._clayWaiters.splice(index, 1);
      reject(new Error("Timed out waiting for " + type));
    }, 5000);
    socket._clayWaiters.push(waiter);
  });
}

function waitForChild(child, key) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("Timed out waiting for fixture")); }, 5000);
    child.on("message", function onMessage(message) {
      if (!message || !message[key]) return;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      resolve(message);
    });
  });
}

function slugs(message) {
  return message.projects.map(function (project) { return project.slug; }).sort();
}

test("authenticated project lists exclude inaccessible metadata and retain canonical shares", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });

  var memberInfo = await (await request(fixture, "/info", fixture.tokens.member)).json();
  assert.deepEqual(slugs(memberInfo), ["parent", "parent--inherited", "parent--outsider", "public", "shared"]);
  assert.doesNotMatch(JSON.stringify(memberInfo), /hidden-secret-path|Hidden Secret Project|"hidden"/);

  var outsiderInfo = await (await request(fixture, "/info", fixture.tokens.outsider)).json();
  assert.deepEqual(slugs(outsiderInfo), ["hidden", "parent--outsider", "public"]);

  var adminInfo = await (await request(fixture, "/info", fixture.tokens.admin)).json();
  assert.deepEqual(slugs(adminInfo), ["hidden", "parent", "parent--inherited", "parent--outsider", "public", "shared"]);

  var projectSocket = await openSocket(fixture, "/p/shared/ws", fixture.tokens.member);
  t.after(function () { projectSocket.close(); });
  var projectInfo = await waitForMessage(projectSocket, "info");
  assert.deepEqual(slugs(projectInfo), ["parent", "parent--inherited", "parent--outsider", "public", "shared"]);
  assert.doesNotMatch(JSON.stringify(projectInfo.projects), /hidden-secret-path|Hidden Secret Project|"hidden"/);
}, { timeout: 20000 });

test("Home and project sockets replace their list after persisted access revocation", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });

  var homeSocket = await openSocket(fixture, "/ws", fixture.tokens.member);
  var publicSocket = await openSocket(fixture, "/p/public/ws", fixture.tokens.member);
  var revokedSocket = await openSocket(fixture, "/p/shared/ws", fixture.tokens.member);
  t.after(function () { homeSocket.close(); publicSocket.close(); revokedSocket.close(); });

  var initialHomeList = await waitForMessage(homeSocket, "projects_updated");
  assert.deepEqual(slugs(initialHomeList), ["parent", "parent--inherited", "parent--outsider", "public", "shared"]);
  assert.doesNotMatch(JSON.stringify(initialHomeList.projects), /hidden-secret-path|Hidden Secret Project|"hidden"/);
  await waitForMessage(publicSocket, "info");
  await waitForMessage(revokedSocket, "info");

  var homeRefresh = waitForMessage(homeSocket, "projects_updated");
  var projectRefresh = waitForMessage(publicSocket, "projects_updated");
  var revoked = waitForMessage(revokedSocket, "access_revoked");
  var childRevoked = waitForChild(fixture.child, "revoked");
  fixture.child.send("revoke-member");
  await childRevoked;

  assert.deepEqual(slugs(await homeRefresh), ["public"]);
  assert.deepEqual(slugs(await projectRefresh), ["public"]);
  assert.equal((await revoked).slug, "shared");

  var reconnectedHome = await openSocket(fixture, "/ws", fixture.tokens.member);
  t.after(function () { reconnectedHome.close(); });
  assert.deepEqual(slugs(await waitForMessage(reconnectedHome, "projects_updated")), ["public"]);
}, { timeout: 20000 });

test("raw daemon project refreshes are reprojected per authenticated Home user", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  var memberSocket = await openSocket(fixture, "/ws", fixture.tokens.member);
  var outsiderSocket = await openSocket(fixture, "/ws", fixture.tokens.outsider);
  t.after(function () { memberSocket.close(); outsiderSocket.close(); });
  await waitForMessage(memberSocket, "projects_updated");
  await waitForMessage(outsiderSocket, "projects_updated");

  var memberRefresh = waitForMessage(memberSocket, "projects_updated");
  var outsiderRefresh = waitForMessage(outsiderSocket, "projects_updated");
  fixture.child.send("broadcast-projects");
  assert.deepEqual(slugs(await memberRefresh), ["parent", "parent--inherited", "parent--outsider", "public", "shared"]);
  assert.deepEqual(slugs(await outsiderRefresh), ["hidden", "parent--outsider", "public"]);
}, { timeout: 20000 });
