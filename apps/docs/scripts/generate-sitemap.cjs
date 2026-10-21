var fs = require("node:fs");
var path = require("node:path");
var catalog = require("../lib/catalog.cjs");
var siteConfig = require("../lib/site-config.cjs");

function escapeXml(value) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function buildArtifacts(env) {
  var origin = siteConfig.getSiteConfig(env === undefined ? process.env : env).publicOrigin;
  var urls = origin ? ["/"] .concat(catalog.documents.filter(function (document) { return !document.legacy; }).map(function (document) { return "/docs/" + document.slug; })) : [];
  var locs = urls.map(function (url) { return "  <url><loc>" + escapeXml(origin + url) + "</loc></url>"; });
  return { sitemap: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" + locs.join("\n") + "\n</urlset>\n", robots: origin ? "User-agent: *\nAllow: /\n\nSitemap: " + origin + "/sitemap.xml\n" : "User-agent: *\nDisallow: /\n" };
}

function writeArtifacts() {
  var artifacts = buildArtifacts();
  fs.writeFileSync(path.join(__dirname, "../public/sitemap.xml"), artifacts.sitemap);
  fs.writeFileSync(path.join(__dirname, "../public/robots.txt"), artifacts.robots);
  fs.writeFileSync(path.join(__dirname, "../lib/site-config.generated.cjs"), "module.exports = " + JSON.stringify(siteConfig.getSiteConfig(process.env)) + ";\n");
}

if (require.main === module) writeArtifacts();
module.exports = { buildArtifacts: buildArtifacts, writeArtifacts: writeArtifacts };
