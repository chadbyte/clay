var test = require("node:test");
var assert = require("node:assert/strict");
var modulePromise = import("../lib/github-stars.js");

function response(count) {
  return { ok: true, json: async function () { return { full_name: "chadbyte/clay", stargazers_count: count }; } };
}

test("accepts real counts including zero and rejects malformed or foreign data", async function () {
  var api = await modulePromise;
  assert.equal(api.readStarCount({ full_name: "chadbyte/clay", stargazers_count: 0 }), 0);
  assert.equal(api.readStarCount({ full_name: "chadbyte/clay", stargazers_count: 404 }), 404);
  for (var count of [-1, 1.2, "404", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(api.readStarCount({ full_name: "chadbyte/clay", stargazers_count: count }), null);
  }
  assert.equal(api.readStarCount({ full_name: "another/repo", stargazers_count: 404 }), null);
  for (var data of [{}, null, undefined, false, 0, "", [], "error"]) assert.equal(api.readStarCount(data), null);
});

test("deduplicates concurrent requests and caches success for ten minutes", async function () {
  var api = await modulePromise;
  var calls = 0;
  var time = 100;
  var load = api.createStarLoader({ now: function () { return time; }, fetch: async function (url, options) {
    calls++;
    assert.equal(url, api.STARS_API_URL);
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    return response(0);
  } });
  var first = load();
  assert.equal(load(), first);
  assert.equal(await first, 0);
  time += 599999;
  assert.equal(await load(), 0);
  assert.equal(calls, 1);
  time++;
  assert.equal(await load(), 0);
  assert.equal(calls, 2);
});

test("HTTP, network, JSON and schema failures return no count and suppress retry storms", async function () {
  var api = await modulePromise;
  var failures = [
    async function () { return { ok: false, json: function () { throw new Error("must not parse"); } }; },
    async function () { throw new Error("offline"); },
    async function () { return { ok: true, json: async function () { throw new Error("bad JSON"); } }; },
    async function () { return response("404"); }
  ];
  for (var failure of failures) {
    var calls = 0;
    var time = 1;
    var load = api.createStarLoader({ now: function () { return time; }, fetch: function () { calls++; return failure(); } });
    assert.equal(await load(), null);
    assert.equal(await load(), null);
    assert.equal(calls, 1);
    time += 60000;
    assert.equal(await load(), null);
    assert.equal(calls, 2);
  }
});

test("a timed-out request aborts and cannot overwrite a later result", async function () {
  var api = await modulePromise;
  var time = 1;
  var resolveFirst;
  var signal;
  var calls = 0;
  var load = api.createStarLoader({ timeoutMs: 10, now: function () { return time; }, fetch: function (url, options) {
    calls++;
    if (calls > 1) return Promise.resolve(response(12));
    signal = options.signal;
    return new Promise(function (resolve) { resolveFirst = resolve; });
  } });
  assert.equal(await load(), null);
  assert.equal(signal.aborted, true);
  time += 60000;
  assert.equal(await load(), 12);
  resolveFirst(response(999));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.equal(await load(), 12);
});

test("failed refresh removes an expired count rather than reporting a false fresh count", async function () {
  var api = await modulePromise;
  var time = 1;
  var calls = 0;
  var load = api.createStarLoader({ now: function () { return time; }, fetch: async function () { return ++calls === 1 ? response(25) : response(null); } });
  assert.equal(await load(), 25);
  time += 600000;
  assert.equal(await load(), null);
});
