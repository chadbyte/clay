var fs = require("fs");
function resolveClaudeBinaryPath() {
  // 1. Explicit env var override
  var discovery = require("../discovery");
  var explicit = discovery.explicitEntry(process.env, "CLAUDE_CODE_PATH", true);
  if (explicit !== undefined) return explicit;

  // 2. `which claude` in the daemon's PATH
  try {
    var result = require("child_process").execSync("which claude", { encoding: "utf8", timeout: 5000 }).trim();
    if (discovery.validEntry(result, false)) return result;
  } catch (e) {}

  // 3. Common per-user and system locations (best-effort fallback for the daemon user)
  var home = process.env.HOME || "";
  var candidates = [];
  if (home) {
    candidates.push(home + "/.npm-global/bin/claude");
    candidates.push(home + "/.local/bin/claude");
    candidates.push(home + "/.volta/bin/claude");
    candidates.push(home + "/.bun/bin/claude");
    candidates.push(home + "/bin/claude");
  }
  candidates.push("/usr/local/bin/claude");
  candidates.push("/usr/bin/claude");
  candidates.push("/opt/homebrew/bin/claude");
  for (var i = 0; i < candidates.length; i++) {
    try { if (discovery.validEntry(candidates[i], false)) return candidates[i]; } catch (e) {}
  }

  // 4. Bundled CLI entry from the SDK's peer
  try {
    var resolved = require.resolve("@anthropic-ai/claude-code/cli.js");
    if (discovery.validEntry(resolved, true)) return resolved;
  } catch (e) {}

  return null;
}

module.exports = { resolve: resolveClaudeBinaryPath };
