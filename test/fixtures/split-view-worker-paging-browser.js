import { getWs } from '/p/reuse/modules/ws-ref.js';
// Runs inside the visible production fixture; never creates another browser.
export async function verifyWorkerPaging(api, popup, total, firstText) {
  var store = api.store, assert = api.assert, waitFor = api.waitFor, delay = api.delay;
  var body = popup.querySelector('.split-view-worker-popover-body');
  function state() { return store.get('splitViewWorkerConversation'); }
  var initial = state(), initialId = initial.requestId;
  assert(initial.hasMore && initial.messages.length < total, 'latest Worker page must be bounded');
  assert(body.scrollHeight - body.clientHeight - body.scrollTop < 3, 'Worker transcript did not open at latest bottom');
  await delay(250);
  assert(state().requestId === initialId, 'opening a scrollable transcript eagerly fetched older pages');
  assert(!Array.from(popup.querySelectorAll('button')).some(function (button) { return button.textContent === 'Load earlier messages'; }), 'paging still depends on an earlier button');
  var details = popup.querySelector('details'); if (details) details.open = true;
  var expandedKey = details && details.closest('article').dataset.recordIndex;
  body.focus();
  var socket = getWs(), originalSend = socket.send, countBeforeError = state().messages.length;
  socket.send = function (raw) {
    var message = JSON.parse(raw);
    if (message.type === 'split_worker_conversation_request') throw new Error('Fixture older-page send failure');
    return originalSend.call(this, raw);
  };
  try { body.scrollTop = 25; body.dispatchEvent(new Event('scroll')); }
  finally { socket.send = originalSend; }
  assert(state().status === 'error' && state().messages.length === countBeforeError, 'page failure discarded readable history');
  assert(popup.textContent.indexOf('could not be sent') >= 0 && popup.textContent.indexOf('Retry loading conversation') >= 0, 'page failure has no readable retry state');
  var failedId = state().requestId;
  // Consume the browser's queued scroll event before checking automatic retries.
  body.scrollTop = body.scrollHeight;
  await delay(250);
  assert(state().requestId === failedId, 'failed paging retried without an intentional near-top action');
  var pages = 0;
  while (state().hasMore && pages < 8) {
    var before = state(), count = before.messages.length;
    body.scrollTop = 25;
    var top = body.getBoundingClientRect().top;
    var anchor = Array.from(body.querySelectorAll('article')).find(function (article) { return article.getBoundingClientRect().bottom > top; });
    var key = anchor && anchor.dataset.recordIndex, bottom = anchor && anchor.getBoundingClientRect().bottom - top;
    body.dispatchEvent(new Event('scroll'));
    var pending = state();
    assert(pending.inFlight && pending.requestId !== before.requestId, 'near-top scroll did not request an older page');
    assert(popup.textContent.indexOf('Loading earlier messages') >= 0, 'loading earlier status is absent');
    for (var repeat = 0; repeat < 5; repeat++) body.dispatchEvent(new Event('scroll'));
    assert(state().requestId === pending.requestId, 'duplicate scroll events created concurrent page requests');
    window.dispatchEvent(new Event('resize'));
    assert(document.getElementById('split-view-worker-popover') === popup && document.activeElement === body, 'resize replaced the popup or focus');
    await waitFor(function () { return state() && !state().inFlight; }, 'progressive Worker page');
    assert(state().status === 'ready' && state().messages.length > count, 'older page failed or lost records');
    var preserved = Array.from(body.querySelectorAll('article')).find(function (article) { return article.dataset.recordIndex === key; });
    assert(preserved && Math.abs(preserved.getBoundingClientRect().bottom - body.getBoundingClientRect().top - bottom) < 4, 'older page moved the visible record');
    assert(document.activeElement === body, 'page delivery stole transcript focus');
    if (expandedKey) assert(Array.from(body.querySelectorAll('article')).some(function (article) { return article.dataset.recordIndex === expandedKey && article.querySelector('details[open]'); }), 'page delivery collapsed an open tool record');
    var settledId = state().requestId;
    await delay(180);
    assert(state().requestId === settledId, 'paging continued without another near-top scroll');
    pages++;
  }
  assert(pages >= 2 && !state().hasMore && state().messages.length === total, 'progressive paging did not reach the exact beginning');
  assert(body.querySelector('article').textContent.indexOf(firstText) >= 0, 'progressive pages reversed message order');
  var endId = state().requestId;
  body.scrollTop = 0; body.dispatchEvent(new Event('scroll')); body.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
  await delay(180);
  assert(state().requestId === endId && popup.textContent.indexOf('Beginning of conversation') >= 0, 'paging did not stop at the beginning');
}
