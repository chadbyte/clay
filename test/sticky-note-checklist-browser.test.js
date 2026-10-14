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
