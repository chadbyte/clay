var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("path");
var os = require("os");
var childProcess = require("child_process");
var playwright = require("playwright");

function waitFor(check, timeout, label) {
  var started = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      Promise.resolve().then(check).then(function (value) {
        if (value) { resolve(value); return; }
        if (Date.now() - started > timeout) { reject(new Error("fixture assertion timed out: " + (label || "unknown"))); return; }
        setTimeout(poll, 25);
      }, reject);
    }
    poll();
  });
}

test("production sticky-note checklist save path persists, syncs, and rolls back", async function (t) {
  var port = 2748 + (process.pid % 100);
  var clayHome = os.tmpdir() + "/clay-checklist-fixture-" + process.pid + "-" + Date.now();
  var fixture = path.join(__dirname, "fixtures/sticky-note-checklist-server.cjs");
  var server = childProcess.spawn(process.execPath, [fixture], { env: Object.assign({}, process.env, { STICKY_NOTE_FIXTURE_PORT: String(port), CLAY_HOME: clayHome }), stdio: ["ignore", "pipe", "pipe"] });
  t.after(function () { return new Promise(function (resolve) { server.once("exit", resolve); server.kill(); }); });
  await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error("fixture server timeout")); }, 5000); server.stdout.on("data", function (chunk) { if (String(chunk).indexOf("http://127.0.0.1:" + port) !== -1) { clearTimeout(timer); resolve(); } }); server.on("error", reject); });
  var browser;
  try { browser = await playwright.chromium.launch({ headless: true }); } catch (error) { t.skip("Chromium is not available: " + error.message); return; }
  t.after(function () { return browser.close(); });
  var pageA = await browser.newPage();
  var pageB = await browser.newPage();
  var url = "http://127.0.0.1:" + port + "/";
  await Promise.all([pageA.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 }), pageB.goto(url, { waitUntil: "domcontentloaded", timeout: 5000 })]);
  var cardA = pageA.locator(".sticky-note").first();
  var cardB = pageB.locator(".sticky-note").first();
  await pageA.getByRole("button", { name: "Fixture: fail next save" }).click();
  await cardA.locator(".sticky-note-checklist-btn").click();
  await waitFor(function () { return cardA.locator(".sticky-note-save-status").textContent().then(function (text) { return text.includes("could not be saved"); }); }, 3000, "failed MODE status");
  assert.equal(await cardA.locator(".sticky-note-checklist-btn").getAttribute("aria-pressed"), "false");
  assert.equal(await cardA.locator(".sticky-note-checklist-btn").getAttribute("title"), "Show checklist");
  assert.equal(await cardA.locator(".sticky-note-rendered").getAttribute("contenteditable"), "true");
  assert.equal(await cardA.locator(".sn-check[data-checklist-key]").count(), 0);
  await cardA.locator(".sticky-note-checklist-btn").click();
  await waitFor(function () { return cardA.locator(".sn-check").count().then(function (count) { return count === 3; }); }, 3000, "initial A mode");
  assert.equal(await cardA.locator(".sticky-note-checklist-btn").getAttribute("aria-pressed"), "true");
  await waitFor(function () { return cardB.locator(".sn-check").count().then(function (count) { return count === 3; }); }, 3000, "remote mode");
  await cardA.locator(".sn-check").first().click();
  await waitFor(function () { return cardB.locator(".sn-check.checked").count().then(function (count) { return count === 1; }); }, 3000, "remote check");
  var sourceBefore = await cardA.locator(".sticky-note-text").inputValue();
  await cardA.locator(".sticky-note-md-btn").click();
  assert.equal(await cardA.locator(".sticky-note-text").inputValue(), sourceBefore);
  await cardA.locator(".sticky-note-md-btn").click();
  await cardA.locator(".sticky-note-rendered").dispatchEvent("blur");
  assert.equal(await cardA.locator(".sticky-note-text").inputValue(), sourceBefore);
  var insertedSource = "Plan\nInserted task\nFirst task\nSecond task\n~~~js\n[ ] literal code\n~~~\nFirst task";
  await cardA.locator(".sticky-note-md-btn").click();
  await cardA.locator(".sticky-note-text").fill(insertedSource);
  await cardA.locator(".sticky-note-md-btn").click();
  await new Promise(function (resolve) { setTimeout(resolve, 800); });
  await pageA.reload();
  cardA = pageA.locator(".sticky-note").first();
  await waitFor(function () { return cardA.locator(".sn-check.checked").count().then(function (count) { return count === 1; }); }, 3000, "reload first check");
  await pageA.getByRole("button", { name: "Fixture: fail next save" }).click();
  await cardA.locator(".sn-check").nth(2).click();
  await waitFor(function () { return cardA.locator(".sticky-note-save-status").textContent().then(function (text) { return text.indexOf("could not be saved") !== -1; }); }, 3000, "failure status");
  assert.equal(await cardA.locator(".sn-check.checked").count(), 1);
  await cardA.locator(".sn-check").nth(2).click();
  await waitFor(function () { return cardA.locator(".sn-check.checked").count().then(function (count) { return count === 2; }); }, 3000, "recovery check");
  await pageA.reload();
  cardA = pageA.locator(".sticky-note").first();
  await waitFor(function () { return cardA.locator(".sn-check.checked").count().then(function (count) { return count === 2; }); }, 3000, "reload recovery");
  async function ui() {
    return pageA.evaluate(async function () {
      var store = (await import('/lib/public/modules/store.js')).store;
      return Object.values(store.get('stickyNoteUiState'))[0];
    });
  }
  async function settled() {
    await waitFor(async function () { var state = await ui(); return state && !state.pending.length; }, 3000, "all saves acknowledged");
  }
  async function fixtureCommand(type) {
    await pageA.evaluate(function (type) { window.fixtureSocket.send(JSON.stringify({ type: type })); }, type);
  }
  async function remote(changes) {
    await pageB.evaluate(function (changes) {
      var id = document.querySelector('.sticky-note').dataset.noteId;
      window.fixtureSocket.send(JSON.stringify(Object.assign({ type: 'note_update', id: id }, changes)));
    }, changes);
  }
  await t.test("acknowledgement alone applies the real saved note", async function () {
    await fixtureCommand('fixture_omit_broadcast');
    await cardA.locator('.sticky-note-checklist-btn').click();
    await settled();
    assert.equal((await ui()).canonical.checklistMode, false);
    assert.equal(await pageA.evaluate(async function () { return (await import('/lib/public/modules/sticky-notes.js')).listNoteData()[0].checklistMode; }), false);
    assert.equal(await cardA.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'false');
    await cardA.locator('.sticky-note-checklist-btn').click();
    await settled();
  });
  await t.test("rapid checkbox actions save separately and recover after an in-flight disconnect", async function () {
    await cardA.locator('.sn-check').first().focus();
    await pageA.keyboard.press('Space');
    assert.equal(await cardA.locator('.sn-check').first().evaluate(function (el) { return el === document.activeElement; }), true);
    await cardA.locator('.sn-check').nth(1).click();
    await settled();
    assert.equal(await cardA.locator('.sn-check.checked').count(), 2);
    await fixtureCommand('fixture_delay_next');
    await cardA.locator('.sticky-note-checklist-btn').click();
    await pageA.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await waitFor(async function () { return !(await ui()).pending.length; }, 3000, 'disconnect clears pending');
    assert.equal(await cardA.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'true');
    assert.equal(await cardA.locator('.sticky-note-save-status').textContent(), 'Connection unavailable');
    await pageA.waitForTimeout(500);
    await pageA.reload();
    cardA = pageA.locator('.sticky-note').first();
    await waitFor(async function () { return (await ui()) !== undefined; }, 3000, 'disconnect reload');
    assert.equal((await ui()).canonical.checklistMode, false);
    await cardA.locator('.sticky-note-checklist-btn').click();
    await settled();
  });
  await t.test("delayed failures roll back to a newer remote canonical note", async function () {
    await fixtureCommand('fixture_delay_next');
    await cardA.locator('.sn-check').first().click();
    await remote({ text: 'Remote plan\nRemote task', checklistMode: false });
    await waitFor(async function () { return (await ui()).canonical.text === 'Remote plan\nRemote task'; }, 3000, 'remote canonical during pending');
    assert.equal((await ui()).pending.length, 1);
    await settled();
    assert.match(await cardA.locator('.sticky-note-save-status').textContent(), /could not be saved/);
    assert.equal(await cardA.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'false');
    assert.equal(await cardA.locator('.sticky-note-text').inputValue(), 'Remote plan\nRemote task');
  });
  await t.test("rapid mode reversals and stale success acknowledgements retain canonical state", async function () {
    await fixtureCommand('fixture_delay_ack');
    await cardA.locator('.sticky-note-checklist-btn').click();
    await waitFor(async function () { return (await ui()).canonical.checklistMode; }, 3000, 'first rapid broadcast');
    await cardA.locator('.sticky-note-checklist-btn').click();
    await remote({ text: 'Remote rapid\nNext task' });
    await settled();
    assert.equal((await ui()).canonical.text, 'Remote rapid\nNext task');
    assert.equal(await cardA.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'false');
    assert.equal(await cardA.locator('.sticky-note-rendered').getAttribute('contenteditable'), 'true');
  });
  await t.test("remote updates retain active markdown drafts and exact source survives both modes", async function () {
    var exact = 'Exact title\n- [X] done  \n\n## heading\n~~~txt\n[ ] literal\n~~~\nRepeated\nRepeated\n**bold**';
    await cardA.locator('.sticky-note-md-btn').click();
    await cardA.locator('.sticky-note-text').fill(exact);
    await remote({ text: 'Other device\nOther task', checklistMode: true });
    await waitFor(async function () { return (await ui()).canonical.text === 'Other device\nOther task'; }, 3000, 'remote draft canonical');
    assert.equal(await cardA.locator('.sticky-note-text').inputValue(), exact);
    assert.equal((await ui()).text, exact);
    await cardA.locator('.sticky-note-md-btn').click();
    await waitFor(async function () { return (await ui()).canonical.text === exact; }, 3000, 'draft persisted');
    await cardA.locator('.sticky-note-checklist-btn').click();
    await settled();
    await cardA.locator('.sticky-note-md-btn').click();
    assert.equal(await cardA.locator('.sticky-note-text').inputValue(), exact);
    await cardA.locator('.sticky-note-md-btn').click();
    await cardA.locator('.sticky-note-rendered').dispatchEvent('blur');
    await pageA.reload();
    cardA = pageA.locator('.sticky-note').first();
    await waitFor(async function () { return (await ui()) !== undefined; }, 3000, 'reloaded source');
    assert.equal(await cardA.locator('.sticky-note-text').inputValue(), exact);
  });
  await t.test("disconnected mode toggles and checkbox clicks recover every control", async function () {
    await pageA.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await pageA.waitForTimeout(100);
    await cardA.locator('.sticky-note-checklist-btn').click();
    assert.equal(await cardA.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'false');
    assert.equal(await cardA.locator('.sticky-note-rendered').getAttribute('contenteditable'), 'true');
    assert.equal(await cardA.locator('.sticky-note-save-status').textContent(), 'Connection unavailable');
    await pageA.reload();
    cardA = pageA.locator('.sticky-note').first();
    await cardA.locator('.sticky-note-checklist-btn').click();
    await settled();
    var before = await cardA.locator('.sn-check.checked').count();
    await pageA.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await pageA.waitForTimeout(100);
    await cardA.locator('.sn-check').last().click();
    assert.equal(await cardA.locator('.sn-check.checked').count(), before);
    assert.equal(await cardA.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'true');
    assert.equal((await ui()).pending.length, 0);
  });
  await t.test("deletion and project reset dispose cards, state and delayed draft writes", async function () {
    await pageA.reload();
    cardA = pageA.locator('.sticky-note').first();
    await cardA.locator('.sticky-note-md-btn').click();
    await cardA.locator('.sticky-note-text').fill('Cancelled draft');
    var result = await pageA.evaluate(async function () {
      var modules = await import('/lib/public/modules/sticky-notes.js');
      var store = (await import('/lib/public/modules/store.js')).store;
      var el = document.querySelector('.sticky-note');
      var id = el.dataset.noteId;
      modules.handleNoteDeleted({ id: id });
      return { cards: document.querySelectorAll('.sticky-note').length, state: store.get('stickyNoteUiState')[id] };
    });
    assert.equal(result.cards, 0);
    assert.equal(result.state, undefined);
    await pageA.waitForTimeout(600);
    var disk = await (await pageA.request.get(url + 'fixture-state')).json();
    assert.notEqual(disk[0].text, 'Cancelled draft');
    await pageA.reload();
    await cardA.locator('.sticky-note-md-btn').click();
    await cardA.locator('.sticky-note-text').fill('Cancelled project draft');
    await pageA.evaluate(async function () { (await import('/lib/public/modules/store.js')).store.set({ currentSlug: 'different-project' }); });
    assert.equal(await pageA.locator('.sticky-note').count(), 0);
    await pageA.waitForTimeout(600);
    disk = await (await pageA.request.get(url + 'fixture-state')).json();
    assert.notEqual(disk[0].text, 'Cancelled project draft');
  });

});
