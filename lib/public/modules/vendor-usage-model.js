// vendor-usage-model.js - Pure projection of the owner-scoped vendor usage
// overview into what the top bar shows. No DOM, store or network access.
//
// Principle: a value is shown only if it was observed. A missing observation is
// "Unknown", never 0%. Ages are measured from the server's own clock so a
// skewed browser clock cannot make an old observation look fresh.

import { formatMetric, pickHeadline } from "./vendor-usage-format.js";

var STALE_AFTER_MS = 15 * 60 * 1000;
var WARNING_PERCENT = 80;

var TYPE_LABELS = {
  five_hour: "5h",
  seven_day: "7d",
  seven_day_opus: "7d Opus",
  seven_day_sonnet: "7d Sonnet",
  overage: "Extra usage",
  seven_day_overage_included: "7d included extra usage",
};

export function estimatedServerNow(overview, nowMs) {
  if (!overview || !Number.isFinite(overview.serverNowMs) || !Number.isFinite(overview.receivedAtMs)) return nowMs;
  return overview.serverNowMs + (nowMs - overview.receivedAtMs);
}

export function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  var minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m ago";
  var hours = Math.floor(minutes / 60);
  if (hours < 48) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

export function durationText(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  var totalMinutes = Math.floor(ms / 60000);
  var days = Math.floor(totalMinutes / 1440);
  var hours = Math.floor((totalMinutes % 1440) / 60);
  var minutes = totalMinutes % 60;
  if (days >= 2) return days + "d " + hours + "h";
  if (totalMinutes >= 60) return Math.floor(totalMinutes / 60) + "h " + minutes + "m";
  return Math.max(1, minutes) + "m";
}

export function windowLabel(entry, vendor) {
  var label;
  if (entry.kind === "reset") {
    label = TYPE_LABELS[entry.rateLimitType] || entry.rateLimitType || "Usage";
  } else {
    var mins = entry.windowDurationMins;
    if (!Number.isFinite(mins) || mins <= 0) label = "Usage";
    else if (mins % 1440 === 0) label = (mins / 1440) + "d";
    else if (mins % 60 === 0) label = (mins / 60) + "h";
    else label = mins + "m";
  }
  // A separate limit bucket (for example a model-specific one) keeps its name.
  if (entry.limitId && entry.limitId !== vendor) label += " (" + entry.limitId + ")";
  return label;
}

function percentOf(entry) {
  return Number.isFinite(entry.usedPercent) ? entry.usedPercent : null;
}

function windowView(entry, vendor, serverNow) {
  var percent = percentOf(entry);
  var resetText = entry.resetsAt ? durationText(entry.resetsAt - serverNow) : "";
  var warn = (percent !== null && percent >= WARNING_PERCENT) || entry.status === "allowed_warning" || entry.status === "rejected";
  var observed = Number.isFinite(entry.observedAtMs) ? serverNow - entry.observedAtMs : null;
  return {
    label: windowLabel(entry, vendor),
    percent: percent,
    percentText: percent === null ? "" : Math.round(percent) + "% used",
    resetText: resetText,
    resetsAt: entry.resetsAt || null,
    warning: warn,
    observedAgeMs: observed,
    observedText: observed === null ? "observation time unknown" : "observed " + ageText(observed),
    origin: entry.origin === "history" ? "history" : "live",
  };
}

var MAX_CHIPS = 3;

function capabilityOf(info, entry) {
  if (entry && entry.capability) return entry.capability;
  // An older server without capabilities: only the observed path exists.
  return { mode: info && info.rateLimitTracking === true ? "event" : "unintegrated", observed: info && info.rateLimitTracking === true, units: [] };
}

function accountRows(account, serverNow) {
  if (!account || !Array.isArray(account.metrics)) return [];
  var age = Number.isFinite(account.fetchedAtMs) ? serverNow - account.fetchedAtMs : null;
  var stale = account.stale === true || (age !== null && age >= STALE_AFTER_MS);
  return account.metrics.map(function (metric) {
    var row = formatMetric(metric);
    row.resetText = row.resetsAtMs ? durationText(row.resetsAtMs - serverNow) : "";
    row.expired = !!(row.resetsAtMs && row.resetsAtMs <= serverNow);
    row.stale = stale;
    row.source = "account";
    row.observedAgeMs = age;
    row.observedText = age === null ? "read time unknown" : "read " + ageText(age);
    return row;
  }).filter(function (row) { return !row.expired; });
}

// Why a vendor has no figures, in the vendor's own terms.
function statusLine(cap, account, hasObserved) {
  if (cap.mode === "unintegrated" || cap.mode === "unsupported") return cap.reason || "Not integrated: no verified usage source.";
  var status = account && account.status;
  if (account && account.fetching) return "Checking account usage\u2026";
  if (status === "refused") return account.message || "Account usage is not available for you.";
  if (status === "no_auth") return "Not signed in, so account usage cannot be read.";
  if (status === "expired_auth") return "Sign-in has expired; run the vendor CLI once to refresh it.";
  if (status === "error") return (account.message || "Account usage could not be read.") + (Number.isFinite(account.retryAtMs) ? " Will retry later." : "");
  if (cap.mode === "query" && (!status || status === "idle")) return "Not checked yet.";
  if (!hasObserved) return cap.mode === "event" ? "Waiting for a report from one of your sessions. Usage is unknown, not zero." : "No usage reported. Usage is unknown, not zero.";
  return "";
}

