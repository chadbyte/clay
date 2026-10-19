import { renderMarkdown } from './markdown.js';

// Reassemble bounded record fragments and contiguous streaming deltas before
// parsing Markdown, including fences and lists that cross a page boundary.
export function workerTranscriptRows(messages) {
  var rows = [];
  (messages || []).forEach(function (message) {
    if (!message || typeof message.text !== 'string' || ['user', 'assistant', 'tool'].indexOf(message.role) < 0) return;
    var last = rows[rows.length - 1];
    var fragment = last && Number.isInteger(message.recordIndex) && last.recordIndex === message.recordIndex && last.end === message.start;
    var delta = last && message.recordType === 'delta' && last.recordType === 'delta' && message.start === 0 && message.recordIndex === last.recordIndex + 1;
    if (last && last.role === message.role && (fragment || delta)) {
      last.text += message.text; last.end = message.end; last.recordIndex = message.recordIndex;
    } else rows.push(Object.assign({}, message));
  });
  return rows;
}

export function appendWorkerMessage(body, message) {
  var article = document.createElement('article');
  article.className = 'message worker-readonly-message ' + (message.role === 'user' ? 'msg-user' : message.role === 'tool' ? 'worker-tool-message' : 'msg-assistant');
  if (Number.isInteger(message.recordIndex)) article.dataset.recordIndex = String(message.recordIndex);
  var author = document.createElement('strong'); author.className = 'author';
  author.textContent = message.role === 'user' ? 'You' : message.role === 'tool' ? 'Tool activity' : 'Worker';
  var content = document.createElement('div'); content.className = 'message-body md-content';
  if (message.role === 'tool') {
    var details = document.createElement('details'), summary = document.createElement('summary');
    summary.textContent = message.toolName || message.text;
    if (message.isError) summary.textContent += ' · Failed';
    details.appendChild(summary);
    if (message.recordType === 'tool_result') {
      var output = document.createElement('pre'); output.textContent = message.text; details.appendChild(output);
    }
    content.appendChild(details);
  } else {
    // Recorded HTML must not create controls, scoped overlays or active embeds.
    // Keep the shared Markdown parser and its sanitization, with a narrower
    // read-only prose vocabulary for this secondary history surface.
    content.innerHTML = DOMPurify.sanitize(renderMarkdown(message.text), {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 's', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'wbr'],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'start'], ALLOW_DATA_ATTR: false
    });
  }
  article.append(author, content); body.appendChild(article);
}
