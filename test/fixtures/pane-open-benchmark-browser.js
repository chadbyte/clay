import { checkPaneContextReuse } from '/fixture/pane-context-reuse-browser.js';
import { prepareBenchmarkCohort, openBenchmarkCohort } from '/fixture/pane-benchmark-cohorts.js';
// Authenticated fixture only. Measures production readiness plus visible content
// and an enabled composer for two animation frames. Preparation uses real UI actions.
function messageTimingSummary(pane) {
  var totals = {}, total = 0;
  (pane.messageProcessing || []).forEach(function (record) { totals[record.type] = (totals[record.type] || 0) + record.handlerMs; total += record.handlerMs; });
  var top = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }).slice(0, 4);
  return 'Socket handlers ' + total.toFixed(1) + 'ms: ' + top.map(function (type) { return type + ' ' + totals[type].toFixed(1) + 'ms'; }).join(', ') + (pane.messageTimingOverflow ? ' (record limit reached)' : '');
}
var params = new URLSearchParams(location.search);
var expected = Number(params.get('pane_count')) || 1;
if ([1, 4, 8].indexOf(expected) < 0) expected = 1;
var panel = document.createElement('details'); panel.id = 'pane-open-benchmark'; panel.open = true;
// Reuse the existing fixture panel placement without changing the app layout.
panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;width:330px;max-height:300px;overflow:auto;padding:9px;background:#f5f3ee;color:#252525;border:1px solid #9c9a94;border-radius:8px;font:12px sans-serif';
var title = document.createElement('summary'); title.textContent = 'Pane opening benchmark'; panel.appendChild(title);
var button = document.createElement('button'); button.textContent = 'Measure next view click (' + expected + ' panes)'; panel.appendChild(button);
var output = document.createElement('pre'); output.setAttribute('aria-live', 'polite'); panel.appendChild(output);
var reuseCheck = document.createElement('button'); reuseCheck.textContent = 'Verify warm 8 → 1 → 8'; panel.appendChild(reuseCheck);
reuseCheck.addEventListener('click', function () {
  reuseCheck.disabled = true;
  checkPaneContextReuse().then(function (result) { output.textContent = JSON.stringify(result, null, 2); }, function (error) { output.textContent = error.message; }).finally(function () { reuseCheck.disabled = false; });
});

document.body.prepend(panel);
var preparationControls = [button];
function selectCount(count) {
  expected = count; button.textContent = 'Measure next view click (' + count + ' panes)';
  var url = new URL(location.href); url.searchParams.set('pane_count', String(count)); history.replaceState(null, '', url);
}
[1, 4, 8].forEach(function (count) {
  var prepare = document.createElement('button'); prepare.textContent = 'Prepare ' + count + '-pane cohort'; panel.appendChild(prepare); preparationControls.push(prepare);
  prepare.addEventListener('click', async function () {
    run = null; armed = false; preparationControls.forEach(function (control) { control.disabled = true; }); output.textContent = 'Preparing ' + count + '-pane cohort…';
    try {
      await prepareBenchmarkCohort(count); selectCount(count);
      output.textContent = 'Prepared ' + count + ' panes. Reload to measure document startup, or use Open to measure a view action. Preparation is not a cold sample.';
    } catch (error) { output.textContent = error.message + '\n' + startupDiagnostics(); }
    finally { preparationControls.forEach(function (control) { control.disabled = false; }); }
  });
  var open = document.createElement('button'); open.textContent = 'Open ' + count + '-pane cohort'; panel.appendChild(open); preparationControls.push(open);
  open.addEventListener('click', function () {
    expected = count; armed = true; button.textContent = 'Measure next view click (' + count + ' panes)';
    try { openBenchmarkCohort(count); selectCount(count); } catch (error) { armed = false; output.textContent = error.message; }
  });
});
var reload = document.createElement('button'); reload.textContent = 'Reload prepared cohort'; panel.appendChild(reload);
reload.addEventListener('click', function () { location.reload(); }); preparationControls.push(reload);
panel.appendChild(output);
var previousSummary = '', armed = false, run = null;
var diagnostics = document.createElement('button'); diagnostics.textContent = 'Show startup diagnostics'; panel.appendChild(diagnostics);
diagnostics.addEventListener('click', function () { output.textContent = startupDiagnostics(); });
function startupDiagnostics() {
  var documents = [{ label: 'parent', win: window, doc: document }];
  frames().slice(0, 8).forEach(function (frame, index) {
    try { documents.push({ label: 'pane ' + (index + 1), win: frame.contentWindow, doc: frame.contentDocument }); } catch (error) {}
  });
  return documents.map(function (entry) {
    var win = entry.win, errors = win && win.__paneFixtureErrors || [];
    return entry.label + ': ' + (entry.doc && entry.doc.readyState || 'pending') + '; marked=' + !!(win && win.marked) + '; DOMPurify=' + !!(win && win.DOMPurify) + '\n' +
      (errors.length ? errors.map(function (error) { return error.at + 'ms ' + error.kind + ': ' + error.message + ' ' + error.source + ':' + error.line; }).join('\n') : 'No captured errors');
  }).join('\n');
}

