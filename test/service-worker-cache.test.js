var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var source = fs.readFileSync(path.join(__dirname, "../lib/public/sw.js"), "utf8");

function loadWorker() {
  var handlers = {};
  var puts = [];
  var deleted = [];
  var cache = {
    put: function (request, response) {
      puts.push({ request: request, response: response });
      return Promise.resolve();
    }
  };
  var context = {
    Promise: Promise,
    URL: URL,
    self: {
      location: { origin: "https://clay.test" },
      addEventListener: function (name, handler) { handlers[name] = handler; },
      skipWaiting: function () { return Promise.resolve(); },
      clients: { claim: function () { return Promise.resolve(); } }
    },
    caches: {
      keys: function () { return Promise.resolve(["clay-offline-v4", "clay-offline-v5"]); },
      delete: function (name) { deleted.push(name); return Promise.resolve(true); },
      open: function () { return Promise.resolve(cache); },
      match: function () { return Promise.resolve(undefined); }
    },
    fetch: function (request) { return Promise.resolve(request.response); },
    Response: function () {}
  };
  vm.runInNewContext(source, context);
  return { handlers: handlers, puts: puts, deleted: deleted, context: context };
}

function response(cacheControl) {
  return {
    ok: true,
    headers: { get: function () { return cacheControl; } },
    clone: function () { return this; }
  };
}

async function fetchThrough(worker, pathname, result) {
  var request = {
    method: "GET",
    url: "https://clay.test" + pathname,
    mode: "same-origin",
    response: result
  };
  var pending;
  worker.handlers.fetch({ request: request, respondWith: function (promise) { pending = promise; } });
  await pending;
}

test("service worker never caches personalized private/no-store shells", async function () {
  var worker = loadWorker();
  await fetchThrough(worker, "/", response("private, no-store"));
  assert.equal(worker.puts.length, 0);
});

test("service worker still caches public static assets and removes the old cache", async function () {
  var worker = loadWorker();
  await fetchThrough(worker, "/style.css", response("public, max-age=86400"));
  assert.equal(worker.puts.length, 1);
  worker.handlers.activate({ waitUntil: function (promise) { return promise; } });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(worker.deleted, ["clay-offline-v4"]);
});
