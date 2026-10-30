// Keep a clear sticky toolbar over the sidebar's one glass surface. Clip only
// the scrolling content's paint, without changing its layout or scroll owner.
export function bindSessionListMaterial(list) {
  var scroller = list.parentElement;
  function measure() {
    var toolbar = list.querySelector(':scope > .session-list-sticky-top');
    if (!toolbar) return;
    var bottom = toolbar.getBoundingClientRect().bottom;
    Array.from(list.children).forEach(function (content) {
      if (content === toolbar) return;
      var overlap = Math.max(0, bottom - content.getBoundingClientRect().top);
      content.style.setProperty('--session-list-clip-top', overlap + 'px');
    });
  }
  if (!scroller.dataset.sessionListMaterial) {
    scroller.dataset.sessionListMaterial = 'true';
    scroller.addEventListener('scroll', measure, { passive: true });
    if (typeof ResizeObserver === 'function') {
      var observer = new ResizeObserver(measure);
      observer.observe(scroller); observer.observe(list);
    }
    else window.addEventListener('resize', measure);
  }
  measure();
}
