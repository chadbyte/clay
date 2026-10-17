var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
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
  async function state(card) {
    var id = await card.getAttribute('data-note-id');
    return pageA.evaluate(async function (id) { return (await import('/lib/public/modules/store.js')).store.get('stickyNoteUiState')[id]; }, id);
  }
  async function settle(card) { await waitFor(async function () { var ui = await state(card); return ui && !ui.pending.length; }, 3000, 'settled'); }
  async function command(type) { await pageA.evaluate(function (type) { window.fixtureSocket.send(JSON.stringify({type:type})); }, type); }
  async function create(text) {
    await pageA.waitForFunction(function(){return window.fixtureSocket && window.fixtureSocket.readyState===1;});
    var before = await pageA.locator('.sticky-note').count();
    await pageA.evaluate(function (text) { window.fixtureSocket.send(JSON.stringify({type:'note_create',text:text,x:24,y:90,w:440,h:300})); }, text);
    await waitFor(async function () { return await pageA.locator('.sticky-note').count() === before + 1; }, 3000, 'created');
    var id = await pageA.locator('.sticky-note').last().getAttribute('data-note-id');
    return pageA.locator('.sticky-note[data-note-id="'+id+'"]');
  }
  async function remote(card, changes) {
    var id = await card.getAttribute('data-note-id');
    await pageB.evaluate(function (args) { window.fixtureSocket.send(JSON.stringify(Object.assign({type:'note_update',id:args.id},args.changes))); }, {id:id,changes:changes});
  }
  async function convert(card, confirmed) {
    await card.locator('.sticky-note-checklist-btn').click();
    if (confirmed) await pageA.locator('#settings-confirm [data-confirm]').click();
    await settle(card);
  }
  async function disk() { return (await (await pageA.request.get(url + 'fixture-state')).json()); }

  await t.test('nonempty conversion warns, cancels exactly, rolls back failure and retries', async function () {
    var exact = 'Title only  \n- [X] Done\n\n~~~txt\n[ ] literal\n~~~';
    var card = await create(exact);
    await card.locator('.sticky-note-checklist-btn').click();
    assert.match(await pageA.locator('#settings-confirm p').textContent(), /delete all existing contents/);
    await pageA.locator('#settings-confirm [data-cancel]').click();
    assert.equal((await state(card)).text, exact);
    assert.equal((await state(card)).checklistMode, false);
    await command('fixture_fail_next');
    await convert(card, true);
    assert.equal((await state(card)).text, exact);
    assert.match(await card.locator('.sticky-note-save-status').textContent(), /could not be saved/);
    assert.equal(await card.locator('.sticky-note-checklist-btn').getAttribute('aria-pressed'), 'false');
    await convert(card, true);
    assert.equal((await state(card)).text, '');
    assert.deepEqual((await state(card)).checklistState, {});
    assert.equal(await card.locator('.sticky-note-md-btn').isVisible(), false);
    assert.equal(await card.getByLabel('New task', {exact:true}).isVisible(), true);
    assert.equal(await pageA.locator('#settings-confirm').count(), 0);
  });
  await t.test('empty checklist supports adding editing removing and completing tasks without source view', async function () {
    var card = await create('  \n ');
    await convert(card, false);
    assert.equal(await pageA.locator('#settings-confirm').count(), 0);
    await card.getByLabel('New task', {exact:true}).fill('First task');
    await card.getByRole('button',{name:'Save tasks',exact:true}).click(); await settle(card);
    assert.equal((await state(card)).text, 'Checklist\n- [ ] First task');
    await card.getByLabel('Task 1',{exact:true}).fill('Edited task');
    await card.getByLabel('New task',{exact:true}).fill('Second task');
    await card.getByRole('button',{name:'Save tasks',exact:true}).click(); await settle(card);
    assert.equal((await state(card)).text, 'Checklist\n- [ ] Edited task\n- [ ] Second task');
    await command('fixture_fail_next');
    await card.getByRole('checkbox',{name:'Complete task 1'}).click(); await settle(card);
    assert.equal(await card.getByRole('checkbox',{name:'Complete task 1'}).getAttribute('aria-checked'), 'false');
    assert.match(await card.locator('.sticky-note-save-status').textContent(), /could not be saved/);
    await card.getByRole('checkbox',{name:'Complete task 1'}).click(); await settle(card);
    assert.equal(await card.getByRole('checkbox',{name:'Complete task 1'}).getAttribute('aria-checked'), 'true');
    await card.getByRole('button',{name:'Remove task 2'}).click(); await settle(card);
    assert.equal((await state(card)).text, 'Checklist\n- [ ] Edited task');
    var id = await card.getAttribute('data-note-id');
    await pageA.reload(); card = pageA.locator('.sticky-note[data-note-id="'+id+'"]');
    await card.getByLabel('Task 1',{exact:true}).waitFor();
    assert.equal(await card.getByLabel('Task 1',{exact:true}).inputValue(), 'Edited task');
    assert.equal(await card.locator('.sticky-note-md-btn').isVisible(), false);
    await card.locator('.sticky-note-checklist-btn').click(); await settle(card);
    assert.equal((await state(card)).text, 'Checklist\n- [ ] Edited task');
    assert.equal(await card.locator('.sticky-note-md-btn').isVisible(), true);
  });
  await t.test('wrapped writing, keyboard save, focus, pending and draft feedback use the production path', async function () {
    var card = await create(''); await convert(card, false);
    await card.evaluate(function (el) { el.style.width = '240px'; el.style.height = '390px'; });
    var longTask = 'Review the onboarding journey and keep the first useful action clear on a narrow screen';
    var entry = card.getByLabel('New task', { exact: true });
    assert.equal(await entry.getAttribute('maxlength'), '400');
    assert.equal(await card.getByLabel('Checklist title', { exact: true }).getAttribute('maxlength'), '400');
    await entry.fill('x'.repeat(400));
    await entry.press('End'); await pageA.keyboard.type('extra');
    assert.equal((await entry.inputValue()).length, 400, 'typing cannot exceed the existing limit');
    await entry.fill(longTask);
    assert.equal(await card.locator('.sn-task-feedback').textContent(), 'Unsaved changes');
    await command('fixture_delay_next');
    await entry.press('Enter');
    assert.equal(await card.locator('.sn-task-feedback').textContent(), 'Saving…');
    assert.equal(await entry.getAttribute('readonly'), '');
    await settle(card);
    assert.equal(await entry.evaluate(function (el) { return el === document.activeElement; }), true);
    assert.equal(await entry.inputValue(), '');
    assert.equal(await card.locator('.sn-task-feedback').textContent(), 'All changes saved');
    // The canonical save restores the fixture note's stored width. Narrow it again for layout inspection.
    await card.evaluate(function (el) { el.style.width = '240px'; });
    var task = card.getByLabel('Task 1', { exact: true });
    assert.equal(await task.getAttribute('maxlength'), '400');
    var geometry = await task.evaluate(function (el) { return { height: el.clientHeight, scroll: el.scrollHeight, width: el.clientWidth, scrollWidth: el.scrollWidth }; });
    assert.ok(geometry.height > 50, 'long task wraps to several lines');
    assert.ok(geometry.scroll <= geometry.height + 2, 'all wrapped lines are visible');
    assert.ok(geometry.scrollWidth <= geometry.width + 2, 'task has no horizontal overflow');
    await task.fill('A pasted\nthought');
    assert.equal(await task.inputValue(), 'A pasted thought');
    await command('fixture_fail_next'); await task.press('Enter'); await settle(card);
    assert.equal(await task.inputValue(), 'A pasted thought');
    assert.match(await card.locator('.sn-task-feedback').textContent(), /^Draft kept\. .*could not be saved/);
    await task.press('Enter'); await settle(card);
    assert.equal((await state(card)).canonical.text, 'Checklist\n- [ ] A pasted thought');
    await card.getByRole('checkbox', { name: 'Complete task 1' }).focus();
    await pageA.keyboard.press('Space'); await settle(card);
    assert.equal(await card.locator('.sn-task-summary').textContent(), '1 of 1 complete');
    assert.equal(await card.locator('.sn-task-row.is-complete').count(), 1);
    await task.focus();
    assert.notEqual(await card.getByRole('button', { name: 'Remove task 1' }).evaluate(function (el) { return getComputedStyle(el).opacity; }), '0');
  });
  await t.test('local draft conversion cancels stale debounce and preserves failed-save draft', async function () {
    var card = await create('Original');
    await card.locator('.sticky-note-md-btn').click();
    await card.locator('.sticky-note-text').fill('Pending typed draft');
    await command('fixture_fail_next'); await convert(card,true);
    assert.equal((await state(card)).text, 'Pending typed draft');
    assert.equal((await state(card)).draft,true);
    assert.equal((await state(card)).canonical.text,'Original');
    await convert(card,true); await pageA.waitForTimeout(650);
    assert.equal((await state(card)).text,'');
    assert.equal((await state(card)).canonical.text,'');
    assert.equal((await state(card)).draft,false);
    assert.equal(await card.locator('.sticky-note-text').isVisible(),false);
  });
  await t.test('remote changes during confirmation and during transport cannot be deleted', async function () {
    var card = await create('Approved title');
    await card.locator('.sticky-note-checklist-btn').click();
    await remote(card,{text:'New remote title'});
    await waitFor(async function(){return (await state(card)).canonical.text === 'New remote title';},3000,'remote prompt text');
    await pageA.locator('#settings-confirm [data-confirm]').click();
    assert.equal((await state(card)).checklistMode,false);
    assert.equal((await state(card)).text,'New remote title');
    await command('fixture_delay_next');
    await card.locator('.sticky-note-checklist-btn').click();
    await pageA.locator('#settings-confirm [data-confirm]').click();
    await remote(card,{text:'Later remote title'});
    await settle(card);
    assert.equal((await state(card)).canonical.text,'Later remote title');
    assert.equal((await state(card)).checklistMode,false);
    assert.match(await card.locator('.sticky-note-save-status').textContent(), /could not be saved/);
  });
  await t.test('remote checklist mode hides an already-open source editor and preserves its draft', async function () {
    var card = await create('Remote source');
    await card.locator('.sticky-note-md-btn').click();
    await card.locator('.sticky-note-text').fill('Local draft\nTask');
    await remote(card,{checklistMode:true});
    await waitFor(async function(){return (await state(card)).checklistMode;},3000,'remote mode');
    assert.equal(await card.locator('.sticky-note-md-btn').isVisible(),false);
    assert.equal(await card.locator('.sticky-note-text').isVisible(),false);
    assert.equal((await state(card)).text,'Local draft\nTask');
    await card.locator('.sticky-note-checklist-btn').click(); await settle(card);
    assert.equal(await card.locator('.sticky-note-md-btn').isVisible(),true);
  });
  await t.test('human close removes whitespace notes without closed records or reload resurrection', async function () {
    var card = await create(' \n\t');
    var id = await card.getAttribute('data-note-id');
    await card.locator('.sticky-note-close').click();
    await waitFor(async function(){return await pageA.locator('.sticky-note[data-note-id="'+id+'"]').count()===0;},3000,'empty removed');
    assert.equal((await disk()).some(function(note){return note.id===id;}),false);
    await pageA.reload();
    assert.equal(await pageA.locator('.sticky-note[data-note-id="'+id+'"]').count(),0);
  });
  await t.test('typed pending content is archived atomically and failed empty deletion stays visible', async function () {
    var card = await create('');
    await card.locator('.sticky-note-md-btn').click();
    await card.locator('.sticky-note-text').fill('Unsaved content');
    await card.locator('.sticky-note-close').click(); await settle(card);
    assert.equal((await state(card)).canonical.text,'Unsaved content');
    assert.equal((await state(card)).canonical.state,'closed');
    var empty = await create('');
    await command('fixture_fail_next'); await empty.locator('.sticky-note-close').click(); await settle(empty);
    assert.equal(await empty.isVisible(),true);
    assert.match(await empty.locator('.sticky-note-save-status').textContent(),/could not be saved/);
    await empty.locator('.sticky-note-close').click();
    await waitFor(async function(){return await empty.count()===0;},3000,'retry delete');
  });
  await t.test('remote text before delayed empty close is preserved and not archived', async function () {
    var card = await create('');
    await command('fixture_delay_next'); await card.locator('.sticky-note-close').click();
    await remote(card,{text:'Concurrent task'}); await settle(card);
    assert.equal((await state(card)).canonical.text,'Concurrent task');
    assert.equal((await state(card)).canonical.state,'open');
    assert.equal(await card.isVisible(),true);
  });
  await t.test('pending plain task entry survives human close as nonempty archived content', async function () {
    var card=await create(''); await convert(card,false);
    await card.getByLabel('New task',{exact:true}).fill('Draft task');
    await card.locator('.sticky-note-close').click(); await settle(card);
    assert.equal((await state(card)).canonical.text,'Checklist\n- [ ] Draft task');
    assert.equal((await state(card)).checklistInputs,null);
    assert.equal((await state(card)).canonical.state,'closed');
  });
  await t.test('failed task saves retain plain drafts and syntax-like task text remains editable', async function () {
    var card=await create('');await convert(card,false);
    await card.getByLabel('New task',{exact:true}).fill('## Not a heading');
    await command('fixture_fail_next');await card.getByRole('button',{name:'Save tasks',exact:true}).click();await settle(card);
    assert.equal((await state(card)).canonical.text,'');
    assert.equal(await card.getByLabel('New task',{exact:true}).inputValue(),'## Not a heading');
    await card.getByRole('button',{name:'Save tasks',exact:true}).click();await settle(card);
    assert.equal(await card.getByLabel('Task 1',{exact:true}).inputValue(),'## Not a heading');
  });
  await t.test('the browser human close path removes empties and excludes them from Closed', async function () {
    var card=await create('');var id=await card.getAttribute('data-note-id');
    await pageA.evaluate(async function(){(await import('/lib/public/modules/sticky-notes-browser.js')).openNotesBrowser();});
    await command('fixture_fail_next');
    await pageA.locator('.notes-browser-card[data-note-id="'+id+'"] .notes-browser-card-action').first().click();
    await waitFor(async function(){return (await state(card)).error;},3000,'browser failure');
    assert.match(await pageA.locator('.notes-browser-card[data-note-id="'+id+'"] [role=status]').textContent(),/could not be saved/);
    await pageA.locator('.notes-browser-card[data-note-id="'+id+'"] .notes-browser-card-action').first().click();
    await waitFor(async function(){return !(await disk()).some(function(note){return note.id===id;});},3000,'browser empty removed');
    await pageA.locator('.notes-browser-tab[data-tab="closed"]').click();
    assert.equal(await pageA.locator('.notes-browser-card[data-note-id="'+id+'"]').count(),0);
    await pageA.locator('#notes-browser-close').click();
    var open=(await disk()).filter(function(note){return note.state==='open';}).length;
    assert.equal(await pageA.locator('#sticky-notes-sidebar-count').textContent(),String(open));
  });
  await t.test('disconnected conversion rolls back and retains contents', async function () {
    var card=await create('Disconnected title');
    await pageA.getByRole('button',{name:'Disconnect',exact:true}).click(); await pageA.waitForTimeout(100);
    await convert(card,true);
    assert.equal((await state(card)).text,'Disconnected title');
    assert.equal((await state(card)).checklistMode,false);
    assert.match(await card.locator('.sticky-note-save-status').textContent(),/Connection unavailable/);
  });
});

