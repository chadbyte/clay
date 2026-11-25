function resetMarquee(state) {
  if (state.frame) cancelAnimationFrame(state.frame);
  state.frame = null;
  state.row.classList.remove("session-title-marquee");
  state.title.style.removeProperty("--session-marquee-distance");
  state.title.style.removeProperty("--session-marquee-duration");
}

function measureMarquee(state) {
  state.frame = null;
  if (!state.active || !state.row.isConnected) return;
  var titleRect = state.title.getBoundingClientRect();
  var actionRect = state.actions ? state.actions.getBoundingClientRect() : null;
  var rowRect = state.row.getBoundingClientRect();
  var right = actionRect && actionRect.width ? actionRect.left - 5 : rowRect.right - 8;
  var available = Math.max(0, right - titleRect.left);
  var overflow = state.title.scrollWidth - available;
  if (overflow <= 4) return;
  state.title.style.setProperty("--session-marquee-distance", (-overflow) + "px");
  state.title.style.setProperty("--session-marquee-duration", Math.max(5, overflow / 22) + "s");
  state.row.classList.add("session-title-marquee");
}

// Running marquees only. Rows are rebuilt on every sidebar render, so the
// cleanup hooks are shared and exist only while at least one marquee runs:
// one window resize listener and one document observer that stops a marquee
// whose row was removed without a mouseleave. Idle rows register nothing.
var activeMarquees = new Set();
var detachObserver = null;

function stopAllMarquees() {
  activeMarquees.forEach(stopMarquee);
}

function stopDetachedMarquees() {
  activeMarquees.forEach(function (state) {
    if (!state.row.isConnected) stopMarquee(state);
  });
}

function trackMarquee(state) {
  if (activeMarquees.has(state)) return;
  activeMarquees.add(state);
  if (activeMarquees.size !== 1) return;
  window.addEventListener("resize", stopAllMarquees);
  if (typeof MutationObserver !== "undefined" && document.body) {
    detachObserver = new MutationObserver(stopDetachedMarquees);
    detachObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function untrackMarquee(state) {
  if (!activeMarquees.delete(state) || activeMarquees.size) return;
  window.removeEventListener("resize", stopAllMarquees);
  if (detachObserver) {
    detachObserver.disconnect();
    detachObserver = null;
  }
}

function stopMarquee(state) {
  state.active = false;
  resetMarquee(state);
  untrackMarquee(state);
}

function activate(state) {
  state.active = true;
  resetMarquee(state);
  state.active = true;
  state.frame = requestAnimationFrame(function () { measureMarquee(state); });
  trackMarquee(state);
}

export function bindSessionTitleMarquee(row, title, actions) {
  if (!row || !title) return;
  var state = { row: row, title: title, actions: actions, active: false, frame: null };
  function leave() { stopMarquee(state); }
  function enter() { activate(state); }
  row.addEventListener("mouseenter", enter);
  row.addEventListener("focusin", enter);
  row.addEventListener("mouseleave", leave);
  row.addEventListener("focusout", function (event) {
    if (!row.contains(event.relatedTarget)) leave();
  });
}
