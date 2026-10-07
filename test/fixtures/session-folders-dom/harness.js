// Drives the production client modules with real DOM events. Server messages go
// through the production handler via /rpc (see serve.js).
import { store, createStore } from '/modules/store.js';
import { setWs } from '/modules/ws-ref.js';
import { renderSessionList, handleSearchResults } from '/modules/sidebar-sessions.js';
import { initSidebar } from '/modules/sidebar.js';
import { renderMobileSessionsInto, openMobileSheet } from '/modules/sidebar-mobile.js';
import { captureFolderInputs } from '/modules/session-folder-toolbar.js';
import { handleSessionFoldersState } from '/modules/session-folders.js';
import { initMisc } from '/modules/app-misc.js';
import { initNotifications } from '/modules/notifications.js';

var report = document.getElementById("report");
var results = [];
var wsLog = [];
var socket = "u1";
var otherSocketInbox = [];

var SESSIONS = [
  { id: 1, title: "Alpha", lastActivity: 1001, createdAt: 3, vendor: "claude", sessionRole: "driver" },
  { id: 2, title: "Beta", lastActivity: 1002, createdAt: 2, vendor: "claude", sessionRole: "driver" },
  { id: 3, title: "Driver", lastActivity: 1003, createdAt: 1, vendor: "claude", sessionRole: "driver", ownedWorkerCount: 2 },
  { id: 4, title: "Worker one", lastActivity: 1004, createdAt: 4, vendor: "codex", sessionRole: "worker", parentSessionId: 3, parentAvailable: true, workerGeneration: 1 },
  { id: 5, title: "Worker two", lastActivity: 1005, createdAt: 5, vendor: "codex", sessionRole: "worker", parentSessionId: 3, parentAvailable: true, workerGeneration: 2 },
];

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function until(fn, label) {
  for (var i = 0; i < 60; i++) { if (fn()) return; await wait(25); }
  throw new Error("timed out waiting for " + label);
}
function ok(cond, message) { if (!cond) throw new Error("assertion failed: " + message); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function section(id) { return $('.session-folder[data-folder-id="' + id + '"]'); }
function unit(id) { return $('.session-folder-unit[data-unit-key="' + id + '"]'); }
function row(id) { return $('.session-item[data-session-id="' + id + '"]'); }
function titlesIn(sectionId) { return $$(".session-folder-unit", section(sectionId)).map(function (u) { return u.dataset.unitKey; }); }
function sectionLabels() { return $$(".session-folder-label").map(function (l) { return l.textContent; }); }
function click(el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }
function keydown(el, key, extra) { var e = new KeyboardEvent("keydown", Object.assign({ key: key, bubbles: true, cancelable: true }, extra || {})); (el || document.activeElement).dispatchEvent(e); return e; }
function typeInto(input, text) { input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); }
function drag(src, target, options) {
  var opts = options || {};
  var dt = new DataTransfer();
  src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  var rect = target.getBoundingClientRect();
  var y = rect.top + rect.height * (opts.fraction === undefined ? 0.5 : opts.fraction);
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
  src.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: dt }));
}
async function rpc(path, body) {
  var res = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  return res.json();
}
function deliver(outbox, from) {
  outbox.forEach(function (entry) {
    if (entry.to === from) { if (entry.msg.type === "session_folders_state") handleSessionFoldersState(entry.msg); }
    else otherSocketInbox.push(entry);
  });
}
function fakeWs(from) {
  return {
    readyState: 1,
    send: function (raw) {
      var msg = JSON.parse(raw);
      wsLog.push(msg);
      if (msg.type === "session_folders_op" || msg.type === "session_folders_get") {
        rpc("/rpc", { socket: from, msg: msg }).then(function (outbox) { deliver(outbox, from === "u1" ? "u1-a" : from === "u1b" ? "u1-b" : "u2-a"); });
      }
    },
  };
}
async function renderAll() {
  renderSessionList(SESSIONS.map(function (s) { return Object.assign({ unread: 0, isProcessing: false, loop: null, active: false }, s); }));
  await wait(60);
}
async function sync() { await wait(120); }
async function freshWorld() {
  await rpc("/rpc/reset", {});
  wsLog.length = 0;
  otherSocketInbox.length = 0;
  socket = "u1";
  setWs(fakeWs("u1"));
  $$(".session-folder-viewmenu, .session-folder-modal, .session-folder-menu").forEach(function (e) { e.remove(); });
  store.set({ sessionFolders: null, sessionFoldersSlug: null, sessionFolderCreate: null, sessionFolderViewMenu: null, sessionFolderMenu: null, sessionFolderContext: null, sessionFolderDrag: null, sessionSearch: null, currentSlug: "proj", connected: true, splitGroups: [], dmMode: false });
  var outbox = await rpc("/rpc/connect", { socket: "u1" });
  deliver(outbox, "u1-a");
  await renderAll();
}
async function stored() { return (await (await fetch("/rpc/stored")).json())["u1/proj"]; }
function pickerChoice(label) { return $$(".session-folder-choice").filter(function (c) { return c.textContent.trim() === label; })[0]; }
function createInput(root) { return $(".session-folder-create-input", root); }
function createError(root) { return $(".session-folder-create-error", root).textContent; }
async function newFolderViaDialog(name) {
  click($("[data-new-folder-button='desktop']"));
  var input = createInput();
  ok(input, "inline create row opened");
  typeInto(input, name);
  keydown(input, "Enter");
  await sync();
  ok(!createInput(), "row closed after the acknowledged creation");
}
function viewButton() { return $("[data-view-button='desktop']"); }
function viewMenu() { return $(".session-folder-viewmenu"); }
function unitOrder() { return $$(".session-folder-unit").map(function (u) { return u.dataset.unitKey; }).join(); }
async function openView() { click(viewButton()); await sync(); ok(viewMenu(), "view dropdown open"); }
async function closeView() { if (viewMenu()) { keydown(document.activeElement, "Escape"); await sync(); } }
function sectionLabelOf(id) { return $(".session-folder-label", section(id)).textContent; }
function folderIdByLabel(label) {
  var s = $$(".session-folder-folder").filter(function (e) { return $(".session-folder-label", e).textContent === label; })[0];
  return s ? s.dataset.folderId : null;
}


