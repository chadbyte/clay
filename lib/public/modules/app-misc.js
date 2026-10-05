// app-misc.js - Modals (image, paste, confirm), force PIN, PWA install, extension bridge
// Extracted from app.js (PR-34)

import { refreshIcons, iconHtml } from './icons.js';
import { getWs } from './ws-ref.js';
import { updateBrowserTabList } from './context-sources.js';
import { setExtensionConnected } from './mcp-ui.js';
import { initPasteModal } from './paste-modal.js';

// --- Module-owned state ---
var confirmCallback = null;
var confirmCancelCallback = null;
var _extRequestCallbacks = {};

// Queue for extension messages that arrived before WS was ready
var _pendingExtMessages = [];
// Cache last extension state so we can resend on WS reconnect (server restart)
var _lastTabListMsg = null;
var _lastMcpServersMsg = null;

function sendOrQueue(msgObj) {
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msgObj));
  } else {
    _pendingExtMessages.push(msgObj);
  }
}

export function flushPendingExtMessages() {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  // Flush queued messages from before WS was ready
  if (_pendingExtMessages.length > 0) {
    var queued = _pendingExtMessages.slice();
    _pendingExtMessages = [];
    for (var i = 0; i < queued.length; i++) {
      ws.send(JSON.stringify(queued[i]));
    }
  }
  // Resend cached extension state on every WS reconnect so the server
  // re-registers _extensionWs and rebuilds MCP proxy servers
  if (_lastTabListMsg) ws.send(JSON.stringify(_lastTabListMsg));
  if (_lastMcpServersMsg) ws.send(JSON.stringify(_lastMcpServersMsg));
}

export function initMisc() {
  initPasteModal();
  // --- Confirm modal listeners ---
  var confirmModal = document.getElementById("confirm-modal");
  var confirmOk = document.getElementById("confirm-ok");
  var confirmCancel = document.getElementById("confirm-cancel");

  confirmOk.addEventListener("click", function () {
    confirmCancelCallback = null;
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });

  confirmCancel.addEventListener("click", hideConfirm);
  confirmModal.querySelector(".confirm-backdrop").addEventListener("click", hideConfirm);

  // --- PWA install prompt ---
  (function () {
    var installPill = document.getElementById("pwa-install-pill");
    var modal = document.getElementById("pwa-install-modal");
    var confirmBtn = document.getElementById("pwa-modal-confirm");
    var cancelBtn = document.getElementById("pwa-modal-cancel");
    if (!installPill || !modal) return;

    // Already standalone -- never show
    if (document.documentElement.classList.contains("pwa-standalone")) return;

    // Show pill on mobile browsers (the primary target for PWA install)
    var isMobile = /Mobi|Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isMobile) {
      installPill.classList.remove("hidden");
    }

    // Also show on desktop if beforeinstallprompt fires
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      installPill.classList.remove("hidden");
    });

    function openModal() {
      modal.classList.remove("hidden");
      lucide.createIcons({ nodes: [modal] });
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    installPill.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.querySelector(".pwa-modal-backdrop").addEventListener("click", closeModal);

    confirmBtn.addEventListener("click", function () {
      // Builtin cert (*.d.clay.studio): open PWA setup guide
      if (location.hostname.endsWith(".d.clay.studio")) {
        closeModal();
        location.href = "/pwa";
        return;
      }
      // mkcert / other: redirect to onboarding setup page
      var port = parseInt(location.port, 10);
      var setupUrl;
      if (!port) {
        // Standard port (443/80), behind a reverse proxy with real cert
        setupUrl = location.protocol + "//" + location.hostname + "/setup";
      } else {
        // Non-standard port, Clay serving directly with onboarding server on port+1
        setupUrl = "http://" + location.hostname + ":" + (port + 1) + "/setup";
      }
      location.href = setupUrl;
    });

    // Hide after install
    window.addEventListener("appinstalled", function () {
      installPill.classList.add("hidden");
      closeModal();
    });
  })();

  // --- Extension bridge window message listener ---
  window.addEventListener("message", function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "clay-chrome-extension") return;
    var msg = event.data.payload;

    if (msg.type === "clay_ext_tab_list") {
      setExtensionConnected(true);
      updateBrowserTabList(msg.tabs);
      // Cache and send (or queue) - resent on WS reconnect via flushPendingExtMessages
      _lastTabListMsg = { type: "browser_tab_list", tabs: msg.tabs };
      sendOrQueue(_lastTabListMsg);
    }
    if (msg.type === "clay_ext_result") {
      handleExtensionResult(msg.requestId, msg.result);
    }
    if (msg.type === "clay_ext_disconnected") {
      setExtensionConnected(false);
    }

    // MCP bridge: extension reports available MCP servers (queue if WS not ready yet)
    // Cache for resend on WS reconnect (server restart loses _availableServers)
    if (msg.type === "mcp_servers_available") {
      _lastMcpServersMsg = {
        type: "mcp_servers_available",
        servers: msg.servers,
        hostConnected: msg.hostConnected
      };
      sendOrQueue(_lastMcpServersMsg);
    }

    // MCP bridge: tool result from extension (tool results should not be queued,
    // if WS is down the call already timed out server-side)
    if (msg.type === "mcp_tool_result") {
      var ws3 = getWs();
      if (ws3 && ws3.readyState === 1) {
        ws3.send(JSON.stringify({
          type: msg.error ? "mcp_tool_error" : "mcp_tool_result",
          callId: msg.callId,
          result: msg.result || null,
          error: msg.error || null
        }));
      }
    }
  });
}

