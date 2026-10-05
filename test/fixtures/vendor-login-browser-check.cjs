// Explicit real-browser UI check, including the real terminal modal and WebSocket transport.
// Provider page, PTY process, theme and unrelated pane bridge are fixtures; no accounts are used.
var http = require("http");
var fs = require("fs");
var path = require("path");
var assert = require("node:assert/strict");
var WebSocketServer = require("ws").WebSocketServer;
var chromium = require("playwright").chromium;
var attachVendorLogin = require("../../lib/project-vendor-login").attachVendorLogin;
var root = path.resolve(__dirname, "../..");
var assets = {};
var clients = new Set();
var terminals = new Map();
var browserFlows = [];
var inputs = [];
var nextId = 0;
function sendTo(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg) { clients.forEach(function (ws) { sendTo(ws, msg); }); }
var tm = {
  created: [], closed: [],
  create: function (cols, rows, identity, ws, opts) {
    var terminal = { id: ++nextId, opts: opts, peers: new Set() };
    this.created.push(terminal); terminals.set(terminal.id, terminal); return terminal;
  },
  has: function (id) { return terminals.has(id); },
  list: function () { return Array.from(terminals.values()).map(function (t) { return { id: t.id, title: t.opts.title }; }); },
  attach: function (id, ws) {
    var terminal = terminals.get(id); if (!terminal) return;
    terminal.peers.add(ws); sendTo(ws, { type: "term_output", id: id, data: "Running " + terminal.opts.initialInput.trim() + "\r\nPaste code: " });
  },
  close: function (id) { terminals.delete(id); this.closed.push(id); },
};
var login = attachVendorLogin({ slug: "demo", tm: tm, sm: { sessions: new Map() }, adapters: {}, send: broadcast, sendTo: sendTo,
  createLoginBrowser: function () {
    var browser = { id: "browser-" + browserFlows.length, env: {}, closed: false, output: function () {},
      attach: function (ws) { sendTo(ws, { type: "vendor_login_browser_status", browserId: this.id, phase: "ready", text: "Sign in to connect your account." }); },
      input: function () {}, close: function () { this.closed = true; } };
    browserFlows.push(browser); return browser;
  },
});
var html = '<!doctype html><html><head><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/vendor-login-browser.css"><link rel="stylesheet" href="/css/tui-attention.css"><link rel="stylesheet" href="/fixture/xterm.css"></head><body><button id="before">Clay workspace</button>' +
  '<script src="/fixture/lucide.js"></script><script src="/fixture/xterm.js"></script><script src="/fixture/fit.js"></script>' +
  '<script type="module">import {createStore,store} from "/modules/store.js";import {setWs} from "/modules/ws-ref.js";' +
  'import {requestVendorLogin,handleVendorLoginReady,handleVendorLoginState,handleVendorLoginError,handleAuthRefreshed} from "/modules/vendor-login.js";' +
  'import {handleLoginBrowserMessage} from "/modules/vendor-login-browser.js";' +
  'createStore({currentSlug:"demo",connected:true,vendorLoginBrowser:null});window.messages=[];window.store=store;window.frame=handleLoginBrowserMessage;window.complete=handleAuthRefreshed;' +
  'var ws=new WebSocket("ws://"+location.host+"/p/demo/ws");var originalSend=ws.send.bind(ws);ws.send=function(s){var m=JSON.parse(s);m.sentAt=performance.now();window.messages.push(m);originalSend(s);};setWs(ws);' +
  'ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.type==="vendor_login_ready")handleVendorLoginReady(m);if(m.type==="vendor_login_state")handleVendorLoginState(m);if(m.type==="vendor_login_error")handleVendorLoginError(m);if(m.type==="vendor_login_browser_status")handleLoginBrowserMessage(m);};' +
  'window.ready=function(vendor){requestVendorLogin(vendor||"claude",{mode:"browser"});};ws.onopen=function(){window.ready();};</script></body></html>';
var server = http.createServer(function (req, res) {
  var pathname = new URL(req.url, "http://localhost").pathname;
  if (assets[pathname]) { res.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : "text/javascript"); res.end(assets[pathname]); return; }
  if (pathname === "/modules/theme.js") { res.setHeader("Content-Type", "text/javascript"); res.end('export function getTerminalTheme(){return {background:"#171715",foreground:"#e8e8e3"};}'); return; }
  if (pathname === "/modules/pane-bridge.js") { res.setHeader("Content-Type", "text/javascript"); res.end('export function forwardPaneAuthRequired(){return false;}'); return; }
  if (pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
  var file = path.join(root, "lib/public", pathname);
  if (!file.startsWith(root + "/lib/public/")) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : "application/octet-stream"); res.end(data);
  });
});
var wss = new WebSocketServer({ server: server });
wss.on("connection", function (ws) {
  clients.add(ws); ws.on("close", function () { clients.delete(ws); });
  ws.on("message", function (data) {
    var msg = JSON.parse(data);
    if (login.handleVendorLoginMessage(ws, msg)) return;
    if (msg.type === "term_attach") tm.attach(msg.id, ws);
    if (msg.type === "term_input") {
      inputs.push(msg.data); sendTo(ws, { type: "term_output", id: msg.id, data: msg.data });
    }
    if (msg.type === "term_resize") sendTo(ws, { type: "term_resized", id: msg.id, cols: msg.cols, rows: msg.rows });
  });
});

