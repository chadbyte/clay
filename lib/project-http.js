var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");
var { execFileSync, spawn } = require("child_process");
var defaultFsAsUser = require("./os-users").fsAsUser;
var defaultUsersModule = require("./users");
var gitCli = require("./git-cli");
var resolveFilePath = require("./project-file-path").resolveFilePath;

var IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
var MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};
var MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

function parseJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
  });
}

/**
 * Attach HTTP request handler to a project context.
 *
 * ctx fields:
 *   cwd, slug, project, sm, send, sendTo, imagesDir, osUsers, pushModule,
 *   safePath, safeAbsPath, getOsUserInfoForReq, sendExtensionCommandAny,
 *   saveGeneratedImageToProject, _extToken, _browserTabList
 */
function attachHTTP(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var project = ctx.project;
  var sm = ctx.sm;
  var gitAttribution = ctx.gitAttribution;
  var send = ctx.send;
  var imagesDir = ctx.imagesDir;
  var saveGeneratedImageToProject = ctx.saveGeneratedImageToProject;
  var osUsers = ctx.osUsers;
  var pushModule = ctx.pushModule;
  var safePath = ctx.safePath;
  var safeAbsPath = ctx.safeAbsPath;
  var getOsUserInfoForReq = ctx.getOsUserInfoForReq;
  var fsAsUser = ctx.fsAsUser || defaultFsAsUser;
  var usersModule = ctx.usersModule || defaultUsersModule;
  var sendExtensionCommandAny = ctx.sendExtensionCommandAny;
  var _extToken = ctx._extToken;
  var _browserTabList = ctx._browserTabList;

  function handleHTTP(req, res, urlPath) {
    // Browser MCP extension bridge: forward commands to Chrome extension
    if (req.method === "POST" && urlPath === "/ext-command") {
      parseJsonBody(req).then(function (body) {
        // Validate auth token
        if (!body.token || body.token !== _extToken) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid token"}');
          return;
        }
        var command = body.command;
        var args = body.args || {};
        var timeout = Math.min(body.timeout || 5000, 30000); // max 30s

        // Special command: list_tabs (no extension round-trip needed)
        if (command === "list_tabs") {
          var tabArr = [];
          for (var tid in _browserTabList) {
            tabArr.push(_browserTabList[tid]);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: { tabs: tabArr } }));
          return;
        }

        sendExtensionCommandAny(command, args, timeout).then(function (result) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ result: result || {} }));
        }).catch(function (err) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Extension command failed" }));
        });
      }).catch(function () {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invalid JSON body"}');
      });
      return true;
    }

    // Serve chat images
    if (req.method === "GET" && urlPath.indexOf("/images/") === 0) {
      var imgName = path.basename(urlPath);
      // Sanitize: only allow expected filename pattern
      if (!/^\d+-[a-f0-9]+\.\w+$/.test(imgName)) {
        res.writeHead(400);
        res.end("Bad request");
        return true;
      }
      var imgPath = path.join(imagesDir, imgName);
      try {
        var imgBuf = fs.readFileSync(imgPath);
        var ext = path.extname(imgName).toLowerCase();
        var mime = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
        res.end(imgBuf);
      } catch (e) {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // Copy a generated image from Clay's session storage into the project.
    if (req.method === "POST" && urlPath === "/api/generated-image/save") {
      if (usersModule.isMultiUser()) {
        var imageSaveUser = req._clayUser;
        var imageSavePermissions = imageSaveUser ? usersModule.getEffectivePermissions(imageSaveUser, osUsers) : null;
        if (!imageSavePermissions || !imageSavePermissions.fileBrowser) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"File browser access is not permitted"}');
          return true;
        }
      }
      parseJsonBody(req).then(function (body) {
        if (typeof saveGeneratedImageToProject !== "function") {
          res.writeHead(501, { "Content-Type": "application/json" });
          res.end('{"error":"Generated image saving is not available"}');
          return;
        }
        var result = saveGeneratedImageToProject(
          body.fileName,
          body.path,
          !!body.overwrite,
          getOsUserInfoForReq(req)
        );
        res.writeHead(result.ok ? 200 : (result.status || 500), { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      }).catch(function () {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invalid JSON body"}');
      });
      return true;
    }

    // File upload
    if (req.method === "POST" && urlPath === "/api/upload") {
      parseJsonBody(req).then(function (body) {
        var fileName = body.name;
        var fileData = body.data; // base64
        if (!fileName || !fileData) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing name or data"}');
          return;
        }
        // Sanitize filename — strip path separators
        var safeName = path.basename(fileName).replace(/[\x00-\x1f\/\\:*?"<>|]/g, "_");
        if (!safeName) safeName = "upload";

        // Check size
        var estimatedBytes = fileData.length * 0.75;
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"file too large (max 50MB)"}');
          return;
        }

        // Create tmp dir: os.tmpdir()/clay-{hash}/
        var cwdHash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 12);
        var tmpDir = path.join(os.tmpdir(), "clay-" + cwdHash);
        try { fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}

        // Add timestamp prefix to avoid collisions
        var ts = Date.now();
        var destName = ts + "-" + safeName;
        var destPath = path.join(tmpDir, destName);

        try {
          var buf = Buffer.from(fileData, "base64");
          fs.writeFileSync(destPath, buf);
          // Make readable by all local users and chown to session owner
          try { fs.chmodSync(destPath, 0o644); } catch (e2) {}
          try { fs.chmodSync(tmpDir, 0o755); } catch (e2) {}
          if (req._clayUser && req._clayUser.linuxUser) {
            try {
              var _osUM = require("./os-users");
              var _uid = _osUM.getLinuxUserUid(req._clayUser.linuxUser);
              if (_uid != null) {
                execFileSync("chown", [String(_uid), destPath]);
                execFileSync("chown", [String(_uid), tmpDir]);
              }
            } catch (e2) {}
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ path: destPath, name: safeName }));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "failed to save: " + (e.message || e) }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Push subscribe
    if (req.method === "POST" && urlPath === "/api/push-subscribe") {
      parseJsonBody(req).then(function (body) {
        var sub = body.subscription || body;
        if (pushModule) pushModule.addSubscription(sub, body.replaceEndpoint);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Permission response from push notification
    if (req.method === "POST" && urlPath === "/api/permission-response") {
      parseJsonBody(req).then(function (data) {
        var requestId = data.requestId;
        var decision = data.decision;
        if (!requestId || !decision) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing requestId or decision"}');
          return;
        }
        var found = false;
        sm.sessions.forEach(function (session) {
          var pending = session.pendingPermissions[requestId];
          if (!pending) return;
          found = true;
          delete session.pendingPermissions[requestId];
          if (decision === "allow") {
            pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          } else {
            pending.resolve({ behavior: "deny", message: "Denied via push notification" });
          }
          sm.sendAndRecord(session, {
            type: "permission_resolved",
            requestId: requestId,
            decision: decision,
          });
        });
        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"permission request not found"}');
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // /api/tui-notify is handled at the server top-level (server.js
    // appHandler) so a single hook in ~/.claude/settings.json can route
    // to any project. Don't shadow it here.

    // VAPID public key
    if (req.method === "GET" && urlPath === "/api/vapid-public-key") {
      if (pushModule) {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" });
        res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"push not available"}');
      }
      return true;
    }

    // File browser: download project files
    if (req.method === "GET" && urlPath.startsWith("/api/file/download?")) {
      if (usersModule.isMultiUser()) {
        var downloadUser = req._clayUser;
        var downloadPermissions = downloadUser ? usersModule.getEffectivePermissions(downloadUser, osUsers) : null;
        if (!downloadPermissions || !downloadPermissions.fileBrowser) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("File browser access is not permitted");
          return true;
        }
      }

      var downloadQueryIndex = urlPath.indexOf("?");
      var downloadParams = new URLSearchParams(urlPath.substring(downloadQueryIndex));
      var downloadPath = downloadParams.get("path");
      if (!downloadPath) { res.writeHead(400); res.end("Missing path"); return true; }
      var downloadUserInfo = getOsUserInfoForReq(req);
      if (osUsers && !downloadUserInfo) { res.writeHead(403); res.end("OS user identity unavailable"); return true; }
      var downloadFile = resolveFilePath(cwd, downloadPath, safePath, downloadUserInfo);
      if (!downloadFile) { res.writeHead(403); res.end("Access denied"); return true; }

      try {
        var downloadContent;
        if (downloadUserInfo) {
          downloadContent = fsAsUser("read_binary", { file: downloadFile }, downloadUserInfo).buffer;
        } else {
          downloadContent = fs.readFileSync(downloadFile);
        }
        var downloadName = path.basename(downloadPath).replace(/[\x00-\x1f\x7f"\\]/g, "_") || "download";
        var asciiDownloadName = downloadName.replace(/[^\x20-\x7e]/g, "_");
        var encodedDownloadName = encodeURIComponent(downloadName).replace(/[!'()*]/g, function (character) {
          return "%" + character.charCodeAt(0).toString(16).toUpperCase();
        });
        var contentDisposition = "attachment; filename=\"" + asciiDownloadName + "\"; filename*=UTF-8''" + encodedDownloadName;
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": downloadContent.length,
          "Content-Disposition": contentDisposition,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(downloadContent);
      } catch (e) {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // File browser: serve project images
    if (req.method === "GET" && urlPath.startsWith("/api/file?")) {
      var qIdx = urlPath.indexOf("?");
      var params = new URLSearchParams(urlPath.substring(qIdx));
      var reqFilePath = params.get("path");
      if (!reqFilePath) { res.writeHead(400); res.end("Missing path"); return true; }
      if (usersModule.isMultiUser()) {
        var imageUser = req._clayUser;
        var imagePermissions = imageUser ? usersModule.getEffectivePermissions(imageUser, osUsers) : null;
        if (!imagePermissions || !imagePermissions.fileBrowser) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("File browser access is not permitted");
          return true;
        }
      }
      var fileServeUserInfo = getOsUserInfoForReq(req);
      if (osUsers && !fileServeUserInfo) { res.writeHead(403); res.end("OS user identity unavailable"); return true; }
      var absFile = resolveFilePath(cwd, reqFilePath, safePath, fileServeUserInfo);
      if (!absFile) { res.writeHead(403); res.end("Access denied"); return true; }
      var fileExt = path.extname(absFile).toLowerCase();
      if (!IMAGE_EXTS.has(fileExt)) { res.writeHead(403); res.end("Only image files"); return true; }
      try {
        var fileContent;
        if (fileServeUserInfo) {
          var binResult = fsAsUser("read_binary", { file: absFile }, fileServeUserInfo);
          fileContent = binResult.buffer;
        } else {
          fileContent = fs.readFileSync(absFile);
        }
        var fileMime = MIME_TYPES[fileExt] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": fileMime, "Cache-Control": "no-cache" });
        res.end(fileContent);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return true;
    }

    // Skills permission gate
    if (urlPath === "/api/install-skill" || urlPath === "/api/uninstall-skill" || urlPath === "/api/installed-skills") {
      if (req._clayUser) {
        var skPerms = usersModule.getEffectivePermissions(req._clayUser, osUsers);
        if (!skPerms.skills) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"Skills access is not permitted"}');
          return true;
        }
      }
    }

    // Install a skill (background spawn)
    if (req.method === "POST" && urlPath === "/api/install-skill") {
      parseJsonBody(req).then(function (body) {
        var url = body.url;
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!url || !skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing url, skill, or scope"}');
          return;
        }
        // Validate skill name: alphanumeric, hyphens, underscores only
        if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill name"}');
          return;
        }
        // Validate URL: must be https://
        if (!/^https:\/\//i.test(url)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"only https:// URLs are allowed"}');
          return;
        }
        var skillUserInfo = getOsUserInfoForReq(req);
        var spawnCwd = scope === "global" ? (skillUserInfo ? skillUserInfo.home : require("./config").REAL_HOME) : cwd;
        var scopeFlag = scope === "global" ? "--global" : "--project";
        var skillSpawnOpts = {
          cwd: spawnCwd,
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        };
        if (skillUserInfo) {
          skillSpawnOpts.uid = skillUserInfo.uid;
          skillSpawnOpts.gid = skillUserInfo.gid;
          skillSpawnOpts.env = Object.assign({}, process.env, {
            HOME: skillUserInfo.home,
            npm_config_cache: require("path").join(skillUserInfo.home, ".npm"),
          });
        }
        console.log("[skill-install] spawning: npx skills add " + url + " --skill " + skill + " --yes " + scopeFlag + " (cwd: " + spawnCwd + ")");
        var skillAddSpawn = require("./os-users").wrapSpawnAsUser("npx", ["skills", "add", url, "--skill", skill, "--yes", scopeFlag], skillSpawnOpts);
        var child = spawn(skillAddSpawn.command, skillAddSpawn.args, skillAddSpawn.options);
        var stdoutBuf = "";
        var stderrBuf = "";
        child.stdout.on("data", function (chunk) {
          stdoutBuf += chunk.toString();
          console.log("[skill-install] " + skill + " stdout chunk: " + chunk.toString().trim().slice(0, 500));
        });
        child.stderr.on("data", function (chunk) {
          stderrBuf += chunk.toString();
          console.log("[skill-install] " + skill + " stderr chunk: " + chunk.toString().trim().slice(0, 500));
        });
        // Timeout after 60 seconds
        var installTimeout = setTimeout(function () {
          console.error("[skill-install] " + skill + " timed out after 60s, killing process");
          try { child.kill("SIGTERM"); } catch (e) {}
          try {
            send({ type: "skill_installed", skill: skill, scope: scope, success: false, error: "Installation timed out after 60 seconds" });
          } catch (e) {}
        }, 60000);
        child.on("close", function (code) {
          clearTimeout(installTimeout);
          console.log("[skill-install] " + skill + " exited with code " + code + " (stdout=" + stdoutBuf.length + "b, stderr=" + stderrBuf.length + "b)");
          if (stdoutBuf) console.log("[skill-install] stdout: " + stdoutBuf.slice(0, 2000));
          if (stderrBuf) console.log("[skill-install] stderr: " + stderrBuf.slice(0, 2000));
          try {
            var success = code === 0;
            send({
              type: "skill_installed",
              skill: skill,
              scope: scope,
              success: success,
              error: success ? null : "Process exited with code " + code,
            });
          } catch (e) {
            console.error("[project] skill_installed send failed:", e.message || e);
          }
        });
        child.on("error", function (err) {
          clearTimeout(installTimeout);
          console.error("[skill-install] " + skill + " spawn error:", err.message || err);
          try {
            send({
              type: "skill_installed",
              skill: skill,
              scope: scope,
              success: false,
              error: err.message,
            });
          } catch (e) {
            console.error("[skill-install] " + skill + " send failed:", e.message || e);
          }
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Uninstall a skill (remove directory)
    if (req.method === "POST" && urlPath === "/api/uninstall-skill") {
      parseJsonBody(req).then(function (body) {
        var skill = body.skill;
        var scope = body.scope; // "global" or "project"
        if (!skill || !scope) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skill or scope"}');
          return;
        }
        // Validate skill name
        if (!/^[a-zA-Z0-9_-]+$/.test(skill)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill name"}');
          return;
        }
        var uninstallUserInfo = getOsUserInfoForReq(req);
        var baseDir = scope === "global" ? (uninstallUserInfo ? uninstallUserInfo.home : require("./config").REAL_HOME) : cwd;
        var skillDir = path.join(baseDir, ".claude", "skills", skill);
        // Safety: ensure skillDir is inside the expected .claude/skills directory
        var expectedParent = path.join(baseDir, ".claude", "skills");
        var resolved = path.resolve(skillDir);
        if (!resolved.startsWith(expectedParent + path.sep)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"invalid skill path"}');
          return;
        }
        try {
          if (uninstallUserInfo) {
            // Run rm as target user to respect permissions
            var rmScript = "var fs = require('fs'); fs.rmSync(" + JSON.stringify(resolved) + ", { recursive: true, force: true });";
            var rmSpawn = require("./os-users").wrapSpawnAsUser(process.execPath, ["-e", rmScript], {
              uid: uninstallUserInfo.uid,
              gid: uninstallUserInfo.gid,
              timeout: 10000,
            });
            execFileSync(rmSpawn.command, rmSpawn.args, rmSpawn.options);
          } else {
            fs.rmSync(resolved, { recursive: true, force: true });
          }
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: true,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (err) {
          send({
            type: "skill_uninstalled",
            skill: skill,
            scope: scope,
            success: false,
            error: err.message,
          });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Installed skills (global + project)
    if (req.method === "GET" && urlPath === "/api/installed-skills") {
      var installed = {};
      var globalDir = path.join(require("./config").REAL_HOME, ".claude", "skills");
      var projectDir = path.join(cwd, ".claude", "skills");
      var scanDirs = [
        { dir: globalDir, scope: "global" },
        { dir: projectDir, scope: "project" },
      ];
      for (var sd = 0; sd < scanDirs.length; sd++) {
        var entries;
        try { entries = fs.readdirSync(scanDirs[sd].dir, { withFileTypes: true }); } catch (e) { continue; }
        for (var si = 0; si < entries.length; si++) {
          var ent = entries[si];
          if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
          var mdPath = path.join(scanDirs[sd].dir, ent.name, "SKILL.md");
          try {
            var mdContent = fs.readFileSync(mdPath, "utf8");
            var desc = "";
            // Parse YAML frontmatter for description
            var version = "";
            if (mdContent.startsWith("---")) {
              var endIdx = mdContent.indexOf("---", 3);
              if (endIdx !== -1) {
                var frontmatter = mdContent.substring(3, endIdx);
                var descMatch = frontmatter.match(/^description:\s*(.+)/m);
                if (descMatch) desc = descMatch[1].trim();
                var verMatch = frontmatter.match(/version:\s*"?([^"\n]+)"?/m);
                if (verMatch) version = verMatch[1].trim();
              }
            }
            if (!installed[ent.name]) {
              installed[ent.name] = { scope: scanDirs[sd].scope, description: desc, version: version, path: path.join(scanDirs[sd].dir, ent.name) };
            } else {
              // project-level adds to existing global entry
              installed[ent.name].scope = "both";
              if (desc && !installed[ent.name].description) installed[ent.name].description = desc;
              if (version && !installed[ent.name].version) installed[ent.name].version = version;
            }
          } catch (e) {}
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ installed: installed }));
      return true;
    }

    // Skill update check cache (avoid redundant GitHub fetches)
    if (!ctx._skillCheckCache) ctx._skillCheckCache = {};
    var SKILL_CHECK_TTL = 5 * 60 * 1000; // 5 minutes

    // Check skill updates (compare installed vs remote versions)
    if (req.method === "POST" && urlPath === "/api/check-skill-updates") {
      parseJsonBody(req).then(function (body) {
        var skills = body.skills; // [{ name, url, scope }]
        if (!Array.isArray(skills) || skills.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"missing skills array"}');
          return;
        }
        // Read installed versions (use requesting user's home in multi-user setups)
        var skillUserHome = (function () {
          var sui = getOsUserInfoForReq(req);
          return sui ? sui.home : require("./config").REAL_HOME;
        })();
        var globalSkillsDir = path.join(skillUserHome, ".claude", "skills");
        var projectSkillsDir = path.join(cwd, ".claude", "skills");
        var results = [];
        var pending = skills.length;

        function parseVersionFromSkillMd(content) {
          if (!content || !content.startsWith("---")) return "";
          var endIdx = content.indexOf("---", 3);
          if (endIdx === -1) return "";
          var fm = content.substring(3, endIdx);
          var m = fm.match(/version:\s*"?([^"\n]+)"?/m);
          return m ? m[1].trim() : "";
        }

        function getInstalledVersion(name) {
          var dirs = [path.join(globalSkillsDir, name, "SKILL.md"), path.join(projectSkillsDir, name, "SKILL.md")];
          for (var d = 0; d < dirs.length; d++) {
            try {
              var c = fs.readFileSync(dirs[d], "utf8");
              var v = parseVersionFromSkillMd(c);
              if (v) return v;
            } catch (e) {}
          }
          return "";
        }

        function compareVersions(a, b) {
          // returns -1 if a < b, 0 if equal, 1 if a > b
          if (!a && !b) return 0;
          if (!a) return -1;
          if (!b) return 1;
          var pa = a.split(".").map(Number);
          var pb = b.split(".").map(Number);
          for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var va = pa[i] || 0;
            var vb = pb[i] || 0;
            if (va < vb) return -1;
            if (va > vb) return 1;
          }
          return 0;
        }

        function finishOne() {
          pending--;
          if (pending === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ results: results }));
          }
        }

        for (var si = 0; si < skills.length; si++) {
          (function (skill) {
            var installedVer = getInstalledVersion(skill.name);
            var installed = !!installedVer;

            // Return cached result if fresh
            var cacheKey = skill.name + ":" + (installedVer || "");
            var cached = ctx._skillCheckCache[cacheKey];
            if (cached && (Date.now() - cached.ts) < SKILL_CHECK_TTL) {
              results.push(cached.result);
              finishOne();
              return;
            }

            // Convert GitHub repo URL to raw SKILL.md URL
            var rawUrl = "";
            var ghMatch = skill.url.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (ghMatch) {
              rawUrl = "https://raw.githubusercontent.com/" + ghMatch[1] + "/" + ghMatch[2] + "/main/SKILL.md";
            }
            if (!rawUrl) {
              var r0 = { name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "missing" };
              ctx._skillCheckCache[cacheKey] = { ts: Date.now(), result: r0 };
              results.push(r0);
              finishOne();
              return;
            }
            // Fetch remote SKILL.md
            var https = require("https");
            https.get(rawUrl, function (resp) {
                var data = "";
              resp.on("data", function (chunk) { data += chunk; });
              resp.on("end", function () {
                try {
                  var remoteVer = parseVersionFromSkillMd(data);
                  var status = "ok";
                  if (!installed) {
                    status = "missing";
                  } else if (remoteVer && compareVersions(installedVer, remoteVer) < 0) {
                    status = "outdated";
                  }
                  var r1 = { name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: remoteVer, status: status };
                  ctx._skillCheckCache[cacheKey] = { ts: Date.now(), result: r1 };
                  results.push(r1);
                  finishOne();
                } catch (e) {
                  console.error("[skill-check] " + skill.name + " version parse failed:", e.message || e);
                  results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "error" });
                  finishOne();
                }
              });
            }).on("error", function (err) {
              console.error("[skill-check] " + skill.name + " fetch error:", err.message || err);
              results.push({ name: skill.name, installed: installed, installedVersion: installedVer, remoteVersion: "", status: installed ? "ok" : "missing" });
              finishOne();
            });
          })(skills[si]);
        }
      }).catch(function () {
        res.writeHead(400);
        res.end("Bad request");
      });
      return true;
    }

    // Git panel status and actions
    var isGitPanelRequest = urlPath === "/api/git/status" || urlPath === "/api/git/summary" ||
      urlPath === "/api/git/action" || urlPath.indexOf("/api/git/file-diff?") === 0 ||
      urlPath.indexOf("/api/git/session-diff?") === 0;
    if (isGitPanelRequest && usersModule.isMultiUser()) {
      var gitRequestUser = req._clayUser;
      var gitPermissions = gitRequestUser ? usersModule.getEffectivePermissions(gitRequestUser, osUsers) : null;
      if (!gitPermissions || !gitPermissions.fileBrowser) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Git access is not permitted"}');
        return true;
      }
    }

    if (req.method === "GET" && urlPath === "/api/git/status") {
      var gitUserInfo = getOsUserInfoForReq(req);
      try {
        var gitStatus = gitCli.getStatus(cwd, gitUserInfo);
        if (gitAttribution) {
          var visibleGitSessions = sm.sessions;
          if (usersModule.isMultiUser() && req._clayUser) {
            visibleGitSessions = new Map();
            sm.sessions.forEach(function (session, id) {
              if (usersModule.canAccessSession(req._clayUser.id, session, { visibility: "public" })) {
                visibleGitSessions.set(id, session);
              }
            });
          }
          gitAttribution.decorateStatus(gitStatus, visibleGitSessions);
        }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(gitStatus));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message || "Unable to read Git status" }));
      }
      return true;
    }

    // Compact repository placard data for the always-visible sidebar block.
    // Same permission gate as the panel, but no file payload and no path.
    if (req.method === "GET" && urlPath === "/api/git/summary") {
      try {
        var gitSummary = gitCli.getSummary(cwd, getOsUserInfoForReq(req));
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(gitSummary));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message || "Unable to read Git summary" }));
      }
      return true;
    }

    if (req.method === "GET" && urlPath.indexOf("/api/git/file-diff?") === 0) {
      var gitDiffParams = new URLSearchParams(urlPath.slice(urlPath.indexOf("?")));
      var gitDiffPath = gitDiffParams.get("path");
      if (!gitDiffPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Missing file path"}');
        return true;
      }
      try {
        var gitDiffResult = gitCli.getFileDiff(cwd, gitDiffPath, getOsUserInfoForReq(req));
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(gitDiffResult));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message || "Unable to read file diff" }));
      }
      return true;
    }

    if (req.method === "GET" && urlPath.indexOf("/api/git/session-diff?") === 0) {
      var sessionDiffParams = new URLSearchParams(urlPath.slice(urlPath.indexOf("?")));
      var sessionDiffKey = sessionDiffParams.get("session");
      var sessionDiffPath = sessionDiffParams.get("path");
      if (!gitAttribution || !sessionDiffKey || !sessionDiffPath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Missing session comparison"}');
        return true;
      }
      try {
        var requestedSessionVisible = false;
        sm.sessions.forEach(function (session) {
          var key = session.cliSessionId || ("local:" + session.localId);
          if (key !== sessionDiffKey) return;
          requestedSessionVisible = !usersModule.isMultiUser() ||
            (req._clayUser && usersModule.canAccessSession(req._clayUser.id, session, { visibility: "public" }));
        });
        if (!requestedSessionVisible) throw new Error("Session comparison is unavailable");
        var sessionDiff = gitAttribution.getSessionBaselineDiff(sessionDiffKey, sessionDiffPath, getOsUserInfoForReq(req));
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(sessionDiff));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message || "Unable to compare session changes" }));
      }
      return true;
    }

    if (req.method === "POST" && urlPath === "/api/git/action") {
      var gitActionUserInfo = getOsUserInfoForReq(req);
      parseJsonBody(req).then(function (body) {
        return gitCli.runAction(cwd, body, gitActionUserInfo);
      }).then(function (output) {
        var updatedStatus = gitCli.getStatus(cwd, gitActionUserInfo);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, output: output, status: updatedStatus }));
      }).catch(function (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.userMessage || err.message || "Git action failed" }));
      });
      return true;
    }

    // Legacy dirty check used by the Ralph Loop flow
    if (req.method === "GET" && urlPath === "/api/git-dirty") {
      try {
        var out = execFileSync("git", ["status", "--porcelain"], { cwd: cwd, encoding: "utf8", timeout: 5000 });
        var lines = out.trim().split("\n").filter(function (line) {
          return line.trim().length > 0 && !line.startsWith("??");
        });
        var dirty = lines.length > 0;
        var files = lines.map(function (line) { return line.trim(); });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dirty: dirty, files: files }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ dirty: false }));
      }
      return true;
    }

    // List branches for worktree modal
    if (req.method === "GET" && urlPath === "/api/branches") {
      try {
        var brRaw = execFileSync("git", ["branch", "-a", "--format=%(refname:short)"], {
          cwd: cwd, timeout: 5000, encoding: "utf8"
        });
        var brList = brRaw.trim().split("\n").filter(Boolean);
        var defBr = "main";
        try {
          var hrRef = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], {
            cwd: cwd, timeout: 3000, encoding: "utf8"
          }).trim();
          defBr = hrRef.replace(/^origin\//, "");
        } catch (e) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ branches: brList, defaultBranch: defBr }));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ branches: ["main"], defaultBranch: "main" }));
      }
      return true;
    }

    // MCP bridge endpoint: allows Codex's mcp-bridge-server.js to list/call
    // in-app and remote MCP tools via HTTP (localhost only).
    if (req.method === "POST" && urlPath === "/api/mcp-bridge") {
      parseJsonBody(req).then(function (body) {
        var action = body.action;
        var getMcpBridgeHandler = ctx.getMcpBridgeHandler;
        if (!getMcpBridgeHandler) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end('{"error":"MCP bridge not configured"}');
          return;
        }
        var sessionId = Number(body.sessionId);
        if (!Number.isInteger(sessionId)) sessionId = null;
        var queryGeneration = Number(body.queryGeneration);
        if (!Number.isInteger(queryGeneration)) queryGeneration = null;
        var handler = getMcpBridgeHandler(sessionId, body.sessionOnly === true, queryGeneration);
        if (!handler) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end('{"error":"MCP bridge handler unavailable"}');
          return;
        }

        if (action === "list_tools") {
          handler.listTools().then(function (tools) {
            var serverCounts = {};
            for (var ti = 0; ti < tools.length; ti++) {
              serverCounts[tools[ti].server] = (serverCounts[tools[ti].server] || 0) + 1;
            }
            console.log("[mcp-bridge-http] list_tools:", tools.length, "tools -", Object.keys(serverCounts).map(function(s) { return s + "(" + serverCounts[s] + ")"; }).join(", ") || "(none)");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ tools: tools }));
          }).catch(function (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || "Failed to list tools" }));
          });
        } else if (action === "call_tool") {
          var server = body.server;
          var tool = body.tool;
          var args = body.args || {};
          console.log("[mcp-bridge-http] call_tool:", server + "/" + tool);
          handler.callTool(server, tool, args).then(function (result) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ result: result }));
          }).catch(function (err) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message || "Tool call failed" }));
          });
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Unknown action: ' + (action || '') + '"}');
        }
      }).catch(function () {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invalid JSON body"}');
      });
      return true;
    }

    // Info endpoint
    if (req.method === "GET" && urlPath === "/info") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ cwd: cwd, project: project, slug: slug }));
      return true;
    }

    return false; // not handled
  }

  return {
    handleHTTP: handleHTTP,
  };
}

module.exports = { attachHTTP: attachHTTP, parseJsonBody: parseJsonBody };
