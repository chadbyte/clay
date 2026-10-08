// The inline "new session" draft row that sits under a folder header (also when
// the folder is collapsed): provider icon, a compact provider picker and icon
// Cancel. The stable header action becomes Create. State and server round
// trips are in session-create.js; this module only builds and repaints the DOM
// from the store, so the row keeps its provider, focus and error across list
// rerenders and server updates.

import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { VENDOR_AVATARS, VENDOR_NAMES, VENDOR_ORDER, isExperimentalVendor } from './app-rendering.js';
import { startNewSession } from './sidebar-sessions.js';
import { closeMobileSheet } from './sidebar-mobile.js';
import {
  createState, createOptions, installedVendorIds,
  openSessionCreate, closeSessionCreate, chooseVendor, setCreateMenu, submitSessionCreate, saveProjectDefault, retryOptions
} from './session-create.js';

// Every registered provider, in the established order, followed by any the
// server reports that this client does not know. Installed state is the
// server's, per user; the dropdown never invents or hardcodes availability.
function vendorEntries(options) {
  var byId = {};
  options.vendors.forEach(function (v) { byId[v.id] = v; });
  var ids = VENDOR_ORDER.slice();
  options.vendors.forEach(function (v) { if (ids.indexOf(v.id) === -1) ids.push(v.id); });
  return ids.map(function (id) {
    var known = byId[id];
    return { id: id, name: VENDOR_NAMES[id] || (known && known.displayName) || id, installed: !!(known && known.installed) };
  });
}

function vendorLabel(id) {
  return VENDOR_NAMES[id] || id;
}

// Enter on a select confirms its native option list and on a button activates
// that button; only other targets submit the row.
function ownsEnter(target) {
  var tag = target && target.tagName;
  return tag === "SELECT" || tag === "BUTTON" || tag === "A" || tag === "TEXTAREA" || tag === "OPTION";
}

