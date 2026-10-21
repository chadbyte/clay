var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('docked tools are movable pane windows with retained runtimes and server-persisted view positions', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env,
    { CLAY_PANE_PRESENTATION: '1', CLAY_PANE_WORKBENCH: '1', CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }), errors = [], saves = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('request', function(request) { if (request.method() === 'PUT' && request.url().includes('/api/user/workbench-layout')) { var body=request.postDataJSON(); if(body.layout) saves.push(body.layout); } });
  page.on('websocket', function (socket) { socket.on('framesent', function (event) {
    var body; try { body = JSON.parse(String(event.payload)); } catch (error) { return; }
    if (body.type !== 'project_split_view_update' || !body.workspace) return;
    var mapping = {}; body.workspace.panes.forEach(function (pane) { mapping[pane.instanceId] = pane.kind === 'session' ? pane.resource.originId : 'tool-' + (pane.kind === 'workbench' ? pane.resource.name : pane.kind === 'file' ? 'file-' + pane.instanceId : pane.kind); });
    function tree(node) { return !node ? null : node.id ? { id: mapping[node.id] } : { axis: node.axis, ratio: node.ratio, left: tree(node.left), right: tree(node.right) }; }
    saves.push({ key: JSON.stringify(['reuse', 'owner', body.id]), base: body.tree, tree: tree(body.workspace.tree), workspace: body.workspace });
  }); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  async function waitForAsync(predicate, argument) {
    var deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await page.evaluate(predicate, argument)) return; await page.waitForTimeout(25); }
    throw new Error('Timed out waiting for asynchronous production state: ' + JSON.stringify(await page.evaluate(async function(){var s=(await import('/p/reuse/modules/store.js')).store;return {error:s.get('projectSplitViewError'),pending:s.get('projectSplitViewPending')&&s.get('projectSplitViewPending').type,runtime:s.get('savedWorkspaceRuntime')};})));
  }
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] {display:none;}' });
  var fixture = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('[data-split-view-id="' + fixture.restoreView.id + '"] .split-view-group-open').click();
  await page.waitForFunction(function () { var frames = Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe')); return frames.length === 2 && frames.every(function (f) { return f.clayPane && f.clayPane.identity() && f.clayPane.identity().ready; }); });
  var terminal = page.locator('#terminal-container'), browserPanel = page.locator('#shared-browser-panel'), files = page.locator('.file-instance').first();
  async function dock(panel, name) {
    await page.waitForFunction(function (selector) { var b = document.querySelector(selector + ' .workbench-layout-toggle'); return b && !b.disabled; }, '#' + await panel.getAttribute('id'));
    if (await panel.getAttribute('data-workbench-placement') !== 'docked') await panel.locator('.workbench-layout-toggle').click();
    await page.waitForFunction(function (name) { return !!document.querySelector('[data-tool-window-id="tool-' + name + '"]'); }, name);
    await page.waitForTimeout(350);
  }
  async function darkTerminal() {
    var colors = await terminal.evaluate(function (panel) { return ['#terminal-body', '.xterm-viewport'].map(function (selector) { return getComputedStyle(panel.querySelector(selector)).backgroundColor; }); });
    assert.deepEqual(colors, ['rgb(20, 20, 18)', 'rgb(20, 20, 18)'], 'Terminal content stays dark across docking, movement, fullscreen and theme changes');
  }
  async function settled() { await waitForAsync(async function () { var s=(await import('/p/reuse/modules/store.js')).store; return !(s.get('workbenchLayoutPreference') || {}).saving && !s.get('projectSplitViewPending') && !(s.get('savedWorkspaceRuntime') || {}).desired && !s.get('toolPaneLayoutPreview'); }); await page.waitForTimeout(350); }
  async function drag(panel, target, side, cancel) {
    var handle = await panel.locator(':scope > .split-pane-header .split-pane-drag-space').boundingBox(), box = await target.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + (side === 'left' ? 8 : side === 'right' ? box.width - 8 : box.width / 2), box.y + (side === 'top' ? 8 : side === 'bottom' ? box.height - 8 : box.height / 2), { steps: 8 });
    await page.waitForTimeout(320);
    assert.equal(await panel.evaluate(function (el) { return getComputedStyle(el).opacity; }), '0.72');
    assert.deepEqual(await panel.evaluate(function (el) { var tint=getComputedStyle(el, '::after'); return {content:tint.content,events:tint.pointerEvents}; }), {content:'""',events:'none'}, 'mixed tool/session dragging uses the shared tint');
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await settled(); await darkTerminal();
    assert.equal(await panel.evaluate(function (el) { return getComputedStyle(el, '::after').content; }), 'none', 'settling removes the tint');
  }
  await page.locator('#terminal-sidebar-btn').click(); await terminal.locator('.xterm').waitFor(); await darkTerminal();
  await dock(terminal, 'terminal');
  assert.equal(await terminal.evaluate(function (el) { return getComputedStyle(el).position; }), 'absolute');
  assert.equal(await terminal.getByRole('button', { name: 'Close terminal pane', exact: true }).count(), 1);
  assert.equal(await terminal.locator('.tool-pane-header .split-view-model').count(), 0, 'Terminal has no redundant kind pill');
  assert.equal(await terminal.locator('.tool-pane-title').textContent(), 'Pane reuse fixture · Terminal');
  assert.equal(await terminal.locator('.terminal-tab').first().evaluate(function (el) { return getComputedStyle(el).height; }), '22px');
  await page.evaluate(function () { window.retainedTools = { terminal: document.querySelector('#terminal-body .xterm'), frames: Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe')).map(function (f) { return { frame: f, doc: f.contentDocument, binding: f.clayPane.identity().binding }; }) }; });
  var first = page.locator('#split-host > .split-pane:not(.split-pane-cached)').first();
  await drag(terminal, first, 'left');
  assert.ok(saves.length > 0); assert.ok((await terminal.boundingBox()).x < (await first.boundingBox()).x, 'Terminal moves to the left of a session: ' + JSON.stringify(await page.evaluate(async function () { var s=(await import('/p/reuse/modules/store.js')).store; return {resource:s.get('savedViewTerminalResource'),error:s.get('projectSplitViewError'),view:s.get('projectSplitViews'),geometry:s.get('toolPaneWindowGeometry').tree}; })));
  var previous = saves.length; await drag(terminal, first, 'bottom', true); assert.equal(saves.length, previous, 'Escape never saves a preview');
  await page.locator('#shared-browser-btn').click(); await browserPanel.waitFor({ state: 'visible' }); await dock(browserPanel, 'browser');
  assert.equal(await browserPanel.locator(':scope > .tool-pane-header').count(), 1);
  assert.equal(await browserPanel.locator('.shared-browser-header').isVisible(), false);
  await browserPanel.getByRole('button', { name: 'New browser tab', exact: true }).click();
  await page.waitForFunction(function () { return document.querySelectorAll('#shared-browser-panel [role="tab"]').length === 2; });
  var browserIds = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('sharedBrowsers').map(function (b) { return b.id; }); });
  await page.evaluate(async function () { (await import('/p/reuse/modules/filebrowser.js')).openFile('workbench.md'); });
  await files.locator('.file-viewer-body').getByText('PERSISTENT_FILE_CONTENT', { exact: false }).waitFor(); var fileOwner = await files.getAttribute('id'); await dock(files, fileOwner);
  assert.equal(await files.locator('.tool-pane-title').textContent(), 'workbench.md');
  assert.equal(await files.locator('.tool-pane-header').evaluate(function (el) { return getComputedStyle(el).height; }), '33px');
  var expandedTools = [
    { panel: terminal, button: '#terminal-fullscreen' },
    { panel: browserPanel, button: '[data-action="fullscreen"]' },
    { panel: files, button: '[aria-label="Expand file pane"]' }
  ];
  for (var tool of expandedTools) {
    await tool.panel.locator(tool.button).click(); await page.waitForTimeout(350);
    var expanded = await tool.panel.evaluate(function (el) {
      var rect=el.getBoundingClientRect(), main=document.getElementById('main-panels').getBoundingClientRect(), style=getComputedStyle(el);
      return { left:rect.left-main.left,top:rect.top-main.top,right:main.right-rect.right,bottom:main.bottom-rect.bottom,radius:style.borderRadius,border:style.borderTopWidth };
    });
    await darkTerminal();
    assert.deepEqual(expanded, {left:7,top:7,right:7,bottom:7,radius:'9px',border:'1px'}, 'fullscreen tools retain the focused session inset and frame');
    for (var theme of ['clay-light', 'clay-dark']) {
      await page.evaluate(async function (theme) { (await import('/p/reuse/modules/theme.js')).applyTheme(theme); }, theme);
      var canvas = await page.evaluate(function () {
        var main=document.getElementById('main-panels'), host=document.getElementById('split-host'), sample=document.createElement('div');
        sample.style.backgroundColor='var(--bg-alt)'; main.appendChild(sample);
        var expected=getComputedStyle(sample).backgroundColor; sample.remove();
        return { color:getComputedStyle(main).backgroundColor, expected:expected, sessionCanvas:getComputedStyle(host).backgroundColor };
      });
      assert.equal(canvas.color, canvas.expected, 'expanded tools expose the shared session workspace color in ' + theme);
      assert.equal(canvas.sessionCanvas, 'rgba(0, 0, 0, 0)', 'session windows do not paint a second workspace background');
      await darkTerminal();
    }
    await page.setViewportSize({width:1760,height:1060}); await page.waitForTimeout(350);
    await tool.panel.locator(tool.button).click(); await settled();
    await page.waitForFunction(function (id) { return !!document.getElementById(id).dataset.toolWindowId; }, await tool.panel.getAttribute('id'));
    await page.setViewportSize({width:1800,height:1100}); await settled();
  }
  await drag(browserPanel, terminal, 'center');
  assert.deepEqual(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('sharedBrowsers').map(function (b) { return b.id; }); }), browserIds);
  await drag(files, first, 'bottom');
  await drag(first, browserPanel, 'bottom');
  var beforeResize = saves.length;
  await page.locator('#split-host > .split-view-divider').last().focus(); await page.keyboard.press('ArrowLeft');
  await waitForAsync(async function () { return !(await import('/p/reuse/modules/store.js')).store.get('workbenchLayoutPreference').saving; });
  await page.waitForTimeout(350); assert.equal(saves.length, beforeResize + 1, 'pane dividers persist window resizing');
  await settled();
  var last = saves[saves.length - 1];
  var saved = await page.evaluate(async function () { var s=(await import('/p/reuse/modules/store.js')).store; return s.get('projectSplitViews').find(function(v) { return v.id === s.get('projectSplitViewActiveId'); }).workspace; });
  assert.deepEqual(saved, last.workspace);
  assert.equal(await page.evaluate(function () { return window.retainedTools.terminal === document.querySelector('#terminal-body .xterm') && window.retainedTools.frames.every(function (item) { return item.frame.isConnected && item.frame.contentDocument === item.doc && item.frame.clayPane.identity().binding === item.binding; }); }), true);
  var boxes = await page.evaluate(function () { return Array.from(document.querySelectorAll('.tool-pane-window, #split-host > .split-pane:not(.split-pane-cached)')).map(function (el) { var r=el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height }; }); });
  boxes.forEach(function (a, i) { assert.ok(a.width > 0 && a.height > 0); boxes.slice(i+1).forEach(function (b) { assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x) < 2 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y) < 2, 'all tool/session windows have separate slots'); }); });
  assert.equal((await (await page.request.get(base + '/fixture/state')).json()).terminalStats[0].killed, false);
  var cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  assert.equal(saved.panes.filter(function(p) { return p.kind === 'session'; }).length, 2);
  for (var refresh = 0; refresh < 3; refresh++) {
    await page.reload();
    await page.waitForFunction(function () { return ['terminal-container', 'shared-browser-panel'].every(function (id) { var el=document.getElementById(id); return el && el.dataset.toolWindowId && !el.classList.contains('hidden'); }) && !!document.querySelector('.file-instance[data-tool-window-id]'); });
    await settled();
    assert.deepEqual(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('toolPaneWindowGeometry').tree; }), last.tree, 'hard refresh automatically restores saved pane geometry');
    assert.equal((await (await page.request.get(base + '/fixture/state')).json()).terminalStats.length, 1, 'hard refresh reattaches the same PTY without creating another');
    assert.deepEqual(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('savedViewTerminalResource'); }), saved.panes.find(function(p) { return p.kind === 'terminal'; }).resource);
    assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('sharedBrowser').id; }), saved.panes.find(function(p) { return p.kind === 'browser'; }).resource.id, 'the same Browser tab restores without reopening');
    assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('controlRuntimeId'); }), saved.panes.find(function(p) { return p.kind === 'browser'; }).resource.runtimeId);
    await darkTerminal();
  }
  await terminal.getByRole('button', { name: 'Close terminal pane', exact: true }).click(); await terminal.waitFor({ state: 'hidden' }); await settled();
  assert.equal(await browserPanel.isVisible(), true); assert.equal(await files.isVisible(), true);
  assert.equal(await page.evaluate(async function() { var s=(await import('/p/reuse/modules/store.js')).store; return s.get('projectSplitViews').find(function(v) {return v.id===s.get('projectSplitViewActiveId');}).workspace.panes.find(function(p) {return p.kind==='browser';}).open; }), true, 'closing Terminal preserves saved Browser');
  await page.reload();
  await page.waitForFunction(function () { var f=document.querySelector('#split-host > .split-pane iframe'); return f && f.clayPane && f.clayPane.identity() && f.clayPane.identity().ready; });
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] {display:none;}' });
  await page.waitForFunction(function () { var f=document.querySelector('.file-instance'), b=document.getElementById('shared-browser-panel'); return f && b && f.dataset.toolWindowId && b.dataset.toolWindowId; }, null, {timeout:15000}).catch(async function(error) { throw new Error(error.message + JSON.stringify(await page.evaluate(async function() { var s=(await import('/p/reuse/modules/store.js')).store; return {runtime:s.get('savedWorkspaceRuntime'),view:s.get('projectSplitViewActiveId'),views:s.get('projectSplitViews'),error:s.get('projectSplitViewError'),docks:s.get('rightWorkbenchDockedOwners')}; }))); });
  assert.equal(await terminal.isVisible(), false, 'closed terminal stays closed after refresh');
  assert.equal(await browserPanel.isVisible(), true, 'Browser stays docked after closing Terminal and refreshing');
  assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('sharedBrowser').id; }), saved.panes.find(function(p) { return p.kind === 'browser'; }).resource.id);
  await page.locator('#terminal-sidebar-btn').click(); await terminal.waitFor({ state: 'visible' }); await settled();
  assert.equal(await terminal.getAttribute('data-workbench-placement'), 'overlay', 'manual reopen starts as an overlay');
  await dock(terminal, 'terminal');
  await page.evaluate(async function (group) { (await import('/p/reuse/modules/split-view.js')).openGroup(group); }, fixture.groups[0]);
  await waitForAsync(async function () { var s=(await import('/p/reuse/modules/store.js')).store, v=s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');}); var g=s.get('toolPaneWindowGeometry'); return v && v.workspace.linkedPair && !(s.get('savedWorkspaceRuntime') || {}).restoring && g && g.windows.every(function(w){return !w.frame || w.frame.clayPane && w.frame.clayPane.identity() && w.frame.clayPane.identity().ready;}); });
  await settled();
  assert.equal(await terminal.isVisible(), true, 'opening linked Worker presentation retains its Driver View tools');
  assert.equal(await browserPanel.isVisible(), true);
  assert.equal(await files.count(), 1);
  await drag(terminal, page.locator('#split-host > .split-pane').first(), 'top');
  assert.deepEqual(errors, []);
});

