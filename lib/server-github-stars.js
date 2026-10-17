// server-github-stars.js - GET /api/github-stars for the top-bar Star link.
//
// Read-only. Returns the cached public star count of the fixed Clay
// repository (null when not yet known). No request input reaches GitHub, and
// nothing about the caller is sent or stored.

var githubStarCount = require("./github-star-count");

function attachGithubStars(ctx) {
  var cache = ctx.cache || githubStarCount.createGithubStarCount();

  function json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  }

  function handleRequest(req, res, url) {
    if (url !== "/api/github-stars") return false;
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json", "Allow": "GET" });
      res.end(JSON.stringify({ error: "Method not allowed." }));
      return true;
    }
    if (!ctx.isRequestAuthed(req)) {
      json(res, 401, { error: "Sign in to continue." });
      return true;
    }
    cache.get().then(function (snapshot) {
      json(res, 200, snapshot);
    }, function () {
      json(res, 200, { repo: githubStarCount.REPO, stars: null, fetchedAt: null });
    });
    return true;
  }

  return { handleRequest: handleRequest };
}

module.exports = { attachGithubStars: attachGithubStars };