function iconButton(icon, label, key, onClick) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "session-create-icon-btn";
  btn.dataset.focusKey = key;
  btn.innerHTML = iconHtml(icon);
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function focusHeaderButton(folderId) {
  function applyFocus() {
    var buttons = document.querySelectorAll('[data-new-session-button="' + folderId + '"]');
    for (var i = 0; i < buttons.length; i++) if (buttons[i].getClientRects().length) { buttons[i].focus({ preventScroll: true }); return; }
  }
  queueMicrotask(applyFocus);
  requestAnimationFrame(applyFocus);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ensureNewSessionButtonContent(btn) {
  if (btn.querySelector(".session-folder-new-label-text")) return;
  btn.innerHTML = '<span class="session-folder-new-icon" aria-hidden="true">' + iconHtml("plus") + '</span>' +
    '<span class="session-folder-new-label"><span class="session-folder-new-label-clip">' +
    '<span class="session-folder-new-label-previous" aria-hidden="true"></span>' +
    '<span class="session-folder-new-label-text">New session</span>' +
    '<span class="session-folder-new-label-sizer" aria-hidden="true">Click to create</span>' +
    '</span></span>';
}

function setNewSessionButtonText(btn, text, animate) {
  var current = btn.querySelector(".session-folder-new-label-text");
  var previous = btn.querySelector(".session-folder-new-label-previous");
  if (!current || current.textContent === text) return;
  var revision = String((parseInt(btn.dataset.labelRevision || "0", 10) || 0) + 1);
  btn.dataset.labelRevision = revision;
  previous.textContent = current.textContent;
  current.textContent = text;
  btn.classList.remove("is-label-changing");
  if (!animate || prefersReducedMotion()) { previous.textContent = ""; return; }
  void btn.offsetWidth;
  btn.classList.add("is-label-changing");
  setTimeout(function () {
    if (btn.dataset.labelRevision !== revision) return;
    btn.classList.remove("is-label-changing");
    previous.textContent = "";
  }, 190);
}

function createStatusMessage(form, options, valid) {
  if (form.error) return form.error;
  if (options.error) return options.error;
  if (form.phase === "pending") return "Creating session…";
  if (!options.loaded) return "Loading providers…";
  if (!valid) return "Choose an installed provider first.";
  return form.notice || "";
}

function paintNewSessionButton(btn, folderId, label) {
  var form = createState();
  var active = !!(form && form.folderId === folderId);
  var options = createOptions();
  var valid = active && options.loaded && installedVendorIds().indexOf(form.vendor) !== -1;
  var pending = active && form.phase === "pending";
  var buttonText = !active ? "New session" : (pending ? "Creating…" : (!options.loaded ? "Loading…" : (!valid ? "Choose provider" : "Click to create")));
  var status = active ? createStatusMessage(form, options, valid) : "";
  ensureNewSessionButtonContent(btn);
  btn.classList.toggle("is-create", active);
  btn.setAttribute("aria-expanded", String(active));
  btn.setAttribute("aria-busy", String(pending));
  btn.setAttribute("aria-label", active ? (pending ? "Creating session in " : (valid ? "Click to create session in " : buttonText + " for ")) + label : "New session in " + label);
  var controls = btn.getAttribute("aria-controls");
  if (active && status && controls) btn.setAttribute("aria-describedby", controls + "-status");
  else btn.removeAttribute("aria-describedby");
  btn.disabled = active ? (pending || !valid) : !!(form && form.phase === "pending");
  setNewSessionButtonText(btn, buttonText, active && (!form.openedAt || Date.now() - form.openedAt < 400 || btn.isConnected));
  refreshIcons();
}

// The quiet "+ New session" pill the folder header places on its right.
export function renderNewSessionButton(folderId, label, surface) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "session-folder-new-btn";
  btn.dataset.newSessionButton = folderId;
  btn.setAttribute("aria-controls", "session-create-row-" + surface + "-" + folderId);
  btn.dataset.folderLabel = label;
  paintNewSessionButton(btn, folderId, label);
  btn.addEventListener("click", function (event) {
    event.stopPropagation();
    var live = createState();
    if (live && live.folderId === folderId) { submitAndClose(); return; }
    openSessionCreate(folderId);
    focusHeaderButton(folderId);
  });
  return btn;
}

function closeAndFocus(folderId) {
  closeSessionCreate();
  queueMicrotask(function () {
    var buttons = document.querySelectorAll('[data-new-session-button="' + folderId + '"]');
    for (var i = 0; i < buttons.length; i++) if (buttons[i].getClientRects().length) { buttons[i].focus(); return; }
  });
}

export function renderCreateRow(folderId, label, surface) {
  var form = createState();
  if (!form || form.folderId !== folderId) return null;
  var root = document.createElement("div");
  root.className = "session-create-row" + (surface === "mobile" ? " is-mobile" : "");
  root.id = "session-create-row-" + surface + "-" + folderId;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "New session in " + label);
  root.dataset.folderId = folderId;
  root.addEventListener("keydown", function (event) {
    // Enter and Escape belong to the input method while composing.
    if (event.isComposing || event.keyCode === 229) return;
    var live = createState();
    if (!live) return;
    if (live.menuOpen && onMenuKey(event, live)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (live.phase !== "pending") closeAndFocus(folderId);
    } else if (event.key === "Enter" && !ownsEnter(event.target)) {
      event.preventDefault();
      submitAndClose();
    }
  });
  paintRow(root);
  // Once attached: restore focus (the first paint ran detached) and scroll the
  // row into view a single time when it was just opened.
  queueMicrotask(function () {
    var live = createState();
    if (!live || !root.isConnected || !root.getClientRects().length) return;
    if (live.wantFocus) paintRow(root);
    if (live.restoreFocusKey) {
      var again = root.querySelector('[data-focus-key="' + live.restoreFocusKey + '"]');
      if (again && !again.disabled) again.focus({ preventScroll: true });
      store.set({ sessionCreate: Object.assign({}, createState(), { restoreFocusKey: null }) });
    }
    if (live.scroll) {
      if (root.scrollIntoView) root.scrollIntoView({ block: "nearest" });
      store.set({ sessionCreate: Object.assign({}, createState(), { scroll: false }) });
    }
  });
  return root;
}

