var test = require('node:test');
var assert = require('node:assert/strict');
var http = require('http');
var fs = require('fs');
var path = require('path');

var publicRoot = path.resolve(__dirname, '../lib/public');
var markedFile = path.resolve(__dirname, '../node_modules/marked/marked.min.js');

function playwrightOrNull() { try { return require('playwright'); } catch (error) { return null; } }

function pageHtml() {
  return '<!doctype html><html><body><div id="session-actions"></div><div id="main-panels"><main id="chat">Chat remains</main></div>' +
    '<script src="/marked.js"></script><script>window.DOMPurify={sanitize:function(value){return value;}};window.mermaid={initialize:function(){},render:function(){return Promise.resolve({svg:""});}};window.hljs={highlightElement:function(){}};window.lucide={createIcons:function(){}};</script>' +
    '<script type="module">import {createStore,store} from "/modules/store.js";import {setWs} from "/modules/ws-ref.js";import {initMateKnowledgeWorkbench,openKnowledgeWorkbench,handleKnowledgeWorkbenchMessage} from "/modules/mate-knowledge-workbench.js";' +
    'createStore({currentSlug:"mate-fixture",projectsHubList:[{slug:"mate-fixture",isMate:true}],cachedMatesList:[],mateKnowledgeWorkspaces:{},rightWorkbenchRevision:0});window.sent=[];setWs({readyState:1,send:function(raw){window.sent.push(JSON.parse(raw));}});window.knowledge={store:store,handle:handleKnowledgeWorkbenchMessage};initMateKnowledgeWorkbench();openKnowledgeWorkbench();window.ready=true;</script></body></html>';
}

function serve(t) {
  var server = http.createServer(function (request, response) {
    var url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(pageHtml()); return; }
    if (url.pathname === '/marked.js') { response.setHeader('Content-Type', 'text/javascript'); fs.createReadStream(markedFile).pipe(response); return; }
    var file = path.resolve(publicRoot, '.' + url.pathname);
    if (!file.startsWith(publicRoot + path.sep)) { response.writeHead(403); response.end(); return; }
    fs.readFile(file, function (error, data) { if (error) { response.writeHead(404); response.end(); return; } response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(data); });
  });
  t.after(function () { server.close(); });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

async function lastSent(page, type) {
  await page.waitForFunction(function (wanted) { return window.sent.some(function (item) { return item.type === wanted; }); }, type);
  return page.evaluate(function (wanted) { var matches = window.sent.filter(function (item) { return item.type === wanted; }); return matches[matches.length - 1]; }, type);
}

async function reply(page, message) {
  await page.evaluate(function (value) { window.knowledge.handle(value); }, message);
}

async function restoreDeleted(page, id, name, version) {
  await page.locator('[data-deleted-history="' + id + '"]').click(); var history = await lastSent(page, 'knowledge_history');
  assert.equal(history.documentId, id); await reply(page, { type: 'knowledge_history', requestId: history.requestId, versions: [{ version: version }] });
  await page.locator('[data-history-preview="' + version + '"]').click(); var read = await lastSent(page, 'knowledge_history_read');
  assert.equal(read.documentId, id); await reply(page, { type: 'knowledge_history_version', requestId: read.requestId, version: version, content: '# Historical ' + name });
  assert.equal(await page.locator('[data-history-restore]').count(), 0); await page.locator('[data-history-review]').click();
  assert.equal(await page.locator('.knowledge-editor-host').count(), 0); await page.locator('[data-history-restore]').click(); var restore = await lastSent(page, 'knowledge_restore');
  assert.deepEqual({ id: restore.documentId, name: restore.name, revision: restore.expectedRevision }, { id: id, name: name, revision: null });
  await reply(page, { type: 'knowledge_restored', requestId: restore.requestId, id: id, name: name, revision: 'restored-' + id }); var current = await lastSent(page, 'knowledge_read');
  assert.equal(current.documentId, id); await reply(page, { type: 'knowledge_content', requestId: current.requestId, id: id, name: name, revision: 'restored-' + id, writable: true, content: '# Restored ' + name, outgoing: [], backlinks: [] });
  await page.getByText('Restored ' + name, { exact: true }).waitFor(); assert.equal(await page.locator('[data-deleted-history="' + id + '"]').count(), 0);
}

