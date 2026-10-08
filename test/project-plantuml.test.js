var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var EventEmitter = require("node:events");
var attachFileHTTP = require("../lib/project-file-http").attachFileHTTP;

function response() {
  var res = new EventEmitter();
  res.writeHead = function (status, headers) { res.status = status; res.headers = headers; };
  res.done = new Promise(function (resolve) { res.end = function (body) { res.body = body; resolve(); }; });
  return res;
}

function fixture(options) {
  options = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-plantuml-http-"));
  fs.writeFileSync(path.join(dir, "page.salt"), '{+\n[Continue]\n}');
  var calls = [];
  var handler = attachFileHTTP(Object.assign({ cwd: dir,
    requestAccess: { fileScope: function () { return { projectBound: true, identity: null }; } },
    renderPlantUml: function (source) { calls.push(source); return Promise.resolve('<svg><text>Continue</text></svg>'); },
  }, options)).handleHTTP;
  return { dir: dir, calls: calls, handler: handler, cleanup: function () { fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("file HTTP renders only an authorized PlantUML file with noncacheable isolated SVG", async function () {
  var f = fixture();
  try {
    var res = response();
    assert.equal(f.handler({ method: "GET" }, res, "/api/file/plantuml?path=page.salt"), true);
    await res.done;
    assert.equal(res.status, 200);
    assert.match(f.calls[0], /^@startsalt/);
    assert.match(res.headers["Content-Type"], /image\/svg\+xml/);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.match(res.headers["Content-Security-Policy"], /sandbox/);
  } finally { f.cleanup(); }
});

test("PlantUML endpoint refuses traversal, unrelated files, excessive source and unsupported methods", async function () {
  var f = fixture();
  fs.writeFileSync(path.join(f.dir, "large.puml"), "x".repeat(100001));
  fs.writeFileSync(path.join(f.dir, "notes.txt"), "notes");
  try {
    for (var entry of [["GET", "../outside.puml", 403], ["GET", "notes.txt", 415], ["GET", "large.puml", 413], ["POST", "page.salt", 405]]) {
      var res = response();
      f.handler({ method: entry[0] }, res, "/api/file/plantuml?path=" + encodeURIComponent(entry[1]));
      await res.done;
      assert.equal(res.status, entry[2]);
    }
    assert.equal(f.calls.length, 0);
  } finally { f.cleanup(); }
});

test("PlantUML authorization is checked before reading and again before returning output", async function () {
  var allowed = false;
  var f = fixture({ requestAccess: { fileScope: function () {
    if (!allowed) throw Object.assign(new Error("File browser access is not permitted"), { code: "FILE_FORBIDDEN" });
    return { projectBound: true, identity: null };
  } } });
  try {
    var denied = response();
    f.handler({ method: "GET" }, denied, "/api/file/plantuml?path=page.salt");
    await denied.done;
    assert.equal(denied.status, 403);
    assert.equal(f.calls.length, 0);
    allowed = true;
    var revoked = response();
    f.handler({ method: "GET" }, revoked, "/api/file/plantuml?path=page.salt");
    allowed = false;
    await revoked.done;
    assert.equal(revoked.status, 403);
    assert.doesNotMatch(revoked.body, /<svg/);
  } finally { f.cleanup(); }
});

test("PlantUML reads mapped files as the requesting OS identity", async function () {
  var identity = { uid: 4242 };
  var operations = [];
  var f = fixture({ requestAccess: { fileScope: function () { return { projectBound: false, identity: identity }; } },
    fsAsUser: function (operation, args, actual) {
      assert.equal(actual, identity);
      operations.push(operation);
      return operation === "stat" ? { size: 12 } : { content: '{ [Continue] }' };
    } });
  try {
    var res = response();
    f.handler({ method: "GET" }, res, "/api/file/plantuml?path=page.salt");
    await res.done;
    assert.equal(res.status, 200);
    assert.deepEqual(operations, ["stat", "read"]);
  } finally { f.cleanup(); }
});

test("PlantUML endpoint surfaces renderer errors and aborts disconnected requests", async function () {
  var f = fixture({ renderPlantUml: function () { return Promise.reject(Object.assign(new Error("Wireframe rendering failed"), { status: 422 })); } });
  try {
    var res = response();
    f.handler({ method: "GET" }, res, "/api/file/plantuml?path=page.salt");
    await res.done;
    assert.equal(res.status, 422);
    assert.match(res.body, /rendering failed/);
  } finally { f.cleanup(); }
  var signal;
  var resolve;
  f = fixture({ renderPlantUml: function (source, options) { signal = options.signal; return new Promise(function (done) { resolve = done; }); } });
  try {
    var gone = response();
    f.handler({ method: "GET" }, gone, "/api/file/plantuml?path=page.salt");
    gone.destroyed = true;
    gone.emit("close");
    assert.equal(signal.aborted, true);
    resolve("<svg></svg>");
    await new Promise(function (done) { setImmediate(done); });
    assert.equal(gone.status, undefined);
  } finally { f.cleanup(); }
});
