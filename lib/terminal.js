var pty;
try {
  pty = require("@lydell/node-pty");
} catch (e) {
  pty = null;
}

var { buildUserEnv } = require("./build-user-env");

/**
 * Spawn a PTY.
 *
 * opts (optional):
 *   - initialInput: string written to the PTY immediately after spawn.
 *     Used by TUI session mode to inject `claude --session-id <uuid>\n`
 *     so /exit drops back to the shell instead of killing the PTY.
 */
function createTerminal(cwd, cols, rows, osUserInfo, opts) {
  if (!pty) return null;

  // Determine shell: prefer target user's shell, then $SHELL, then platform default
  var shell = (osUserInfo && osUserInfo.shell)
    || process.env.SHELL
    || (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh");

  // Build a minimal, isolated environment (no daemon env leakage)
  var termEnv = buildUserEnv(osUserInfo);
  if (opts && opts.loginBrowserEnv) {
    termEnv.BROWSER = opts.loginBrowserEnv.BROWSER;
    termEnv.CLAY_LOGIN_URL_FILE = opts.loginBrowserEnv.CLAY_LOGIN_URL_FILE;
  }
  var spawnOpts = {
    name: "xterm-256color",
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd,
    env: termEnv,
  };

  if (osUserInfo) {
    spawnOpts.uid = osUserInfo.uid;
    spawnOpts.gid = osUserInfo.gid;
  }

  var args = osUserInfo ? ["-l"] : [];
  if (opts && opts.providerInstall) {
    var recipe = require('./yoke/vendor-registry').getVendorInfo(opts.providerInstall);
    recipe = recipe && recipe.installRecipe;
    var reason = require('./yoke/provider-install-recipes').eligible(recipe,osUserInfo);
    if (reason || typeof opts.revalidateInstall !== 'function') throw new Error(reason || 'Installation authority is missing.');
    opts.revalidateInstall();
    shell = '/bin/bash';
    args = ['--noprofile','--norc','-o','pipefail','-c',recipe.command];
    spawnOpts.cwd = osUserInfo.home;
    // Bash must not source daemon/user startup files; installers receive no keys.
    delete termEnv.NODE_OPTIONS;
  }
  if (opts && opts.githubLogin) {
    if (typeof opts.revalidateGithub !== "function") throw new Error('GitHub login authority is missing.');
    opts.revalidateGithub();
    shell = 'gh'; args = require('./project-github-connection').LOGIN_ARGS.slice();
    termEnv = require('./github-runtime').environment(osUserInfo);
    delete termEnv.GH_PROMPT_DISABLED;
    termEnv.GH_BROWSER = 'false'; termEnv.BROWSER = 'false';
    spawnOpts.env = termEnv; spawnOpts.cwd = termEnv.HOME;
  }
  // Route through setpriv when group inheritance is enabled so the terminal
  // gets the user's supplementary groups (docker, etc.), not just primary gid.
  var ptySpawn = require("./os-users").wrapSpawnAsUser(shell, args, spawnOpts);
  var term = pty.spawn(ptySpawn.command, ptySpawn.args, ptySpawn.options);

  if (opts && opts.initialInput && !opts.providerInstall && !opts.githubLogin) {
    try { term.write(opts.initialInput); } catch (e) {}
  }

  return term;
}

module.exports = { createTerminal: createTerminal };