// Forward an MCP tool call from the server to the Chrome extension
export function forwardMcpToolCall(msg) {
  console.log("[mcp] forwarding to extension:", msg.callId, msg.server, msg.method);
  window.postMessage({
    source: "clay-page",
    payload: {
      type: "clay_mcp_tool_call",
      callId: msg.callId,
      server: msg.server,
      method: msg.method,
      params: msg.params,
    }
  }, "*");
}

// Forward an MCP tool call directly via HTTP for HTTP-transport servers
var _httpMcpServers = {}; // name -> url
export function setHttpMcpServers(servers) {
  _httpMcpServers = {};
  for (var i = 0; i < servers.length; i++) {
    if (servers[i].transport === "http" && servers[i].url) {
      _httpMcpServers[servers[i].name] = servers[i].url;
    }
  }
}

export function handleMcpToolCallMessage(msg) {
  console.log("[mcp] tool call received from server:", msg.callId, msg.server, msg.params && msg.params.name);
  var httpUrl = _httpMcpServers[msg.server];
  if (httpUrl) {
    // HTTP transport: call directly via fetch
    fetch(httpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: msg.callId,
        method: msg.method,
        params: msg.params,
      }),
    })
    .then(function (resp) { return resp.json(); })
    .then(function (data) {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        if (data.error) {
          ws.send(JSON.stringify({
            type: "mcp_tool_error",
            callId: msg.callId,
            error: data.error.message || JSON.stringify(data.error),
          }));
        } else {
          ws.send(JSON.stringify({
            type: "mcp_tool_result",
            callId: msg.callId,
            result: data.result,
          }));
        }
      }
    })
    .catch(function (err) {
      var ws = getWs();
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "mcp_tool_error",
          callId: msg.callId,
          error: "HTTP MCP fetch failed: " + err.message,
        }));
      }
    });
  } else {
    // stdio transport: forward to extension
    forwardMcpToolCall(msg);
  }
}

export function showImageModal(src) {
  var modal = document.getElementById("image-modal");
  var img = document.getElementById("image-modal-img");
  if (!modal || !img) return;
  img.src = src;
  modal.classList.remove("hidden");
  refreshIcons(modal);
}

export function closeImageModal() {
  var modal = document.getElementById("image-modal");
  if (modal) modal.classList.add("hidden");
}

// onCancel (optional) runs when the dialog is dismissed or replaced without confirming.
export function showConfirm(text, onConfirm, okLabel, destructive, onCancel) {
  var confirmText = document.getElementById("confirm-text");
  var confirmOk = document.getElementById("confirm-ok");
  var confirmModal = document.getElementById("confirm-modal");
  var replaced = confirmCancelCallback;
  confirmCancelCallback = null;
  if (replaced) replaced();
  confirmText.textContent = text;
  confirmCallback = onConfirm;
  confirmCancelCallback = onCancel || null;
  confirmOk.textContent = okLabel || "Delete";
  confirmOk.className = "confirm-btn " + (destructive === false ? "confirm-ok" : "confirm-delete");
  confirmModal.classList.remove("hidden");
}

export function hideConfirm() {
  var confirmModal = document.getElementById("confirm-modal");
  confirmModal.classList.add("hidden");
  confirmCallback = null;
  var cancelled = confirmCancelCallback;
  confirmCancelCallback = null;
  if (cancelled) cancelled();
}