(async function () {
  var dependencies = {
    "/fixture/lucide.js": "https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js",
    "/fixture/xterm.js": "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.min.js",
    "/fixture/xterm.css": "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css",
    "/fixture/fit.js": "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.min.js",
  };
  await Promise.all(Object.keys(dependencies).map(async function (key) {
    var response = await fetch(dependencies[key]); assert.ok(response.ok); assets[key] = await response.text();
  }));
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  var browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    var page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    var errors = []; page.on("pageerror", function (error) { errors.push(error.message); });
    await page.goto("http://127.0.0.1:" + server.address().port);
    await page.locator("#vendor-login-browser").waitFor();
    var preview = await browser.newPage();
    async function paint() {
      await page.waitForFunction(function () { return !!window.store.get("vendorLoginBrowser").requestedSize; });
      var view = await page.evaluate(function () { var s=window.store.get("vendorLoginBrowser");return {size:s.requestedSize,id:s.browserId}; });
      await preview.setViewportSize(view.size);
      await preview.setContent('<html><body style="font:15px system-ui;background:#faf9f6;color:#292823;margin:0"><main style="width:min(340px,calc(100% - 48px));margin:90px auto"><h1 style="font-family:Georgia,serif;font-size:34px;font-weight:400;text-align:center">Welcome back</h1><p style="text-align:center;color:#777">Sign in to continue to your account</p><label style="display:block;margin-top:32px">Email address<input style="box-sizing:border-box;display:block;width:100%;padding:13px;margin:9px 0 16px;border:1px solid #d5d2ca;border-radius:8px;font:inherit;background:white" placeholder="you@example.com"></label><button style="width:100%;padding:13px;border:0;border-radius:8px;background:#282722;color:#fff;font:inherit">Continue with email</button><p style="text-align:center;font-size:12px;color:#888;margin-top:24px">Local sign-in preview</p></main></body></html>');
      var frame = (await preview.screenshot({ type: "jpeg" })).toString("base64");
      await page.evaluate(function (value) { window.frame({ type:"vendor_login_browser_frame",browserId:value.id,data:value.data,origin:"https://fixture.example" }); }, { id: view.id, data: frame });
      await page.waitForFunction(function () { return document.querySelector(".login-browser-loading").hidden; });
    }
    await paint();
    assert.ok((await page.locator("#vendor-login-browser").boundingBox()).width <= 820);
    assert.strictEqual(await page.getByRole("button", {name:"Show keyboard"}).isVisible(), false);
    await page.getByText("Use terminal sign-in", { exact:true }).waitFor({state:"visible"});
    var bounds = await page.locator("canvas").boundingBox();
    await page.mouse.move(bounds.x+30,bounds.y+30); await page.mouse.move(bounds.x+80,bounds.y+80,{steps:5});
    await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up();
    await page.keyboard.type("fixture@example.com"); await page.keyboard.press("Tab");
    var messages = await page.evaluate(function () { return window.messages; });
    var down = messages.find(function (m) { return m.event && m.event.kind === "down"; });
    var up = messages.find(function (m) { return m.event && m.event.kind === "up"; });
    assert.ok(up && up.sentAt - down.sentAt >= 100);
    assert.ok(messages.some(function (m) { return m.event && m.event.kind === "move"; }));
    assert.ok(messages.some(function (m) { return m.event && m.event.kind === "text"; }));
    await page.screenshot({ path:"/tmp/clay-login-desktop.png" });
    await page.getByLabel("More sign-in options").click();
    await page.getByText("Restart sign-in",{exact:true}).waitFor({state:"visible"});
    await page.keyboard.press("Escape");
    assert.strictEqual(await page.locator("#vendor-login-browser").count(),1);
    assert.strictEqual(await page.locator("details").getAttribute("open"),null);
    var oldTerminal = tm.created[0].id;
    await page.getByText("Use terminal sign-in",{exact:true}).click();
    await page.locator(".tui-modal-backdrop:not(.hidden) .xterm").waitFor();
    await page.waitForFunction(function () { return window.messages.some(function(m){return m.type==="vendor_login_start"&&m.mode==="terminal";}); });
    assert.ok(browserFlows[0].closed); assert.ok(tm.closed.includes(oldTerminal));
    assert.strictEqual(tm.created[1].opts.initialInput,"claude auth login\n");
    assert.strictEqual(tm.created[1].opts.loginBrowserEnv,null);
    await page.locator(".xterm-helper-textarea").focus(); await page.keyboard.type("terminal-input");
    await page.waitForTimeout(100); assert.strictEqual(inputs.join(""),"terminal-input");
    await page.screenshot({path:"/tmp/clay-login-terminal.png"});
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await page.waitForTimeout(100); assert.strictEqual(terminals.size,0);
    await page.setViewportSize({width:390,height:844}); await page.evaluate(function(){window.ready();});
    await page.locator("#vendor-login-browser").waitFor(); await paint();
    assert.strictEqual(await page.getByRole("button",{name:"Show keyboard"}).isVisible(),true);
    await page.screenshot({path:"/tmp/clay-login-mobile.png"});
    assert.strictEqual(await page.evaluate(function(){return document.documentElement.scrollWidth>innerWidth;}),false);
    await page.evaluate(function(){window.store.set({connected:false});});
    assert.match(await page.locator('[role="status"]').innerText(),/Connection lost/);
    await page.evaluate(function(){window.store.set({connected:true});window.store.set({currentSlug:"other"});});
    assert.strictEqual(await page.locator("#vendor-login-browser").count(),0);
    assert.deepEqual(errors,[]);
    console.log("PASS: desktop/mobile UI, real pointer events, menu, browser cleanup, Claude auth command, real xterm input over WebSocket, cancellation and reconnect");
  } finally { await browser.close(); }
})().catch(function(error){console.error(error);process.exitCode=1;}).finally(function(){login.destroy();wss.clients.forEach(function(ws){ws.terminate();});wss.close();server.close();});
