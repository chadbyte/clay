var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

function publishedStableTag(version, tags, release) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return "";
  var tag = "v" + version;
  if (tags.indexOf(tag) === -1) return "";
  if (!release || release.tag_name !== tag || release.draft || release.prerelease || !release.published_at) {
    throw new Error("Stable docs require a published, non-prerelease GitHub release for " + tag);
  }
  return tag;
}

function main() {
  var root = path.resolve(__dirname, "../../..");
  var version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  var tags = childProcess.execFileSync("git", ["tag", "--points-at", "HEAD"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  if (!/^\d+\.\d+\.\d+$/.test(version) || tags.indexOf("v" + version) === -1) return;
  var release = JSON.parse(childProcess.execFileSync("gh", ["api", "repos/{owner}/{repo}/releases/tags/v" + version], { cwd: root, encoding: "utf8" }));
  process.stdout.write("tag=" + publishedStableTag(version, tags, release) + "\n");
}

module.exports = { publishedStableTag: publishedStableTag };
if (require.main === module) main();
