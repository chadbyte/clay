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

function activate(state) {
  state.active = true;
  resetMarquee(state);
  state.active = true;
  state.frame = requestAnimationFrame(function () { measureMarquee(state); });
}

export function bindSessionTitleMarquee(row, title, actions) {
  if (!row || !title) return;
  var state = { row: row, title: title, actions: actions, active: false, frame: null };
  function leave() { state.active = false; resetMarquee(state); }
  function enter() { activate(state); }
  row.addEventListener("mouseenter", enter);
  row.addEventListener("focusin", enter);
  row.addEventListener("mouseleave", leave);
  row.addEventListener("focusout", function (event) {
    if (!row.contains(event.relatedTarget)) leave();
  });
  window.addEventListener("resize", leave);
  var observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(function () {
    if (!row.isConnected) {
      leave();
      observer.disconnect();
      window.removeEventListener("resize", leave);
    }
  });
  if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true });
}
