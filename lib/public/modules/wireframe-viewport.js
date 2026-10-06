import { store } from './store.js';

function entries() { return store.get('wireframeViewports') || new Map(); }
function apply(entry) {
  var image = entry.image;
  if (!image.naturalWidth || !entry.viewport.isConnected || entries().get(entry.viewport) !== entry) return;
  var style = getComputedStyle(entry.viewport);
  var available = entry.viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (available <= 0) return;
  var fitted = Math.min(1, available / image.naturalWidth);
  if (entry.viewport.classList.contains('wireframe-workbench-canvas')) {
    var height = entry.viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (height > 0) fitted = Math.min(fitted, height / image.naturalHeight);
  }
  // Default to the whole design at natural scale or smaller; zoom is explicit.
  var scale = entry.mode === 'manual' ? entry.zoom : fitted;
  image.style.width = image.naturalWidth * scale + 'px';
  image.style.maxWidth = 'none';
  image.style.height = 'auto';
  image.style.margin = image.naturalWidth * scale > available ? '0' : '0 auto';
  entry.scale = scale;
  if (!entry.toolbar) return;
  entry.toolbar.querySelector('[data-zoom-value]').textContent = Math.round(scale * 100) + '%';
  entry.toolbar.querySelector('[data-zoom-fit]').setAttribute('aria-pressed', String(entry.mode === 'fit'));
  entry.toolbar.querySelector('[data-zoom-out]').disabled = scale <= 0.25;
  entry.toolbar.querySelector('[data-zoom-in]').disabled = scale >= 4;
}
function cleanup() {
  var next = new Map(entries());
  next.forEach(function (entry, viewport) {
    if (viewport.isConnected && entry.image.isConnected) return;
    entry.resize.disconnect(); next.delete(viewport);
  });
  if (next.size !== entries().size) store.set({ wireframeViewports: next });
  if (!next.size) {
    var observer = store.get('wireframeViewportCleanup');
    if (observer) observer.disconnect();
    store.set({ wireframeViewportCleanup: null });
  }
}
export function mountWireframeViewport(viewport, image, toolbar) {
  var previous = entries().get(viewport);
  if (previous) previous.resize.disconnect();
  var entry = { viewport: viewport, image: image, toolbar: toolbar, mode: previous ? previous.mode : 'auto', zoom: previous ? previous.zoom : 1, scale: 1 };
  entry.resize = new ResizeObserver(function () { apply(entry); });
  var next = new Map(entries()); next.set(viewport, entry);
  store.set({ wireframeViewports: next });
  if (toolbar) {
    toolbar.classList.add('wireframe-zoom');
    toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Sketch zoom');
    toolbar.innerHTML = '<button type="button" data-zoom-out aria-label="Zoom out" title="Zoom out">−</button><button type="button" data-zoom-value aria-label="Reset zoom to 100%" title="Original size">100%</button><button type="button" data-zoom-in aria-label="Zoom in" title="Zoom in">+</button><button type="button" data-zoom-fit aria-pressed="true" title="Fit sketch to available width">Fit</button>';
    function change(mode, zoom) {
      entry.mode = mode; entry.zoom = zoom;
      viewport.scrollLeft = 0; viewport.scrollTop = 0;
      apply(entry);
    }
    toolbar.querySelector('[data-zoom-out]').onclick = function () { change('manual', Math.max(0.25, entry.scale / 1.25)); };
    toolbar.querySelector('[data-zoom-in]').onclick = function () { change('manual', Math.min(4, Math.max(0.25, entry.scale * 1.25))); };
    toolbar.querySelector('[data-zoom-value]').onclick = function () { change('manual', 1); };
    toolbar.querySelector('[data-zoom-fit]').onclick = function () { change('fit', 1); };
  }
  image.addEventListener('load', function () { apply(entry); }, { once: true });
  entry.resize.observe(viewport);
  if (!store.get('wireframeViewportCleanup')) {
    var observer = new MutationObserver(cleanup);
    observer.observe(document.body, { childList: true, subtree: true });
    store.set({ wireframeViewportCleanup: observer });
  }
  apply(entry);
}
