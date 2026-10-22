var assert = require("node:assert/strict");

async function check() {
  var origin = process.env.PUBLIC_DOCS_ORIGIN;
  var channel = process.env.PUBLIC_DOCS_CHANNEL;
  assert.ok(origin && ["stable", "beta"].includes(channel), "Expected channel configuration");
  var routes = [["/", 200], ["/docs/getting-started", 200], ["/docs/deployment-check-missing", 404], ["/robots.txt", 200], ["/sitemap.xml", 200]];
  for (var route of routes) {
    var response = await fetch(origin + route[0], { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, route[1], route[0] + " status");
    var body = await response.text();
    if (route[0] === "/" || route[0] === "/docs/getting-started") {
      assert.ok(body.includes("Clay Studio"), "Expected manual page");
      assert.ok(body.includes(process.env.PUBLIC_DOCS_VERSION), "Expected build version");
      assert.equal(/<meta[^>]*name="robots"[^>]*content="noindex,nofollow"/.test(body), channel !== "stable", "Channel indexing policy");
      assert.ok(body.includes(origin), "Expected channel origin");
    }
    if (route[0] === "/robots.txt") assert.ok(body.includes(channel === "stable" ? "Allow: /" : "Disallow: /"));
    if (route[0] === "/sitemap.xml") assert.equal(body.includes("<loc>"), channel === "stable");
    console.log(route[0] + ": " + response.status);
  }
}

check().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
