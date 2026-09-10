var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;

function startFixture() {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, "fixtures/root-project-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
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

function requestRoot(fixture, userId, lastProject) {
  var cookie = "relay_auth_user=" + fixture.tokens[userId];
  if (lastProject) cookie += "; clay_last_project=" + lastProject;
  return fetch("http://127.0.0.1:" + fixture.port + "/", {
    headers: { Cookie: cookie },
    redirect: "manual",
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

function expectedRootBody(slug) {
  return new RegExp('<body class="capsules-disabled" data-home-project-slug="' + slug + '">');
}

test("root project routing uses the real authenticated app shell", async function (t) {
  var fixture = await startFixture();
  t.after(function () { if (fixture.child.connected) fixture.child.send("close"); });

  await t.test("authenticated root chooses an ordinary project", async function () {
    var response = await requestRoot(fixture, "visitor");
    var html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, expectedRootBody("public-default"));
  });

  await t.test("saved Home state keeps its accessible preferred project context", async function () {
    var response = await requestRoot(fixture, "preferred");
    assert.match(await response.text(), expectedRootBody("preferred-private"));
  });

  await t.test("denied saved preference falls back to an accessible project", async function () {
    var response = await requestRoot(fixture, "denied");
    assert.match(await response.text(), expectedRootBody("public-default"));
  });

  await t.test("admin skips a preferred Mate and can use a private project", async function () {
    var response = await requestRoot(fixture, "admin", "admin-private");
    assert.match(await response.text(), expectedRootBody("admin-private"));
  });

  await t.test("only a Mate remaining falls back to the unbound app shell", async function () {
    var cleared = waitForChild(fixture.child, "clearedOrdinary");
    fixture.child.send("clear-ordinary");
    await cleared;
    var response = await requestRoot(fixture, "admin");
    var html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<body class="capsules-disabled">/);
    assert.doesNotMatch(html, /data-home-project-slug=/);
  });
}, { timeout: 20000 });
