var http = require("http");
var crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var { WebSocketServer } = require("ws");
var { pinPageHtml, setupPageHtml, dashboardPageHtml } = require("./pages");
var { createProjectContext } = require("./project");

var publicDir = path.join(__dirname, "public");

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
  return crypto.createHash("sha256").update("claude-relay:" + pin).digest("hex");
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
    res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
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
 * Check if a URL path is a known static asset (by extension).
 * Used to serve icons/manifest/etc. without auth for iOS PWA support.
 */
var STATIC_EXTENSIONS = { ".png": 1, ".svg": 1, ".ico": 1, ".json": 1, ".js": 1, ".css": 1, ".woff2": 1, ".woff": 1 };
function isStaticAsset(urlPath) {
  var ext = path.extname(urlPath);
  return !!STATIC_EXTENSIONS[ext];
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
        "Content-Disposition": 'attachment; filename="claude-relay-ca.pem"',
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

    // Root path — dashboard or redirect
    if (fullUrl === "/" && req.method === "GET") {
      if (!isAuthed(req, authToken)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pinPage);
        return;
      }
      var hasGoneParam = req.url.indexOf("gone=") !== -1;
      if (projects.size === 1 && !hasGoneParam) {
        var slug = projects.keys().next().value;
        res.writeHead(302, { "Location": "/p/" + slug + "/" });
        res.end();
        return;
      }
      var statusList = [];
      projects.forEach(function (ctx) { statusList.push(ctx.getStatus()); });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(dashboardPageHtml(statusList, currentVersion));
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
      res.writeHead(302, { "Location": "/?gone=" + encodeURIComponent(slug) });
      res.end();
      return;
    }

    // Redirect /p/{slug} → /p/{slug}/ (trailing slash required for relative paths)
    if (fullUrl === "/p/" + slug) {
      res.writeHead(301, { "Location": "/p/" + slug + "/" });
      res.end();
      return;
    }

    // Serve static assets without auth (needed for iOS bookmark/PWA icons)
    if (req.method === "GET") {
      var preAuthUrl = stripPrefix(req.url.split("?")[0], slug);
      if (isStaticAsset(preAuthUrl)) {
        if (serveStatic(preAuthUrl, res)) return;
      }
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
          "Content-Disposition": 'attachment; filename="claude-relay-ca.pem"',
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

  // --- Project management ---
  function addProject(cwd, slug, title) {
    if (projects.has(slug)) return false;
    var ctx = createProjectContext({
      cwd: cwd,
      slug: slug,
      title: title || null,
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

  function setProjectTitle(slug, title) {
    var ctx = projects.get(slug);
    if (!ctx) return false;
    ctx.setTitle(title);
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
    setProjectTitle: setProjectTitle,
    setAuthToken: setAuthToken,
    broadcastAll: broadcastAll,
    destroyAll: destroyAll,
  };
}

module.exports = { createServer: createServer, generateAuthToken: generateAuthToken };
