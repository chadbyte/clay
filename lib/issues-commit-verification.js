// Server-side verification of Git commits used as Issue evidence.

var gitCli = require("./git-cli");

function verifyCommit(cwd, sha, knowledgeIdentity, osUserInfo) {
  if (typeof sha !== "string" || !/^[0-9a-fA-F]{7,64}$/.test(sha)) {
    return Promise.reject(new Error("A Git commit SHA must contain 7 to 64 hexadecimal characters."));
  }
  if (!cwd || !knowledgeIdentity) return Promise.reject(new Error("A repository identity is required for commit verification."));
  var lower = sha.toLowerCase();
  return gitCli.runGit(cwd, ["rev-parse", "--verify", lower + "^{commit}"], 5000, osUserInfo).then(function (output) {
    var resolved = String(output).trim().toLowerCase();
    if (!/^[0-9a-f]{40,64}$/.test(resolved)) throw new Error("Git did not return a canonical commit SHA.");
    return gitCli.runGit(cwd, ["show", "-s", "--format=%s", resolved], 5000, osUserInfo).then(function (subjectOutput) {
      return { sha: resolved, subject: String(subjectOutput).trim().substring(0, 400), verifiedAt: Date.now(), repository: knowledgeIdentity };
    });
  });
}

function injectedVerifier(fn) {
  if (typeof fn !== "function") return verifyCommit;
  return function (cwd, sha, identity, osUserInfo) {
    return Promise.resolve(fn(cwd, sha, identity, osUserInfo));
  };
}

module.exports = {
  verifyCommit: verifyCommit,
  injectedVerifier: injectedVerifier,
};
