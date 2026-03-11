var http = require("http");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { WebSocketServer } = require("ws");
var { pinPageHtml, setupPageHtml } = require("./pages");
var { createProjectContext } = require("./project");

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
  return crypto.createHash("sha256").update("clay:" + pin).digest("hex");
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
    res.writeHead(200, { "Content-Type": mime + "; charset=utf-8", "Cache-Control": "no-cache" });
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

  var authToken = pinHash || null;
  var realVersion = require("../package.json").version;
  var currentVersion = debug ? "0.0.9" : realVersion;

  var caContent = caPath ? (function () { try { return fs.readFileSync(caPath); } catch (e) { return null; } })() : null;
  var pinPage = pinPageHtml();

  // --- Project registry ---
  var projects = new Map(); // slug → projectContext

  // --- Push module (global) ---
  var pushModule = null;
  try {
    var { initPush } = require("./push");
    pushModule = initPush();
  } catch (e) {}

  // --- HTTP handler ---
  var appHandler = function (req, res) {
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
          if (authToken && generateAuthToken(data.pin) === authToken) {
            clearPinFailures(ip);
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

    // Root path — redirect to first project
    if (fullUrl === "/" && req.method === "GET") {
      if (!isAuthed(req, authToken)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pinPage);
        return;
      }
      if (projects.size > 0) {
        var slug = projects.keys().next().value;
        res.writeHead(302, { "Location": "/p/" + slug + "/" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No projects registered.");
      return;
    }

    // Global info endpoint (auth required)
    if (req.method === "GET" && req.url === "/info") {
      if (!isAuthed(req, authToken)) {
        res.writeHead(401, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end('{"error":"unauthorized"}');
        return;
      }
      var projectList = [];
      projects.forEach(function (ctx, slug) {
        projectList.push({ slug: slug, project: ctx.project });
      });
      res.end(JSON.stringify({ projects: projectList, version: currentVersion }));
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
    if (!isAuthed(req, authToken)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pinPage);
      return;
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

    if (!isAuthed(req, authToken)) {
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

    wss.handleUpgrade(req, socket, head, function (ws) {
      ctx.handleConnection(ws);
    });
  });

  // --- Debounced broadcast for processing status changes ---
  var processingUpdateTimer = null;
  function broadcastProcessingChange() {
    if (processingUpdateTimer) clearTimeout(processingUpdateTimer);
    processingUpdateTimer = setTimeout(function () {
      processingUpdateTimer = null;
      broadcastAll({
        type: "projects_updated",
        projects: getProjects(),
        projectCount: projects.size,
      });
    }, 200);
  }

  // --- Project management ---
  function addProject(cwd, slug, title, icon) {
    if (projects.has(slug)) return false;
    var ctx = createProjectContext({
      cwd: cwd,
      slug: slug,
      title: title || null,
      icon: icon || null,
      pushModule: pushModule,
      debug: debug,
      dangerouslySkipPermissions: dangerouslySkipPermissions,
      currentVersion: currentVersion,
      lanHost: lanHost,
      getProjectCount: function () { return projects.size; },
      getProjectList: function () {
        var list = [];
        projects.forEach(function (ctx) { list.push(ctx.getStatus()); });
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
      onProcessingChanged: broadcastProcessingChange,
      onAddProject: onAddProject,
      onRemoveProject: onRemoveProject,
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
    });
    projects.set(slug, ctx);
    ctx.warmup();
    return true;
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

module.exports = { createServer: createServer, generateAuthToken: generateAuthToken };
