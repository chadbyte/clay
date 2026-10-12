var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { CONFIG_DIR } = require("./config");
var _isDevMode = require("./config").isDevMode;

// --- PIN hashing ---

function generateAuthToken(pin) {
  var salt = crypto.randomBytes(16).toString("hex");
  var hash = crypto.scryptSync("clay:" + pin, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function verifyPin(pin, storedHash) {
  if (!storedHash) return false;
  // New scrypt format: salt_hex:hash_hex (contains colon)
  if (storedHash.indexOf(":") !== -1) {
    var parts = storedHash.split(":");
    var salt = parts[0];
    var hash = parts[1];
    var derived = crypto.scryptSync("clay:" + pin, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(hash, "hex"));
  }
  // Legacy SHA256 format (no colon)
  var legacyHash = crypto.createHash("sha256").update("clay:" + pin).digest("hex");
  var match = crypto.timingSafeEqual(Buffer.from(legacyHash, "hex"), Buffer.from(storedHash, "hex"));
  return match;
}

// --- Cookie helpers ---

function parseCookies(req) {
  var cookies = {};
  var header = req.headers.cookie || "";
  header.split(";").forEach(function (part) {
    var pair = part.trim().split("=");
    if (pair.length === 2) cookies[pair[0]] = pair[1];
  });
  return cookies;
}

function isAuthed(req, authToken) {
  if (!authToken) return true;
  var cookies = parseCookies(req);
  return cookies["relay_auth"] === authToken;
}

// --- PIN rate limiting ---

var PIN_MAX_ATTEMPTS = 5;
var PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function attachAuth(ctx) {
  var users = ctx.users;
  var smtp = ctx.smtp;
  var pages = ctx.pages;
  var tlsOptions = ctx.tlsOptions;
  var osUsers = ctx.osUsers;
  var provisionLinuxUser = ctx.provisionLinuxUser;
  var onUpgradePin = ctx.onUpgradePin;
  var onUserProvisioned = ctx.onUserProvisioned;

  var authToken = ctx.pinHash || null;

  // --- Multi-user auth tokens (persisted to disk) ---
  var TOKENS_FILE = path.join(CONFIG_DIR, _isDevMode ? "auth-tokens-dev.json" : "auth-tokens.json");
  var MULTI_USER_COOKIE = _isDevMode ? "relay_auth_user_dev" : "relay_auth_user";
  var accountPolicy = require('./account-auth-policy').attachPolicy(users);
  var transport = require('./account-auth-transport').attachTransport({ users: users, tlsOptions: tlsOptions });
  var sessionStore = require('./account-session-store').attachSessionStore({
    file: TOKENS_FILE, managed: accountPolicy.available, clientAddress: transport.clientAddress,
  });
  var throttle = require('./account-auth-throttle').attachThrottle({
    file: path.join(CONFIG_DIR, _isDevMode ? 'auth-attempts-dev.json' : 'auth-attempts.json'), clientAddress: transport.clientAddress,
  });
  function sessionToken(req) { return parseCookies(req)[MULTI_USER_COOKIE]; }
  function createMultiUserSession(userId, credential, passkeyId, secure, req) {
    var created = sessionStore.create(userId, credential, passkeyId, req, req && sessionToken(req));
    var age = created.entry.expiresAt ? Math.max(0, Math.floor((created.entry.expiresAt - Date.now()) / 1000)) : 31536000;
    var cookie = MULTI_USER_COOKIE + '=' + created.token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age +
      (tlsOptions || secure || req && transport.info(req).secure ? '; Secure' : '');
    return { token: created.token, cookie: cookie };
  }
  function validSessionUser(record) {
    var user = record && users.findUserById(record.userId);
    if (!user) return null;
    if (record.passkeyId && (!require('./account-passkey-policy').configured(users.loadUsers()) ||
      !(user.passkeys || []).some(function (key) { return key.id === record.passkeyId; }))) return null;
    if (accountPolicy.requiresPassword(user) && (!user.passwordHash || user.mustChangePin ||
      record.credentialVersion !== require('./account-session-store').digest(user.passwordHash))) return null;
    return user;
  }
  function getMultiUserFromReq(req) {
    if (accountPolicy.enabled() && !transport.allows(req, false)) return null;
    var token = sessionToken(req);
    var record = sessionStore.get(token, false);
    var user = validSessionUser(record);
    if (user) {
      if (!req.claySessionPassive) sessionStore.get(token, true, req);
      return user;
    }
    return users.getSoloNoPinUser() || null;
  }
  function touchSession(req) {
    if (getMultiUserFromReq(req)) sessionStore.get(sessionToken(req), true, req);
  }
  function isMultiUserAuthed(req) { return !!getMultiUserFromReq(req); }
  function revokeUserTokens(userId) { sessionStore.revokeUser(userId); }
  function allowAttempt(req, res, username) {
    try { throttle.consume(req, username); return true; }
    catch (error) {
      res.writeHead(error.status || 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: error.message })); return false;
    }
  }

  // --- PIN rate limiting (per-instance state) ---
  var pinAttempts = {};

  function checkPinRateLimit(ip) {
    var entry = pinAttempts[ip];
    if (!entry) return null;
    if (entry.count >= PIN_MAX_ATTEMPTS) {
      var elapsed = Date.now() - entry.lastAttempt;
      if (elapsed < PIN_LOCKOUT_MS) {
        return Math.ceil((PIN_LOCKOUT_MS - elapsed) / 1000);
      }
      delete pinAttempts[ip];
    }
    return null;
  }

  function recordPinFailure(ip) {
    if (!pinAttempts[ip]) pinAttempts[ip] = { count: 0, lastAttempt: 0 };
    pinAttempts[ip].count++;
    pinAttempts[ip].lastAttempt = Date.now();
  }

  function clearPinFailures(ip) {
    delete pinAttempts[ip];
  }

  // --- Admin password recovery (in-memory, one-time) ---
  var recovery = null;

  function setRecovery(urlPath, password) {
    recovery = { urlPath: urlPath, password: password, until: Date.now() + 15 * 60000 };
  }

  function clearRecovery() {
    recovery = null;
  }

  function recoveryPageHtml() {
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Admin Password Recovery</title>'
      + '<style>'
      + '*{margin:0;padding:0;box-sizing:border-box}'
      + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}'
      + '.card{background:#171717;border:1px solid #262626;border-radius:12px;padding:32px;width:100%;max-width:380px}'
      + 'h1{font-size:18px;font-weight:600;margin-bottom:4px}'
      + '.sub{font-size:13px;color:#737373;margin-bottom:24px}'
      + 'label{display:block;font-size:13px;color:#a3a3a3;margin-bottom:6px}'
      + 'input{width:100%;padding:10px 12px;background:#0a0a0a;border:1px solid #333;border-radius:8px;color:#e5e5e5;font-size:14px;outline:none;margin-bottom:16px}'
      + 'input:focus{border-color:#7c3aed}'
      + 'button{width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer}'
      + 'button:hover{background:#6d28d9}'
      + 'button:disabled{opacity:.5;cursor:not-allowed}'
      + '.error{color:#ef4444;font-size:13px;margin-bottom:12px;display:none}'
      + '.success{text-align:center;color:#22c55e;font-size:15px}'
      + '.hidden{display:none}'
      + '</style></head><body>'
      + '<div class="card">'
      + '<div id="step-verify">'
      + '<h1>Admin Recovery</h1>'
      + '<p class="sub">Enter the recovery password shown in your terminal.</p>'
      + '<div id="err-verify" class="error"></div>'
      + '<label for="recovery-pw">Recovery password</label>'
      + '<input id="recovery-pw" type="text" autocomplete="off" spellcheck="false" autofocus>'
      + '<button id="btn-verify">Verify</button>'
      + '</div>'
      + '<div id="step-reset" class="hidden">'
      + '<h1>Reset Admin PIN</h1>'
      + '<p class="sub">Enter a new 6-digit PIN for the admin account.</p>'
      + '<div id="err-reset" class="error"></div>'
      + '<label for="new-pin">New PIN</label>'
      + '<input id="new-pin" type="password" maxlength="6" pattern="\\d{6}" inputmode="numeric" placeholder="6 digits">'
      + '<label for="confirm-pin">Confirm PIN</label>'
      + '<input id="confirm-pin" type="password" maxlength="6" pattern="\\d{6}" inputmode="numeric" placeholder="6 digits">'
      + '<button id="btn-reset">Reset PIN</button>'
      + '</div>'
      + '<div id="step-done" class="hidden">'
      + '<p class="success">PIN has been reset successfully. You can now log in with your new PIN.</p>'
      + '</div>'
      + '</div>'
      + '<script>'
      + 'var pw="";\n'
      + 'document.getElementById("btn-verify").onclick=function(){\n'
      + '  var el=document.getElementById("recovery-pw");\n'
      + '  pw=el.value.trim();\n'
      + '  if(!pw)return;\n'
      + '  this.disabled=true;\n'
      + '  fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({step:"verify",password:pw})})\n'
      + '  .then(function(r){return r.json()}).then(function(d){\n'
      + '    if(d.ok){document.getElementById("step-verify").classList.add("hidden");document.getElementById("step-reset").classList.remove("hidden");document.getElementById("new-pin").focus()}\n'
      + '    else{var e=document.getElementById("err-verify");e.textContent=d.error||"Invalid password";e.style.display="block";document.getElementById("btn-verify").disabled=false}\n'
      + '  }).catch(function(){document.getElementById("btn-verify").disabled=false})\n'
      + '};\n'
      + 'document.getElementById("recovery-pw").addEventListener("keydown",function(e){if(e.key==="Enter")document.getElementById("btn-verify").click()});\n'
      + 'document.getElementById("btn-reset").onclick=function(){\n'
      + '  var pin=document.getElementById("new-pin").value;\n'
      + '  var confirm=document.getElementById("confirm-pin").value;\n'
      + '  var errEl=document.getElementById("err-reset");\n'
      + '  if(!/^\\d{6}$/.test(pin)){errEl.textContent="PIN must be exactly 6 digits";errEl.style.display="block";return}\n'
      + '  if(pin!==confirm){errEl.textContent="PINs do not match";errEl.style.display="block";return}\n'
      + '  this.disabled=true;errEl.style.display="none";\n'
      + '  fetch(location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({step:"reset",password:pw,pin:pin})})\n'
      + '  .then(function(r){return r.json()}).then(function(d){\n'
      + '    if(d.ok){document.getElementById("step-reset").classList.add("hidden");document.getElementById("step-done").classList.remove("hidden")}\n'
      + '    else{errEl.textContent=d.error||"Failed";errEl.style.display="block";document.getElementById("btn-reset").disabled=false}\n'
      + '  }).catch(function(){document.getElementById("btn-reset").disabled=false})\n'
      + '};\n'
      + 'document.getElementById("confirm-pin").addEventListener("keydown",function(e){if(e.key==="Enter")document.getElementById("btn-reset").click()});\n'
      + '</script></body></html>';
  }

  // --- Auth page selection ---
  var pinPage = pages.pinPageHtml();
  var adminSetupPage = pages.adminSetupPageHtml();
  var loginPage = pages.multiUserLoginPageHtml();
  var smtpLoginPage = pages.smtpLoginPageHtml();

  function getAuthPage() {
    if (!users.isMultiUser()) return pinPage;
    if (accountPasswords.policy.enabled()) return require('./account-password-page').render();
    if (!users.hasAdmin()) return adminSetupPage;
    if (smtp.isEmailLoginEnabled()) return smtpLoginPage;
    return loginPage;
  }

  function isRequestAuthed(req) {
    if (users.isMultiUser()) return isMultiUserAuthed(req);
    return isAuthed(req, authToken);
  }

  function setAuthToken(hash) {
    authToken = hash;
  }

  // --- Route handler ---

  function handleRequest(req, res, fullUrl) {
    if (accountPolicy.enabled() && transport.info(req).secure && typeof res.setHeader === 'function') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if ((accountPolicy.enabled() || fullUrl === '/api/account-auth-policy' && req.method === 'PUT') && /^(?:\/auth\/(?!passkey-browser\.js)|\/api\/(?:account-auth-policy|passkey-policy|passkeys|account-sessions|account-transport|user\/pin|admin\/users|profile)|\/recover\/)/.test(fullUrl) &&
      !transport.allows(req, ['GET', 'HEAD', 'OPTIONS'].indexOf(req.method) === -1)) {
      res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Use HTTPS and the same Clay address for account requests. Reverse proxies must be explicitly configured.' })); return true;
    }
    if (accountSecurity.handleRequest(req, res, fullUrl)) return true;
    if (accountPasskeys.handleRequest(req, res, fullUrl)) return true;
    if (accountPasswords.handleRequest(req, res, fullUrl)) return true;
    // Admin password recovery
    if (recovery && fullUrl === "/recover/" + recovery.urlPath) {
      if (recovery.until <= Date.now()) {
        recovery = null; res.writeHead(410, { 'Content-Type': 'application/json' }); res.end('{"error":"Recovery expired. Enable a new recovery link from the server terminal."}'); return true;
      }
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(recoveryPageHtml());
        return true;
      }
      if (req.method === "POST") {
        var ip = req.socket.remoteAddress || "";
        var remaining = checkPinRateLimit(ip);
        if (remaining !== null) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
          return true;
        }
        var body = "";
        req.on("data", function (chunk) { body += chunk; });
        req.on("end", function () {
          try {
            var data = JSON.parse(body);
            if (!allowAttempt(req, res, 'admin-recovery')) return;
            if (!recovery || recovery.until <= Date.now()) throw new Error('Recovery expired.');
            if (data.step === "verify") {
              if (!data.password || data.password !== recovery.password) {
                recordPinFailure(ip);
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end('{"error":"Invalid recovery password"}');
                return;
              }
              clearPinFailures(ip);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end('{"ok":true}');
            } else if (data.step === "reset") {
              if (!data.password || data.password !== recovery.password) {
                res.writeHead(401, { "Content-Type": "application/json" });
                res.end('{"error":"Invalid recovery password"}');
                return;
              }
              if (!data.pin || !/^\d{6}$/.test(data.pin)) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end('{"error":"PIN must be exactly 6 digits"}');
                return;
              }
              var admin = users.findAdmin();
              if (!admin) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end('{"error":"No admin account found"}');
                return;
              }
              var reset = users.updateUserPin(admin.id, data.pin);
              if (!reset.ok) throw new Error('Could not reset the administrator account.');
              revokeUserTokens(admin.id);
              recovery = null;
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end('{"ok":true}');
            } else {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"Invalid step"}');
            }
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid request"}');
          }
        });
        return true;
      }
    }

    // Global auth endpoint (single-user PIN)
    if (req.method === "POST" && req.url === "/auth") {
      if (users.isMultiUser()) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'Server PIN sign-in is unavailable. Sign in with your account.' }));
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (authToken && verifyPin(data.pin, authToken)) {
            clearPinFailures(ip);
            // Auto-upgrade legacy SHA256 hash to scrypt
            if (authToken.indexOf(":") === -1) {
              var upgraded = generateAuthToken(data.pin);
              authToken = upgraded;
              if (typeof onUpgradePin === "function") {
                onUpgradePin(upgraded);
              }
            }
            res.writeHead(200, {
              "Set-Cookie": "relay_auth=" + authToken + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000" + (tlsOptions ? "; Secure" : ""),
              "Content-Type": "application/json",
            });
            res.end('{"ok":true}');
          } else {
            recordPinFailure(ip);
            var attemptsLeft = PIN_MAX_ATTEMPTS - (pinAttempts[ip] ? pinAttempts[ip].count : 0);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, attemptsLeft: Math.max(attemptsLeft, 0) }));
          }
        } catch (e) {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return true;
    }

    // Admin setup (first-time multi-user setup)
    if (req.method === "POST" && fullUrl === "/auth/setup") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return true;
      }
      if (users.hasAdmin()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Admin already exists"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!users.validateSetupCode(data.setupCode)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"error":"Invalid setup code"}');
            return;
          }
          if (!data.username || data.username.trim().length < 1 || data.username.length > 100) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Username is required"}');
            return;
          }
          if (!data.pin || !/^\d{6}$/.test(data.pin)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"PIN must be exactly 6 digits"}');
            return;
          }
          // Migrate existing profile.json to admin profile
          var adminProfile = undefined;
          try {
            var existingProfile = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "profile.json"), "utf8"));
            adminProfile = {
              name: data.displayName || data.username,
              lang: existingProfile.lang || "en-US",
              avatarColor: existingProfile.avatarColor || "#5857fc",
              avatarStyle: existingProfile.avatarStyle || "imprint",
              avatarSeed: existingProfile.avatarSeed || crypto.randomBytes(4).toString("hex"),
            };
          } catch (e) {}
          var result = users.createAdmin({
            username: data.username.trim(),
            displayName: data.displayName || data.username.trim(),
            pin: data.pin,
            profile: adminProfile,
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
          users.clearSetupCode();
          var session = createMultiUserSession(result.user.id, null, null, false, req);
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true, user: { id: result.user.id, username: result.user.username, role: result.user.role } }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Multi-user login
    if (req.method === "POST" && fullUrl === "/auth/login") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!allowAttempt(req, res, data.username)) return;
          var user = users.authenticateUser(data.username, data.pin);
          if (!user) {
            recordPinFailure(ip);
            var attemptsLeft = PIN_MAX_ATTEMPTS - (pinAttempts[ip] ? pinAttempts[ip].count : 0);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid username or PIN", attemptsLeft: Math.max(attemptsLeft, 0) }));
            return;
          }
          clearPinFailures(ip);
          throttle.success(req, data.username);
          var session = createMultiUserSession(user.id, null, null, false, req);
          var loginResp = { ok: true, user: { id: user.id, username: user.username, role: user.role } };
          if (user.mustChangePin) loginResp.mustChangePin = true;
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify(loginResp));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Request OTP code (SMTP login)
    if (req.method === "POST" && fullUrl === "/auth/request-otp") {
      if (!users.isMultiUser() || !smtp.isEmailLoginEnabled()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"OTP login not available"}');
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.email) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Email is required"}');
            return;
          }
          var user = users.findUserByEmail(data.email);
          if (!user) {
            // Don't reveal whether user exists
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
            return;
          }
          if (!allowAttempt(req, res, 'email:' + String(data.email).toLowerCase())) return;
          var result = smtp.requestOtp(data.email);
          if (result.error) {
            res.writeHead(429, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: result.error }));
            return;
          }
          smtp.sendOtpEmail(data.email, result.code).then(function () {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          }).catch(function () {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end('{"error":"Failed to send email"}');
          });
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Verify OTP code (SMTP login)
    if (req.method === "POST" && fullUrl === "/auth/verify-otp") {
      if (!users.isMultiUser() || !smtp.isEmailLoginEnabled()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"OTP login not available"}');
        return true;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          if (!data.email || !data.code) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Email and code are required"}');
            return;
          }
          if (!allowAttempt(req, res, 'email:' + String(data.email).toLowerCase())) return;
          var otpResult = smtp.verifyOtp(data.email, data.code);
          if (!otpResult.valid) {
            recordPinFailure(ip);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: otpResult.error, attemptsLeft: otpResult.attemptsLeft }));
            return;
          }
          var user = users.findUserByEmail(data.email);
          if (!user) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end('{"ok":false,"error":"Account not found"}');
            return;
          }
          clearPinFailures(ip);
          var session = createMultiUserSession(user.id, null, null, false, req);
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true, user: { id: user.id, username: user.username, role: user.role } }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Invite registration
    if (req.method === "POST" && fullUrl === "/auth/register") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return true;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var validation = users.validateInvite(data.inviteCode);
          if (!validation.valid) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: validation.error }));
            return;
          }
          if (!data.username || data.username.trim().length < 1 || data.username.length > 100) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end('{"error":"Username is required"}');
            return;
          }
          var result;
          if (smtp.isEmailLoginEnabled() && !data.pin && !accountPasswords.policy.enabled()) {
            // SMTP mode: username + email required, no PIN
            if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"A valid email address is required"}');
              return;
            }
            result = users.createUserWithoutPin({
              username: data.username.trim(),
              email: data.email,
              displayName: data.displayName || data.username.trim(),
              role: "user",
            });
          } else {
            // PIN mode: username + PIN, no email required
            if (!data.pin || !/^\d{6}$/.test(data.pin)) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end('{"error":"PIN must be exactly 6 digits"}');
              return;
            }
            result = users.createUser({
              username: data.username.trim(),
              email: data.email || null,
              displayName: data.displayName || data.username.trim(),
              pin: data.pin,
              role: "user",
            });
          }
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
          users.markInviteUsed(data.inviteCode);
          var session = createMultiUserSession(result.user.id, null, null, false, req);
          res.writeHead(200, {
            "Set-Cookie": session.cookie,
            "Content-Type": "application/json",
          });
          res.end(JSON.stringify({ ok: true, user: { id: result.user.id, username: result.user.username, role: result.user.role } }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end('{"error":"Invalid request"}');
        }
      });
      return true;
    }

    // Logout
    if (req.method === "POST" && fullUrl === "/auth/logout") {
      if (users.isMultiUser()) {
        var cookies = parseCookies(req);
        var token = cookies[MULTI_USER_COOKIE];
        try { sessionStore.revokeToken(token); } catch (error) {
          res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"Could not persist sign-out. Please retry."}'); return true;
        }
        res.writeHead(200, {
          "Set-Cookie": MULTI_USER_COOKIE + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (tlsOptions || transport.info(req).secure ? "; Secure" : ""),
          "Content-Type": "application/json",
        });
      } else {
        res.writeHead(200, {
          "Set-Cookie": "relay_auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + (tlsOptions || transport.info(req).secure ? "; Secure" : ""),
          "Content-Type": "application/json",
        });
      }
      res.end('{"ok":true}');
      return true;
    }

    // Invite page (magic link)
    if (req.method === "GET" && fullUrl.indexOf("/invite/") === 0) {
      var inviteCode = fullUrl.substring("/invite/".length);
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return true;
      }
      var validation = users.validateInvite(inviteCode);
      if (!validation.valid) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end('<!DOCTYPE html><html><head><title>Clay</title>' +
          '<style>body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
          '.c{text-align:center;max-width:360px;padding:20px}h1{color:#DA7756;margin-bottom:16px}p{color:#908B81}</style></head>' +
          '<body><div class="c"><h1>Clay</h1><p>' + (validation.error === "Invite expired" ? "This invite link has expired." : validation.error === "Invite already used" ? "This invite link has already been used." : "Invalid invite link.") + '</p></div></body></html>');
        return true;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(smtp.isEmailLoginEnabled() && !accountPasswords.policy.enabled() ? pages.smtpInvitePageHtml(inviteCode) : pages.invitePageHtml(inviteCode));
      return true;
    }

    return false;
  }

  var accountPasswords = require('./server-account-passwords').attachAccountPasswords({
    users: users, devMode: _isDevMode, tlsOptions: tlsOptions, parseCookies: parseCookies,
    getUser: getMultiUserFromReq, createSession: createMultiUserSession, revokeSessions: revokeUserTokens,
    onPolicyChanged: ctx.onAccountPolicyChanged, throttle: throttle, transport: transport,
  });
  var accountPasskeys = require('./server-account-passkeys').attachAccountPasskeys({
    users: users, devMode: _isDevMode, parseCookies: parseCookies, http: accountPasswords.http,
    getUser: getMultiUserFromReq, createSession: createMultiUserSession,
    sessionToken: sessionToken, clientAddress: transport.clientAddress,
  });

  var accountSecurity = require('./server-account-security').attachAccountSecurity({
    users: users, getUser: getMultiUserFromReq, sessionToken: sessionToken, sessions: sessionStore,
    validSessionUser: validSessionUser, http: accountPasswords.http, transport: transport,
  });

  return {
    touchSession: touchSession,
    handleRequest: handleRequest,
    getMultiUserFromReq: getMultiUserFromReq,
    isRequestAuthed: isRequestAuthed,
    parseCookies: parseCookies,
    revokeUserTokens: revokeUserTokens,
    setRecovery: setRecovery,
    clearRecovery: clearRecovery,
    setAuthToken: setAuthToken,
    getAuthPage: getAuthPage,
    createMultiUserSession: createMultiUserSession,
  };
}

module.exports = { attachAuth: attachAuth, generateAuthToken: generateAuthToken, verifyPin: verifyPin };