// --- folder drag helpers: real dragstart/dragover/drop events on the production wiring ---
function folderHeader(id) { return $(".session-folder-header", section(id)); }
function measure(ids) {
  var out = {};
  ids.forEach(function (id) { var r = section(id).getBoundingClientRect(); out[id] = { top: r.top, height: r.height, bottom: r.bottom }; });
  return out;
}
function startFolderDrag(id) {
  var dt = new DataTransfer();
  dt.ghostLabel = null;
  dt.setDragImage = function (el) { dt.ghostLabel = el.textContent; };
  folderHeader(id).dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return dt;
}
function folderOver(dt, y, x) {
  var list = $(".session-regular-drop");
  var r = list.getBoundingClientRect();
  var ev = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x === undefined ? r.left + 40 : x, clientY: y });
  list.dispatchEvent(ev);
  return ev;
}
function folderDrop(dt, y) {
  var list = $(".session-regular-drop");
  var r = list.getBoundingClientRect();
  list.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: y }));
}
function shiftOf(id) { var t = section(id).style.transform; var m = /translateY\((-?[\d.]+)px\)/.exec(t); return m ? parseFloat(m[1]) : 0; }
function customOrderInDom() { return $$(".session-folder-folder").map(function (e) { return e.dataset.folderId; }); }
function visualOrder(ids) { return ids.slice().sort(function (a, b) { return section(a).getBoundingClientRect().top - section(b).getBoundingClientRect().top; }); }
function ctxAt(id, x, y, root) {
  var h = $(".session-folder-header", root ? $('.session-folder[data-folder-id="' + id + '"]', root) : section(id));
  var r = h.getBoundingClientRect();
  var ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: x === undefined ? r.left + 60 : x, clientY: y === undefined ? r.top + r.height / 2 : y });
  h.dispatchEvent(ev);
  return ev;
}
function ctxMenu() { return $(".session-folder-menu"); }
function ctxItems() { return $$(".session-folder-menu button").map(function (b) { return b.textContent.trim(); }); }
function toggleOf(id, root) { return $(".session-folder-toggle", root ? $('.session-folder[data-folder-id="' + id + '"]', root) : section(id)); }
function touch(type, el, x, y) { el.dispatchEvent(new PointerEvent(type, { pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y })); }
function reorderOps(since) { return wsLog.slice(since).filter(function (m) { return m.op && m.op.op === "reorder_folder"; }); }
function noPreviewLeft() { return !$$(".folder-dnd, .folder-dnd-source").length && !$$(".session-folder-folder").some(function (e) { return e.style.transform; }) && store.get("sessionFolderDrag") === null; }
async function folderFixture() {
  await freshWorld();
  await newFolderViaDialog("One"); await newFolderViaDialog("Two"); await newFolderViaDialog("Three");
  var two = folderIdByLabel("Two");
  drag(row(1), section(two)); await sync();
  drag(row(2), section(two)); await sync();
  click($(".session-folder-toggle", section(folderIdByLabel("Three")))); await sync();
  return { one: folderIdByLabel("One"), two: two, three: folderIdByLabel("Three") };
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test("initial render: Favorites, Unfiled, Driver is one unit holding its Workers", async function () {
  await freshWorld();
  ok(sectionLabels().join() === "Favorites,Unfiled", "sections: " + sectionLabels());
  ok(titlesIn("unfiled").join() === "3,2,1", "unfiled units by recency: " + titlesIn("unfiled"));
  ok($$(".session-worker-item", unit(3)).length === 2, "both Workers render inside the Driver unit");
  ok(!unit(4) && !unit(5), "Workers are not separate units");
  var list = document.getElementById("session-list");
  var fav = section("favorites");
  var sticky = $(".session-list-sticky-top");
  ok(!fav.closest(".session-list-sticky-top"), "Favorites is not inside the sticky block");
  ok(sticky && $(".session-folder-toolbar", sticky) && !$(".session-top-actions", sticky) && $("#session-top-actions-host .session-top-actions"), "New session lives in the header row, New folder/View in the block above the list");
  ok(!$(".session-favorites-divider"), "no Favorites divider");
  ok(fav.parentElement === section("unfiled").parentElement && fav.parentElement.parentElement === list, "Favorites shares the list container with the other folders");
  var siblings = $$(".session-folder", fav.parentElement).map(function (e) { return e.dataset.folderId; });
  ok(siblings[0] === "favorites" && siblings[siblings.length - 1] === "unfiled", "Favorites first, Unfiled last: " + siblings);
  var favBody = $(".session-folder-body", fav);
  var favStyle = getComputedStyle(favBody);
  ok(favStyle.maxHeight === "none" && favStyle.overflowY === "visible", "Favorites has no internal scroll rule: " + favStyle.maxHeight + "/" + favStyle.overflowY);
  ok(getComputedStyle(fav).position !== "sticky" && getComputedStyle(fav).margin === getComputedStyle(section("unfiled")).margin, "Favorites uses the same spacing as other folders");
  ok(!row(4).getAttribute("draggable") && !$(".session-folder-move-btn", row(4)), "Workers have no drag or move control");
});

test("drag session onto Favorites, then reorder inside it by dropping above", async function () {
  await freshWorld();
  drag(row(1), section("favorites"));
  await sync();
  ok(titlesIn("favorites").join() === "1", "Alpha in Favorites: " + titlesIn("favorites"));
  drag(row(2), unit(1), { fraction: 0.1 });
  await sync();
  ok(titlesIn("favorites").join() === "2,1", "Beta dropped above Alpha: " + titlesIn("favorites"));
  var s = await stored();
  ok(s.orders.favorites.join() === "origin-2,origin-1", "persisted order " + JSON.stringify(s.orders));
  ok(!JSON.stringify(wsLog).includes("origin-"), "client never sent a durable key");
});

test("defect 1 through the UI: move a out of Favorites, then add b", async function () {
  await freshWorld();
  drag(row(1), section("favorites")); await sync();
  drag(row(1), section("unfiled")); await sync();
  ok(titlesIn("favorites").length === 0, "Alpha left Favorites");
  var before = wsLog.length;
  drag(row(2), section("favorites")); await sync();
  ok(titlesIn("favorites").join() === "2", "Beta accepted into Favorites: " + titlesIn("favorites"));
  ok(!$$(".toast-warn").length, "no error toast");
  var s = await stored();
  ok(!s.orders.favorites || s.orders.favorites.join() === "origin-2", "Favorites order has no stale member " + JSON.stringify(s.orders));
});

test("create folder named constructor, persists and renders", async function () {
  await freshWorld();
  await newFolderViaDialog("constructor");
  ok(sectionLabels().join() === "Favorites,constructor,Unfiled", "sections " + sectionLabels());
  ok(section("favorites").nextElementSibling === section(folderIdByLabel("constructor")) && section(folderIdByLabel("constructor")).nextElementSibling === section("unfiled"), "custom folders sit directly after Favorites and before Unfiled");
  await freshWorldKeepingStore();
  ok(sectionLabels().includes("constructor"), "survives a reconnect snapshot");
});

async function freshWorldKeepingStore() {
  store.set({ sessionFolders: null, sessionFoldersSlug: null });
  var outbox = await rpc("/rpc/connect", { socket: "u1" });
  deliver(outbox, "u1-a");
  await renderAll();
}

test("Driver with Workers moves as a unit via the picker; New folder from the picker creates then moves", async function () {
  await freshWorld();
  click($(".session-folder-move-btn", row(3)));
  ok($(".session-folder-modal"), "picker open");
  ok(pickerChoice("Favorites") && pickerChoice("Unfiled") && pickerChoice("New folder"), "picker entries");
  click(pickerChoice("New folder"));
  await sync();
  ok(!$(".session-folder-modal"), "picker closed and no name modal spawned");
  var input = createInput();
  ok(input && document.activeElement === input, "inline row focused for the move-create");
  typeInto(input, "Plans");
  var before = wsLog.length;
  keydown(input, "Enter");
  await sync();
  var sent = wsLog.slice(before).filter(function (m) { return m.type === "session_folders_op"; });
  ok(sent.length === 2 && sent[0].op.op === "create_folder" && sent[0].requestId && sent[1].op.op === "place_session", "create then place: " + JSON.stringify(sent.map(function (m) { return m.op.op; })));
  var id = folderIdByLabel("Plans");
  ok(id && sent[1].op.folderId === id, "placed into the acknowledged folder id");
  ok(titlesIn(id).join() === "3", "Driver unit in Plans");
  ok($$(".session-worker-item", $('.session-folder[data-folder-id="' + id + '"]')).length === 2, "Workers travelled with the Driver");
  ok(!titlesIn("unfiled").includes("3"), "Driver left Unfiled");
});

test("refused folder creation shows the reason inline and never moves the session", async function () {
  await freshWorld();
  await newFolderViaDialog("Taken");
  var before = wsLog.length;
  click($(".session-folder-move-btn", row(1)));
  click(pickerChoice("New folder"));
  var input = createInput();
  typeInto(input, "taken-but-server-side");
  // Bypass the client duplicate check by creating the same name on the server first.
  await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "create_folder", name: "taken-but-server-side" } } });
  $$(".toast").forEach(function (t) { t.remove(); });
  keydown(input, "Enter");
  await sync();
  var places = wsLog.slice(before).filter(function (m) { return m.op && m.op.op === "place_session"; });
  ok(places.length === 0, "no place_session after a refused creation");
  ok(titlesIn("unfiled").includes("1"), "session stayed in Unfiled");
  ok(createInput() && /already exists/.test(createError()), "server reason shown inline: " + (createInput() && createError()));
  ok(createInput().value === "taken-but-server-side" && !createInput().readOnly, "draft kept and editable");
  ok(!$$(".toast-warn").length, "correlated refusal is not also a toast");
  ok(!$(".session-folder-create-btn.primary").disabled, "Create enabled again");
  keydown(createInput(), "Escape"); await sync();
});

test("inline create: autofocus, Enter, Escape, buttons, validation, no duplicate submit", async function () {
  await freshWorld();
  var toolbarBtn = function () { return $("[data-new-folder-button='desktop']"); };
  click(toolbarBtn()); await sync();
  var input = createInput();
  ok(input && document.activeElement === input, "input autofocused");
  ok(toolbarBtn().getAttribute("aria-expanded") === "true", "New folder button reports the draft as open");
  ok(!$(".session-folder-modal"), "no modal");
  var draft = $(".session-folder-draft");
  ok(draft && !draft.hasAttribute("data-folder-id") && !draft.querySelector("[draggable]") && $(".session-folder-icon", draft), "temporary draft folder header with a folder icon, not a real or draggable folder");
  ok(input.value === "" && input.placeholder === "New folder", "starts empty with a subtle New folder placeholder");
  ok(draft.previousElementSibling === section("favorites") && draft.nextElementSibling === section("unfiled"), "draft sits after the custom folders (here Favorites) and before Unfiled");
  var dh = $(".session-folder-header", draft).getBoundingClientRect().height, uh = $(".session-folder-header", section("unfiled")).getBoundingClientRect().height;
  ok(Math.abs(dh - uh) < 3, "same header height as real folders: " + dh + " vs " + uh);
  var order = $$(".session-folder-tools, .session-folder").map(function (e) { return e.className.indexOf("session-folder-tools") !== -1 ? "tools" : (e.dataset.folderId || "draft"); });
  ok(order.join() === "tools,favorites,draft,unfiled", "order: toolbar, Favorites, draft, Unfiled: " + order);
  ok(!$(".session-folder-create-btn.primary").disabled && $$(".session-folder-create-btn").length === 2 && $("[aria-label='Create folder']") && $("[aria-label='Cancel new folder']"), "compact check and cancel buttons");
  // blank
  keydown(input, "Enter"); await sync();
  ok(/Enter a folder name/.test(createError()) && createInput().getAttribute("aria-invalid") === "true", "blank error inline");
  ok(document.activeElement === createInput(), "focus kept after validation error");
  // reserved
  typeInto(createInput(), " Favorites "); keydown(createInput(), "Enter"); await sync();
  ok(/reserved/.test(createError()), "reserved error: " + createError());
  typeInto(createInput(), "unfiled"); click($(".session-folder-create-btn.primary")); await sync();
  ok(/reserved/.test(createError()), "reserved via button");
  // typing clears the error
  typeInto(createInput(), "Work"); await sync();
  ok(createError() === "", "error cleared on edit");
  var before = wsLog.length;
  keydown(createInput(), "Enter"); keydown(createInput(), "Enter"); click($(".session-folder-create-btn.primary"));
  await sync();
  var creates = wsLog.slice(before).filter(function (m) { return m.op && m.op.op === "create_folder"; });
  ok(creates.length === 1 && creates[0].requestId, "exactly one correlated create_folder despite repeated submits: " + creates.length);
  ok(!createInput() && sectionLabels().join() === "Favorites,Work,Unfiled", "closed only after the ack; folder listed: " + sectionLabels());
  // duplicate (client-side)
  click(toolbarBtn()); await sync();
  typeInto(createInput(), "work"); keydown(createInput(), "Enter"); await sync();
  ok(/already exists/.test(createError()), "duplicate error inline");
  // Escape cancels and returns focus to the New folder button
  keydown(createInput(), "Escape"); await sync();
  ok(!createInput() && document.activeElement === $("[data-new-folder-button='desktop']"), "Escape cancels, focus returns to New folder");
  // Cancel button
  click($("[data-new-folder-button='desktop']")); await sync();
  typeInto(createInput(), "Never");
  click($("[aria-label='Cancel new folder']")); await sync();
  ok(!createInput() && sectionLabels().join() === "Favorites,Work,Unfiled", "Cancel discards the draft");
});

test("inline create: draft, caret and focus survive list rerenders and server updates; pending blocks edits", async function () {
  await freshWorld();
  click($("[data-new-folder-button='desktop']")); await sync();
  var input = createInput();
  typeInto(input, "Drafting");
  input.setSelectionRange(2, 5);
  input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
  await renderAll();
  input = createInput();
  ok(document.activeElement === input && input.value === "Drafting" && input.selectionStart === 2 && input.selectionEnd === 5, "survived a rerender: " + input.value + " " + input.selectionStart + "-" + input.selectionEnd);
  // a server snapshot for another change
  var outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_collapsed", containerKey: "favorites", collapsed: true } } });
  deliver(outbox, "u1-a");
  await sync();
  input = createInput();
  ok(document.activeElement === input && input.value === "Drafting" && input.selectionStart === 2, "survived a server update");
  // focus elsewhere must not be stolen back by a rerender
  document.activeElement.blur();
  await renderAll();
  ok(document.activeElement !== createInput() && createInput().value === "Drafting", "draft kept, focus not stolen when the user left the field");
  // project change clears the draft
  store.set({ currentSlug: "elsewhere" });
  ok(!createInput() && store.get("sessionFolderCreate") === null, "project change clears the draft");
  store.set({ currentSlug: "proj" });
  await freshWorld();
  click($("[data-new-folder-button='desktop']")); await sync();
  typeInto(createInput(), "DM"); store.set({ dmMode: true });
  ok(!createInput(), "DM transition clears the draft");
  store.set({ dmMode: false });
});

