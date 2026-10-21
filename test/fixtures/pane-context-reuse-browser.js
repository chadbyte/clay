import { store } from '/p/reuse/modules/store.js';
import { getWs } from '/p/reuse/modules/ws-ref.js';
import { openBenchmarkCohort } from '/fixture/pane-benchmark-cohorts.js';

// Explicit fixture button only; never sends a chat/provider request.
export async function checkPaneContextReuse() {
  var initial = store.snap(), socket = getWs();
  function current() {
    var state = store.snap();
    return state.connected && getWs() === socket && state.currentSlug === initial.currentSlug && state.myUserId === initial.myUserId &&
      state.projectSplitViewSocketGeneration === initial.projectSplitViewSocketGeneration;
  }
  function frames() { return Array.from(document.querySelectorAll('#split-host > .split-pane > .split-pane-frame')); }
  function ready(count) {
    var mounted = frames();
    return mounted.length === count && mounted.every(function (frame) {
      var api = frame.clayPane, live = api && api.identity(), doc = frame.contentDocument;
      var input = doc && doc.getElementById('input'), messages = doc && doc.getElementById('messages');
      return live && live.ready && live.binding && live.binding.sessionOriginId === frame.dataset.sessionOriginId && api.document === doc && api.source === frame.contentWindow && input && !input.disabled &&
        messages && messages.dataset.controlSessionOrigin === live.binding.sessionOriginId && input.getBoundingClientRect().width > 0;
    });
  }
  function wait(count) {
    var start = performance.now(), stable = 0;
    return new Promise(function (resolve, reject) {
      function tick() {
        if (!current()) { reject(new Error('Authenticated fixture context changed.')); return; }
        stable = ready(count) ? stable + 1 : 0;
        if (stable >= 2) { resolve(); return; }
        if (performance.now() - start > 30000) { reject(new Error('Pane readiness exceeded 30 seconds.')); return; }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }
  if (!ready(8)) throw new Error('Prepare and open the eight-pane benchmark cohort first.');
  var original = frames().map(function (frame) {
    var messages = frame.contentDocument.getElementById('messages'), binding = frame.clayPane.identity().binding;
    return { frame: frame, document: frame.contentDocument, source: frame.contentWindow, src: frame.src,
      origin: binding.sessionOriginId, generation: binding.generation, transcript: messages.textContent, children: messages.childElementCount };
  });
  var probe = original[7], input = probe.document.getElementById('input'), messages = probe.document.getElementById('messages');
  if (input.value) throw new Error('The fixture probe composer must be empty; existing drafts are never replaced.');
  var text = 'Unsent retained fixture draft'; input.value = text; input.dispatchEvent(new probe.source.Event('input', { bubbles: true })); input.setSelectionRange(3, 11);
  messages.scrollTop = Math.min(120, Math.max(0, messages.scrollHeight - messages.clientHeight));
  var top = messages.scrollTop;
  openBenchmarkCohort(1); await wait(1);
  var cached = Array.from(document.querySelectorAll('#split-host > .split-pane-cached'));
  if (cached.length !== 7 || !cached.every(function (node) { return node.hidden && node.inert && node.style.display === 'none' && !node.querySelector('iframe').clayPane.identity().ready; })) throw new Error('Cached panes were not suspended and hidden.');
  var start = performance.now(); openBenchmarkCohort(8); await wait(8);
  var elapsed = performance.now() - start;
  var stableContexts = original.every(function (entry) { return entry.frame.isConnected && entry.frame.contentDocument === entry.document && entry.frame.contentWindow === entry.source && entry.frame.src === entry.src; });
  var transcripts = original.map(function (entry) {
    var live = entry.frame.clayPane.identity(), messages = entry.frame.contentDocument.getElementById('messages');
    return { origin: entry.origin, charactersBefore: entry.transcript.length, charactersAfter: messages.textContent.length,
      childrenBefore: entry.children, childrenAfter: messages.childElementCount,
      preserved: entry.transcript === messages.textContent && entry.children === messages.childElementCount,
      freshlyActivated: live.binding.sessionOriginId === entry.origin && live.binding.generation > entry.generation };
  });
  var historyPreserved = transcripts.every(function (entry) { return entry.preserved && entry.freshlyActivated; });
  var sameDraft = input.value === text && input.selectionStart === 3 && input.selectionEnd === 11;
  var sameScroll = Math.abs(messages.scrollTop - top) <= 1;
  var result = { contextsPreserved: stableContexts, historiesPreserved: historyPreserved, transcripts: transcripts, draftAndSelectionPreserved: sameDraft, scrollPreserved: sameScroll,
    scrollTestedAboveBottom: top < messages.scrollHeight - messages.clientHeight, warmReopenMs: Math.round(elapsed), underOneSecond: elapsed < 1000, activePanes: frames().length };
  window.paneContextReuseResult = result;
  if (!stableContexts || !historyPreserved || !sameDraft || !sameScroll) throw new Error('Context retention check failed: ' + JSON.stringify(result));
  return result;
}