test("archive fixture renders dense closed notes without clipping or overlap", async function (t) {
  var port = 2848 + (process.pid % 100);
  var isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-sticky-archive-home-"));
  var clayHome = path.join(isolatedHome, "clay");
  var fixture = path.join(__dirname, "fixtures/sticky-note-checklist-server.cjs");
  var server = childProcess.spawn(process.execPath, [fixture], {
    env: Object.assign({}, process.env, {
      HOME: isolatedHome,
      CLAY_HOME: clayHome,
      STICKY_NOTE_FIXTURE_PORT: String(port),
      STICKY_NOTE_ARCHIVE_FIXTURE: "1",
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(function () {
    return new Promise(function (resolve) {
      server.once("exit", function () { fs.rmSync(isolatedHome, { recursive: true, force: true }); resolve(); });
      server.kill();
    });
  });
  await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("archive fixture server timeout")); }, 5000);
    server.stdout.on("data", function (chunk) {
      if (String(chunk).indexOf("http://127.0.0.1:" + port) !== -1) { clearTimeout(timer); resolve(); }
    });
    server.on("error", reject);
  });
  var browser;
  try { browser = await playwright.chromium.launch({ headless: true }); }
  catch (error) { t.skip("Chromium is not available: " + error.message); return; }
  t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 620, height: 900 } });
  await page.goto("http://127.0.0.1:" + port + "/archive?archive=1&theme=dark", { waitUntil: "domcontentloaded", timeout: 5000 });
  await page.locator('.notes-browser-tab[data-tab="closed"]').waitFor();
  var cards = page.locator(".notes-browser-card.closed");
  await cards.first().waitFor();
  assert.equal(await cards.count(), 60, "archive fixture has sixty closed notes");
  async function inspectArchiveLayout() {
    return page.evaluate(function () {
      var items = Array.prototype.slice.call(document.querySelectorAll(".notes-browser-card.closed"));
      var geometry = items.map(function (card) {
      var cardRect = card.getBoundingClientRect();
      var body = card.querySelector(".notes-browser-card-body");
      var bodyRect = body.getBoundingClientRect();
      var last = body.lastElementChild;
      var lastRect = last ? last.getBoundingClientRect() : bodyRect;
      var actions = Array.prototype.slice.call(card.querySelectorAll(".notes-browser-card-action")).map(function (action) {
        var rect = action.getBoundingClientRect();
        return { right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      return {
        width: cardRect.width,
        top: cardRect.top,
        cardRight: cardRect.right,
        cardBottom: cardRect.bottom,
        bodyHeight: bodyRect.height,
        lastBottom: lastRect.bottom,
        actions: actions,
        title: card.querySelector(".notes-browser-card-title").textContent,
        text: body.innerText,
        readonlyInputs: card.querySelectorAll("input, textarea, [contenteditable='true']").length,
        horizontalOverflow: card.scrollWidth > card.clientWidth || body.scrollWidth > body.clientWidth,
      };
      }).sort(function (left, right) { return left.top - right.top || left.cardRight - right.cardRight; });
      var rows = [];
      for (var i = 0; i < geometry.length; i++) {
        var row = rows[rows.length - 1];
        if (!row || Math.abs(row.top - geometry[i].top) > 1) rows.push({ top: geometry[i].top, maxBottom: geometry[i].cardBottom });
        else row.maxBottom = Math.max(row.maxBottom, geometry[i].cardBottom);
      }
      var grid = document.querySelector(".notes-browser-grid");
      grid.scrollTop = grid.scrollHeight;
      var last = geometry[geometry.length - 1];
      var finalScrollBottom = 0;
      for (var j = 0; j < items.length; j++) finalScrollBottom = Math.max(finalScrollBottom, items[j].offsetTop - grid.offsetTop + items[j].offsetHeight);
      return { geometry: geometry, rows: rows, gridBottom: grid.getBoundingClientRect().bottom, lastBottom: last.cardBottom, finalScrollBottom: finalScrollBottom, gridScrollHeight: grid.scrollHeight, gridAtEnd: grid.scrollTop >= grid.scrollHeight - grid.clientHeight - 1, gridOverflow: grid.scrollWidth > grid.clientWidth };
    });
  }
  async function assertArchiveLayout(label, expectedMinWidth, expectedMaxWidth) {
    var result = await inspectArchiveLayout();
    var geometry = result.geometry;
    assert.ok(geometry.every(function (item) { return item.width >= expectedMinWidth && item.width <= expectedMaxWidth; }), label + ": cards have expected widths");
    assert.ok(result.rows.every(function (row, index) { return index === 0 || row.top >= result.rows[index - 1].maxBottom + 8; }), label + ": rows start below the previous row’s tallest card");
    assert.ok(geometry.every(function (item) { return item.lastBottom <= item.cardBottom + 1; }), label + ": full body content fits inside each card");
    assert.ok(geometry.every(function (item) { return item.actions.every(function (action) { return action.right <= item.cardRight + 1 && action.bottom <= item.cardBottom + 1; }); }), label + ": archived actions remain usable inside cards");
    assert.ok(geometry.every(function (item) { return item.readonlyInputs === 0 && !item.horizontalOverflow; }), label + ": archived notes remain read-only without horizontal overflow");
    assert.equal(result.gridOverflow, false, label + ": archive grid has no horizontal overflow");
    assert.ok(result.gridAtEnd && result.finalScrollBottom <= result.gridScrollHeight, label + ": final row is reachable in the scroll container");
    assert.ok(geometry.some(function (item) { return item.text.indexOf("Final paragraph remains visible") !== -1 && item.text.indexOf("archivedFixtureExample") !== -1 && item.text.indexOf("long-link-that-wraps") !== -1; }), label + ": dense Markdown remains rendered");
    assert.ok(geometry.some(function (item) { return item.title === "Untitled" && item.text === ""; }), label + ": empty archived notes remain readable");
    assert.ok(geometry.some(function (item) { return item.title === "Short archived note"; }), label + ": short archived notes remain readable");
  }
  await assertArchiveLayout("initial 620px", 180, 205);
  await page.setViewportSize({ width: 1280, height: 900 });
  await assertArchiveLayout("desktop resize", 290, 315);
  await page.setViewportSize({ width: 620, height: 900 });
  await assertArchiveLayout("620px resize", 180, 205);
  await page.setViewportSize({ width: 360, height: 900 });
  await assertArchiveLayout("360px resize", 150, 205);
});
