// Singleton tooltip controller for the compact project strip.
// Accessible trigger labels remain on the trigger; visible tooltip metadata is
// explicit so names containing commas are never parsed as status copy.

var iconStripTooltip = null;

function tooltipMetadata(value) {
  if (typeof value === "string") return { text: value };
  return value && typeof value === "object" ? value : { text: "" };
}

export function hideIconTooltip() {
  if (!iconStripTooltip) return;
  iconStripTooltip.remove();
  iconStripTooltip = null;
}

export function showIconTooltip(el, text, options) {
  hideIconTooltip();
  var metadata = Object.assign({ text: text || "" }, options || {});
  var tip = document.createElement("div");
  tip.className = "icon-strip-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.dataset.tooltipKind = metadata.kind || "project";
  if (metadata.kind === "mate") {
    tip.classList.add("icon-strip-tooltip-mate");
    var identity = document.createElement("span");
    identity.className = "icon-strip-tooltip-mate-identity";
    var avatar = document.createElement("img");
    avatar.className = "icon-strip-tooltip-mate-avatar";
    avatar.alt = "";
    avatar.draggable = false;
    avatar.src = metadata.avatarUrl || "";
    var label = document.createElement("span");
    label.className = "icon-strip-tooltip-label";
    label.textContent = metadata.text;
    identity.appendChild(avatar);
    identity.appendChild(label);
    tip.appendChild(identity);
  } else {
    tip.textContent = metadata.text;
  }
  document.body.appendChild(tip);
  iconStripTooltip = tip;

  requestAnimationFrame(function () {
    if (iconStripTooltip !== tip || !tip.isConnected) return;
    var rect = el.getBoundingClientRect();
    tip.style.top = (rect.top + rect.height / 2 - tip.offsetHeight / 2) + "px";
    tip.classList.add("visible");
  });
}

export function showIconTooltipHtml(el, html, options) {
  hideIconTooltip();
  options = options || {};
  var tip = document.createElement("div");
  tip.className = "icon-strip-tooltip" + (options.className ? " " + options.className : "");
  tip.setAttribute("role", "tooltip");
  tip.style.whiteSpace = "normal";
  tip.style.maxWidth = "260px";
  tip.innerHTML = html;
  document.body.appendChild(tip);
  iconStripTooltip = tip;

  requestAnimationFrame(function () {
    if (iconStripTooltip !== tip || !tip.isConnected) return;
    var rect = el.getBoundingClientRect();
    if (options.placement === "bottom") {
      var left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - tip.offsetWidth - 12));
      tip.style.left = left + "px";
      tip.style.top = (rect.bottom + 8) + "px";
    } else {
      tip.style.top = (rect.top + rect.height / 2 - tip.offsetHeight / 2) + "px";
    }
    tip.classList.add("visible");
  });
}

export function bindIconTooltip(el, resolveMetadata) {
  function show() {
    var metadata = tooltipMetadata(typeof resolveMetadata === "function" ? resolveMetadata() : resolveMetadata);
    showIconTooltip(el, metadata.text || "", metadata);
  }
  el.addEventListener("mouseenter", show);
  el.addEventListener("focus", show);
  el.addEventListener("mouseleave", hideIconTooltip);
  el.addEventListener("blur", hideIconTooltip);
  el.addEventListener("click", hideIconTooltip);
  el.addEventListener("contextmenu", hideIconTooltip);
  el.addEventListener("keydown", function (event) {
    if (event.key === "Escape") hideIconTooltip();
  });
}
