// Keep the content backing below the real header without moving content nodes
// or giving filters to containers that own viewport-fixed controls.
export function bindToolPaneMaterial(panel, header) {
  if (!header || panel.classList.contains('tool-pane-material')) return;
  function measure() {
    if (!panel.isConnected || !header.getClientRects().length) return;
    // Layout coordinates stay stable during the existing pane scale animation.
    var bottom = header.offsetTop + header.offsetHeight;
    var value = Math.max(0, bottom) + 'px';
    if (panel.style.getPropertyValue('--tool-pane-body-top') !== value) panel.style.setProperty('--tool-pane-body-top', value);
  }
  measure();
  panel.classList.add('tool-pane-material');
  var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  if (observer) { observer.observe(header); observer.observe(panel); }
  else window.addEventListener('resize', measure);
  panel.addEventListener('clay-tool-pane-dispose', function () {
    if (observer) observer.disconnect();
    else window.removeEventListener('resize', measure);
    panel.classList.remove('tool-pane-material');
    panel.style.removeProperty('--tool-pane-body-top');
  }, { once: true });
}
