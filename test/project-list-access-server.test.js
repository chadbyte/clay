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
        if (socket._clayWaiters[i].type !== message.type || (socket._clayWaiters[i].predicate && !socket._clayWaiters[i].predicate(message))) continue;
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

function waitForMessage(socket, type, predicate) {
  for (var i = 0; i < socket._clayMessages.length; i++) {
    if (socket._clayMessages[i].type === type && (!predicate || predicate(socket._clayMessages[i]))) return Promise.resolve(socket._clayMessages.splice(i, 1)[0]);
  }
  return new Promise(function (resolve, reject) {
    var waiter = { type: type, predicate: predicate, resolve: resolve, timer: null };
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

  // Opening sockets also broadcasts presence lists; wait for the revoked snapshot.
  function revokedList(message) { return JSON.stringify(slugs(message)) === JSON.stringify(["public"]); }
  var homeRefresh = waitForMessage(homeSocket, "projects_updated", revokedList);
  var projectRefresh = waitForMessage(publicSocket, "projects_updated", revokedList);
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

test("administrator receives only metadata and cannot fetch project content or self-grant", { timeout: 20000 }, async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  var home = await openSocket(fixture, "/ws", fixture.tokens.admin);
  t.after(function () { home.close(); });
  var snapshot = await waitForMessage(home, "projects_updated");
  var foreign = snapshot.projects.find(function (project) { return project.slug === "hidden"; });
  assert.equal(foreign.contentAccess, false);
  assert.deepEqual(Object.keys(foreign).sort(), ["administrativeAccess", "contentAccess", "ownerName", "ownershipRecovery", "project", "projectOwnerId", "runtimeHealth", "slug", "title", "visibility"].sort());
  assert.doesNotMatch(JSON.stringify(foreign), /hidden-secret-path|PRIVATE_|sessions|branch|pendingPermissions/);
  var page = await (await request(fixture, "/p/hidden/", fixture.tokens.admin)).text();
  assert.match(page, /Administrative metadata only/);
  assert.doesNotMatch(page, /id="messages"|id="input"|id="sidebar"|PRIVATE_|hidden-secret-path|modules\/app.js/);
  var access = await (await request(fixture, "/api/admin/projects/hidden/access", fixture.tokens.admin)).json();
  assert.equal(access.contentAccess, false);
  assert.equal(access.allowedUsers, undefined);
  for (var endpoint of ["/p/hidden/api/sessions", "/p/hidden/info", "/p/hidden/api/files", "/p/hidden/api/mcp-bridge"]) {
    var response = await request(fixture, endpoint, fixture.tokens.admin);
    assert.equal(response.status, 403, endpoint);
    assert.doesNotMatch(await response.text(), /PRIVATE_|hidden-secret-path/);
  }
  for (var operation of ["owner", "visibility", "users"]) {
    var denied = await fetch("http://127.0.0.1:" + fixture.port + "/api/admin/projects/hidden/" + operation, {
      method: "PUT", headers: { Cookie: "relay_auth_user=" + fixture.tokens.admin, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "admin", visibility: "public", allowedUsers: ["admin"] }),
    });
    assert.equal(denied.status, 403, operation);
  }
  await assert.rejects(openSocket(fixture, "/p/hidden/ws", fixture.tokens.admin), /403/);
  var reset = await fetch("http://127.0.0.1:" + fixture.port + "/api/admin/users/owner/reset-pin", {
    method: "POST", headers: { Cookie: "relay_auth_user=" + fixture.tokens.admin },
  });
  assert.equal(reset.status, 403);
  var deletion = await fetch("http://127.0.0.1:" + fixture.port + "/api/admin/users/owner", {
    method: "DELETE", headers: { Cookie: "relay_auth_user=" + fixture.tokens.admin },
  });
  assert.equal(deletion.status, 409);
});

test("public project snapshots exclude private sessions for admins and reconnects but retain explicit sharing", { timeout: 20000 }, async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  for (var iteration of [1, 2]) {
    var socket = await openSocket(fixture, "/p/public/ws", fixture.tokens.admin);
    var list = await waitForMessage(socket, "session_list");
    assert.doesNotMatch(JSON.stringify(list), /PRIVATE_SESSION_SENTINEL|PRIVATE_MESSAGE_SENTINEL/);
    assert.ok(list.sessions.every(function (session) { return session.ownerId === "admin"; }));
    socket.close();
  }
  var owner = await openSocket(fixture, "/p/public/ws", fixture.tokens.owner);
  t.after(function () { owner.close(); });
  assert.match(JSON.stringify(await waitForMessage(owner, "session_list")), /PRIVATE_SESSION_SENTINEL/);
});

test("private notification previews are filtered on live transport and reconnect", { timeout: 20000 }, async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  var owner = await openSocket(fixture, "/p/public/ws", fixture.tokens.owner);
  var admin = await openSocket(fixture, "/p/public/ws", fixture.tokens.admin);
  t.after(function () { owner.close(); admin.close(); });
  await waitForMessage(owner, "notifications_state");
  await waitForMessage(admin, "notifications_state");
  var ownerNotification = waitForMessage(owner, "notification_created");
  fixture.child.send("notify-private");
  assert.match(JSON.stringify(await ownerNotification), /PRIVATE_NOTIFICATION_SENTINEL/);
  var reconnected = await openSocket(fixture, "/p/public/ws", fixture.tokens.admin);
  t.after(function () { reconnected.close(); });
  assert.doesNotMatch(JSON.stringify(await waitForMessage(reconnected, "notifications_state")), /PRIVATE_NOTIFICATION_SENTINEL|PRIVATE_PREVIEW_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(admin._clayMessages), /PRIVATE_NOTIFICATION_SENTINEL|PRIVATE_PREVIEW_SENTINEL/);
});

test("owner transfer validates account IDs and preserves private historical session ownership", { timeout: 20000 }, async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });
  async function transfer(userId) {
    return fetch("http://127.0.0.1:" + fixture.port + "/api/admin/projects/shared/owner", {
      method: "PUT", headers: { Cookie: "relay_auth_user=" + fixture.tokens.owner, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId }),
    });
  }
  assert.equal((await transfer(null)).status, 400);
  assert.equal((await transfer("nonexistent")).status, 400);
  assert.equal((await transfer("admin")).status, 200);
  var socket = await openSocket(fixture, "/p/shared/ws", fixture.tokens.admin);
  t.after(function () { socket.close(); });
  assert.doesNotMatch(JSON.stringify(await waitForMessage(socket, "session_list")), /PRIVATE_SESSION_SENTINEL/);
  var access = await (await request(fixture, "/api/admin/projects/shared/access", fixture.tokens.admin)).json();
  assert.equal(access.ownerId, "admin");
});
