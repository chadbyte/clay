// github-star-count.js - Cached public star count for the fixed Clay repository.
//
// Server-wide and unauthenticated toward GitHub: one fixed public metadata
// URL, no credentials, no redirects, no user data. A fresh value is reused for
// an hour, concurrent callers share one request, failures back off, and the
// last successful count survives a failed refresh. Unknown stays null; a count
// is never invented.

var https = require("https");

var REPO = "chadbyte/clay";
var HOST = "api.github.com";
var PATH = "/repos/" + REPO;
var TTL_MS = 60 * 60 * 1000;
var TIMEOUT_MS = 5000;
var BACKOFF_BASE_MS = 60 * 1000;
var MAX_BODY_BYTES = 256 * 1024;

// Resolves { status, body } or rejects. Never follows redirects. `timeoutMs`
// is a wall-clock deadline for the whole exchange (DNS, TLS, headers, body),
// not socket inactivity, so a slow trickle cannot pin the request. `get` is
// injectable for tests.
function fetchRepoMetadata(timeoutMs, get) {
  get = get || https.get;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var req = null;
    var deadline = null;
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn(value);
    }
    function fail(err) {
      finish(reject, err);
      if (req) req.destroy();
    }
    deadline = setTimeout(function () { fail(new Error("timeout")); }, timeoutMs);
    try {
      req = get({
        host: HOST,
        path: PATH,
        method: "GET",
        headers: {
          "User-Agent": "clay-server",
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }, function (res) {
        var chunks = [];
        var size = 0;
        res.on("data", function (chunk) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            fail(new Error("response too large"));
            if (res.destroy) res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", function () {
          finish(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", fail);
        res.on("aborted", function () { fail(new Error("aborted")); });
      });
    } catch (err) {
      fail(err);
      return;
    }
    req.on("error", fail);
    if (settled) req.destroy();
  });
}

function parseStars(response) {
  if (!response || response.status !== 200) return null;
  var data;
  try { data = JSON.parse(response.body); } catch (e) { return null; }
  var n = data && data.stargazers_count;
  if (typeof n !== "number" || !isFinite(n) || n < 0 || Math.floor(n) !== n) return null;
  return n;
}

// opts (all optional, for tests): fetch(timeoutMs) -> Promise<{status, body}>,
// now() -> ms, ttlMs, timeoutMs, backoffBaseMs.
function createGithubStarCount(opts) {
  opts = opts || {};
  var fetchFn = opts.fetch || fetchRepoMetadata;
  var now = opts.now || Date.now;
  var ttlMs = opts.ttlMs || TTL_MS;
  var timeoutMs = opts.timeoutMs || TIMEOUT_MS;
  var backoffBaseMs = opts.backoffBaseMs || BACKOFF_BASE_MS;

  var stars = null;
  var fetchedAt = null;
  var failures = 0;
  var retryAt = 0;
  var inflight = null;

  function snapshot() {
    return { repo: REPO, stars: stars, fetchedAt: fetchedAt };
  }

  function refresh() {
    var started;
    try {
      started = Promise.resolve(fetchFn(timeoutMs));
    } catch (e) {
      started = Promise.reject(e);
    }
    return started.then(function (response) {
      var parsed = parseStars(response);
      if (parsed === null) throw new Error("unusable response");
      stars = parsed;
      fetchedAt = now();
      failures = 0;
      retryAt = 0;
    }).catch(function () {
      failures++;
      retryAt = now() + Math.min(backoffBaseMs * Math.pow(2, failures - 1), ttlMs);
    }).then(function () {
      inflight = null;
      return snapshot();
    });
  }

  function get() {
    if (stars !== null && fetchedAt !== null && now() - fetchedAt < ttlMs) return Promise.resolve(snapshot());
    if (inflight) return inflight;
    if (now() < retryAt) return Promise.resolve(snapshot());
    inflight = refresh();
    return inflight;
  }

  return { get: get };
}

module.exports = {
  createGithubStarCount: createGithubStarCount,
  parseStars: parseStars,
  fetchRepoMetadata: fetchRepoMetadata,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  REPO: REPO,
  TTL_MS: TTL_MS,
};
