// Isolated browser process. Its OS identity matches the owning Driver session.
var chromium = require("playwright").chromium;
var policy = require("./shared-browser-policy");
var browser = null;
var context = null;
var page = null;
var closing = false;
var viewing = false;
var epoch = 0;
var queue = Promise.resolve();
var pending = 0;
var timer = null;
var activeActivity = null;
var pointerSequence = 0;
var viewport = { width: 1280, height: 800 };
function emit(message) {
  if (!closing && process.stdout.writableLength < 3 * 1024 * 1024) process.stdout.write(JSON.stringify(message) + "\n");
}
function state() {
  return { url: page ? policy.visibleUrl(page.url()) : "", width: viewport.width, height: viewport.height };
}
async function screenshot() {
  return (await page.screenshot({ type: "jpeg", quality: 70, caret: "initial", timeout: 5000 })).toString("base64");
}
async function capture() {
  if (closing) return;
  try {
    if (viewing && page && !page.isClosed()) {
      var current = page;
      var data = await screenshot();
      if (current === page) emit(Object.assign({ type: "frame", data: data }, state()));
    }
  } catch (e) {}
  if (!closing) timer = setTimeout(capture, 250);
}
async function start() {
  var channels = ["chrome", "msedge", null];
  for (var i = 0; i < channels.length; i++) {
    try { browser = await chromium.launch({ channel: channels[i] || undefined, headless: true, chromiumSandbox: true, timeout: 15000 }); break; }
    catch (e) { if (closing) return; }
  }
  if (!browser) throw new Error("Install Chrome or run npx playwright install chromium on the Clay host. Linux also needs browser libraries and sandbox support.");
  if (closing) { await browser.close(); return; }
  var cdp = await browser.newBrowserCDPSession();
  var version = await cdp.send("Browser.getVersion");
  await cdp.detach();
  context = await browser.newContext({ viewport: viewport, acceptDownloads: false, userAgent: version.userAgent.replace("HeadlessChrome/", "Chrome/") });
  await context.addInitScript(require("./vendor-login-browser-passkeys").disableLoginPasskeys);
  await context.route("**/*", function (route) {
    var protocol = new URL(route.request().url()).protocol;
    return ["http:", "https:"].includes(protocol) ? route.continue() : route.abort();
  });
  context.on("page", function (opened) {
    page = opened;
    opened.setDefaultTimeout(10000);
    opened.on("dialog", function (dialog) { dialog.dismiss().catch(function () {}); });
    opened.on("download", function (download) { download.cancel().catch(function () {}); });
    opened.on("framenavigated", function (frame) { if (frame === opened.mainFrame() && page === opened) emit(Object.assign({ type: "state" }, state())); });
    opened.on("close", function () { var pages = context.pages(); page = pages.length ? pages[pages.length - 1] : null; emit(Object.assign({ type: "state" }, state())); });
  });
  page = await context.newPage();
  emit(Object.assign({ type: "ready" }, state()));
  capture();
}
function reportActivity(phase) {
  if (activeActivity) emit({ type: "activity", epoch: activeActivity.epoch, generation: activeActivity.generation,
    activity: { id: activeActivity.id, text: activeActivity.text, phase: phase } });
}
function reportPointer(x, y, clicked) {
  if (activeActivity) emit({ type: "pointer", epoch: activeActivity.epoch, generation: activeActivity.generation,
    pointer: { x: x, y: y, width: viewport.width, height: viewport.height, clicked: !!clicked, sequence: ++pointerSequence, commandId: activeActivity.id } });
}
function activityText(message) {
  var defaults = { inspect: "I'll take a look at the page to see what's there.", navigate: "I'll open this page so we can take a look.", back: "I'll go back to the previous page.", forward: "I'll move forward to the next page.", reload: "I'll refresh the page to see its latest state.", click: "I'll click this control and see what happens.", text: "I'll enter the text in this field.", select: "I'll choose this option in the form.", key: "I'll use the keyboard for this step.", wheel: "I'll scroll a little to see more of the page.", resize: "I'll change the screen size to check the layout." };
  return message.activity.intent || defaults[message.action === "inspect" ? "inspect" : message.event.kind] || "I'll work through the next step in the browser.";
}
async function action(event) {
  if (!page || page.isClosed()) page = await context.newPage();
  event = policy.validateAction(event);
  if (event.kind === "navigate") await page.goto(event.url, { waitUntil: "domcontentloaded", timeout: 20000 });
  else if (event.kind === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 });
  else if (event.kind === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: 20000 });
  else if (event.kind === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  else if (event.kind === "click" && event.selector) {
    var target = page.locator(event.selector);
    await target.click({ trial: true });
    var box = await target.boundingBox();
    if (box) {
      var x = Math.max(0, Math.min(viewport.width - 1, box.x + box.width / 2));
      var y = Math.max(0, Math.min(viewport.height - 1, box.y + box.height / 2));
      await page.mouse.move(x, y);
      reportPointer(x, y, true);
      await target.click({ position: { x: x - box.x, y: y - box.y } });
    } else await target.click();
  }
  else if (["move", "down", "up", "click"].includes(event.kind)) {
    await page.mouse.move(Math.max(0, Math.min(viewport.width - 1, event.x)), Math.max(0, Math.min(viewport.height - 1, event.y)));
    reportPointer(Math.max(0, Math.min(viewport.width - 1, event.x)), Math.max(0, Math.min(viewport.height - 1, event.y)), event.kind === "click" || event.kind === "down");
    if (event.kind === "down") await page.mouse.down();
    if (event.kind === "up") await page.mouse.up();
    if (event.kind === "click") await page.mouse.click(event.x, event.y);
  } else if (event.kind === "text") {
    if (event.selector) await page.locator(event.selector).fill(event.text);
    else await page.keyboard.insertText(event.text);
  } else if (event.kind === "select") await page.locator(event.selector).selectOption(event.text);
  else if (event.kind === "key") await page.keyboard.press(event.key);
  else if (event.kind === "wheel") await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, event.deltaY)));
  else if (event.kind === "resize") {
    viewport = { width: Math.round(event.width), height: Math.round(event.height) };
    await page.setViewportSize(viewport);
  }
  return state();
}
async function command(message) {
  if (message.epoch !== epoch) throw new Error("Browser control changed; this action was cancelled");
  activeActivity = message.activity ? { id: message.id, epoch: message.epoch, generation: message.activity.generation, text: activityText(message) } : null;
  if (message.event && ["navigate", "back", "forward", "reload", "resize"].includes(message.event.kind) && activeActivity) {
    emit({ type: "pointer", epoch: message.epoch, generation: activeActivity.generation, pointer: null });
  }
  reportActivity("running");
  if (message.action === "inspect") {
    if (!page || page.isClosed()) throw new Error("Open a page first");
    return Object.assign(state(), { snapshot: (await page.locator("body").ariaSnapshot()).slice(0, 24000), image: await screenshot() });
  }
  return action(message.event);
}
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  if (browser) await browser.close().catch(function () {});
  process.exit(0);
}
var lines = require("readline").createInterface({ input: process.stdin });
lines.on("line", function (line) {
  if (line.length > 30000 || closing) return;
  var msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  if (msg.type === "start") {
    if (!browser) queue = queue.then(start).catch(function (e) { emit({ type: "error", error: e.message }); });
  } else if (msg.type === "viewing") viewing = !!msg.value;
  else if (msg.type === "control") {
    epoch = msg.epoch;
    queue = queue.then(async function () {
      if (page) await page.mouse.up().catch(function () {});
      emit({ type: "result", id: msg.id, value: { epoch: msg.epoch } });
    });
  } else if (msg.type === "settle") {
    // Resolves only after every earlier queued command has finished and reported its telemetry.
    queue = queue.then(function () { emit({ type: "result", id: msg.id, value: { through: msg.id } }); });
  } else if (msg.type === "command") {
    if (pending >= 80) { emit({ type: "result", id: msg.id, error: "Browser is busy; retry shortly" }); return; }
    pending++;
    queue = queue.then(function () { return command(msg); }).then(function (value) {
      reportActivity("complete"); activeActivity = null;
      emit({ type: "result", id: msg.id, value: value });
      emit(Object.assign({ type: "state" }, state()));
    }, function (e) { reportActivity("failed"); activeActivity = null; emit({ type: "result", id: msg.id, error: e.message }); }).finally(function () { pending--; });
  }
});
lines.on("close", close);
process.on("SIGTERM", close);
process.on("SIGINT", close);
