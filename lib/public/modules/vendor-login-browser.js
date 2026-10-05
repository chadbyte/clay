import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { cancelVendorLogin, requestVendorLogin } from './vendor-login.js';

function current() { return store.get('vendorLoginBrowser'); }

function send(type, extra) {
  var view = current();
  var ws = getWs();
  if (!view || view.slug !== store.get('currentSlug') || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(Object.assign({ type: type, vendor: view.vendor, browserId: view.browserId }, extra || {})));
}

function input(event) { send("vendor_login_browser_input", { event: event }); }

export function closeLoginBrowser() {
  var view = current();
  if (view && view.resizeObserver) view.resizeObserver.disconnect();
  if (view && view.moveTimer) clearTimeout(view.moveTimer);
  store.set({ vendorLoginBrowser: null });
  var dialog = document.getElementById("vendor-login-browser");
  if (dialog) { dialog.close(); dialog.remove(); }
  if (view && view.previousFocus && view.previousFocus.isConnected) view.previousFocus.focus();
}

export function openLoginBrowser(msg) {
  var existing = current();
  if (existing && existing.browserId === msg.browserId) {
    send("vendor_login_browser_attach");
    return;
  }
  closeLoginBrowser();
  var title = msg.vendor === "codex" ? "Sign in to Codex" : "Sign in to Claude";
  store.set({ vendorLoginBrowser: {
    browserId: msg.browserId, vendor: msg.vendor, slug: msg.slug || store.get('currentSlug'),
    previousFocus: document.activeElement, decoding: false, pointerY: null, pointerId: null, mouseDown: false, moveTimer: null, pendingMove: null, resizeObserver: null, requestedSize: null, phase: "loading",
  } });
  var dialog = document.createElement("dialog");
  dialog.id = "vendor-login-browser";
  dialog.className = "login-browser";
  dialog.setAttribute("aria-labelledby", "login-browser-title");
  dialog.innerHTML = '<header class="login-browser-header">' +
    '<img class="login-browser-vendor" src="/' + (msg.vendor === "codex" ? 'codex-avatar.png' : 'claude-code-avatar.png') + '" alt="">' +
    '<div class="login-browser-heading"><h2 id="login-browser-title"></h2>' +
    '<span class="login-browser-origin">Opening sign-in page…</span></div>' +
    '<div class="login-browser-actions">' +
    '<button type="button" data-action="keyboard" class="login-browser-icon login-browser-keyboard-button" aria-label="Show keyboard" title="Show keyboard">' + iconHtml("keyboard") + '</button>' +
    '<button type="button" data-action="reload" class="login-browser-icon" aria-label="Reload page" title="Reload page">' + iconHtml("rotate-cw") + '</button>' +
    '<details class="login-browser-more"><summary aria-label="More sign-in options" title="More sign-in options">' + iconHtml("ellipsis") + '</summary>' +
    '<div class="login-browser-menu"><button type="button" data-action="retry">' + iconHtml("refresh-cw") + '<span>Restart sign-in</span></button></div></details>' +
    '<button type="button" data-action="cancel" class="login-browser-icon" aria-label="Cancel sign-in" title="Cancel sign-in">' + iconHtml("x") + '</button></div></header>' +
    '<div class="login-browser-viewport"><canvas width="1000" height="720" aria-label="Remote sign-in page"></canvas>' +
    '<div class="login-browser-loading"><span class="login-browser-spinner" aria-hidden="true"></span><strong>Opening your sign-in page</strong><span>This may take a moment.</span></div>' +
    '<textarea class="login-browser-keyboard" aria-label="Type into the remote sign-in page" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></div>' +
    '<footer class="login-browser-footer"><div class="login-browser-info"><div class="login-browser-status"><span class="login-browser-status-dot" aria-hidden="true"></span><p role="status">Preparing sign-in…</p></div>' +
    '<p class="login-browser-privacy">Browser cookies are discarded when this session ends. You stay signed in to ' + (msg.vendor === "codex" ? 'Codex' : 'Claude') + ' after this browser closes.</p></div>' +
    '<button type="button" data-action="terminal" class="login-browser-terminal">' + iconHtml("terminal") + '<span>Use terminal sign-in</span>' + iconHtml("arrow-up-right") + '</button></footer>';
  dialog.querySelector("h2").textContent = title;
  document.body.appendChild(dialog);
  var keyboard = dialog.querySelector("textarea");
  var canvas = dialog.querySelector("canvas");
  function cancel() { cancelVendorLogin(msg.vendor); }
  function restart(mode) {
    var ws = getWs();
    if (!ws || ws.readyState !== 1) {
      dialog.querySelector('[role="status"]').textContent = "Reconnect to Clay before switching sign-in methods.";
      return;
    }
    cancel();
    requestVendorLogin(msg.vendor, { mode: mode });
  }
  dialog.querySelector('[data-action="cancel"]').onclick = cancel;
  dialog.querySelector('[data-action="retry"]').onclick = function () { restart("browser"); };
  dialog.querySelector('[data-action="terminal"]').onclick = function () { restart("terminal"); };
  dialog.querySelector('[data-action="reload"]').onclick = function () { input({ kind: "reload" }); };
  dialog.querySelector('[data-action="keyboard"]').onclick = function () { keyboard.focus(); };
  dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    var menu = dialog.querySelector("details");
    if (menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
    else cancel();
  });
  dialog.addEventListener("click", function (event) {
    var menu = dialog.querySelector("details");
    if (!menu.contains(event.target)) menu.open = false;
  });
  function pointerPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height };
  }
  function flushMove() {
    var view = current();
    if (!view || view.browserId !== msg.browserId) return;
    clearTimeout(view.moveTimer);
    var point = view.pendingMove;
    store.set({ vendorLoginBrowser: Object.assign({}, view, { moveTimer: null, pendingMove: null }) });
    if (point) input(Object.assign({ kind: "move" }, point));
  }
  canvas.addEventListener("pointermove", function (event) {
    var view = current();
    var ws = getWs();
    if (!view || event.pointerType === "touch" || !ws || ws.bufferedAmount > 65536) return;
    store.set({ vendorLoginBrowser: Object.assign({}, view, {
      pendingMove: pointerPoint(event), moveTimer: view.moveTimer || setTimeout(flushMove, 40),
    }) });
  });
  canvas.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || !event.isPrimary) return;
    flushMove();
    var view = current();
    if (!view || view.pointerId !== null) return;
    canvas.setPointerCapture(event.pointerId);
    var touch = event.pointerType === "touch";
    store.set({ vendorLoginBrowser: Object.assign({}, view, {
      pointerY: event.clientY, pointerId: event.pointerId, mouseDown: !touch,
    }) });
    if (!touch) input(Object.assign({ kind: "down" }, pointerPoint(event)));
  });
  function releasePointer(event, cancelled) {
    var view = current();
    if (!view || view.pointerId !== event.pointerId) return;
    flushMove();
    view = current();
    var distance = view.pointerY === null ? 0 : view.pointerY - event.clientY;
    if (view.mouseDown) input(Object.assign({ kind: "up" }, pointerPoint(event)));
    else if (!cancelled) {
      if (Math.abs(distance) > 12) input({ kind: "wheel", deltaY: distance * 2 });
      else input(Object.assign({ kind: "click" }, pointerPoint(event)));
    }
    store.set({ vendorLoginBrowser: Object.assign({}, view, { pointerY: null, pointerId: null, mouseDown: false }) });
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!cancelled && Math.abs(distance) <= 12) keyboard.focus({ preventScroll: true });
  }
  canvas.addEventListener("pointerup", function (event) { releasePointer(event, false); });
  canvas.addEventListener("pointercancel", function (event) { releasePointer(event, true); });
  canvas.addEventListener("lostpointercapture", function (event) { releasePointer(event, true); });
  canvas.addEventListener("wheel", function (event) {
    event.preventDefault();
    input({ kind: "wheel", deltaY: event.deltaY });
  }, { passive: false });
  keyboard.addEventListener("keydown", function (event) {
    var key = event.key;
    if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "a") key = "ControlOrMeta+A";
    else if (event.shiftKey && key === "Tab") key = "Shift+Tab";
    if (/^(Tab|Shift\+Tab|Enter|Backspace|Delete|Escape|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|ControlOrMeta\+A)$/.test(key)) {
      event.preventDefault();
      event.stopPropagation();
      input({ kind: "key", key: key });
    }
  });
  function insert() {
    if (keyboard.value) input({ kind: "text", text: keyboard.value.slice(0, 4096) });
    keyboard.value = "";
  }
  keyboard.addEventListener("input", function (event) { if (!event.isComposing) insert(); });
  keyboard.addEventListener("compositionend", insert);
  keyboard.addEventListener("paste", function (event) {
    event.preventDefault();
    input({ kind: "text", text: event.clipboardData.getData("text/plain").slice(0, 4096) });
  });
  dialog.showModal();
  refreshIcons();
  if (typeof ResizeObserver !== "undefined") {
    var observer = new ResizeObserver(function () { resizeLoginBrowser(); });
    store.set({ vendorLoginBrowser: Object.assign({}, current(), { resizeObserver: observer }) });
    observer.observe(dialog.querySelector(".login-browser-viewport"));
  }
  send("vendor_login_browser_attach");
  resizeLoginBrowser();
}

