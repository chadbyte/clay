import { sketchBrand, sketchCredit } from './wireframe-style.js';
import { store } from './store.js';
import { renderWireframe, wireframeSource, wireframeImage } from './wireframe-render.js';
import { openWireframe } from './wireframe-workbench.js';
import { mountWireframeViewport } from './wireframe-viewport.js';

export function renderWireframeBlocks(root) {
  if (store.get('replayingHistory')) return;
  root.querySelectorAll('pre code.language-clay-sketch, pre code.language-plantuml, pre code.language-puml, pre code.language-salt').forEach(function (code) {
    var pre = code.parentElement;
    if (!pre || pre.dataset.wireframeProcessed) return;
    var source = wireframeSource(code.textContent, code.classList.contains('language-salt') ? 'salt' : 'plantuml');
    // Wait for a complete PlantUML body while assistant text is streaming.
    if (!/^\s*@end(?:salt|uml)\b/im.test(source)) return;
    pre.dataset.wireframeProcessed = 'true';
    var card = document.createElement('section');
    card.className = 'wireframe-card';
    card.setAttribute('aria-label', 'clay-sketch preview');
    var header = document.createElement('header');
    var label = document.createElement('div'); label.className = 'sketch-brand'; label.innerHTML = sketchBrand(); header.appendChild(label);
    var open = document.createElement('button'); open.type = 'button'; open.dataset.openSketch = ''; open.textContent = 'Open sketch';
    open.addEventListener('click', function (event) { event.stopPropagation(); openWireframe({ source: source, title: 'Sketch viewer' }); });
    header.appendChild(open); card.appendChild(header);
    var canvas = document.createElement('div'); canvas.className = 'wireframe-canvas'; card.appendChild(canvas);
    var status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Rendering sketch…'; canvas.appendChild(status);
    var details = document.createElement('details');
    var summary = document.createElement('summary'); summary.textContent = 'Sketch source'; details.appendChild(summary);
    pre.replaceWith(card); details.appendChild(pre);
    var footer = document.createElement('div'); footer.className = 'sketch-source-footer'; footer.appendChild(details);
    var credit = document.createElement('div'); credit.innerHTML = sketchCredit(); footer.appendChild(credit); card.appendChild(footer);
    function render(current) {
      canvas.replaceChildren(status); status.textContent = 'Rendering sketch…';
      return renderWireframe(current, canvas).then(function (svg) {
        if (!card.isConnected) return;
        var image = wireframeImage(svg, 'clay-sketch preview');
        canvas.replaceChildren(image);
        mountWireframeViewport(canvas, image);
      }).catch(function (error) {
        if (!card.isConnected) return;
        status.textContent = error.name === 'AbortError' ? 'Rendering was interrupted. Try again.' : error.message;
        var retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
        retry.onclick = function () {
          retry.remove();
          render(current).catch(function () {});
        };
        canvas.appendChild(retry);
        throw error;
      });
    }
    render(source).catch(function () {});
  });
}
