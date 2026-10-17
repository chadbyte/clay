function attachPatterns(policy) {
  var STANDALONE = policy.STANDALONE, SUBCOMMAND = policy.SUBCOMMAND, EXACT = policy.EXACT;
  var STANDALONE_SET = {};
  STANDALONE.forEach(function(command) { STANDALONE_SET[command] = true; });
function buildClayBashAllowPatterns() {
  var patterns = [];
  for (var i = 0; i < STANDALONE.length; i++) {
    patterns.push("Bash(" + STANDALONE[i] + ")");
    patterns.push("Bash(" + STANDALONE[i] + " *)");
  }
  var bins = Object.keys(SUBCOMMAND);
  for (var b = 0; b < bins.length; b++) {
    var subs = SUBCOMMAND[bins[b]];
    for (var s = 0; s < subs.length; s++) {
      var base = bins[b] + " " + subs[s];
      patterns.push("Bash(" + base + ")");
      patterns.push("Bash(" + base + " *)");
    }
  }
  for (var e = 0; e < EXACT.length; e++) {
    patterns.push("Bash(" + EXACT[e] + ")");
    patterns.push("Bash(" + EXACT[e] + " *)");
  }
  return patterns;
}

var GENERATED_SET = {};
(function () {
  var p = buildClayBashAllowPatterns();
  for (var i = 0; i < p.length; i++) GENERATED_SET[p[i]] = true;
})();

// Recognize a `permissions.allow` entry that Clay owns, so the installer can
// strip stale variants on upgrade (including shapes a previous version wrote)
// WITHOUT clobbering user-authored patterns. Rules:
//   - Standalone commands: own every shape of `Bash(ls ...)` (any args), since
//     a user pattern for a command we manage is redundant with our broad one.
//   - Subcommand binaries (git, npm, ...) and exact commands: only strip the
//     precise patterns we generate, so a user's `Bash(git push)` survives.
// Legacy colon shapes are handled separately by the installer.
function isClayManagedBashPattern(p) {
  if (typeof p !== "string") return false;
  if (p.indexOf("Bash(") !== 0 || p.charAt(p.length - 1) !== ")") return false;
  if (GENERATED_SET[p]) return true;
  var inner = p.slice(5, -1).trim();
  if (!inner) return false;
  var word = inner.split(/[\s:]/)[0];
  return STANDALONE_SET[word] === true;
}

return { build: buildClayBashAllowPatterns, isManaged: isClayManagedBashPattern };
}
module.exports = { attachPatterns: attachPatterns };
