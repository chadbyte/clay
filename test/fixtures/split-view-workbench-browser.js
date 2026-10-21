import { store } from '/p/reuse/modules/store.js';
import { getWs } from '/p/reuse/modules/ws-ref.js';
import { openTerminal, closeTerminal } from '/p/reuse/modules/terminal.js';
import { openSharedBrowser, hideSharedBrowser } from '/p/reuse/modules/shared-browser.js';
import { openFile, handleFsRead, closeFileViewer } from '/p/reuse/modules/filebrowser.js';
import { openProjectLogs, closeProjectLogs } from '/p/reuse/modules/project-logs.js';

function assert(value, message) { if (!value) throw new Error(message); }
function settle() { return new Promise(function (resolve) { setTimeout(resolve, 260); }); }
async function waitFor(check, label) {
  var deadline = performance.now() + 20000;
  while (!check()) { assert(performance.now() < deadline, label + ' timed out'); await settle(); }
}
async function verify() {
  var deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    var candidates = Array.from(document.querySelectorAll('#split-host > .split-pane'));
    if (candidates.length && candidates.every(function (pane) {
      var frame = pane.querySelector('iframe'), live = frame.clayPane && frame.clayPane.identity();
      return live && live.ready && !frame.dataset.requestedSessionId;
    })) break;
    await settle();
  }
  var panes = Array.from(document.querySelectorAll('#split-host > .split-pane'));
  assert(panes.length && panes.every(function (pane) { var frame = pane.querySelector('iframe'); return frame.clayPane && frame.clayPane.identity().ready; }), 'Wait for ready panes');
  var saved = JSON.stringify(store.get('projectSplitViews'));
  function measurements() {
    return panes.map(function (pane) {
      var r = pane.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    });
  }
  var before = JSON.stringify(measurements());
  var documents = panes.map(function (pane) { return pane.querySelector('iframe').contentDocument; });
  panes.forEach(function (pane) {
    var header = pane.querySelector('.split-pane-header'), runtime = pane.querySelector('.split-view-runtime');
    assert(runtime.parentNode === header, 'Model information is outside the pane header');
    assert(runtime.querySelector('.split-pane-vendor') && runtime.querySelector('.split-view-model'), 'Vendor and model pill are not grouped');
    assert(parseFloat(getComputedStyle(runtime.querySelector('.split-view-model')).borderRadius) >= 8, 'Model is missing its pill');
    var info = header.querySelector('.split-pane-info'), close = header.querySelector('.split-pane-close');
    assert(info.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING, 'Close is not after Info');
    assert(Number(getComputedStyle(close).order) > Number(getComputedStyle(info).order), 'Close is not visually after Info');
    assert(runtime.getBoundingClientRect().bottom <= header.getBoundingClientRect().bottom, 'Model overflows the header');
    assert(runtime.getBoundingClientRect().width >= 20 && pane.querySelector('.split-pane-title').getBoundingClientRect().width >= 40, 'Header controls squeezed out the title or model');
  });
  var socket = getWs(), original = socket.send, intercepted = [];
  // Fence external work while retaining actual product panel actions and UI.
  socket.send = function (data) {
    var msg = JSON.parse(data);
    if (/^(term_|shared_browser_)/.test(msg.type)) { intercepted.push(msg.type); return; }
    if (msg.type === 'fs_read') {
      queueMicrotask(function () { handleFsRead(Object.assign({}, msg, { type: 'fs_read', content: 'Overlay fixture', size: 15 })); });
      return;
    }
    return original.call(socket, data);
  };
  var checks = [];
  try {
    var entries = [
      { id: 'terminal-container', open: openTerminal, close: closeTerminal, full: '#terminal-fullscreen' },
      { id: 'shared-browser-panel', open: openSharedBrowser, close: hideSharedBrowser, wide: '[data-action="wide"]', full: '[data-action="fullscreen"]' },
      { id: 'file-viewer', open: function () { openFile('overlay.txt'); }, close: closeFileViewer, full: '#file-viewer-fullscreen' },
      { id: 'project-logs-panel', open: openProjectLogs, close: closeProjectLogs, wide: '#project-logs-wide', full: '#project-logs-fullscreen' }
    ];
    for (var entry of entries) {
      entry.open(); await settle();
      var panel = document.getElementById(entry.id);
      await waitFor(function () { return (store.get('workbenchLayoutPreference') || {}).ready; }, 'Workbench preference');
      if (store.get('workbenchLayoutPreference').mode === 'docked') {
        panel.querySelector('.workbench-layout-toggle').click();
        await waitFor(function () { return store.get('workbenchLayoutPreference').mode === 'overlay' && !store.get('workbenchLayoutPreference').saving; }, 'Initial overlay mode');
        await settle();
      }
      assert(panel && !panel.classList.contains('hidden') && getComputedStyle(panel).position === 'absolute', entry.id + ' did not open as an overlay');
      function unchanged(phase) {
        assert(JSON.stringify(measurements()) === before, entry.id + ' changed pane geometry during ' + phase);
        assert(JSON.stringify(store.get('projectSplitViews')) === saved, entry.id + ' changed saved layout');
        panes.forEach(function (pane, index) { assert(pane.querySelector('iframe').contentDocument === documents[index], 'Workbench replaced a conversation'); });
      }
      unchanged('open');
      var r = panel.getBoundingClientRect();
      assert(panel.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)), entry.id + ' is below the conversation');
      if (entry.wide) { panel.querySelector(entry.wide).click(); await settle(); unchanged('wide'); }
      panel.querySelector(entry.full).click(); await settle(); unchanged('fullscreen');
      assert(panel.classList.contains('panel-fullscreen'), entry.id + ' did not expand');
      panel.querySelector(entry.full).click(); await settle(); unchanged('restore');
      var toggle = panel.querySelector('.workbench-layout-toggle');
      assert(toggle && !toggle.disabled, entry.id + ' is missing the layout toggle');
      toggle.click();
      await waitFor(function () { return store.get('workbenchLayoutPreference').mode === 'docked' && !store.get('workbenchLayoutPreference').saving; }, 'Dock persistence');
      await settle();
      assert(getComputedStyle(panel).position === 'relative' && JSON.stringify(measurements()) !== before, entry.id + ' did not reserve docked space: ' + JSON.stringify({ position: getComputedStyle(panel).position, mode: document.getElementById('main-panels').dataset.workbenchMode, before: before, after: measurements() }));
      assert(JSON.stringify(store.get('projectSplitViews')) === saved, 'Dock mode changed saved pane arrangement');
      panes.forEach(function (pane, index) { assert(pane.querySelector('iframe').contentDocument === documents[index], 'Dock mode replaced a conversation'); });
      entry.close(); await settle(); unchanged('docked close');
      entry.open(); await settle();
      assert(store.get('workbenchLayoutPreference').mode === 'docked' && getComputedStyle(panel).position === 'relative', 'Dock preference was lost between opens');
      panel.querySelector('.workbench-layout-toggle').click();
      await waitFor(function () { return store.get('workbenchLayoutPreference').mode === 'overlay' && !store.get('workbenchLayoutPreference').saving; }, 'Overlay persistence');
      await settle(); unchanged('float');
      entry.close(); await settle(); unchanged('close');
      checks.push(entry.id);
    }
    return { verified: true, paneCount: panes.length, headerModel: true, overlays: checks, fencedTransports: intercepted };
  } finally { closeTerminal(); hideSharedBrowser(); closeFileViewer(); closeProjectLogs(); socket.send = original; }
}
var panel = document.createElement('aside'); panel.setAttribute('aria-label', 'Workbench overlay fixture');
panel.style.cssText = 'position:fixed;bottom:12px;left:80px;z-index:99999;width:260px;max-height:280px;overflow:auto;background:#f5f3ee;color:#252525;padding:8px;font:12px sans-serif';
var button = document.createElement('button'); button.textContent = 'Verify workbench overlays';
var output = document.createElement('pre'); output.setAttribute('role', 'status'); output.style.whiteSpace = 'pre-wrap';
button.addEventListener('click', async function () {
  button.disabled = true; output.textContent = 'Checking…';
  try { output.textContent = JSON.stringify(await verify(), null, 2); }
  catch (error) { output.textContent = JSON.stringify({ error: error.message }); }
  button.disabled = false;
});
var summary = document.createElement('button'); summary.textContent = 'Show startup summary';
summary.addEventListener('click', function () {
  var result = window.splitViewProductionCheckResult;
  if (!result) { output.textContent = 'Run the Split view checks first.'; return; }
  var documents = {}, phases = {};
  (result.startupSamples || []).forEach(function (sample) {
    if (!phases[sample.panes]) phases[sample.panes] = { panes: sample.panes, reused: sample.frames.filter(function (frame) { return frame.documentReusedSinceSample; }).length };
    sample.frames.forEach(function (frame) {
      if (frame.documentId && (!documents[frame.documentId] || frame.resourceCount > documents[frame.documentId].resources || !documents[frame.documentId].bootstrapMs)) documents[frame.documentId] = { id: frame.documentId, bootstrapMs: frame.bootstrap && Math.round(frame.bootstrap.domContentLoaded), resources: frame.resourceCount, transferredBytes: frame.transferredBytes };
    });
  });
  var times = (result.serverActivationTimings || []).filter(function (item) { return typeof item.snapshotMs === 'number'; }).map(function (item) { return item.snapshotMs; }).sort(function (a, b) { return a - b; });
  var verbose = document.querySelector('aside[aria-label="Split view production fixture"] pre'); if (verbose) verbose.hidden = true;
  output.textContent = JSON.stringify({ checks: result.checks.length, errors: result.errors, documents: Object.values(documents), phases: Object.values(phases), serverSnapshotMs: times.length ? { min: times[0], median: times[Math.floor(times.length / 2)], max: times[times.length - 1] } : null }, null, 2);
});
panel.append(button, summary, output); document.body.appendChild(panel);
// Auxiliary test controls must not cover real sidebar drop targets.
document.addEventListener('click', function (event) {
  var run = event.target.closest('aside[aria-label="Split view production fixture"] button');
  if (!run || run.textContent !== 'Run Split view checks') return;
  panel.hidden = true;
  var observer = new MutationObserver(function () {
    if (!run.disabled) { panel.hidden = false; observer.disconnect(); }
  });
  observer.observe(run, { attributes: true, attributeFilter: ['disabled'] });
}, true);
