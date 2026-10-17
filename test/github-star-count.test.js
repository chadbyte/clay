var test = require("node:test");
var assert = require("node:assert/strict");
var http = require("node:http");

var cacheModule = require("../lib/github-star-count");
var attachGithubStars = require("../lib/server-github-stars").attachGithubStars;

function clock(start) {
  var t = start || 1000000;
  return { now: function () { return t; }, advance: function (ms) { t += ms; } };
}

function ok(n) { return { status: 200, body: JSON.stringify({ stargazers_count: n }) }; }

test("first call fetches once and later calls inside the TTL reuse it", async function () {
  var c = clock(); var calls = 0;
  var cache = cacheModule.createGithubStarCount({ now: c.now, fetch: function () { calls++; return Promise.resolve(ok(42)); } });
  var a = await cache.get();
  c.advance(59 * 60 * 1000);
  var b = await cache.get();
  assert.equal(calls, 1);
  assert.equal(a.stars, 42);
  assert.equal(b.stars, 42);
  assert.equal(a.repo, "chadbyte/clay");
});

test("refreshes after one hour", async function () {
  var c = clock(); var n = 0;
  var cache = cacheModule.createGithubStarCount({ now: c.now, fetch: function () { n++; return Promise.resolve(ok(n)); } });
  await cache.get();
  c.advance(60 * 60 * 1000);
  assert.equal((await cache.get()).stars, 2);
});

test("concurrent callers share one in-flight request", async function () {
  var calls = 0; var release;
  var cache = cacheModule.createGithubStarCount({ fetch: function () { calls++; return new Promise(function (r) { release = function () { r(ok(7)); }; }); } });
  var p = [cache.get(), cache.get(), cache.get()];
  release();
  var res = await Promise.all(p);
  assert.equal(calls, 1);
  assert.deepEqual(res.map(function (r) { return r.stars; }), [7, 7, 7]);
});

test("unknown stays null on failure and is never fabricated", async function () {
  var cache = cacheModule.createGithubStarCount({ fetch: function () { return Promise.reject(new Error("down")); } });
  var r = await cache.get();
  assert.equal(r.stars, null);
  assert.equal(r.fetchedAt, null);
});

test("rejects non-200, malformed and invalid counts", async function () {
  var bodies = [{ status: 403, body: "{}" }, { status: 200, body: "nope" }, { status: 200, body: '{"stargazers_count":-1}' },
    { status: 200, body: '{"stargazers_count":"5"}' }, { status: 200, body: '{"stargazers_count":1.5}' }, { status: 200, body: "{}" }];
  for (var i = 0; i < bodies.length; i++) {
    var b = bodies[i];
    var cache = cacheModule.createGithubStarCount({ fetch: function () { return Promise.resolve(b); } });
    assert.equal((await cache.get()).stars, null);
  }
});

test("failure backs off exponentially and keeps the last success", async function () {
  var c = clock(); var calls = 0; var fail = false;
  var cache = cacheModule.createGithubStarCount({ now: c.now, fetch: function () {
    calls++; return fail ? Promise.reject(new Error("x")) : Promise.resolve(ok(10));
  } });
  await cache.get();
  fail = true;
  c.advance(60 * 60 * 1000);
  var r1 = await cache.get();           // fails, backoff 60s
  assert.equal(r1.stars, 10);
  assert.equal(calls, 2);
  c.advance(30 * 1000);
  await cache.get();                    // inside backoff, no request
  assert.equal(calls, 2);
  c.advance(31 * 1000);
  await cache.get();                    // second failure, backoff 120s
  assert.equal(calls, 3);
  c.advance(119 * 1000);
  await cache.get();
  assert.equal(calls, 3);
  c.advance(2 * 1000);
  fail = false;
  var r = await cache.get();
  assert.equal(calls, 4);
  assert.equal(r.stars, 10);
});

test("a synchronous throw from the fetcher is a failure, not a crash", async function () {
  var cache = cacheModule.createGithubStarCount({ fetch: function () { throw new Error("boom"); } });
  assert.equal((await cache.get()).stars, null);
});

var EventEmitter = require("node:events");

function fakeGet(script) {
  var state = { opts: null, reqDestroyed: false, resDestroyed: false, req: null, res: null };
  function get(opts, cb) {
    state.opts = opts;
    var req = new EventEmitter();
    req.destroy = function () { state.reqDestroyed = true; };
    state.req = req;
    var res = new EventEmitter();
    res.statusCode = 200;
    res.destroy = function () { state.resDestroyed = true; };
    state.res = res;
    script(req, res, cb);
    return req;
  }
  return { get: get, state: state };
}

