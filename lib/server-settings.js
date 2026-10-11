var fs = require("fs");
var path = require("path");
var { attachExperimentalSettings } = require("./server-experimental-settings");
var dicebearAvatar = require("./dicebear-avatar");

function attachSettings(ctx) {
  var users = ctx.users;
  var mates = ctx.mates;
  var getMultiUserFromReq = ctx.getMultiUserFromReq;
  var projects = ctx.projects;
  var opts = ctx.opts;
  var CONFIG_DIR = ctx.CONFIG_DIR;

  var profilePath = path.join(CONFIG_DIR, "profile.json");
  var experimentalSettings = attachExperimentalSettings(ctx);

  function handleRequest(req, res, fullUrl) {
    if (experimentalSettings.handleRequest(req, res, fullUrl)) return true;
    // Render historical avatar styles locally so profile seeds never leave Clay.
    if (req.method === "GET" && fullUrl === "/api/generated-avatar") {
      var avatarParams = new URL(req.url || fullUrl, "http://localhost").searchParams;
      var avatarStyle = avatarParams.get("style") || "";
      if (!dicebearAvatar.isSupportedStyle(avatarStyle)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Unknown avatar style"}');
        return true;
      }
      dicebearAvatar.renderAvatar(avatarStyle, avatarParams.get("seed") || "", avatarParams.get("size")).then(function (svg) {
        res.writeHead(200, {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Cache-Control": "private, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(svg);
      }).catch(function () {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"error":"Avatar generation failed"}');
      });
      return true;
    }
    // GET /api/profile
    if (req.method === "GET" && fullUrl === "/api/profile") {
      if (users.isMultiUser()) {
        var mu = getMultiUserFromReq(req);
        if (!mu) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end('{"error":"unauthorized"}');
          return true;
        }
        var profile = mu.profile || { name: "", lang: "en-US", avatarColor: "#5857fc", avatarStyle: "imprint", avatarSeed: "", avatarCustom: "" };
        profile.username = mu.username;
        profile.userId = mu.id;
        profile.role = mu.role;
        profile.pinEnabled = !!mu.pinHash;
        profile.autoContinueOnRateLimit = !!mu.autoContinueOnRateLimit;
        profile.chatLayout = mu.chatLayout || "channel";
        profile.projectMateFilterMode = users.getProjectMateFilterMode(mu.id);
        profile.mateOnboardingShown = !!mu.mateOnboardingShown;
        profile.matesEnabled = mu.matesEnabled === true;
        profile.capsulesEnabled = users.getCapsulesEnabled(mu.id);
        try { profile.terminalFont = users.getTerminalFont(mu.id); } catch (e) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(profile));
        return true;
      }
      var profile = { name: "", lang: "en-US", avatarColor: "#5857fc", avatarStyle: "imprint", avatarSeed: "", avatarCustom: "" };
      try {
        var raw = fs.readFileSync(profilePath, "utf8");
        var saved = JSON.parse(raw);
        if (saved.name !== undefined) profile.name = saved.name;
        if (saved.lang) profile.lang = saved.lang;
        if (saved.avatarColor) profile.avatarColor = saved.avatarColor;
        if (saved.avatarStyle) profile.avatarStyle = saved.avatarStyle;
        if (saved.avatarSeed) profile.avatarSeed = saved.avatarSeed;
        if (saved.avatarCustom) profile.avatarCustom = saved.avatarCustom;
      } catch (e) { /* file doesn't exist yet */ }
      // Single-user settings from daemon config
      if (typeof opts.onGetDaemonConfig === "function") {
        var dc = opts.onGetDaemonConfig();
        profile.autoContinueOnRateLimit = !!dc.autoContinueOnRateLimit;
        profile.chatLayout = dc.chatLayout || "channel";
        profile.projectMateFilterMode = users.getProjectMateFilterMode(null);
        profile.mateOnboardingShown = !!dc.mateOnboardingShown;
        profile.matesEnabled = dc.matesEnabled === true;
        profile.capsulesEnabled = dc.capsulesEnabled === true;
        if (dc.terminalFont && typeof dc.terminalFont === "object") {
          profile.terminalFont = {
            family: dc.terminalFont.family || "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
            size: typeof dc.terminalFont.size === "number" ? dc.terminalFont.size : 14,
          };
        } else {
          profile.terminalFont = { family: "'SF Mono', Menlo, Monaco, 'Courier New', monospace", size: 14 };
        }
      }
      // Check if custom avatar file exists
      try {
        var avatarFiles = fs.readdirSync(path.join(CONFIG_DIR, "avatars"));
        for (var afi = 0; afi < avatarFiles.length; afi++) {
          if (avatarFiles[afi].startsWith("default.")) {
            profile.avatarCustom = "/api/avatar/default?v=" + fs.statSync(path.join(CONFIG_DIR, "avatars", avatarFiles[afi])).mtimeMs;
            break;
          }
        }
      } catch (e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(profile));
      return true;
    }

    // PUT /api/profile
    if (req.method === "PUT" && fullUrl === "/api/profile") {
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var profile = {};
          if (typeof data.name === "string") profile.name = data.name.substring(0, 50);
          if (typeof data.lang === "string") profile.lang = data.lang.substring(0, 10);
          if (typeof data.avatarColor === "string" && /^#[0-9a-fA-F]{6}$/.test(data.avatarColor)) {
            profile.avatarColor = data.avatarColor;
          }
          if (typeof data.avatarStyle === "string") profile.avatarStyle = data.avatarStyle.substring(0, 30);
          if (typeof data.avatarSeed === "string") profile.avatarSeed = data.avatarSeed.substring(0, 30);
          if (typeof data.avatarCustom === "string") profile.avatarCustom = data.avatarCustom;
          if (data.avatarCustom === null || data.avatarCustom === "") profile.avatarCustom = undefined;
          if (users.isMultiUser()) {
            var mu = getMultiUserFromReq(req);
            if (!mu) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end('{"error":"unauthorized"}');
              return;
            }
            users.updateUserProfile(mu.id, profile);
            // Broadcast updated avatar/presence to all projects
            projects.forEach(function (pCtx) {
              pCtx.refreshUserProfile(mu.id);
            });
          } else {
            fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), "utf8");
            if (process.platform !== "win32") {
              try { fs.chmodSync(profilePath, 0o600); } catch (chmodErr) {}
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(profile));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request" }));
        }
      });
      return true;
    }

    // Upload custom avatar image
    if (req.method === "POST" && fullUrl === "/api/avatar") {
      var chunks = [];
      var totalSize = 0;
      var maxSize = 2 * 1024 * 1024; // 2MB
      req.on("data", function (chunk) {
        totalSize += chunk.length;
        if (totalSize <= maxSize) chunks.push(chunk);
      });
      req.on("end", function () {
        if (totalSize > maxSize) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"File too large (max 2MB)"}');
          return;
        }
        var raw = Buffer.concat(chunks);
        // Detect content type from magic bytes
        var ct = null;
        if (raw[0] === 0xFF && raw[1] === 0xD8) ct = "image/jpeg";
        else if (raw[0] === 0x89 && raw[1] === 0x50) ct = "image/png";
        else if (raw[0] === 0x47 && raw[1] === 0x49) ct = "image/gif";
        else if (raw[0] === 0x52 && raw[1] === 0x49) ct = "image/webp";
        if (!ct) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Unsupported image format"}');
          return;
        }
        var ext = ct.split("/")[1] === "jpeg" ? "jpg" : ct.split("/")[1];
        var avatarDir = path.join(CONFIG_DIR, "avatars");
        fs.mkdirSync(avatarDir, { recursive: true });

        var userId = "default";
        if (users.isMultiUser()) {
          var mu = getMultiUserFromReq(req);
          if (!mu) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"error":"unauthorized"}');
            return;
          }
          userId = mu.id;
        }
        var filename = userId + "." + ext;
        // Remove old avatar files for this user
        try {
          var existing = fs.readdirSync(avatarDir);
          for (var ei = 0; ei < existing.length; ei++) {
            if (existing[ei].startsWith(userId + ".")) {
              fs.unlinkSync(path.join(avatarDir, existing[ei]));
            }
          }
        } catch (e) {}
        var avatarFilePath = path.join(avatarDir, filename);
        fs.writeFileSync(avatarFilePath, raw);
        try { fs.chmodSync(avatarFilePath, 0o644); } catch (e) {}
        try { fs.chmodSync(avatarDir, 0o755); } catch (e) {}
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, avatar: "/api/avatar/" + userId + "?v=" + Date.now() }));
      });
      return true;
    }

    // Serve custom avatar image
    if (req.method === "GET" && fullUrl.startsWith("/api/avatar/")) {
      var avatarUserId = fullUrl.split("/api/avatar/")[1].split("?")[0];
      var avatarDir = path.join(CONFIG_DIR, "avatars");
      try {
        var files = fs.readdirSync(avatarDir);
        var match = null;
        for (var fi = 0; fi < files.length; fi++) {
          if (files[fi].startsWith(avatarUserId + ".")) {
            match = files[fi];
            break;
          }
        }
        if (match) {
          var ext = match.split(".").pop();
          var ctMap = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
          res.writeHead(200, {
            "Content-Type": ctMap[ext] || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
          });
          res.end(fs.readFileSync(path.join(avatarDir, match)));
          return true;
        }
      } catch (e) {}
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":"not found"}');
      return true;
    }

    // Upload custom avatar for a mate
    if (req.method === "POST" && fullUrl.startsWith("/api/mate-avatar/")) {
      var mateIdFromUrl = fullUrl.split("/api/mate-avatar/")[1].split("?")[0];
      if (!mateIdFromUrl) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Missing mate ID"}');
        return true;
      }
      var chunks = [];
      var totalSize = 0;
      var maxSize = 2 * 1024 * 1024; // 2MB
      req.on("data", function (chunk) {
        totalSize += chunk.length;
        if (totalSize <= maxSize) chunks.push(chunk);
      });
      req.on("end", function () {
        if (totalSize > maxSize) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end('{"error":"File too large (max 2MB)"}');
          return;
        }
        var raw = Buffer.concat(chunks);
        var ct = null;
        if (raw[0] === 0xFF && raw[1] === 0xD8) ct = "image/jpeg";
        else if (raw[0] === 0x89 && raw[1] === 0x50) ct = "image/png";
        else if (raw[0] === 0x47 && raw[1] === 0x49) ct = "image/gif";
        else if (raw[0] === 0x52 && raw[1] === 0x49) ct = "image/webp";
        if (!ct) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Unsupported image format"}');
          return;
        }
        var userId = null;
        if (users.isMultiUser()) {
          var mu = getMultiUserFromReq(req);
          if (!mu) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"error":"unauthorized"}');
            return;
          }
          userId = mu.id;
        }
        var mateCtx = mates.buildMateCtx(userId);
        var mate = mates.getMate(mateCtx, mateIdFromUrl);
        if (!mate) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"Mate not found"}');
          return;
        }
        if (mate.profile && mate.profile.avatarLocked) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end('{"error":"This Mate avatar is managed by Clay"}');
          return;
        }
        var ext = ct.split("/")[1] === "jpeg" ? "jpg" : ct.split("/")[1];
        var avatarDir = path.join(CONFIG_DIR, "mate-avatars");
        fs.mkdirSync(avatarDir, { recursive: true });
        var filename = mateIdFromUrl + "." + ext;
        // Remove old avatar files for this mate
        try {
          var existing = fs.readdirSync(avatarDir);
          for (var ei = 0; ei < existing.length; ei++) {
            if (existing[ei].startsWith(mateIdFromUrl + ".")) {
              fs.unlinkSync(path.join(avatarDir, existing[ei]));
            }
          }
        } catch (e) {}
        var mateAvatarFilePath = path.join(avatarDir, filename);
        fs.writeFileSync(mateAvatarFilePath, raw);
        try { fs.chmodSync(mateAvatarFilePath, 0o644); } catch (e) {}
        try { fs.chmodSync(avatarDir, 0o755); } catch (e) {}
        var avatarPath = "/api/mate-avatar/" + mateIdFromUrl + "?v=" + Date.now();
        // Update mate profile with custom avatar URL
        var profile = mate.profile || {};
        profile.avatarCustom = avatarPath;
        mates.updateMate(mateCtx, mateIdFromUrl, { profile: profile });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, avatar: avatarPath }));
      });
      return true;
    }

    // Serve custom mate avatar image
    if (req.method === "GET" && fullUrl.startsWith("/api/mate-avatar/")) {
      var mateAvatarId = fullUrl.split("/api/mate-avatar/")[1].split("?")[0];
      var avatarUser = users.isMultiUser() ? getMultiUserFromReq(req) : null;
      if ((users.isMultiUser() && !avatarUser) || !mates.getMate(mates.buildMateCtx(avatarUser ? avatarUser.id : "default"), mateAvatarId)) {
        res.writeHead(404); res.end(); return true;
      }
      var mateAvatarDir = path.join(CONFIG_DIR, "mate-avatars");
      try {
        var files = fs.readdirSync(mateAvatarDir);
        var match = null;
        for (var fi = 0; fi < files.length; fi++) {
          if (files[fi].startsWith(mateAvatarId + ".")) {
            match = files[fi];
            break;
          }
        }
        if (match) {
          var ext = match.split(".").pop();
          var ctMap = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
          res.writeHead(200, {
            "Content-Type": ctMap[ext] || "application/octet-stream",
            "Cache-Control": "private, no-store",
          });
          res.end(fs.readFileSync(path.join(mateAvatarDir, match)));
          return true;
        }
      } catch (e) {}
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end('{"error":"not found"}');
      return true;
    }

    // Change own PIN (multi-user mode)
    if (req.method === "PUT" && fullUrl === "/api/user/pin") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.newPin || typeof data.newPin !== "string" || !/^\d{6}$/.test(data.newPin)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"PIN must be exactly 6 digits"}');
            return;
          }
          // Forced PIN change after temporary PIN login: skip currentPin
          // verification. The user authenticated with the temp PIN to
          // establish this session, so requiring them to re-enter it adds
          // friction without security benefit. The session cookie is the
          // proof of possession.
          if (mu.pinHash && !mu.mustChangePin) {
            if (!data.currentPin || typeof data.currentPin !== "string" || !/^\d{6}$/.test(data.currentPin)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"Current PIN is required"}');
              return;
            }
            if (mu.pinHash !== users.hashPin(data.currentPin)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"Current PIN is incorrect"}');
              return;
            }
          }
          var result = users.updateUserPin(mu.id, data.newPin);
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // PUT /api/user/auto-continue
    if (req.method === "PUT" && fullUrl === "/api/user/auto-continue") {
      var isMultiUser = users.isMultiUser();
      var mu = getMultiUserFromReq(req);
      if (!isMultiUser) {
        // Single-user: use daemon config fallback
        var body = "";
        req.on("data", function (chunk) { body += chunk; });
        req.on("end", function () {
          try {
            var data = JSON.parse(body);
            if (typeof opts.onSetAutoContinue === "function") {
              opts.onSetAutoContinue(!!data.enabled);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, autoContinueOnRateLimit: !!data.enabled }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid request"}');
          }
        });
        return true;
      }
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var result = users.setAutoContinue(mu.id, !!data.enabled);
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, autoContinueOnRateLimit: result.autoContinueOnRateLimit }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // PUT /api/user/mates-enabled
    if (req.method === "PUT" && fullUrl === "/api/user/mates-enabled") {
      var isMultiUser = users.isMultiUser();
      var mu = getMultiUserFromReq(req);
      if (!isMultiUser) {
        // Single-user: store on daemon config
        var body = "";
        req.on("data", function (chunk) { body += chunk; });
        req.on("end", function () {
          try {
            var data = JSON.parse(body);
            var want = !!data.enabled;
            if (typeof opts.onSetMatesEnabled === "function") {
              opts.onSetMatesEnabled(want);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, matesEnabled: want }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid request"}');
          }
        });
        return true;
      }
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var result = users.setMatesEnabled(mu.id, !!data.enabled);
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, matesEnabled: result.matesEnabled }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // PUT /api/user/chat-layout
    if (req.method === "PUT" && fullUrl === "/api/user/chat-layout") {
      var isMultiUser = users.isMultiUser();
      var mu = getMultiUserFromReq(req);
      if (!isMultiUser) {
        // Single-user: save to daemon config
        var body = "";
        req.on("data", function (chunk) { body += chunk; });
        req.on("end", function () {
          try {
            var data = JSON.parse(body);
            var val = (data.layout === "bubble") ? "bubble" : "channel";
            if (typeof opts.onSetChatLayout === "function") {
              opts.onSetChatLayout(val);
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, chatLayout: val }));
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid request"}');
          }
        });
        return true;
      }
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var result = users.setChatLayout(mu.id, data.layout);
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, chatLayout: result.chatLayout }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // PUT /api/user/project-mate-filter
    if (req.method === "PUT" && fullUrl === "/api/user/project-mate-filter") {
      var isMultiUserFilter = users.isMultiUser();
      var muFilter = getMultiUserFromReq(req);
      if (isMultiUserFilter && !muFilter) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return true;
      }
      var bodyFilter = "";
      req.on("data", function (chunk) { bodyFilter += chunk; });
      req.on("end", function () {
        try {
          var dataFilter = JSON.parse(bodyFilter);
          var resultFilter = users.setProjectMateFilterMode(muFilter ? muFilter.id : null, dataFilter.mode);
          if (resultFilter.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: resultFilter.error }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(resultFilter));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // PUT /api/user/terminal-font
    // Body: { family?: string, size?: number }
    // Per-user terminal font preferences shared across every xterm in
    // the Clay UI (bottom panel, Claude TUI session view, attention
    // modal). Single-user mode persists into daemon config; multi-user
    // mode persists into users.json.
    if (req.method === "PUT" && fullUrl === "/api/user/terminal-font") {
      var isMultiUserTF = users.isMultiUser();
      var muTF = getMultiUserFromReq(req);
      var bodyTF = "";
      req.on("data", function (chunk) { bodyTF += chunk; });
      req.on("end", function () {
        try {
          var dataTF = JSON.parse(bodyTF || "{}");
          if (isMultiUserTF) {
            if (!muTF) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end('{"error":"unauthorized"}');
              return;
            }
            var resultTF = users.setTerminalFont(muTF.id, dataTF.family, dataTF.size);
            if (resultTF.error) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: resultTF.error }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, terminalFont: resultTF.terminalFont }));
          } else {
            if (typeof opts.onSetTerminalFont === "function") {
              var saved = opts.onSetTerminalFont(dataTF.family, dataTF.size);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true, terminalFont: saved }));
            } else {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end('{"error":"single-user font update unsupported"}');
            }
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // POST /api/user/mate-onboarded
    if (req.method === "POST" && fullUrl === "/api/user/mate-onboarded") {
      var isMultiUser = users.isMultiUser();
      var mu = getMultiUserFromReq(req);
      if (!isMultiUser) {
        // Single-user: save to daemon config
        if (typeof opts.onSetMateOnboarded === "function") {
          opts.onSetMateOnboarded();
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } else {
        if (!mu) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end('{"error":"unauthorized"}');
          return true;
        }
        users.setMateOnboarded(mu.id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      }
      return true;
    }

    // GET /api/user/tool-palettes
    if (req.method === "GET" && fullUrl === "/api/user/tool-palettes") {
      var isMultiUser = users.isMultiUser();
      var muGet = getMultiUserFromReq(req);
      var palettes = {};
      if (!isMultiUser) {
        if (typeof opts.onGetToolPalettes === "function") {
          palettes = opts.onGetToolPalettes() || {};
        }
      } else {
        if (!muGet) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end('{"error":"unauthorized"}');
          return true;
        }
        palettes = users.getToolPalettes(muGet.id) || {};
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(palettes));
      return true;
    }

    // PUT /api/user/tool-palettes
    if (req.method === "PUT" && fullUrl === "/api/user/tool-palettes") {
      var isMultiUser = users.isMultiUser();
      var muPut = getMultiUserFromReq(req);
      var bodyTp = "";
      req.on("data", function (chunk) { bodyTp += chunk; });
      req.on("end", function () {
        try {
          var dataTp = JSON.parse(bodyTp);
          var paletteName = dataTp.palette;
          var order = dataTp.order;
          var hidden = dataTp.hidden;
          var result;
          if (!isMultiUser) {
            if (typeof opts.onSetToolPalette !== "function") {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end('{"error":"Not supported"}');
              return;
            }
            result = opts.onSetToolPalette(paletteName, order, hidden);
          } else {
            if (!muPut) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end('{"error":"unauthorized"}');
              return;
            }
            result = users.setToolPalette(muPut.id, paletteName, order, hidden);
          }
          if (result && result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // GET /api/user/auto-continue
    if (req.method === "GET" && fullUrl === "/api/user/auto-continue") {
      var mu = getMultiUserFromReq(req);
      if (!mu) {
        // Single-user: read from daemon config
        var enabled = false;
        if (typeof opts.onGetDaemonConfig === "function") {
          var dc = opts.onGetDaemonConfig();
          enabled = !!dc.autoContinueOnRateLimit;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ autoContinueOnRateLimit: enabled }));
        return true;
      }
      var val = users.getAutoContinue(mu.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ autoContinueOnRateLimit: val }));
      return true;
    }

    return false;
  }

  return { handleRequest: handleRequest };
}

module.exports = { attachSettings: attachSettings };
