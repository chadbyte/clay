// Best-effort, read-only diagnostics for the current OS-user compatibility mode.

var fs = require("fs");
var childProcess = require("child_process");
var path = require("path");
var execFileSync = childProcess.execFileSync;
var osUsers = require("./os-users");

function commandAvailable(command, execFile) {
  try {
    execFile(command, ["--help"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

function credentialPaths(home) {
  if (!home) return [];
  return require("./yoke/maintenance").credentialPaths(home).concat([
    home + "/.config/gh",
    home + "/.config/gcloud",
  ]);
}

function accessStatus(checks) {
  var names = ["read", "traverse", "write"];
  for (var i = 0; i < names.length; i++) {
    if (!checks[names[i]] || checks[names[i]].status === "unknown") return "unknown";
  }
  for (var j = 0; j < names.length; j++) {
    if (checks[names[j]].status === "deny") return "deny";
  }
  return "allow";
}

function unknownChecks() {
  return {
    read: { status: "unknown" },
    traverse: { status: "unknown" },
    write: { status: "unknown" },
  };
}

function projectAccessScript(projectPath) {
  return [
    "var fs = require('fs');",
    "var target = " + JSON.stringify(projectPath) + ";",
    "var checks = {};",
    "function check(name, mode) {",
    "  try { fs.accessSync(target, mode); checks[name] = { status: 'allow' }; }",
    "  catch (error) { checks[name] = { status: 'deny', code: String(error && error.code || 'EACCES') }; }",
    "}",
    "check('read', fs.constants.R_OK);",
    "check('traverse', fs.constants.X_OK);",
    "check('write', fs.constants.W_OK);",
    "process.stdout.write(JSON.stringify(checks));",
  ].join(" ");
}

/**
 * Check directory access as the mapped identity without creating or changing
 * any file. The spawn wrapper intentionally follows the runtime's current
 * supplementary-group behavior, including its setpriv fallback.
 */
function probeMappedProjectAccess(project, user, options) {
  options = options || {};
  var result = {
    projectSlug: project && project.slug || null,
    userId: user && user.id || null,
    result: "unknown",
    checks: unknownChecks(),
  };
  if (!project || !project.path) {
    result.evidence = "project_path_unavailable";
    return result;
  }
  if (!user || !user.linuxUser) {
    result.evidence = "linux_mapping_missing";
    return result;
  }

  var resolveUser = options.resolveUser || osUsers.resolveOsUserInfo;
  var wrapSpawn = options.wrapSpawn || osUsers.wrapSpawnAsUser;
  var execFile = options.execFile || execFileSync;
  var nodePath = options.nodePath || process.execPath;
  var account;
  try {
    account = resolveUser(user.linuxUser);
  } catch (e) {
    result.evidence = "linux_account_unavailable";
    return result;
  }
  if (!account || account.uid == null || account.gid == null) {
    result.evidence = "linux_account_invalid";
    return result;
  }

  try {
    var spawn = wrapSpawn(nodePath, ["-e", projectAccessScript(project.path)], {
      encoding: "utf8",
      timeout: 5000,
      stdio: "pipe",
      uid: account.uid,
      gid: account.gid,
    }, options.setprivCheck);
    var output = execFile(spawn.command, spawn.args, spawn.options);
    var checks = JSON.parse(String(output).trim());
    if (!checks || typeof checks !== "object") throw new Error("Invalid access probe result");
    result.checks = checks;
    result.result = accessStatus(checks);
    result.evidence = "mapped_identity_access";
  } catch (e) {
    result.evidence = "probe_unavailable";
  }
  return result;
}

function collectUserDiagnostics(user, options) {
  options = options || {};
  var resolveUser = options.resolveUser || osUsers.resolveOsUserInfo;
  var exists = options.exists || fs.existsSync;
  var execFile = options.execFile || execFileSync;
  var result = {
    userId: user && user.id || null,
    linuxUser: user && user.linuxUser || null,
    mapping: "missing",
    account: "unknown",
    supplementaryGroups: "unknown",
    credentialPaths: [],
  };
  if (!user || !user.linuxUser) return result;

  var account;
  try {
    account = resolveUser(user.linuxUser);
    result.mapping = "resolved";
    result.account = "present";
  } catch (e) {
    result.mapping = "unavailable";
    result.account = "missing";
    result.evidence = "linux_account_unavailable";
    return result;
  }

  try {
    var output = execFile("id", ["-Gn", user.linuxUser], { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    result.supplementaryGroups = output.trim() ? output.trim().split(/\s+/) : [];
  } catch (e) {
    result.supplementaryGroups = "unknown";
  }
  var paths = credentialPaths(account.home);
  for (var i = 0; i < paths.length; i++) {
    var present = "unknown";
    try { present = !!exists(paths[i]); } catch (e) {}
    result.credentialPaths.push({ path: paths[i], present: present });
  }
  return result;
}

function collectOsUserDiagnostics(options) {
  options = options || {};
  var users = options.users || [];
  var projects = options.projects || [];
  var probeProjectAccess = options.probeProjectAccess || probeMappedProjectAccess;
  var execFile = options.execFile || execFileSync;
  var result = {
    collectedAt: Date.now(),
    setprivAvailable: commandAvailable("setpriv", execFile),
    users: [],
    projectAccess: [],
  };
  for (var i = 0; i < users.length; i++) {
    try {
      result.users.push(collectUserDiagnostics(users[i], options));
    } catch (e) {
      result.users.push({
        userId: users[i] && users[i].id || null,
        linuxUser: users[i] && users[i].linuxUser || null,
        mapping: "unknown",
        account: "unknown",
        supplementaryGroups: "unknown",
        credentialPaths: [],
      });
    }
  }
  for (var pi = 0; pi < projects.length; pi++) {
    var project = projects[pi];
    for (var ui = 0; ui < users.length; ui++) {
      var user = users[ui];
      if (!project || !user) continue;
      var probe;
      try {
        probe = probeProjectAccess(project, user, options);
        if (!probe || typeof probe !== "object") probe = { result: "unknown", evidence: "invalid_probe_result" };
      } catch (e) {
        probe = { result: "unknown", evidence: "probe_failed" };
      }
      if (!probe.projectSlug) probe.projectSlug = project.slug || null;
      if (!probe.userId) probe.userId = user.id || null;
      if (!probe.result) probe.result = "unknown";
      result.projectAccess.push(probe);
    }
  }
  return result;
}

function summarizeDiagnostics(result) {
  var users = result.users || [];
  var projectAccess = result.projectAccess || [];
  var unavailableMappings = 0;
  var unknownProbes = 0;
  for (var i = 0; i < users.length; i++) {
    if (users[i].mapping !== "resolved") unavailableMappings++;
  }
  for (var j = 0; j < projectAccess.length; j++) {
    if (projectAccess[j].result === "unknown") unknownProbes++;
  }
  return "OS-user diagnostics: " + users.length + " user mappings, " + unavailableMappings + " unavailable, " + projectAccess.length + " project probes, " + unknownProbes + " unavailable";
}

function diagnosticsPayload(options) {
  var users = typeof options.getUsers === "function" ? options.getUsers() : options.users || [];
  var projects = typeof options.getProjects === "function" ? options.getProjects() : options.projects || [];
  return {
    users: users.map(function(user) {
      return { id: user && user.id || null, linuxUser: user && user.linuxUser || null };
    }),
    projects: projects.map(function(project) {
      return { slug: project && project.slug || null, path: project && project.path || null };
    }),
  };
}

function logDiagnosticMessage(logger, level, message) {
  try {
    if (logger && typeof logger[level] === "function") logger[level]("[daemon] " + message);
  } catch (e) {}
}

/**
 * Run blocking host probes in a short-lived child so diagnostics cannot stall
 * the daemon event loop after it starts serving requests.
 */
function scheduleOsUserDiagnosticsAsync(options) {
  options = options || {};
  var schedule = options.schedule || setTimeout;
  var clearSchedule = options.clearSchedule || clearTimeout;
  var spawn = options.spawn || childProcess.spawn;
  var logger = options.logger || console;
  var timeoutMs = options.timeoutMs || 30000;
  try {
    schedule(function() {
      var child;
      var timeout;
      var output = "";
      var completed = false;
      function finish(level, message) {
        if (completed) return;
        completed = true;
        if (timeout) clearSchedule(timeout);
        logDiagnosticMessage(logger, level, message);
      }
      try {
        child = spawn(options.nodePath || process.execPath, [path.join(__dirname, "os-user-diagnostics-worker.js")], {
          stdio: ["pipe", "pipe", "ignore"],
        });
        if (!child || !child.stdin || !child.stdout || typeof child.once !== "function") {
          finish("warn", "OS-user diagnostics unavailable");
          return;
        }
        child.stdout.on("data", function(chunk) { output += String(chunk); });
        child.once("error", function() { finish("warn", "OS-user diagnostics unavailable"); });
        child.once("close", function(code) {
          if (completed) return;
          if (code !== 0) {
            finish("warn", "OS-user diagnostics unavailable");
            return;
          }
          try {
            var report = JSON.parse(output);
            if (!report || typeof report.summary !== "string") throw new Error("Invalid diagnostics report");
            finish("log", report.summary);
          } catch (e) {
            finish("warn", "OS-user diagnostics unavailable");
          }
        });
        timeout = schedule(function() {
          try { child.kill(); } catch (e) {}
          finish("warn", "OS-user diagnostics timed out");
        }, timeoutMs);
        child.stdin.end(JSON.stringify(diagnosticsPayload(options)));
      } catch (e) {
        try { if (child && typeof child.kill === "function") child.kill(); } catch (killError) {}
        finish("warn", "OS-user diagnostics unavailable");
      }
    }, 0);
  } catch (e) {
    logDiagnosticMessage(logger, "warn", "OS-user diagnostics could not be scheduled");
  }
}

module.exports = {
  collectOsUserDiagnostics: collectOsUserDiagnostics,
  collectUserDiagnostics: collectUserDiagnostics,
  credentialPaths: credentialPaths,
  probeMappedProjectAccess: probeMappedProjectAccess,
  scheduleOsUserDiagnosticsAsync: scheduleOsUserDiagnosticsAsync,
  summarizeDiagnostics: summarizeDiagnostics,
};
