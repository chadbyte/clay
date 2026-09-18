// app-connection.js - WebSocket connection, reconnect, status
// Extracted from app.js (PR-22)

import { store } from './store.js';
import { getWs, setWs } from './ws-ref.js';
import { getStatusDot, getSendBtn } from './dom-refs.js';
import { setSendBtnMode, blinkIO, setActivity } from './app-favicon.js';
import { hasSendableContent } from './input.js';
import { processMessage } from './app-message-router.js';
import { flushPendingExtMessages } from './app-misc.js';
import { resetTerminals } from './terminal.js';
import { closeDmUserPicker } from './sidebar-mates.js';
import { openDm } from './app-dm.js';
import { requestTools } from './home-tools.js';
import { requestHomeDockPreference } from './home-dock.js';
import { resumeHomeChat } from './home-mate-chat.js';
import { requestHomeSurfacePreference } from './home-surface.js';
import { isHomeDebatesSurface } from './home-sub-surface.js';
import { beginDefaultAiConnection, requestDefaultAi } from './default-ai.js';
import { beginContextViewConnection, requestContextView } from './context-view-preference.js';
import { beginDefaultVendorConnection, requestDefaultVendor } from './default-vendor.js';
import { clearProjectSplitState } from './split-session-boundary.js';
import { clearPermissionModePending } from './permission-control.js';
import { clearMcpPermissionModePending } from './mcp-ui.js';
import { createWebSocketLifecycle } from './websocket-lifecycle.js';
import { createWebSocketWatchdog } from './websocket-watchdog.js';

var connectOverlay = null;
var hasConnectedOnce = false;

// The connect overlay is a full-viewport opaque panel. Revealing it for a
// reconnect that resolves in under a second reads as the whole screen
// blinking, so after the first successful connection it is only revealed once
// a disconnect has actually persisted. The status dot carries the state
// immediately and without covering anything.
var OVERLAY_GRACE_MS = 800;
var overlayGraceTimer = null;

// Keeps the socket from looking idle to an intermediary proxy. A proxy resets
// its upstream read timeout on data flowing back from the server, so this only
// protects the connection because the server answers with a pong: the project
// socket via project-connection.js and the slug-less socket via
// server-global-ws.js. Well under the common 60s proxy read timeout, and one
// timer per live socket.
var HEARTBEAT_MS = 25000;
var disconnectedAt = 0;
var attemptStartedAt = 0;
var attemptSocket = null;
var lifecycle = createWebSocketLifecycle({
  handshakeTimeoutMs: 12000,
  onHandshakeTimeout: function (epoch) {
    if (lifecycle.current(epoch) && attemptSocket) {
      forceReplaceSocket("handshake_timeout", 0, epoch);
    }
  }
});
var watchdog = createWebSocketWatchdog({
  heartbeatIntervalMs: HEARTBEAT_MS,
  heartbeatDeadlineMs: 10000,
  probeTimeoutMs: 4000,
  now: function () { return Date.now(); },
  isCurrent: function (socket, epoch) {
    return getWs() === socket && socket.readyState === 1 && lifecycle.current(epoch);
  },
  sendPing: function (socket) {
    socket.send(JSON.stringify({ type: "ping" }));
  },
  onFailure: function (reason, epoch, latency) {
    forceReplaceSocket(reason, 0, epoch, latency);
  }
});

function clearOverlayGrace() {
  if (overlayGraceTimer) {
    clearTimeout(overlayGraceTimer);
    overlayGraceTimer = null;
  }
}

function showOverlayNow() {
  if (!connectOverlay) return;
  if (hasConnectedOnce) {
    var overlayMessage = document.getElementById("connect-overlay-msg");
    if (overlayMessage) overlayMessage.textContent = "Reconnecting to server…";
  }
  connectOverlay.classList.remove("hidden");
}

