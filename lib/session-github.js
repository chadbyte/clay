// Verified GitHub references owned by a work session, never inferred from mentions.
var execFile = require("child_process").execFile;
var wrapSpawnAsUser = require("./os-users").wrapSpawnAsUser;

function parseReference(value) {
  var match = typeof value === "string" && value.match(/^https:\/\/github\.com\/([a-zA-Z0-9][a-zA-Z0-9-]{0,38})\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,99})\/(issues|pull)\/([1-9][0-9]*)(?:[?#].*)?$/);
  if (!match || !Number.isSafeInteger(Number(match[4]))) throw new Error("Use a GitHub issue or pull request URL.");
  return { repository: match[1] + "/" + match[2], kind: match[3] === "pull" ? "pr" : "issue", number: Number(match[4]), url: "https://github.com/" + match[1] + "/" + match[2] + "/" + match[3] + "/" + match[4] };
}
function runGh(cwd, args, identity) {
  return new Promise(function (resolve, reject) {
    var env = Object.assign({}, identity ? require("./build-user-env").buildUserEnv(identity) : process.env, { GH_PROMPT_DISABLED: "1", GH_HOST: "github.com" });
    if (identity) {
      // Never let the daemon's GitHub credentials cross an OS-user boundary.
      delete env.GH_TOKEN; delete env.GITHUB_TOKEN; delete env.GH_ENTERPRISE_TOKEN; delete env.GITHUB_ENTERPRISE_TOKEN;
      delete env.GH_CONFIG_DIR; delete env.XDG_CONFIG_HOME;
      env.HOME = identity.home; env.USER = identity.user; env.LOGNAME = identity.user;
    }
    var options = { cwd: cwd, env: env, timeout: 15000, maxBuffer: 512 * 1024, encoding: "utf8" };
    if (identity) { options.uid = identity.uid; options.gid = identity.gid; }
    var wrapped = wrapSpawnAsUser("gh", args, options);
    execFile(wrapped.command, wrapped.args, wrapped.options, function (error, stdout) {
      if (error) return reject(new Error("GitHub is unavailable. Check gh authentication and repository access."));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error("GitHub returned an invalid response.")); }
    });
  });
}
async function readReference(cwd, url, identity, run) {
  var ref = parseReference(url);
  var fields = "title,state,url" + (ref.kind === "pr" ? ",isDraft,headRefName,reviewDecision,statusCheckRollup" : "");
  var data = await (run || runGh)(cwd, [ref.kind === "pr" ? "pr" : "issue", "view", String(ref.number), "--repo", ref.repository, "--json", fields], identity);
  var verified = parseReference(data.url);
  if (verified.url.toLowerCase() !== ref.url.toLowerCase()) throw new Error("GitHub returned a different reference.");
  ref.title = String(data.title || "").slice(0, 200);
  ref.state = data.state === "MERGED" ? "merged" : data.state === "CLOSED" ? "closed" : data.state === "OPEN" ? (data.isDraft ? "draft" : "open") : "unknown";
  ref.checkedAt = Date.now();
  if (ref.kind === "pr") {
    ref.branch = String(data.headRefName || "").slice(0, 200);
    ref.review = ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].indexOf(data.reviewDecision) >= 0 ? data.reviewDecision : "";
    ref.checks = (data.statusCheckRollup || []).slice(0, 30).map(function (check) {
      var target = check.detailsUrl || check.targetUrl || "";
      if (!/^https:\/\//i.test(target)) target = "";
      return { name: String(check.name || check.context || "Check").slice(0, 100), state: String(check.conclusion || check.state || check.status || "PENDING").slice(0, 40), url: target };
    });
  }
  return ref;
}
module.exports = { parseReference: parseReference, readReference: readReference };
