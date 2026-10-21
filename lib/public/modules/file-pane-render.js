import { bindFilePaneLinks, scrollFileHeading } from './file-pane-links.js';
import { paintFileReview } from './file-pane-review.js';
import { renderMarkdown, highlightCodeBlocks, renderMermaidBlocks } from './markdown.js';
import { renderHtmlPreview, isHtmlFile } from './html-preview.js';
import { renderPlantUmlPreview, cancelPlantUmlPreview, isPlantUmlFile } from './plantuml-preview.js';
import { renderCodeWithLineNumbers, renderLargeTextFile, mapExtToLanguage } from './file-viewer-source.js';

export function filePreviewKind(path) {
  return /\.mdx?$/i.test(path) ? 'markdown' : isHtmlFile(path) ? 'html' : isPlantUmlFile(path) ? 'uml' : /\.svg$/i.test(path) ? 'svg' : null;
}
export function paintFilePane(body, state) {
  cancelPlantUmlPreview(state.instanceId);
  var path = state.resource.path, content = state.content || '', kind = filePreviewKind(path), scroll = body.scrollTop;
  body.replaceChildren();
  if (state.error) { var error = document.createElement('div'); error.className = 'file-tree-error'; error.textContent = state.error; body.appendChild(error); return; }
  if (state.content == null && !state.binary) { body.textContent = 'Loading file…'; return; }
  if (state.binary) {
    if (state.imageUrl) { var image = document.createElement('img'); image.src = state.imageUrl; image.alt = path; body.appendChild(image); }
    else body.textContent = 'Binary file';
  } else if (state.diff) {
    paintFileReview(body, state);
  } else if ((state.size || content.length) > 1024 * 1024) renderLargeTextFile(body, content, state.size);
  else if (!state.resource.rendered || !kind) renderCodeWithLineNumbers(body, content, path.split('.').pop());
  else if (kind === 'markdown') {
    var markdown = document.createElement('div'); markdown.className = 'file-viewer-markdown';
    markdown.innerHTML = renderMarkdown(content); body.appendChild(markdown);
    Array.from(markdown.querySelectorAll('img')).forEach(function (image) {
      var src = image.getAttribute('src');
      if (src && !/^(https?:|data:|api\/file)/.test(src)) image.src = 'api/file?path=' + encodeURIComponent(path.replace(/[^/]*$/, '') + src);
    });
    bindFilePaneLinks(markdown, state);
    highlightCodeBlocks(markdown); renderMermaidBlocks(markdown);
    if (state.presenting) {
      var slide = -1, level = 'H' + (state.slideLevel || 1);
      Array.from(markdown.children).forEach(function (child) {
        if (child.tagName === level) slide++;
        child.hidden = Math.max(0, slide) !== (state.slideIndex || 0);
      });
    }
  } else if (kind === 'html') renderHtmlPreview(body, content, path);
  else if (kind === 'uml') renderPlantUmlPreview(body, content, path, state.instanceId);
  else {
    var svg = document.createElement('img'); svg.className = 'file-viewer-svg-preview'; svg.alt = path;
    svg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content); body.appendChild(svg);
  }
  body.scrollTop = state.line ? Math.max(0, (state.line - 1) * 20 - 80) : scroll;
  if (kind === 'markdown' && state.heading) scrollFileHeading(body, state.heading);
}
