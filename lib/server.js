var http = require("http");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { WebSocketServer } = require("ws");
var { pinPageHtml, setupPageHtml, adminSetupPageHtml, multiUserLoginPageHtml, smtpLoginPageHtml, invitePageHtml, smtpInvitePageHtml, noProjectsPageHtml } = require("./pages");
var smtp = require("./smtp");
var { createProjectContext } = require("./project");
var users = require("./users");
var dm = require("./dm");

var { CONFIG_DIR } = require("./config");

var https = require("https");

var publicDir = path.join(__dirname, "public");
var bundledThemesDir = path.join(__dirname, "themes");
var userThemesDir = path.join(CONFIG_DIR, "themes");

// --- Skills proxy cache & helpers ---
var skillsCache = {};

function httpGet(url) {
  return new Promise(function (resolve, reject) {
    var mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Clay/1.0" } }, function (resp) {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        return httpGet(resp.headers.location).then(resolve, reject);
      }
      var chunks = [];
      resp.on("data", function (c) { chunks.push(c); });
      resp.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
      resp.on("error", reject);
    }).on("error", reject);
  });
}

function fetchSkillsPage(url) {
  return httpGet(url).then(function (html) {
    // Data is inside self.__next_f.push() with escaped quotes: \"initialSkills\":[{\"source\":...}]
    var marker = 'initialSkills';
    var idx = html.indexOf(marker);
    if (idx < 0) return { skills: [] };

    // Find the start of the array: look for \\\":[
    var arrStart = html.indexOf(':[', idx);
    if (arrStart < 0) return { skills: [] };
    arrStart += 1; // point to '['

    // Find matching ']' — track bracket depth
    var depth = 0;
    var arrEnd = -1;
    for (var i = arrStart; i < html.length; i++) {
      var ch = html[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { arrEnd = i + 1; break; }
      }
    }
    if (arrEnd < 0) return { skills: [] };

    var raw = html.substring(arrStart, arrEnd);
    // Unescape: \\\" → " and \\\\ → backslash
    var unescaped = raw.replace(/\\\\"/g, '__BSLASH_QUOTE__').replace(/\\"/g, '"').replace(/__BSLASH_QUOTE__/g, '\\"');

    try {
      return { skills: JSON.parse(unescaped) };
    } catch (e) {
      return { skills: [] };
    }
  });
}

function fetchSkillDetail(url) {
  return httpGet(url).then(function (html) {
    var result = {};

    // Title: "skill-name by owner/repo"
    var titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      var parts = titleMatch[1].split(" by ");
      result.name = parts[0].trim();
    }

    // Description from meta
    var descMatch = html.match(/meta name="description" content="([^"]+)"/);
    if (descMatch) result.description = descMatch[1];

    // Install command
    var cmdMatch = html.match(/npx skills add [^ ]+ --skill [^ "<]+/);
    if (cmdMatch) result.command = cmdMatch[0];

    // Weekly installs: "Weekly Installs</span></div><div ...>VALUE</div>"
    var wiMatch = html.match(/Weekly Installs<\/span><\/div><div[^>]*>([\d,.]+K?)<\/div>/);
    if (wiMatch) result.weeklyInstalls = wiMatch[1];

    // GitHub Stars: after SVG icon, inside <span>X.XK</span>
    var gsIdx = html.indexOf("GitHub Stars");
    if (gsIdx > 0) {
      var gsRegion = html.substring(gsIdx, gsIdx + 1000);
      var gsVal = gsRegion.match(/<span>(\d[\d,.]*K?)<\/span>/);
      if (gsVal) result.githubStars = gsVal[1];
    }

    // First Seen
    var fsMatch = html.match(/First Seen<\/span><\/div><div[^>]*>([^<]+)<\/div>/);
    if (fsMatch) result.firstSeen = fsMatch[1].trim();

    // Repository: from title "by owner/repo"
    if (titleMatch) {
      var byParts = titleMatch[1].split(" by ");
      if (byParts[1]) result.repository = byParts[1].trim();
    }

    // Security audits: "text-foreground truncate">NAME</span><span ...>STATUS</span>"
    var audits = [];
    var auditRegex = /class="text-sm font-medium text-foreground truncate">([^<]+)<\/span><span class="[^"]*">(\w+)<\/span>/g;
    var am;
    while ((am = auditRegex.exec(html)) !== null) {
      audits.push({ name: am[1], status: am[2].toLowerCase() });
    }
    if (audits.length) result.audits = audits;

    // Installed on: "text-foreground">NAME</span><span class="text-muted-foreground font-mono">COUNT</span>
    var ioIdx = html.indexOf("Installed On");
    if (ioIdx > 0) {
      var ioRegion = html.substring(ioIdx, ioIdx + 3000);
      var platforms = [];
      var platRegex = /text-foreground">([^<]+)<\/span><span class="text-muted-foreground font-mono">([\d,.]+K?)<\/span>/g;
      var pm;
      while ((pm = platRegex.exec(ioRegion)) !== null) {
        platforms.push({ name: pm[1], installs: pm[2] });
      }
      if (platforms.length) result.installedOn = platforms;
    }

    // SKILL.md content: rendered HTML inside the main content area
    var skillMdIdx = html.indexOf("SKILL.md");
    if (skillMdIdx > 0) {
      // Find the prose content div after SKILL.md marker
      var proseIdx = html.indexOf("prose", skillMdIdx);
      if (proseIdx > 0) {
        var proseStart = html.indexOf(">", proseIdx) + 1;
        // Find the closing of the prose div (heuristic: next major section boundary)
        var endMarkers = ["<div class=\"bg-background", "<div class=\"sticky"];
        var proseEnd = html.length;
        for (var em = 0; em < endMarkers.length; em++) {
          var endIdx = html.indexOf(endMarkers[em], proseStart);
          if (endIdx > 0 && endIdx < proseEnd) proseEnd = endIdx;
        }
        var rawMd = html.substring(proseStart, proseEnd);
        // Rebase relative URLs to absolute (skills.sh base)
        result.skillMd = rawMd
          .replace(/src="(?!https?:\/\/|data:)([^"]+)"/g, function (m, p) {
            return 'src="' + new URL(p, url).href + '"';
          })
          .replace(/href="(?!https?:\/\/|mailto:|#)([^"]+)"/g, function (m, p) {
            return 'href="' + new URL(p, url).href + '"';
          });
      }
    }

    return result;
  });
}

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
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

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