function closeMenu(refocus) {
  var live = createState();
  if (!live || !live.menuOpen) return;
  var change = { menuOpen: false, menuFocus: false };
  if (refocus) { change.focusKey = "vendor"; change.wantFocus = true; }
  store.set({ sessionCreate: Object.assign({}, live, change) });
}

function onMenuKey(event, live) {
  var items = Array.prototype.slice.call(document.querySelectorAll('.session-create-menu [role="menuitem"]:not(:disabled)'));
  var at = items.indexOf(document.activeElement);
  var move = function (to) { event.preventDefault(); event.stopPropagation(); if (items[to]) items[to].focus(); };
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(true); return true; }
  if (event.key === "ArrowDown") { move((at + 1) % items.length); return true; }
  if (event.key === "ArrowUp") { move((at - 1 + items.length) % items.length); return true; }
  if (event.key === "Home") { move(0); return true; }
  if (event.key === "End") { move(items.length - 1); return true; }
  if (event.key === "Tab") { closeMenu(false); return true; }
  return false;
}

function submitAndClose() {
  submitSessionCreate(startNewSession);
}

function paintRow(root) {
  var form = createState();
  if (!form) return;
  var options = createOptions();
  var pending = form.phase === "pending";
  var active = document.activeElement;
  var focusKey = active && root.contains(active) ? active.dataset.focusKey : null;
  // An explicit focus request wins over wherever focus happens to be.
  if (form.wantFocus && root.getClientRects().length) focusKey = form.focusKey || "vendor";
  root.setAttribute("aria-busy", String(pending));
  root.innerHTML = "";

  var line = document.createElement("div");
  line.className = "session-create-line";
  var installed = installedVendorIds();

  var icon = document.createElement("img");
  icon.className = "session-create-icon";
  icon.alt = "";
  icon.src = VENDOR_AVATARS[form.vendor] || VENDOR_AVATARS.claude;
  line.appendChild(icon);

  var entries = vendorEntries(options);
  var picker = document.createElement("button");
  picker.type = "button";
  picker.className = "session-create-picker";
  picker.dataset.focusKey = "vendor";
  picker.setAttribute("aria-haspopup", "menu");
  picker.setAttribute("aria-expanded", String(!!form.menuOpen));
  picker.setAttribute("aria-label", "Provider for the new session: " + (installed.indexOf(form.vendor) === -1 ? "none chosen" : vendorLabel(form.vendor)));
  picker.disabled = pending || !options.loaded;
  var pickerText = !options.loaded ? (options.error ? "Providers unavailable" : "Loading providers") : (installed.indexOf(form.vendor) === -1 ? (installed.length ? "Choose a provider" : "No provider installed") : vendorLabel(form.vendor));
  picker.innerHTML = '<span class="session-create-picker-name"></span>' + iconHtml("chevron-down");
  picker.firstChild.textContent = pickerText;
  picker.addEventListener("click", function () {
    var live = createState();
    if (live.menuOpen) closeMenu(true);
    else setCreateMenu(true, Math.max(0, entries.map(function (e) { return e.id; }).indexOf(live.vendor)));
  });
  picker.addEventListener("keydown", function (event) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.isComposing && !picker.disabled) {
      event.preventDefault();
      event.stopPropagation();
      if (!createState().menuOpen) setCreateMenu(true, Math.max(0, entries.map(function (e) { return e.id; }).indexOf(createState().vendor)));
    }
  });
  line.appendChild(picker);

  var cancel = iconButton("x", "Cancel new session", "cancel", function () { closeAndFocus(form.folderId); });
  cancel.disabled = pending;
  line.appendChild(cancel);
  root.appendChild(line);

  var valid = options.loaded && installed.indexOf(form.vendor) !== -1;
  var optionsError = options.error || "";
  var message = createStatusMessage(form, options, valid);
  var status = document.createElement("div");
  status.id = root.id + "-status";
  status.className = "session-create-status" + (form.error || optionsError ? " is-error" : "");
  status.setAttribute("role", form.error || optionsError ? "alert" : "status");
  status.textContent = message;
  if (!options.loaded && options.error) {
    var retry = document.createElement("button");
    retry.type = "button";
    retry.className = "session-create-retry";
    retry.dataset.focusKey = "retry";
    retry.textContent = "Retry";
    retry.addEventListener("click", function () { retryOptions(); });
    status.appendChild(document.createTextNode(" "));
    status.appendChild(retry);
  }
  root.appendChild(status);
  if (form.menuOpen && !pending) root.appendChild(renderMenu(entries, form, options, installed));
  refreshIcons();

  if (focusKey) {
    var target = root.querySelector('[data-focus-key="' + focusKey + '"]');
    var focused = false;
    if (target && !target.disabled) { target.focus({ preventScroll: true }); focused = true; }
    else if (target && active && root.contains(active)) {
      var fallback = root.querySelector('[data-focus-key="cancel"]');
      if (fallback && !fallback.disabled) { fallback.focus({ preventScroll: true }); focused = true; }
    }
    // A requested focus is consumed only once a control could take it, so a row
    // still loading its providers keeps asking.
    if (focused && form.wantFocus) store.set({ sessionCreate: Object.assign({}, createState(), { wantFocus: false }) });
  }
  placeMenu(root);
  if (form.menuOpen && form.menuFocus && root.getClientRects().length) {
    var first = root.querySelector('[data-focus-key="item:' + (form.menuIndex || 0) + '"]');
    if (first) { first.focus({ preventScroll: true }); store.set({ sessionCreate: Object.assign({}, createState(), { menuFocus: false }) }); }
  }
}