test("inline create: lost connection ends the pending state with an inline message", async function () {
  await freshWorld();
  click($("[data-new-folder-button='desktop']")); await sync();
  typeInto(createInput(), "Slow");
  setWs({ readyState: 1, send: function () {} });
  keydown(createInput(), "Enter"); await sync();
  ok(createInput().readOnly && $(".session-folder-create-btn.primary").disabled, "pending: input read-only, Create disabled");
  store.set({ connected: false }); await sync();
  ok(/Connection lost/.test(createError()) && !createInput().readOnly, "connection loss reported inline and unlocked");
  store.set({ connected: true });
  setWs(fakeWs("u1"));
  keydown(createInput(), "Escape"); await sync();
});

test("folder menu: new session here, rename, move up/down, delete keeps chats", async function () {
  await freshWorld();
  await newFolderViaDialog("One");
  await newFolderViaDialog("Two");
  var one = folderIdByLabel("One"), two = folderIdByLabel("Two");
  drag(row(1), section(one)); await sync();
  ok(titlesIn(one).join() === "1", "Alpha in One");
  ctxAt(one);
  var items = $$(".session-folder-menu button").map(function (b) { return b.textContent.trim(); });
  ok(items.join() === "New session here,Rename,Move up,Move down,Delete folder", "menu: " + items);
  var before = wsLog.length;
  click($$(".session-folder-menu button")[0]);
  var created = wsLog.slice(before).find(function (m) { return m.type === "new_session"; });
  ok(created && created.folderId === one && created.folderSlug === "proj" && created.forceNew === true, "new_session carries folder and project: " + JSON.stringify(created));
  ctxAt(one);
  click($$(".session-folder-menu button")[3]); await sync();
  ok(sectionLabels().join() === "Favorites,Two,One,Unfiled", "moved down: " + sectionLabels());
  ctxAt(one);
  click($$(".session-folder-menu button")[2]); await sync();
  ok(sectionLabels().join() === "Favorites,One,Two,Unfiled", "moved up: " + sectionLabels());
  ctxAt(one);
  click($$(".session-folder-menu button")[1]);
  var input = $(".session-folder-input");
  ok(input.value === "One", "rename dialog prefilled");
  typeInto(input, "Renamed"); keydown(input, "Enter"); await sync();
  ok(sectionLabels().includes("Renamed"), "renamed");
  ctxAt(one);
  click($$(".session-folder-menu button")[4]);
  ok($("#confirm-modal:not(.hidden)"), "confirm dialog");
  click($("#confirm-ok")); await sync();
  ok(!sectionLabels().includes("Renamed"), "folder gone");
  ok(titlesIn("unfiled").includes("1"), "Alpha preserved in Unfiled");
  ok(row(1), "chat row still exists");
});

test("View dropdown: non-modal, anchored, immediate updates, keyboard, outside click, focus", async function () {
  await freshWorld();
  var viewBtn = viewButton();
  ok(viewBtn.getAttribute("aria-expanded") === "false", "collapsed at rest");
  viewBtn.focus();
  await openView();
  ok(viewBtn.getAttribute("aria-expanded") === "true", "aria-expanded true when open");
  ok(!$(".session-folder-modal") && !$(".confirm-backdrop", viewMenu()), "no modal, no backdrop");
  ok(section("favorites") && section("unfiled"), "list stays visible while open");
  ok(viewMenu().contains(document.activeElement) && document.activeElement.dataset.focusKey === "group:folders", "focus on the selected group");
  var rect = viewMenu().getBoundingClientRect(), anchor = viewBtn.getBoundingClientRect();
  ok(rect.top >= anchor.bottom && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight, "anchored below the button and inside the viewport");
  // immediate update with menu staying open; ArrowDown moves selection and keeps focus
  keydown(document.activeElement, "ArrowDown"); await sync();
  ok(document.activeElement.dataset.focusKey === "group:dates" && $$(".session-folder-flat").length === 1 && !section("unfiled"), "Dates applied immediately, focus kept: " + document.activeElement.dataset.focusKey);
  ok(viewMenu(), "menu still open after the update");
  // no focus trap: Tab from the last control is left alone
  var controls = $$("button", viewMenu());
  controls[controls.length - 1].focus();
  var e = keydown(controls[controls.length - 1], "Tab");
  ok(!e.defaultPrevented, "Tab is not trapped");
  // sort and direction, with repaint keeping focus
  click($("[data-focus-key='sort:title']")); await sync();
  ok($$("[data-focus-key^='direction:']").map(function (b) { return b.textContent.trim(); }).join() === "A to Z,Z to A", "title directions");
  ok(unitOrder() === "1,2,3", "A to Z: " + unitOrder());
  $("[data-focus-key='direction:desc']").focus();
  click($("[data-focus-key='direction:desc']")); await sync();
  ok(document.activeElement.dataset.focusKey === "direction:desc" && unitOrder() === "3,2,1", "Z to A, focus kept on the pressed direction");
  click($("[data-focus-key='sort:created']")); await sync();
  ok($$("[data-focus-key^='direction:']").map(function (b) { return b.textContent.trim(); }).join() === "Newest first,Oldest first", "created directions");
  click($("[data-focus-key='direction:asc']")); await sync();
  ok(unitOrder() === "3,2,1", "oldest first: " + unitOrder());
  $("[data-focus-key='sort:manual']").focus();
  click($("[data-focus-key='sort:manual']")); await sync();
  ok(!$("[data-focus-key^='direction:']") && viewMenu().contains(document.activeElement), "Manual hides direction, focus stays inside");
  click($("[data-focus-key='group:none']")); await sync();
  ok($$(".session-folder-flat").length === 1, "none mode flat");
  // a server update repaints without losing focus
  var outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_view", sort: "title" } } });
  deliver(outbox, "u1-a"); await sync();
  ok(viewMenu().contains(document.activeElement), "focus survives an async repaint");
  // Escape closes and returns focus to the button
  keydown(document.activeElement, "Escape"); await sync();
  ok(!viewMenu() && document.activeElement === viewButton() && viewButton().getAttribute("aria-expanded") === "false", "Escape closes, focus back on View");
  // button toggles
  click(viewButton()); await sync(); ok(viewMenu(), "opened");
  click(viewButton()); await sync(); ok(!viewMenu(), "second click closes");
  // outside click closes
  await openView();
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  await sync();
  ok(!viewMenu() && viewButton().getAttribute("aria-expanded") === "false", "outside click closes");
  // clicking inside the menu does not close it
  await openView();
  viewMenu().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ok(viewMenu(), "inside click keeps it open");
  store.set({ currentSlug: "elsewhere" }); ok(!viewMenu(), "closes on project change"); store.set({ currentSlug: "proj" });
  var persisted = await stored();
  ok(persisted.view.group === "none" && persisted.view.sort === "title", "view persisted: " + JSON.stringify(persisted.view));
});

test("mobile surface: inline create row, touch-sized buttons, View dropdown clamped to the viewport", async function () {
  await freshWorld();
  var host = document.createElement("div");
  host.id = "mobile-host";
  host.style.cssText = "position:fixed;right:0;top:0;width:360px;height:100vh;overflow:auto;background:#222;z-index:5";
  document.body.appendChild(host);
  // Only one surface is visible in the app; hide the desktop list while the phone sheet is under test.
  var desktop = document.getElementById("sidebar");
  desktop.style.display = "none";
  try {
  function repaintMobile() { captureFolderInputs(); host.innerHTML = ""; renderMobileSessionsInto(host); }
  repaintMobile();
  ok($(".session-folder-toolbar.is-mobile", host) && $(".session-folder-favorites.is-mobile", host), "mobile toolbar and Favorites render");
  var labels = $$(".session-folder-label", host).map(function (l) { return l.textContent; });
  ok(labels[0] === "Favorites" && labels[labels.length - 1] === "Unfiled", "Favorites first in the mobile list: " + labels);
  click($("[data-new-folder-button='mobile']", host)); await sync(); repaintMobile(); await sync();
  var input = createInput(host);
  ok(input && $(".session-folder-draft.is-mobile", host), "mobile draft folder header");
  ok(input.getBoundingClientRect().height >= 36 && $(".session-folder-create-btn", host).getBoundingClientRect().height >= 36, "touch-sized controls: " + input.getBoundingClientRect().height);
  ok(document.activeElement === input, "mobile input focused");
  typeInto(input, "Phone"); repaintMobile(); await sync();
  ok(createInput(host).value === "Phone" && document.activeElement === createInput(host), "mobile draft and focus survive a repaint");
  click($(".session-folder-create-btn.primary", host)); await sync(); repaintMobile();
  ok(!createInput(host) && $$(".session-folder-label", host).some(function (l) { return l.textContent === "Phone"; }), "created on mobile, row closed after ack");
  // The harness page has no mobile CSS, so the vendor picker is tall; bring the toolbar into view as a user would.
  $("[data-view-button='mobile']", host).scrollIntoView({ block: "center" });
  click($("[data-view-button='mobile']", host)); await sync();
  var menu = viewMenu();
  var r = menu.getBoundingClientRect();
  ok(menu && r.left >= 8 - 0.5 && r.right <= window.innerWidth - 8 + 0.5 && r.bottom <= window.innerHeight, "mobile dropdown clamped inside the viewport: " + JSON.stringify([r.left, r.right, r.bottom, window.innerWidth]));
  await closeView();
  } finally {
    desktop.style.display = "";
    host.remove();
  }
});

