var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var http = require("node:http");
var path = require("node:path");

function loadPlaywright() {
  try { return require("playwright"); } catch (error) { return null; }
}

function servePublic() {
  var root = path.join(__dirname, "../lib/public");
  var server = http.createServer(function (request, response) {
    var relative = decodeURIComponent(request.url.split("?")[0]).replace(/^\/+/, "");
    if (relative === "__session_context_test__.html") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><html><body></body></html>");
      return;
    }
    var file = path.resolve(root, relative || "index.html");
    if (file.indexOf(root + path.sep) !== 0 || !fs.existsSync(file)) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "text/html");
    response.end(fs.readFileSync(file));
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

test("session menu dismisses on every outside press and inline rename is exact and guarded", async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip("Playwright is not installed"); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip("Chromium is not available: " + error.message); return; }
  var server = await servePublic();
  t.after(function () { server.close(); return browser.close(); });
  var port = server.address().port;
  var page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + port + "/__session_context_test__.html");

  var result = await page.evaluate(async function () {
    document.body.innerHTML = '<button id="plain">Plain</button><button id="blocked">Blocked</button><button id="touch">Touch</button>' +
      '<div class="title-bar-content"><div id="header-left"><span class="header-title" id="header-title">Alpha</span><button id="header-rename-btn" type="button">Rename header</button></div></div>' +
      '<div id="favorite" class="session-item" data-session-id="7"><span class="session-item-text"><span class="session-item-title"><mark>Al</mark>pha</span></span></div>' +
      '<div id="actual" class="session-item" data-session-id="7"><span class="session-item-text"><span class="session-item-title">Alpha</span></span></div>' +
      '<div id="mobile" class="mobile-session-item" data-session-id="7"><span class="mobile-session-title" tabindex="0">Alpha</span></div>';
    var storeModule = await import("/modules/store.js");
    var wsModule = await import("/modules/ws-ref.js");
    var menuModule = await import("/modules/session-context-menu.js");
    var store = storeModule.store;
    var sent = [];
    var socket = { readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } };
    storeModule.createStore({ connected: true, currentSlug: "project-a", activeSessionId: 7, splitPanes: null, dmMode: false, permissions: null, sessionContextMenu: null, sessionInlineRename: null });
    wsModule.setWs(socket);
    var clicked = 0;
    document.getElementById("plain").addEventListener("click", function () { clicked++; });
    document.getElementById("blocked").addEventListener("pointerdown", function (event) { event.preventDefault(); event.stopPropagation(); });
    document.getElementById("blocked").addEventListener("click", function () { clicked++; });

    function menu(action) {
      var el = document.createElement("div");
      var button = document.createElement("button");
      button.textContent = "Rename";
      button.addEventListener("click", function (event) { event.stopPropagation(); menuModule.closeSessionContextMenu(false); if (action) action(); });
      el.appendChild(button);
      document.body.appendChild(el);
      menuModule.mountSessionContextMenu(el, document.getElementById("actual"), 7);
      return { el: el, button: button };
    }

    menu();
    document.getElementById("plain").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    document.getElementById("plain").click();
    var plainDismissed = !store.get("sessionContextMenu") && clicked === 1;

    menu();
    document.getElementById("blocked").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    document.getElementById("blocked").click();
    var blockedDismissed = !store.get("sessionContextMenu") && clicked === 2;

    menu();
    document.getElementById("touch").dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true }));
    var touchDismissed = !store.get("sessionContextMenu");

    menu();
    window.dispatchEvent(new Event("blur"));
    var windowBlurDismissed = !store.get("sessionContextMenu");

    var actionRuns = 0;
    var actionMenu = menu(function () { actionRuns++; });
    actionMenu.button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    actionMenu.button.click();
    var insideAction = actionRuns === 1 && !store.get("sessionContextMenu");

    menu();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    var escapeFocus = document.activeElement === document.getElementById("actual") && document.getElementById("actual").getAttribute("tabindex") === "-1";

    var rowActivations = 0;
    document.getElementById("favorite").addEventListener("click", function () { rowActivations++; });
    menuModule.startSessionInlineRename(document.getElementById("favorite"), { id: 7, title: "Alpha" });
    var favoriteInput = document.querySelector("#favorite .session-rename-input");
    var exactFavorite = !!favoriteInput && !document.querySelector("#actual .session-rename-input");
    favoriteInput.click();
    favoriteInput.value = "Composed";
    favoriteInput.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    favoriteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    var compositionHeld = sent.length === 0 && favoriteInput.isConnected;
    favoriteInput.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    favoriteInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    favoriteInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    var enterOnce = sent.length === 1 && sent[0].type === "rename_session" && sent[0].title === "Composed" && document.querySelector("#favorite .session-item-title").textContent === "Alpha";

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var escapeInput = document.querySelector("#actual .session-rename-input");
    escapeInput.value = "Discard";
    escapeInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    escapeInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    var escapeCancelled = sent.length === 1 && document.querySelector("#actual .session-item-title").textContent === "Alpha";

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var emptyInput = document.querySelector("#actual .session-rename-input");
    emptyInput.value = "   ";
    emptyInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    var emptyCancelled = sent.length === 1;

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var blurInput = document.querySelector("#actual .session-rename-input");
    blurInput.value = "  Blurred title  ";
    blurInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    var blurSaved = sent.length === 2 && sent[1].title === "Blurred title";

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    menuModule.startSessionInlineRename(document.getElementById("mobile"), { id: 7, title: "Alpha" });
    var exactMobile = !!document.querySelector("#mobile .session-rename-input") && !document.querySelector("#actual .session-rename-input") && document.querySelector("#actual .session-item-title").textContent === "Alpha";
    menuModule.cancelSessionInlineRename(false);

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var projectInput = document.querySelector("#actual .session-rename-input");
    projectInput.value = "Wrong project";
    store.set({ currentSlug: "project-b" });
    var projectCancelled = !projectInput.isConnected && sent.length === 2;
    store.set({ currentSlug: "project-a" });

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var socketInput = document.querySelector("#actual .session-rename-input");
    socketInput.value = "Wrong socket";
    wsModule.setWs({ readyState: 1, send: function (raw) { sent.push(JSON.parse(raw)); } });
    socketInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    var socketGuarded = sent.length === 2;
    wsModule.setWs(socket);

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var disconnectedInput = document.querySelector("#actual .session-rename-input");
    disconnectedInput.value = "Disconnected";
    store.set({ connected: false });
    var disconnectCancelled = !disconnectedInput.isConnected && sent.length === 2;
    store.set({ connected: true });

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var permissionInput = document.querySelector("#actual .session-rename-input");
    permissionInput.value = "No permission";
    store.set({ permissions: { sessionRename: false } });
    permissionInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    var permissionGuarded = sent.length === 2;
    store.set({ permissions: null });

    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    var detachedInput = document.querySelector("#actual .session-rename-input");
    detachedInput.value = "Rerender";
    menuModule.cancelSessionInlineRename(false);
    var rerenderCancelled = !store.get("sessionInlineRename") && !detachedInput.isConnected && sent.length === 2;

    window.marked = { use: function () {}, parse: function (value) { return value; } };
    window.mermaid = { initialize: function () {} };
    var headerModule = await import("/modules/app-header.js");
    headerModule.initHeader();
    var headerBaseline = sent.filter(function (message) { return message.type === "rename_session"; }).length;
    menuModule.startSessionInlineRename(document.getElementById("actual"), { id: 7, title: "Alpha" });
    document.getElementById("header-rename-btn").click();
    var headerInput = document.querySelector("#header-title .header-rename-input");
    var headerExact = !!headerInput && !document.querySelector("#actual .session-rename-input") && document.getElementById("header-rename-btn").style.display === "none";
    headerInput.value = "Wrong active session";
    store.set({ activeSessionId: 8 });
    headerInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    var headerRenames = sent.filter(function (message) { return message.type === "rename_session"; });
    var headerSessionGuarded = headerRenames.length === headerBaseline && document.getElementById("header-title").textContent === "Alpha";
    store.set({ activeSessionId: 7 });
    document.getElementById("header-rename-btn").click();
    headerInput = document.querySelector("#header-title .header-rename-input");
    headerInput.value = "Header title";
    headerInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    headerInput.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    headerRenames = sent.filter(function (message) { return message.type === "rename_session"; });
    var headerEnterOnce = headerRenames.length === headerBaseline + 1 && headerRenames[headerBaseline].id === 7 && headerRenames[headerBaseline].title === "Header title" &&
      document.getElementById("header-title").textContent === "Alpha" && document.getElementById("header-rename-btn").style.display === "";

    return {
      plainDismissed: plainDismissed,
      blockedDismissed: blockedDismissed,
      touchDismissed: touchDismissed,
      windowBlurDismissed: windowBlurDismissed,
      insideAction: insideAction,
      escapeFocus: escapeFocus,
      exactFavorite: exactFavorite,
      rowActivationBlocked: rowActivations === 0,
      compositionHeld: compositionHeld,
      enterOnce: enterOnce,
      escapeCancelled: escapeCancelled,
      emptyCancelled: emptyCancelled,
      blurSaved: blurSaved,
      exactMobile: exactMobile,
      projectCancelled: projectCancelled,
      socketGuarded: socketGuarded,
      disconnectCancelled: disconnectCancelled,
      permissionGuarded: permissionGuarded,
      rerenderCancelled: rerenderCancelled,
      headerExact: headerExact,
      headerSessionGuarded: headerSessionGuarded,
      headerEnterOnce: headerEnterOnce,
    };
  });

  assert.deepEqual(result, {
    plainDismissed: true,
    blockedDismissed: true,
    touchDismissed: true,
    windowBlurDismissed: true,
    insideAction: true,
    escapeFocus: true,
    exactFavorite: true,
    rowActivationBlocked: true,
    compositionHeld: true,
    enterOnce: true,
    escapeCancelled: true,
    emptyCancelled: true,
    blurSaved: true,
    exactMobile: true,
    projectCancelled: true,
    socketGuarded: true,
    disconnectCancelled: true,
    permissionGuarded: true,
    rerenderCancelled: true,
    headerExact: true,
    headerSessionGuarded: true,
    headerEnterOnce: true,
  });
});