function menuItem(key, className, html, onClick, label) {
  var item = document.createElement("button");
  item.type = "button";
  item.className = "session-create-menu-item " + className;
  item.setAttribute("role", "menuitem");
  item.dataset.focusKey = key;
  item.innerHTML = html;
  if (label) item.title = label;
  item.addEventListener("click", function (event) { event.stopPropagation(); onClick(); });
  return item;
}

// The compact provider menu keeps every registered provider visible. Installed
// entries are selectable; unavailable entries are plain disabled rows. One secondary item sets the project
// default action beside each available provider (permission-gated, provider only).
function renderMenu(entries, form, options, installed) {
  var menu = document.createElement("div");
  menu.className = "session-create-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Providers");
  entries.forEach(function (entry, index) {
    var row = document.createElement("div");
    row.className = "session-create-menu-provider";
    var html = '<img src="' + (VENDOR_AVATARS[entry.id] || VENDOR_AVATARS.claude) + '" class="session-create-icon" alt="">' +
      '<span class="session-create-menu-name"></span>' +
      (entry.installed && isExperimentalVendor(entry.id) ? '<span class="vendor-experimental-badge" aria-label="Experimental integration" title="Experimental integration; not yet validated through direct use testing">🧪</span>' : "") +
      (entry.installed ? (options.projectDefault === entry.id ? '<span class="session-create-menu-note">Default</span>' : "") : '<span class="session-create-menu-note">Not installed</span>');
    var item = menuItem("item:" + index, (entry.installed ? "" : "unavailable ") + (entry.id === form.vendor ? "selected" : ""), html, function () {
      if (entry.installed) { chooseVendor(entry.id); var live = createState(); store.set({ sessionCreate: Object.assign({}, live, { focusKey: "vendor", wantFocus: true }) }); }
    }, entry.installed ? "New " + entry.name + " session" : entry.name + " is not installed");
    item.querySelector(".session-create-menu-name").textContent = entry.name;
    item.disabled = !entry.installed;
    item.setAttribute("aria-checked", String(entry.id === form.vendor));
    if (options.projectDefault === entry.id) item.setAttribute("aria-current", "true");
    row.appendChild(item);
    if (entry.installed && options.canSetProjectDefault && options.projectDefault !== entry.id) {
      var savingThis = form.defaultSaving && form.defaultVendor === entry.id;
      var setDefault = menuItem("default:" + index, "session-create-default-btn", "<span></span>", function () { saveProjectDefault(entry.id); }, "Set " + entry.name + " as the project default");
      setDefault.firstChild.textContent = savingThis ? "Saving" : "Set default";
      setDefault.disabled = !!form.defaultSaving;
      row.appendChild(setDefault);
    }
    menu.appendChild(row);
  });
  return menu;
}

