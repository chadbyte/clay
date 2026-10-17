var fs = require("fs"), path = require("path");
var execFileSync = require("child_process").execFileSync;
function attachProvisioning(ctx) {
  var isSafeLinuxUsername = ctx.isSafeLinuxUsername;
  var resolveOsUserInfo = ctx.resolveOsUserInfo;
function claudeAvailableForUser(linuxName) {
  if (!isSafeLinuxUsername(linuxName)) return false;
  try {
    var out = execFileSync("su", ["-", linuxName, "-c", "command -v claude"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: "pipe",
    }).trim();
    return out.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Install Claude CLI for a Linux user account.
 * Downloads and runs the install script, then ensures PATH is configured.
 * Non-fatal: logs errors but does not throw.
 * Skips entirely when claude is already resolvable for the user, or when
 * CLAY_SKIP_CLAUDE_INSTALL is set (bring-your-own-claude).
 */
function installClaudeCli(linuxName) {
  if (process.env.CLAY_SKIP_CLAUDE_INSTALL) {
    console.log("[os-users] CLAY_SKIP_CLAUDE_INSTALL set, skipping Claude CLI install for " + linuxName);
    return;
  }
  if (claudeAvailableForUser(linuxName)) {
    console.log("[os-users] Claude CLI already available for " + linuxName + ", skipping install");
    return;
  }
  try {
    if (!isSafeLinuxUsername(linuxName)) throw new Error("Invalid Linux username");
    // Download and run the Claude CLI install script as the target user
    execFileSync("su", ["-", linuxName, "-c", "curl -fsSL https://claude.ai/install.sh | bash"], {
      encoding: "utf8",
      timeout: 60000,
      stdio: "pipe",
    });
    console.log("[os-users] Claude CLI installed for " + linuxName);
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to install Claude CLI for " + linuxName + ": " + msg);
    return;
  }

  // Append PATH export to the user's shell config if not already present
  try {
    var userInfo = resolveOsUserInfo(linuxName);
    var home = userInfo.home || ("/home/" + linuxName);
    var rcPath = fs.existsSync(path.join(home, ".zshrc")) ? path.join(home, ".zshrc") : path.join(home, ".bashrc");
    var exportLine = 'export PATH="$HOME/.local/bin:$PATH"';
    var existing = "";
    try { existing = fs.readFileSync(rcPath, "utf8"); } catch (e2) {}
    if (existing.indexOf(exportLine) === -1) {
      var prefix = existing && !/\n$/.test(existing) ? "\n" : "";
      fs.appendFileSync(rcPath, prefix + exportLine + "\n", "utf8");
      try { fs.chownSync(rcPath, userInfo.uid, userInfo.gid); } catch (e3) {}
      console.log("[os-users] PATH export appended to " + rcPath + " for " + linuxName);
    } else {
      console.log("[os-users] PATH already configured in " + rcPath + " for " + linuxName);
    }
  } catch (e) {
    var rcMsg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to configure PATH for " + linuxName + ": " + rcMsg);
  }
}

return { available: claudeAvailableForUser, install: installClaudeCli };
}
module.exports = { attachProvisioning: attachProvisioning };
