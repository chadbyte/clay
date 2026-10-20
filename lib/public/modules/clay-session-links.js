import { parseClaySessionReference, renderClaySessionLink } from './clay-log-links.js';

// The prefix is a display compatibility label, never a navigation target.
var citationPattern = /\[([A-Za-z0-9][A-Za-z0-9_-]{0,79})\/(session:[A-Za-z0-9_-]{24}(?:#entry-[0-9]+)?)(?:\s+[\u2014\u00b7-]\s+([^\]\n]{1,80}))?\]/g;
function matches(text) {
  var pattern = new RegExp(citationPattern.source, 'g'), results = [], match;
  while ((match = pattern.exec(text))) if (parseClaySessionReference(match[2])) results.push({ start: match.index, end: pattern.lastIndex, prefix: match[1], ref: match[2], label: match[3] || '' });
  return results;
}
function button(match) {
  var template = document.createElement('template');
  template.innerHTML = renderClaySessionLink(match.ref, match.label);
  return template.content.firstElementChild;
}
export function enhanceSessionCitations(root) {
  // Historical assistants sometimes wrapped a whole project-labelled citation
  // in inline code. Only that complete legacy token is a compatibility citation.
  // Canonical code samples, mixed inline code and all fenced code stay literal.
  if (root.closest('.msg-assistant')) root.querySelectorAll('code').forEach(function (code) {
    if (code.closest('pre, a, button')) return;
    var text = code.textContent || '', found = matches(text);
    if (found.length === 1 && found[0].prefix !== 'clayos' && found[0].start === 0 && found[0].end === text.length) code.replaceWith(button(found[0]));
  });
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], node;
  while ((node = walker.nextNode())) if (node.parentElement && !node.parentElement.closest('code, pre, a, button') && matches(node.nodeValue || '').length) nodes.push(node);
  nodes.forEach(function (node) {
    var text = node.nodeValue || '', fragment = document.createDocumentFragment(), offset = 0;
    matches(text).forEach(function (match) { fragment.appendChild(document.createTextNode(text.slice(offset, match.start))); fragment.appendChild(button(match)); offset = match.end; });
    fragment.appendChild(document.createTextNode(text.slice(offset))); node.replaceWith(fragment);
  });
}
