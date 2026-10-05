// Real Chromium trackpad-style wheel burst through the real Browser panel, WebSocket
// transport and project coordinator, behind the same per-connection limiter as lib/server.js.
var test = require("node:test");
var assert = require("node:assert/strict");
var http = require("http");
var fs = require("fs");
var path = require("path");
var attach = require("../lib/project-shared-browser").attachSharedBrowser;
var applyWsRateLimit = require("../lib/ws-rate-limit").applyWsRateLimit;
var WS_RATE_LIMIT = require("../lib/ws-rate-limit").WS_RATE_LIMIT;
var root = path.resolve(__dirname, "../lib/public");

var page = '<!doctype html><html><head><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/shared-browser.css"><link rel="stylesheet" href="/css/right-workbench.css"><style>body{margin:0}#main-panels{display:flex;height:100vh}#app{flex:1}</style></head><body><div id="main-panels"><main id="app"><button id="shared-browser-btn">Browser</button></main></div><script>window.lucide={createIcons:function(){}};</script><script type="module">' +
  'import {createStore,store} from "/modules/store.js";import {setWs} from "/modules/ws-ref.js";import {initSharedBrowser,handleSharedBrowserMessage} from "/modules/shared-browser.js";' +
  'createStore({currentSlug:"fixture",activeSessionId:1,connected:false,permissions:{terminal:true},sharedBrowserUi:{}});window.store=store;window.sentTimes=[];window.closeCodes=[];' +
  'var ws=new WebSocket("ws://"+location.host);var send=ws.send.bind(ws);ws.send=function(data){window.sentTimes.push(performance.now());return send(data);};' +
  'setWs(ws);ws.onopen=function(){store.set({connected:true});};ws.onclose=function(e){window.closeCodes.push(e.code);store.set({connected:false});};ws.onmessage=function(e){handleSharedBrowserMessage(JSON.parse(e.data));};initSharedBrowser();</script></body></html>';

function loadPlaywright() { try { return require("playwright"); } catch (e) { return null; } }

