// Runs as the same OS identity as the login CLI. Only the human supplies input.
var readline = require("readline");
var spawn = require("child_process").spawn;
var chromium = require("playwright").chromium;
var browser = null;
var page = null;
var installing = null;
var viewing = true;
var closing = false;
var captureTimer = null;
var inputQueue = Promise.resolve();
var queued = 0;
var viewport = { width: 1000, height: 720 };

function emit(message) {
  if (!closing && process.stdout.writableLength < 1024 * 1024) process.stdout.write(JSON.stringify(message) + "\n");
}

function status(text, phase) { emit({ type: "status", text: text, phase: phase || "loading" }); }

async function launch() {
  var channels = ["chrome", "msedge", null];
  for (var i = 0; i < channels.length; i++) {
    try {
      return await chromium.launch({ channel: channels[i] || undefined, headless: true, chromiumSandbox: true, timeout: 20000 });
    } catch (e) {
      if (closing) throw e;
    }
  }
  status("Preparing the sign-in browser. The first download may take a few minutes…");
  await new Promise(function (resolve, reject) {
    installing = spawn(process.execPath, [require("path").join(require.resolve("playwright/package.json"), "../cli.js"), "install", "chromium"], { stdio: "ignore", env: process.env });
    var timer = setTimeout(function () { installing.kill(); reject(new Error("Install timed out")); }, 180000);
    installing.once("error", function (err) { clearTimeout(timer); reject(err); });
    installing.once("exit", function (code) {
      clearTimeout(timer);
      installing = null;
      if (code === 0) resolve(); else reject(new Error("Browser installation failed"));
    });
  });
  if (closing) throw new Error("Closed");
  return chromium.launch({ headless: true, chromiumSandbox: true, timeout: 20000 });
}

async function capture() {
  if (closing) return;
  try {
    if (page && !page.isClosed() && viewing && process.stdout.writableLength < 262144) {
      var current = page;
      var data = await current.screenshot({ type: "jpeg", quality: 65, caret: "initial", timeout: 3000 });
      if (current === page) emit({ type: "frame", data: data.toString("base64"), origin: new URL(current.url()).origin,
        width: current.viewportSize().width, height: current.viewportSize().height });
    }
  } catch (e) {}
  if (!closing) captureTimer = setTimeout(capture, 250);
}

async function start(url) {
  browser = await launch();
  if (closing) { await browser.close(); return; }
  var session = await browser.newBrowserCDPSession();
  var version;
  try { version = await session.send("Browser.getVersion"); }
  finally { await session.detach(); }
  // Preserve the native version/platform and replace only the headless product token.
  var userAgent = version.userAgent.replace("HeadlessChrome/", "Chrome/");
  var context = await browser.newContext({ viewport: viewport, acceptDownloads: false, userAgent: userAgent });
  await context.addInitScript(require("./vendor-login-browser-passkeys").disableLoginPasskeys);
  var callback = new URL(new URL(url).searchParams.get("redirect_uri"));
  await context.route("**/*", function (route) {
    var target = new URL(route.request().url());
    if (target.protocol === "https:" || (target.origin === callback.origin && target.pathname === callback.pathname)) return route.continue();
    return route.abort();
  });
  context.on("page", function (opened) {
    page = opened;
    opened.setViewportSize(viewport).catch(function () {});
    opened.on("download", function (download) { download.cancel().catch(function () {}); });
    opened.on("close", function () {
      var pages = context.pages();
      page = pages.length ? pages[pages.length - 1] : null;
    });
  });
  page = await context.newPage();
  capture();
  status("Opening sign-in page…");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  status("Sign in to connect your account.", "ready");
}

async function input(event) {
  if (!page || page.isClosed() || closing) return;
  if (["move", "down", "up"].indexOf(event.kind) >= 0 && Number.isFinite(event.x) && Number.isFinite(event.y)) {
    var pointerSize = page.viewportSize();
    var x = Math.max(0, Math.min(pointerSize.width - 1, event.x));
    var y = Math.max(0, Math.min(pointerSize.height - 1, event.y));
    await page.mouse.move(x, y);
    if (event.kind === "down") await page.mouse.down();
    if (event.kind === "up") await page.mouse.up();
  } else if (event.kind === "click" && Number.isFinite(event.x) && Number.isFinite(event.y)) {
    var size = page.viewportSize();
    await page.mouse.click(Math.max(0, Math.min(size.width - 1, event.x)), Math.max(0, Math.min(size.height - 1, event.y)));
  } else if (event.kind === "wheel" && Number.isFinite(event.deltaY)) {
    await page.mouse.wheel(0, Math.max(-1500, Math.min(1500, event.deltaY)));
  } else if (event.kind === "text" && typeof event.text === "string" && event.text.length <= 4096) {
    await page.keyboard.insertText(event.text);
  } else if (event.kind === "key" && /^(Tab|Shift\+Tab|Enter|Backspace|Delete|Escape|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|ControlOrMeta\+A)$/.test(event.key)) {
    await page.keyboard.press(event.key);
  } else if (event.kind === "reload") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  } else if (event.kind === "resize" && Number.isFinite(event.width) && Number.isFinite(event.height)) {
    viewport = { width: Math.round(Math.max(320, Math.min(1000, event.width))), height: Math.round(Math.max(360, Math.min(720, event.height))) };
    await page.setViewportSize(viewport);
  }
}

async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(captureTimer);
  if (installing) installing.kill();
  if (browser) await browser.close().catch(function () {});
  process.exit(0);
}

var started = false;
var lines = readline.createInterface({ input: process.stdin });
lines.on("line", function (line) {
  if (line.length > 20000 || closing) return;
  var message;
  try { message = JSON.parse(line); } catch (e) { return; }
  if (message.type === "start" && !started) {
    started = true;
    start(message.url).catch(function () {
      status("Unable to open the sign-in browser. The host may need browser libraries or sandbox support. Use terminal sign-in to continue.", "error");
    });
  } else if (message.type === "viewing") {
    viewing = !!message.value;
  } else if (message.type === "input" && message.event && queued < 100) {
    if (message.event.kind === "move" && queued >= 10) return;
    queued++;
    inputQueue = inputQueue.then(function () { return input(message.event); }).catch(function () {
      status("The page did not respond. Try reloading.", "error");
    }).finally(function () { queued--; });
  }
});
lines.on("close", close);
process.on("SIGTERM", close);
process.on("SIGINT", close);