function recordConnectionDiagnostic(reason, code, latency) {
  var safeReasons = { close: true, error: true, handshake_timeout: true, heartbeat_timeout: true, heartbeat_error: true, probe_error: true, probe_timeout: true, auth_timeout: true, "ack-timeout": true, online: true, visible: true };
  if (!safeReasons[reason]) reason = "unknown";
  console.warn("[clay] WebSocket diagnostic", {
    reason: reason,
    code: typeof code === "number" ? code : 0,
    retry: lifecycle.getRetryAttempt(),
    latencyMs: typeof latency === "number" ? Math.max(0, Math.min(latency, 600000)) : null
  });
}

function forceReplaceSocket(reason, code, epoch, latency) {
  if (!lifecycle.current(epoch)) return;
  var socket = getWs();
  watchdog.clearProbe();
  stopHeartbeat();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(); } catch (e) {}
  }
  setWs(null);
  recordConnectionDiagnostic(reason, code, latency);
  setStatus("disconnected");
  lifecycle.invalidate(epoch);
  scheduleReconnect(reason);
}

export function stopHeartbeat() {
  watchdog.stopHeartbeat();
}

function suspendSocketForOffline() {
  watchdog.clearProbe();
  stopHeartbeat();
  var socket = getWs();
  attemptSocket = null;
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(); } catch (e) {}
  }
  setWs(null);
  if (socket || store.get('connected')) setStatus("disconnected");
}

// Started once per live socket. The socket it was started for is captured, so
// a timer that outlives its socket stops itself instead of writing to a stale
// connection. The pong the server sends back keeps a proxy's upstream read
// timeout from expiring. A missing pong also identifies a half-open socket,
// which browsers can otherwise leave OPEN while silently losing sends.
export function startHeartbeat(socket, attemptEpoch) {
  watchdog.startHeartbeat(socket, attemptEpoch);
}

function suspendSocketWatchdogs() {
  // A frozen page cannot promise proxy keepalive. Retire its deadlines without
  // closing the socket; resume performs a fresh bounded liveness check.
  watchdog.suspend();
}

function resumeSocketWatchdogs(reason) {
  var resumed = watchdog.resume();
  var socket = getWs();
  if (socket && socket.readyState === 1 && resumed) startHeartbeat(socket, lifecycle.getEpoch());
  probeReconnect(reason);
}

export function initConnection() {
  connectOverlay = document.getElementById("connect-overlay");
  if (typeof navigator !== "undefined" && navigator.onLine === false) lifecycle.setOffline(true);
  if (document.hidden) suspendSocketWatchdogs();
  window.addEventListener("clay-message-delivery-timeout", function (event) {
    var socket = event.detail && event.detail.socket;
    recordConnectionDiagnostic("ack-timeout", 0, null);
    if (!socket || getWs() === socket) probeReconnect("ack-timeout");
  });
  window.addEventListener("offline", function () {
    lifecycle.setOffline(true);
    suspendSocketForOffline();
  });
  window.addEventListener("online", function () {
    lifecycle.wake(function () {
      if (document.hidden) return;
      resumeSocketWatchdogs("online");
    });
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) suspendSocketWatchdogs();
    else resumeSocketWatchdogs("visible");
  });
  document.addEventListener("freeze", function () {
    suspendSocketWatchdogs();
  });
  document.addEventListener("resume", function () {
    if (!document.hidden) resumeSocketWatchdogs("visible");
  });

  // --- Reactive UI sync for connected/processing state ---
  store.subscribe(function (state, prev) {
    // Status dot (depends on both connected and processing)
    if (state.connected !== prev.connected || state.processing !== prev.processing) {
      var dot = getStatusDot();
      if (dot) {
        dot.className = "icon-strip-status";
        if (state.connected) {
          dot.classList.add("connected");
          if (state.processing) dot.classList.add("processing");
        }
      }
    }

    // Connected state changed
    if (state.connected !== prev.connected) {
      var sendBtn = getSendBtn();
      if (state.connected) {
        // Cancel a pending reveal and hide immediately: a reconnect that beat
        // the grace delay must never flash the overlay at all.
        clearOverlayGrace();
        hasConnectedOnce = true;
        if (sendBtn) sendBtn.disabled = false;
        if (connectOverlay) connectOverlay.classList.add("hidden");
        var updPill = document.getElementById("update-pill-wrap");
        if (updPill) updPill.classList.add("hidden");
      } else {
        // The composer stays disabled while the socket is down because there
        // is no outbound queue: every sender drops on readyState !== 1, so
        // enabling it here would silently discard the message.
        if (sendBtn) sendBtn.disabled = true;
        clearOverlayGrace();
        if (!hasConnectedOnce) {
          // First connection of the page: the startup overlay is the intended
          // presentation and appears immediately.
          showOverlayNow();
        } else {
          overlayGraceTimer = setTimeout(function () {
            overlayGraceTimer = null;
            if (!store.get('connected')) showOverlayNow();
          }, OVERLAY_GRACE_MS);
        }
      }
    }

    // Processing state changed
    if (state.processing !== prev.processing) {
      if (state.processing) {
        setSendBtnMode(hasSendableContent() ? "send" : "stop");
      } else if (state.connected) {
        setSendBtnMode("send");
      }
    }
  });
}