function frames() { return Array.from(document.querySelectorAll('#split-host > .split-pane:not([hidden]) .split-pane-frame')); }
function start(label, at) {
  var existingDocuments = new WeakSet();
  if (label === 'sidebar action') frames().forEach(function (frame) { if (frame.contentDocument) existingDocuments.add(frame.contentDocument); });
  run = { label: label, start: at, samples: new Map(), stable: 0, existingDocuments: existingDocuments };
  output.textContent = label + ': waiting for ' + expected + ' visible, interactive panes…';
  var scheduled = run; requestAnimationFrame(function () { if (run === scheduled) sample(); });
}
function sample() {
  if (!run) return;
  var now = performance.now(), mounted = frames(), ready = mounted.length === expected;
  mounted.forEach(function (frame) {
    var entry = run.samples.get(frame);
    if (!entry) { entry = { origin: frame.dataset.sessionOriginId, firstContentMs: null }; run.samples.set(frame, entry); }
    try {
      var doc = frame.contentDocument, win = frame.contentWindow, api = frame.clayPane;
      var identity = api && api.document === doc && api.source === win && api.identity();
      var messages = doc && doc.getElementById('messages'), input = doc && doc.getElementById('input');
      var content = messages && messages.textContent.trim().length > 0 && messages.getBoundingClientRect().height > 0 && messages.getBoundingClientRect().width > 0;
      var composer = input && !input.disabled && !input.readOnly && !input.closest('[inert]') && input.getBoundingClientRect().height > 0 && input.getBoundingClientRect().width > 0;
      var bound = identity && identity.ready && identity.binding.sessionOriginId === frame.dataset.sessionOriginId &&
        messages && messages.dataset.controlSessionOrigin === frame.dataset.sessionOriginId;
      if (content && messages.dataset.controlSessionOrigin === frame.dataset.sessionOriginId && entry.firstContentMs === null) entry.firstContentMs = Math.round(now - run.start);
      if (!(bound && content && composer)) ready = false;
      entry.documentReused = run.existingDocuments.has(doc);
      entry.document = doc;
      entry.window = win;
    } catch (error) { ready = false; entry.error = error.message; }
  });
  var signature = mounted.map(function (frame) { var identity = frame.clayPane && frame.clayPane.identity(); return frame.dataset.sessionOriginId + ':' + (identity && identity.binding.generation); }).join('|');
  run.stable = ready ? (run.signature === signature ? run.stable + 1 : 1) : 0;
  run.signature = signature;
  if (run.stable >= 2 || now - run.start > 30000) {
    var result = { label: run.label, expectedPanes: expected, observedPanes: mounted.length,
      allInteractiveMs: run.stable >= 2 ? Math.round(now - run.start) : null, deadlineExceeded: run.stable < 2,
      targetUnderOneSecond: run.stable >= 2 && now - run.start < 1000, panes: [] };
    mounted.forEach(function (frame) {
      var entry = run.samples.get(frame), perf = entry.window && entry.window.performance;
      var resources = perf ? perf.getEntriesByType('resource') : [], navigation = perf && perf.getEntriesByType('navigation')[0];
      var marks = {};
      if (perf) perf.getEntriesByType('mark').filter(function (mark) { return mark.name.indexOf('clay:') === 0; }).forEach(function (mark) {
        marks[mark.name] = Math.round(perf.timeOrigin + mark.startTime - performance.timeOrigin - run.start);
      });
      if (navigation && perf) {
        marks['document-response'] = Math.round(perf.timeOrigin + navigation.responseEnd - performance.timeOrigin - run.start);
        if (navigation.domContentLoadedEventEnd) marks.DOMContentLoaded = Math.round(perf.timeOrigin + navigation.domContentLoadedEventEnd - performance.timeOrigin - run.start);
      }
      result.panes.push({ origin: entry.origin, reusedDocument: entry.documentReused, firstContentMs: entry.firstContentMs,
        messageProcessing: (entry.window && entry.window.__paneFixtureMessageTiming || []).filter(function (record) {
          return perf && perf.timeOrigin + record.startMs >= performance.timeOrigin + run.start;
        }).map(function (record) { return { type: record.type, startFromActionMs: Math.round(perf.timeOrigin + record.startMs - performance.timeOrigin - run.start), handlerMs: Math.round(record.durationMs * 100) / 100 }; }),
        messageTimingOverflow: !!(entry.window && entry.window.__paneFixtureMessageTimingOverflow),
        resourceCount: resources.length, resourceTimingOverflow: !!(entry.window && entry.window.__paneFixtureTimingOverflow),
        entriesWithReportedTransfer: resources.filter(function (resource) { return resource.transferSize > 0; }).length,
        entriesWithoutReportedTransfer: resources.filter(function (resource) { return !resource.transferSize; }).length, transferredBytes: resources.reduce(function (sum, resource) { return sum + resource.transferSize; }, 0),
        documentDOMContentLoadedMs: navigation && Math.round(navigation.domContentLoadedEventEnd), stagesFromActionMs: marks, error: entry.error });
    });
    // Reused-document resource counts are cumulative, not new requests for this action.
    result.resourceCountsAreDocumentLifetime = true;
    result.measurementLimits = 'Resource entries include cache hits; zero transferSize can mean cache or unavailable cross-origin timing. Reported bytes are not total network bytes. Stage times are elapsed wall time, not CPU time. messageProcessing measures synchronous socket-handler elapsed time, including nested replay, not asynchronous work or browser paint; reused-document records are bounded and may overflow.';
    var summary = result.label + ': ' + (result.allInteractiveMs === null ? '30s deadline exceeded' : result.allInteractiveMs + 'ms, target ' + (result.targetUnderOneSecond ? 'PASS' : 'MISS')) + '\n' + result.panes.map(function (pane, index) { return (index + 1) + ': content ' + pane.firstContentMs + 'ms; ' + (pane.reusedDocument ? 'reused' : 'new') + ' document; ' + pane.resourceCount + ' resource records' + (pane.resourceTimingOverflow ? ' (OVERFLOW)' : '') + '; ' + pane.transferredBytes + ' reported transfer bytes\n  ' + Object.keys(pane.stagesFromActionMs).map(function (key) { return key.replace('clay:', '') + ':' + (pane.stagesFromActionMs[key] < 0 ? 'before-action' : pane.stagesFromActionMs[key] + 'ms'); }).join(' ') + '\n  ' + messageTimingSummary(pane); }).join('\n') + '\nFull stage timings: window.paneOpenBenchmarkResult'; output.textContent = (previousSummary ? 'Previous: ' + previousSummary + '\n' : '') + summary + '\n' + startupDiagnostics(); previousSummary = result.label + ' ' + result.allInteractiveMs + 'ms (' + result.observedPanes + ' panes)'; window.paneOpenBenchmarkResult = result; run = null; return;
  }
  var scheduled = run; requestAnimationFrame(function () { if (run === scheduled) sample(); });
}
button.addEventListener('click', function () { armed = true; output.textContent = 'Armed: click the saved view or session in the sidebar.'; });
window.addEventListener('click', function (event) {
  if (!armed || panel.contains(event.target)) return;
  if (!event.target.closest('.session-item, .split-view-group')) return;
  armed = false; start('sidebar action', performance.now());
}, true);
if ([1, 4, 8].indexOf(Number(params.get('pane_count'))) >= 0) start('full document navigation', 0);
else output.textContent = 'Choose Prepare 1, 4 or 8, then reload the prepared cohort. Preparation is not a cold sample.';