test("mobile production refresh: real sheet, renderSessionList -> refreshMobileChatSheet keeps autofocus, typing caret and validation focus", async function () {
  await freshWorld();
  var desktop = document.getElementById("sidebar");
  var sheet = document.getElementById("mobile-sheet");
  desktop.style.display = "none";
  try {
    openMobileSheet("sessions");
    // The sheet's stylesheet is media-query scoped; make it a visible fixed panel for this check.
    sheet.style.cssText = "display:block;position:fixed;right:0;top:0;width:360px;height:100vh;overflow:auto;background:#222;z-index:5";
    $(".mobile-sheet-content", sheet).style.cssText = "position:static;transform:none;max-height:none;opacity:1";
    await sync();
    var list = $(".mobile-chat-session-list", sheet);
    ok(list && $(".session-folder-toolbar.is-mobile", list), "real sheet rendered the mobile folder list");
    click($("[data-new-folder-button='mobile']", sheet)); await sync();
    var input = createInput(sheet);
    ok(input && document.activeElement === input, "mobile New folder autofocuses through the real refresh path");
    typeInto(input, "Dra");
    input.setSelectionRange(1, 2);
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
    // a server-driven update goes renderSessionList -> refreshMobileChatSheet
    var outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_collapsed", containerKey: "favorites", collapsed: true } } });
    deliver(outbox, "u1-a"); await sync();
    input = createInput(sheet);
    ok(document.activeElement === input && input.value === "Dra" && input.selectionStart === 1 && input.selectionEnd === 2, "server update keeps focus and caret: " + input.value + " " + input.selectionStart + "-" + input.selectionEnd + " active=" + (document.activeElement === input));
    // validation rerender (blank -> error) keeps focus
    typeInto(input, ""); keydown(input, "Enter"); await sync();
    input = createInput(sheet);
    ok(/Enter a folder name/.test(createError(sheet)) && document.activeElement === input, "validation error rerender keeps focus");
    typeInto(createInput(sheet), "Favorites"); keydown(createInput(sheet), "Enter"); await sync();
    input = createInput(sheet);
    ok(/reserved/.test(createError(sheet)) && document.activeElement === input && input.selectionStart === input.value.length, "reserved-name rerender keeps focus and caret at the end");
    keydown(input, "Escape"); await sync();
    ok(!createInput(sheet), "Escape closes on the sheet");
    // the draft folder header in the real mobile list: after Favorites, before Unfiled
    click($("[data-new-folder-button='mobile']", sheet)); await sync();
    var mdraft = $(".session-folder-draft", sheet);
    ok(mdraft && mdraft.previousElementSibling === $(".session-folder-favorites", sheet) && mdraft.nextElementSibling === $(".session-folder-unfiled", sheet) && !mdraft.hasAttribute("data-folder-id"), "mobile draft is a folder header between Favorites and Unfiled");
    keydown(createInput(sheet), "Escape"); await sync();
    // search wired to real mobile filtering through the production refresh
    ok(magnifier("mobile", sheet), "mobile toolbar exposes search");
    var mbefore = $(".session-folder-toolbar", sheet).getBoundingClientRect();
    click(magnifier("mobile", sheet)); await sync();
    var mi = searchInput(sheet);
    ok(mi && document.activeElement === mi, "mobile search autofocuses through the real refresh path");
    var mafter = $(".session-folder-toolbar", sheet).getBoundingClientRect();
    ok(Math.abs(mafter.top - mbefore.top) < 0.5 && Math.abs(mafter.height - mbefore.height) < 0.5 && !$("[data-new-folder-button='mobile']", sheet), "mobile search replaces the controls in the same footprint");
    typeInto(mi, "Alp"); mi.setSelectionRange(1, 2);
    mi.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
    handleSearchResults({ query: "Alp", results: [{ id: 1 }] }); await sync();
    mi = searchInput(sheet);
    ok(document.activeElement === mi && mi.value === "Alp" && mi.selectionStart === 1 && mi.selectionEnd === 2, "mobile focus, draft and caret survive the refresh");
    ok($$(".session-folder-unit", sheet).map(function (u) { return u.dataset.unitKey; }).join() === "1", "mobile list filtered to the match: " + $$(".session-folder-unit", sheet).map(function (u) { return u.dataset.unitKey; }));
    ok($(".session-search-count", sheet).textContent === "1", "mobile match count");
    keydown(mi, "Escape"); await sync();
    ok(!searchInput(sheet) && magnifier("mobile", sheet) && document.activeElement === magnifier("mobile", sheet), "Escape restores the mobile controls and focus");
    ok($$(".session-folder-unit", sheet).length === 3, "mobile list unfiltered again (Driver, Beta, Alpha)");
  } finally {
    sheet.style.cssText = "";
    sheet.classList.add("hidden");
    $(".mobile-sheet-list", sheet).innerHTML = "";
    desktop.style.display = "";
  }
});

test("IME composition: Enter while composing does not submit; Enter after composition does", async function () {
  await freshWorld();
  click($("[data-new-folder-button='desktop']")); await sync();
  var input = createInput();
  typeInto(input, "\ud55c");
  var before = wsLog.length;
  var composing = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
  input.dispatchEvent(composing);
  var safari = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true });
  input.dispatchEvent(safari);
  await sync();
  ok(wsLog.slice(before).filter(function (m) { return m.op && m.op.op === "create_folder"; }).length === 0, "no create_folder while composing");
  ok(!composing.defaultPrevented && createError() === "" && createInput().value === "\ud55c", "composition Enter left alone, no validation error, draft intact");
  typeInto(createInput(), "\ud55c\uae00");
  keydown(createInput(), "Enter"); await sync();
  ok(wsLog.slice(before).filter(function (m) { return m.op && m.op.op === "create_folder"; }).length === 1 && sectionLabels().includes("\ud55c\uae00"), "Enter after composition ends creates the Korean-named folder: " + sectionLabels());
});


test("folder drag: live displacement preview before drop, with unequal heights, and no requests", async function () {
  var f = await folderFixture();
  var ids = [f.one, f.two, f.three];
  var h = measure(ids);
  ok(h[f.one].height < h[f.two].height && h[f.three].height < h[f.two].height, "heights differ: empty One " + h[f.one].height + ", expanded Two " + h[f.two].height + ", collapsed Three " + h[f.three].height);
  var gap = h[f.two].top - h[f.one].bottom;
  var favBefore = section("favorites").getBoundingClientRect().top, unfiledBefore = section("unfiled").getBoundingClientRect().top;
  var before = wsLog.length;
  var dt = startFolderDrag(f.one);
  await wait(30);
  ok(dt.ghostLabel === "One", "native drag image is a ghost with the folder name: " + dt.ghostLabel);
  ok(section(f.one).classList.contains("folder-dnd-source") && $$(".folder-dnd").length === 3, "dragged block is the placeholder and the three custom folders are animatable");
  ok(!section("favorites").classList.contains("folder-dnd") && !section("unfiled").classList.contains("folder-dnd"), "Favorites and Unfiled are not part of the movable set");
  // downward: pointer near the bottom of Three -> One goes last
  var ev = folderOver(dt, h[f.three].top + h[f.three].height * 0.9);
  ok(ev.defaultPrevented, "valid drop zone accepts the drag (dropEffect " + dt.dropEffect + ")");
  await wait(300);
  ok(wsLog.length === before, "no request during the preview");
  ok(customOrderInDom().join() === [f.one, f.two, f.three].join(), "DOM order untouched during the preview");
  ok(visualOrder(ids).join() === [f.two, f.three, f.one].join(), "visual order is the proposed one: " + visualOrder(ids).map(function (id) { return sectionLabelOf(id); }));
  ok(Math.abs(shiftOf(f.two) + (h[f.one].height + gap)) < 1.5 && Math.abs(shiftOf(f.three) + (h[f.one].height + gap)) < 1.5, "neighbours moved up by the dragged block's height: " + shiftOf(f.two) + " / " + shiftOf(f.three));
  ok(Math.abs(shiftOf(f.one) - (h[f.two].height + h[f.three].height + 2 * gap)) < 1.5, "dragged block sits in the last slot: " + shiftOf(f.one));
  ok(section("favorites").getBoundingClientRect().top === favBefore && section("unfiled").getBoundingClientRect().top === unfiledBefore, "Favorites and Unfiled did not move");
  // upward into the middle: One goes between Two and Three (pointer on Two's lower half)
  folderOver(dt, h[f.two].top + h[f.two].height * 0.8);
  await wait(300);
  ok(visualOrder(ids).join() === [f.two, f.one, f.three].join(), "middle order: " + visualOrder(ids).map(sectionLabelOf));
  ok(Math.abs(shiftOf(f.two) + (h[f.one].height + gap)) < 1.5 && Math.abs(shiftOf(f.one) - (h[f.two].height + gap)) < 1.5 && shiftOf(f.three) === 0, "only the crossed neighbour moves");
  // back above everything: original order, all displacements removed
  folderOver(dt, h[f.one].top - 5);
  await wait(300);
  ok(visualOrder(ids).join() === ids.join() && ids.every(function (id) { return shiftOf(id) === 0; }), "top returns to the original arrangement");
  ok(wsLog.length === before, "still no request");
  // hovering back and forth over the same spot must not flip (hitboxes use original positions)
  var flips = [];
  for (var i = 0; i < 6; i++) { folderOver(dt, h[f.two].top + h[f.two].height * 0.55); await wait(40); flips.push(shiftOf(f.one)); }
  ok(flips.every(function (v) { return v === flips[0]; }), "stable while the pointer stays put: " + flips);
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  await wait(50);
  ok(noPreviewLeft(), "dragend cleans everything up");
});

test("folder drag: valid drop persists once, up and down, survives reload; Favorites and Unfiled stay fixed", async function () {
  var f = await folderFixture();
  var ids = [f.one, f.two, f.three];
  var h = measure(ids);
  var before = wsLog.length;
  var dt = startFolderDrag(f.one);
  await wait(30);
  folderOver(dt, h[f.three].top + h[f.three].height * 0.9);
  folderDrop(dt, h[f.three].top + h[f.three].height * 0.9);
  var ops = reorderOps(before);
  ok(ops.length === 1 && ops[0].op.folderId === f.one && ops[0].op.targetId === f.three && ops[0].op.insertBefore === false, "one reorder_folder op, after Three: " + JSON.stringify(ops.map(function (m) { return m.op; })));
  ok(!!section(f.one).style.transform, "previewed order stays on screen until the server snapshot");
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  await sync();
  await wait(100);
  ok(sectionLabels().join() === "Favorites,Two,Three,One,Unfiled", "server order applied: " + sectionLabels());
  ok(noPreviewLeft(), "preview state cleared after the snapshot rerender");
  var persisted = await stored();
  ok(persisted.folders.map(function (x) { return x.name; }).join() === "Two,Three,One", "persisted: " + JSON.stringify(persisted.folders.map(function (x) { return x.name; })));
  await freshWorldKeepingStore();
  ok(sectionLabels().join() === "Favorites,Two,Three,One,Unfiled", "survives reload: " + sectionLabels());
  // upward drop: One (now last) to the very top, above Favorites area
  var h2 = measure([f.one, f.two, f.three]);
  before = wsLog.length;
  dt = startFolderDrag(f.one);
  await wait(30);
  var topY = section("favorites").getBoundingClientRect().top + 2;
  folderOver(dt, topY);
  await wait(300);
  ok(visualOrder([f.one, f.two, f.three])[0] === f.one, "dragged to the top");
  ok(section("favorites").getBoundingClientRect().top === measure(["favorites"]).favorites.top && !section("favorites").style.transform && customOrderInDom().indexOf(f.one) > -1 && sectionLabels()[0] === "Favorites", "Favorites still first and not displaced");
  folderDrop(dt, topY);
  ops = reorderOps(before);
  ok(ops.length === 1 && ops[0].op.targetId === f.two && ops[0].op.insertBefore === true, "upward drop targets the next folder, insertBefore: " + JSON.stringify(ops.map(function (m) { return m.op; })));
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  await sync(); await wait(100);
  ok(sectionLabels().join() === "Favorites,One,Two,Three,Unfiled", "upward result: " + sectionLabels());
  ok(!folderHeader("favorites").getAttribute("draggable") && !folderHeader("unfiled").getAttribute("draggable"), "Favorites and Unfiled headers are not draggable");
  ctxAt("favorites"); ctxAt("unfiled");
  ok(!ctxMenu(), "no reorder or delete menu on Favorites or Unfiled");
  var crafted = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "reorder_folder", folderId: "favorites", targetId: f.one } } });
  ok(crafted[0].msg.error, "server still refuses a crafted Favorites reorder");
});

