import { filePaneState, updateFilePaneState, repaintFilePane } from './file-pane-instances.js';
import { renderSplitDiff, renderUnifiedDiff } from './diff.js';
import { renderCodeWithLineNumbers, mapExtToLanguage } from './file-viewer-source.js';

var callbacks = new Map();
export function bindFileReview(state, review) {
  if (review) callbacks.set(state.instanceId, { requestId: state.requestId, context: state.context, review: review });
  else callbacks.delete(state.instanceId);
}
export function releaseFileReview(id) { callbacks.delete(id); }
export function paintFileReview(body, state) {
  var bar = document.createElement('div'); bar.className = 'file-history-view-bar';
  var receipt = callbacks.get(state.instanceId);
  function current() { var live = filePaneState(state.instanceId); return live && live.requestId === state.requestId && live.context === state.context; }
  function button(label, callback) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = !callback; b.addEventListener('click', function () { if (current() && callback) callback(); }); bar.appendChild(b); }
  button('Back to file', function () { updateFilePaneState(state.instanceId, { diff: null }); repaintFilePane(state.instanceId); });
  ['Split', 'Unified', 'Source'].forEach(function (mode) { button(mode, function () { updateFilePaneState(state.instanceId, { reviewMode: mode.toLowerCase() }); repaintFilePane(state.instanceId); }); });
  if (receipt && receipt.requestId === state.requestId && receipt.context === state.context) {
    var review = receipt.review, label = document.createElement('span'); label.textContent = (review.index + 1) + ' of ' + review.total; bar.appendChild(label);
    button('Previous file', review.previous); button('Next file', review.next); if (review.askAgent) button('Ask agent', review.askAgent);
  }
  body.appendChild(bar);
  var content = document.createElement('div'), ext = state.resource.path.split('.').pop(); body.appendChild(content);
  if (state.reviewMode === 'source') renderCodeWithLineNumbers(content, state.diff.newStr || '', ext);
  else content.appendChild((state.reviewMode === 'unified' ? renderUnifiedDiff : renderSplitDiff)(state.diff.oldStr || '', state.diff.newStr || '', mapExtToLanguage(ext)));
}