// setStatus: now just sets state. UI sync is handled by the subscriber above.
export function setStatus(status) {
  if (status === "connected") {
    store.set({ connected: true, processing: false });
  } else if (status === "processing") {
    store.set({ processing: true });
  } else {
    clearPermissionModePending();
    clearMcpPermissionModePending();
    store.set({ connected: false, processing: false });
  }
}

function onConnected() {
  // Flush any extension messages that arrived before WS was ready
  flushPendingExtMessages();

  // Reset terminal xterm instances (server will send fresh term_list)
  resetTerminals();

  // Re-send push subscription on reconnect
  var ws = getWs();
  if (window._pushSubscription) {
    try {
      ws.send(JSON.stringify({
        type: "push_subscribe",
        subscription: window._pushSubscription.toJSON(),
      }));
    } catch(e) {}
  }

  // Request mates list
  try {
    ws.send(JSON.stringify({ type: "mate_list" }));
  } catch(e) {}
  requestTools();
  requestHomeDockPreference();
  requestHomeSurfacePreference();
  if (store.get('homeSurfaceLoaded') && !isHomeDebatesSurface()) resumeHomeChat();

  // If connecting to a mate project, request knowledge list for badge
  if (store.get('mateProjectSlug')) {
    try { ws.send(JSON.stringify({ type: "knowledge_list" })); } catch(e) {}
  }

  // Session restore is now server-driven (user-presence.json).
  // Mate DM restore is also server-driven via "restore_mate_dm" message.
  // Previously there was a 2s localStorage fallback that auto-called
  // openDm(savedDm) on every reconnect. That fallback re-opened stale
  // mate DMs on every refresh / project switch and was the root cause
  // of the skill-install modal popping unprompted. Server-driven restore
  // is authoritative — drop the client-side fallback entirely.
  try { localStorage.removeItem("clay-active-dm"); } catch (e) {}
  // Safety: clear returningFromMateDm after initial messages settle
  if (store.get('returningFromMateDm')) {
    setTimeout(function () {
      if (store.get('returningFromMateDm')) {
        store.set({ returningFromMateDm: false });
      }
    }, 2000);
  }
}

