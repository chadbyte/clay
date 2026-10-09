function applyTarget(element, link) {
  if (link.documentKey) {
    element.dataset.openDocument = link.documentKey;
    if (link.heading) element.dataset.openHeading = link.heading;
  } else if (link.self && link.heading) element.dataset.outlineHeading = link.heading;
  else if (link.unresolved && link.target) element.dataset.createLinked = link.target;
}

function decode(value) {
  try { return decodeURIComponent(value); } catch (error) { return value; }
}

function normalizedTarget(value) {
  return decode(String(value || '').trim().replace(/^<|>$/g, '')).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function renderedTarget(element) {
  if (element.matches('button.clay-file-link')) return normalizedTarget(element.dataset.filePath);
  return normalizedTarget(element.getAttribute('href'));
}

function matchingLink(element, links, used) {
  var actual = renderedTarget(element);
  if (element.matches('a') && actual.charAt(0) !== '#') return null;
  for (var i = 0; i < links.length; i++) {
    if (used[i] || normalizedTarget(links[i].target + (links[i].heading ? '#' + links[i].heading : '')) !== actual && normalizedTarget(links[i].target) !== actual) continue;
    used[i] = true; return links[i];
  }
  return null;
}

function decorateAnchors(root, outgoing) {
  var links = outgoing.filter(function (item) { return item.kind === 'markdown' && !item.external; }); var anchors = root.querySelectorAll('a[href], button.clay-file-link'); var used = [];
  for (var i = 0; i < anchors.length; i++) {
    var link = matchingLink(anchors[i], links, used); if (!link) continue;
    anchors[i].classList.remove('clay-file-link'); delete anchors[i].dataset.filePath; delete anchors[i].dataset.fileProjectSlug; delete anchors[i].dataset.fileSessionId;
    anchors[i].removeAttribute('title'); anchors[i].setAttribute('aria-label', 'Open Knowledge document ' + (link.label || link.target || 'link'));
    applyTarget(anchors[i], link); anchors[i].classList.add('knowledge-inline-link');
    if (link.documentKey || link.self || link.unresolved) anchors[i].removeAttribute('href');
  }
}

function safeExternalTarget(value) {
  var target = String(value || '').trim();
  return /^(?:https?:|mailto:|tel:)/i.test(target) ? target : null;
}

function decorateWiki(root, outgoing) {
  var links = outgoing.filter(function (item) { return item.kind === 'wiki' || item.kind === 'embed'; }); if (!links.length) return;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); var nodes = []; var node;
  while ((node = walker.nextNode())) if (node.parentElement && !node.parentElement.closest('code, pre, a, button')) nodes.push(node);
  var linkAt = 0;
  for (var n = 0; n < nodes.length && linkAt < links.length; n++) {
    var text = nodes[n].nodeValue || ''; var fragment = document.createDocumentFragment(); var offset = 0; var changed = false;
    while (linkAt < links.length) {
      var link = links[linkAt]; var at = text.indexOf(link.raw, offset); if (at === -1) break;
      fragment.appendChild(document.createTextNode(text.slice(offset, at))); var button;
      if (link.external && safeExternalTarget(link.target)) { button = document.createElement('a'); button.href = safeExternalTarget(link.target); button.target = '_blank'; button.rel = 'noopener noreferrer'; }
      else if (link.external) { button = document.createElement('span'); }
      else { button = document.createElement('button'); button.type = 'button'; applyTarget(button, link); }
      button.className = 'knowledge-inline-link'; button.textContent = link.label || link.target || link.heading; fragment.appendChild(button);
      offset = at + link.raw.length; linkAt++; changed = true;
    }
    if (changed) { fragment.appendChild(document.createTextNode(text.slice(offset))); nodes[n].parentNode.replaceChild(fragment, nodes[n]); }
  }
}

export function decorateKnowledgePreview(root, outgoing) {
  if (!root) return; decorateAnchors(root, outgoing || []); decorateWiki(root, outgoing || []);
}
