var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('http');
var fs = require('fs');
var path = require('path');

var publicRoot = path.resolve(__dirname, '../lib/public');

function playwrightOrNull() { try { return require('playwright'); } catch (error) { return null; } }

function pageHtml() {
  return '<!doctype html><html><head>' +
    '<link rel="stylesheet" href="/css/sidebar.css"><link rel="stylesheet" href="/css/icon-strip.css">' +
    '</head><body><div id="sidebar-tools"><div id="session-actions" role="group" aria-label="Tools"></div></div>' +
    '<div id="mate-sidebar-tools"></div><div id="main-panels"></div>' +
    '<script>window.marked={parse:function(value){return value;},use:function(){}};window.DOMPurify={sanitize:function(value){return value;}};window.mermaid={initialize:function(){},render:function(){return Promise.resolve({svg:""});}};window.hljs={highlightElement:function(){}};window.lucide={createIcons:function(){}};window.addEventListener("error",function(event){window.moduleError=event.message;});window.addEventListener("unhandledrejection",function(event){window.moduleError=String(event.reason);});window.fetch=function(url){if (url === "/api/user/tool-palettes") return Promise.resolve({ok:true,json:function(){return Promise.resolve({session:{order:["mcp-btn"],hidden:[]},mate:{order:["mate-debates-btn"],hidden:[]}});}});return Promise.resolve({ok:true,json:function(){return Promise.resolve({});}});};</script>' +
    '<script type="module">' +
    'import "/modules/markdown.js";' +
    'import {createStore,store} from "/modules/store.js";' +
    'import {setWs} from "/modules/ws-ref.js";' +
    'import {initToolPalettes} from "/modules/tool-palette.js";' +
    'import {initDebatesWorkbench} from "/modules/debates-workbench.js";' +
    'import {isMateWorkspace} from "/modules/project-mate-navigation.js";' +
    'createStore({currentSlug:"ordinary",activeProjectSlug:"ordinary",activeProjectMateId:null,projectsHubList:[{slug:"ordinary"},{slug:"mate-a",isMate:true}],cachedMatesList:[],dmMode:false,dmTargetUser:null,connected:true,rightWorkbenchRevision:0,debatesWorkbenchStatus:"idle",debatesWorkbenchItems:[],debatesWorkbenchError:""});' +
    'setWs({readyState:1,send:function(){}});' +
    'initToolPalettes();initDebatesWorkbench();' +
    'window.syncSurface=function(){document.body.classList.toggle("mate-workspace-active",isMateWorkspace(store.snap()));};' +
    'window.setSurface=function(slug,mate,dm){store.set({currentSlug:slug,activeProjectSlug:slug,activeProjectMateId:mate||null,dmMode:!!dm,dmTargetUser:dm?{isMate:true}:null});window.syncSurface();};' +
    'window.syncSurface();window.ready=true;</script></body></html>';
}

function serve(t) {
  var server = http.createServer(function (request, response) {
    var url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(pageHtml()); return; }
    var file = path.resolve(publicRoot, '.' + url.pathname);
    if (!file.startsWith(publicRoot + path.sep)) { response.writeHead(403); response.end(); return; }
    fs.readFile(file, function (error, data) {
      if (error) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(data);
    });
  });
  t.after(function () { server.close(); });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

test('production Mate project Debates tile is visible and wired without leaking to ordinary projects', { timeout: 120000 }, async function (t) {
  var playwright = playwrightOrNull();
  if (!playwright) { t.skip('Playwright is not installed'); return; }
  var browser;
  try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  t.after(function () { return browser.close(); });
  var server = await serve(t);
  var page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  var pageErrors = [];
  page.on('pageerror', function (error) { pageErrors.push(error.stack || error.message); });
  await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
  await page.waitForFunction(function () { return window.ready || window.moduleError; });
  assert.deepEqual(pageErrors, [], pageErrors.join('; '));
  assert.equal(await page.evaluate(function () { return !!window.ready; }), true, 'production toolbar bootstrap did not finish');

  var projectButton = page.locator('#mate-project-debates-btn');
  var legacyButton = page.locator('#mate-debates-btn');
  assert.equal(await projectButton.count(), 1);
  assert.equal(await legacyButton.count(), 1);
  assert.equal(await projectButton.evaluate(function (button) { return getComputedStyle(button).display; }), 'none');
  assert.equal(await page.locator('#session-actions [data-tool-id="mate-project-debates-btn"]').count(), 0);

  await page.evaluate(function () { window.setSurface('mate-a', 'mate-a', false); });
  assert.equal(await projectButton.evaluate(function (button) { return getComputedStyle(button).display; }), 'flex');
  assert.equal(await page.locator('#session-actions .tool-btn-label').filter({ hasText: 'Memory' }).count(), 0);
  await projectButton.click();
  await page.waitForFunction(function () { var panel = document.getElementById('debates-workbench'); return panel && !panel.classList.contains('hidden'); });

  await page.evaluate(function () { window.setSurface('ordinary', null, false); });
  await page.waitForFunction(function () { return document.getElementById('debates-workbench').classList.contains('hidden'); });
  assert.equal(await projectButton.evaluate(function (button) { return getComputedStyle(button).display; }), 'none');

  await page.evaluate(function () { window.setSurface('mate-a', 'mate-a', false); });
  assert.equal(await projectButton.evaluate(function (button) { return getComputedStyle(button).display; }), 'flex');
  await projectButton.click();
  await page.waitForFunction(function () { return !document.getElementById('debates-workbench').classList.contains('hidden'); });
  await page.evaluate(function () { window.setSurface('ordinary', null, false); });
  assert.equal(await projectButton.evaluate(function (button) { return getComputedStyle(button).display; }), 'none');

  await page.evaluate(function () { window.setSurface('dm', null, true); });
  assert.notEqual(await legacyButton.evaluate(function (button) { return getComputedStyle(button).display; }), 'none');
  await legacyButton.click();
  await page.waitForFunction(function () { return !document.getElementById('debates-workbench').classList.contains('hidden'); });
});