export function connect() {
  if (lifecycle.isOffline()) return;
  var attemptEpoch = lifecycle.beginAttempt();
  attemptStartedAt = Date.now();
  var ws = getWs();
  // Tear down the previous socket's heartbeat before a new socket exists, so
  // two sockets can never both be pinging.
  stopHeartbeat();
  if (ws && ws.readyState === 1) setStatus("disconnected");
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
  }
  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var socketPath = store.get('wsPath');
  if (store.get('socketPath') && store.get('socketPath') !== socketPath) clearProjectSplitState();
  store.set({ socketPath: socketPath, activeProjectSlug: null, sessionActivatedProjectSlug: null, sessionListProjectSlug: null, splitGroupsProjectSlug: null });
  var newWs = new WebSocket(protocol + "//" + location.host + socketPath);
  setWs(newWs);
  attemptSocket = newWs;

  newWs.onopen = function () {
    if (getWs() !== newWs || !lifecycle.current(attemptEpoch)) return;
    if (!lifecycle.markOpen(attemptEpoch)) return;
    if (hasConnectedOnce && disconnectedAt) {
      console.log("[clay] WebSocket reconnected after " + (Date.now() - disconnectedAt) + "ms");
    }
    disconnectedAt = 0;
    setStatus("connected");
    startHeartbeat(newWs, attemptEpoch);
    lifecycle.clearRetry();

    // A pane pin is one-shot per WebSocket, not per page lifetime. The server
    // intentionally does not restore pane presence after a daemon restart.
    if (store.get('paneMode') && store.get('paneSessionId')) {
      store.set({ panePinPending: true });
    }

    // Wrap ws.send to blink LED on outgoing traffic
    var currentWs = getWs();
    var _origSend = currentWs.send.bind(currentWs);
    currentWs.send = function (data) {
      blinkIO();
      return _origSend(data);
    };

    onConnected();
    beginDefaultAiConnection();
    requestDefaultAi();
    beginDefaultVendorConnection();
    requestDefaultVendor();
    beginContextViewConnection();
    requestContextView();
  };

  newWs.onclose = function (e) {
    if (getWs() !== newWs || !lifecycle.current(attemptEpoch)) return;
    stopHeartbeat();
    watchdog.clearProbe();
    disconnectedAt = Date.now();
    recordConnectionDiagnostic("close", e && e.code, attemptStartedAt ? Date.now() - attemptStartedAt : null);
    closeDmUserPicker();
    store.set({ activeProjectSlug: null, sessionActivatedProjectSlug: null });
    setStatus("disconnected");
    setActivity(null);
    lifecycle.invalidate(attemptEpoch);
    scheduleReconnect("close");
  };

  newWs.onerror = function () {
    if (getWs() !== newWs || !lifecycle.current(attemptEpoch)) return;
    recordConnectionDiagnostic("error", 0, null);
    forceReplaceSocket("error", 0, attemptEpoch);
  };

  newWs.onmessage = function (event) {
    if (getWs() !== newWs || !lifecycle.current(attemptEpoch)) return;
    // Backup: if we're receiving messages, we're connected
    if (!store.get('connected')) {
      setStatus("connected");
      lifecycle.clearRetry();
    }

    blinkIO();
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    lifecycle.markLive(attemptEpoch);
    if (msg.type === "pong") watchdog.acceptPong(newWs, attemptEpoch);
    processMessage(msg);
  };
}

export function cancelReconnect() {
  watchdog.clearProbe();
  stopHeartbeat();
  lifecycle.cancel();
}

function probeReconnect(reason) {
  if (lifecycle.isOffline() || !lifecycle.current(lifecycle.getEpoch())) return;
  var socket = getWs();
  if (socket && socket.readyState === 0) return;
  if (socket && socket.readyState === 1) {
    watchdog.probe(socket, lifecycle.getEpoch());
    return;
  }
  scheduleReconnect(reason);
}

export function scheduleReconnect(reason) {
  lifecycle.schedule(reason || "unknown", function (epoch) {
    var authEpoch = epoch;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var authToken = lifecycle.beginAuth(authEpoch, function () {
      if (controller) controller.abort();
      scheduleReconnect("auth_timeout");
    }, function () {
      if (controller) controller.abort();
    });
    if (!authToken) return;
    fetch("/info", controller ? { signal: controller.signal } : undefined).then(function (res) {
      if (!lifecycle.finishAuth(authEpoch, authToken)) return;
      if (!lifecycle.canProceed(authEpoch)) return;
      if (res.status === 401) {
        location.reload();
        return;
      }
      connect();
    }).catch(function () {
      var authFinished = lifecycle.finishAuth(authEpoch, authToken);
      if (authFinished && lifecycle.canProceed(authEpoch)) connect();
    });
  });
}