test("folder drag: cancel paths restore the original order and send nothing", async function () {
  var f = await folderFixture();
  var ids = [f.one, f.two, f.three];
  var h = measure(ids);
  var bottom = h[f.three].top + h[f.three].height * 0.9;
  // dragend without a drop
  var before = wsLog.length;
  var dt = startFolderDrag(f.two);
  folderOver(dt, bottom); await wait(300);
  ok(visualOrder(ids).join() !== ids.join(), "preview active");
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); await wait(300);
  ok(noPreviewLeft() && visualOrder(ids).join() === ids.join() && wsLog.length === before, "dragend restores the order, no request");
  // drop outside the list
  dt = startFolderDrag(f.two);
  folderOver(dt, bottom); await wait(100);
  var outside = folderOver(dt, bottom, -80);
  ok(!outside.defaultPrevented && dt.dropEffect === "none", "outside the list is not a drop zone");
  await wait(300);
  ok(visualOrder(ids).join() === ids.join(), "leaving the list restores the order");
  folderDrop(dt, bottom);
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); await wait(50);
  ok(noPreviewLeft() && reorderOps(before).length === 0, "outside drop sends nothing");
  // drop where the order did not change
  dt = startFolderDrag(f.two);
  folderOver(dt, h[f.two].top + h[f.two].height * 0.5);
  folderDrop(dt, h[f.two].top + h[f.two].height * 0.5);
  await wait(50);
  ok(noPreviewLeft() && reorderOps(before).length === 0, "an unchanged drop sends nothing");
  // Escape
  dt = startFolderDrag(f.two);
  folderOver(dt, bottom); await wait(300);
  keydown(document.body, "Escape"); await wait(300);
  ok(noPreviewLeft() && visualOrder(ids).join() === ids.join() && reorderOps(before).length === 0, "Escape cancels and restores");
  // rerender mid-drag keeps the preview on the fresh DOM, then cancel
  dt = startFolderDrag(f.two);
  folderOver(dt, bottom); await wait(300);
  await renderAll(); await wait(300);
  ok(visualOrder(ids).join() === [f.one, f.three, f.two].join() && section(f.two).classList.contains("folder-dnd-source"), "preview re-applied after a rerender: " + visualOrder(ids).map(sectionLabelOf));
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); await wait(300);
  ok(noPreviewLeft() && visualOrder(ids).join() === ids.join(), "cleaned up after rerender cancel");
  // project transition and disconnect
  dt = startFolderDrag(f.two); folderOver(dt, bottom); await wait(50);
  store.set({ currentSlug: "elsewhere" }); await wait(50);
  ok(noPreviewLeft(), "project change cancels the drag");
  store.set({ currentSlug: "proj" });
  await freshWorld();
  await newFolderViaDialog("A"); await newFolderViaDialog("B");
  var a = folderIdByLabel("A"), b = folderIdByLabel("B");
  dt = startFolderDrag(a); folderOver(dt, section(b).getBoundingClientRect().bottom - 2); await wait(50);
  store.set({ connected: false }); await wait(50);
  ok(noPreviewLeft(), "disconnect cancels the drag");
  store.set({ connected: true });
  // a drag whose end event never arrives is cleaned by the watchdog
  dt = startFolderDrag(a); folderOver(dt, section(b).getBoundingClientRect().bottom - 2);
  await wait(2700);
  ok(noPreviewLeft(), "watchdog cleans a drag that lost its dragend");
});

test("folder drag: session drag and move semantics are unchanged; reduced motion is respected", async function () {
  await freshWorld();
  await newFolderViaDialog("Box");
  var box = folderIdByLabel("Box");
  drag(row(1), section(box)); await sync();
  ok(titlesIn(box).join() === "1", "session still drops into a folder");
  drag(row(1), section("favorites")); await sync();
  ok(titlesIn("favorites").join() === "1" && !$$(".folder-dnd").length, "session drag leaves folder preview state alone");
  var css = await (await fetch("/css/session-folders.css")).text();
  ok(/prefers-reduced-motion: reduce\)\s*\{[^}]*folder-dnd\s*\{\s*transition:\s*none/.test(css), "reduced-motion rule disables the slide animation");
  ok(/\.folder-dnd\s*\{[^}]*transition:\s*transform\s+180ms/.test(css), "animation is a bounded 180ms transform transition");
});

function toolbarBox() { var r = $(".session-folder-toolbar").getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height }; }
function magnifier(surface, root) { return $("[data-search-button='" + (surface || "desktop") + "']", root); }
function searchInput(root) { return $(".session-search-input", root); }

test("sidebar header: no Sessions/Tools headings, New session kept, magnifier on the New folder / View row", async function () {
  await freshWorld();
  var labels = $$(".sidebar-label-sr");
  ok(labels.length >= 2 && labels.every(function (l) { var r = l.getBoundingClientRect(); return r.width <= 1 && r.height <= 1; }), "Sessions and Tools labels are not visible but stay in the DOM for assistive tech");
  ok($(".tool-shortcut") && $(".sidebar-tools-hint") && $(".tool-palette-edit-btn"), "tool shortcuts, keyboard hint and edit control preserved");
  var host = $("#session-top-actions-host");
  ok($(".session-top-action.split-main", host) && !$("#session-header-search-btn") && !$("#session-header-search-inline") && !$("#session-filter-count"), "New session stays in the header; the old header search and its row are gone");
  var lastTool = $("#session-actions").getBoundingClientRect(), controls = $(".session-top-actions", host).getBoundingClientRect();
  ok(controls.top - lastTool.bottom >= 10, "spacing separates tools from session controls: " + (controls.top - lastTool.bottom));
  var bar = $(".session-folder-toolbar").getBoundingClientRect();
  var nf = $("[data-new-folder-button='desktop']").getBoundingClientRect(), vw = $("[data-view-button='desktop']").getBoundingClientRect(), mg = magnifier().getBoundingClientRect();
  ok(nf.left < vw.left && vw.left < mg.left && mg.right <= bar.right + 0.5 && Math.abs((mg.top + mg.height / 2) - (nf.top + nf.height / 2)) < 2, "magnifier sits on the New folder / View row, right-aligned");
  ok(controls.bottom <= bar.top, "that row is below New session");
  var ids = $$("[id]").map(function (e) { return e.id; });
  ok(ids.length === new Set(ids).size, "no duplicate ids");
  var order = $$("#sidebar-tools, #sidebar-sessions-header, .session-folder-tools, .session-folder").map(function (e) { return e.id || (e.classList.contains("session-folder-tools") ? "tools-row" : e.dataset.folderId); });
  ok(order.join() === "sidebar-tools,sidebar-sessions-header,tools-row,favorites,unfiled", "order: tools, New session, New folder/View/search, then unified folders: " + order);
});

test("toolbar search: replaces the controls in the same footprint; query, results, clear, close, Escape and focus", async function () {
  await freshWorld();
  var before = toolbarBox();
  var mg = magnifier();
  mg.focus();
  click(mg); await sync();
  var input = searchInput();
  ok(input && document.activeElement === input, "search input autofocused");
  var after = toolbarBox();
  ok(Math.abs(after.top - before.top) < 0.5 && Math.abs(after.left - before.left) < 0.5 && Math.abs(after.width - before.width) < 0.5 && Math.abs(after.height - before.height) < 0.5, "same footprint before and after: " + JSON.stringify(before) + " vs " + JSON.stringify(after));
  var ir = input.getBoundingClientRect(), br = $(".session-folder-toolbar").getBoundingClientRect();
  ok(ir.width > br.width * 0.6 && ir.left >= br.left && ir.right <= br.right + 0.5, "input is full width inside the toolbar: " + ir.width + " of " + br.width);
  ok(!$("[data-new-folder-button]") && !$("[data-view-button]") && !magnifier(), "New folder, View and the magnifier are replaced, not stacked");
  ok($("[aria-label='Close search']") && $(".session-folder-toolbar.is-searching"), "explicit close affordance");
  ok(!$$("#sidebar .session-folder-tools").length || $$("#sidebar .session-folder-tools").length === 1, "no extra row");
  var ids = $$("[id]").map(function (e) { return e.id; });
  ok(ids.length === new Set(ids).size && !$("#session-header-search-input"), "no duplicate or legacy search ids");
  // type: results arrive later, stale ones are ignored
  typeInto(input, "Alp");
  input.setSelectionRange(1, 2);
  input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }));
  ok(!$("[aria-label='Clear search text']").hidden, "clear-text button appears with text");
  handleSearchResults({ query: "stale", results: [] }); await sync();
  ok(unit(2) && unit(3), "a stale response changes nothing");
  handleSearchResults({ query: "Alp", results: [{ id: 1 }] }); await sync();
  input = searchInput();
  ok(document.activeElement === input && input.value === "Alp" && input.selectionStart === 1 && input.selectionEnd === 2, "focus, draft and caret survive the results rerender: " + input.selectionStart + "-" + input.selectionEnd);
  ok(!unit(2) && !unit(3) && unit(1), "list filtered to the match, hierarchy preserved");
  ok($(".session-highlight", row(1)) && $(".session-search-count").textContent === "1", "match highlighted and counted");
  // a server snapshot rerender keeps it too
  var outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_collapsed", containerKey: "favorites", collapsed: true } } });
  deliver(outbox, "u1-a"); await sync();
  ok(document.activeElement === searchInput() && searchInput().selectionStart === 1, "survives a server update");
  // clear text: stays open, focused, list restored
  click($("[aria-label='Clear search text']")); await sync();
  ok(searchInput() && searchInput().value === "" && document.activeElement === searchInput() && unit(2) && unit(3), "Clear empties the text, keeps search open and focused, restores the list");
  // Escape closes: controls and focus restored, query cleared
  typeInto(searchInput(), "Bet");
  handleSearchResults({ query: "Bet", results: [{ id: 2 }] }); await sync();
  keydown(searchInput(), "Escape"); await sync();
  ok(!searchInput() && $("[data-new-folder-button='desktop']") && $("[data-view-button='desktop']") && magnifier(), "Escape restores the controls");
  ok(document.activeElement === magnifier(), "focus returns to the magnifier");
  ok(unit(1) && unit(2) && unit(3) && store.get("sessionSearch").query === "", "query cleared and full list back");
  var restored = toolbarBox();
  ok(Math.abs(restored.top - before.top) < 0.5 && Math.abs(restored.height - before.height) < 0.5, "toolbar footprint unchanged after closing");
  // explicit close button
  click(magnifier()); await sync();
  typeInto(searchInput(), "x");
  click($("[aria-label='Close search']")); await sync();
  ok(!searchInput() && magnifier() && document.activeElement === magnifier() && store.get("sessionSearch").query === "", "close button clears and restores");
  // IME protection: Escape while composing does not close
  click(magnifier()); await sync();
  var composing = new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true });
  searchInput().dispatchEvent(composing); await sync();
  ok(searchInput() && !composing.defaultPrevented, "Escape during IME composition is left to the input method");
  // an empty search closes when focus leaves
  var empty = searchInput(); empty.blur(); await wait(60);
  ok(!searchInput() && magnifier(), "leaving an empty search closes it");
  // the request that the debounce sends
  var before2 = wsLog.length;
  click(magnifier()); await sync();
  typeInto(searchInput(), "Alpha");
  await wait(320);
  var sent = wsLog.slice(before2).filter(function (m) { return m.type === "search_sessions"; });
  ok(sent.length === 1 && sent[0].query === "Alpha", "one debounced search_sessions request: " + JSON.stringify(sent));
  keydown(searchInput(), "Escape"); await sync();
});

