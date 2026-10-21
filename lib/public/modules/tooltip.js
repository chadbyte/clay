import { initPaneHeaderTooltips } from './pane-header-tooltips.js';

// --- Global JS tooltip system ---
// Unified tooltip using [data-tip] attribute.
// Usage: initTooltips() auto-binds, converts [title] to [data-tip].
// Call registerTooltip(el, text) for dynamic elements.

var tooltipEl = null;
var showTimer = null;
var SHOW_DELAY = 120;
var currentTarget = null;

function initTooltips() {
  if (tooltipEl) return;
  // Create singleton tooltip element
  tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip"; tooltipEl.id = "clay-tooltip"; tooltipEl.setAttribute("role", "tooltip"); tooltipEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(tooltipEl);

  // Convert existing title attributes to data-tip in target areas
  convertTitles();
  initPaneHeaderTooltips();

  // Delegate hover events on document for [data-tip]
  document.addEventListener("mouseover", function (e) {
    var target = e.target.closest("[data-tip], [data-tip-html]");
    if (!target) return;
    if (target === currentTarget) return; // already showing for this target
    scheduleShow(target);
  });

  document.addEventListener("mouseout", function (e) {
    var target = e.target.closest("[data-tip], [data-tip-html]");
    if (!target) return;
    // Only hide if we're leaving the target entirely (not moving to a child)
    if (e.relatedTarget && target.contains(e.relatedTarget)) return;
    cancelShow();
    hideTooltip();
  });

  document.addEventListener("focusin", function (event) {
    var target = event.target.closest("[data-tip], [data-tip-html]");
    if (target) scheduleShow(target);
  });
  document.addEventListener("focusout", function () { cancelShow(); hideTooltip(); });
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") { cancelShow(); hideTooltip(); } });
  window.addEventListener("blur", function () { cancelShow(); hideTooltip(); });
  document.addEventListener("pointerdown", function () {
    cancelShow();
    hideTooltip();
  }, true);

  document.addEventListener("scroll", function () {
    cancelShow();
    hideTooltip();
  }, true);
}

function convertTitles() {
  var selectors = [
    "#top-bar [title]",
    ".title-bar-content [title]",
    "#input-area [title]",
    ".mate-sidebar-actions [title]",
    "#mate-sidebar-header [title]",
  ];
  var els = document.querySelectorAll(selectors.join(", "));
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!el.getAttribute("data-tip")) {
      el.setAttribute("data-tip", el.getAttribute("title"));
    }
    el.removeAttribute("title");
  }
}

function registerTooltip(el, text) {
  el.setAttribute("data-tip", text);
  el.removeAttribute("title");
}

function scheduleShow(el) {
  cancelShow();
  showTimer = setTimeout(function () {
    showTooltipAt(el);
  }, SHOW_DELAY);
}

function cancelShow() {
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

function showTooltipAt(target) {
  if (!tooltipEl || !target.isConnected || !target.getClientRects().length) return;
  // A message preview already describes this Worker/task tab.
  if (target.getAttribute('aria-describedby') === 'agent-message-bubble' && document.getElementById('agent-message-bubble')) return;
  // Suppress tooltip when an associated popover/picker is open
  var suppressSel = target.getAttribute("data-tip-suppress-when-open");
  if (suppressSel) {
    var openEl = document.querySelector(suppressSel);
    if (openEl && !openEl.hidden && !openEl.classList.contains("hidden")) return;
  }
  var html = target.getAttribute("data-tip-html");
  var text = target.getAttribute("data-tip");
  if (!html && !text) return;
  if (currentTarget && currentTarget !== target) hideTooltip();
  currentTarget = target;
  var described = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (described.indexOf('clay-tooltip') < 0) described.push('clay-tooltip');
  target.setAttribute('aria-describedby', described.join(' '));

  if (html) {
    tooltipEl.innerHTML = html;
    tooltipEl.classList.add("multi-line");
    // Render any lucide icons inside the tooltip
    if (typeof window !== "undefined" && window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons({ icons: window.lucide.icons, nameAttr: "data-lucide", root: tooltipEl });
    }
  } else {
    tooltipEl.textContent = text;
    if (text.indexOf("\n") !== -1) {
      tooltipEl.classList.add("multi-line");
    } else {
      tooltipEl.classList.remove("multi-line");
    }
  }
  tooltipEl.style.top = "-9999px";
  tooltipEl.style.left = "0";
  tooltipEl.style.right = "";
  tooltipEl.setAttribute("aria-hidden", "false");
  tooltipEl.classList.add("visible");

  // Position after layout
  var tipW = tooltipEl.offsetWidth;
  var tipH = tooltipEl.offsetHeight;
  var rect = target.getBoundingClientRect();
  var gap = 8;
  var winW = window.innerWidth;
  var winH = window.innerHeight;

  // Prefer bottom, fallback to top
  var top = rect.bottom + gap;
  if (top + tipH > winH - 8) {
    top = rect.top - tipH - gap;
  }

  // Center horizontally, clamp to viewport
  var centerX = rect.left + rect.width / 2;
  var left = centerX - tipW / 2;
  if (left + tipW > winW - 8) {
    tooltipEl.style.left = "";
    tooltipEl.style.right = "8px";
  } else {
    tooltipEl.style.left = Math.max(8, left) + "px";
    tooltipEl.style.right = "";
  }
  tooltipEl.style.top = top + "px";
}

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.classList.remove("visible"); tooltipEl.setAttribute("aria-hidden", "true");
  }
  if (currentTarget) {
    var described = (currentTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (id) { return id && id !== 'clay-tooltip'; });
    if (described.length) currentTarget.setAttribute('aria-describedby', described.join(' ')); else currentTarget.removeAttribute('aria-describedby');
  }
  currentTarget = null;
}

function pruneTooltip() { if (currentTarget && (!currentTarget.isConnected || !currentTarget.getClientRects().length)) { cancelShow(); hideTooltip(); } }

function dismissTooltip() { cancelShow(); hideTooltip(); }

export { initTooltips, registerTooltip, pruneTooltip, dismissTooltip };
