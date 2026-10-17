// vendor-usage-format.js - Pure formatting of account usage metrics.
//
// Each unit is shown in its own terms. Counts, credits, currency and unnamed
// amounts are never turned into a percentage, and a missing field is omitted,
// never shown as 0.

var WARNING_PERCENT = 80;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function plain(value) {
  if (!finite(value)) return "";
  var rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100;
  return rounded.toLocaleString("en-US");
}

function money(value, code) {
  if (!finite(value)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
  } catch (e) {
    return plain(value) + " " + code;
  }
}

function windowText(mins) {
  if (!finite(mins) || mins <= 0) return "";
  if (mins % 1440 === 0) return (mins / 1440) + "d";
  if (mins % 60 === 0) return (mins / 60) + "h";
  return mins + "m";
}

// One metric -> { label, value, headline, percent, warning, unit }.
// `value` is the full detail text; `headline` is the short chip text.
export function formatMetric(metric) {
  var label = metric.label || "Usage";
  var win = windowText(metric.windowMins);
  if (win && label.indexOf(win) === -1) label += " (" + win + ")";
  var out = { id: metric.id, unit: metric.unit, label: label, value: "", headline: "", percent: null, warning: false, resetsAtMs: finite(metric.resetsAtMs) ? metric.resetsAtMs : null };
  if (metric.unit === "percent") {
    out.percent = metric.usedPercent;
    out.value = Math.round(metric.usedPercent) + "% used";
    out.headline = Math.round(metric.usedPercent) + "%";
    out.warning = metric.usedPercent >= WARNING_PERCENT;
  } else if (metric.unit === "count" || metric.unit === "amount") {
    var unitWord = metric.unit === "count" ? "" : " (unit not stated)";
    if (finite(metric.used) && finite(metric.limit)) {
      out.value = plain(metric.used) + " of " + plain(metric.limit) + " used" + unitWord;
      out.headline = plain(metric.used) + "/" + plain(metric.limit);
      out.warning = metric.limit > 0 && metric.used / metric.limit * 100 >= WARNING_PERCENT;
    } else if (finite(metric.used)) {
      out.value = plain(metric.used) + " used" + unitWord;
      out.headline = plain(metric.used);
    } else {
      out.value = plain(metric.remaining) + " left" + unitWord;
      out.headline = plain(metric.remaining) + " left";
    }
    if (finite(metric.remaining) && finite(metric.used) && finite(metric.limit)) out.value += ", " + plain(metric.remaining) + " left";
  } else if (metric.unit === "credits") {
    if (metric.unlimited) { out.headline = "Unlimited"; out.value = "Unlimited credits"; }
    else if (finite(metric.used) && finite(metric.limit)) {
      out.headline = plain(metric.used) + "/" + plain(metric.limit);
      out.value = plain(metric.used) + " of " + plain(metric.limit) + " credits used";
      out.warning = metric.limit > 0 && metric.used / metric.limit * 100 >= WARNING_PERCENT;
    } else if (finite(metric.used)) { out.headline = plain(metric.used); out.value = plain(metric.used) + " credits used"; }
    else { out.headline = plain(metric.balance); out.value = plain(metric.balance) + " credits"; }
  } else if (metric.unit === "currency") {
    var code = metric.currencyCode;
    if (finite(metric.used) && finite(metric.limit)) {
      out.value = money(metric.used, code) + " of " + money(metric.limit, code) + " used";
      out.headline = money(metric.used, code);
    } else if (finite(metric.used)) {
      out.value = money(metric.used, code) + " used";
      out.headline = money(metric.used, code);
    } else {
      out.value = money(metric.balance, code) + " balance";
      out.headline = money(metric.balance, code);
    }
  }
  return out;
}

// The metric that best summarises a vendor: the highest percent when any
// metric is a percent, otherwise the first reported.
export function pickHeadline(formatted) {
  var best = null;
  formatted.forEach(function (item) {
    if (item.percent !== null && (best === null || best.percent === null || item.percent > best.percent)) best = item;
  });
  return best || formatted[0] || null;
}