test("transport: targets only the fixed public repo URL without credentials", async function () {
  var f = fakeGet(function (req, res, cb) { cb(res); res.emit("data", Buffer.from('{"stargazers_count":3}')); res.emit("end"); });
  var r = await cacheModule.fetchRepoMetadata(1000, f.get);
  assert.equal(r.status, 200);
  assert.equal(f.state.opts.host, "api.github.com");
  assert.equal(f.state.opts.path, "/repos/chadbyte/clay");
  assert.equal(f.state.opts.headers.Authorization, undefined);
  assert.equal(cacheModule.parseStars(r), 3);
});

test("transport: wall-clock deadline fires even when no socket event arrives, and destroys the request", async function () {
  var f = fakeGet(function () { /* hangs: DNS/TLS stall */ });
  var started = Date.now();
  await assert.rejects(cacheModule.fetchRepoMetadata(40, f.get), /timeout/);
  assert.ok(Date.now() - started < 1000);
  assert.equal(f.state.reqDestroyed, true);
});

test("transport: a slow trickle cannot outlive the total deadline", async function () {
  var f = fakeGet(function (req, res, cb) {
    cb(res);
    var iv = setInterval(function () { res.emit("data", Buffer.from(" ")); }, 5);
    res.on("end", function () { clearInterval(iv); });
    setTimeout(function () { clearInterval(iv); }, 500);
  });
  await assert.rejects(cacheModule.fetchRepoMetadata(60, f.get), /timeout/);
  assert.equal(f.state.reqDestroyed, true);
});

test("transport: oversized body is rejected and both streams destroyed", async function () {
  var f = fakeGet(function (req, res, cb) { cb(res); res.emit("data", Buffer.alloc(cacheModule.MAX_BODY_BYTES + 1)); });
  await assert.rejects(cacheModule.fetchRepoMetadata(1000, f.get), /too large/);
  assert.equal(f.state.reqDestroyed, true);
  assert.equal(f.state.resDestroyed, true);
});

test("transport: request error, response error, abort and synchronous throw all reject", async function () {
  var cases = [
    function (req) { setImmediate(function () { req.emit("error", new Error("ECONNRESET")); }); },
    function (req, res, cb) { cb(res); res.emit("error", new Error("bad")); },
    function (req, res, cb) { cb(res); res.emit("aborted"); },
  ];
  for (var i = 0; i < cases.length; i++) {
    await assert.rejects(cacheModule.fetchRepoMetadata(1000, fakeGet(cases[i]).get));
  }
  await assert.rejects(cacheModule.fetchRepoMetadata(1000, function () { throw new Error("sync"); }), /sync/);
});

test("transport: a late event after settle is ignored and a hung request frees the cache inflight slot", async function () {
  var f = fakeGet(function () {});
  var cache = cacheModule.createGithubStarCount({ timeoutMs: 30, fetch: function (ms) { return cacheModule.fetchRepoMetadata(ms, f.get); } });
  var r = await cache.get();
  assert.equal(r.stars, null);
  f.state.req.emit("error", new Error("late"));
});

function request(server, method, path) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ port: server.address().port, host: "127.0.0.1", method: method, path: path }, function (res) {
      var d = ""; res.on("data", function (c) { d += c; });
      res.on("end", function () { resolve({ status: res.statusCode, body: d, headers: res.headers }); });
    });
    req.on("error", reject); req.end();
  });
}

test("route: authenticated GET returns the cached snapshot, others are refused", async function () {
  var authed = true;
  var svc = attachGithubStars({ isRequestAuthed: function () { return authed; },
    cache: { get: function () { return Promise.resolve({ repo: "chadbyte/clay", stars: 5, fetchedAt: 1 }); } } });
  var server = http.createServer(function (req, res) { if (!svc.handleRequest(req, res, req.url)) { res.writeHead(404); res.end(); } });
  await new Promise(function (r) { server.listen(0, "127.0.0.1", r); });
  try {
    var g = await request(server, "GET", "/api/github-stars");
    assert.equal(g.status, 200);
    assert.equal(JSON.parse(g.body).stars, 5);
    assert.equal(g.headers["cache-control"], "no-store");
    assert.equal((await request(server, "POST", "/api/github-stars")).status, 405);
    assert.equal((await request(server, "GET", "/api/github-stars?x=1")).status, 404);
    authed = false;
    assert.equal((await request(server, "GET", "/api/github-stars")).status, 401);
  } finally { server.close(); }
});

test("route: unknown count is returned as null", async function () {
  var svc = attachGithubStars({ isRequestAuthed: function () { return true; },
    cache: { get: function () { return Promise.resolve({ repo: "chadbyte/clay", stars: null, fetchedAt: null }); } } });
  var server = http.createServer(function (req, res) { svc.handleRequest(req, res, req.url); });
  await new Promise(function (r) { server.listen(0, "127.0.0.1", r); });
  try { assert.equal(JSON.parse((await request(server, "GET", "/api/github-stars")).body).stars, null); }
  finally { server.close(); }
});
