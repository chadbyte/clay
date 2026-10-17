// Fixture-only controls exercise the real sidebar and authenticated pane path.
import { store } from '/p/reuse/modules/store.js';
import { openGroup } from '/p/reuse/modules/split-view.js';
function wait(check) {
  var start = performance.now();
  return new Promise(function (resolve, reject) {
    function inspect() {
      if (check()) { resolve(); return; }
      if (performance.now() - start > 15000) { reject(new Error('Pane readiness deadline exceeded')); return; }
      requestAnimationFrame(inspect);
    }
    inspect();
  });
}
function ready(group) {
  var host = document.getElementById('split-host');
  if (!host || !host.classList.contains('visible')) return false;
  var frames = Array.from(host.querySelectorAll('.split-pane-frame'));
  return frames.length === 2 && group.members.every(function (id) {
    var frame = frames.find(function (item) { return Number(item.dataset.sessionId) === id; });
    var state = frame && frame.clayPane && frame.clayPane.identity();
    if (!state || !state.ready || state.sessionId !== id || frame.dataset.requestedSessionId || frame.getBoundingClientRect().width < 1) return false;
    var doc = frame.contentDocument, messages = doc.getElementById('messages'), input = doc.getElementById('input');
    if (doc.getElementById('app').inert || messages.dataset.controlSessionId !== String(id) || !messages.textContent.includes('EXACT_TRANSCRIPT_' + id)) return false;
    return id === group.pair.driverId ? !input.disabled && !input.readOnly : doc.body.classList.contains('worker-pane-locked');
  });
}
function statistics(samples) {
  var sorted = samples.map(function (sample) { return sample.ms; }).sort(function (a, b) { return a - b; });
  return { samples: samples, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted[sorted.length - 1] };
}
function verifyHistory(group, data) {
  group.members.forEach(function (id) {
    var frame = document.querySelector('#split-host .split-pane-frame[data-session-id="' + id + '"]');
    var messages = frame.contentDocument.getElementById('messages');
    var indexes = new Set();
    messages.querySelectorAll('[data-history-indexes]').forEach(function (el) {
      el.dataset.historyIndexes.split(',').forEach(function (index) { indexes.add(Number(index)); });
    });
    var from = data.benchmark === 'long-turn' ? 0 : 350;
    var title = (id === group.pair.driverId ? 'Driver ' : 'Worker ') + data.groups.indexOf(group);
    var text = messages.textContent;
    for (var i = from; i < data.historySize; i++) {
      if (!indexes.has(i) || !text.includes('Saved ' + title + ' entry ' + i + '.')) throw new Error('Missing original history entry ' + id + ':' + i);
    }
    if (!indexes.has(data.historySize)) throw new Error('Missing final transcript marker index');
  });
}
var benchmarkStarted = false;
window.runPaneReuseBench = async function () {
  if (benchmarkStarted) throw new Error('Reload the fixture before measuring genuine first visits again');
  benchmarkStarted = true;
  var data = await (await fetch('/fixture/state')).json();
  if (data.groups.length < 33) throw new Error('Start fixture with CLAY_PANE_BENCH=normal or long-turn for 30 genuine first visits');
  await wait(function () { return store.get('connected') && store.get('splitGroupsProjectSlug') === 'reuse'; });
  var coldStart = performance.now();
  openGroup(data.groups[0]); await wait(function () { return ready(data.groups[0]); });
  var result = { benchmark: data.benchmark, coldGroupMs: performance.now() - coldStart, historySize: data.historySize };
  var frames = Array.from(document.querySelectorAll('#split-host .split-pane-frame'));
  var docs = frames.map(function (frame) { return frame.contentDocument; });
  for (var cohort of ['firstVisit', 'cached']) {
    var samples = [];
    for (var i = 3; i < 33; i++) {
      var group = data.groups[i];
      var row = document.querySelector('.session-item[data-session-id="' + group.pair.driverId + '"]');
      if (!row) throw new Error('Exact Driver row is absent');
      var start = performance.now(); row.click(); await wait(function () { return ready(group); });
      samples.push({ pair: i, ms: Math.round((performance.now() - start) * 100) / 100 });
      var current = Array.from(document.querySelectorAll('#split-host .split-pane-frame'));
      if (current.length !== 2 || current.some(function (frame, index) { return frame !== frames[index] || frame.contentDocument !== docs[index]; })) throw new Error('A switch replaced a pane document');
      verifyHistory(group, data);
    }
    result[cohort] = statistics(samples);
  }
  window.paneReuseBenchResult = result;
  console.log('Pane reuse metrics', JSON.stringify(result));
  return result;
};
if (window.parent === window) {
  var panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Pane performance fixture');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;width:320px;max-height:240px;overflow:auto;padding:8px;background:var(--bg,#f2f2ef);color:var(--text,#171717);border:1px solid #888;border-radius:8px;font:12px sans-serif';
  var button = document.createElement('button'); button.textContent = 'Run pane benchmark';
  var output = document.createElement('pre'); output.setAttribute('role', 'status'); output.style.whiteSpace = 'pre-wrap'; output.textContent = 'Ready. Uses an isolated fixture; no providers run.';
  button.addEventListener('click', async function () {
    button.disabled = true; output.textContent = 'Running first-visit and cached cohorts…'; delete window.paneReuseBenchResult;
    try { output.textContent = JSON.stringify(await window.runPaneReuseBench(), null, 2); }
    catch (error) { output.textContent = 'Benchmark error: ' + error.message; }
    finally { button.disabled = false; }
  });
  panel.append(button, output); document.body.appendChild(panel);
}
