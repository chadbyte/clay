import { createStore, store } from '/lib/public/modules/store.js';
import { initFileBrowser, handleFsRead, handleFileChanged, openFile, closeFileViewer } from '/lib/public/modules/filebrowser.js';

var source = '<html><head><style>body{font:20px sans-serif;padding:32px;background:#e9f1ec}button{padding:12px}</style></head><body><h1>HTML preview</h1><button onclick="this.textContent=\'Clicked\'">Try interaction</button><script>var isolated=false;try{parent.document.body}catch(e){isolated=true}parent.postMessage({fixtureHtml:true,isolated:isolated,title:document.querySelector("h1").textContent},"*");</script></body></html>';
var sources = { 'demo.html': source, 'PAGE.HTM': source, 'plain.txt': 'Plain text', 'large.html': source };
var reports = [];
window.addEventListener('message', function (event) {
  var frame = document.querySelector('.file-viewer-html-preview');
  if (frame && event.source === frame.contentWindow && event.data.fixtureHtml) reports.push(event.data);
});
createStore({ connected: true, cwd: '/workspace/project', currentSlug: 'fixture', activeSessionId: 42, myUserId: 'fixture-user' });
var ws = { send: function (raw) {
  var msg = JSON.parse(raw);
  if (msg.type !== 'fs_read') return;
  setTimeout(function () {
    handleFsRead(Object.assign({}, msg, { type: 'fs_read_result', content: sources[msg.path], size: msg.path === 'large.html' ? 2 * 1024 * 1024 : sources[msg.path].length }));
  }, 0);
} };
initFileBrowser({ ws: ws, connected: true, activeSessionId: 42, cwd: '/workspace/project', messagesEl: document.getElementById('messages'), fileTreeEl: document.getElementById('file-tree'), fileViewerEl: document.getElementById('file-viewer') });
Object.keys(sources).forEach(function (path) {
  var button = document.createElement('button');
  button.textContent = path;
  button.onclick = function () { openFile(path); };
  document.getElementById('plantuml-controls').appendChild(button);
});
function waitFor(check) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (check()) return resolve();
      if (Date.now() - start > 5000) return reject(new Error('Timed out'));
      setTimeout(poll, 30);
    }
    poll();
  });
}
var report = document.getElementById('fixture-result');
function check(value, message) {
  if (!value) throw new Error(message);
  report.textContent += 'PASS: ' + message + '\n';
}
var run = document.createElement('button');
run.textContent = 'Run HTML checks';
document.getElementById('plantuml-controls').appendChild(run);
run.onclick = async function () {
  report.textContent = '';
  try {
    for (var path of ['demo.html', 'PAGE.HTM']) {
      reports = [];
      openFile(path);
      await waitFor(function () { return reports.length; });
      check(reports[0].title === 'HTML preview', path + ' renders and runs scripts');
      check(reports[0].isolated, 'Preview cannot access Clay DOM');
    }
    document.getElementById('file-viewer-render').click();
    check(!document.querySelector('iframe') && document.getElementById('file-viewer-body').textContent.includes('<html>'), 'Source toggle displays HTML');
    var updated = source.replace('HTML preview', 'Updated preview');
    handleFileChanged({ path: 'PAGE.HTM', content: updated, size: updated.length });
    check(!document.querySelector('iframe'), 'Refresh preserves source mode');
    reports = [];
    document.getElementById('file-viewer-render').click();
    await waitFor(function () { return reports.length; });
    check(reports[0].title === 'Updated preview', 'Returning to preview uses updated source');
    reports = [];
    handleFileChanged({ path: 'PAGE.HTM', content: source, size: source.length });
    await waitFor(function () { return reports.length; });
    check(reports[0].title === 'HTML preview', 'Live changes refresh the preview');
    closeFileViewer();
    check(!document.querySelector('iframe'), 'Closing destroys the running preview');
    openFile('demo.html', { line: 1 });
    await waitFor(function () { return document.getElementById('file-viewer-body').textContent.includes('<html>'); });
    check(!document.querySelector('iframe'), 'Line links open source');
    openFile('large.html');
    await waitFor(function () { return document.getElementById('file-viewer-body').textContent.includes('showing plain text'); });
    check(document.getElementById('file-viewer-render').classList.contains('hidden'), 'Large HTML uses lightweight source');
    openFile('plain.txt');
    await waitFor(function () { return document.getElementById('file-viewer-body').textContent.includes('Plain text'); });
    check(!store.get('fileViewerIsHtml'), 'Switching files clears HTML state');
    report.textContent += 'ALL CHECKS PASSED';
    openFile('demo.html');
  } catch (error) { report.textContent += 'FAIL: ' + error.message; }
};
openFile('demo.html');