function resizeLoginBrowser(force) {
  var view = current();
  var element = document.querySelector("#vendor-login-browser .login-browser-viewport");
  if (!view || !element) return null;
  var size = { width: Math.max(320, Math.min(1000, Math.round(element.clientWidth))),
    height: Math.max(360, Math.min(720, Math.round(element.clientHeight))) };
  if (force || !view.requestedSize || view.requestedSize.width !== size.width || view.requestedSize.height !== size.height) {
    store.set({ vendorLoginBrowser: Object.assign({}, view, { requestedSize: size }) });
    input(Object.assign({ kind: "resize" }, size));
  }
  return size;
}

export function handleLoginBrowserMessage(msg) {
  var view = current();
  if (!view || msg.browserId !== view.browserId) return;
  var dialog = document.getElementById("vendor-login-browser");
  if (!dialog) return;
  if (msg.type === "vendor_login_browser_status") {
    dialog.querySelector('[role="status"]').textContent = msg.text;
    dialog.dataset.phase = msg.phase || "loading";
    store.set({ vendorLoginBrowser: Object.assign({}, view, { phase: msg.phase || "loading" }) });
    return;
  }
  if (view.decoding || typeof msg.data !== "string" || msg.origin === "null") return;
  store.set({ vendorLoginBrowser: Object.assign({}, view, { decoding: true }) });
  var image = new Image();
  function done() {
    var active = current();
    if (active && active.browserId === msg.browserId) store.set({ vendorLoginBrowser: Object.assign({}, active, { decoding: false }) });
  }
  image.onload = function () {
    var active = current();
    if (active && active.browserId === msg.browserId) {
      var size = resizeLoginBrowser();
      if (image.naturalWidth !== size.width || image.naturalHeight !== size.height) {
        resizeLoginBrowser(true);
        done();
        return;
      }
      var canvas = dialog.querySelector("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      dialog.querySelector(".login-browser-loading").hidden = true;
      var origin = dialog.querySelector(".login-browser-origin");
      try { origin.textContent = new URL(msg.origin).host; } catch (e) { origin.textContent = "Sign-in page"; }
      origin.title = msg.origin || "";
    }
    done();
  };
  image.onerror = done;
  image.src = "data:image/jpeg;base64," + msg.data;
}

store.subscribe(function (state, previous) {
  var view = state.vendorLoginBrowser;
  if (!view) return;
  if (state.currentSlug !== previous.currentSlug && state.currentSlug !== view.slug) { closeLoginBrowser(); return; }
  if (state.connected !== previous.connected) {
    if (state.connected) { send("vendor_login_browser_attach"); resizeLoginBrowser(true); }
    else {
      var dialog = document.getElementById("vendor-login-browser");
      if (dialog) {
        dialog.dataset.phase = "error";
        dialog.querySelector('[role="status"]').textContent = "Connection lost. Reconnecting…";
      }
    }
  }
});