test('production Knowledge controller owns delayed history, preview links, deleted restore, and search pages', { timeout: 120000 }, async function (t) {
  var playwright = playwrightOrNull(); if (!playwright) { t.skip('playwright is not installed'); return; }
  var browser; try { browser = await playwright.chromium.launch(); } catch (error) { t.skip('Chromium is not available: ' + error.message); return; }
  t.after(function () { return browser.close(); }); var server = await serve(t); var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(function () { return window.ready; });
  var list = await lastSent(page, 'knowledge_list'); var files = [{ id: 'a', name: 'A.md', revision: 'rev-a' }, { id: 'b', name: 'B.md', revision: 'rev-b' }, { id: 'doc', name: 'Doc.md', revision: 'rev-doc' }];
  await reply(page, { type: 'knowledge_list', requestId: list.requestId, files: files, drafts: [] });
  await page.getByRole('button', { name: 'A', exact: true }).click(); var readA = await lastSent(page, 'knowledge_read');
  await reply(page, { type: 'knowledge_content', requestId: readA.requestId, id: 'a', name: 'A.md', revision: 'rev-a', writable: true,
    content: '<https://example.com>\n\n<a href="Doc.md">Raw</a>\n\n[Doc](Doc.md)\n\n[[javascript:alert(1)]]\n\n\\[[escaped]]\n\n`[[code]]`',
    outgoing: [{ kind: 'markdown', target: 'Doc.md', label: 'Doc', documentKey: 'local:doc' }, { kind: 'wiki', target: 'javascript:alert(1)', label: 'unsafe', raw: '[[javascript:alert(1)]]', external: true }], backlinks: [] });
  assert.equal(await page.locator('.knowledge-preview a[href^="https://example.com"]').count(), 1);
  assert.equal(await page.locator('.knowledge-preview [data-open-document="local:doc"]').count(), 1);
  assert.equal(await page.locator('.knowledge-preview a[href="Doc.md"][data-open-document]').count(), 0);
  assert.equal(await page.locator('.knowledge-preview a[href^="javascript:"]').count(), 0);

  await page.locator('[data-history-load]').click(); var delayedA = await lastSent(page, 'knowledge_history');
  await page.getByRole('button', { name: 'B', exact: true }).click(); var readB = await lastSent(page, 'knowledge_read');
  await reply(page, { type: 'knowledge_content', requestId: readB.requestId, id: 'b', name: 'B.md', revision: 'rev-b', writable: true, content: '# B current', outgoing: [], backlinks: [] });
  await reply(page, { type: 'knowledge_history', requestId: delayedA.requestId, versions: [{ version: '1000-a' }] });
  assert.match(await page.locator('[role="tab"][aria-selected="true"]').innerText(), /B/); await page.locator('[data-history-preview="1000-a"]').click(); var versionA = await lastSent(page, 'knowledge_history_read');
  assert.equal(versionA.documentId, 'a'); await reply(page, { type: 'knowledge_history_version', requestId: versionA.requestId, version: '1000-a', content: '# A historical' });
  assert.match(await page.locator('.knowledge-document-toolbar').innerText(), /A\.md/); assert.equal(await page.locator('[data-history-restore]').count(), 0);
  await page.locator('[data-history-review]').click(); assert.equal(await page.locator('.knowledge-editor-host').count(), 0); await page.locator('[data-history-restore]').click(); var restoreA = await lastSent(page, 'knowledge_restore');
  assert.deepEqual({ id: restoreA.documentId, name: restoreA.name, revision: restoreA.expectedRevision }, { id: 'a', name: 'A.md', revision: 'rev-a' });
  await reply(page, { type: 'knowledge_restored', requestId: restoreA.requestId, id: 'a', name: 'A.md', revision: 'rev-a2' }); var refreshedA = await lastSent(page, 'knowledge_read');
  await reply(page, { type: 'knowledge_content', requestId: refreshedA.requestId, id: 'a', name: 'A.md', revision: 'rev-a2', writable: true, content: '# A restored actual', outgoing: [], backlinks: [] });
  await page.getByText('A restored actual', { exact: true }).waitFor();

  await page.locator('[data-knowledge-deleted]').click(); var deletedList = await lastSent(page, 'knowledge_deleted_list');
  await reply(page, { type: 'knowledge_deleted_list', requestId: deletedList.requestId, files: [{ id: 'gone-b', name: 'gone-b.md' }, { id: 'gone-empty', name: 'gone-empty.md' }] });
  await page.getByRole('button', { name: 'B', exact: true }).click(); await restoreDeleted(page, 'gone-b', 'gone-b.md', '2000-b');
  var closeButtons = page.locator('[data-close-tab]'); while (await closeButtons.count()) await closeButtons.first().click();
  await restoreDeleted(page, 'gone-empty', 'gone-empty.md', '3000-empty');

  var search = page.getByRole('searchbox'); await search.fill('result'); await page.waitForTimeout(220); var searchOne = await lastSent(page, 'knowledge_search'); assert.equal(searchOne.offset, 0); assert.equal(searchOne.limit, 50);
  var pageOne = []; for (var i = 1; i <= 50; i++) pageOne.push({ id: 'r' + i, name: 'result-' + i + '.md' });
  await reply(page, { type: 'knowledge_search_results', requestId: searchOne.requestId, files: pageOne, total: 51, complete: true }); await page.locator('[data-search-more]').click(); var searchTwo = await lastSent(page, 'knowledge_search'); assert.equal(searchTwo.offset, 50);
  await reply(page, { type: 'knowledge_search_results', requestId: searchTwo.requestId, files: [{ id: 'r51', name: 'result-51.md' }], total: 51, complete: true }); assert.equal(await page.getByRole('button', { name: 'result-51', exact: true }).count(), 1);

  await search.fill(''); await page.getByRole('button', { name: 'A', exact: true }).click(); await page.locator('[data-document-action="edit"]').click(); await page.locator('.knowledge-editor-fallback').fill('[Other](Other.md)');
  assert.equal(await page.locator('.knowledge-live-preview [data-open-document]').count(), 0);
});
