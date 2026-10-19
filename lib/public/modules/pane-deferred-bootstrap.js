import { store } from './store.js';

// Executable initializers belong to this module; the store holds only IDs.
var initializers = [];

// Parent-owned workbench chrome is unnecessary for a pane's first transcript.
// Keep the same initializers, but run them one task at a time after its exact
// authenticated activation has made the conversation interactive.
function drain() {
  var state = store.snap(), boot = state.paneDeferredBootstrap;
  if (!boot || boot.scheduled || !boot.jobs.length || !state.connected || !state.paneReady || state.paneSuspended) return;
  store.set({ paneDeferredBootstrap: Object.assign({}, boot, { scheduled: true }) });
  setTimeout(function () {
    var latest = store.snap(), pending = latest.paneDeferredBootstrap;
    if (!pending) return;
    var jobs = pending.jobs.slice(), job = latest.connected && latest.paneReady && !latest.paneSuspended ? jobs.shift() : null;
    store.set({ paneDeferredBootstrap: Object.assign({}, pending, { scheduled: false, jobs: jobs }) });
    try { if (job !== null && initializers[job]) { var initialize = initializers[job]; initializers[job] = null; initialize(); } } finally { drain(); }
  }, 0);
}
export function initializeAfterPaneReady(jobs) {
  if (!store.get('paneMode')) { jobs.forEach(function (job) { job(); }); return; }
  var boot = store.get('paneDeferredBootstrap');
  if (!boot) {
    boot = { jobs: [], scheduled: false };
    store.subscribe(function (next, previous) {
      if (next.paneReady !== previous.paneReady || next.connected !== previous.connected || next.paneSuspended !== previous.paneSuspended) drain();
    });
  }
  store.set({ paneDeferredBootstrap: Object.assign({}, boot, { jobs: boot.jobs.concat(jobs.map(function (job) { var id = initializers.length; initializers.push(job); return id; })) }) });
  drain();
}
