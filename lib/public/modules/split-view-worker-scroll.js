// Read-only transcript paging and viewport anchors. Request state lives in store.
export function workerCursorKey(cursor) {
  if (cursor == null) return 'latest';
  if (Number.isInteger(cursor) && cursor >= 0) return String(cursor);
  return cursor && Number.isInteger(cursor.index) && cursor.index >= 0 && Number.isInteger(cursor.offset) && cursor.offset >= 0 ? cursor.index + ':' + cursor.offset : null;
}
export function workerCursorAdvances(before, next) {
  if (!next || workerCursorKey(next) === null) return false;
  if (before == null) return true;
  if (Number.isInteger(before)) return next.index < before;
  return next.index < before.index || next.index === before.index && next.offset < before.offset;
}
export function shouldLoadWorkerPage(state, body, intentional) {
  if (!state || !body || state.inFlight || !state.hasMore || state.nextBefore == null || !workerCursorKey(state.nextBefore)) return false;
  if (state.status === 'error' && !intentional) return false;
  if (state.status !== 'ready' && state.status !== 'error') return false;
  return intentional ? body.scrollTop <= 96 : body.clientHeight > 0 && body.scrollHeight <= body.clientHeight + 1;
}
export function captureWorkerAnchor(body) {
  var top = body.getBoundingClientRect().top;
  var article = Array.from(body.querySelectorAll('article[data-record-index]')).find(function (item) { return item.getBoundingClientRect().bottom > top; });
  if (!article) return { scrollTop: body.scrollTop, height: body.scrollHeight };
  var anchor = { index: article.dataset.recordIndex, bottom: article.getBoundingClientRect().bottom - top,
    scrollTop: body.scrollTop, height: body.scrollHeight };
  var content = article.querySelector('.message-body');
  var rect = body.getBoundingClientRect();
  var range = document.caretRangeFromPoint && document.caretRangeFromPoint(rect.left + Math.min(45, rect.width / 2), top + 16);
  if (range && content && content.contains(range.startContainer) && range.startContainer.nodeType === 3) {
    var prefix = document.createRange(); prefix.selectNodeContents(content); prefix.setEnd(range.startContainer, range.startOffset);
    var offset = prefix.toString().length, text = content.textContent;
    var start = Math.max(0, offset - 24), end = Math.min(text.length, offset + 48);
    anchor.text = text.slice(start, end); anchor.offset = offset - start;
    var character = range.cloneRange(); character.setEnd(range.startContainer, Math.min(range.startOffset + 1, range.startContainer.length));
    anchor.y = character.getBoundingClientRect().top - top;
  }
  return anchor;
}
export function restoreWorkerAnchor(body, anchor) {
  if (!anchor) return;
  var article = Array.from(body.querySelectorAll('article[data-record-index]')).find(function (item) { return item.dataset.recordIndex === anchor.index; });
  if (!article) { body.scrollTop = anchor.scrollTop + body.scrollHeight - anchor.height; return; }
  var content = article.querySelector('.message-body');
  var at = content && anchor.text ? content.textContent.lastIndexOf(anchor.text) : -1;
  if (at >= 0 && document.createTreeWalker) {
    var walker = document.createTreeWalker(content, 4), node, offset = at + anchor.offset;
    while ((node = walker.nextNode())) {
      if (offset < node.length) {
        var range = document.createRange(); range.setStart(node, offset); range.setEnd(node, Math.min(offset + 1, node.length));
        body.scrollTop += range.getBoundingClientRect().top - body.getBoundingClientRect().top - anchor.y;
        return;
      }
      offset -= node.length;
    }
  }
  // The last record key remains stable when earlier streaming fragments merge.
  body.scrollTop += article.getBoundingClientRect().bottom - body.getBoundingClientRect().top - anchor.bottom;
}
