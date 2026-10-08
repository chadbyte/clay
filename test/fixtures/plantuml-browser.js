import { createStore, store } from '/lib/public/modules/store.js';
import { initFileBrowser, handleFsRead, handleFileChanged, openFile, closeFileViewer } from '/lib/public/modules/filebrowser.js';

var sources = {
  'workbench.puml': await fetch('/docs/examples/clay-workbench.puml').then(function (r) { return r.text(); }),
  'action.uml': '@startsalt\n{ [Open wireframe] }\n@endsalt',
  'columns.plantuml': '@startsalt\n{ Conversation | Wireframe }\n@endsalt',
  'form.salt': '{+\nName | "Chad    "\n[Save] | [Cancel]\n}',
  'invalid.puml': 'This is not a diagram',
  'broken.puml': '@startuml\nthis is a syntax error !@#$\n@enduml',
  'plain.txt': 'Plain text still opens normally.',
  'readme.md': '# Markdown still works',
};
createStore({ connected: true, cwd: '/workspace/project', currentSlug: 'fixture', activeSessionId: 42,
  myUserId: 'fixture-user', fileReadRequest: null, pendingFileNavigation: null,
  fileViewerIsPlantUml: false, plantUmlPreviewJob: null });
async function syncSource(path, content) {
  await fetch('/fixture/source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path, content: content }) });
}
for (var sourcePath of Object.keys(sources)) await syncSource(sourcePath, sources[sourcePath]);
var ws = { send: function (raw) {
  var msg = JSON.parse(raw);
  if (msg.type !== 'fs_read') return;
  setTimeout(function () {
    handleFsRead(Object.assign({}, msg, { type: 'fs_read_result', content: sources[msg.path], size: sources[msg.path].length }));
  }, 0);
} };
initFileBrowser({ ws: ws, connected: true, activeSessionId: 42, cwd: '/workspace/project',
  messagesEl: document.getElementById('messages'), fileTreeEl: document.getElementById('file-tree'),
  fileViewerEl: document.getElementById('file-viewer') });
Object.keys(sources).forEach(function (path) {
  var button = document.createElement('button');
  button.textContent = path;
  button.onclick = function () { openFile(path); };
  document.getElementById('plantuml-controls').appendChild(button);
});
var run = document.createElement('button');
run.textContent = 'Run preview checks';
document.getElementById('plantuml-controls').appendChild(run);
var report = document.getElementById('fixture-result');
function waitFor(check) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (check()) { resolve(); return; }
      if (Date.now() - start > 25000) { reject(new Error('Timed out: ' + document.getElementById('file-viewer-body').textContent)); return; }
      setTimeout(poll, 50);
    }
    poll();
  });
}
function diagramText() {
  var image = document.querySelector('.file-viewer-plantuml-preview img');
  if (!image) return '';
  var svg = decodeURIComponent(image.src.substring(image.src.indexOf(',') + 1));
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement.textContent;
}
function imageReady(path) {
  var image = document.querySelector('.file-viewer-plantuml-preview img');
  return image && image.complete && image.naturalWidth > 0 && (!path || image.alt === "Diagram preview of " + path);
}
function check(value, message) {
  if (!value) throw new Error(message);
  report.textContent += 'PASS: ' + message + '\n';
}
run.onclick = async function () {
  report.textContent = '';
  try {
    for (var path of ['workbench.puml', 'action.uml', 'columns.plantuml', 'form.salt']) {
      openFile(path);
      await waitFor(function () { return imageReady(path); });
      var expected = { 'workbench.puml': 'Your connections', 'action.uml': 'Open wireframe', 'columns.plantuml': 'Conversation', 'form.salt': 'Cancel' };
      check(diagramText().indexOf(expected[path]) !== -1, path + ' renders the expected diagram content');
      check(store.get('plantUmlPreviewJob') === null, 'Renderer cleaned up after ' + path);
    }
    check(!document.querySelector('.sketch-handwritten'), 'No handwritten toggle in file preview');
    document.getElementById('file-viewer-render').click();
    check(!document.querySelector('.file-viewer-plantuml-preview'), 'Source toggle shows code');
    await syncSource('form.salt', '{+\nUpdated wireframe\n[Continue]\n}');
    handleFileChanged({ path: 'form.salt', content: '{+\nUpdated wireframe\n[Continue]\n}', size: 40 });
    check(!document.querySelector('.file-viewer-plantuml-preview'), 'Live refresh preserves source mode');
    document.getElementById('file-viewer-render').click();
    await waitFor(imageReady);
    var small = document.querySelector('.file-viewer-plantuml-preview img');
    await waitFor(function () { return small.clientWidth > 0; });
    check(small.clientWidth <= small.naturalWidth + 1, 'File preview does not magnify controls automatically');
    document.querySelector('[data-zoom-value]').click();
    check(Math.abs(small.clientWidth - small.naturalWidth) < 2, 'File preview original size');
    document.querySelector('[data-zoom-in]').click();
    check(small.clientWidth > small.naturalWidth, 'File preview zooms in');
    document.querySelector('[data-zoom-fit]').click();
    var before = document.querySelector('.file-viewer-plantuml-preview img').src;
    await syncSource('form.salt', '{+\nAnother update\n[Finish]\n}');
    handleFileChanged({ path: 'form.salt', content: '{+\nAnother update\n[Finish]\n}', size: 38 });
    await waitFor(imageReady);
    check(document.querySelector('.file-viewer-plantuml-preview img').src !== before, 'Live refresh updates diagram');
    openFile('invalid.puml');
    await waitFor(function () { return document.querySelector('.file-tree-error'); });
    check(document.getElementById('file-viewer-body').textContent.indexOf('@startsalt') !== -1, 'Invalid input has actionable error');
    openFile('plain.txt');
    await waitFor(function () { return document.getElementById('file-viewer-body').textContent.indexOf('Plain text') !== -1; });
    check(document.getElementById('file-viewer-render').classList.contains('hidden'), 'Plain text keeps existing viewer');
    openFile('readme.md');
    await waitFor(function () { return document.getElementById('file-viewer-body').textContent.indexOf('Markdown still works') !== -1; });
    document.getElementById('file-viewer-render').click();
    check(!!document.querySelector('.file-viewer-markdown h1'), 'Markdown preview still works');
    var originalFetch = window.fetch;
    window.fetch = function (url, options) {
      if (String(url).indexOf('api/file/plantuml?') === -1) return originalFetch(url, options);
      return new Promise(function (resolve, reject) {
        options.signal.addEventListener('abort', function () { reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
      });
    };
    try {
      openFile('workbench.puml');
      await waitFor(function () { return store.get('plantUmlPreviewJob'); });
      closeFileViewer();
    } finally { window.fetch = originalFetch; }
    check(store.get('plantUmlPreviewJob') === null, 'Closing cancels pending renderer');
    openFile('workbench.puml');
    await waitFor(imageReady);
    report.textContent += 'ALL CHECKS PASSED';
  } catch (error) { report.textContent += 'FAIL: ' + error.message; }
};
openFile('workbench.puml');
