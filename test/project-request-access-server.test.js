var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;
var WebSocket = require("ws");

function waitForMessage(socket, type) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("Timed out waiting for " + type)); }, 5000);
    socket.on("message", function receive(data) {
      var message = JSON.parse(data.toString());
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.removeListener("message", receive);
      resolve(message);
    });
  });
}

test("real project socket denies foreign routing and environment access while preserving allowed requests", { timeout: 20000 }, async function (t) {
  var child = fork(path.join(__dirname, "fixtures/project-request-access-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(function () { if (child.connected) child.send("close"); });
  var ready = await new Promise(function (resolve, reject) {
    child.once("message", resolve);
    child.once("error", reject);
  });
  var socket = new WebSocket("ws://127.0.0.1:" + ready.port + "/p/allowed/ws", {
    headers: { Cookie: "relay_auth_user=" + ready.token },
  });
  t.after(function () { socket.close(); });
  await waitForMessage(socket, "info");
  var denied = waitForMessage(socket, "error");
  socket.send(JSON.stringify({ type: "fs_list", path: ".", targetSlug: "forbidden" }));
  assert.match((await denied).text, /Project access is not permitted/);
  var allowed = waitForMessage(socket, "fs_list_result");
  socket.send(JSON.stringify({ type: "fs_list", path: "." }));
  assert.equal((await allowed).error, undefined);
  denied = waitForMessage(socket, "error");
  socket.send(JSON.stringify({ type: "get_project_env", slug: "forbidden" }));
  assert.match((await denied).text, /settings access is not permitted/);
  allowed = waitForMessage(socket, "project_env_result");
  socket.send(JSON.stringify({ type: "get_project_env", slug: "allowed" }));
  assert.equal((await allowed).envrc, "");
  var calls = new Promise(function (resolve) { child.once("message", resolve); });
  child.send("calls");
  assert.equal((await calls).envCalls, 0);
});
