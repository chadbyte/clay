var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;
var chromium = require("playwright").chromium;

test("production project strip opens metadata without fetching foreign content; owner retains chat", { skip: !process.env.RUN_OWNERSHIP_BROWSER, timeout: 60000 }, async function (t) {
  var child = fork(path.join(__dirname, "fixtures/project-list-access-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"], env: Object.assign({}, process.env, { OWNERSHIP_RECOVERY_FIXTURE: "1" }) });
  t.after(function () { if (child.connected) child.send("close"); });
  var fixture = await new Promise(function (resolve, reject) { child.once("message", resolve); child.once("error", reject); });
  var browser = await chromium.launch({ headless: true });
  t.after(function () { return browser.close(); });
  var context = await browser.newContext();
  var page = await context.newPage();
  var errors = [];
  page.on("pageerror", function (error) { errors.push(error.message); });
  var responses = [];
  var sockets = [];
  page.on("response", function (response) {
    if (response.url().indexOf("/p/hidden/") !== -1) responses.push(response.url());
  });
  page.on("websocket", function (socket) {
    sockets.push(socket.url());
    socket.on("framereceived", function (frame) {
      assert.doesNotMatch(String(frame.payload), /PRIVATE_SESSION_SENTINEL|PRIVATE_MESSAGE_SENTINEL/);
    });
  });
  var base = "http://127.0.0.1:" + fixture.port;
  await page.goto(base + "/__fixture/admin", { waitUntil: "domcontentloaded" });
  try { await page.locator('.icon-strip-item[data-slug="hidden"]').waitFor({ timeout: 15000 }); }
  catch (error) { throw new Error(error.message + " Page errors: " + errors.join("; ")); }
  await page.locator('.icon-strip-item[data-slug="hidden"]').click();
  await page.getByRole("tab", { name: "Overview", exact: true }).waitFor();
  assert.equal(await page.locator("#messages, #input, #sidebar, #terminal-panel").count(), 0);
  assert.match(await page.locator("main").textContent(), /Administrative metadata only/);
  assert.doesNotMatch(await page.content(), /PRIVATE_|hidden-secret-path/);
  assert.ok(sockets.every(function (url) { return url.indexOf("/p/hidden/") === -1; }));
  assert.deepEqual(responses, [base + "/p/hidden/"]);
  await page.getByRole("tab", { name: "Access", exact: true }).click();
  assert.equal(await page.locator("#access-panel").isVisible(), true);
  assert.equal(await page.locator("#access-panel input, #access-panel select").count(), 0);
  await page.setViewportSize({ width: 375, height: 760 });
  assert.equal(await page.locator("#access-panel").isVisible(), true);
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("#messages").count(), 0);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").evaluate(function (element) { return element.classList.contains("dark-theme"); }), true);
  assert.equal(await page.locator("#messages, #input").count(), 0);
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.locator("html").evaluate(function (element) { return element.classList.contains("light-theme"); }), true);
  // Owner uses a separate authenticated browser context.
  var ownerContext = await browser.newContext();
  var ownerPage = await ownerContext.newPage();
  await ownerPage.goto(base + "/__fixture/owner", { waitUntil: "domcontentloaded" });
  await ownerPage.getByText("PRIVATE_SESSION_SENTINEL", { exact: true }).first().waitFor({ timeout: 15000 });
  assert.equal(await ownerPage.locator("#input").count(), 1);
  await page.goto(base + "/p/orphan/", { waitUntil: "domcontentloaded" });
  assert.match(await page.locator("#overview-panel").textContent(), /server operator.*OS UID and real home\/project mapping/);
  assert.doesNotMatch(await page.locator("main").textContent(), /Ask the owner|Only the project owner can change/);
  await page.getByRole("tab", { name: "Access", exact: true }).click();
  assert.match(await page.locator("#access-panel").textContent(), /administrator status cannot claim this project/);
  assert.equal(await page.locator("#messages, #input, #sidebar").count(), 0);
});