// Anchors the open menu under the picker and keeps it inside the viewport.
function placeMenu(root) {
  var menu = root.querySelector(".session-create-menu");
  var picker = root.querySelector(".session-create-picker");
  if (!menu || !picker || !root.getClientRects().length) return;
  var r = picker.getBoundingClientRect();
  var width = Math.min(root.classList.contains("is-mobile") ? 320 : 276, window.innerWidth - 16);
  menu.style.width = width + "px";
  menu.style.left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8) + "px";
  var height = menu.getBoundingClientRect().height;
  var top = r.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 4);
  menu.style.top = top + "px";
}

// Repaints every visible copy in place (desktop and mobile) without rebuilding
// the whole session list.
function repaintAll() {
  var roots = document.querySelectorAll(".session-create-row");
  for (var i = 0; i < roots.length; i++) paintRow(roots[i]);
  var buttons = document.querySelectorAll(".session-folder-new-btn");
  for (var b = 0; b < buttons.length; b++) paintNewSessionButton(buttons[b], buttons[b].dataset.newSessionButton, buttons[b].dataset.folderLabel || "folder");
}

// Called right before a list rerender discards the row, so the rebuilt one can
// put focus back where the user was.
export function captureCreateFocus() {
  var live = createState();
  if (!live) return;
  var roots = document.querySelectorAll(".session-create-row");
  var focusKey = null;
  for (var i = 0; i < roots.length; i++) {
    if (roots[i].contains(document.activeElement) && document.activeElement.dataset.focusKey) focusKey = document.activeElement.dataset.focusKey;
  }
  if ((live.restoreFocusKey || null) !== focusKey) store.set({ sessionCreate: Object.assign({}, live, { restoreFocusKey: focusKey }) });
}

store.subscribe(function (state, previous) {
  var a = state.sessionCreate;
  var b = previous.sessionCreate;
  // A creation acknowledged from the phone sheet closes it, like the old flow.
  if (b && b.phase === "pending" && !a && state.sessionCreateReveal && state.sessionCreateReveal.sessionId) closeMobileSheet();
  var structural = !a !== !b || (a && b && a.folderId !== b.folderId);
  if (structural) return;
  if (a !== b || state.sessionCreateOptions !== previous.sessionCreateOptions) repaintAll();
});

// A press outside the open provider menu closes it without cancelling the press
// or taking focus; pointerdown is primary because some surfaces cancel it.
function onOutsidePress(event) {
  var live = createState();
  if (!live || !live.menuOpen) return;
  var target = event.target;
  if (target && target.nodeType === 1 && target.closest && (target.closest(".session-create-menu") || target.closest(".session-create-picker"))) return;
  closeMenu(false);
}
// Test stubs that import this module without a full DOM have no listeners to add.
if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("pointerdown", onOutsidePress, true);
  document.addEventListener("mousedown", onOutsidePress, true);
  document.addEventListener("touchstart", onOutsidePress, true);
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("blur", function () { closeMenu(false); });
}
