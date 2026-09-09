// Admin API endpoints (multi-user mode only)
// Extracted from server.js

function attachAdmin(ctx) {
  var users = ctx.users;
  var smtp = ctx.smtp;
  var getMultiUserFromReq = ctx.getMultiUserFromReq;
  var projects = ctx.projects;
  var osUsers = ctx.osUsers;
  var tlsOptions = ctx.tlsOptions;
  var portNum = ctx.portNum;
  var provisionLinuxUser = ctx.provisionLinuxUser;
  var onUserProvisioned = ctx.onUserProvisioned;
  var onUserDeleted = ctx.onUserDeleted;
  var revokeUserTokens = ctx.revokeUserTokens;
  var onSetProjectVisibility = ctx.onSetProjectVisibility;
  var onSetProjectAllowedUsers = ctx.onSetProjectAllowedUsers;
  var onGetProjectAccess = ctx.onGetProjectAccess;
  var onProjectOwnerChanged = ctx.onProjectOwnerChanged;

  function handleRequest(req, res, fullUrl) {

    // --- Admin API endpoints (multi-user mode only) ---

    // List all users (admin only)
    if (req.method === "GET" && fullUrl === "/api/admin/users") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"Authentication required"}');
        return true;
      }
      // Admins get full user list; project owners get limited list (id, displayName, username)
      if (mu.role === "admin") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users: users.getAllUsers() }));
      } else {
        var allU = users.getAllUsers();
        var safeUsers = allU.map(function (u) {
          return { id: u.id, displayName: u.displayName, username: u.username };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users: safeUsers }));
      }
      return true;
    }

    // Remove user (admin only)
    if (req.method === "DELETE" && fullUrl.indexOf("/api/admin/users/") === 0) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var targetUserId = fullUrl.substring("/api/admin/users/".length);
      if (targetUserId === mu.id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Cannot remove yourself"}');
        return true;
      }
      // Look up the user before deletion to get linuxUser for deactivation
      var targetUser = users.findUserById(targetUserId);
      var targetLinuxUser = targetUser ? targetUser.linuxUser : null;
      var result = users.removeUser(targetUserId);
      if (result.error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return true;
      }
      // Remove auth tokens for deleted user
      revokeUserTokens(targetUserId);
      // Deactivate the Linux account if applicable
      if (onUserDeleted && targetLinuxUser) {
        onUserDeleted(targetUserId, targetLinuxUser);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return true;
    }

    // Create user (admin only) — generates a temporary PIN that must be changed on first login
    if (req.method === "POST" && fullUrl === "/api/admin/users") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.username || typeof data.username !== "string" || data.username.trim().length < 1) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Username is required"}');
            return;
          }
          var result = users.createUserByAdmin({
            username: data.username.trim(),
            displayName: data.displayName ? data.displayName.trim() : data.username.trim(),
            email: data.email ? data.email.trim() : null,
            role: data.role === "admin" ? "admin" : "user",
          });
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          // Auto-provision Linux account if OS users mode is enabled
          if (osUsers && !result.user.linuxUser) {
            var provision = provisionLinuxUser(result.user.username);
            if (provision.ok) {
              users.updateLinuxUser(result.user.id, provision.linuxUser);
              if (onUserProvisioned) onUserProvisioned(result.user.id, provision.linuxUser);
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            user: {
              id: result.user.id,
              username: result.user.username,
              displayName: result.user.displayName,
              role: result.user.role,
            },
            tempPin: result.tempPin,
          }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Reset user PIN (admin only) — generates a new temp PIN
    if (req.method === "POST" && fullUrl.match(/^\/api\/admin\/users\/[^/]+\/reset-pin$/)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var urlParts = fullUrl.split("/");
      var targetUserId = urlParts[4]; // /api/admin/users/{userId}/reset-pin
      var targetUser = users.findUserById(targetUserId);
      if (!targetUser) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"User not found"}');
        return true;
      }
      var newPin = users.generatePin();
      var pinResult = users.updateUserPin(targetUserId, newPin);
      if (pinResult.error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: pinResult.error }));
        return true;
      }
      // Mark as must change on next login
      var data = users.loadUsers();
      for (var i = 0; i < data.users.length; i++) {
        if (data.users[i].id === targetUserId) {
          data.users[i].mustChangePin = true;
          users.saveUsers(data);
          break;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, tempPin: newPin }));
      return true;
    }

    // Set Linux user mapping (admin only, OS-level multi-user)
    if (req.method === "PUT" && fullUrl.match(/^\/api\/admin\/users\/[^/]+\/linux-user$/)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var urlParts = fullUrl.split("/");
      var targetUserId = urlParts[4]; // /api/admin/users/{userId}/linux-user
      var body = "";
      req.on("data", function(chunk) { body += chunk; });
      req.on("end", function() {
        try {
          var parsed = JSON.parse(body);
          var result = users.updateLinuxUser(targetUserId, parsed.linuxUser || null);
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request body"}');
        }
      });
      return true;
    }

    // Update user permissions (admin only)
    if (req.method === "PUT" && fullUrl.match(/^\/api\/admin\/users\/[^/]+\/permissions$/)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var urlParts = fullUrl.split("/");
      var targetUserId = urlParts[4]; // /api/admin/users/{userId}/permissions
      var body = "";
      req.on("data", function(chunk) { body += chunk; });
      req.on("end", function() {
        try {
          var parsed = JSON.parse(body);
          var result = users.updateUserPermissions(targetUserId, parsed.permissions || {});
          if (result.error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, permissions: result.permissions }));
          }
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request body"}');
        }
      });
      return true;
    }

    // Create invite (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/invites") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var invite = users.createInvite(mu.id);
      var proto = tlsOptions ? "https" : "http";
      var host = req.headers.host || ("localhost:" + portNum);
      var inviteUrl = proto + "://" + host + "/invite/" + invite.code;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, invite: invite, url: inviteUrl }));
      return true;
    }

    // List invites (admin only)
    if (req.method === "GET" && fullUrl === "/api/admin/invites") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ invites: users.getInvites() }));
      return true;
    }

    // Revoke invite (admin only)
    if (req.method === "DELETE" && fullUrl.indexOf("/api/admin/invites/") === 0) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var inviteCode = decodeURIComponent(fullUrl.replace("/api/admin/invites/", ""));
      if (!inviteCode) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invite code is required"}');
        return true;
      }
      var result = users.revokeInvite(inviteCode);
      if (result.error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return true;
    }

    // Send invite via email (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/invites/email") {
      if (!users.isMultiUser() || !smtp.isSmtpConfigured()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"SMTP not configured"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Valid email is required"}');
            return;
          }
          var invite = users.createInvite(mu.id, data.email);
          var proto = tlsOptions ? "https" : "http";
          var host = req.headers.host || ("localhost:" + portNum);
          var inviteUrl = proto + "://" + host + "/invite/" + invite.code;
          smtp.sendInviteEmail(data.email, inviteUrl, mu.displayName || mu.username).then(function () {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, invite: invite, url: inviteUrl }));
          }).catch(function (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to send email: " + (err.message || "unknown error") }));
          });
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Get SMTP config (admin only)
    if (req.method === "GET" && fullUrl === "/api/admin/smtp") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var cfg = smtp.getSmtpConfig();
      if (cfg) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ smtp: { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: "••••••••", from: cfg.from, emailLoginEnabled: !!cfg.emailLoginEnabled } }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"smtp":null}');
      }
      return true;
    }

    // Save SMTP config (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/smtp") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          // Allow clearing SMTP config by sending empty fields
          if (!data.host && !data.user && !data.pass && !data.from) {
            smtp.saveSmtpConfig(null);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
            return;
          }
          if (!data.host || !data.user || !data.pass || !data.from) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Host, user, password, and from address are required"}');
            return;
          }
          // If password is masked, keep existing
          var existingCfg = smtp.getSmtpConfig();
          var pass = data.pass;
          if (pass === "••••••••" && existingCfg) {
            pass = existingCfg.pass;
          }
          smtp.saveSmtpConfig({
            host: data.host,
            port: parseInt(data.port, 10) || 587,
            secure: !!data.secure,
            user: data.user,
            pass: pass,
            from: data.from,
            emailLoginEnabled: !!data.emailLoginEnabled,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Test SMTP connection (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/smtp/test") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          // Use provided config or fall back to saved
          var existingCfg = smtp.getSmtpConfig();
          var pass = data.pass;
          if (pass === "••••••••" && existingCfg) {
            pass = existingCfg.pass;
          }
          var cfg = {
            host: data.host || (existingCfg && existingCfg.host),
            port: parseInt(data.port, 10) || (existingCfg && existingCfg.port) || 587,
            secure: data.secure !== undefined ? !!data.secure : (existingCfg && !!existingCfg.secure),
            user: data.user || (existingCfg && existingCfg.user),
            pass: pass || (existingCfg && existingCfg.pass),
            from: data.from || (existingCfg && existingCfg.from),
          };
          if (!cfg.host || !cfg.user || !cfg.pass || !cfg.from) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"SMTP configuration is incomplete"}');
            return;
          }
          var testTo = mu.email || cfg.from;
          smtp.sendTestEmail(cfg, testTo).then(function (result) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, message: "Test email sent to " + testTo }));
          }).catch(function (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err.message || "Connection failed" }));
          });
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // --- Project access control (admin only, multi-user) ---

    // Set project visibility (admin only)
    if (req.method === "PUT" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/visibility$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      var _visSlug = fullUrl.split("/")[4];
      var _visAccess = onGetProjectAccess ? onGetProjectAccess(_visSlug) : null;
      var _isOwner = mu && _visAccess && _visAccess.ownerId && mu.id === _visAccess.ownerId;
      if (!mu || (mu.role !== "admin" && !_isOwner)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin or project owner access required"}');
        return true;
      }
      var projSlug = fullUrl.split("/")[4];
      if (projSlug.indexOf("--") !== -1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Worktree projects inherit parent visibility"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (data.visibility !== "public" && data.visibility !== "private") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Visibility must be public or private"}');
            return;
          }
          if (!onSetProjectVisibility) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end('{"error":"Visibility handler not configured"}');
            return;
          }
          var result = onSetProjectVisibility(projSlug, data.visibility);
          if (result && result.error) {
            res.writeHead(404, { "Content-Type": "application/json" });
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

    // Set project owner (admin only)
    if (req.method === "PUT" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/owner$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return true;
      }
      var projSlug = fullUrl.split("/")[4];
      if (projSlug.indexOf("--") !== -1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Worktree projects inherit parent settings"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var targetCtx = projects.get(projSlug);
          if (!targetCtx) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end('{"error":"Project not found"}');
            return;
          }
          var ownerId = data.userId || null;
          targetCtx.setProjectOwner(ownerId);
          if (onProjectOwnerChanged) {
            onProjectOwnerChanged(projSlug, ownerId);
          }
          // Broadcast to project clients
          var ownerName = null;
          if (ownerId) {
            var ownerUser = users.findUserById(ownerId);
            ownerName = ownerUser ? (ownerUser.displayName || ownerUser.username) : ownerId;
          }
          targetCtx.send({ type: "project_owner_changed", ownerId: ownerId, ownerName: ownerName });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Set project allowed users (admin only)
    if (req.method === "PUT" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/users$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      var _usrSlug = fullUrl.split("/")[4];
      var _usrAccess = onGetProjectAccess ? onGetProjectAccess(_usrSlug) : null;
      var _isOwnerU = mu && _usrAccess && _usrAccess.ownerId && mu.id === _usrAccess.ownerId;
      if (!mu || (mu.role !== "admin" && !_isOwnerU)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin or project owner access required"}');
        return true;
      }
      var projSlug = fullUrl.split("/")[4];
      if (!projects.get(projSlug)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Project not found"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!Array.isArray(data.allowedUsers)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"allowedUsers must be an array"}');
            return;
          }
          if (!onSetProjectAllowedUsers) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end('{"error":"AllowedUsers handler not configured"}');
            return;
          }
          var result = onSetProjectAllowedUsers(projSlug, data.allowedUsers);
          if (result && result.error) {
            res.writeHead(404, { "Content-Type": "application/json" });
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

    // Get project access info (admin or project owner)
    if (req.method === "GET" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/access$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return true;
      }
      var mu = getMultiUserFromReq(req);
      var _accSlug = fullUrl.split("/")[4];
      var _accAccess = onGetProjectAccess ? onGetProjectAccess(_accSlug) : null;
      var _isOwnerA = mu && _accAccess && _accAccess.ownerId && mu.id === _accAccess.ownerId;
      if (!mu || (mu.role !== "admin" && !_isOwnerA)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin or project owner access required"}');
        return true;
      }
      var projSlug = fullUrl.split("/")[4];
      if (!onGetProjectAccess) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"error":"Access handler not configured"}');
        return true;
      }
      var access = onGetProjectAccess(projSlug);
      if (access && access.error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: access.error }));
        return true;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(access));
      return true;
    }

    return false;
  }

  return {
    handleRequest: handleRequest,
  };
}

module.exports = { attachAdmin: attachAdmin };