export function showForceChangePinOverlay() {
  // Inject the same .pin-digit / .pin-wrap CSS the login page uses, so this
  // overlay behaves identically: visible focus ring, filled state, etc.
  // The login page (lib/pages.js) loads this CSS inline; the main app
  // doesn't, so we add it once here.
  if (!document.getElementById("fcp-style")) {
    var st = document.createElement("style");
    st.id = "fcp-style";
    st.textContent =
      "#force-change-pin-overlay .pin-wrap{display:flex;gap:8px;justify-content:center;margin-bottom:16px}" +
      "#force-change-pin-overlay .pin-digit{width:44px;height:56px;background:var(--input-bg);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-family:'Courier New',Courier,'Roboto Mono',monospace;font-size:28px;font-weight:700;text-align:center;line-height:56px;outline:none;caret-color:transparent;transition:border-color 0.15s,box-shadow 0.15s}" +
      "#force-change-pin-overlay .pin-digit:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-20,rgba(124,58,237,0.25))}" +
      "#force-change-pin-overlay .pin-digit.filled{color:var(--text)}";
    document.head.appendChild(st);
  }

  var ov = document.createElement("div");
  ov.id = "force-change-pin-overlay";
  ov.style.cssText = "position:fixed;inset:0;background:var(--bg,#0e0e10);z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column";
  ov.innerHTML = '<div style="width:100%;max-width:380px;padding:24px;text-align:center">' +
    '<h2 style="margin:0 0 8px;color:var(--text,#fff);font-size:22px">Set your new PIN</h2>' +
    '<p style="margin:0 0 24px;color:var(--text-secondary,#aaa);font-size:14px">Your temporary PIN has expired. Please set a new 6-digit PIN to continue.</p>' +
    '<div class="pin-wrap" id="fcp-boxes">' +
    '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
    '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
    '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
    '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
    '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
    '<input class="pin-digit" type="tel" maxlength="1" inputmode="numeric" autocomplete="off">' +
    '</div>' +
    '<button id="fcp-save" disabled style="width:100%;padding:12px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:pointer;opacity:0.5;transition:opacity 0.15s">Save PIN</button>' +
    '<div id="fcp-err" style="margin-top:12px;color:var(--error,#ef4444);font-size:13px;min-height:1.3em"></div>' +
    '<button id="fcp-logout" type="button" style="margin-top:8px;background:none;border:none;color:var(--text-dimmer,#888);font-size:13px;cursor:pointer;text-decoration:underline">Log out and start over</button>' +
    '</div>';
  document.body.appendChild(ov);

  var boxes = ov.querySelectorAll(".pin-digit");
  var saveBtn = ov.querySelector("#fcp-save");
  var errEl = ov.querySelector("#fcp-err");
  // Mirror the login screen's pattern (lib/pages.js pinBoxScript): keep an
  // explicit digits[] array as the source of truth, render bullets visually,
  // enable the button when length === 6.
  var digits = ["", "", "", "", "", ""];

  function setDigit(idx, v) {
    digits[idx] = v;
    boxes[idx].value = v ? "\u2022" : "";
    boxes[idx].classList.toggle("filled", v.length > 0);
  }

  function getPin() {
    return digits.join("");
  }

  function updateBtn() {
    var ready = getPin().length === 6;
    saveBtn.disabled = !ready;
    saveBtn.style.opacity = ready ? "1" : "0.5";
  }

  for (var i = 0; i < boxes.length; i++) {
    (function (idx) {
      boxes[idx].addEventListener("input", function () {
        var raw = this.value.replace(/[^0-9]/g, "");
        if (!raw) { setDigit(idx, ""); updateBtn(); return; }
        var v = raw.charAt(raw.length - 1);
        setDigit(idx, v);
        if (v && idx < 5) boxes[idx + 1].focus();
        updateBtn();
      });
      boxes[idx].addEventListener("keydown", function (e) {
        if (e.key === "Backspace") {
          if (!digits[idx] && idx > 0) {
            setDigit(idx - 1, "");
            boxes[idx - 1].focus();
          } else {
            setDigit(idx, "");
          }
          updateBtn();
          return;
        }
        if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
        if (e.key === "ArrowRight" && idx < 5) boxes[idx + 1].focus();
        if (e.key === "Enter" && !saveBtn.disabled) doSave();
        e.stopPropagation();
      });
      boxes[idx].addEventListener("keyup", function (e) { e.stopPropagation(); });
      boxes[idx].addEventListener("keypress", function (e) { e.stopPropagation(); });
      boxes[idx].addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g, "").slice(0, 6);
        for (var j = 0; j < text.length && (idx + j) < 6; j++) {
          setDigit(idx + j, text.charAt(j));
        }
        if (text.length > 0) {
          var focusIdx = Math.min(idx + text.length, 5);
          boxes[focusIdx].focus();
        }
        updateBtn();
      });
      boxes[idx].addEventListener("focus", function () { this.select(); });
    })(i);
  }
  boxes[0].focus();

  function doSave() {
    var pin = getPin();
    if (pin.length !== 6) return;
    saveBtn.disabled = true;
    saveBtn.style.opacity = "0.5";
    errEl.textContent = "";
    fetch("/api/user/pin", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPin: pin }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) {
        ov.remove();
        return;
      }
      errEl.textContent = d.error || "Failed to save PIN";
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
    }).catch(function () {
      errEl.textContent = "Connection error";
      saveBtn.disabled = false;
      saveBtn.style.opacity = "1";
    });
  }
  saveBtn.addEventListener("click", doSave);

  var logoutBtn = ov.querySelector("#fcp-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/auth/logout", { method: "POST" }).then(function () {
        location.href = "/";
      }).catch(function () {
        location.href = "/";
      });
    });
  }
}

export function sendExtensionCommand(command, args, requestId) {
  window.postMessage({
    source: "clay-page",
    payload: {
      type: "clay_ext_command",
      command: command,
      args: args,
      requestId: requestId
    }
  }, "*");
}

export function handleExtensionResult(requestId, result) {
  // Check local callback first (for server-initiated requests)
  var cb = _extRequestCallbacks[requestId];
  if (cb) {
    delete _extRequestCallbacks[requestId];
    cb(result);
    return;
  }
  // Forward to server
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "extension_result",
      requestId: requestId,
      result: result
    }));
  }
}