test("a realistic trackpad wheel burst is coalesced and never trips the WebSocket rate limit", { timeout: 120000 }, async function (t) {
  var playwright = loadPlaywright();
  if (!playwright) { t.skip("playwright is not installed"); return; }
  var chrome;
  try { chrome = await playwright.chromium.launch(); } catch (e) { t.skip("Chromium is not available: " + e.message); return; }
  var WebSocketServer = require("ws").WebSocketServer;
  var clients = new Set(); var session = { localId: 1, ownerId: "owner" };
  var wheels = []; var received = 0; var closeCodes = [];
  var controller = attach({ slug: "fixture", sm: { sessions: new Map([[1, session]]) }, clients: clients,
    usersModule: { isMultiUser: function () { return true; }, findUserById: function () { return { id: "owner" }; } },
    requestAccess: { canAccessProject: function () { return true; }, hasPermission: function () { return true; } },
    getIdentity: function () { return null; }, getSessionForWs: function () { return session; },
    sendTo: function (ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
    createRuntime: function (options) {
      setImmediate(function () { options.onEvent({ type: "ready", url: "https://example.com/", width: 1280, height: 800 }); });
      return { control: function () {}, viewing: function () {}, close: function () {}, settle: function () { return Promise.resolve({ through: 0 }); },
        request: function (action, event) { if (event && event.kind === "wheel") wheels.push({ at: Date.now(), deltaY: event.deltaY }); return Promise.resolve({}); } };
    },
  });
  var server = http.createServer(function (req, res) {
    var url = new URL(req.url, "http://localhost");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(page); return; }
    var file = path.resolve(root, "." + url.pathname);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, data) { if (err) { res.writeHead(404); res.end(); return; } res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript"); res.end(data); });
  });
  var wss = new WebSocketServer({ server: server });
  wss.on("connection", function (ws) {
    applyWsRateLimit(ws, WS_RATE_LIMIT);
    ws._clayUser = { id: "owner" }; clients.add(ws);
    ws.on("close", function (code) { clients.delete(ws); closeCodes.push(code); });
    ws.on("message", function (data) { received++; controller.handleMessage(ws, JSON.parse(data)); });
  });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  var tab = await chrome.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    await tab.goto("http://127.0.0.1:" + server.address().port);
    await tab.waitForFunction(function () { return window.store.get("connected"); });
    await tab.getByRole("button", { name: "Open browser", exact: true }).click();
    await tab.waitForFunction(function () { var b = window.store.get("sharedBrowser"); return b && b.phase === "live"; });
    // No lock click: scrolling works in the default shared mode.
    assert.equal(await tab.evaluate(function () { return window.store.get("sharedBrowser").control; }), "agent");
    var box = await tab.locator("#shared-browser-panel canvas").boundingBox();
    // ~120 Hz trackpad (ProMotion-class display) for ~1.5 s, with momentum-sized deltas, as real
    // cancelable WheelEvents on the canvas. Rapid mouse.wheel calls are frame-limited in headless Chromium.
    var total = await tab.evaluate(function () {
      return new Promise(function (resolve) {
        var canvas = document.querySelector("#shared-browser-panel canvas"); var box = canvas.getBoundingClientRect();
        var sum = 0; var count = 0; var started = performance.now();
        (function next() {
          var due = started + count * 8.33;
          if (count >= 180) { resolve(sum); return; }
          var delta = 4 + (count % 7); sum += delta; count++;
          canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: box.x + 50, clientY: box.y + 50, bubbles: true, cancelable: true }));
          setTimeout(next, Math.max(0, due + 8.33 - performance.now()));
        })();
      });
    });
    await tab.waitForTimeout(400);
    var info = await tab.evaluate(function () {
      var times = window.sentTimes; var worst = 0;
      for (var i = 0; i < times.length; i++) { var n = 0; for (var j = i; j < times.length && times[j] - times[i] < 1000; j++) n++; if (n > worst) worst = n; }
      return { closeCodes: window.closeCodes, connected: window.store.get("connected"), worstPerSecond: worst };
    });
    assert.deepEqual(info.closeCodes, [], "the page WebSocket stayed open");
    assert.deepEqual(closeCodes, [], "the server never closed the connection (1008 rate limit)");
    assert.equal(info.connected, true);
    assert.ok(info.worstPerSecond <= WS_RATE_LIMIT / 2, "client sent at most " + WS_RATE_LIMIT / 2 + " messages/s, saw " + info.worstPerSecond);
    assert.ok(wheels.length > 1 && wheels.length < 60, "wheel input is coalesced, saw " + wheels.length + " requests");
    assert.equal(wheels.reduce(function (sum, w) { return sum + w.deltaY; }, 0), total, "no scroll distance is lost by coalescing");

    // A large accumulated delta is sent in bounded chunks without losing distance while writable.
    function wheelSum() { return wheels.reduce(function (sum, w) { return sum + w.deltaY; }, 0); }
    function dispatch(delta) {
      return tab.evaluate(function (amount) {
        var canvas = document.querySelector("#shared-browser-panel canvas"); var box = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: amount, clientX: box.x + 50, clientY: box.y + 50, bubbles: true, cancelable: true }));
      }, delta);
    }
    var before = wheelSum(); var count = wheels.length;
    await dispatch(5000); await tab.waitForTimeout(500);
    assert.equal(wheelSum() - before, 5000, "accumulated delta above one chunk is conserved");
    assert.ok(wheels.length - count >= 3 && wheels.slice(count).every(function (w) { return Math.abs(w.deltaY) <= 2000; }), "sent in chunks of at most 2000");

    // Losing the connection or a control handoff before the queue drains discards the whole remainder for good:
    // restoring writability right after the first flush tick must not replay the rest.
    function loseThenRestore(lose, restore) {
      return tab.evaluate(function (fns) {
        var canvas = document.querySelector("#shared-browser-panel canvas"); var box = canvas.getBoundingClientRect();
        var store = window.store;
        return new Promise(function (resolve) {
          canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 7000, clientX: box.x + 50, clientY: box.y + 50, bubbles: true, cancelable: true }));
          new Function("store", fns.lose)(store);
          setTimeout(function () { new Function("store", fns.restore)(store); resolve(); }, 70);
        });
      }, { lose: lose, restore: restore });
    }
    before = wheelSum();
    await loseThenRestore("store.set({ connected: false });", "store.set({ connected: true });");
    await tab.waitForTimeout(500);
    assert.equal(wheelSum(), before, "no stale scroll is replayed after reconnect");
    assert.equal(await tab.evaluate(function () { return window.store.get("sharedBrowserUi").wheelDelta || 0; }), 0);
    await loseThenRestore("var b = store.get('sharedBrowser'); store.set({ sharedBrowser: Object.assign({}, b, { handoff: true }) });",
      "var b = store.get('sharedBrowser'); store.set({ sharedBrowser: Object.assign({}, b, { handoff: false }) });");
    await tab.waitForTimeout(500);
    assert.equal(wheelSum(), before, "a control handoff also discards queued scroll");
    await dispatch(300); await tab.waitForTimeout(200);
    assert.equal(wheelSum() - before, 300, "scrolling works again once writable");
  } finally {
    await tab.close(); await chrome.close(); controller.destroy();
    wss.clients.forEach(function (ws) { ws.terminate(); }); wss.close(); server.close();
  }
});