test("new folder draft: a temporary folder header in the list, never a real folder until the ack", async function () {
  var f = await folderFixture();
  var before = wsLog.length;
  click($("[data-new-folder-button='desktop']")); await sync();
  var draft = $(".session-folder-draft");
  ok(draft && draft.previousElementSibling === section(f.three) && draft.nextElementSibling === section("unfiled"), "after the last custom folder, before Unfiled");
  ok(sectionLabels().join() === "Favorites,One,Two,Three,Unfiled" && !$(".session-folder-label", draft), "not a listed folder: no label, not counted");
  ok($$(".session-folder-count").length === 5 || $$(".session-folder-count").every(function (c) { return !draft.contains(c); }), "the draft has no count");
  ok(!draft.querySelector("[draggable]") && !$$(".folder-dnd").length, "not draggable and not part of the DnD set");
  var dt = startFolderDrag(f.one);
  await wait(30);
  ok($$(".folder-dnd").length === 3 && !draft.classList.contains("folder-dnd"), "drag preview contains only real folders");
  var h = measure([f.one, f.two, f.three]);
  folderOver(dt, h[f.three].top + h[f.three].height * 0.9); await wait(300);
  ok(draft.getBoundingClientRect().top >= section(f.three).getBoundingClientRect().top && customOrderInDom().length === 3, "draft not displaced into the folder order");
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); await wait(50);
  typeInto(createInput(), "Draft");
  ok(wsLog.slice(before).filter(function (m) { return m.op && m.op.op === "create_folder"; }).length === 0 && (await stored()).folders.length === 3, "typing creates nothing");
  keydown(createInput(), "Enter"); await sync();
  ok(!$(".session-folder-draft") && sectionLabels().join() === "Favorites,One,Two,Three,Draft,Unfiled", "ack turns the draft into a real folder in the same place: " + sectionLabels());
  ok((await stored()).folders.length === 4, "persisted only after the ack");
  // failure stays editable, and the session list is untouched
  var titles = titlesIn("unfiled").join();
  await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "create_folder", name: "Server side" } } });
  click($("[data-new-folder-button='desktop']")); await sync();
  typeInto(createInput(), "Server side"); keydown(createInput(), "Enter"); await sync();
  ok($(".session-folder-draft") && /exists/.test(createError()) && !createInput().readOnly && createInput().value === "Server side", "refusal keeps the draft editable with the reason beneath");
  ok(titlesIn("unfiled").join() === titles, "no sessions affected");
  keydown(createInput(), "Escape"); await sync();
  ok(!$(".session-folder-draft"), "Escape cancels the draft");
});

test("new folder draft: shown under any grouping, scrolls into view only when opened, survives rerenders", async function () {
  await freshWorld();
  var outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_view", group: "none" } } });
  deliver(outbox, "u1-a"); await sync();
  ok(!section("unfiled"), "group none has no folder sections");
  click($("[data-new-folder-button='desktop']")); await sync();
  var draft = $(".session-folder-draft");
  ok(draft && draft.previousElementSibling === section("favorites") && draft.nextElementSibling === $(".session-folder-flat"), "draft sits under Favorites in the flat grouping");
  typeInto(createInput(), "Anywhere"); keydown(createInput(), "Enter"); await sync();
  ok(!$(".session-folder-draft") && (await stored()).folders.map(function (x) { return x.name; }).join() === "Anywhere" && (await stored()).view.group === "none", "creation works and the persisted grouping is unchanged");
  outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_view", group: "dates" } } });
  deliver(outbox, "u1-a"); await sync();
  click($("[data-new-folder-button='desktop']")); await sync();
  ok($(".session-folder-draft").nextElementSibling === $(".session-folder-flat"), "also under dates");
  keydown(createInput(), "Escape"); await sync();
  outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_view", group: "folders" } } });
  deliver(outbox, "u1-a"); await sync();
  // scrolling: many folders in a short sidebar
  var sidebar = $("#sidebar");
  sidebar.style.height = "330px";
  for (var i = 0; i < 7; i++) await newFolderViaDialog("F" + i);
  sidebar.scrollTop = 0; await wait(30);
  click($("[data-new-folder-button='desktop']")); await sync();
  var sr = sidebar.getBoundingClientRect(), dr = $(".session-folder-draft").getBoundingClientRect();
  ok(sidebar.scrollTop > 0 && dr.top >= sr.top - 1 && dr.bottom <= sr.bottom + 1, "opening scrolls the draft into view: scrollTop " + sidebar.scrollTop);
  sidebar.scrollTop = 0; await wait(30);
  var o2 = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_collapsed", containerKey: "favorites", collapsed: true } } });
  deliver(o2, "u1-a"); await sync();
  await renderAll(); await sync();
  ok(sidebar.scrollTop === 0, "later updates do not steal the scroll: " + sidebar.scrollTop);
  ok(createInput() && !$(".session-folder-draft").hasAttribute("data-folder-id"), "draft still present after updates");
  keydown(createInput(), "Escape"); await sync();
  sidebar.style.height = "";
});


function rightOf(el) { return el.getBoundingClientRect().right; }
function leftOf(el) { return el.getBoundingClientRect().left; }
function headerOf(root, selector) { return $(".session-folder-header", $(selector, root)); }
async function checkHeaderGeometry(root, label, mobile) {
  var fav = $(".session-folder-favorites", root), unf = $(".session-folder-unfiled", root);
  var customs = $$(".session-folder-folder", root);
  var short = customs[0], long = customs[1];
  var counts = [fav, short, long, unf].map(function (s) { return $(".session-folder-count", s); });
  var rights = counts.map(rightOf);
  ok(Math.max.apply(null, rights) - Math.min.apply(null, rights) < 0.6, label + ": counts share one column across Favorites, custom and Unfiled: " + rights.map(function (r) { return r.toFixed(1); }));
  var headers = [fav, short, long, unf].map(function (s) { return $(".session-folder-header", s); });
  ok(!$$(".session-folder-menu-btn, .session-folder-menu-slot", root).length && headers.every(function (h) { return h.children.length === 1 && $$("button", h).length === 1; }), label + ": no dots buttons and no reserved slots; each header is just its toggle");
  var gaps = headers.map(function (h, i) { return h.getBoundingClientRect().right - rights[i]; });
  ok(Math.max.apply(null, gaps) - Math.min.apply(null, gaps) < 0.6 && gaps[0] >= 0 && gaps[0] <= 12, label + ": counts sit naturally at the header's right edge: " + gaps.map(function (g) { return g.toFixed(1); }));
  if (mobile) ok(toggleOf(short.dataset.folderId, root).getBoundingClientRect().height >= 40, label + ": touch-sized header");
  // long name truncates inside its own label; the count stays in the column
  var longLabel = $(".session-folder-label", long);
  ok(longLabel.scrollWidth > longLabel.clientWidth + 1 && longLabel.textContent.length > 40, label + ": long label is truncated, not wrapped: " + longLabel.scrollWidth + " > " + longLabel.clientWidth);
  ok(Math.abs(rightOf($(".session-folder-count", long)) - rights[0]) < 0.6 && $(".session-folder-count", long).getBoundingClientRect().left > longLabel.getBoundingClientRect().right - 1, label + ": count stays right of the truncated label");
  var heights = [fav, short, long, unf].map(function (s) { return $(".session-folder-header", s).getBoundingClientRect().height; });
  ok(Math.max.apply(null, heights) - Math.min.apply(null, heights) < 0.6, label + ": equal header heights " + heights);
  // the draft shares the folder geometry
  var draft = $(".session-folder-draft", root);
  ok(draft, label + ": draft present");
  var dIcon = $(".session-folder-icon", draft), sIcon = $(".session-folder-icon", short);
  ok(Math.abs(leftOf(dIcon) - leftOf(sIcon)) < 0.6, label + ": draft folder icon aligns with real folders: " + leftOf(dIcon) + " vs " + leftOf(sIcon));
  ok(Math.abs($(".session-folder-header", draft).getBoundingClientRect().height - heights[1]) < 3, label + ": draft header height matches");
  ok(Math.abs(rightOf($(".session-folder-create-actions", draft)) - rights[0]) < 0.6, label + ": draft actions end at the count column's right edge");
  var dh = $(".session-folder-header", draft).getBoundingClientRect(), fh = $(".session-folder-header", short).getBoundingClientRect();
  ok(Math.abs(dh.left - fh.left) < 0.6 && Math.abs(dh.right - fh.right) < 0.6, label + ": draft header spans the same width");
}

test("folder header geometry: counts in one column, no dots or slots, truncation, draft alignment, desktop and mobile", async function () {
  await freshWorld();
  await newFolderViaDialog("Short");
  await newFolderViaDialog("M".repeat(60));
  click($("[data-new-folder-button='desktop']")); await sync();
  await checkHeaderGeometry($("#session-list"), "desktop", false);
  keydown(createInput(), "Escape"); await sync();
  var host = document.createElement("div");
  host.id = "mobile-host";
  host.style.cssText = "position:fixed;right:0;top:0;width:360px;height:100vh;overflow:auto;background:#222;z-index:5";
  document.body.appendChild(host);
  var desktop = document.getElementById("sidebar");
  desktop.style.display = "none";
  try {
    // mobile list built by the production renderer; the draft is part of the same store state
    store.set({ sessionFolderCreate: { draft: "", error: "", pendingId: null, sessionId: null, focus: false, scroll: false, selStart: 0, selEnd: 0 } });
    captureFolderInputs(); host.innerHTML = ""; renderMobileSessionsInto(host); await sync();
    await checkHeaderGeometry(host, "mobile", true);
  } finally {
    store.set({ sessionFolderCreate: null });
    desktop.style.display = "";
    host.remove();
  }
});


