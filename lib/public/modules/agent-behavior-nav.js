// agent-behavior-nav.js - section links for the single scrolling Agent
// behavior page: smooth anchor scrolling, scroll-derived active state and the
// narrow (horizontal sticky row) layout flag.
var NARROW_QUERY = '(max-width: 800px)';
var SCROLL_KEYS = ['PageUp', 'PageDown', 'Home', 'End', ' '];

// opts: { layout, nav, scroller, sections: [{ id, el, heading }] }
export function attachSectionNav(opts) {
  var layout = opts.layout; var nav = opts.nav; var scroller = opts.scroller;
  var sections = opts.sections;
  var links = Array.prototype.slice.call(nav.querySelectorAll('a[data-section]'));
  var active = null; var locked = false; var frame = 0;
  var narrowMq = window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;

  function applyNarrow() {
    layout.classList.toggle('ab-narrow', !!(narrowMq && narrowMq.matches));
    if (opts.onPlace) opts.onPlace(isNarrow());
  }
  function isNarrow() { return layout.classList.contains('ab-narrow'); }

  function setActive(id) {
    if (id === active) return;
    active = id;
    links.forEach(function (link) {
      var on = link.dataset.section === id;
      link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
      if (on && isNarrow() && nav.scrollWidth > nav.clientWidth) {
        nav.scrollLeft = Math.max(0, link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2);
      }
    });
  }

  function compute() {
    frame = 0;
    if (locked || !sections.length) return;
    var offset = (isNarrow() ? nav.offsetHeight : 0) + 24;
    var line = scroller.getBoundingClientRect().top + offset;
    var current = sections[0].id;
    sections.forEach(function (section) { if (section.el.getBoundingClientRect().top <= line) current = section.id; });
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 && scroller.scrollTop > 0) current = sections[sections.length - 1].id;
    setActive(current);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(compute); }
  function unlock() { locked = false; schedule(); }
  function onKey(event) { if (SCROLL_KEYS.indexOf(event.key) >= 0 && !nav.contains(event.target)) unlock(); }

  function onPointer(event) { if (event.target === scroller) unlock(); }

  function go(id) {
    var section = sections.filter(function (item) { return item.id === id; })[0];
    if (!section) return;
    locked = true; setActive(id);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    if (section.heading) section.heading.focus({ preventScroll: true });
  }
  function onClick(event) {
    var link = event.target.closest ? event.target.closest('a[data-section]') : null;
    if (!link || !nav.contains(link)) return;
    event.preventDefault();
    go(link.dataset.section);
  }

  nav.addEventListener('click', onClick);
  scroller.addEventListener('scroll', schedule, { passive: true });
  scroller.addEventListener('wheel', unlock, { passive: true });
  scroller.addEventListener('touchstart', unlock, { passive: true });
  scroller.addEventListener('keydown', onKey);
  scroller.addEventListener('pointerdown', onPointer);
  if (narrowMq && narrowMq.addEventListener) narrowMq.addEventListener('change', applyNarrow);
  window.addEventListener('resize', schedule);
  applyNarrow();
  compute();

  return {
    go: go, refresh: compute, active: function () { return active; },
    destroy: function () {
      nav.removeEventListener('click', onClick);
      scroller.removeEventListener('scroll', schedule);
      scroller.removeEventListener('wheel', unlock);
      scroller.removeEventListener('touchstart', unlock);
      scroller.removeEventListener('keydown', onKey);
      scroller.removeEventListener('pointerdown', onPointer);
      if (narrowMq && narrowMq.removeEventListener) narrowMq.removeEventListener('change', applyNarrow);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
    }
  };
}
