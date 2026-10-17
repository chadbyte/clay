// Kiro ACP Server Profile
// -----------------------
// Supplies Kiro's executable discovery, command arguments, and auth-error
// translation to the shared ACP process manager.

var path = require("path");
var fs = require("fs");
var { AcpProcessManager } = require("./acp-process-manager");

function findKiroPath() {
  var discovery = require("./discovery");
  var explicit = discovery.explicitEntry(process.env, "KIRO_CLI_PATH", false);
  if (explicit !== undefined) return explicit;

  var binName = process.platform === "win32" ? "kiro-cli.exe" : "kiro-cli";
  var realHome;
  try { realHome = require("../config").REAL_HOME; } catch (e) { realHome = require("os").homedir(); }

  var candidates = [
    path.join(realHome || "", ".local", "bin", binName),
    path.join(realHome || "", "bin", binName),
    "/usr/local/bin/" + binName,
    "/opt/homebrew/bin/" + binName,
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (discovery.validEntry(candidates[i], false)) return candidates[i];
  }

  try {
    var execFileSync = require("child_process").execFileSync;
    var out = process.platform === "win32"
      ? execFileSync("where", [binName], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      : execFileSync("which", ["kiro-cli"], { timeout: 3000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    var resolved = out.trim().split(/\r?\n/)[0];
    if (discovery.validEntry(resolved, false)) return resolved;
  } catch (e) {}

  throw new Error("Could not find kiro-cli binary (looked in ~/.local/bin, PATH, KIRO_CLI_PATH)");
}

function KiroAcpServer(executablePath, opts) {
  var kiroOpts = opts || {};
  var args = ["acp"];
  if (kiroOpts.extraArgs && kiroOpts.extraArgs.length) args = args.concat(kiroOpts.extraArgs);

  AcpProcessManager.call(this, executablePath || findKiroPath(), {
    args: args,
    cwd: kiroOpts.cwd,
    env: kiroOpts.env,
    logPrefix: "kiro-acp-server",
    logStderr: false,
    onStderrLine: function(line, manager) {
      if (line.trim()) console.log("[kiro-acp-server stderr]", line);
      manager._maybeSignalAuthError(line);
    },
  });
  this._authSignalSent = false;
}

KiroAcpServer.prototype = Object.create(AcpProcessManager.prototype);
KiroAcpServer.prototype.constructor = KiroAcpServer;

KiroAcpServer.prototype._maybeSignalAuthError = function(line) {
  if (!this.handlers.length || !line || this._authSignalSent) return;
  var isAuth = /not logged in|expired token|token has expired|please (?:sign in|log ?in) again|reauthenticate|kiro-cli login|no valid credentials|forbidden/i.test(line)
    || (/\b401\b/.test(line) && /unauthorized|credential|token/i.test(line));
  if (!isAuth) return;

  this._authSignalSent = true;
  var self = this;
  var dedupeTimer = setTimeout(function() { self._authSignalSent = false; }, 15000);
  if (dedupeTimer && typeof dedupeTimer.unref === "function") dedupeTimer.unref();
  this._handleMessage({
    method: "_kiro/error",
    params: { error: { kiroErrorInfo: "unauthorized", message: line } },
  });
};

module.exports = {
  KiroAcpServer: KiroAcpServer,
  findKiroPath: findKiroPath,
};
