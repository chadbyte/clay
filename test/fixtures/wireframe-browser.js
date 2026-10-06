import { createStore, store } from '/lib/public/modules/store.js';
import { renderMarkdown, renderMermaidBlocks, highlightCodeBlocks } from '/lib/public/modules/markdown.js';
import { openWireframe, closeWireframe } from '/lib/public/modules/wireframe-workbench.js';
import { registerRightWorkbench, claimRightWorkbench } from '/lib/public/modules/right-workbench.js';
createStore({ currentSlug: 'fixture', activeSessionId: 42, myUserId: 'fixture-user', replayingHistory: false });
var source = await fetch('/docs/examples/clay-workbench.puml').then(function (r) { return r.text(); });
var revised = source.replace('Your connections', 'Connected tools');
var messages = document.getElementById('messages');
var report = document.getElementById('results');
function append(text) {
  var el = document.createElement('article'); el.innerHTML = renderMarkdown(text); messages.appendChild(el);
  highlightCodeBlocks(el); renderMermaidBlocks(el); return el;
}
function diagram(text) { return '```clay-sketch\n' + text + '\n```'; }
function check(value, label) { if (!value) throw new Error(label); }
function waitFor(predicate) {
  var started = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (predicate()) { resolve(); return; }
      if (Date.now() - started > 30000) { reject(new Error('Timed out waiting for preview.')); return; }
      setTimeout(poll, 60);
    }
    poll();
  });
}
function picture(selector) { var img = document.querySelector(selector); return img && img.complete && img.naturalWidth > 0; }
function showInitial() { messages.innerHTML = ''; append('I would keep connections beside the conversation.\n\n' + diagram(source)); }
registerRightWorkbench('fixture-other', function () { document.getElementById('other-panel').classList.add('hidden'); });
document.getElementById('other').onclick = function () { claimRightWorkbench('fixture-other'); document.getElementById('other-panel').classList.remove('hidden'); };
document.getElementById('revise').onclick = function () {
  openWireframe({ source: revised, id: 'connections', title: 'Connections' });
  append('The connection section now has a clearer title.\n\n' + diagram(revised));
};
showInitial();
document.getElementById('run').onclick = async function () {
  this.disabled = true; report.textContent = 'Checking…';
  try {
    await waitFor(function () { return picture('.wireframe-card img'); });
    check(!document.getElementById('wireframe-panel'), 'Inline diagram must not auto-open the workbench');
    var inline = document.querySelector('.wireframe-card');
    check(inline.querySelector('.sketch-credit').href === 'https://plantuml.com/salt', 'PlantUML Salt attribution');
    check(inline.querySelector('[data-open-sketch]').textContent === 'Open sketch', 'Viewer naming');
    check(!inline.querySelector('.sketch-handwritten'), 'No handwritten toggle in chat');
    document.querySelector('.wireframe-card [data-open-sketch]').click();
    await waitFor(function () { return picture('#wireframe-panel img'); });
    check(!document.querySelector('#wireframe-panel textarea'), 'Workbench must not have an editor');
    check(!document.querySelector('[data-handwritten]'), 'No handwritten toggle in viewer');
    var image = document.querySelector('#wireframe-panel img');
    check(image.clientWidth <= image.naturalWidth + 1, 'Viewer never automatically magnifies controls');
    document.querySelector('[data-zoom-value]').click(); check(Math.abs(image.clientWidth - image.naturalWidth) < 2, 'Original size');
    document.querySelector('[data-zoom-in]').click(); check(image.clientWidth > image.naturalWidth, 'Zoom enlarges diagram');
    document.querySelector('[data-zoom-out]').click(); check(Math.abs(image.clientWidth - image.naturalWidth) < 2, 'Zoom out returns to original');
    document.querySelector('[data-zoom-fit]').click(); check(document.querySelector('[data-zoom-fit]').getAttribute('aria-pressed') === 'true', 'Fit');
    var downloadSource;
    var originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      check(this.download.endsWith('.puml'), 'Download extension');
      downloadSource = fetch(this.href).then(function (response) { return response.text(); });
    };
    try { document.querySelector('[data-download]').click(); }
    finally { HTMLAnchorElement.prototype.click = originalClick; }
    var downloaded = await downloadSource;
    check(downloaded.trim() === source.trim(), 'Download contains unchanged source');
    document.querySelector('[data-wide]').click(); check(document.getElementById('wireframe-panel').classList.contains('wireframe-wide'), 'Widen');
    document.querySelector('[data-full]').click(); check(document.getElementById('wireframe-panel').classList.contains('panel-fullscreen'), 'Fullscreen');
    document.querySelector('[data-full]').click();
    document.getElementById('revise').click();
    await waitFor(function () { return picture('#wireframe-panel img'); });
    check(decodeURIComponent(document.querySelector('#wireframe-panel img').src).includes('Connected tools'), 'Revised image content');
    check(messages.querySelectorAll('.wireframe-card').length === 2, 'Both revisions stay in history');
    check(messages.querySelector('pre code').textContent.trim() === source.trim(), 'Old revision source stays unchanged');
    var name = 'wireframe-' + Date.now() + '.puml';
    document.querySelector('[data-save]').click();
    document.querySelector('[name="path"]').value = name;
    document.querySelector('#wireframe-panel form').requestSubmit();
    await waitFor(function () { return document.querySelector('.wireframe-save-status').textContent.startsWith('Saved to '); });
    document.querySelector('[data-save]').click(); document.querySelector('[name="path"]').value = name;
    document.querySelector('#wireframe-panel form').requestSubmit();
    await waitFor(function () { return document.querySelector('.wireframe-save-status').textContent.includes('already exists'); });
    document.querySelector('[data-cancel]').click();
    document.getElementById('other').click(); check(!document.getElementById('wireframe-panel'), 'Another workbench closes wireframe');
    document.querySelector('.wireframe-card [data-open-sketch]').click(); check(document.getElementById('other-panel').classList.contains('hidden'), 'Wireframe closes another workbench');
    store.set({ activeSessionId: 43 }); check(!document.getElementById('wireframe-panel'), 'Session change closes draft');
    store.set({ replayingHistory: true });
    var history = append(diagram(source)); check(!history.querySelector('.wireframe-card'), 'Defer replay rendering');
    store.set({ replayingHistory: false }); renderMermaidBlocks(history);
    await waitFor(function () { return history.querySelector('img'); });
    check(!document.getElementById('wireframe-panel'), 'History replay does not open workbench');
    var bad = append(diagram('@startuml\nthis is a syntax error !@#$\n@enduml'));
    await waitFor(function () { return bad.querySelector('.wireframe-canvas button'); });
    check(bad.querySelector('details pre'), 'Error retains readable source');
    var incomplete = append('```plantuml\n@startsalt\n{'); check(!incomplete.querySelector('.wireframe-card'), 'Incomplete body not rendered');
    openWireframe({ source: source.replace('Your connections', 'Obsolete view'), id: 'connections' });
    openWireframe({ source: revised, id: 'connections' });
    await waitFor(function () { return picture('#wireframe-panel img'); });
    check(decodeURIComponent(document.querySelector('#wireframe-panel img').src).includes('Connected tools'), 'Stale render never replaces newer draft');
    closeWireframe(); showInitial(); await waitFor(function () { return picture('.wireframe-card img'); });
    openWireframe({ source: source, id: 'connections', title: 'Connections' });
    openWireframe({ source: '@startsalt\n{+\nName | "Alex                    "\n[Save]\n}\n@endsalt', id: 'small', title: 'Readable sketch' });
    await waitFor(function () { return picture('#wireframe-panel img'); });
    var small = document.querySelector('#wireframe-panel img');
    await waitFor(function () { return small.clientWidth > 0; });
    check(small.clientWidth <= small.naturalWidth + 1, 'Small sketches retain their natural scale');
    var fitted = small.clientWidth;
    document.querySelector('[data-wide]').click();
    if (window.innerWidth >= 1024) check(small.clientWidth <= small.naturalWidth + 1, 'Widening does not magnify controls');
    var screen = await fetch('/docs/examples/clay-mcp-screen.puml').then(function (r) { return r.text(); });
    openWireframe({ source: screen, id: 'mcp-screen', title: 'MCP connections · 1440 × 900' });
    await waitFor(function () { return picture('#wireframe-panel img'); });
    var screenImage = document.querySelector('#wireframe-panel img');
    check(screenImage.naturalWidth === 1440 && screenImage.naturalHeight === 900, 'Screen canvas uses authored dimensions');
    check(screenImage.clientWidth <= document.querySelector('.wireframe-workbench-canvas').clientWidth, 'Whole screen fits initially');
    closeWireframe();
    await waitFor(function () { return !Array.from((store.get('wireframeViewports') || new Map()).keys()).some(function (el) { return !el.isConnected; }); });
    document.querySelector('.wireframe-card [data-open-sketch]').click();
    report.textContent = 'PASS: branding, attribution, clean controls, unchanged download, inline, revision, history, save, conflict, panel switching, fullscreen, session reset, download, zoom, fit enlargement, resize, viewport cleanup, stale renders, errors';
  } catch (error) { report.textContent = 'FAIL: ' + error.message; }
  this.disabled = false;
};

var screenExample = document.createElement('button');
screenExample.textContent = 'Show screen example';
screenExample.onclick = async function () {
  var content = await fetch('/docs/examples/clay-mcp-screen.puml').then(function (r) { return r.text(); });
  closeWireframe(); messages.innerHTML = '';
  append('MCP connections — desktop layout, 1440 × 900.\n\n' + diagram(content));
};
document.querySelector('.fixture-controls').appendChild(screenExample);