// Returns the display model for one vendor, or null when it is not installed.
// The headline value, its label and its age always describe the same row: a
// stale high row is never presented with the freshness of a different one.
export function describeVendor(vendor, info, entry, overview, nowMs) {
  if (!info) return null;
  if (entry && entry.installed === false) return null;
  var cap = capabilityOf(info, entry);
  var serverNow = estimatedServerNow(overview, nowMs);
  var name = info.displayName || vendor;
  var meta = info.usageDashboard || null;
  var observed = [];
  if (entry && Array.isArray(entry.windows)) {
    entry.windows.forEach(function (raw) {
      if (raw.resetsAt && raw.resetsAt <= serverNow) return;
      var row = windowView(raw, vendor, serverNow);
      row.source = "session";
      observed.push(row);
    });
  }
  var account = entry && entry.account ? entry.account : null;
  var accounts = accountRows(account, serverNow);
  var lastSeenAge = entry && Number.isFinite(entry.lastObservedAtMs) ? serverNow - entry.lastObservedAtMs : null;
  var chosen = null;
  var fromAccount = accounts.length > 0 && !(accounts[0].stale && observed.length > 0);
  if (fromAccount) {
    chosen = pickHeadline(accounts);
    chosen.percentText = chosen.percent === null ? "" : Math.round(chosen.percent) + "% used";
  } else {
    observed.forEach(function (row) { if (row.percent !== null && (chosen === null || row.percent > chosen.percent)) chosen = row; });
    if (!chosen) observed.forEach(function (row) { if (row.resetText && (chosen === null || row.resetsAt < chosen.resetsAt)) chosen = row; });
    if (!chosen && observed.length) chosen = observed[0];
    if (!chosen && accounts.length) { chosen = pickHeadline(accounts); fromAccount = true; }
  }
  var known = chosen !== null;
  var rows = accounts.concat(observed);
  var warning = rows.some(function (row) { return row.warning; });
  var text = "Unknown";
  var summary = name + " usage unknown";
  var stale = false;
  if (known) {
    var chosenAge = chosen.observedAgeMs;
    var headline = fromAccount ? chosen.headline : (chosen.percent !== null ? Math.round(chosen.percent) + "%" : chosen.resetText ? "resets " + chosen.resetText : "Observed");
    text = headline;
    stale = fromAccount ? chosen.stale === true : (chosenAge !== null && chosenAge >= STALE_AFTER_MS);
    if (chosenAge === null) text += " \u00b7 age unknown";
    else if (stale) text += " \u00b7 " + ageText(chosenAge);
    var pieces = [name + " " + chosen.label + " usage"];
    if (fromAccount) pieces.push(chosen.value);
    else if (chosen.percent !== null) pieces.push(Math.round(chosen.percent) + "% used");
    else if (chosen.resetText) pieces.push("resets in " + chosen.resetText);
    pieces.push(fromAccount ? "account, " + chosen.observedText : chosen.observedText);
    summary = pieces.join(", ");
  }
  var others = entry && Number.isFinite(entry.otherSourceCount) ? entry.otherSourceCount : 0;
  return {
    vendor: vendor, name: name, mode: cap.mode, capability: cap, known: known, warning: warning, stale: stale,
    text: text, summary: summary, rows: rows, accountCount: accounts.length, observedCount: observed.length,
    status: statusLine(cap, account, observed.length > 0 || accounts.length > 0),
    accountSource: cap.source || "",
    sourceSessionId: entry && entry.sourceSessionId !== undefined ? entry.sourceSessionId : null,
    otherSourceCount: others,
    lastObservedText: lastSeenAge === null ? "" : ageText(lastSeenAge),
    href: meta && meta.href || "", linkTitle: meta && meta.title || "", icon: meta && meta.icon || info.avatar || "",
  };
}

// Every installed vendor, in registry order. Nothing is shown until the server
// has answered for this project and user.
export function allVendors(vendorInfo, overview, nowMs) {
  if (!overview) return [];
  var infos = vendorInfo || {};
  var byVendor = {};
  (Array.isArray(overview.vendors) ? overview.vendors : []).forEach(function (entry) { byVendor[entry.vendor] = entry; });
  var result = [];
  Object.keys(infos).forEach(function (vendor) {
    // Without a server entry only a tracked vendor is listed (older servers).
    if (!byVendor[vendor] && infos[vendor].rateLimitTracking !== true) return;
    var view = describeVendor(vendor, infos[vendor], byVendor[vendor], overview, nowMs);
    if (view) result.push(view);
  });
  return result;
}

// Compact bar: chips only for vendors that have figures (warnings first, then
// registry order, at most MAX_CHIPS); everything else lives in the list.
export function overviewVendors(vendorInfo, overview, nowMs) {
  var all = allVendors(vendorInfo, overview, nowMs);
  var withData = all.filter(function (view) { return view.known; });
  var ordered = withData.filter(function (v) { return v.warning; }).concat(withData.filter(function (v) { return !v.warning; }));
  var shown = ordered.slice(0, MAX_CHIPS);
  return all.filter(function (view) { return shown.indexOf(view) !== -1; });
}
