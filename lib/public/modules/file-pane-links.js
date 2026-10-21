import { filePaneState, openIndependentFile } from './file-pane-instances.js';
import { localFileTarget } from './clay-file-links.js';

export function resolvePaneLink(base, target) {
  if (target.charAt(0) === '/') return target;
  var parts = base.split('/'); parts.pop();
  var segments = target.split('/');
  for (var i = 0; i < segments.length; i++) {
    if (!segments[i] || segments[i] === '.') continue;
    if (segments[i] === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(segments[i]);
  }
  return parts.join('/');
}
export function bindFilePaneLinks(markdown, state) {
  var counts = {};
  Array.from(markdown.querySelectorAll('h1,h2,h3,h4,h5,h6')).forEach(function (heading) {
    var slug = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/g, '-');
    var count = counts[slug] || 0; counts[slug] = count + 1; heading.dataset.fileHeading = slug + (count ? '-' + count : '');
  });
  markdown.addEventListener('click', function (event) {
    var link = event.target.closest('a, .clay-file-link'); if (!link || !markdown.contains(link)) return;
    var href = link.getAttribute('href'), path = link.dataset.filePath;
    if (href && href.charAt(0) === '#') {
      event.preventDefault(); event.stopPropagation();
      var fragment; try { fragment = decodeURIComponent(href.slice(1)); } catch (e) { return; }
      Array.from(markdown.querySelectorAll('[data-file-heading]')).some(function (heading) { if (heading.dataset.fileHeading !== fragment) return false; heading.scrollIntoView({ block: 'start' }); return true; }); return;
    }
    var target = path ? { path: path, line: Number(link.dataset.fileLine) || null } : localFileTarget(href);
    if (!target) return;
    event.preventDefault(); event.stopPropagation();
    var live = filePaneState(state.instanceId); if (!live || live.requestId !== state.requestId) return;
    var resolved = resolvePaneLink(state.resource.path, target.path);
    if (resolved) openIndependentFile(resolved, { line: target.line, heading: link.dataset.fileHeading || null });
  });
}

export function scrollFileHeading(markdown, heading) {
  if (!heading) return;
  Array.from(markdown.querySelectorAll('[data-file-heading]')).some(function (element) { if (!/^H[1-6]$/.test(element.tagName) || element.dataset.fileHeading !== heading) return false; element.scrollIntoView({ block: 'start' }); return true; });
}
