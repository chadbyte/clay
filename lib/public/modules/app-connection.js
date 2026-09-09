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

var reconnectTimer = null;
var reconnectDelay = 1000;
var connectTimeoutId = null;
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
var heartbeatTimer = null;
var heartbeatDeadlineTimer = null;
var disconnectedAt = 0;

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

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (heartbeatDeadlineTimer) {
    clearTimeout(heartbeatDeadlineTimer);
    heartbeatDeadlineTimer = null;
  }
}

// Started once per live socket. The socket it was started for is captured, so
// a timer that outlives its socket stops itself instead of writing to a stale
// connection. The pong the server sends back keeps a proxy's upstream read
// timeout from expiring. A missing pong also identifies a half-open socket,
// which browsers can otherwise leave OPEN while silently losing sends.
export function startHeartbeat(socket) {
  stopHeartbeat();
  if (!socket) return;
  heartbeatTimer = setInterval(function () {
    if (!socket || socket.readyState !== 1 || getWs() !== socket) {
      stopHeartbeat();
      return;
    }
    try { socket.send(JSON.stringify({ type: "ping" })); } catch (e) {}
    if (heartbeatDeadlineTimer) clearTimeout(heartbeatDeadlineTimer);
    heartbeatDeadlineTimer = setTimeout(function () {
      heartbeatDeadlineTimer = null;
      if (getWs() === socket && socket.readyState === 1) connect();
    }, 10000);
  }, HEARTBEAT_MS);
}

export function initConnection() {
  connectOverlay = document.getElementById("connect-overlay");
  window.addEventListener("clay-message-delivery-timeout", function (event) {
    var socket = event.detail && event.detail.socket;
    if (!socket || getWs() === socket) connect();
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
  if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var socketPath = store.get('wsPath');
  store.set({ socketPath: socketPath, activeProjectSlug: null, sessionActivatedProjectSlug: null });
  var newWs = new WebSocket(protocol + "//" + location.host + socketPath);
  setWs(newWs);

  // If not connected within 3s, force retry
  connectTimeoutId = setTimeout(function () {
    if (getWs() !== newWs) return;
    if (!store.get('connected')) {
      newWs.onclose = null;
      newWs.onerror = null;
      newWs.close();
      connect();
    }
  }, 3000);

  newWs.onopen = function () {
    if (getWs() !== newWs) return;
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
    if (hasConnectedOnce && disconnectedAt) {
      console.log("[clay] WebSocket reconnected after " + (Date.now() - disconnectedAt) + "ms");
    }
    disconnectedAt = 0;
    setStatus("connected");
    startHeartbeat(newWs);
    reconnectDelay = 1000;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

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
  };

  newWs.onclose = function (e) {
    if (getWs() !== newWs) return;
    if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
    stopHeartbeat();
    disconnectedAt = Date.now();
    // Abnormal closes are the ones worth reporting: a clean close is either a
    // deliberate navigation or a server shutdown the user already knows about.
    if (e && !e.wasClean) {
      console.warn("[clay] WebSocket closed abnormally: code=" + e.code +
        " reason=" + (e.reason || "(none)") + " wasClean=false");
    }
    closeDmUserPicker();
    store.set({ activeProjectSlug: null, sessionActivatedProjectSlug: null });
    setStatus("disconnected");
    setActivity(null);
    scheduleReconnect();
  };

  newWs.onerror = function () {};

  newWs.onmessage = function (event) {
    if (getWs() !== newWs) return;
    // Backup: if we're receiving messages, we're connected
    if (!store.get('connected')) {
      setStatus("connected");
      reconnectDelay = 1000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    blinkIO();
    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    if (msg.type === "pong" && heartbeatDeadlineTimer) {
      clearTimeout(heartbeatDeadlineTimer);
      heartbeatDeadlineTimer = null;
    }
    processMessage(msg);
  };
}

export function cancelReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

export function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    // Check if auth is still valid before reconnecting
    fetch("/info").then(function (res) {
      if (res.status === 401) {
        location.reload();
        return;
      }
      connect();
    }).catch(function () {
      // Server still down, try connecting anyway
      connect();
    });
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
}