// --- Multi-user auth helpers ---
// Multi-user auth tokens: userId:randomToken stored in memory
var multiUserTokens = {}; // token → userId

function createMultiUserSession(userId, tlsOptions) {
  var token = users.generateUserAuthToken(userId);
  multiUserTokens[token] = userId;
  var cookie = "relay_auth_user=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000" + (tlsOptions ? "; Secure" : "");
  return { token: token, cookie: cookie };
}

function getMultiUserFromReq(req) {
  var cookies = parseCookies(req);
  var token = cookies["relay_auth_user"];
  if (!token) return null;
  var userId = multiUserTokens[token];
  if (!userId) return null;
  var user = users.findUserById(userId);
  return user || null;
}

function isMultiUserAuthed(req) {
  return !!getMultiUserFromReq(req);
}

// --- PIN rate limiting ---
var pinAttempts = {}; // ip → { count, lastAttempt }
var PIN_MAX_ATTEMPTS = 5;
var PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

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

function serveStatic(urlPath, res) {
  if (urlPath === "/") urlPath = "/index.html";

  var filePath = path.join(publicDir, urlPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }

  try {
    var content = fs.readFileSync(filePath);
    var ext = path.extname(filePath);
    var mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": mime + "; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Extract slug from URL path: /p/{slug}/... → slug
 * Returns null if path doesn't match /p/{slug}
 */
function extractSlug(urlPath) {
  var match = urlPath.match(/^\/p\/([a-z0-9_-]+)(\/|$)/);
  return match ? match[1] : null;
}

/**
 * Strip the /p/{slug} prefix from URL path
 */
function stripPrefix(urlPath, slug) {
  var prefix = "/p/" + slug;
  var rest = urlPath.substring(prefix.length);
  return rest || "/";
}

/**
 * Create a multi-project server.
 * opts: { tlsOptions, caPath, pinHash, port, debug, dangerouslySkipPermissions }
 */
function createServer(opts) {
  var tlsOptions = opts.tlsOptions || null;
  var caPath = opts.caPath || null;
  var pinHash = opts.pinHash || null;
  var portNum = opts.port || 2633;
  var debug = opts.debug || false;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  var lanHost = opts.lanHost || null;
  var onAddProject = opts.onAddProject || null;
  var onRemoveProject = opts.onRemoveProject || null;
  var onReorderProjects = opts.onReorderProjects || null;
  var onSetProjectTitle = opts.onSetProjectTitle || null;
  var onSetProjectIcon = opts.onSetProjectIcon || null;
  var onGetServerDefaultEffort = opts.onGetServerDefaultEffort || null;
  var onSetServerDefaultEffort = opts.onSetServerDefaultEffort || null;
  var onGetProjectDefaultEffort = opts.onGetProjectDefaultEffort || null;
  var onSetProjectDefaultEffort = opts.onSetProjectDefaultEffort || null;
  var onGetServerDefaultModel = opts.onGetServerDefaultModel || null;
  var onSetServerDefaultModel = opts.onSetServerDefaultModel || null;
  var onGetProjectDefaultModel = opts.onGetProjectDefaultModel || null;
  var onSetProjectDefaultModel = opts.onSetProjectDefaultModel || null;
  var onGetServerDefaultMode = opts.onGetServerDefaultMode || null;
  var onSetServerDefaultMode = opts.onSetServerDefaultMode || null;
  var onGetProjectDefaultMode = opts.onGetProjectDefaultMode || null;
  var onSetProjectDefaultMode = opts.onSetProjectDefaultMode || null;
  var onGetDaemonConfig = opts.onGetDaemonConfig || null;
  var onSetPin = opts.onSetPin || null;
  var onSetKeepAwake = opts.onSetKeepAwake || null;
  var onShutdown = opts.onShutdown || null;
  var onUpgradePin = opts.onUpgradePin || null;
  var onSetProjectVisibility = opts.onSetProjectVisibility || null;
  var onSetProjectAllowedUsers = opts.onSetProjectAllowedUsers || null;
  var onGetProjectAccess = opts.onGetProjectAccess || null;
  var onCreateWorktree = opts.onCreateWorktree || null;

  var authToken = pinHash || null;
  var realVersion = require("../package.json").version;
  var currentVersion = debug ? "0.0.9" : realVersion;

  var caContent = caPath ? (function () { try { return fs.readFileSync(caPath); } catch (e) { return null; } })() : null;
  var pinPage = pinPageHtml();
  var adminSetupPage = adminSetupPageHtml();
  var loginPage = multiUserLoginPageHtml();
  var smtpLoginPage = smtpLoginPageHtml();

  // Multi-user auth: determine which page to show for unauthenticated requests
  function getAuthPage() {
    if (!users.isMultiUser()) return pinPage;
    if (!users.hasAdmin()) return adminSetupPage;
    if (smtp.isEmailLoginEnabled()) return smtpLoginPage;
    return loginPage;
  }

  // Unified auth check: works in both single-user and multi-user mode
  function isRequestAuthed(req) {
    if (users.isMultiUser()) return isMultiUserAuthed(req);
    return isAuthed(req, authToken);
  }

  // --- Project registry ---
  var projects = new Map(); // slug → projectContext

  // --- Push module (global) ---
  var pushModule = null;
  try {
    var { initPush } = require("./push");
    pushModule = initPush();
  } catch (e) {}

  // --- Security headers ---
  var securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://esm.sh; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; img-src * data: blob:; connect-src 'self' ws: wss: https://cdn.jsdelivr.net https://esm.sh https://api.dicebear.com https://api.open-meteo.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net;",
  };
  if (tlsOptions) {
    securityHeaders["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }

  function setSecurityHeaders(res) {
    var keys = Object.keys(securityHeaders);
    for (var i = 0; i < keys.length; i++) {
      res.setHeader(keys[i], securityHeaders[keys[i]]);
    }
  }

  // --- HTTP handler ---
  var appHandler = function (req, res) {
    setSecurityHeaders(res);
    var fullUrl = req.url.split("?")[0];

    // Global auth endpoint
    if (req.method === "POST" && req.url === "/auth") {
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return;
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
      return;
    }

    // --- Multi-user auth endpoints ---

    // Admin setup (first-time multi-user setup)
    if (req.method === "POST" && fullUrl === "/auth/setup") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return;
      }
      if (users.hasAdmin()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Admin already exists"}');
        return;
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
              avatarColor: existingProfile.avatarColor || "#7c3aed",
              avatarStyle: existingProfile.avatarStyle || "thumbs",
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
          users.clearSetupCode();
          var session = createMultiUserSession(result.user.id, tlsOptions);
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
      return;
    }

    // Multi-user login
    if (req.method === "POST" && fullUrl === "/auth/login") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var data = JSON.parse(body);
          var user = users.authenticateUser(data.username, data.pin);
          if (!user) {
            recordPinFailure(ip);
            var attemptsLeft = PIN_MAX_ATTEMPTS - (pinAttempts[ip] ? pinAttempts[ip].count : 0);
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Invalid username or PIN", attemptsLeft: Math.max(attemptsLeft, 0) }));
            return;
          }
          clearPinFailures(ip);
          var session = createMultiUserSession(user.id, tlsOptions);
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
      return;
    }

    // Request OTP code (SMTP login)
    if (req.method === "POST" && fullUrl === "/auth/request-otp") {
      if (!users.isMultiUser() || !smtp.isEmailLoginEnabled()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"OTP login not available"}');
        return;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return;
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
            // Don't reveal whether user exists — still say ok
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
            return;
          }
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
      return;
    }

    // Verify OTP code (SMTP login)
    if (req.method === "POST" && fullUrl === "/auth/verify-otp") {
      if (!users.isMultiUser() || !smtp.isEmailLoginEnabled()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"OTP login not available"}');
        return;
      }
      var ip = req.socket.remoteAddress || "";
      var remaining = checkPinRateLimit(ip);
      if (remaining !== null) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, locked: true, retryAfter: remaining }));
        return;
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
          var session = createMultiUserSession(user.id, tlsOptions);
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
      return;
    }

    // Invite registration
    if (req.method === "POST" && fullUrl === "/auth/register") {
      if (!users.isMultiUser()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Multi-user mode is not enabled"}');
        return;
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
          if (smtp.isEmailLoginEnabled() && !data.pin) {
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
          users.markInviteUsed(data.inviteCode);
          var session = createMultiUserSession(result.user.id, tlsOptions);
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
      return;
    }

    // Invite page (magic link)
    if (req.method === "GET" && fullUrl.indexOf("/invite/") === 0) {
      var inviteCode = fullUrl.substring("/invite/".length);
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      var validation = users.validateInvite(inviteCode);
      if (!validation.valid) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end('<!DOCTYPE html><html><head><title>Clay</title>' +
          '<style>body{background:#2F2E2B;color:#E8E5DE;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}' +
          '.c{text-align:center;max-width:360px;padding:20px}h1{color:#DA7756;margin-bottom:16px}p{color:#908B81}</style></head>' +
          '<body><div class="c"><h1>Clay</h1><p>' + (validation.error === "Invite expired" ? "This invite link has expired." : validation.error === "Invite already used" ? "This invite link has already been used." : "Invalid invite link.") + '</p></div></body></html>');
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(smtp.isEmailLoginEnabled() ? smtpInvitePageHtml(inviteCode) : invitePageHtml(inviteCode));
      return;
    }

    // CA certificate download
    if (req.url === "/ca/download" && req.method === "GET" && caContent) {
      res.writeHead(200, {
        "Content-Type": "application/x-pem-file",
        "Content-Disposition": 'attachment; filename="clay-ca.pem"',
      });
      res.end(caContent);
      return;
    }

    // CORS preflight for cross-origin requests (HTTP onboarding → HTTPS)
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    // Setup page
    if (fullUrl === "/setup" && req.method === "GET") {
      var host = req.headers.host || "localhost";
      var hostname = host.split(":")[0];
      var protocol = tlsOptions ? "https" : "http";
      var setupUrl = protocol + "://" + hostname + ":" + portNum;
      var lanMode = /[?&]mode=lan/.test(req.url);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(setupPageHtml(setupUrl, setupUrl, !!caContent, lanMode));
      return;
    }

    // Global push endpoints (used by setup page)
    if (req.method === "GET" && fullUrl === "/api/vapid-public-key" && pushModule) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ publicKey: pushModule.publicKey }));
      return;
    }

    if (req.method === "POST" && fullUrl === "/api/push-subscribe" && pushModule) {
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var parsed = JSON.parse(body);
          var sub = parsed.subscription || parsed;
          pushModule.addSubscription(sub, parsed.replaceEndpoint);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch (e) {
          res.writeHead(400);
          res.end("Bad request");
        }
      });
      return;
    }

    // Theme list: bundled (lib/themes/) + user (~/.clay/themes/)
    if (req.method === "GET" && fullUrl === "/api/themes") {
      var bundled = {};
      var custom = {};
      // Read bundled themes
      try {
        var bFiles = fs.readdirSync(bundledThemesDir);
        for (var i = 0; i < bFiles.length; i++) {
          if (!bFiles[i].endsWith(".json")) continue;
          try {
            var raw = fs.readFileSync(path.join(bundledThemesDir, bFiles[i]), "utf8");
            var id = bFiles[i].replace(/\.json$/, "");
            bundled[id] = JSON.parse(raw);
          } catch (e) {}
        }
      } catch (e) {}
      // Read user themes (override bundled if same id)
      try {
        var uFiles = fs.readdirSync(userThemesDir);
        for (var j = 0; j < uFiles.length; j++) {
          if (!uFiles[j].endsWith(".json")) continue;
          try {
            var uRaw = fs.readFileSync(path.join(userThemesDir, uFiles[j]), "utf8");
            var uid = uFiles[j].replace(/\.json$/, "");
            custom[uid] = JSON.parse(uRaw);
          } catch (e) {}
        }
      } catch (e) {}
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ bundled: bundled, custom: custom }));
      return;
    }

    // User profile — user-scoped in multi-user mode, global in single-user mode
    var profilePath = path.join(CONFIG_DIR, "profile.json");

    if (req.method === "GET" && fullUrl === "/api/profile") {
      if (users.isMultiUser()) {
        var mu = getMultiUserFromReq(req);
        if (!mu) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end('{"error":"unauthorized"}');
          return;
        }
        var profile = mu.profile || { name: "", lang: "en-US", avatarColor: "#7c3aed", avatarStyle: "thumbs", avatarSeed: "" };
        profile.username = mu.username;
        profile.userId = mu.id;
        profile.role = mu.role;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(profile));
        return;
      }
      var profile = { name: "", lang: "en-US", avatarColor: "#7c3aed", avatarStyle: "thumbs", avatarSeed: "" };
      try {
        var raw = fs.readFileSync(profilePath, "utf8");
        var saved = JSON.parse(raw);
        if (saved.name !== undefined) profile.name = saved.name;
        if (saved.lang) profile.lang = saved.lang;
        if (saved.avatarColor) profile.avatarColor = saved.avatarColor;
        if (saved.avatarStyle) profile.avatarStyle = saved.avatarStyle;
        if (saved.avatarSeed) profile.avatarSeed = saved.avatarSeed;
      } catch (e) { /* file doesn't exist yet */ }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(profile));
      return;
    }

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
      return;
    }

    // --- Admin API endpoints (multi-user mode only) ---

    // List all users (admin only)
    if (req.method === "GET" && fullUrl === "/api/admin/users") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ users: users.getAllUsers() }));
      return;
    }

    // Remove user (admin only)
    if (req.method === "DELETE" && fullUrl.indexOf("/api/admin/users/") === 0) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var targetUserId = fullUrl.substring("/api/admin/users/".length);
      if (targetUserId === mu.id) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Cannot remove yourself"}');
        return;
      }
      var result = users.removeUser(targetUserId);
      if (result.error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }

    // Create invite (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/invites") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var invite = users.createInvite(mu.id);
      var proto = tlsOptions ? "https" : "http";
      var host = req.headers.host || ("localhost:" + portNum);
      var inviteUrl = proto + "://" + host + "/invite/" + invite.code;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, invite: invite, url: inviteUrl }));
      return;
    }

    // List invites (admin only)
    if (req.method === "GET" && fullUrl === "/api/admin/invites") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ invites: users.getInvites() }));
      return;
    }

    // Revoke invite (admin only)
    if (req.method === "DELETE" && fullUrl.indexOf("/api/admin/invites/") === 0) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var inviteCode = decodeURIComponent(fullUrl.replace("/api/admin/invites/", ""));
      if (!inviteCode) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"Invite code is required"}');
        return;
      }
      var result = users.revokeInvite(inviteCode);
      if (result.error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
      return;
    }

    // Send invite via email (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/invites/email") {
      if (!users.isMultiUser() || !smtp.isSmtpConfigured()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"SMTP not configured"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
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
      return;
    }

    // Get SMTP config (admin only)
    if (req.method === "GET" && fullUrl === "/api/admin/smtp") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var cfg = smtp.getSmtpConfig();
      if (cfg) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ smtp: { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: "••••••••", from: cfg.from, emailLoginEnabled: !!cfg.emailLoginEnabled } }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"smtp":null}');
      }
      return;
    }

    // Save SMTP config (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/smtp") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
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
      return;
    }

    // Test SMTP connection (admin only)
    if (req.method === "POST" && fullUrl === "/api/admin/smtp/test") {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
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
      return;
    }

    // --- Project access control (admin only, multi-user) ---

    // Set project visibility (admin only)
    if (req.method === "PUT" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/visibility$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var projSlug = fullUrl.split("/")[4];
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
      return;
    }

    // Set project allowed users (admin only)
    if (req.method === "PUT" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/users$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var projSlug = fullUrl.split("/")[4];
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
      return;
    }

    // Get project access info (admin only)
    if (req.method === "GET" && /^\/api\/admin\/projects\/[a-z0-9_-]+\/access$/.test(fullUrl)) {
      if (!users.isMultiUser()) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not found"}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu || mu.role !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end('{"error":"Admin access required"}');
        return;
      }
      var projSlug = fullUrl.split("/")[4];
      if (!onGetProjectAccess) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"error":"Access handler not configured"}');
        return;
      }
      var access = onGetProjectAccess(projSlug);
      if (access && access.error) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: access.error }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(access));
      return;
    }

    // Multi-user info endpoint (who am I?)
    if (req.method === "GET" && fullUrl === "/api/me") {
      if (!users.isMultiUser()) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"multiUser":false}');
        return;
      }
      var mu = getMultiUserFromReq(req);
      if (!mu) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ multiUser: true, smtpEnabled: smtp.isSmtpConfigured(), emailLoginEnabled: smtp.isEmailLoginEnabled(), user: { id: mu.id, username: mu.username, email: mu.email || null, displayName: mu.displayName, role: mu.role } }));
      return;
    }

    // Skills proxy: leaderboard list
    if (req.method === "GET" && fullUrl === "/api/skills") {
      var qs = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
      var tabParam = new URLSearchParams(qs).get("tab") || "all";
      var tabPath = tabParam === "trending" ? "/trending" : tabParam === "hot" ? "/hot" : "/";
      var cacheKey = "skills_" + tabParam;
      var cached = skillsCache[cacheKey];
      if (cached && Date.now() - cached.ts < 300000) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(cached.data);
        return;
      }
      fetchSkillsPage("https://skills.sh" + tabPath).then(function (data) {
        var json = JSON.stringify(data);
        skillsCache[cacheKey] = { ts: Date.now(), data: json };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch skills: " + (err.message || err) }));
      });
      return;
    }

    // Skills proxy: search
    if (req.method === "GET" && fullUrl.startsWith("/api/skills/search")) {
      var sqsRaw = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
      var searchQ = new URLSearchParams(sqsRaw).get("q") || "";
      if (!searchQ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"missing q param"}');
        return;
      }
      var searchCacheKey = "search_" + searchQ.toLowerCase();
      var searchCached = skillsCache[searchCacheKey];
      if (searchCached && Date.now() - searchCached.ts < 300000) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(searchCached.data);
        return;
      }
      // Reuse cached "all" tab data if available, otherwise fetch
      var allCached = skillsCache["skills_all"];
      var allPromise = (allCached && Date.now() - allCached.ts < 300000)
        ? Promise.resolve(JSON.parse(allCached.data))
        : fetchSkillsPage("https://skills.sh/");
      allPromise.then(function (data) {
        var q = searchQ.toLowerCase();
        var filtered = (data.skills || []).filter(function (s) {
          var name = (s.name || "").toLowerCase();
          var source = (s.source || "").toLowerCase();
          var skillId = (s.skillId || "").toLowerCase();
          return name.indexOf(q) >= 0 || source.indexOf(q) >= 0 || skillId.indexOf(q) >= 0;
        });
        var json = JSON.stringify({ skills: filtered });
        skillsCache[searchCacheKey] = { ts: Date.now(), data: json };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to search skills: " + (err.message || err) }));
      });
      return;
    }

    // Skills proxy: skill detail
    if (req.method === "GET" && fullUrl.startsWith("/api/skills/detail")) {
      var qs2 = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
      var params2 = new URLSearchParams(qs2);
      var detailSource = params2.get("source");
      var detailSkill = params2.get("skill");
      if (!detailSource || !detailSkill) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":"missing source or skill param"}');
        return;
      }
      var detailCacheKey = "detail_" + detailSource + "_" + detailSkill;
      var detailCached = skillsCache[detailCacheKey];
      if (detailCached && Date.now() - detailCached.ts < 300000) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(detailCached.data);
        return;
      }
      var detailUrl = "https://skills.sh/" + encodeURIComponent(detailSource).replace(/%2F/g, "/") + "/" + encodeURIComponent(detailSkill);
      fetchSkillDetail(detailUrl).then(function (data) {
        var json = JSON.stringify(data);
        skillsCache[detailCacheKey] = { ts: Date.now(), data: json };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(json);
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to fetch skill detail: " + (err.message || err) }));
      });
      return;
    }

    // Root path — redirect to first accessible project
    if (fullUrl === "/" && req.method === "GET") {
      if (!isRequestAuthed(req)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getAuthPage());
        return;
      }
      if (projects.size > 0) {
        var targetSlug = null;
        var reqUser = users.isMultiUser() ? getMultiUserFromReq(req) : null;
        projects.forEach(function (ctx, s) {
          if (targetSlug) return;
          if (reqUser && onGetProjectAccess) {
            var access = onGetProjectAccess(s);
            if (access && !access.error && users.canAccessProject(reqUser.id, access)) {
              targetSlug = s;
            }
          } else {
            targetSlug = s;
          }
        });
        if (targetSlug) {
          res.writeHead(302, { "Location": "/p/" + targetSlug + "/" });
          res.end();
          return;
        }
      }
      // No accessible projects — show info page
      if (users.isMultiUser()) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(noProjectsPageHtml());
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No projects registered.");
      return;
    }

    // Global info endpoint (projects only for authenticated requests)
    if (req.method === "GET" && req.url === "/info") {
      if (!isRequestAuthed(req)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ version: currentVersion, authenticated: false }));
        return;
      }
      var projectList = [];
      projects.forEach(function (ctx, slug) {
        projectList.push({ slug: slug, project: ctx.project });
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects: projectList, version: currentVersion, authenticated: true }));
      return;
    }

    // Static files at root (favicon, manifest, icons, sw.js, etc.)
    if (fullUrl.lastIndexOf("/") === 0 && !fullUrl.includes("..")) {
      if (serveStatic(fullUrl, res)) return;
    }

    // Project-scoped routes: /p/{slug}/...
    var slug = extractSlug(req.url.split("?")[0]);
    if (!slug) {
      // Not a project route and not handled above
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    var ctx = projects.get(slug);
    if (!ctx) {
      res.writeHead(302, { "Location": "/" });
      res.end();
      return;
    }

    // Redirect /p/{slug} → /p/{slug}/ (trailing slash required for relative paths)
    if (fullUrl === "/p/" + slug) {
      res.writeHead(301, { "Location": "/p/" + slug + "/" });
      res.end();
      return;
    }

    // Auth check for project routes
    if (!isRequestAuthed(req)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getAuthPage());
      return;
    }

    // Multi-user: check project access for HTTP requests
    if (users.isMultiUser() && onGetProjectAccess) {
      var httpUser = getMultiUserFromReq(req);
      if (httpUser) {
        var httpAccess = onGetProjectAccess(slug);
        if (httpAccess && !httpAccess.error && !users.canAccessProject(httpUser.id, httpAccess)) {
          res.writeHead(302, { "Location": "/" });
          res.end();
          return;
        }
      }
    }

    // Strip prefix for project-scoped handling
    var projectUrl = stripPrefix(req.url.split("?")[0], slug);
    // Re-attach query string for API routes
    var qsIdx = req.url.indexOf("?");
    var projectUrlWithQS = qsIdx >= 0 ? projectUrl + req.url.substring(qsIdx) : projectUrl;

    // Try project HTTP handler first (APIs)
    var origUrl = req.url;
    req.url = projectUrlWithQS;
    var handled = ctx.handleHTTP(req, res, projectUrlWithQS);
    req.url = origUrl;
    if (handled) return;

    // Static files (same assets for all projects)
    if (req.method === "GET") {
      if (serveStatic(projectUrl, res)) return;
    }

    res.writeHead(404);
    res.end("Not found");
  };

  // --- Server setup ---
  var server;
  if (tlsOptions) {
    server = require("https").createServer(tlsOptions, appHandler);
  } else {
    server = http.createServer(appHandler);
  }

  // --- HTTP onboarding server (only when TLS is active) ---
  var onboardingServer = null;
  if (tlsOptions) {
    onboardingServer = http.createServer(function (req, res) {
      var url = req.url.split("?")[0];

      // CA certificate download
      if (url === "/ca/download" && req.method === "GET" && caContent) {
        res.writeHead(200, {
          "Content-Type": "application/x-pem-file",
          "Content-Disposition": 'attachment; filename="clay-ca.pem"',
        });
        res.end(caContent);
        return;
      }

      // Setup page
      if (url === "/setup" && req.method === "GET") {
        var host = req.headers.host || "localhost";
        var hostname = host.split(":")[0];
        var httpsSetupUrl = "https://" + hostname + ":" + portNum;
        var httpSetupUrl = "http://" + hostname + ":" + (portNum + 1);
        var lanMode = /[?&]mode=lan/.test(req.url);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(setupPageHtml(httpsSetupUrl, httpSetupUrl, !!caContent, lanMode));
        return;
      }

      // /info — CORS-enabled, used by setup page to verify HTTPS
      if (url === "/info" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ version: currentVersion }));
        return;
      }

      // Static files at root (favicon, manifest, icons, etc.)
      if (url.lastIndexOf("/") === 0 && !url.includes("..")) {
        if (serveStatic(url, res)) return;
      }

      // Everything else → redirect to HTTPS setup
      var hostname = (req.headers.host || "localhost").split(":")[0];
      res.writeHead(302, { "Location": "https://" + hostname + ":" + portNum + "/setup" });
      res.end();
    });
  }

  // --- WebSocket ---
  var wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", function (req, socket, head) {
    // Origin validation (CSRF prevention)
    var origin = req.headers.origin;
    if (origin) {
      try {
        var originUrl = new URL(origin);
        var originPort = String(originUrl.port || (originUrl.protocol === "https:" ? "443" : "80"));
        // Extract port from Host header for reverse proxy support.
        // Use URL parser to correctly handle IPv6 addresses (e.g. [::1])
        // and infer default port from origin protocol (not backend tlsOptions)
        // so TLS-terminating proxies on :443 with HTTP backends work.
        var hostPort;
        try {
          var hostUrl = new URL(originUrl.protocol + "//" + (req.headers.host || ""));
          hostPort = String(hostUrl.port || (originUrl.protocol === "https:" ? "443" : "80"));
        } catch (e2) {
          hostPort = String(portNum);
        }
        if (originPort !== String(portNum) && originPort !== hostPort) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch (e) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (!isRequestAuthed(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Extract slug from WS URL: /p/{slug}/ws
    var wsSlug = extractSlug(req.url);
    if (!wsSlug) {
      socket.destroy();
      return;
    }

    var ctx = projects.get(wsSlug);
    if (!ctx) {
      socket.destroy();
      return;
    }

    // Attach user info to the WS connection for multi-user filtering
    var wsUser = null;
    if (users.isMultiUser()) {
      wsUser = getMultiUserFromReq(req);
      // Check project access for multi-user mode
      if (wsUser && onGetProjectAccess) {
        var projectAccess = onGetProjectAccess(wsSlug);
        if (projectAccess && !projectAccess.error) {
          if (!users.canAccessProject(wsUser.id, projectAccess)) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
        }
      }
    }

    wss.handleUpgrade(req, socket, head, function (ws) {
      // Apply rate limiting to WS messages
      var msgCount = 0;
      var msgWindowStart = Date.now();
      var WS_RATE_LIMIT = 60; // messages per second
      var origEmit = ws.emit;
      ws.emit = function (event) {
        if (event === "message") {
          var now = Date.now();
          if (now - msgWindowStart >= 1000) {
            msgCount = 0;
            msgWindowStart = now;
          }
          msgCount++;
          if (msgCount > WS_RATE_LIMIT) {
            try {
              ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded. Connection will be closed." }));
              ws.close(1008, "Rate limit exceeded");
            } catch (e) {}
            return false;
          }
        }
        return origEmit.apply(ws, arguments);
      };
      ws._clayUser = wsUser; // attach user context
      ctx.handleConnection(ws, wsUser);
    });
  });

  // --- Debounced broadcast for processing status changes ---
  var processingUpdateTimer = null;
  function broadcastProcessingChange() {
    if (processingUpdateTimer) clearTimeout(processingUpdateTimer);
    processingUpdateTimer = setTimeout(function () {
      processingUpdateTimer = null;
      if (users.isMultiUser() && onGetProjectAccess) {
        // Per-client filtered project list
        var allProjectsList = getProjects();
        projects.forEach(function (ctx) {
          ctx.forEachClient(function (ws) {
            var wsUser = ws._clayUser;
            var filtered = allProjectsList;
            if (wsUser) {
              filtered = allProjectsList.filter(function (p) {
                var access = onGetProjectAccess(p.slug);
                if (!access || access.error) return true;
                return users.canAccessProject(wsUser.id, access);
              });
            }
            ws.send(JSON.stringify({
              type: "projects_updated",
              projects: filtered,
              projectCount: filtered.length,
            }));
          });
        });
      } else {
        broadcastAll({
          type: "projects_updated",
          projects: getProjects(),
          projectCount: projects.size,
        });
      }
    }, 200);
  }

  // --- Project management ---
  function addProject(cwd, slug, title, icon, parentSlug) {
    if (projects.has(slug)) return false;
    var ctx = createProjectContext({
      cwd: cwd,
      slug: slug,
      title: title || null,
      icon: icon || null,
      parentSlug: parentSlug || null,
      pushModule: pushModule,
      debug: debug,
      dangerouslySkipPermissions: dangerouslySkipPermissions,
      currentVersion: currentVersion,
      lanHost: lanHost,
      getProjectCount: function () { return projects.size; },
      getProjectList: function (userId) {
        var list = [];
        projects.forEach(function (ctx, s) {
          var status = ctx.getStatus();
          if (userId && users.isMultiUser() && onGetProjectAccess) {
            var access = onGetProjectAccess(s);
            if (access && !access.error && !users.canAccessProject(userId, access)) return;
          }
          list.push(status);
        });
        return list;
      },
      getHubSchedules: function () {
        var allSchedules = [];
        projects.forEach(function (ctx, s) {
          var status = ctx.getStatus();
          var recs = ctx.getSchedules();
          for (var i = 0; i < recs.length; i++) {
            // Shallow-copy full record and augment with project metadata
            var copy = {};
            var keys = Object.keys(recs[i]);
            for (var k = 0; k < keys.length; k++) copy[keys[k]] = recs[i][keys[k]];
            copy.projectSlug = s;
            copy.projectTitle = status.title || status.project;
            allSchedules.push(copy);
          }
        });
        return allSchedules;
      },
      // Move a schedule record from one project to another
      moveScheduleToProject: function (recordId, fromSlug, toSlug) {
        var fromCtx = projects.get(fromSlug);
        var toCtx = projects.get(toSlug);
        if (!fromCtx || !toCtx) return { ok: false, error: "Project not found" };
        var recs = fromCtx.getSchedules();
        var rec = null;
        for (var i = 0; i < recs.length; i++) {
          if (recs[i].id === recordId) { rec = recs[i]; break; }
        }
        if (!rec) return { ok: false, error: "Record not found" };
        // Copy full record data
        var data = {};
        var keys = Object.keys(rec);
        for (var k = 0; k < keys.length; k++) data[keys[k]] = rec[keys[k]];
        // Import into target, remove from source
        toCtx.importSchedule(data);
        fromCtx.removeSchedule(recordId);
        return { ok: true };
      },
      // Bulk move all schedules from one project to another
      moveAllSchedulesToProject: function (fromSlug, toSlug) {
        var fromCtx = projects.get(fromSlug);
        var toCtx = projects.get(toSlug);
        if (!fromCtx || !toCtx) return { ok: false, error: "Project not found" };
        var recs = fromCtx.getSchedules();
        for (var i = 0; i < recs.length; i++) {
          var data = {};
          var keys = Object.keys(recs[i]);
          for (var k = 0; k < keys.length; k++) data[keys[k]] = recs[i][keys[k]];
          toCtx.importSchedule(data);
        }
        // Remove all from source
        var ids = recs.map(function (r) { return r.id; });
        for (var j = 0; j < ids.length; j++) {
          fromCtx.removeSchedule(ids[j]);
        }
        return { ok: true };
      },
      // Get schedule count for a project slug
      getScheduleCount: function (slug) {
        var ctx = projects.get(slug);
        if (!ctx) return 0;
        return ctx.getSchedules().length;
      },
      onPresenceChange: broadcastPresenceChange,
      onProcessingChanged: broadcastProcessingChange,
      onAddProject: onAddProject,
      onRemoveProject: onRemoveProject,
      onCreateWorktree: onCreateWorktree,
      onReorderProjects: onReorderProjects,
      onSetProjectTitle: onSetProjectTitle,
      onSetProjectIcon: onSetProjectIcon,
      onGetServerDefaultEffort: onGetServerDefaultEffort,
      onSetServerDefaultEffort: onSetServerDefaultEffort,
      onGetProjectDefaultEffort: onGetProjectDefaultEffort,
      onSetProjectDefaultEffort: onSetProjectDefaultEffort,
      onGetServerDefaultModel: onGetServerDefaultModel,
      onSetServerDefaultModel: onSetServerDefaultModel,
      onGetProjectDefaultModel: onGetProjectDefaultModel,
      onSetProjectDefaultModel: onSetProjectDefaultModel,
      onGetServerDefaultMode: onGetServerDefaultMode,
      onSetServerDefaultMode: onSetServerDefaultMode,
      onGetProjectDefaultMode: onGetProjectDefaultMode,
      onSetProjectDefaultMode: onSetProjectDefaultMode,
      onGetDaemonConfig: onGetDaemonConfig,
      onSetPin: onSetPin,
      onSetKeepAwake: onSetKeepAwake,
      onShutdown: onShutdown,
      onDmMessage: handleDmMessage,
    });
    projects.set(slug, ctx);
    ctx.warmup();
    return true;
  }

  // --- DM message handler (server-level, cross-project) ---
  function handleDmMessage(ws, msg) {
    if (!users.isMultiUser() || !ws._clayUser) return;
    var userId = ws._clayUser.id;

    if (msg.type === "dm_list") {
      var dmList = dm.getDmList(userId);
      // Enrich with user info
      for (var i = 0; i < dmList.length; i++) {
        var otherUser = users.findUserById(dmList[i].otherUserId);
        if (otherUser) {
          var p = otherUser.profile || {};
          dmList[i].otherUser = {
            id: otherUser.id,
            displayName: p.name || otherUser.displayName || otherUser.username,
            username: otherUser.username,
            avatarStyle: p.avatarStyle || "thumbs",
            avatarSeed: p.avatarSeed || otherUser.username,
            avatarColor: p.avatarColor || "#7c3aed",
          };
        }
      }
      ws.send(JSON.stringify({ type: "dm_list", dms: dmList }));
      return;
    }

    if (msg.type === "dm_open") {
      if (!msg.targetUserId) return;
      var result = dm.openDm(userId, msg.targetUserId);
      var targetUser = users.findUserById(msg.targetUserId);
      var tp = targetUser ? (targetUser.profile || {}) : {};
      ws.send(JSON.stringify({
        type: "dm_history",
        dmKey: result.dmKey,
        messages: result.messages,
        targetUser: targetUser ? {
          id: targetUser.id,
          displayName: tp.name || targetUser.displayName || targetUser.username,
          username: targetUser.username,
          avatarStyle: tp.avatarStyle || "thumbs",
          avatarSeed: tp.avatarSeed || targetUser.username,
          avatarColor: tp.avatarColor || "#7c3aed",
        } : null,
      }));
      return;
    }

    if (msg.type === "dm_typing") {
      // Relay typing indicator to DM partner
      var dmKey = msg.dmKey;
      if (!dmKey) return;
      var parts = dmKey.split(":");
      if (parts.indexOf(userId) === -1) return;
      var targetId = parts[0] === userId ? parts[1] : parts[0];
      projects.forEach(function (ctx) {
        ctx.forEachClient(function (otherWs) {
          if (otherWs === ws) return;
          if (!otherWs._clayUser || otherWs._clayUser.id !== targetId) return;
          if (otherWs.readyState !== 1) return;
          otherWs.send(JSON.stringify({ type: "dm_typing", dmKey: dmKey, userId: userId, typing: !!msg.typing }));
        });
      });
      return;
    }

    if (msg.type === "dm_send") {
      if (!msg.dmKey || !msg.text) return;
      // Verify sender is a participant
      var parts = msg.dmKey.split(":");
      if (parts.indexOf(userId) === -1) return;
      var message = dm.sendMessage(msg.dmKey, userId, msg.text);
      // Send confirmation to sender
      ws.send(JSON.stringify({ type: "dm_message", dmKey: msg.dmKey, message: message }));
      // Broadcast to target user's connections across all projects
      var targetId = parts[0] === userId ? parts[1] : parts[0];
      projects.forEach(function (ctx) {
        ctx.forEachClient(function (otherWs) {
          if (otherWs === ws) return;
          if (!otherWs._clayUser || otherWs._clayUser.id !== targetId) return;
          if (otherWs.readyState !== 1) return;
          otherWs.send(JSON.stringify({ type: "dm_message", dmKey: msg.dmKey, message: message }));
        });
      });
      return;
    }
  }

  function removeProject(slug) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    ctx.destroy();
    projects.delete(slug);
    return true;
  }

  function getProjects() {
    var list = [];
    projects.forEach(function (ctx) {
      list.push(ctx.getStatus());
    });
    return list;
  }

  function reorderProjects(slugs) {
    var ordered = new Map();
    for (var i = 0; i < slugs.length; i++) {
      var ctx = projects.get(slugs[i]);
      if (ctx) ordered.set(slugs[i], ctx);
    }
    // Append any remaining (safety)
    projects.forEach(function (ctx, slug) {
      if (!ordered.has(slug)) ordered.set(slug, ctx);
    });
    projects.clear();
    ordered.forEach(function (ctx, slug) {
      projects.set(slug, ctx);
    });
  }

  function setProjectTitle(slug, title) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    ctx.setTitle(title);
    return true;
  }

  function setProjectIcon(slug, icon) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    ctx.setIcon(icon);
    return true;
  }

  function setAuthToken(hash) {
    authToken = hash;
  }

  // Collect all unique users across all projects (for topbar server-wide presence)
  function getServerUsers() {
    var seen = {};
    var list = [];
    projects.forEach(function (ctx) {
      ctx.forEachClient(function (ws) {
        if (!ws._clayUser) return;
        var u = ws._clayUser;
        if (seen[u.id]) return;
        seen[u.id] = true;
        var p = u.profile || {};
        list.push({
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
        });
      });
    });
    return list;
  }

  // Debounced broadcast of projects_updated when presence changes
  // Sends per-user filtered project lists + server-wide user list
  var presenceTimer = null;
  function broadcastPresenceChange() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(function () {
      presenceTimer = null;
      if (!users.isMultiUser()) {
        broadcastAll({
          type: "projects_updated",
          projects: getProjects(),
          projectCount: projects.size,
        });
        return;
      }
      var serverUsers = getServerUsers();
      var allUsers = users.getAllUsers().map(function (u) {
        var p = u.profile || {};
        return {
          id: u.id,
          displayName: p.name || u.displayName || u.username,
          username: u.username,
          role: u.role,
          avatarStyle: p.avatarStyle || "thumbs",
          avatarSeed: p.avatarSeed || u.username,
          avatarColor: p.avatarColor || "#7c3aed",
        };
      });
      // Build per-user filtered lists, send individually
      var sentUsers = {};
      projects.forEach(function (ctx) {
        ctx.forEachClient(function (ws) {
          var userId = ws._clayUser ? ws._clayUser.id : null;
          var key = userId || "__anon__";
          if (sentUsers[key]) {
            // Already computed for this user, just send the cached msg
            ws.send(sentUsers[key]);
            return;
          }
          var filteredProjects = [];
          projects.forEach(function (pCtx, s) {
            var status = pCtx.getStatus();
            if (userId && onGetProjectAccess) {
              var access = onGetProjectAccess(s);
              if (access && !access.error && !users.canAccessProject(userId, access)) return;
            }
            filteredProjects.push(status);
          });
          var msgStr = JSON.stringify({
            type: "projects_updated",
            projects: filteredProjects,
            projectCount: projects.size,
            serverUsers: serverUsers,
            allUsers: allUsers,
          });
          sentUsers[key] = msgStr;
          ws.send(msgStr);
        });
      });
    }, 300);
  }

  function broadcastAll(msg) {
    projects.forEach(function (ctx) {
      ctx.send(msg);
    });
  }

  function destroyAll() {
    projects.forEach(function (ctx, slug) {
      console.log("[server] Destroying project:", slug);
      ctx.destroy();
    });
    projects.clear();
  }

  return {
    server: server,
    onboardingServer: onboardingServer,
    isTLS: !!tlsOptions,
    addProject: addProject,
    removeProject: removeProject,
    getProjects: getProjects,
    reorderProjects: reorderProjects,
    setProjectTitle: setProjectTitle,
    setProjectIcon: setProjectIcon,
    setAuthToken: setAuthToken,
    broadcastAll: broadcastAll,
    destroyAll: destroyAll,
  };
}

module.exports = { createServer: createServer, generateAuthToken: generateAuthToken, verifyPin: verifyPin };