test("folder context menu: right-click at the pointer with clamping, keyboard, Escape/outside, actions, immutable folders", async function () {
  var f = await folderFixture();
  drag(row(1), section(f.one)); await sync();
  var before = wsLog.length;
  var h = folderHeader(f.two).getBoundingClientRect();
  var ev = ctxAt(f.two, 120, h.top + 6);
  ok(ev.defaultPrevented && ctxMenu(), "right-click opens the folder menu and suppresses the browser menu");
  var r = ctxMenu().getBoundingClientRect();
  ok(Math.abs(r.left - 120) < 1.5 && Math.abs(r.top - (h.top + 6)) < 1.5, "menu opens at the pointer: " + r.left + "," + r.top);
  ok(ctxItems().join() === "New session here,Rename,Move up,Move down,Delete folder" && ctxMenu().getAttribute("role") === "menu", "existing actions: " + ctxItems());
  ok(ctxMenu().contains(document.activeElement), "focus moves into the menu");
  ok(!$$(".session-folder-menu-btn, .session-folder-menu-slot").length, "no dots or slots anywhere");
  keydown(document.activeElement, "Escape"); await sync();
  ok(!ctxMenu() && document.activeElement === toggleOf(f.two), "Escape closes and returns focus to the folder header");
  ctxAt(f.two, window.innerWidth - 2, window.innerHeight - 2);
  r = ctxMenu().getBoundingClientRect();
  ok(r.right <= window.innerWidth - 8 + 0.5 && r.bottom <= window.innerHeight - 8 + 0.5 && r.left >= 8 - 0.5 && r.top >= 8 - 0.5, "clamped inside the viewport at the bottom-right: " + JSON.stringify([r.left, r.top, r.right, r.bottom]));
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); await sync();
  ok(!ctxMenu(), "outside click closes");
  ctxAt(f.two, 0, 0);
  r = ctxMenu().getBoundingClientRect();
  ok(r.left >= 8 - 0.5 && r.top >= 8 - 0.5, "clamped at the top-left: " + r.left + "," + r.top);
  keydown(document.activeElement, "Escape"); await sync();
  toggleOf(f.two).focus();
  var kev = keydown(toggleOf(f.two), "ContextMenu");
  ok(kev.defaultPrevented && ctxMenu(), "ContextMenu key opens the menu");
  var tr = toggleOf(f.two).getBoundingClientRect(); r = ctxMenu().getBoundingClientRect();
  ok(Math.abs(r.top - tr.bottom) < 1.5 && r.left >= tr.left, "keyboard menu opens just below the focused header");
  var first = document.activeElement.textContent.trim();
  keydown(document.activeElement, "ArrowDown");
  var second = document.activeElement.textContent.trim();
  keydown(document.activeElement, "End");
  var last = document.activeElement.textContent.trim();
  keydown(document.activeElement, "Home");
  var home = document.activeElement.textContent.trim();
  keydown(document.activeElement, "ArrowUp");
  var wrapped = document.activeElement.textContent.trim();
  ok(first === "New session here" && second === "Rename" && last === "Delete folder" && home === "New session here" && wrapped === "Delete folder", "keyboard navigation: " + [first, second, last, home, wrapped]);
  var tab = keydown(document.activeElement, "Tab");
  ok(tab.defaultPrevented && ctxMenu().contains(document.activeElement), "Tab stays inside the open menu");
  keydown(document.activeElement, "Escape"); await sync();
  ok(!ctxMenu() && document.activeElement === toggleOf(f.two), "Escape returns focus to the header");
  keydown(toggleOf(f.two), "F10", { shiftKey: true });
  ok(ctxMenu(), "Shift+F10 opens it too");
  keydown(document.activeElement, "Escape"); await sync();
  ctxAt(f.two); click($$(".session-folder-menu button")[2]); await sync();
  var ops = reorderOps(before);
  ok(ops.length === 1 && ops[0].op.folderId === f.two && ops[0].op.targetId === f.one && ops[0].op.insertBefore === true, "Move up uses the existing reorder op: " + JSON.stringify(ops.map(function (m) { return m.op; })));
  ok(sectionLabels().join() === "Favorites,Two,One,Three,Unfiled", "order changed: " + sectionLabels());
  var b2 = wsLog.length;
  ctxAt(f.one); click($$(".session-folder-menu button")[0]);
  var ns = wsLog.slice(b2).find(function (m) { return m.type === "new_session"; });
  ok(ns && ns.folderId === f.one && ns.folderSlug === "proj", "New session here carries folder and project");
  ctxAt(f.one); click($$(".session-folder-menu button")[1]);
  ok($(".session-folder-input") && $(".session-folder-input").value === "One", "Rename opens the existing dialog prefilled");
  keydown($(".session-folder-input"), "Escape");
  ctxAt(f.one); click($$(".session-folder-menu button")[4]);
  ok($("#confirm-modal:not(.hidden)"), "Delete opens the existing confirmation");
  click($("#confirm-cancel")); await sync();
  var b3 = wsLog.length;
  var fe = ctxAt("favorites"), ue = ctxAt("unfiled");
  ok(!fe.defaultPrevented && !ue.defaultPrevented && !ctxMenu(), "Favorites and Unfiled get no custom menu and keep the browser's");
  toggleOf("favorites").focus(); keydown(toggleOf("favorites"), "ContextMenu"); keydown(toggleOf("unfiled"), "F10", { shiftKey: true });
  ok(!ctxMenu() && wsLog.slice(b3).filter(function (m) { return m.op; }).length === 0, "keyboard also opens nothing and sends no op");
  ok(sectionLabels()[0] === "Favorites" && sectionLabels()[sectionLabels().length - 1] === "Unfiled", "Favorites first and Unfiled last");
  var b4 = wsLog.length;
  click(toggleOf(f.three)); await sync();
  var tg = wsLog.slice(b4).filter(function (m) { return m.op && m.op.op === "set_collapsed"; });
  ok(tg.length === 1, "tap/click on the header still toggles");
});

test("folder context menu on touch: long press, cancel on move/up/cancel/scroll, no accidental toggle, mouse excluded, cleanup", async function () {
  var f = await folderFixture();
  var t = toggleOf(f.two), r = t.getBoundingClientRect(), x = r.left + 80, y = r.top + r.height / 2;
  var before = wsLog.length;
  function ops() { return wsLog.slice(before).filter(function (m) { return m.op; }); }
  touch("pointerdown", t, x, y);
  await wait(250);
  ok(!ctxMenu(), "not before the press time");
  await wait(450);
  ok(ctxMenu(), "long press opens the menu");
  var mr = ctxMenu().getBoundingClientRect();
  ok(Math.abs(mr.left - x) < 1.5 && Math.abs(mr.top - y) < 1.5, "at the touch point: " + mr.left + "," + mr.top);
  touch("pointerup", t, x, y);
  click(t);
  click($$(".session-folder-menu button")[0]);
  await wait(50);
  ok(ctxMenu() && ops().length === 0, "the lifting tap neither toggles the folder nor picks an item");
  await wait(700);
  click($$(".session-folder-menu button")[2]); await sync();
  ok(!ctxMenu() && ops().filter(function (m) { return m.op.op === "reorder_folder"; }).length === 1, "a deliberate tap on an item afterwards works");
  before = wsLog.length;
  t = toggleOf(f.two); r = t.getBoundingClientRect(); x = r.left + 80; y = r.top + r.height / 2;
  touch("pointerdown", t, x, y); touch("pointermove", t, x + 4, y + 3);
  await wait(300); touch("pointermove", t, x + 30, y);
  await wait(500);
  ok(!ctxMenu(), "moving beyond the tolerance cancels the press (scroll or swipe)");
  touch("pointerup", t, x + 30, y);
  touch("pointerdown", t, x, y); await wait(150); touch("pointerup", t, x, y);
  await wait(500);
  ok(!ctxMenu(), "lifting before the time cancels");
  click(t); await sync();
  ok(ops().filter(function (m) { return m.op.op === "set_collapsed"; }).length === 1, "an ordinary tap still expands or collapses");
  touch("pointerdown", t, x, y); await wait(150); touch("pointercancel", t, x, y);
  await wait(500);
  ok(!ctxMenu(), "pointercancel cancels");
  touch("pointerdown", t, x, y); await wait(150);
  $("#sidebar").dispatchEvent(new Event("scroll"));
  await wait(500);
  ok(!ctxMenu(), "a scroll cancels");
  touch("pointerdown", t, x, y); await wait(150);
  var dstart = new DataTransfer();
  t.closest(".session-folder-header").dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dstart }));
  await wait(500);
  ok(!ctxMenu(), "drag start cancels");
  document.body.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dstart })); await wait(30);
  t.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", isPrimary: true, bubbles: true, clientX: x, clientY: y }));
  await wait(600);
  ok(!ctxMenu(), "mouse pointers do not long-press");
  t.dispatchEvent(new PointerEvent("pointerup", { pointerType: "mouse", isPrimary: true, bubbles: true }));
  var ft = toggleOf("favorites"), fr = ft.getBoundingClientRect();
  touch("pointerdown", ft, fr.left + 40, fr.top + 8);
  await wait(650);
  ok(!ctxMenu(), "Favorites has no long-press menu");
  touch("pointerup", ft, fr.left + 40, fr.top + 8);
  touch("pointerdown", t, x, y); await wait(150);
  store.set({ currentSlug: "elsewhere" });
  await wait(500);
  ok(!ctxMenu() && !store.get("sessionFolderContext").press, "project change cancels a press in flight");
  store.set({ currentSlug: "proj" });
  await freshWorld();
  await newFolderViaDialog("Z");
  var zt = toggleOf(folderIdByLabel("Z")), zr = zt.getBoundingClientRect();
  touch("pointerdown", zt, zr.left + 40, zr.top + 8); await wait(650);
  ok(ctxMenu(), "menu open after a long press");
  store.set({ dmMode: true });
  ok(!ctxMenu(), "DM transition closes it");
  store.set({ dmMode: false });
  var host = document.createElement("div");
  host.id = "mobile-host";
  host.style.cssText = "position:fixed;right:0;top:0;width:360px;height:100vh;overflow:auto;background:#222;z-index:5";
  document.body.appendChild(host);
  var desktop = document.getElementById("sidebar");
  desktop.style.display = "none";
  try {
    host.innerHTML = ""; renderMobileSessionsInto(host); await sync();
    var zid = folderIdByLabel("Z");
    var mt = toggleOf(zid, host);
    mt.scrollIntoView({ block: "center" });
    await wait(120); // let the scroll event from positioning settle; a scroll during a press cancels it by design
    var mrc = mt.getBoundingClientRect();
    ok(!$$(".session-folder-menu-btn, .session-folder-menu-slot", host).length, "mobile list has no dots or slots");
    touch("pointerdown", mt, mrc.left + 60, mrc.top + mrc.height / 2);
    await wait(650);
    ok(ctxMenu() && ctxItems().join() === "New session here,Rename,Move up,Move down,Delete folder", "mobile long press opens the folder menu");
    keydown(document.activeElement, "Escape"); await sync();
    touch("pointerup", mt, mrc.left + 60, mrc.top + mrc.height / 2); // the finger lifts
    await wait(700); // past the short window that swallows the lifting tap after a long press
    var b5 = wsLog.length;
    click(mt); await sync();
    ok(wsLog.slice(b5).filter(function (m) { return m.op && m.op.op === "set_collapsed"; }).length === 1, "mobile tap still toggles");
    var ev2 = ctxAt(zid, undefined, undefined, host);
    ok(ev2.defaultPrevented && ctxMenu(), "contextmenu works on the mobile surface (Android long-press)");
    keydown(document.activeElement, "Escape"); await sync();
  } finally {
    desktop.style.display = "";
    host.remove();
  }
});


