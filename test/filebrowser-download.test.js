var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");
var { attachHTTP } = require("../lib/project-http");
var usersModule = require("../lib/users");

function createResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead: function (status, headers) {
      this.status = status;
      this.headers = headers || {};
    },
    end: function (body) {
      this.body = body;
    },
  };
}

function createHandler(allowedPath, filePath) {
  return attachHTTP({
    cwd: path.dirname(filePath),
    project: "Test",
    sm: { sessions: new Map() },
    osUsers: null,
    safePath: function (cwd, requestedPath) {
      return requestedPath === allowedPath ? filePath : null;
    },
    safeAbsPath: function () { return null; },
    getOsUserInfoForReq: function () { return null; },
    _browserTabList: {},
  }).handleHTTP;
}

function createRequest() {
  return { method: "GET", _clayUser: { role: "admin" } };
}

test("file browser download returns the selected file as an attachment", function () {
  var requestedPath = "docs/filebrowser-download.test.js";
  var handler = createHandler(requestedPath, __filename);
  var response = createResponse();

  var handled = handler(
    createRequest(),
    response,
    "/api/file/download?path=" + encodeURIComponent(requestedPath)
  );

  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "application/octet-stream");
  assert.match(response.headers["Content-Disposition"], /^attachment; filename="filebrowser-download\.test\.js"/);
  assert.deepEqual(response.body, fs.readFileSync(__filename));
});

test("file browser download rejects paths outside the project", function () {
  var handler = createHandler("allowed.txt", __filename);
  var response = createResponse();

  handler(createRequest(), response, "/api/file/download?path=..%2Fsecret.txt");

  assert.equal(response.status, 403);
  assert.equal(response.body, "Access denied");
});

test("file browser download enforces the file browser permission", function () {
  var originalIsMultiUser = usersModule.isMultiUser;
  usersModule.isMultiUser = function () { return true; };
  try {
    var handler = createHandler("allowed.txt", __filename);
    var response = createResponse();
    var request = { method: "GET", _clayUser: { role: "user", permissions: { fileBrowser: false } } };

    handler(request, response, "/api/file/download?path=allowed.txt");

    assert.equal(response.status, 403);
    assert.equal(response.body, "File browser access is not permitted");
  } finally {
    usersModule.isMultiUser = originalIsMultiUser;
  }
});

test("OS-user download and image handlers use fsAsUser and fail closed", function () {
  var calls = [];
  var identity = { uid: 4242, username: "mapped-user" };
  var user = { id: "member", role: "member" };
  var handler = attachHTTP({
    cwd: "/workspace/project", slug: "demo", project: "Demo", sm: { sessions: new Map() },
    osUsers: true,
    usersModule: { isMultiUser: function () { return true; }, getEffectivePermissions: function () { return { fileBrowser: true }; } },
    safePath: function () { return null; }, safeAbsPath: function () { return null; },
    getOsUserInfoForReq: function () { return identity; },
    fsAsUser: function (operation, args, actualIdentity) {
      calls.push({ operation: operation, args: args, identity: actualIdentity });
      return { buffer: Buffer.from("image-or-file") };
    }, _browserTabList: {}
  }).handleHTTP;
  var request = { method: "GET", _clayUser: user };
  var download = createResponse();
  handler(request, download, "/api/file/download?path=" + encodeURIComponent("../outside.txt"));
  var image = createResponse();
  handler(request, image, "/api/file?path=" + encodeURIComponent("/tmp/outside.png"));
  assert.equal(download.status, 200);
  assert.equal(image.status, 200);
  assert.deepEqual(calls.map(function (call) { return call.operation; }), ["read_binary", "read_binary"]);
  calls.forEach(function (call) { assert.equal(call.identity, identity); });

  var missingHandler = attachHTTP({
    cwd: "/workspace/project", slug: "demo", project: "Demo", sm: { sessions: new Map() },
    osUsers: true, usersModule: { isMultiUser: function () { return true; }, getEffectivePermissions: function () { return { fileBrowser: true }; } },
    safePath: function () { return null; }, getOsUserInfoForReq: function () { return null; }, _browserTabList: {}
  }).handleHTTP;
  var missing = createResponse();
  missingHandler(request, missing, "/api/file?path=photo.png");
  assert.equal(missing.status, 403);
  assert.equal(missing.body, "OS user identity unavailable");

  var deniedHandler = attachHTTP({
    cwd: "/workspace/project", slug: "demo", project: "Demo", sm: { sessions: new Map() },
    osUsers: true, usersModule: { isMultiUser: function () { return true; }, getEffectivePermissions: function () { return { fileBrowser: false }; } },
    safePath: function () { return null; }, getOsUserInfoForReq: function () { return identity; }, _browserTabList: {}
  }).handleHTTP;
  var denied = createResponse();
  deniedHandler(request, denied, "/api/file?path=photo.png");
  assert.equal(denied.status, 403);
  assert.equal(denied.body, "File browser access is not permitted");
});

test("file viewer exposes a download action for the open file", function () {
  var html = fs.readFileSync(path.join(__dirname, "../lib/public/index.html"), "utf8");
  var fileBrowser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var contextMenu = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser-context-menu.js"), "utf8");

  assert.match(html, /id="file-viewer-download"[^>]*title="Download file"/);
  assert.match(fileBrowser, /downloadProjectFile\(currentFilePath\)/);
  assert.match(contextMenu, /api\/file\/download\?path=/);
  assert.match(contextMenu, /encodeURIComponent\(filePath\)/);
});

test("file rows expose a right-click download context menu", function () {
  var fileBrowser = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser.js"), "utf8");
  var contextMenu = fs.readFileSync(path.join(__dirname, "../lib/public/modules/filebrowser-context-menu.js"), "utf8");

  assert.match(fileBrowser, /initFileBrowserContextMenu\(ctx\.fileTreeEl\)/);
  assert.match(fileBrowser, /row\.dataset\.entryType = entry\.type/);
  assert.match(contextMenu, /addEventListener\('contextmenu'/);
  assert.match(contextMenu, /row\.dataset\.entryType !== 'file'/);
  assert.match(contextMenu, /'Mention in chat'/);
  assert.match(contextMenu, /insertTextAtCursor\(filePath \+ ' '\)/);
  assert.match(contextMenu, /'Copy path'/);
  assert.match(contextMenu, /copyToClipboard\(filePath\)/);
  assert.match(contextMenu, /'Copy contents'/);
  assert.match(contextMenu, /MAX_COPY_CONTENT_BYTES/);
  assert.match(contextMenu, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(contextMenu, /'Download'/);
});
