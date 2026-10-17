// vendor-usage-overview.js - Top-bar usage overview for every tracked vendor.
//
// This is a read-only projection of the owner-scoped `vendor_usage_overview`
// message. It sits beside the existing active-session usage pill and never
// touches rejection, warning or scheduling state in app-rate-limit.js.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { iconHtml, refreshIcons } from './icons.js';
import { overviewVendors, allVendors } from './vendor-usage-model.js';
import { fillListPopover } from './vendor-usage-list.js';

var LIST_KEY = "__all";

var groupEl = null;
var records = {};
var tickTimer = null;
var outsideHandler = null;
var keyHandler = null;
var requestCounter = 0;
var pendingRequestId = null;

// `refresh` asks the server to read account usage for vendors that support it;
// the server caches, so repeating it is cheap. Replies echo the request id.
function requestOverview(refresh) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  pendingRequestId = "vu-" + (++requestCounter) + "-" + Date.now().toString(36);
  var message = { type: "vendor_usage_get", slug: store.get('currentSlug') || undefined, requestId: pendingRequestId };
  if (refresh) message.refresh = true;
  ws.send(JSON.stringify(message));
}

// A reply is shown only for the project, user and request it was asked for.
// A delayed reply from before a project or account change is dropped.
export function handleVendorUsageOverview(msg) {
  if (!msg || msg.error) return;
  var slug = store.get('currentSlug');
  if (slug && msg.slug !== slug) return;
  if ((msg.userId || null) !== (store.get('myUserId') || null)) return;
  if (msg.requestId !== undefined && msg.requestId !== pendingRequestId) return;
  var vendors = Array.isArray(msg.vendors) ? msg.vendors : [];
  store.set({ vendorUsageOverview: { slug: msg.slug, serverNowMs: msg.serverNowMs, receivedAtMs: Date.now(), vendors: vendors } });
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function closePopover(restoreFocus) {
  var open = store.get('vendorUsageOpen');
  if (!open) return;
  store.set({ vendorUsageOpen: null });
  var record = records[open];
  if (restoreFocus && record && typeof record.chip.focus === "function") record.chip.focus();
}

function sourceNote(view) {
  var note = view.lastObservedText ? "Latest report " + view.lastObservedText : "Not observed yet in this project";
  if (view.sourceSessionId !== null && view.sourceSessionId !== undefined) note += " from session #" + view.sourceSessionId;
  note += ".";
  if (view.otherSourceCount > 0) note += " " + view.otherSourceCount + " other session" + (view.otherSourceCount === 1 ? "" : "s") + " reported separately and are not combined.";
  return note;
}

function ensurePopover(record, view) {
  if (!record.pop) {
    var pop = el("div", "vendor-usage-popover");
    pop.setAttribute("role", "dialog");
    record.title = el("div", "vendor-usage-popover-title");
    record.rows = el("div", "vendor-usage-rows");
    record.notes = el("div", "vendor-usage-notes");
    pop.appendChild(record.title);
    pop.appendChild(record.rows);
    pop.appendChild(record.notes);
    // The link is created once and only updated, so keyboard focus on it
    // survives refreshes.
    record.link = el("a", "vendor-usage-link");
    record.link.target = "_blank";
    record.link.rel = "noopener";
    record.linkLabel = el("span", "", "Open usage dashboard");
    record.link.appendChild(record.linkLabel);
    record.link.insertAdjacentHTML("beforeend", iconHtml("external-link"));
    pop.appendChild(record.link);
    record.item.appendChild(pop);
    record.pop = pop;
  }
  record.pop.setAttribute("aria-label", view.name + " usage");
  record.title.textContent = view.name;
  record.rows.textContent = "";
  view.rows.forEach(function (row) {
    var line = el("div", "vendor-usage-row" + (row.warning ? " warning" : "") + (row.stale ? " stale" : ""));
    line.appendChild(el("span", "vendor-usage-row-label", row.label));
    var parts = [];
    if (row.source === "account") { if (row.value) parts.push(row.value); } else if (row.percentText) parts.push(row.percentText);
    if (row.resetText) parts.push("resets in " + row.resetText);
    var value = el("span", "vendor-usage-row-value");
    value.appendChild(el("span", "", parts.length ? parts.join(" \u00b7 ") : "Limit window"));
    var origin = row.source === "account" ? "account, " : (row.origin === "history" ? "session record, " : "session, ");
    value.appendChild(el("span", "vendor-usage-row-age", origin + row.observedText + (row.stale ? " (stale)" : "") + (row.origin === "history" ? " (earlier session record)" : "")));
    line.appendChild(value);
    record.rows.appendChild(line);
  });
  record.notes.textContent = "";
  if (view.status) record.notes.appendChild(el("div", "vendor-usage-note", view.status));
  if (view.accountCount > 0 && view.accountSource) record.notes.appendChild(el("div", "vendor-usage-note", "Account figures: " + view.accountSource + ". Units are the vendor's own and are not converted."));
  if (view.observedCount > 0) {
    record.notes.appendChild(el("div", "vendor-usage-note", sourceNote(view)));
    record.notes.appendChild(el("div", "vendor-usage-note", "Session rows come from your own sessions in this project; another account or session may differ."));
  }
  if (view.href) {
    if (record.link.getAttribute("href") !== view.href) record.link.href = view.href;
    record.link.title = view.linkTitle || "";
    record.link.style.display = "";
  } else {
    record.link.style.display = "none";
  }
}

function removePopover(record) {
  if (record.pop) { record.pop.remove(); record.pop = null; }
}

// The popover is absolutely positioned under its chip, right-aligned; a measured
// shift keeps it inside the viewport.
function placePopover(pop) {
  if (typeof pop.getBoundingClientRect !== "function") return;
  pop.style.marginRight = "";
  var bounds = pop.getBoundingClientRect();
  var viewport = document.documentElement.clientWidth;
  var shift = bounds.left < 8 ? 8 - bounds.left : Math.min(0, viewport - 8 - bounds.right);
  if (shift) pop.style.marginRight = (-shift) + "px";
}

function bindDismissal(open) {
  if (open && !outsideHandler) {
    outsideHandler = function (event) {
      if (groupEl && !groupEl.contains(event.target)) closePopover(false);
    };
    keyHandler = function (event) {
      if (event.key === "Escape") { closePopover(true); }
    };
    document.addEventListener("pointerdown", outsideHandler, true);
    document.addEventListener("keydown", keyHandler, true);
  } else if (!open && outsideHandler) {
    document.removeEventListener("pointerdown", outsideHandler, true);
    document.removeEventListener("keydown", keyHandler, true);
    outsideHandler = null;
    keyHandler = null;
  }
}

function removeGroup() {
  if (groupEl) { groupEl.remove(); groupEl = null; }
  records = {};
  bindDismissal(false);
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function createRecord(view) {
  var item = el("span", "vendor-usage-item");
  var chip = el("button", "top-bar-pill vendor-usage-chip");
  chip.type = "button";
  chip.setAttribute("data-vendor", view.vendor);
  chip.setAttribute("aria-haspopup", "dialog");
  var record = { item: item, chip: chip, icon: null, text: el("span", "vendor-usage-chip-text"), pop: null };
  chip.appendChild(record.text);
  chip.addEventListener("click", function () {
    var opening = store.get('vendorUsageOpen') !== view.vendor;
    store.set({ vendorUsageOpen: opening ? view.vendor : null });
    if (opening) requestOverview(true);
  });
  item.appendChild(chip);
  return record;
}

function updateChip(record, view, open) {
  record.chip.className = "top-bar-pill vendor-usage-chip " + (view.warning ? "pill-warning" : "pill-dim") + (view.known ? "" : " unknown") + (view.stale ? " stale" : "");
  record.chip.setAttribute("aria-expanded", open ? "true" : "false");
  record.chip.setAttribute("aria-label", view.summary + ". Show details");
  record.chip.title = view.summary;
  if (view.icon) {
    if (!record.icon) {
      record.icon = el("img", "usage-check-vendor-icon");
      record.icon.alt = "";
      record.chip.insertBefore(record.icon, record.text);
    }
    if (record.icon.getAttribute("src") !== view.icon) record.icon.setAttribute("src", view.icon);
  }
  if (record.text.textContent !== view.text) record.text.textContent = view.text;
}

function updateListChip(record, listViews, open) {
  var known = listViews.filter(function (view) { return view.known; }).length;
  var summary = "Usage for " + listViews.length + " vendor" + (listViews.length === 1 ? "" : "s") + ", " + known + " with figures";
  record.chip.className = "top-bar-pill vendor-usage-chip vendor-usage-list-chip pill-dim";
  record.chip.setAttribute("aria-expanded", open ? "true" : "false");
  record.chip.setAttribute("aria-label", summary + ". Show all vendors");
  record.chip.title = summary;
  if (!record.icon) {
    record.icon = el("span", "vendor-usage-list-icon");
    record.icon.insertAdjacentHTML("beforeend", iconHtml("gauge"));
    record.chip.insertBefore(record.icon, record.text);
  }
  var text = known + "/" + listViews.length;
  if (record.text.textContent !== text) record.text.textContent = text;
}

function ensureListPopover(record, listViews) {
  if (!record.pop) {
    var pop = el("div", "vendor-usage-popover vendor-usage-list-popover");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Usage by vendor");
    record.title = el("div", "vendor-usage-popover-title", "Usage by vendor");
    record.rows = el("div", "vendor-usage-rows");
    pop.appendChild(record.title);
    pop.appendChild(record.rows);
    record.item.appendChild(pop);
    record.pop = pop;
  }
  fillListPopover(record.rows, listViews, el);
}

// Updates stable elements in place. Chips, the popover and its link are never
// recreated while they stay relevant, so focus survives refreshes.
export function renderVendorUsageOverview() {
  var actions = document.querySelector("#top-bar .top-bar-actions");
  if (!actions) return;
  var overview = store.get('vendorUsageOverview');
  var info = store.get('vendorInfo');
  var views = overviewVendors(info, overview, Date.now());
  var listViews = allVendors(info, overview, Date.now());
  if (listViews.length === 0) {
    if (store.get('vendorUsageOpen')) store.set({ vendorUsageOpen: null });
    removeGroup();
    return;
  }
  var open = store.get('vendorUsageOpen');
  if (open && open !== LIST_KEY && !views.some(function (view) { return view.vendor === open; })) {
    open = null;
    store.set({ vendorUsageOpen: null });
  }
  if (!groupEl) {
    groupEl = el("div", "vendor-usage-overview");
    groupEl.id = "vendor-usage-overview";
    groupEl.setAttribute("role", "group");
    groupEl.setAttribute("aria-label", "Vendor usage");
  }
  var anchor = document.getElementById("rate-limit-usage-link") || document.getElementById("skip-perms-pill");
  if (groupEl.parentNode !== actions || groupEl.nextSibling !== anchor) actions.insertBefore(groupEl, anchor);
  var present = {};
  views.forEach(function (view, index) {
    present[view.vendor] = true;
    var record = records[view.vendor] || (records[view.vendor] = createRecord(view));
    if (groupEl.children[index] !== record.item) groupEl.insertBefore(record.item, groupEl.children[index] || null);
    updateChip(record, view, open === view.vendor);
    if (open === view.vendor) {
      var created = !record.pop;
      ensurePopover(record, view);
      placePopover(record.pop);
      if (created) bindDismissal(true);
    } else {
      removePopover(record);
    }
  });
  // The list entry is always last and reaches every installed vendor.
  present[LIST_KEY] = true;
  var listRecord = records[LIST_KEY] || (records[LIST_KEY] = createRecord({ vendor: LIST_KEY }));
  if (groupEl.children[views.length] !== listRecord.item) groupEl.insertBefore(listRecord.item, groupEl.children[views.length] || null);
  updateListChip(listRecord, listViews, open === LIST_KEY);
  if (open === LIST_KEY) {
    var listCreated = !listRecord.pop;
    ensureListPopover(listRecord, listViews);
    placePopover(listRecord.pop);
    if (listCreated) bindDismissal(true);
  } else {
    removePopover(listRecord);
  }
  Object.keys(records).forEach(function (vendor) {
    if (present[vendor]) return;
    records[vendor].item.remove();
    delete records[vendor];
  });
  if (!open) bindDismissal(false);
  refreshIcons();
  // Relative times only change slowly; one light timer keeps them honest.
  if (!tickTimer) tickTimer = setInterval(renderVendorUsageOverview, 30000);
}

export function initVendorUsageOverview() {
  store.subscribe(function (state, prev) {
    var identityChanged = state.currentSlug !== prev.currentSlug || state.myUserId !== prev.myUserId;
    if (identityChanged) {
      // Another project or account must start unknown and ignore any reply
      // that was requested before the change.
      pendingRequestId = null;
      if (state.vendorUsageOverview) {
        store.set({ vendorUsageOverview: null, vendorUsageOpen: null });
        if (state.connected) requestOverview(true);
        return;
      }
    }
    if (state.connected && (!prev.connected || identityChanged)) requestOverview(true);
    if (state.vendorUsageOverview !== prev.vendorUsageOverview || state.vendorInfo !== prev.vendorInfo
        || state.currentVendor !== prev.currentVendor || state.vendorUsageOpen !== prev.vendorUsageOpen) {
      renderVendorUsageOverview();
    }
  });
}
