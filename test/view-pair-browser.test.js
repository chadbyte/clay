var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
async function exercisePair(t, multi) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: multi ? '1' : '', CLAY_PANE_FILES: '1', CLAY_PANE_BROWSER: '1', CLAY_PANE_WORKBENCH: '1' }), stdio: ['ignore','pipe','pipe','ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve,reject) { child.once('message',resolve); child.once('error',reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1800,height:1000 } }), base = 'http://127.0.0.1:' + info.port, errors = [];
  page.on('pageerror',function (e) { errors.push(e.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page); await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json(), group = data.groups[0];
  async function modules() { await page.evaluate(async function () { window.pairStore = (await import('/p/reuse/modules/store.js')).store; }); }
  await modules();
  var legacyRecord;
  if (!multi) {
    var driverOrigin=data.sessions.find(function (s) { return s.id === group.pair.driverId; }).sessionOriginId;
    var workerOrigin=data.sessions.find(function (s) { return s.id === group.pair.workerId; }).sessionOriginId;
    var pairTree={axis:'horizontal',ratio:.5,left:{id:driverOrigin},right:{id:workerOrigin}};
    legacyRecord={base:pairTree,tree:{axis:'vertical',ratio:.28,left:{id:'tool-terminal'},right:{axis:'horizontal',ratio:.73,left:pairTree,right:{axis:'vertical',ratio:.41,left:{id:'tool-browser'},right:{id:'tool-file-viewer'}}}}};
    var preference=await (await page.request.get(base+'/api/user/workbench-layout',{headers:{'X-Clay-Account-Id':'owner'}})).json();
    var seeded=await page.request.put(base+'/api/user/workbench-layout',{headers:{'X-Clay-Settings':'1','X-Clay-Account-Id':'owner'},data:{mode:preference.mode,revision:preference.revision,layout:{key:JSON.stringify(['reuse','owner','legacy-'+group.id]),base:legacyRecord.base,tree:legacyRecord.tree}}});
    assert.equal(seeded.status(),200,await seeded.text());
  }
  await page.evaluate(async function (group) { (await import('/p/reuse/modules/split-view.js')).openGroup(group); },group);
  await page.waitForFunction(function () { var s = window.pairStore, v = (s.get('projectSplitViews') || []).find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return v && v.workspace.linkedPair && !s.get('projectSplitViewPending'); });
  async function settled() { await page.waitForFunction(function () { var s=window.pairStore,r=s.get('savedWorkspaceRuntime'); return r && !r.restoring && !r.desired && !r.inflight && !s.get('projectSplitViewPending'); }); var error=await page.evaluate(function () { return window.pairStore.get('projectSplitViewError'); }); assert.ok(!error,error); }
  await settled();
  await page.evaluate(async function () { await (await import('/p/reuse/modules/workbench-layout-preference.js')).ensureWorkbenchLayoutPreference(); });
  await page.locator('#terminal-sidebar-btn').click(); await page.waitForSelector('#terminal-container .xterm-helper-textarea',{state:'attached'});
  await page.locator('#terminal-container .workbench-layout-toggle').click(); await settled();
  await page.locator('#shared-browser-btn').click(); await page.waitForSelector('#shared-browser-panel:not(.hidden)');
  await page.waitForFunction(function () { return !!window.pairStore.get('sharedBrowser'); });
  await page.locator('#shared-browser-panel .workbench-layout-toggle').click(); await settled();
  await page.evaluate(async function () { (await import('/p/reuse/modules/filebrowser.js')).openFile('a.md'); });
  await page.getByText('ALPHA_FILE_CONTENT',{exact:true}).waitFor();
  await page.locator('.file-instance .workbench-layout-toggle').click(); await page.locator('.file-instance').getByRole('button',{name:'Pin this file',exact:true}).click(); await settled();
  async function snapshot() { return page.evaluate(function () { var s=window.pairStore, v=s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return { id:v.id,workspace:v.workspace,origins:v.sessions.map(function (s) {return s.sessionOriginId;}),frames:Array.from(document.querySelectorAll('#split-host > .split-pane iframe')).map(function (f) {return f.dataset.sessionOriginId;}).sort() }; }); }
  var before = await snapshot(); assert.equal(before.origins.length,multi ? 2 : 1); assert.equal(before.workspace.panes.length,multi ? 5 : 4); assert.equal(before.frames.length,multi ? 3 : 2);
  if (legacyRecord) {
    var file=before.workspace.panes.find(function (p) { return p.kind === 'file'; });
    var expected=JSON.parse(JSON.stringify(legacyRecord.tree).replace('tool-file-viewer','tool-file-'+file.instanceId));
    assert.deepEqual(before.workspace.linkedPair.tree,expected,'delayed real bindings preserve all legacy ratios and positions');
  }
  await page.reload(); await modules(); await page.getByText('ALPHA_FILE_CONTENT',{exact:true}).waitFor(); await settled();
  await page.waitForFunction(function (count) { return document.querySelectorAll('#split-host > .split-pane iframe').length === count && document.querySelectorAll('.tool-pane-window').length === 3; }, multi ? 3 : 2);
  var after = await snapshot(); assert.deepEqual(after,before); await page.locator('.split-pair-role-split-worker').waitFor(); assert.equal(await page.locator('.split-pair-role-split-worker').count(),1);
  await page.locator('#split-host .split-pane-role-driver .split-view-arrange-trigger').click();
  await page.getByRole('button', { name: 'Focus selected session', exact: true }).click();
  await page.waitForFunction(function () { var s=window.pairStore,v=s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');});return v.workspace.presentation&&v.workspace.presentation.focusedSessionOriginId&&!s.get('projectSplitViewPending'); });
  await page.reload(); await modules();
  await page.waitForFunction(function () { var s=window.pairStore;return s.get('projectSplitViewFocusedOrigin')&&document.querySelectorAll('#split-host > .split-pane:not([hidden])').length===1; });
  await page.locator('#split-host .split-pane-role-driver .split-view-arrange-trigger').click();await page.getByRole('button',{name:'Restore layout',exact:true}).click();await settled();
  var worker = page.frameLocator('#split-host .split-pane-role-worker iframe');
  assert.equal(await worker.locator('#input').isVisible(),false);
  data = await (await page.request.get(base + '/fixture/state')).json(); assert.equal(data.terminalStats.length,1); assert.deepEqual(data.terminalStats[0].writes,[]); assert.deepEqual(errors,[]);
}
test('legacy pair restores its saved Driver View, locked Worker and tools', { timeout: 90000 }, function (t) { return exercisePair(t, false); });
test('pair presentation retains existing multi-session View membership and tools', { timeout: 90000 }, function (t) { return exercisePair(t, true); });