test("folder context menu on touch: release after a long hold, stale press after a rerender, cleanup", async function () {
  var f = await folderFixture();
  var t = toggleOf(f.two), r = t.getBoundingClientRect(), x = r.left + 80, y = r.top + r.height / 2;
  var before = wsLog.length;
  function ops() { return wsLog.slice(before).filter(function (m) { return m.op; }); }
  touch("pointerdown", t, x, y);
  await wait(650);
  ok(ctxMenu(), "long press opened the menu");
  await wait(1300);
  ok(ctxMenu(), "still open while the finger is down, well past any fixed window");
  ok(store.get("sessionFolderContext").held, "the originating pointer is tracked");
  touch("pointerup", t, x, y);
  click(t);
  click($$(".session-folder-menu button")[2]);
  await wait(50);
  ok(ctxMenu() && ops().length === 0 && store.get("sessionFolderContext").held === null, "a late release neither toggles the folder nor chooses an item, and the hold is cleaned up");
  await wait(500);
  click($$(".session-folder-menu button")[2]); await sync();
  ok(!ctxMenu() && ops().filter(function (m) { return m.op.op === "reorder_folder"; }).length === 1, "a deliberate pick shortly after still works (the window is short)");
  // the pointercancel ending of a long hold is covered the same way
  before = wsLog.length;
  t = toggleOf(f.two); r = t.getBoundingClientRect(); x = r.left + 80; y = r.top + r.height / 2;
  touch("pointerdown", t, x, y);
  await wait(650); await wait(900);
  touch("pointercancel", t, x, y);
  click($$(".session-folder-menu button")[0]);
  await wait(50);
  ok(ctxMenu() && ops().length === 0, "release by pointercancel after a long hold is not a choice either");
  keydown(document.activeElement, "Escape"); await sync();
  await wait(500);
  // a rerender while the press is pending: no stale menu
  t = toggleOf(f.one); r = t.getBoundingClientRect();
  touch("pointerdown", t, r.left + 60, r.top + r.height / 2);
  await wait(150);
  renderSessionList(null); // a forced rerender (an identical session payload is skipped as unchanged)
  ok(!document.contains(t), "the header the press started on was replaced");
  await wait(700);
  ok(!ctxMenu() && !store.get("sessionFolderContext").press && !store.get("sessionFolderContext").held, "no stale menu and no leftover press state after a rerender");
  // project switch while the finger is held: menu closed, hold released, later release adds no window
  t = toggleOf(f.one); r = t.getBoundingClientRect();
  touch("pointerdown", t, r.left + 60, r.top + r.height / 2);
  await wait(650);
  ok(ctxMenu() && store.get("sessionFolderContext").held, "held again");
  store.set({ currentSlug: "elsewhere" });
  ok(!ctxMenu() && store.get("sessionFolderContext").held === null, "project change releases the hold and closes the menu");
  touch("pointerup", t, r.left + 60, r.top + 5);
  ok(store.get("sessionFolderContext").suppressUntil === 0, "listeners are gone: a later release changes nothing");
  store.set({ currentSlug: "proj" });
});

test("manual drag reorder in a folder; Favorites keep their order under title sort", async function () {
  await freshWorld();
  drag(row(1), section("favorites")); await sync();
  drag(row(2), section("favorites")); await sync();
  ok(titlesIn("favorites").join() === "1,2", "Favorites order 1,2");
  await openView();
  click($("[data-focus-key='sort:title']")); await sync();
  click($("[data-focus-key='direction:desc']")); await sync();
  await closeView();
  ok(titlesIn("favorites").join() === "1,2", "Favorites unaffected by Z to A: " + titlesIn("favorites"));
  // manual sort in Unfiled: only unfiled now has 3 alone; create folder and reorder two
  await newFolderViaDialog("Box");
  var box = folderIdByLabel("Box");
  drag(row(3), section(box)); await sync();
  await openView();
  click($("[data-focus-key='sort:manual']")); await sync();
  await closeView();
  drag(row(1), section("unfiled")); drag(row(2), section("unfiled")); await sync();
  ok(titlesIn("unfiled").length === 2, "two in unfiled: " + titlesIn("unfiled"));
  var first = titlesIn("unfiled")[0], second = titlesIn("unfiled")[1];
  drag(row(second), unit(first), { fraction: 0.1 }); await sync();
  ok(titlesIn("unfiled").join() === second + "," + first, "manual reorder applied: " + titlesIn("unfiled"));
  await freshWorldKeepingStore();
  ok(titlesIn("unfiled").join() === second + "," + first, "manual order survives reload");
});

test("search inside a collapsed folder reveals matches; clearing restores collapse", async function () {
  await freshWorld();
  await newFolderViaDialog("Hidden");
  var id = folderIdByLabel("Hidden");
  drag(row(1), section(id)); await sync();
  click($(".session-folder-toggle", section(id))); await sync();
  ok($(".session-folder-body", section(id)).hidden === true, "collapsed");
  click(magnifier()); await sync();
  typeInto(searchInput(), "Alpha");
  handleSearchResults({ query: "Alpha", results: [{ id: 1 }] });
  await sync();
  ok($(".session-folder-body", section(id)).hidden === false, "search expands the folder");
  ok(titlesIn(id).join() === "1", "match visible: " + titlesIn(id));
  ok(!unit(2) && !unit(3), "non matches hidden");
  ok(!section("unfiled"), "empty sections hidden while searching");
  click($("[aria-label='Close search']")); await sync();
  ok($(".session-folder-body", section(id)).hidden === true, "collapse restored after search");
});

test("cross-user and cross-project rejection through the production handler", async function () {
  await freshWorld();
  var outbox = await rpc("/rpc", { socket: "u2", msg: { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: "favorites" } } });
  ok(outbox[0].msg.error === "Session not found", "u2 cannot file u1's session: " + outbox[0].msg.error);
  ok(Object.keys(outbox[0].msg.state.assignments).length === 0, "u2 sees nothing of u1");
  outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "other", op: { op: "create_folder", name: "Nope" } } });
  ok(/different project/.test(outbox[0].msg.error), "wrong project refused");
  var s = await stored();
  ok(!s || s.folders.length === 0, "nothing stored");
  // stale tab: client switches project while a snapshot for the old project is in flight
  store.set({ currentSlug: "other" });
  ok(store.get("sessionFolders") === null, "state reset on project change");
  handleSessionFoldersState({ type: "session_folders_state", slug: "proj", state: { folders: [{ id: "f_aaaaaa", name: "Old" }], assignments: {}, orders: {}, collapsed: {}, view: { group: "folders", sort: "activity", direction: "desc" } } });
  ok(store.get("sessionFolders") === null, "stale snapshot for another project ignored");
  store.set({ currentSlug: "proj" });
});

test("open dialogs and menus close on project switch", async function () {
  await freshWorld();
  click($(".session-folder-move-btn", row(1)));
  ok($(".session-folder-modal"), "picker open");
  store.set({ currentSlug: "elsewhere" });
  ok(!$(".session-folder-modal"), "picker closed on project change");
  store.set({ currentSlug: "proj" });
  await freshWorld();
  await newFolderViaDialog("M");
  ctxAt(folderIdByLabel("M"));
  ok($(".session-folder-menu"), "menu open");
  store.set({ dmMode: true });
  ok(!$(".session-folder-menu"), "menu closed on DM transition");
  store.set({ dmMode: false });
});

test("same-user second socket receives the update; other user does not", async function () {
  await freshWorld();
  otherSocketInbox.length = 0;
  drag(row(1), section("favorites")); await sync();
  var toSecond = otherSocketInbox.filter(function (e) { return e.to === "u1-b"; });
  var toOther = otherSocketInbox.filter(function (e) { return e.to === "u2-a"; });
  ok(toSecond.length === 1 && toSecond[0].msg.state.assignments[1] === "favorites", "second u1 socket got the snapshot");
  ok(toOther.length === 0, "u2 got nothing");
});

(async function run() {
  createStore({ connected: true, currentSlug: "proj", splitGroups: [], splitPanes: null, installedVendors: ["claude"], defaultVendorState: null, permissions: null, isMultiUserMode: true, myUserId: "u1", dmMode: false, sessionFolders: null, sessionFoldersSlug: null, sessionFolderCreate: null, sessionFolderViewMenu: null, sessionFolderMenu: null, sessionFolderContext: null, sessionSearch: null, sessionFolderLayouts: {}, sessionFolderDrag: null, sessionFolderMenu: null, sessionFolderModal: null });
  // sidebar.js still reads a legacy context for the page title; hand it real
  // elements where the sidebar needs them and inert ones elsewhere.
  var inert = new Proxy({ sessionListEl: document.getElementById("session-list"), $: function (id) { return document.getElementById(id); } }, {
    get: function (target, key) { return key in target ? target[key] : document.createElement("div"); },
  });
  try { initSidebar(inert); } catch (e) { report.textContent += "initSidebar partial: " + e.message + "\n"; }
  try { initMisc(); } catch (e) { /* only the confirm listeners are needed here */ }
  // ?only=text runs just the scenarios whose name contains the text (for quick iterations).
  var only = new URLSearchParams(location.search).get("only");
  if (only) tests = tests.filter(function (t) { return t.name.indexOf(only) !== -1; });
  var failures = 0;
  for (var i = 0; i < tests.length; i++) {
    var line;
    try { await tests[i].fn(); line = '<span class="pass">PASS</span> ' + tests[i].name; }
    catch (e) { failures++; line = '<span class="fail">FAIL</span> ' + tests[i].name + "\n      " + String(e.message).replace(/</g, "&lt;"); }
    results.push(line);
    report.innerHTML = results.join("\n");
  }
  var summary = failures ? "FAILED " + failures + " of " + tests.length : "ALL " + tests.length + " PASSED";
  report.innerHTML = results.join("\n") + "\n\n<b>" + summary + "</b>";
  document.title = "session folders harness: " + summary;
})();
