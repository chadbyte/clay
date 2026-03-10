var CACHE_NAME = "clay-offline-v1";

self.addEventListener("install", function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", function (event) {
  // Clean up old cache versions
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
          .map(function (n) { return caches.delete(n); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// --- Offline cache: network-first, cache-fallback ---

function shouldCache(request, response) {
  if (request.method !== "GET") return false;
  if (!response || !response.ok) return false;
  // Cache same-origin static assets and CDN resources (jsdelivr, fonts)
  var url = new URL(request.url);
  if (url.origin === self.location.origin) return true;
  if (url.hostname === "cdn.jsdelivr.net") return true;
  if (url.hostname === "fonts.googleapis.com") return true;
  if (url.hostname === "fonts.gstatic.com") return true;
  return false;
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Skip WebSocket upgrade requests and API/data endpoints
  var url = new URL(request.url);
  if (url.pathname.indexOf("/ws") !== -1) return;
  if (url.pathname.indexOf("/api/") !== -1) return;

  event.respondWith(
    fetch(request).then(function (response) {
      // Network succeeded: cache a clone for offline use
      if (shouldCache(request, response)) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, clone);
        });
      }
      return response;
    }).catch(function () {
      // Network failed: serve from cache
      return caches.match(request).then(function (cached) {
        if (cached) return cached;

        // For navigation requests, serve cached index.html as fallback
        // (handles /p/slug/ routes that all serve the same SPA shell)
        if (request.mode === "navigate") {
          return caches.match("/index.html").then(function (indexCached) {
            // If even the index page is not cached, show a minimal offline page
            if (indexCached) return indexCached;
            return new Response(
              "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Clay</title>" +
              "<style>body{margin:0;background:#000;color:#888;display:flex;" +
              "align-items:center;justify-content:center;height:100vh;" +
              "font-family:monospace;font-size:1.2em}</style></head>" +
              "<body><p>Waiting for server&hellip;</p></body></html>",
              { headers: { "Content-Type": "text/html" } }
            );
          });
        }
        // Non-navigation request with no cache: return network error
        return new Response("", { status: 503, statusText: "Offline" });
      });
    })
  );
});

// --- Push notifications ---

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data.json(); } catch (e) { return; }

  // Silent validation push, do not show notification
  if (data.type === "test") return;

  var options = {
    body: data.body || "",
    tag: data.tag || "clay",
    data: data,
  };

  if (data.type === "permission_request") {
    options.requireInteraction = true;
    options.tag = "perm-" + data.requestId;
  } else if (data.type === "done") {
    options.tag = data.tag || "claude-done";
  } else if (data.type === "ask_user") {
    options.requireInteraction = true;
    options.tag = "claude-ask";
  } else if (data.type === "error") {
    options.requireInteraction = true;
    options.tag = "claude-error";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Always show permission requests, questions, and errors
      // Only suppress "done" notifications when app is in foreground
      if (data.type !== "permission_request" && data.type !== "ask_user" && data.type !== "error") {
        for (var i = 0; i < clientList.length; i++) {
          if (clientList[i].focused || clientList[i].visibilityState === "visible") return;
        }
      }
      return self.registration.showNotification(data.title || "Clay", options);
    }).catch(function () {})
  );
});

// --- Notification click ---

self.addEventListener("notificationclick", function (event) {
  var data = event.notification.data || {};
  event.notification.close();

  // Build target URL from slug so we open the correct project
  var baseUrl = self.registration.scope || "/";
  var targetUrl = data.slug ? baseUrl + "p/" + data.slug + "/" : baseUrl;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      // Prefer a client already on the correct project
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.indexOf(targetUrl) !== -1) {
          return clientList[i].focus();
        }
      }
      // Fall back to any visible client
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].visibilityState !== "hidden") {
          return clientList[i].focus();
        }
      }
      if (clientList.length > 0) return clientList[0].focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