test('singleton and tool-only saved Views reload without creating sessions or replacement terminals', {timeout:90000}, async function(t) {
  var child=cp.fork(path.join(__dirname,'fixtures/pane-reuse-server.cjs'),[],{env:Object.assign({},process.env,{CLAY_PANE_PRESENTATION:'1',CLAY_PANE_WORKBENCH:'1'}),stdio:['ignore','pipe','pipe','ipc']});
  t.after(function(){child.kill('SIGTERM');});child.stdout.resume();child.stderr.resume();
  var info=await new Promise(function(resolve,reject){child.once('message',resolve);child.once('error',reject);});
  var browser=await chromium.launch();t.after(function(){return browser.close();});
  var page=await browser.newPage({viewport:{width:1800,height:1100}});await require('./fixtures/source-module-runtime.cjs').install(page);
  async function waitForAsync(predicate, argument) {
    var deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await page.evaluate(predicate, argument)) return; await page.waitForTimeout(25); }
    throw new Error('Timed out waiting for asynchronous production state: ' + JSON.stringify(await page.evaluate(async function(){var s=(await import('/p/reuse/modules/store.js')).store;return {error:s.get('projectSplitViewError'),pending:s.get('projectSplitViewPending')&&s.get('projectSplitViewPending').type,runtime:s.get('savedWorkspaceRuntime')};})));
  }
  var base='http://127.0.0.1:'+info.port;
  await page.goto(base+'/fixture/login');
  var initial=await (await page.request.get(base+'/fixture/state')).json();
  await waitForAsync(async function(){var s=(await import('/p/reuse/modules/store.js')).store;return s.get('projectSplitViewHydrated')&&!s.get('projectSplitViewPending');});
  await page.evaluate(async function(id){(await import('/p/reuse/modules/split-view-presentations.js')).switchToStandalone(id);},initial.standaloneId);
  async function settled(){await waitForAsync(async function(){var s=(await import('/p/reuse/modules/store.js')).store,r=s.get('savedWorkspaceRuntime'),v=(s.get('projectSplitViews')||[]).find(function(v){return v.id===s.get('projectSplitViewActiveId');});return v&&!s.get('projectSplitViewPending')&&r&&JSON.parse(r.key)[4]===v.id&&!r.restoring&&!r.desired&&!r.inflight&&!s.get('projectSplitViewError');});}
  await settled();
  var singleton=await page.evaluate(async function(){var s=(await import('/p/reuse/modules/store.js')).store;return s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');});});
  assert.equal(singleton.sessions.length,1);
  var preference=await (await page.request.get(base+'/api/user/workbench-layout',{headers:{'X-Clay-Account-Id':'owner'}})).json();
  var legacyTree={axis:'horizontal',ratio:.35,left:{id:'tool-terminal'},right:{id:singleton.activeSessionOriginId}};
  var seeded=await page.request.put(base+'/api/user/workbench-layout',{headers:{'X-Clay-Settings':'1','X-Clay-Account-Id':'owner'},data:{mode:preference.mode,revision:preference.revision,layout:{key:JSON.stringify(['reuse','owner',singleton.activeSessionOriginId]),base:singleton.tree,tree:legacyTree}}});
  assert.equal(seeded.ok(),true,await seeded.text());
  await page.reload();await settled();
  assert.equal(await page.evaluate(async function(){return (await import('/p/reuse/modules/store.js')).store.get('projectSplitViewActiveId');}),singleton.id);
  await page.locator('#terminal-sidebar-btn').click();
  await page.locator('#terminal-container .workbench-layout-toggle').click();await settled();
  await waitForAsync(async function(){var s=(await import('/p/reuse/modules/store.js')).store,v=s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');});return v&&v.workspace.panes.some(function(p){return p.kind==='terminal'&&p.open&&p.placement==='docked';});});
  await page.waitForFunction(function(){var p=document.getElementById('terminal-container');return p&&p.dataset.toolWindowId;});
  assert.deepEqual(await page.evaluate(async function(){return (await import('/p/reuse/modules/store.js')).store.get('toolPaneWindowGeometry').tree;}),legacyTree,'standalone account coordinates migrate into the saved View when the binding opens');
  await page.evaluate(async function(){var s=(await import('/p/reuse/modules/store.js')).store,v=s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');});return (await import('/p/reuse/modules/view-mutations.js')).mutation('project_split_view_update',{id:v.id,sessionOrigins:[],tree:null,layout:'balanced',activeSessionOriginId:null});});
  await settled();await page.reload();await settled();
  var empty=await page.evaluate(async function(){var s=(await import('/p/reuse/modules/store.js')).store;return s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');});});
  assert.equal(empty.id,singleton.id);assert.equal(empty.sessions.length,0);assert.equal(empty.tree,null);
  await page.waitForFunction(function(){var p=document.getElementById('terminal-container');return p&&p.dataset.toolWindowId;});
  var state=await (await page.request.get(base+'/fixture/state')).json();
  assert.equal(state.sessions.length,initial.sessions.length);assert.equal(state.terminalStats.length,1);
  await page.evaluate(async function(){var s=(await import('/p/reuse/modules/store.js')).store,v=s.get('projectSplitViews').find(function(v){return v.id===s.get('projectSplitViewActiveId');}),w=JSON.parse(JSON.stringify(v.workspace)),p=w.panes.find(function(p){return p.kind==='terminal';});p.instanceId='unavailable-terminal';p.resource.runtimeId='runtime:expired';w.tree={id:p.instanceId};w.activePaneId=p.instanceId;return (await import('/p/reuse/modules/view-mutations.js')).mutation('project_split_view_update',{id:v.id,sessionOrigins:[],tree:null,layout:'balanced',activeSessionOriginId:null,workspace:w});});
  await settled();await page.reload();await settled();
  await page.locator('#terminal-saved-unavailable').waitFor({state:'visible'});
  assert.equal((await (await page.request.get(base+'/fixture/state')).json()).terminalStats.length,1,'missing resource never creates a replacement PTY');
});
