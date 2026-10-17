// vendor-usage-list.js - Compact "all vendors" list for the top-bar usage
// overview. One two-line row per installed vendor: name, where its figure
// comes from, the figure, then either the metrics or the honest reason there
// is none. Presentational only; views come from vendor-usage-model.js.

var MAX_DETAIL_METRICS = 3;

function sourceLabel(view) {
  if (view.mode === "unintegrated" || view.mode === "unsupported") return "Not integrated";
  if (view.accountCount > 0) return "Account";
  if (view.observedCount > 0) return "Session";
  return view.mode === "query" ? "Account" : "Session";
}

function detailText(view) {
  if ((view.mode === "unintegrated" || view.mode === "unsupported") && view.capability && view.capability.reason) return view.capability.reason;
  if (!view.known) return view.status || "Usage is unknown, not zero.";
  var parts = view.rows.slice(0, MAX_DETAIL_METRICS).map(function (row) {
    var value = row.source === "account" ? row.value : (row.percentText || (row.resetText ? "resets in " + row.resetText : ""));
    return row.label + ": " + value;
  });
  if (view.rows.length > MAX_DETAIL_METRICS) parts.push("+" + (view.rows.length - MAX_DETAIL_METRICS) + " more");
  return parts.join(" · ");
}

export function fillListPopover(container, views, el) {
  container.textContent = "";
  views.forEach(function (view) {
    var row = el("div", "vendor-usage-list-row" + (view.warning ? " warning" : "") + (view.known ? "" : " unknown") + (view.stale ? " stale" : ""));
    row.setAttribute("data-vendor", view.vendor);
    var top = el("div", "vendor-usage-list-top");
    if (view.icon) {
      var icon = el("img", "usage-check-vendor-icon");
      icon.alt = "";
      icon.setAttribute("src", view.icon);
      top.appendChild(icon);
    }
    top.appendChild(el("span", "vendor-usage-list-name", view.name));
    top.appendChild(el("span", "vendor-usage-list-source", sourceLabel(view)));
    top.appendChild(el("span", "vendor-usage-list-value", view.known ? view.text : (view.mode === "unintegrated" || view.mode === "unsupported" ? "—" : "Unknown")));
    row.appendChild(top);
    row.appendChild(el("div", "vendor-usage-list-detail", detailText(view)));
    container.appendChild(row);
  });
}
