// Drives the production client modules with real DOM events. Server messages go
// through the production handler via /rpc (see serve.js).
import { store, createStore } from '/modules/store.js';
import { getWs, setWs } from '/modules/ws-ref.js';
import { renderSessionList, handleSearchResults, updateSessionPresence } from '/modules/sidebar-sessions.js';
import { initSidebar, clearDustParticles } from '/modules/sidebar.js';
import { renderMobileSessionsInto, openMobileSheet } from '/modules/sidebar-mobile.js';
import { captureFolderInputs } from '/modules/session-folder-toolbar.js';
import { handleSessionFoldersState } from '/modules/session-folders.js';
import { handleFolderDeletePreview, handleFolderDeleteState, openFolderDelete } from '/modules/session-folder-delete.js';
import { handleSessionCreateMessage, handleNewSessionResult, openSessionCreate, expectCreatedSession } from '/modules/session-create.js';
import { clearSidebarCreationEffects, queueSidebarCreationEffect } from '/modules/sidebar-creation-effect.js';
import { initMisc } from '/modules/app-misc.js';
import { initNotifications } from '/modules/notifications.js';
import { refreshIcons } from '/modules/icons.js';

var report = document.getElementById("report");
var results = [];
var wsLog = [];
var socket = "u1";
var otherSocketInbox = [];
var wsDelayMs = 0;
var dropPreview = false;

var BASE_SESSIONS = [
  { id: 1, title: "Alpha", lastActivity: 1001, createdAt: 3, vendor: "claude", sessionRole: "driver" },
  { id: 2, title: "Beta", lastActivity: 1002, createdAt: 2, vendor: "claude", sessionRole: "driver" },
  { id: 3, title: "Driver", lastActivity: 1003, createdAt: 1, vendor: "claude", sessionRole: "driver", ownedWorkerCount: 2 },
  { id: 4, title: "Worker one", lastActivity: 1004, createdAt: 4, vendor: "codex", sessionRole: "worker", parentSessionId: 3, parentAvailable: true, workerGeneration: 1 },
  { id: 5, title: "Worker two", lastActivity: 1005, createdAt: 5, vendor: "codex", sessionRole: "worker", parentSessionId: 3, parentAvailable: true, workerGeneration: 2 },
];
var SESSIONS = BASE_SESSIONS.map(function (session) { return Object.assign({}, session); });

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function mobileFixtureFrame(id, width, height) {
  var frame = document.createElement("iframe");
  frame.id = id;
  frame.title = "Mobile session folder fixture";
  frame.style.cssText = "position:fixed;right:0;top:0;width:" + width + "px;height:" + height + "px;border:1px solid var(--border);z-index:20;background:var(--sidebar-bg,#171717)";
  var themeClass = new URLSearchParams(location.search).get("theme") === "light" ? ' class="light-theme"' : "";
  frame.srcdoc = '<!doctype html><html' + themeClass + '><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>html,body{margin:0;height:100%;background:var(--sidebar-bg,#171717)}#mobile-fixture-host{height:100%;overflow-y:auto;padding:8px;box-sizing:border-box}</style></head><body><div id="mobile-fixture-host"></div></body></html>';
  var loaded = new Promise(function (resolve) { frame.addEventListener("load", resolve, { once: true }); });
  document.body.appendChild(frame);
  await loaded;
  return { frame: frame, host: frame.contentDocument.getElementById("mobile-fixture-host") };
}
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
function unitIn(sectionId, id, root) { return $('.session-folder[data-folder-id="' + sectionId + '"] .session-folder-unit[data-unit-key="' + id + '"]', root); }
function rowIn(sectionId, id, root) { return $('.session-folder[data-folder-id="' + sectionId + '"] [data-session-id="' + id + '"]', root); }
function starIn(sectionId, id, root) { return $(root ? ".mobile-session-star" : ".session-folder-star-btn", rowIn(sectionId, id, root)); }
function boxesIntersect(a, b) {
  var ar = a.getBoundingClientRect();
  var br = b.getBoundingClientRect();
  return ar.left < br.right && ar.right > br.left && ar.top < br.bottom && ar.bottom > br.top;
}
function titlesIn(sectionId) { return $$(".session-folder-unit", section(sectionId)).map(function (u) { return u.dataset.unitKey; }); }
function sectionLabels() { return $$(".session-folder-label").map(function (l) { return l.textContent; }); }
function click(el) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }
function clickAt(el, x, y) { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y })); }
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
    if (entry.to === from) {
      if (entry.msg.type === "session_folders_state") { handleSessionFoldersState(entry.msg); handleFolderDeleteState(entry.msg); }
      if (entry.msg.type === "session_folders_delete_preview_result") handleFolderDeletePreview(entry.msg);
      if (handleSessionCreateMessage(entry.msg)) return;
      if (entry.msg.type === "new_session_result") {
        if (entry.msg.ok) {
          // The production client would receive session_list and session_switched.
          SESSIONS.push({ id: entry.msg.sessionId, title: "Created " + entry.msg.sessionId, lastActivity: 2000 + entry.msg.sessionId, createdAt: 9, vendor: "claude", sessionRole: "driver" });
          store.set({ activeSessionId: entry.msg.sessionId });
        }
        handleNewSessionResult(entry.msg);
        if (entry.msg.ok) renderAll();
      }
    }
    else otherSocketInbox.push(entry);
  });
}
function fakeWs(from) {
  return {
    readyState: 1,
    send: function (raw) {
      var msg = JSON.parse(raw);
      wsLog.push(msg);
      var routed = /^new_session/.test(msg.type) || msg.type === "session_folders_op" || msg.type === "session_folders_get" || msg.type === "session_folders_delete" || msg.type === "session_folders_delete_preview";
      if (routed && !(dropPreview && msg.type === "session_folders_delete_preview")) {
        var delay = msg.type === "session_folders_delete" || msg.type === "new_session" ? wsDelayMs : 0;
        wait(delay).then(function () { return rpc("/rpc", { socket: from, msg: msg }); }).then(function (outbox) { deliver(outbox, from === "u1" ? "u1-a" : from === "u1b" ? "u1-b" : "u2-a"); });
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
  clearSidebarCreationEffects();
  clearDustParticles("folder-delete-dust");
  await rpc("/rpc/reset", {});
  wsDelayMs = 0;
  dropPreview = false;
  SESSIONS.length = 0;
  for (var si = 0; si < BASE_SESSIONS.length; si++) SESSIONS.push(Object.assign({}, BASE_SESSIONS[si]));
  wsLog.length = 0;
  otherSocketInbox.length = 0;
  socket = "u1";
  setWs(fakeWs("u1"));
  $$(".session-folder-viewmenu, .session-folder-modal, .session-folder-menu").forEach(function (e) { e.remove(); });
  store.set({ sessionFolders: null, sessionFoldersSlug: null, sessionFolderCreate: null, sessionFolderViewMenu: null, sessionFolderMenu: null, sessionFolderContext: null, sessionFolderDrag: null, sessionFolderDelete: null, sessionFolderModal: null, sessionCreate: null, sessionCreateOptions: null, sessionCreateCatalogs: {}, sessionCreateReveal: null, sidebarCreationEffects: [], sessionPresence: {}, activeSessionId: null, sessionSearch: null, currentSlug: "proj", connected: true, splitGroups: [], dmMode: false });
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
function delDialog() { return $(".session-folder-modal[data-modal-kind='delete-folder']"); }
function deleteOption(mode) { return $("[data-mode='" + mode + "']", delDialog()); }
function deletePrimary() { var bar = $$(".confirm-btn", delDialog()); return bar[bar.length - 1]; }
function deleteCancel() { return $$(".confirm-btn", delDialog())[0]; }
async function openDelete(id) {
  ctxAt(id);
  var items = $$(".session-folder-menu button");
  click(items[items.length - 1]);
  await until(function () { return delDialog() && ($("[data-mode]", delDialog()) || $(".session-folder-delete-intro", delDialog())); }, "delete dialog ready");
}
async function serverSessions() { return (await (await fetch("/rpc/sessions")).json()).join(); }
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
function openSessionMove(id) {
  var target = row(id);
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
  var move = $$(".session-ctx-menu .session-ctx-item").filter(function (item) { return /Move to folder/.test(item.textContent); })[0];
  ok(move, "context menu retains Move to folder for session " + id);
  click(move);
}
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
  await until(function () { return $(".session-folder-body", section(folderIdByLabel("Three"))).hidden; }, "fixture folder collapse");
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
  ok(sticky && $(".session-folder-toolbar", sticky) && !$(".session-top-actions") && !$("#session-top-actions-host"), "no global creation control; New folder/View sit in the block above the list");
  ok(!$(".session-favorites-divider"), "no Favorites divider");
  ok(fav.parentElement === section("unfiled").parentElement && fav.parentElement.parentElement === list, "Favorites shares the list container with the other folders");
  var siblings = $$(".session-folder", fav.parentElement).map(function (e) { return e.dataset.folderId; });
  ok(siblings[0] === "favorites" && siblings[siblings.length - 1] === "unfiled", "Favorites first, Unfiled last: " + siblings);
  var favBody = $(".session-folder-body", fav);
  var favStyle = getComputedStyle(favBody);
  ok(favStyle.maxHeight === "none" && favStyle.overflowY === "visible", "Favorites has no internal scroll rule: " + favStyle.maxHeight + "/" + favStyle.overflowY);
  ok(getComputedStyle(fav).position !== "sticky" && getComputedStyle(fav).margin === getComputedStyle(section("unfiled")).margin, "Favorites uses the same spacing as other folders");
  ok(!newBtn("favorites") && newBtn("unfiled"), "Favorites has no New session action; Unfiled does");
  var alphaStar = starIn("unfiled", 1);
  ok(alphaStar && alphaStar.getAttribute("aria-pressed") === "false" && /Add to Favorites/.test(alphaStar.getAttribute("aria-label")), "an eligible root has an accessible outlined star");
  ok(!row(4).getAttribute("draggable") && !$(".session-folder-move-btn", row(4)), "Workers have no drag or move control");
});

test("drag onto Favorites tags without moving, then reorder the curated tag view", async function () {
  await freshWorld();
  drag(row(1), section("favorites"));
  await sync();
  ok(titlesIn("favorites").join() === "1", "Alpha in Favorites: " + titlesIn("favorites"));
  ok(titlesIn("unfiled").includes("1"), "Alpha also stays in Unfiled");
  drag(rowIn("unfiled", 2), unitIn("favorites", 1), { fraction: 0.1 });
  await sync();
  ok(titlesIn("favorites").join() === "2,1", "Beta dropped above Alpha: " + titlesIn("favorites"));
  ok(titlesIn("unfiled").includes("1") && titlesIn("unfiled").includes("2"), "both actual placements remain Unfiled");
  var s = await stored();
  ok(s.favorites.join() === "origin-2,origin-1", "persisted curated order " + JSON.stringify(s.favorites));
  ok(!JSON.stringify(wsLog).includes("origin-"), "client never sent a durable key");
});

test("dragging a favorite to a real folder preserves its tag; the star removes it everywhere", async function () {
  await freshWorld();
  drag(row(1), section("favorites")); await sync();
  drag(rowIn("favorites", 1), section("unfiled")); await sync();
  ok(titlesIn("favorites").join() === "1" && titlesIn("unfiled").includes("1"), "dragging out keeps the tag and real placement");
  var copies = $$('.session-item[data-session-id="1"]');
  ok(copies.length === 2 && copies.every(function (copy) {
    var star = $(".session-folder-star-btn", copy);
    return star && star.getAttribute("aria-pressed") === "true" && star.classList.contains("is-favorite");
  }), "both desktop representations show the filled, pressed star");
  SESSIONS[0].active = true;
  await renderAll();
  ok($$('.session-item.active[data-session-id="1"]').length === 2, "active focus is reflected on both rendered copies");
  SESSIONS[0].active = false;
  click(starIn("favorites", 1)); await sync();
  ok(titlesIn("favorites").length === 0 && titlesIn("unfiled").includes("1"), "unstar removes only the tag");
  ok(starIn("unfiled", 1).getAttribute("aria-pressed") === "false" && /Add to Favorites/.test(starIn("unfiled", 1).getAttribute("aria-label")), "the surviving copy returns to an outlined star");
  var before = wsLog.length;
  click(starIn("unfiled", 2)); await sync();
  ok(titlesIn("favorites").join() === "2", "Beta accepted into Favorites: " + titlesIn("favorites"));
  ok(!$$(".toast-warn").length, "no error toast");
  var s = await stored();
  ok(s.favorites.join() === "origin-2", "Favorites order has no stale member " + JSON.stringify(s.favorites));
  ok(wsLog.slice(before).filter(function (m) { return m.op && m.op.op === "set_favorite"; }).length === 1, "one tag operation from the star");
});

test("mobile stars are touch-sized, accessible and synchronize both representations", async function () {
  await freshWorld();
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:0;top:0;width:360px;height:100vh;overflow:auto;background:#222;z-index:5";
  document.body.appendChild(host);
  try {
    renderMobileSessionsInto(host);
    var star = starIn("unfiled", 1, host);
    ok(star && star.getBoundingClientRect().width >= 40 && star.getBoundingClientRect().height >= 40, "outlined mobile star has a touch-sized target");
    ok(star.getAttribute("aria-pressed") === "false" && /Add to Favorites/.test(star.getAttribute("aria-label")), "outlined mobile star exposes its action");
    click(star); await sync();
    host.innerHTML = ""; renderMobileSessionsInto(host);
    var favoriteStar = starIn("favorites", 1, host);
    var actualStar = starIn("unfiled", 1, host);
    ok(favoriteStar && actualStar && favoriteStar.classList.contains("is-favorite") && actualStar.classList.contains("is-favorite"), "both mobile copies show filled stars");
    ok(favoriteStar.getAttribute("aria-pressed") === "true" && actualStar.getAttribute("aria-pressed") === "true", "both mobile copies expose pressed state");
    click(favoriteStar); await sync();
    host.innerHTML = ""; renderMobileSessionsInto(host);
    ok(!unitIn("favorites", 1, host) && starIn("unfiled", 1, host).getAttribute("aria-pressed") === "false", "unstar removes only the favorite copy and restores the outline");
  } finally {
    host.remove();
  }
});

test("session row metadata, age and actions have dedicated non-overlapping layout", async function () {
  await freshWorld();
  var sidebar = document.getElementById("sidebar");
  var previousWidth = sidebar.style.width;
  var previousMinWidth = sidebar.style.minWidth;
  var previousAlpha = Object.assign({}, SESSIONS[0]);
  var previousDriver = Object.assign({}, SESSIONS[2]);
  var linkedWork = [{
    url: "https://github.com/clay/clay/pull/570", repository: "clay/clay", kind: "pr", number: 570,
    title: "Keep compact session actions clear of metadata", state: "open",
  }];
  SESSIONS[0].title = "A very long ordinary session title that must truncate";
  SESSIONS[0].lastActivity = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  SESSIONS[0].githubLinks = linkedWork;
  SESSIONS[2].title = "A very long Driver session title with Workers";
  SESSIONS[2].lastActivity = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  SESSIONS[2].githubLinks = linkedWork;
  await renderAll();
  drag(rowIn("unfiled", 1), section("favorites"));
  drag(rowIn("unfiled", 3), section("favorites"));
  await sync();

  try {
    [280, 320].forEach(function (width) {
      sidebar.style.width = width + "px";
      sidebar.style.minWidth = width + "px";
      [1, 3].forEach(function (id) {
        var sessionRow = rowIn("favorites", id);
        var age = $(".session-item-age", sessionRow);
        var star = $(".session-folder-star-btn", sessionRow);
        var remove = $(".session-close-btn", sessionRow);
        var metadata = $(".session-work-column", sessionRow);
        ok(age && /d ago$/.test(age.textContent), width + "/" + id + ": realistic relative age is rendered: " + (age && age.textContent));
        ok(metadata && metadata.getBoundingClientRect().right <= age.getBoundingClientRect().left + 0.5, width + "/" + id + ": title and linked-work metadata stop before age");
        ok(!boxesIntersect(age, star), width + "/" + id + ": age does not intersect the favorite star");
        ok(!$(".session-folder-move-btn", sessionRow), width + "/" + id + ": no row-level Move button");
        ok(!boxesIntersect(star, remove), width + "/" + id + ": star and delete controls have separate slots");
        star.focus();
        age.getAnimations().forEach(function (animation) { animation.finish(); });
        ok(getComputedStyle(age).opacity === "0", width + "/" + id + ": focusing the action cluster hides age without moving controls over it");
        ok(star.getBoundingClientRect().right <= sessionRow.getBoundingClientRect().right + 0.5 && remove.getBoundingClientRect().right <= sessionRow.getBoundingClientRect().right + 0.5, width + "/" + id + ": action cluster stays inside the row");
      });
      var unstarred = rowIn("unfiled", 2);
      var unstarredAge = $(".session-item-age", unstarred);
      var unstarredStar = $(".session-folder-star-btn", unstarred);
      unstarredStar.focus();
      ok(!boxesIntersect(unstarredAge, unstarredStar), width + ": focused unstarred row reserves the same age/action boundary");
    });
  } finally {
    sidebar.style.width = previousWidth;
    sidebar.style.minWidth = previousMinWidth;
    Object.assign(SESSIONS[0], previousAlpha);
    Object.assign(SESSIONS[2], previousDriver);
    await renderAll();
  }
});

test("presence occupies title-adjacent layout and live updates every duplicate row", async function () {
  await freshWorld();
  var previousAlpha = Object.assign({}, SESSIONS[0]);
  SESSIONS[0].title = "A deliberately long session title beside metadata and presence";
  SESSIONS[0].githubLinks = [{ url: "https://github.com/clay/clay/pull/570", repository: "clay/clay", kind: "pr", number: 570, title: "Presence layout", state: "open" }];
  await renderAll();
  drag(rowIn("unfiled", 1), section("favorites")); await sync();
  var viewers = [
    { id: "a", displayName: "Ada", avatarStyle: "imprint", avatarSeed: "a" },
    { id: "b", displayName: "Ben", avatarStyle: "bottts", avatarSeed: "b" },
    { id: "c", displayName: "Cia", avatarStyle: "thumbs", avatarSeed: "c" },
    { id: "d", displayName: "Dee", avatarStyle: "shapes", avatarSeed: "d" },
    { id: "e", displayName: "Eli", avatarStyle: "rings", avatarSeed: "e" },
  ];
  updateSessionPresence({ 1: viewers, 3: viewers.slice(0, 2) });
  [280, 320].forEach(function (width) {
    var sidebar = document.getElementById("sidebar");
    sidebar.style.width = width + "px"; sidebar.style.minWidth = width + "px";
    [rowIn("favorites", 1), rowIn("unfiled", 1), rowIn("unfiled", 3)].forEach(function (sessionRow) {
      var presence = $(".session-presence", sessionRow);
      var actions = $(".session-row-actions", sessionRow);
      var work = $(".session-work-column", sessionRow);
      ok(presence && getComputedStyle(presence).position === "static", width + ": presence is in row flow");
      if (work) ok(work.getBoundingClientRect().right <= presence.getBoundingClientRect().left + 0.5 && work.getBoundingClientRect().width >= 44, width + ": title and metadata retain ellipsis space before presence");
      ok(!actions || presence.getBoundingClientRect().right <= actions.getBoundingClientRect().left + 0.5, width + ": presence stops before actions");
      ok(presence.getBoundingClientRect().right <= sessionRow.getBoundingClientRect().right + 0.5, width + ": presence stays inside row");
    });
  });
  var favoritePresence = $(".session-presence", rowIn("favorites", 1));
  ok($$(".session-presence-avatar", favoritePresence).length === 3 && $(".session-presence-more", favoritePresence).textContent === "+2", "three avatars plus a bounded overflow count");
  updateSessionPresence({ 1: [viewers[0]] });
  ok([rowIn("favorites", 1), rowIn("unfiled", 1)].every(function (sessionRow) { return $$(".session-presence-avatar", sessionRow).length === 1 && !$(".session-presence-more", sessionRow); }), "live update replaces presence in both favorite and actual copies");
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:320px";
  document.body.appendChild(host);
  renderMobileSessionsInto(host);
  var mobileRow = rowIn("favorites", 1, host);
  ok($(".session-presence", mobileRow) && !$(".mobile-session-move", host), "mobile renders title-adjacent presence with no Move button");
  mobileRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
  var mobileMove = $$(".session-ctx-menu .session-ctx-item").filter(function (item) { return /Move to folder/.test(item.textContent); })[0];
  ok(mobileMove, "mobile context menu retains Move to folder");
  click(mobileMove); ok($(".session-folder-modal"), "mobile context Move opens the existing picker");
  keydown(document.activeElement, "Escape");
  host.remove();
  Object.assign(SESSIONS[0], previousAlpha);
  await renderAll();
  document.getElementById("sidebar").style.width = ""; document.getElementById("sidebar").style.minWidth = "";
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
  openSessionMove(3);
  ok($(".session-folder-modal"), "picker open");
  ok(!pickerChoice("Favorites") && pickerChoice("Unfiled") && pickerChoice("New folder"), "picker lists only real destinations");
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
  openSessionMove(1);
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
  await until(function () { var v = formSelect("vendor", section(one)); return v && !v.disabled; }, "provider list loaded");
  ok(!wsLog.slice(before).some(function (m) { return m.type === "new_session"; }), "New session here sends nothing yet");
  ok($(".session-create-row", section(one)) && $(".session-create-row", section(one)).dataset.folderId === one, "it opens the same inline draft row under that folder header");
  keydown(document.activeElement, "Escape");
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
  await until(function () { return delDialog() && deleteOption("unfiled"); }, "delete dialog");
  ok(deleteOption("unfiled").getAttribute("aria-checked") === "true", "default choice is Move to Unfiled");
  click(deletePrimary()); await sync();
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
  ok(viewMenu().contains(document.activeElement) && document.activeElement.dataset.focusKey === "sort:activity", "focus on the selected sort");
  ok(!$("[data-focus-key^='group:']") && !/Group by/.test(viewMenu().textContent), "there is no grouping selector");
  var rect = viewMenu().getBoundingClientRect(), anchor = viewBtn.getBoundingClientRect();
  ok(rect.top >= anchor.bottom && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight, "anchored below the button and inside the viewport");
  // immediate update with menu staying open; ArrowDown moves selection and keeps focus
  keydown(document.activeElement, "ArrowDown"); await sync();
  ok(document.activeElement.dataset.focusKey === "sort:created" && section("unfiled") && !$(".session-folder-flat"), "sort applied immediately, folders stay, focus kept: " + document.activeElement.dataset.focusKey);
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
  ok($$("[data-focus-key^='direction:']").map(function (b) { return b.textContent.trim(); }).join() === "Newest,Oldest", "created directions");
  click($("[data-focus-key='direction:asc']")); await sync();
  ok(unitOrder() === "3,2,1", "oldest first: " + unitOrder());
  $("[data-focus-key='sort:manual']").focus();
  click($("[data-focus-key='sort:manual']")); await sync();
  ok(!$("[data-focus-key^='direction:']") && viewMenu().contains(document.activeElement), "Manual hides direction, focus stays inside");
  // a legacy client still asking for a flat or date layout changes nothing visible
  var legacyOut;
  for (var legacyGroup of ["none", "dates"]) {
    legacyOut = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_view", group: legacyGroup } } });
    deliver(legacyOut, "u1-a"); await sync();
    ok(section("favorites") && section("unfiled") && !$(".session-folder-flat") && (await stored()).view.group === "folders", "legacy " + legacyGroup + " keeps the folder layout");
  }
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
  ok(persisted.view.group === "folders" && persisted.view.sort === "title", "view persisted: " + JSON.stringify(persisted.view));
});

function pointerAt(target, type, extra) {
  var e = new PointerEvent(type, Object.assign({ bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true, button: 0 }, extra || {}));
  target.dispatchEvent(e);
  return e;
}

test("View dropdown dismissal: pointerdown-only surfaces, touch, blur, inside, toggle, compact size", async function () {
  await freshWorld();
  var guard = document.getElementById("pointer-guard");
  var outsideInput = document.createElement("input");
  outsideInput.id = "outside-input"; outsideInput.style.cssText = "position:fixed;left:320px;bottom:4px;z-index:5";
  document.body.appendChild(outsideInput);
  var seenMouse = 0;
  document.addEventListener("mousedown", function counter() { seenMouse++; }, true);
  try {
    // compact desktop geometry: ~216px wide, short rows, segmented direction control
    await openView();
    var rect = viewMenu().getBoundingClientRect();
    ok(rect.width >= 200 && rect.width <= 224, "compact desktop width: " + rect.width);
    var rowHeights = $$(".session-folder-radio", viewMenu()).map(function (r) { return r.getBoundingClientRect().height; });
    ok(Math.max.apply(null, rowHeights) <= 30, "compact rows: " + rowHeights);
    ok($(".session-folder-radio-group.segmented", viewMenu()) && !$$(".session-folder-radio-legend", viewMenu()).some(function (l) { return /Direction/.test(l.textContent); }), "direction is one segmented row");
    ok(!/Group by/.test(viewMenu().textContent), "still no grouping selector");
    ok(section("unfiled"), "folders stay while the menu is open");

    // the reproduced miss: a surface that cancels pointerdown, so the browser sends no mousedown/touchstart
    var mouseBefore = seenMouse;
    var pd = pointerAt(guard, "pointerdown");
    ok(pd.defaultPrevented && seenMouse === mouseBefore, "guard cancels pointerdown and emits no mousedown");
    await sync();
    ok(!viewMenu() && viewButton().getAttribute("aria-expanded") === "false", "pointerdown-only outside press closes the menu");

    // each other route on its own
    var routes = [
      ["mousedown only", function () { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }],
      ["touchstart only", function () { $("#report").dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true })); }],
      ["pointerdown on the list", function () { pointerAt($("#session-list"), "pointerdown"); }],
      ["window blur (focus moved into an iframe or another window)", function () { window.dispatchEvent(new Event("blur")); }],
      ["pointerdown on text outside", function () { pointerAt(document.getElementById("report"), "pointerdown"); }],
    ];
    for (var i = 0; i < routes.length; i++) {
      await openView();
      routes[i][1]();
      await sync();
      ok(!viewMenu() && viewButton().getAttribute("aria-expanded") === "false", routes[i][0] + " closes the menu");
    }

    // clicking another control keeps that control's action and focus
    await openView();
    pointerAt(outsideInput, "pointerdown"); outsideInput.focus();
    await sync();
    ok(!viewMenu() && document.activeElement === outsideInput, "outside press closes the menu without stealing focus from the clicked control");
    var clicked = 0;
    guard.addEventListener("click", function () { clicked++; });
    await openView();
    pointerAt(guard, "pointerdown"); click(guard);
    ok(clicked === 1 && !viewMenu(), "the clicked outside control still receives its click");

    // inside interaction never dismisses
    await openView();
    var radio = $(".session-folder-radio:not(.selected)", viewMenu());
    pointerAt(radio, "pointerdown"); radio.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); radio.dispatchEvent(new Event("touchstart", { bubbles: true }));
    await sync();
    ok(viewMenu(), "inside press keeps the menu open");
    pointerAt(viewMenu(), "pointerdown");
    ok(viewMenu(), "padding inside the menu keeps it open");

    // View button: its own press does not close early, its click toggles once, no immediate reopen
    pointerAt(viewButton(), "pointerdown"); viewButton().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    ok(viewMenu(), "View button press does not close before its click");
    click(viewButton()); await sync();
    ok(!viewMenu(), "View button click closes it");
    await wait(300);
    ok(!viewMenu(), "does not reopen by itself");
    click(viewButton()); await sync();
    ok(viewMenu() && $$(".session-folder-viewmenu").length === 1, "reopens exactly once on the next click");

    // Escape returns focus to the button; listeners are gone afterwards
    keydown(document.activeElement, "Escape"); await sync();
    ok(!viewMenu() && document.activeElement === viewButton(), "Escape closes and returns focus");
    pointerAt(guard, "pointerdown"); window.dispatchEvent(new Event("blur"));
    ok(!viewMenu() && !store.get("sessionFolderViewMenu"), "stray outside events after close do nothing");

    // DM transition and project switch close it too
    await openView();
    store.set({ dmMode: true }); ok(!viewMenu(), "closes on DM transition"); store.set({ dmMode: false });
    await sync();
    await openView();
    store.set({ currentSlug: "elsewhere" }); ok(!viewMenu(), "closes on project change"); store.set({ currentSlug: "proj" });
  } finally {
    outsideInput.remove();
  }
});

test("creation shimmer on mobile: inline folder success targets the visible title and keeps touch controls intact", async function () {
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
  await until(function () { return $(".session-folder-label.sidebar-creation-shimmer", host); }, "mobile folder title shimmer");
  ok($(".session-folder-label.sidebar-creation-shimmer", host) && !$(".sidebar-creation-particle, .sidebar-creation-particle-layer, .sidebar-creation-settle"), "visible mobile folder title alone receives the shimmer");
  // The harness page has no mobile CSS, so the vendor picker is tall; bring the toolbar into view as a user would.
  $("[data-view-button='mobile']", host).scrollIntoView({ block: "center" });
  click($("[data-view-button='mobile']", host)); await sync();
  var menu = viewMenu();
  var r = menu.getBoundingClientRect();
  ok(menu && r.left >= 8 - 0.5 && r.right <= window.innerWidth - 8 + 0.5 && r.bottom <= window.innerHeight, "mobile dropdown clamped inside the viewport: " + JSON.stringify([r.left, r.right, r.bottom, window.innerWidth]));
  ok(menu.classList.contains("is-mobile") && r.width <= 250, "mobile dropdown is compact but flagged for touch: " + r.width);
  var mobileRows = $$(".session-folder-radio", menu).map(function (b) { return b.getBoundingClientRect().height; });
  ok(Math.min.apply(null, mobileRows) >= 40, "touch targets stay at least 40px: " + mobileRows);
  ok(!$("[data-focus-key^='group:']", menu), "no grouping selector on mobile");
  // outside press on the phone list: touch-style event order (pointerdown, touchstart), and a pointerdown-only press
  pointerAt($(".session-folder-label", host), "pointerdown", { pointerType: "touch" });
  await sync();
  ok(!viewMenu() && $("[data-view-button='mobile']", host).getAttribute("aria-expanded") === "false", "touch press outside closes the mobile dropdown");
  click($("[data-view-button='mobile']", host)); await sync();
  ok(viewMenu(), "mobile dropdown reopens");
  host.dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true })); await sync();
  ok(!viewMenu(), "touchstart-only outside press closes it too");
  click($("[data-view-button='mobile']", host)); await sync();
  pointerAt(viewMenu().querySelector(".session-folder-radio"), "pointerdown", { pointerType: "touch" });
  ok(viewMenu(), "touch inside keeps it open");
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
  ok(labels.length >= 1 && labels.every(function (l) { var r = l.getBoundingClientRect(); return r.width <= 1 && r.height <= 1; }), "the Sessions label is not visible but stays in the DOM for assistive tech");
  ok($(".tool-shortcut") && $("#session-actions").getAttribute("aria-label") === "Tools" && !$(".sidebar-tools-header") && !$(".sidebar-tools-hint") && !$(".tool-palette-edit-btn"), "tool shortcuts stay with an accessible Tools label; the hotkey hint, pencil and empty header row are gone");
  ok(!$("#session-top-actions-host") && !$(".session-top-action") && !$("#session-header-search-btn") && !$("#session-header-search-inline") && !$("#session-filter-count"), "no global Create new session control, and the old header search and its row are gone");
  ok($$(".session-folder").length === 2 && !newBtn("favorites") && newBtn("unfiled"), "only real folder headers have a New session button");
  var bar = $(".session-folder-toolbar").getBoundingClientRect();
  var nf = $("[data-new-folder-button='desktop']").getBoundingClientRect(), vw = $("[data-view-button='desktop']").getBoundingClientRect(), mg = magnifier().getBoundingClientRect();
  ok(nf.left < vw.left && vw.left < mg.left && mg.right <= bar.right + 0.5 && Math.abs((mg.top + mg.height / 2) - (nf.top + nf.height / 2)) < 2, "magnifier sits on the New folder / View row, right-aligned");
  var ids = $$("[id]").map(function (e) { return e.id; });
  ok(ids.length === new Set(ids).size, "no duplicate ids");
  var order = $$("#sidebar-tools, #sidebar-sessions-header, .session-folder-tools, .session-folder").map(function (e) { return e.id || (e.classList.contains("session-folder-tools") ? "tools-row" : e.dataset.folderId); });
  ok(order.join() === "sidebar-tools,sidebar-sessions-header,tools-row,favorites,unfiled", "order: tools, New folder/View/search, then unified folders: " + order);
});

test("session toolbar keeps its compact sticky spacing at top, mid-scroll and back", async function () {
  var ids = await folderWith(["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"], []);
  var panel = document.getElementById("sidebar-panel-sessions");
  var oldStyle = panel.style.cssText;
  panel.style.cssText = oldStyle + ";height:160px;flex:0 0 160px;overflow-y:auto";
  function spacing() {
    var sticky = $(".session-list-sticky-top").getBoundingClientRect();
    var bar = $(".session-folder-toolbar").getBoundingClientRect();
    var viewport = panel.getBoundingClientRect();
    return { gap: bar.top - sticky.top, anchor: sticky.top - viewport.top - panel.clientTop, scroll: panel.scrollTop };
  }
  try {
    panel.scrollTop = 0; await wait(40);
    var top = spacing();
    ok(panel.scrollHeight > panel.clientHeight + 100, "fixture has genuine session-list overflow: " + panel.scrollHeight + " > " + panel.clientHeight);
    panel.scrollTop = Math.min(120, panel.scrollHeight - panel.clientHeight); await wait(40);
    var middle = spacing();
    panel.scrollTop = 0; await wait(40);
    var back = spacing();
    ok(top.gap <= 1 && Math.abs(top.gap - middle.gap) < 0.5 && Math.abs(top.gap - back.gap) < 0.5, "compact toolbar gap stays fixed: " + JSON.stringify({ top: top, middle: middle, back: back }));
    ok(Math.abs(top.anchor) < 0.5 && Math.abs(middle.anchor) < 0.5 && Math.abs(back.anchor) < 0.5, "sticky anchor remains the scrollport top: " + JSON.stringify({ top: top, middle: middle, back: back }));

    click(toggleOf(ids[0])); await sync();
    panel.scrollTop = Math.min(80, panel.scrollHeight - panel.clientHeight); await wait(40);
    var collapsed = spacing();
    ok(Math.abs(collapsed.gap - top.gap) < 0.5 && Math.abs(collapsed.anchor) < 0.5, "folder collapse keeps the same sticky spacing: " + JSON.stringify(collapsed));

    click($('[data-new-folder-button="desktop"]')); await sync();
    panel.scrollTop = Math.min(80, panel.scrollHeight - panel.clientHeight); await wait(40);
    var draft = spacing();
    ok(createInput() && Math.abs(draft.gap - top.gap) < 0.5 && Math.abs(draft.anchor) < 0.5, "open folder draft keeps the same sticky spacing: " + JSON.stringify(draft));
    keydown(createInput(), "Escape"); await sync();

    click(magnifier()); await sync();
    panel.scrollTop = Math.min(80, panel.scrollHeight - panel.clientHeight); await wait(40);
    var search = spacing();
    ok(searchInput() && Math.abs(search.gap - top.gap) < 0.5 && Math.abs(search.anchor) < 0.5, "search replacement keeps the same sticky spacing: " + JSON.stringify(search));
    keydown(searchInput(), "Escape"); await sync();
  } finally {
    panel.style.cssText = oldStyle;
    panel.scrollTop = 0;
  }
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

test("new folder draft: sits before Unfiled, scrolls into view only when opened, survives rerenders", async function () {
  await freshWorld();
  click($("[data-new-folder-button='desktop']")); await sync();
  var draft = $(".session-folder-draft");
  ok(draft && draft.previousElementSibling === section("favorites") && draft.nextElementSibling === section("unfiled"), "draft sits between Favorites and Unfiled");
  typeInto(createInput(), "Anywhere"); keydown(createInput(), "Enter"); await sync();
  ok(!$(".session-folder-draft") && (await stored()).folders.map(function (x) { return x.name; }).join() === "Anywhere" && (await stored()).view.group === "folders", "creation works and the layout stays folders");
  click($("[data-new-folder-button='desktop']")); await sync();
  ok($(".session-folder-draft").previousElementSibling === section((await stored()).folders[0].id) && $(".session-folder-draft").nextElementSibling === section("unfiled"), "after the custom folders, before Unfiled");
  keydown(createInput(), "Escape"); await sync();
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
  var all = [fav, short, long, unf];
  var actual = [short, long, unf];
  var counts = all.map(function (s) { return $(".session-folder-count", s); });
  var labels = all.map(function (s) { return $(".session-folder-label", s); });
  var buttons = actual.map(function (s) { return $(".session-folder-new-btn", s); });
  var gapsToName = counts.map(function (c, i) { return c.getBoundingClientRect().left - labels[i].getBoundingClientRect().right; });
  ok(gapsToName.every(function (g) { return g >= 0 && g < 14; }), label + ": each count sits right beside its folder name: " + gapsToName.map(function (g) { return g.toFixed(1); }));
  var rights = buttons.map(rightOf);
  ok(Math.max.apply(null, rights) - Math.min.apply(null, rights) < 0.6, label + ": New session buttons share one right-hand column: " + rights.map(function (r) { return r.toFixed(1); }));
  var headers = all.map(function (s) { return $(".session-folder-header", s); });
  var actualHeaders = actual.map(function (s) { return $(".session-folder-header", s); });
  ok(!$(".session-folder-menu-btn, .session-folder-menu-slot", root) && headers[0].children.length === 1 && !$(".session-folder-new-btn", headers[0]) && actualHeaders.every(function (h) { return h.children.length === 2 && $$("button", h).length === 2 && $(".session-folder-toggle", h) && $(".session-folder-new-btn", h); }), label + ": no dots or slots; Favorites is immutable and only real folders have New session");
  var gaps = actualHeaders.map(function (h, i) { return h.getBoundingClientRect().right - rights[i]; });
  ok(Math.max.apply(null, gaps) - Math.min.apply(null, gaps) < 0.6 && gaps[0] >= 0 && gaps[0] <= 12, label + ": the button sits at the header's right edge: " + gaps.map(function (g) { return g.toFixed(1); }));
  if (mobile) ok(toggleOf(short.dataset.folderId, root).getBoundingClientRect().height >= 40, label + ": touch-sized header");
  // long name truncates inside its own label; the count stays in the column
  var longLabel = $(".session-folder-label", long);
  ok(longLabel.scrollWidth > longLabel.clientWidth + 1 && longLabel.textContent.length > 40, label + ": long label is truncated, not wrapped: " + longLabel.scrollWidth + " > " + longLabel.clientWidth);
  ok(rightOf($(".session-folder-new-btn", long)) <= headers[2].getBoundingClientRect().right + 0.5 && $(".session-folder-count", long).getBoundingClientRect().left > longLabel.getBoundingClientRect().right - 1 && rightOf($(".session-folder-count", long)) < $(".session-folder-new-btn", long).getBoundingClientRect().left, label + ": count stays right of the truncated label and the button stays inside the header");
  var heights = [fav, short, long, unf].map(function (s) { return $(".session-folder-header", s).getBoundingClientRect().height; });
  ok(Math.max.apply(null, heights) - Math.min.apply(null, heights) < 0.6, label + ": equal header heights " + heights);
  // the draft shares the folder geometry
  var draft = $(".session-folder-draft", root);
  ok(draft, label + ": draft present");
  var dIcon = $(".session-folder-icon", draft), sIcon = $(".session-folder-icon", short);
  ok(Math.abs(leftOf(dIcon) - leftOf(sIcon)) < 0.6, label + ": draft folder icon aligns with real folders: " + leftOf(dIcon) + " vs " + leftOf(sIcon));
  ok(Math.abs($(".session-folder-header", draft).getBoundingClientRect().height - heights[1]) < 3, label + ": draft header height matches");
  ok(Math.abs(rightOf($(".session-folder-create-actions", draft)) - rights[0]) < 0.6, label + ": draft actions end at the New session column's right edge: " + rightOf($(".session-folder-create-actions", draft)) + " vs " + rights[0]);
  var dh = $(".session-folder-header", draft).getBoundingClientRect(), fh = $(".session-folder-header", short).getBoundingClientRect();
  ok(Math.abs(dh.left - fh.left) < 0.6 && Math.abs(dh.right - fh.right) < 0.6, label + ": draft header spans the same width");
}

test("folder header geometry: count beside the name, New session column, no dots or slots, truncation, draft alignment, desktop and mobile", async function () {
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
  ok($(".session-create-row", section(f.one)) && !wsLog.slice(b2).some(function (m) { return m.type === "new_session"; }), "New session here opens the inline form for that folder");
  keydown(document.activeElement, "Escape");
  ctxAt(f.one); click($$(".session-folder-menu button")[1]);
  ok($(".session-folder-input") && $(".session-folder-input").value === "One", "Rename opens the existing dialog prefilled");
  keydown($(".session-folder-input"), "Escape");
  ctxAt(f.one); click($$(".session-folder-menu button")[4]);
  await until(function () { return delDialog() && deleteOption("unfiled"); }, "delete choices");
  ok(delDialog(), "Delete opens the delete-folder dialog with choices");
  click(deleteCancel()); await sync();
  ok(!delDialog(), "Cancel closes it without any request: " + JSON.stringify(wsLog.filter(function (m) { return m.type === "session_folders_delete"; })));
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

test("folder context menu dismissal: pointerdown-only surfaces, touch, blur, inside actions, focus, cleanup", async function () {
  var ids = await folderWith(["One", "Two"], [[1, 0]]);
  var one = ids[0];
  var guard = document.getElementById("pointer-guard");
  var outsideInput = document.createElement("input");
  outsideInput.style.cssText = "position:fixed;left:320px;bottom:4px;z-index:5";
  document.body.appendChild(outsideInput);
  var mouseSeen = 0;
  function countMouse() { mouseSeen++; }
  document.addEventListener("mousedown", countMouse, true);
  try {
    ctxAt(one);
    ok(ctxMenu(), "menu open");
    // the reproduced miss: the surface cancels pointerdown, so no mousedown or touchstart follows
    var before = mouseSeen;
    var pd = pointerAt(guard, "pointerdown");
    ok(pd.defaultPrevented && mouseSeen === before, "guard cancels pointerdown and emits no mousedown");
    ok(!ctxMenu(), "pointerdown-only outside press closes the folder menu");
    var routes = [
      ["mousedown only", function () { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }],
      ["touchstart only", function () { $("#report").dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true })); }],
      ["touch pointerdown on the list", function () { pointerAt($("#session-list"), "pointerdown", { pointerType: "touch" }); }],
      ["window blur", function () { window.dispatchEvent(new Event("blur")); }],
    ];
    for (var i = 0; i < routes.length; i++) {
      ctxAt(one);
      ok(ctxMenu(), routes[i][0] + ": open");
      routes[i][1]();
      ok(!ctxMenu() && !store.get("sessionFolderMenu"), routes[i][0] + " closes the menu");
    }
    // the outside press is never cancelled and focus stays with the pressed control
    ctxAt(one);
    var plain = pointerAt(outsideInput, "pointerdown");
    outsideInput.focus();
    ok(!plain.defaultPrevented && !ctxMenu() && document.activeElement === outsideInput, "outside press neither cancelled nor focus-stealing");
    var clicked = 0;
    guard.addEventListener("click", function () { clicked++; });
    ctxAt(one); pointerAt(guard, "pointerdown"); click(guard);
    ok(clicked === 1 && !ctxMenu(), "the clicked outside control still gets its click");
    // inside presses keep it open and actions still run
    ctxAt(one);
    var first = $$(".session-folder-menu button")[1];
    pointerAt(first, "pointerdown"); first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); first.dispatchEvent(new Event("touchstart", { bubbles: true }));
    pointerAt(ctxMenu(), "pointerdown");
    ok(ctxMenu(), "presses inside the menu keep it open");
    click(first); await sync();
    ok(!ctxMenu() && $(".session-folder-input") && $(".session-folder-input").value === "One", "inside action runs (Rename dialog opened)");
    keydown($(".session-folder-input"), "Escape"); await sync();
    // right-click on another header while open replaces the menu without a double open
    ctxAt(one);
    // a real right-click presses first (closing the old menu), then fires contextmenu
    pointerAt($(".session-folder-header", section(ids[1])), "pointerdown", { button: 2 });
    ok(!ctxMenu(), "the right-click press closes the open menu");
    ctxAt(ids[1]);
    ok($$(".session-folder-menu").length === 1, "a second right-click shows exactly one menu");
    // Escape returns focus to the header
    keydown(document.activeElement, "Escape");
    ok(!ctxMenu() && document.activeElement === toggleOf(ids[1]), "Escape returns focus to the header");
    // listeners are gone after close
    pointerAt(guard, "pointerdown"); window.dispatchEvent(new Event("blur"));
    ok(!ctxMenu(), "stray events after close do nothing");
    // project switch and DM transition clean up
    ctxAt(one);
    store.set({ dmMode: true }); ok(!ctxMenu(), "closes on DM transition"); store.set({ dmMode: false });
    await sync();
    ctxAt(one);
    store.set({ currentSlug: "elsewhere" }); ok(!ctxMenu(), "closes on project change"); store.set({ currentSlug: "proj" });
    await sync();
    // Delete still launches the new dialog from the menu
    var items;
    ctxAt(one);
    items = $$(".session-folder-menu button");
    click(items[items.length - 1]);
    await until(function () { return delDialog() && deleteOption("unfiled"); }, "delete dialog from the menu");
    ok(delDialog(), "Delete folder opens the delete dialog");
    click(deleteCancel()); await sync();
  } finally {
    document.removeEventListener("mousedown", countMouse, true);
    outsideInput.remove();
  }
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
  // Favorite tags do not change the real Unfiled placement. Move the Driver
  // away, then reorder the two remaining real Unfiled rows.
  await newFolderViaDialog("Box");
  var box = folderIdByLabel("Box");
  drag(row(3), section(box)); await sync();
  await openView();
  click($("[data-focus-key='sort:manual']")); await sync();
  await closeView();
  ok(titlesIn("unfiled").length === 2, "two in unfiled: " + titlesIn("unfiled"));
  var first = titlesIn("unfiled")[0], second = titlesIn("unfiled")[1];
  drag(rowIn("unfiled", second), unitIn("unfiled", first), { fraction: 0.1 }); await sync();
  ok(titlesIn("unfiled").join() === second + "," + first, "manual reorder applied: " + titlesIn("unfiled"));
  await freshWorldKeepingStore();
  ok(titlesIn("unfiled").join() === second + "," + first, "manual order survives reload");
});

test("search inside a collapsed folder reveals matches; clearing restores collapse", async function () {
  await freshWorld();
  await newFolderViaDialog("Hidden");
  var id = folderIdByLabel("Hidden");
  drag(row(1), section(id)); await sync();
  click(starIn(id, 1)); await sync();
  ok(titlesIn("favorites").join() === "1" && titlesIn(id).join() === "1", "the same session is present in Favorites and its real folder before search");
  click($(".session-folder-toggle", section(id))); await sync();
  await until(function () { return $(".session-folder-body", section(id)).hidden; }, "folder collapse animation");
  ok($(".session-folder-body", section(id)).hidden === true, "collapsed");
  click(magnifier()); await sync();
  typeInto(searchInput(), "Alpha");
  handleSearchResults({ query: "Alpha", results: [{ id: 1 }] });
  await sync();
  ok($(".session-folder-body", section(id)).hidden === false, "search expands the folder");
  ok(titlesIn(id).join() === "1", "match visible: " + titlesIn(id));
  ok(titlesIn("favorites").join() === "1", "the matching favorite copy is visible too");
  ok(!unit(2) && !unit(3), "non matches hidden");
  ok(!section("unfiled"), "empty sections hidden while searching");
  click($("[aria-label='Close search']")); await sync();
  ok($(".session-folder-body", section(id)).hidden === true, "collapse restored after search");
  ok(titlesIn("favorites").join() === "1", "clearing search preserves the tag");
});

test("folder bodies animate measured height, survive repaint and reverse safely", async function () {
  await freshWorld();
  await newFolderViaDialog("Motion");
  var id = folderIdByLabel("Motion");
  drag(row(1), section(id)); await sync();
  drag(row(3), section(id)); await sync();
  var body = $(".session-folder-body", section(id));
  var naturalHeight = body.getBoundingClientRect().height;
  ok(naturalHeight > 60, "fixture has varied content height: " + naturalHeight);
  ok(!body.classList.contains("folder-collapse-animating"), "ordinary desktop render has no entrance animation");

  var toggle = toggleOf(id);
  starIn(id, 1).focus();
  ok(body.contains(document.activeElement), "a body control holds focus before collapse");
  click(toggle);
  ok(toggle.getAttribute("aria-expanded") === "false" && !body.hidden, "close starts visibly with collapsed semantics");
  ok(body.hasAttribute("inert") && body.getAttribute("aria-hidden") === "true", "closing body is immediately noninteractive");
  ok(document.activeElement === toggle, "focus returns to the folder toggle before closing");
  await wait(70);
  body = $(".session-folder-body", section(id));
  var closingHeight = body.getBoundingClientRect().height;
  ok(closingHeight > 0 && closingHeight < naturalHeight, "close has an intermediate measured height: " + closingHeight);

  toggle = toggleOf(id);
  click(toggle);
  await wait(55);
  body = $(".session-folder-body", section(id));
  var reopeningHeight = body.getBoundingClientRect().height;
  ok(toggleOf(id).getAttribute("aria-expanded") === "true" && reopeningHeight > closingHeight && reopeningHeight < naturalHeight + 1, "rapid reversal grows from the current height: " + reopeningHeight);
  await wait(300);
  body = $(".session-folder-body", section(id));
  ok(!body.classList.contains("folder-collapse-animating"), "reversed opening animation settles: " + JSON.stringify(store.get("sessionFolderCollapseAnimations")));
  ok(!body.hidden && !body.hasAttribute("inert") && Math.abs(body.getBoundingClientRect().height - naturalHeight) < 1, "reversal finishes open at natural height");

  click(toggleOf(id));
  await wait(55);
  await renderAll();
  body = $(".session-folder-body", section(id));
  ok(body.classList.contains("folder-collapse-animating") && !body.hidden, "server-style repaint resumes the in-flight close");
  await until(function () { return $(".session-folder-body", section(id)).hidden; }, "repainted closing animation");
  ok(toggleOf(id).getAttribute("aria-expanded") === "false", "repainted close finishes collapsed");

  var originalMatchMedia = window.matchMedia;
  try {
    window.matchMedia = function (query) { return { matches: query === "(prefers-reduced-motion: reduce)" }; };
    click(toggleOf(id));
    body = $(".session-folder-body", section(id));
    ok(!body.hidden && !body.classList.contains("folder-collapse-animating"), "reduced motion opens immediately without an animation");
  } finally {
    window.matchMedia = originalMatchMedia;
  }

  await sync();
  var smallCloseStarted = performance.now();
  click(toggleOf(id));
  await until(function () { return $(".session-folder-body", section(id)).hidden; }, "collapse before opening draft row");
  ok(performance.now() - smallCloseStarted < 260, "small folder retains a brief collapse duration");
  openSessionCreate(id);
  await until(function () { return createRow(id); }, "folder draft row");
  body = $(".session-folder-body", section(id));
  ok(createRow(id).parentElement === section(id) && createRow(id).parentElement !== body && visibleBox(createRow(id)), "draft remains visible outside the collapsed body");
  ok(body.hidden && toggleOf(id).getAttribute("aria-expanded") === "false", "opening a draft does not expand its collapsed body");
});

test("long folder motion scales with distance and keeps the scrolled viewport continuous", async function () {
  await freshWorld();
  var addedIds = [];
  for (var i = 10; i < 28; i++) {
    await rpc("/rpc/add-session", { id: i, extra: { title: "Long list session " + i } });
    SESSIONS.push({ id: i, title: "Long list session " + i, lastActivity: 3000 + i, createdAt: i, vendor: "claude", sessionRole: "driver" });
    addedIds.push(i);
  }
  await renderAll();
  for (var b = 1; b <= 5; b++) await newFolderViaDialog("Before " + b);
  await newFolderViaDialog("Tall");
  var tall = folderIdByLabel("Tall");
  var trailing = [];
  for (var f = 1; f <= 7; f++) {
    await newFolderViaDialog("After " + f);
    trailing.push(folderIdByLabel("After " + f));
  }
  var moveIds = [1, 2, 3].concat(addedIds);
  for (var m = 0; m < moveIds.length; m++) {
    drag(row(moveIds[m]), section(tall));
    await sync();
  }

  var panel = document.getElementById("sidebar-panel-sessions");
  panel.style.height = "270px";
  panel.style.flex = "0 0 270px";
  panel.style.overflowY = "auto";
  var naturalHeight = $(".session-folder-body", section(tall)).getBoundingClientRect().height;
  ok(naturalHeight > 600, "fixture has a body taller than the viewport: " + naturalHeight);

  function sampleMotion(anchorId, duration, throughSettlement) {
    var frames = [];
    var started = performance.now();
    var sawAnimation = false;
    return new Promise(function (resolve) {
      function frame(now) {
        var currentBody = $(".session-folder-body", section(tall));
        var anchor = $(".session-folder-header", section(anchorId));
        var sibling = $(".session-folder-header", section(trailing[0]));
        var sample = {
          elapsed: now - started,
          height: currentBody.hidden ? 0 : currentBody.getBoundingClientRect().height,
          anchorTop: anchor.getBoundingClientRect().top,
          siblingTop: sibling.getBoundingClientRect().top,
          scrollTop: panel.scrollTop,
          animating: currentBody.classList.contains("folder-collapse-animating"),
        };
        frames.push(sample);
        if (sample.animating) sawAnimation = true;
        if ((throughSettlement && sawAnimation && !sample.animating) || now - started >= duration) resolve(frames);
        else requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  panel.scrollTop = $(".session-folder-header", section(tall)).offsetTop - 120;
  var middleTop = $(".session-folder-header", section(tall)).getBoundingClientRect().top;
  click(toggleOf(tall));
  var closingFramesPromise = sampleMotion(tall, 260);
  await wait(85);
  await renderAll();
  var closingFrames = await closingFramesPromise;
  var closingBody = $(".session-folder-body", section(tall));
  ok(closingBody.classList.contains("folder-collapse-animating"), "a tall close remains in motion after 260ms");
  var maxHeightStep = 0;
  var maxAnchorStep = 0;
  for (var c = 1; c < closingFrames.length; c++) {
    maxHeightStep = Math.max(maxHeightStep, Math.abs(closingFrames[c].height - closingFrames[c - 1].height));
    maxAnchorStep = Math.max(maxAnchorStep, Math.abs(closingFrames[c].anchorTop - closingFrames[c - 1].anchorTop));
  }
  ok(maxHeightStep < naturalHeight * 0.16, "tall close has bounded frame displacement: " + maxHeightStep + " of " + naturalHeight);
  ok(maxAnchorStep < 3 && Math.abs(closingFrames[closingFrames.length - 1].anchorTop - middleTop) < 3, "mid-list anchor stays stable through server repaint: " + maxAnchorStep);
  await until(function () { return $(".session-folder-body", section(tall)).hidden; }, "distance-scaled tall close");

  panel.scrollTop = $(".session-folder-header", section(tall)).offsetTop - 40;
  click(toggleOf(tall));
  await wait(140);
  var openingHeight = $(".session-folder-body", section(tall)).getBoundingClientRect().height;
  ok(openingHeight > 0 && openingHeight < naturalHeight, "top-position opening has a real intermediate height: " + openingHeight);
  click(toggleOf(tall));
  await wait(70);
  var reversedHeight = $(".session-folder-body", section(tall)).getBoundingClientRect().height;
  ok(reversedHeight < openingHeight, "rapid reversal continues from the visible height: " + reversedHeight + " < " + openingHeight);
  click(toggleOf(tall));
  await until(function () { return !$(".session-folder-body", section(tall)).classList.contains("folder-collapse-animating"); }, "reversed tall open");
  ok(Math.abs($(".session-folder-body", section(tall)).getBoundingClientRect().height - naturalHeight) < 1, "reversed tall open settles at natural height");

  panel.scrollTop = $(".session-folder-header", section(tall)).offsetTop - 230;
  var bottomTop = $(".session-folder-header", section(tall)).getBoundingClientRect().top;
  click(toggleOf(tall));
  var bottomFrames = await sampleMotion(tall, 900, true);
  var lastAnimatingIndex = -1;
  for (var bf = 0; bf < bottomFrames.length; bf++) {
    if (bottomFrames[bf].animating) lastAnimatingIndex = bf;
  }
  var lastAnimatingFrame = bottomFrames[lastAnimatingIndex];
  var firstSettledFrame = bottomFrames[lastAnimatingIndex + 1];
  ok(lastAnimatingIndex >= 0 && firstSettledFrame && !firstSettledFrame.animating, "samples straddle the actual animation settlement boundary");
  ok($(".session-folder-body", section(tall)).hidden, "bottom-position close finishes hidden");
  var boundaryHeightDelta = Math.abs(firstSettledFrame.height - lastAnimatingFrame.height);
  var boundaryHeaderDelta = Math.abs(firstSettledFrame.anchorTop - lastAnimatingFrame.anchorTop);
  var boundarySiblingDelta = Math.abs(firstSettledFrame.siblingTop - lastAnimatingFrame.siblingTop);
  ok(boundaryHeightDelta < Math.max(2, naturalHeight * 0.015), "settlement has no terminal height jump: " + boundaryHeightDelta);
  ok(boundaryHeaderDelta < 1 && boundarySiblingDelta < 3, "header and following sibling stay continuous at settlement: " + boundaryHeaderDelta + "/" + boundarySiblingDelta);
  ok(Math.abs(bottomFrames[bottomFrames.length - 1].anchorTop - bottomTop) < 3, "bottom viewport anchor remains stable while content above shrinks");

  var mobileFixture = await mobileFixtureFrame("mobile-long-motion-test", 320, 430);
  var mobileHost = mobileFixture.host;
  try {
    renderMobileSessionsInto(mobileHost);
    var mobileTall = $('.session-folder[data-folder-id="' + tall + '"]', mobileHost);
    var mobileToggle = $(".session-folder-toggle", mobileTall);
    click(mobileToggle);
    await wait(260);
    var mobileBody = $(".session-folder-body", mobileTall);
    var mobileOpeningHeight = mobileBody.getBoundingClientRect().height;
    ok(mobileBody.classList.contains("folder-collapse-animating") && mobileOpeningHeight > 0, "tall mobile opening remains progressive after 260ms: " + mobileOpeningHeight);
    await until(function () { return !$(".session-folder-body", mobileTall).classList.contains("folder-collapse-animating"); }, "tall mobile opening");
    var mobileNaturalHeight = $(".session-folder-body", mobileTall).getBoundingClientRect().height;
    var mobileRows = $$(".mobile-session-item", mobileTall);
    var mobileRowHeight = mobileRows[0].getBoundingClientRect().height;
    var mobileVendorIcon = $(".mobile-session-vendor-icon", mobileTall);
    var mobileIconWidth = mobileVendorIcon.getBoundingClientRect().width;
    ok(mobileRows.length === 23 && mobileRowHeight >= 48 && mobileRowHeight < 60, "mobile fixture uses production row geometry: " + mobileRows.length + " rows at " + mobileRowHeight + "px");
    ok(mobileIconWidth >= 13 && mobileIconWidth <= 15, "mobile fixture uses the production vendor icon size: " + mobileIconWidth + "px");
    ok(mobileNaturalHeight > 950 && mobileNaturalHeight < 1150, "mobile body height comes from real rows plus the compact date heading rather than intrinsic images: " + mobileNaturalHeight);
    mobileHost.scrollTop = $(".session-folder-header", mobileTall).offsetTop - 180;
    var mobileHeaderTop = $(".session-folder-header", mobileTall).getBoundingClientRect().top;
    click($(".session-folder-toggle", mobileTall));
    await wait(260);
    mobileBody = $(".session-folder-body", mobileTall);
    ok(mobileBody.classList.contains("folder-collapse-animating") && mobileBody.getBoundingClientRect().height > 0, "tall mobile close remains progressive after 260ms");
    ok(Math.abs($(".session-folder-header", mobileTall).getBoundingClientRect().top - mobileHeaderTop) < 3, "mobile clicked header stays anchored while scrolled");
    await until(function () { return $(".session-folder-body", mobileTall).hidden; }, "tall mobile close");
    var metricReceipt = document.createElement("div");
    metricReceipt.id = "long-motion-metrics";
    metricReceipt.textContent = "MOTION METRICS desktop body " + naturalHeight + "px; settlement height/header/sibling deltas " + boundaryHeightDelta.toFixed(3) + "/" + boundaryHeaderDelta.toFixed(3) + "/" + boundarySiblingDelta.toFixed(3) + "px; mobile body " + mobileNaturalHeight + "px; row " + mobileRowHeight + "px; icon " + mobileIconWidth + "px";
    report.after(metricReceipt);
  } finally {
    mobileFixture.frame.remove();
  }
  panel.style.height = "";
  panel.style.flex = "";
  panel.style.overflowY = "";
});

test("mobile folder bodies use the same measured expand and collapse motion", async function () {
  await freshWorld();
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:0;top:0;width:320px;height:100vh;overflow:auto;background:#222;z-index:5";
  document.body.appendChild(host);
  try {
    renderMobileSessionsInto(host);
    var mobileSection = $('.session-folder[data-folder-id="unfiled"]', host);
    var body = $(".session-folder-body", mobileSection);
    var naturalHeight = body.getBoundingClientRect().height;
    ok(!body.classList.contains("folder-collapse-animating"), "initial mobile render has no entrance animation");
    click($(".session-folder-toggle", mobileSection));
    await wait(70);
    mobileSection = $('.session-folder[data-folder-id="unfiled"]', host);
    body = $(".session-folder-body", mobileSection);
    var closingHeight = body.getBoundingClientRect().height;
    ok(closingHeight > 0 && closingHeight < naturalHeight && body.hasAttribute("inert"), "mobile close has a noninteractive intermediate height: " + closingHeight);
    await until(function () { return $(".session-folder-body", mobileSection).hidden; }, "mobile folder collapse");
    click($(".session-folder-toggle", mobileSection));
    await wait(70);
    body = $(".session-folder-body", mobileSection);
    var openingHeight = body.getBoundingClientRect().height;
    ok(openingHeight > 0 && openingHeight < naturalHeight && !body.hasAttribute("inert"), "mobile open has an accessible intermediate height: " + openingHeight);
    await until(function () { return !$(".session-folder-body", mobileSection).classList.contains("folder-collapse-animating"); }, "mobile folder opening");
    ok(!body.hidden && Math.abs(body.getBoundingClientRect().height - naturalHeight) < 1, "mobile open finishes at natural content height");
  } finally {
    host.remove();
  }
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

async function folderWith(names, filing) {
  await freshWorld();
  for (var i = 0; i < names.length; i++) await newFolderViaDialog(names[i]);
  var ids = names.map(folderIdByLabel);
  for (var j = 0; j < filing.length; j++) { drag(row(filing[j][0]), section(ids[filing[j][1]])); await sync(); }
  return ids;
}

async function setFolderView(sort, direction) {
  var op = { op: "set_view", sort: sort };
  if (direction) op.direction = direction;
  var outbox = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: op } });
  deliver(outbox, "u1-a");
  await sync();
}

function dateLabelsIn(sectionId, root) {
  return $$(".session-date-group-header .session-group-header-label", root ? $('.session-folder[data-folder-id="' + sectionId + '"]', root) : section(sectionId)).map(function (label) { return label.textContent; });
}

function dateHeaderForUnit(sectionId, unitId, root) {
  var entry = unitIn(sectionId, unitId, root);
  var cursor = entry && entry.previousElementSibling;
  while (cursor && !cursor.classList.contains("session-date-group-header")) cursor = cursor.previousElementSibling;
  return cursor;
}

test("date subsections stay inside fixed folders and use the selected root timestamp on desktop and mobile", async function () {
  var ids = await folderWith(["Work"], [[3, 0], [1, 0]]);
  var now = Date.now();
  SESSIONS[0].lastActivity = now - 30 * 60 * 1000;
  SESSIONS[0].createdAt = now - 45 * 24 * 60 * 60 * 1000;
  SESSIONS[1].lastActivity = now - 3 * 24 * 60 * 60 * 1000;
  SESSIONS[1].createdAt = now - 12 * 24 * 60 * 60 * 1000;
  SESSIONS[2].lastActivity = now - 26 * 60 * 60 * 1000;
  SESSIONS[2].createdAt = now - 20 * 60 * 1000;
  SESSIONS[3].lastActivity = now - 10 * 60 * 1000;
  SESSIONS[4].lastActivity = now - 5 * 60 * 1000;
  await renderAll();
  ok(sectionLabels().join() === "Favorites,Work,Unfiled", "date grouping never replaces or reorders folders: " + sectionLabels().join());
  ok(dateLabelsIn(ids[0]).join() === "Today,Yesterday", "activity groups render inside the custom folder");
  ok(dateHeaderForUnit(ids[0], 3).textContent.indexOf("Yesterday") !== -1, "Driver hierarchy follows the Driver root timestamp, not newer Worker activity");
  ok($$(".session-date-group-header", section("favorites")).length === 0, "Favorites keeps curated flat presentation");

  await setFolderView("created", "desc");
  ok(dateLabelsIn(ids[0]).join() === "Today,Older", "created view groups by creation timestamp");
  await setFolderView("created", "asc");
  ok(dateLabelsIn(ids[0]).join() === "Older,Today", "Oldest reverses subsection order");
  await setFolderView("title", "asc");
  ok($$(".session-date-group-header").length === 0, "title view has no date headings");
  await setFolderView("manual");
  ok($$(".session-date-group-header").length === 0, "manual view has no date headings");

  await setFolderView("activity", "desc");
  var host = document.createElement("div");
  document.body.appendChild(host);
  try {
    renderMobileSessionsInto(host);
    ok(dateLabelsIn(ids[0], host).join() === "Today,Yesterday", "mobile uses the same actual-folder subsections");
    var mobileClear = $(".session-date-group-header .session-group-clear-btn", $('.session-folder[data-folder-id="' + ids[0] + '"]', host));
    ok(mobileClear && /Clear 1 session/.test(mobileClear.getAttribute("aria-label")), "mobile Clear has a scoped accessible label");
  } finally {
    host.remove();
  }
});

test("date subsection Clear confirms exact roots, cancellation, permission and filtered scope", async function () {
  var ids = await folderWith(["Work"], [[3, 0], [1, 0], [2, 0]]);
  var now = Date.now();
  for (var i = 0; i < SESSIONS.length; i++) {
    SESSIONS[i].lastActivity = now - i * 60 * 1000;
    SESSIONS[i].createdAt = SESSIONS[i].lastActivity;
  }
  await renderAll();
  var clear = $(".session-date-group-header .session-group-clear-btn", section(ids[0]));
  var before = wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length;
  click(clear);
  ok(!$("#confirm-modal").classList.contains("hidden"), "Clear opens the custom confirmation modal");
  ok(/5 sessions/.test($("#confirm-text").textContent) && /hidden sessions and previous generations/.test($("#confirm-text").textContent), "confirmation accurately includes the Driver's two cascading Workers");
  ok(wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length === before, "opening confirmation is not destructive");
  click($("#confirm-cancel"));
  ok(wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length === before, "Cancel sends no deletion");

  click(clear);
  click($("#confirm-ok"));
  var valid = wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).pop();
  ok(valid && valid.sessionIds.join() === "1,2,3", "same-project confirmation sends the rendered subsection roots once");
  var afterValid = wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length;

  click(clear);
  store.set({ currentSlug: "elsewhere" });
  click($("#confirm-ok"));
  ok(wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length === afterValid, "project switch makes the open confirmation stale");
  ok(/Clear cancelled/.test($(".toast").textContent), "stale project confirmation explains that nothing was sent");
  $$(".toast").forEach(function (toast) { toast.remove(); });

  ids = await folderWith(["Work"], [[1, 0]]);
  clear = $(".session-date-group-header .session-group-clear-btn", section(ids[0]));
  var originWs = getWs();
  click(clear);
  setWs(fakeWs("u1"));
  click($("#confirm-ok"));
  ok(wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length === 0, "socket replacement makes the open confirmation stale");
  setWs(originWs);

  click(clear);
  store.set({ permissions: { sessionDelete: false } });
  click($("#confirm-ok"));
  ok(wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).length === 0, "revoked delete permission blocks an already-open confirmation");
  store.set({ permissions: null });

  store.set({ permissions: { sessionDelete: false } });
  renderSessionList(null);
  await sync();
  ok(!$(".session-date-group-header .session-group-clear-btn", section(ids[0])), "Clear is hidden without delete permission");
  store.set({ permissions: null });
  renderSessionList(null);
  await sync();

  store.set({ sessionSearch: { open: true, query: "Alpha", matchIds: new Set([1]), timer: null, focus: false, selStart: null, selEnd: null } });
  await sync();
  var filteredHeader = $(".session-date-group-header", section(ids[0]));
  var filteredClear = $(".session-group-clear-btn", filteredHeader);
  ok(filteredHeader && $(".session-date-group-count", filteredHeader).textContent === "1", "search subsection count covers only the rendered matching root");
  ok(/1 matching session/.test(filteredClear.getAttribute("aria-label")), "search scope is explicit in the accessible label");
  click(filteredClear);
  ok(/matching search/.test($("#confirm-text").textContent) && /1 session/.test($("#confirm-text").textContent), "search scope and exact count are explicit in confirmation");
  click($("#confirm-ok"));
  var sent = wsLog.filter(function (msg) { return msg.type === "bulk_delete_sessions"; }).pop();
  ok(sent && sent.sessionIds.join() === "1", "confirmed deletion sends only the rendered matching root");
});

test("date headings do not become draggable units and manual reorder remains intact", async function () {
  var ids = await folderWith(["Work"], [[1, 0], [2, 0]]);
  var now = Date.now();
  SESSIONS[0].lastActivity = now;
  SESSIONS[1].lastActivity = now - 60 * 1000;
  await renderAll();
  ok($(".session-date-group-header", section(ids[0])) && $$(".session-folder-unit", section(ids[0])).length === 2, "date heading is separate from the two drag units");
  var activityOrder = titlesIn(ids[0]).join();
  drag(rowIn(ids[0], 1), unitIn(ids[0], 2), { fraction: 0.9 });
  await sync();
  ok(titlesIn(ids[0]).join() === activityOrder, "sorted view ignores manual row reorder");
  await setFolderView("manual");
  ok(!$(".session-date-group-header", section(ids[0])), "manual view removes headings before drag");
  drag(rowIn(ids[0], 1), unitIn(ids[0], 2), { fraction: 0.9 });
  await sync();
  ok(titlesIn(ids[0]).join() === "2,1", "manual drag still reorders the actual units");
});

test("folder removal effect: authoritative success covers empty, move-to-folder, move-to-Unfiled and delete-with-sessions outcomes", async function () {
  var ids = await folderWith(["Empty"], []);
  var iconRect = $(".session-folder-icon", section(ids[0])).getBoundingClientRect();
  var expectedX = iconRect.left + iconRect.width / 2;
  var expectedY = iconRect.top + iconRect.height / 2;
  await openDelete(ids[0]);
  click(deletePrimary());
  await until(function () { return !delDialog() && $(".folder-delete-dust"); }, "empty folder removal effect");
  var dust = $(".folder-delete-dust");
  var first = $(".dust-particle", dust);
  ok(!section(ids[0]) && dust.getAttribute("aria-hidden") === "true" && dust.style.pointerEvents === "none", "empty folder disappears before an inert decorative overlay plays");
  ok($$(".dust-particle", dust).length === 12 && Math.abs(parseFloat(first.style.left) - expectedX) < 1 && Math.abs(parseFloat(first.style.top) - expectedY) < 1, "twelve particles originate at the captured folder icon geometry");
  var sent = wsLog.filter(function (m) { return m.type === "session_folders_delete"; }).pop();
  dust.remove();
  ok(handleFolderDeleteState({ requestId: sent.requestId, folderDeleted: ids[0] }) === false && !$(".folder-delete-dust"), "duplicate acknowledgement cannot replay after the request state closes");

  ids = await folderWith(["Source", "Destination"], [[1, 0]]);
  await openDelete(ids[0]);
  click(deleteOption("move")); await sync();
  var select = $("select", delDialog());
  select.value = ids[1]; select.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  click(deletePrimary());
  await until(function () { return !delDialog() && $(".folder-delete-dust"); }, "move-to-folder removal effect");
  ok(!section(ids[0]) && titlesIn(ids[1]).includes("1") && $$(".folder-delete-dust .dust-particle").length === 12, "move-to-folder success plays one bounded folder effect");

  ids = await folderWith(["Plain"], [[2, 0]]);
  await openDelete(ids[0]);
  click(deletePrimary());
  await until(function () { return !delDialog() && $(".folder-delete-dust"); }, "move-to-Unfiled removal effect");
  ok(!section(ids[0]) && titlesIn("unfiled").includes("2") && $$(".folder-delete-dust .dust-particle").length === 12, "move-to-Unfiled success plays one bounded folder effect");

  ids = await folderWith(["Sessions"], [[2, 0]]);
  await openDelete(ids[0]);
  click(deleteOption("delete")); await sync();
  var confirm = $(".session-folder-delete-confirm input", delDialog());
  confirm.checked = true; confirm.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  click(deletePrimary());
  await until(function () { return !delDialog() && $(".folder-delete-dust"); }, "delete-with-sessions removal effect");
  ok(!section(ids[0]) && (await serverSessions()).indexOf("2") === -1 && $$(".dust-particle-container").length === 1 && $$(".folder-delete-dust .dust-particle").length === 12, "delete-with-sessions uses only the folder effect, without duplicate session explosions");
});

test("folder removal effect: refusal, remote state and reduced motion never emit particles", async function () {
  var ids = await folderWith(["Refused"], []);
  await openDelete(ids[0]);
  await rpc("/rpc/flags", { saveFail: true });
  click(deletePrimary()); await sync();
  ok(delDialog() && section(ids[0]) && /could not/i.test($("[role='alert']", delDialog()).textContent) && !$(".folder-delete-dust"), "save refusal keeps the folder and emits no particles");
  await rpc("/rpc/flags", { saveFail: false });
  click(deleteCancel()); await sync();

  ids = await folderWith(["Remote"], []);
  var remoteState = Object.assign({}, store.get("sessionFolders"), { folders: store.get("sessionFolders").folders.filter(function (folder) { return folder.id !== ids[0]; }) });
  handleSessionFoldersState({ type: "session_folders_state", slug: "proj", state: remoteState });
  await wait(40);
  ok(!section(ids[0]) && !$(".folder-delete-dust"), "uncorrelated remote state removal stays still");

  ids = await folderWith(["Quiet"], []);
  await openDelete(ids[0]);
  var originalMatchMedia = window.matchMedia;
  try {
    window.matchMedia = function (query) { return { matches: query === "(prefers-reduced-motion: reduce)" }; };
    click(deletePrimary());
    await until(function () { return !delDialog(); }, "reduced-motion folder deletion");
    await wait(40);
    ok(!section(ids[0]) && !$(".folder-delete-dust"), "reduced motion removes the folder immediately without animation DOM");
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test("folder removal effect: rapid successful removals keep particle DOM bounded and project switches clean it", async function () {
  var ids = await folderWith(["Rapid A", "Rapid B", "Rapid C", "Rapid D"], []);
  for (var i = 0; i < ids.length; i++) {
    await openDelete(ids[i]);
    click(deletePrimary());
    await until(function () { return !delDialog(); }, "rapid folder deletion " + i);
  }
  ok($$(".folder-delete-dust").length === 3 && $$(".folder-delete-dust .dust-particle").length === 36, "four rapid acknowledgements retain at most three overlays and 36 particles");
  store.set({ currentSlug: "elsewhere" });
  ok(!$(".folder-delete-dust"), "project switch clears active removal particles");
  store.set({ currentSlug: "proj" });
});

test("delete folder dialog: server count (not the filtered list), radio choices, default Unfiled, keyboard", async function () {
  var ids = await folderWith(["One", "Two"], [[1, 0], [3, 0]]);
  // search hides Alpha from the rendered folder; the dialog still reports the authoritative contents
  click($("[data-search-button='desktop']")); await sync();
  typeInto($(".session-search-input"), "Driver");
  handleSearchResults({ query: "Driver", results: [{ id: 3 }] }); await sync();
  ok(titlesIn(ids[0]).join() === "3", "the filtered list shows only the Driver: " + titlesIn(ids[0]));
  await openDelete(ids[0]);
  var dlg = delDialog();
  var box = $("[role='dialog']", dlg);
  ok(box && box.getAttribute("aria-modal") === "true" && box.getAttribute("aria-label") === "Delete folder", "accessible modal dialog");
  ok(/contains 2 sessions/.test($(".session-folder-delete-intro", dlg).textContent) && /2 Split Worker sessions/.test($(".session-folder-delete-intro", dlg).textContent), "counts come from the server: " + $(".session-folder-delete-intro", dlg).textContent);
  ok($("[role='radiogroup']", dlg) && $$("[role='radio']", dlg).length === 3, "three radio choices");
  ok(deleteOption("unfiled").getAttribute("aria-checked") === "true" && deleteOption("delete").getAttribute("aria-checked") === "false", "Unfiled is the default, never delete");
  ok(!$("select", dlg) && !$(".session-folder-delete-confirm", dlg), "no destination picker or destructive confirmation by default");
  ok(deletePrimary().textContent === "Delete folder" && !deletePrimary().disabled && deletePrimary().classList.contains("confirm-ok"), "neutral primary button");
  ok(document.activeElement === deleteOption("unfiled"), "focus starts on the selected radio");
  // arrow keys move and select, focus stays inside
  keydown(deleteOption("unfiled"), "ArrowDown"); await sync();
  ok(deleteOption("move").getAttribute("aria-checked") === "true" && document.activeElement === deleteOption("move"), "ArrowDown selects Move to another folder");
  ok($("select", dlg) && deletePrimary().disabled, "destination picker appears and the action waits for a choice");
  var options = $$("select option", dlg).map(function (o) { return o.textContent; });
  ok(options.join() === "Choose a folder,Two", "source and Favorites are excluded: " + options);
  keydown(deleteOption("move"), "ArrowDown"); await sync();
  ok(deleteOption("delete").getAttribute("aria-checked") === "true" && !$("select", dlg), "delete selected, picker hidden");
  ok($(".session-folder-delete-confirm input", dlg) && deletePrimary().disabled && deletePrimary().classList.contains("confirm-delete"), "destructive choice needs an explicit checkbox and styles the button");
  ok(/Delete folder and 4 sessions/.test(deletePrimary().textContent), "button states the scope: " + deletePrimary().textContent);
  keydown(document.activeElement, "Escape"); await sync();
  ok(!delDialog(), "Escape cancels");
  ok(sectionLabels().includes("One") && (await serverSessions()) === "1,2,3,4,5,6", "nothing changed");
});

test("delete folder dialog: move to another folder and move to Unfiled apply on the server", async function () {
  var ids = await folderWith(["One", "Two"], [[1, 0], [2, 0]]);
  await openDelete(ids[0]);
  click(deleteOption("move")); await sync();
  var select = $("select", delDialog());
  select.value = ids[1]; select.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  ok(!deletePrimary().disabled && deletePrimary().textContent === "Move and delete folder", "enabled once a destination is chosen");
  click(deletePrimary()); await until(function () { return !delDialog(); }, "dialog closed by the acknowledgement");
  await sync();
  ok(!sectionLabels().includes("One") && titlesIn(ids[1]).join() === "2,1", "sessions moved into Two (activity order): " + titlesIn(ids[1]));
  ok((await serverSessions()) === "1,2,3,4,5,6", "no session was deleted");
  var again = await folderWith(["Plain"], [[2, 0]]);
  await openDelete(again[0]);
  click(deletePrimary()); await until(function () { return !delDialog(); }, "closed");
  await sync();
  ok(titlesIn("unfiled").includes("2") && !sectionLabels().includes("Plain"), "default choice moved to Unfiled");
});

test("delete folder dialog: delete sessions is explicit, pending blocks dismissal, then removes Driver, Workers and folder", async function () {
  var ids = await folderWith(["Doomed"], [[3, 0], [1, 0]]);
  await openDelete(ids[0]);
  click(deleteOption("delete")); await sync();
  ok(deletePrimary().disabled, "disabled until the checkbox is ticked");
  var box = $(".session-folder-delete-confirm input", delDialog());
  box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  ok(!deletePrimary().disabled, "enabled after the explicit confirmation");
  wsDelayMs = 500;
  click(deletePrimary()); await wait(80);
  ok(delDialog().querySelector("[aria-busy='true']") && deletePrimary().disabled && deleteCancel().disabled && /Deleting/.test(deletePrimary().textContent), "pending state: busy, buttons disabled, label changed");
  ok($$("[role='radio']", delDialog()).every(function (r) { return r.disabled; }) && $(".session-folder-delete-confirm input", delDialog()).disabled, "choices locked while pending");
  keydown(document.activeElement, "Escape"); await wait(30);
  ok(delDialog(), "Escape does not dismiss a pending deletion");
  delDialog().querySelector(".confirm-backdrop").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  ok(delDialog(), "backdrop does not dismiss a pending deletion");
  await until(function () { return !delDialog(); }, "acknowledged");
  await sync();
  ok((await serverSessions()) === "2,6", "Driver, both Workers and the member were deleted: " + await serverSessions());
  ok(!sectionLabels().includes("Doomed"), "folder removed");
});

test("delete folder dialog: refusals show inline and keep the dialog; stale contents refresh the count", async function () {
  var ids = await folderWith(["Guarded"], [[1, 0]]);
  await rpc("/rpc/flags", { denyDelete: true });
  await openDelete(ids[0]);
  var del = deleteOption("delete");
  ok(del.disabled && /permission/.test(del.textContent), "delete option disabled with the reason: " + del.textContent);
  click(deleteCancel()); await sync();
  await rpc("/rpc/flags", { denyDelete: false });
  await openDelete(ids[0]);
  click(deleteOption("delete")); await sync();
  var box = $(".session-folder-delete-confirm input", delDialog());
  box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  // another tab files a second session into the folder after the preview
  var outbox = await rpc("/rpc", { socket: "u1b", msg: { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 2, folderId: ids[0] } } });
  deliver(outbox, "u1-b");
  click(deletePrimary()); await sync();
  var alertText = $("[role='alert']", delDialog()).textContent;
  ok(/changed/.test(alertText) && delDialog(), "stale snapshot is refused inline: " + alertText);
  ok(/contains 2 sessions/.test($(".session-folder-delete-intro", delDialog()).textContent), "count refreshed from a new server preview");
  ok((await serverSessions()) === "1,2,3,4,5,6" && sectionLabels().includes("Guarded"), "nothing was deleted");
  ok(deletePrimary().disabled && !$(".session-folder-delete-confirm input", delDialog()).checked, "the confirmation must be given again");
  click(deleteOption("unfiled")); await sync();
  click(deletePrimary()); await until(function () { return !delDialog(); }, "closed after the retry");
  ok(true, "retry with the fresh token succeeds");
  // old delete_folder request is still a safe move to Unfiled
  var legacy = await folderWith(["Legacy"], [[1, 0]]);
  var out2 = await rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "delete_folder", folderId: legacy[0] } } });
  deliver(out2, "u1-a"); await sync();
  ok(!sectionLabels().includes("Legacy") && titlesIn("unfiled").includes("1") && (await serverSessions()) === "1,2,3,4,5,6", "legacy request moved sessions to Unfiled");
});

test("delete folder dialog: empty folder is direct; project switch closes; mobile layout and touch targets", async function () {
  var ids = await folderWith(["Empty"], []);
  await openDelete(ids[0]);
  ok(/is empty/.test($(".session-folder-delete-intro", delDialog()).textContent) && !$("[role='radio']", delDialog()), "no choices for an empty folder");
  click(deletePrimary()); await until(function () { return !delDialog(); }, "closed");
  await sync();
  ok(!sectionLabels().includes("Empty"), "empty folder deleted");
  var again = await folderWith(["Gone"], [[1, 0]]);
  await openDelete(again[0]);
  store.set({ currentSlug: "elsewhere" });
  ok(!delDialog() && !store.get("sessionFolderDelete"), "project switch closes the dialog and clears its state");
  store.set({ currentSlug: "proj" });
  // mobile: the dialog is viewport-bound and keeps full-size targets
  var mobile = await folderWith(["Phone"], [[1, 0]]);
  openFolderDelete(mobile[0], "Phone");
  await until(function () { return delDialog() && deleteOption("unfiled"); }, "mobile dialog");
  var rect = delDialog().querySelector(".confirm-dialog, .session-folder-dialog").getBoundingClientRect();
  ok(rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight, "dialog inside the viewport");
  ok($$("[role='radio']", delDialog()).every(function (r) { return r.getBoundingClientRect().height >= 40; }), "radio rows are at least 40px tall");
  click(deleteCancel()); await sync();
});

test("delete folder dialog: reopening replaces cleanly; disconnects and failed sends never strand the dialog", async function () {
  var ids = await folderWith(["Aaa", "Bbb"], [[1, 0], [2, 1]]);
  openFolderDelete(ids[0], "Aaa");
  openFolderDelete(ids[1], "Bbb");
  await until(function () { return delDialog() && deleteOption("unfiled"); }, "replacement dialog");
  ok($$(".session-folder-modal").length === 1, "exactly one dialog after replacing");
  ok(store.get("sessionFolderDelete") && store.get("sessionFolderDelete").folderId === ids[1], "state belongs to the new folder");
  ok(/"Bbb"/.test($(".session-folder-delete-intro", delDialog()).textContent), "dialog describes the replacement folder");
  click(deleteCancel()); await sync();
  ok(!delDialog() && store.get("sessionFolderDelete") === null && !store.get("sessionFolderModal"), "closing clears the deletion and modal state");
  ok(!document.querySelector(".session-folder-delete"), "no detached or leftover dialog DOM");

  // connection lost while the preview is loading
  dropPreview = true;
  openFolderDelete(ids[0], "Aaa");
  await wait(60);
  ok(store.get("sessionFolderDelete").phase === "loading" && /Checking/.test(delDialog().textContent), "loading state shown");
  store.set({ connected: false }); await wait(30);
  ok(store.get("sessionFolderDelete").phase === "error" && /Connection lost/.test($("[role='alert']", delDialog()).textContent), "disconnect while loading becomes an error with guidance");
  ok(deletePrimary().textContent === "Retry" && deletePrimary().disabled && !deleteCancel().disabled, "Retry waits for the connection, Cancel still works");
  store.set({ connected: true }); dropPreview = false; await wait(30);
  ok(!deletePrimary().disabled, "Retry enabled once reconnected");
  click(deletePrimary());
  await until(function () { return deleteOption("unfiled"); }, "retry delivered the preview");
  ok($("[role='alert']", delDialog()).textContent === "" && /Aaa/.test($(".session-folder-delete-intro", delDialog()).textContent), "retry loads the choices and clears the error");
  click(deleteCancel()); await sync();

  // a synchronous send failure (socket already closed) must not strand loading
  store.set({ connected: false });
  openFolderDelete(ids[0], "Aaa");
  await wait(30);
  ok(store.get("sessionFolderDelete").phase === "error" && deletePrimary().textContent === "Retry", "failed preview send ends loading with Retry");
  store.set({ connected: true }); await wait(30);
  click(deletePrimary());
  await until(function () { return deleteOption("unfiled"); }, "retry after failed send");
  // a failed delete send returns to a usable dialog
  click(deleteOption("delete")); await sync();
  var box = $(".session-folder-delete-confirm input", delDialog());
  box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  store.set({ connected: false });
  click(deletePrimary()); await wait(30);
  ok(store.get("sessionFolderDelete").phase === "ready" && /Not connected/.test($("[role='alert']", delDialog()).textContent), "failed delete send is not left pending");
  store.set({ connected: true });
  // connection lost while a delete is in flight
  wsDelayMs = 600;
  await wait(30);
  click(deletePrimary()); await wait(60);
  ok(store.get("sessionFolderDelete").phase === "pending", "pending");
  store.set({ connected: false }); await wait(30);
  ok(store.get("sessionFolderDelete").phase === "ready" && /Connection lost/.test($("[role='alert']", delDialog()).textContent) && !deleteCancel().disabled, "disconnect while pending is recoverable");
  store.set({ connected: true });
  keydown(document.activeElement, "Escape"); await wait(700);
});

test("delete folder dialog: a socket whose send() throws (still marked connected) recovers for preview and delete", async function () {
  var ids = await folderWith(["Thrower"], [[1, 0]]);
  var good = fakeWs("u1");
  var broken = { readyState: 1, send: function () { throw new Error("socket closed"); } };
  // preview send throws
  setWs(broken);
  ok(store.get("connected") === true, "store still says connected");
  openFolderDelete(ids[0], "Thrower");
  await wait(30);
  var current = store.get("sessionFolderDelete");
  ok(current && current.phase === "error" && !current.preview, "thrown preview send ends in the error phase, not loading");
  ok(deletePrimary().textContent === "Retry" && !deletePrimary().disabled, "Retry is offered while the store still says connected");
  click(deletePrimary()); await wait(30);
  ok(store.get("sessionFolderDelete").phase === "error", "retry against the still-broken socket stays recoverable");
  setWs(good);
  click(deletePrimary());
  await until(function () { return deleteOption("unfiled"); }, "preview after the socket recovered");
  ok($("[role='alert']", delDialog()).textContent === "", "recovered preview clears the error");
  // delete send throws
  click(deleteOption("delete")); await sync();
  var box = $(".session-folder-delete-confirm input", delDialog());
  box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); await sync();
  setWs(broken);
  click(deletePrimary()); await wait(30);
  var after = store.get("sessionFolderDelete");
  ok(after.phase === "ready" && /Not connected/.test($("[role='alert']", delDialog()).textContent), "thrown delete send is not left pending");
  ok(!deletePrimary().disabled === true || after.confirmDelete === true, "the dialog stays usable");
  ok((await serverSessions()) === "1,2,3,4,5,6", "nothing was deleted by the failed send");
  setWs(good);
  click(deletePrimary());
  await until(function () { return !delDialog(); }, "delete after recovery");
  await sync();
  ok((await serverSessions()) === "2,3,4,5,6", "the retried delete went through once the socket recovered: " + await serverSessions());
});

// --- Per-folder inline session creation: one draft row, provider only ---

function newBtn(id, root) { return $('[data-new-session-button="' + id + '"]', root); }
function createRow(id, root) { return $(".session-create-row", root ? $('.session-folder[data-folder-id="' + id + '"]', root) : section(id)); }
function formSelect(key, root) { return $('[data-focus-key="' + key + '"]', root || document); }
function pick(select, value) { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }
function menuEl() { return $(".session-create-menu"); }
function menuItems() { return $$('.session-create-menu [role="menuitem"]'); }
function providerItems() { return menuItems().filter(function (i) { return /^item:/.test(i.dataset.focusKey); }); }
function menuTexts() { return menuItems().map(function (i) { return i.textContent.replace(/\s+/g, " ").trim(); }); }
async function openMenu(root) { if (!menuEl()) { click(formSelect("vendor", root || document)); await sync(); } }
async function chooseVendorItem(name, root) {
  await openMenu(root);
  var item = menuItems().filter(function (i) { return i.textContent.indexOf(name) !== -1; })[0];
  click(item); await sync();
}
function currentVendor() { return store.get("sessionCreate") && store.get("sessionCreate").vendor; }
function newSessionMessages(from) { return wsLog.slice(from || 0).filter(function (m) { return m.type === "new_session"; }); }
async function openCreate(id, root) { click(newBtn(id, root)); await until(function () { var r = createRow(id, root); return r && formSelect("vendor", r) && !formSelect("vendor", r).disabled && currentVendor(); }, "row ready for " + id); }
function visibleBox(el) { return !!el && el.getClientRects().length > 0; }
function sendCollapsed(id, collapsed) { return rpc("/rpc", { socket: "u1", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_collapsed", containerKey: id, collapsed: collapsed } } }).then(function (out) { deliver(out, "u1-a"); }); }
function setProjectDefault(value) { return rpc("/rpc/default", { value: value }); }

test("creation shimmer: acknowledged folder title sweeps twice, cleans up, and failures or replay stay still", async function () {
  await freshWorld();
  await newFolderViaDialog("Gathered");
  var id = folderIdByLabel("Gathered");
  var created = $(".session-folder-label", section(id));
  var headerRect = $(".session-folder-header", section(id)).getBoundingClientRect();
  var titleRect = created.getBoundingClientRect();
  var originalText = created.textContent;
  var reference = document.createElement("span");
  reference.className = "thinking-live";
  reference.innerHTML = '<span class="thinking-label">' + originalText + '</span>';
  document.body.appendChild(reference);
  ok(created.classList.contains("sidebar-creation-shimmer"), "the acknowledged real folder title shimmers");
  ok(!$(".sidebar-creation-particle-layer, .sidebar-creation-particle, .sidebar-creation-settle") && !$(".session-folder-icon.sidebar-creation-shimmer, .session-folder-header.sidebar-creation-shimmer"), "no creation particles, row motion or non-title target exists");
  var effectKey = created.dataset.creationEffect;
  ok(/^folder:folder-/.test(effectKey) && !(store.get("sidebarCreationEffects") || []).length, "the correlated request is consumed before playback");
  var creationStyle = getComputedStyle(created);
  var thinkingStyle = getComputedStyle($(".thinking-label", reference));
  ok(creationStyle.backgroundImage === thinkingStyle.backgroundImage && creationStyle.backgroundSize === thinkingStyle.backgroundSize && creationStyle.animationName === thinkingStyle.animationName && creationStyle.animationDuration === thinkingStyle.animationDuration && creationStyle.animationTimingFunction === thinkingStyle.animationTimingFunction, "creation uses the production Thinking gradient, 300% spread, keyframes, 2.8s pacing and easing");
  ok(creationStyle.animationIterationCount === "2" && thinkingStyle.animationIterationCount === "infinite", "creation is exactly two finite Thinking passes");
  var iterations = 0;
  var ended = 0;
  created.addEventListener("animationiteration", function () { iterations++; }, { once: true });
  created.addEventListener("animationend", function () { ended++; }, { once: true });
  await wait(900);
  var duringRect = created.getBoundingClientRect();
  ok(created.textContent === originalText && Math.abs(duringRect.left - titleRect.left) < 0.5 && Math.abs(duringRect.width - titleRect.width) < 0.5 && Math.abs($(".session-folder-header", section(id)).getBoundingClientRect().height - headerRect.height) < 0.5, "text and layout remain unchanged during the shimmer");
  await wait(4800);
  reference.remove();
  ok(iterations === 1 && ended === 1, "two-pass animation emits one iteration boundary and one finite end");
  ok(!created.classList.contains("sidebar-creation-shimmer") && !created.dataset.creationEffect && getComputedStyle(created).backgroundImage === "none", "title fully restores after two finite Thinking-paced passes");
  handleSessionFoldersState({ type: "session_folders_state", slug: "proj", requestId: effectKey.slice(7), folderId: id, state: store.get("sessionFolders") });
  handleSessionFoldersState({ type: "session_folders_state", slug: "proj", state: store.get("sessionFolders") });
  await wait(80);
  ok(!$(".sidebar-creation-shimmer"), "duplicate acknowledgement and snapshot do not replay");

  await rpc("/rpc/flags", { saveFail: true });
  click($("[data-new-folder-button='desktop']"));
  typeInto(createInput(), "Rejected");
  keydown(createInput(), "Enter");
  await sync();
  ok(createInput() && createError() && !$(".sidebar-creation-shimmer"), "failed creation remains editable and has no shimmer");
  await rpc("/rpc/flags", { saveFail: false });
});

test("creation shimmer: session acknowledgement waits for the real desktop and mobile title, skips Favorites, and stays bounded", async function () {
  await freshWorld();
  var requestId = "effect-ack-before-list";
  store.set({ sessionCreate: { folderId: "unfiled", vendor: "claude", phase: "pending", requestId: requestId, timer: null }, sessionCreateLocks: {} });
  ok(handleNewSessionResult({ type: "new_session_result", requestId: requestId, ok: true, sessionId: 880, folderId: null }) === true, "local acknowledgement accepted");
  await wait(80);
  ok((store.get("sidebarCreationEffects") || []).length === 1 && !$(".sidebar-creation-shimmer"), "effect waits without delaying the missing list row");
  SESSIONS.push({ id: 880, title: "Ordered", lastActivity: 2880, createdAt: 9, vendor: "claude", sessionRole: "driver" });
  await renderAll();
  await until(function () { return $(".session-item-title.sidebar-creation-shimmer", unitIn("unfiled", 880)); }, "acknowledged desktop session title shimmer");
  ok($(".session-item-title", unitIn("unfiled", 880)).classList.contains("sidebar-creation-shimmer"), "the actual desktop title in Unfiled shimmers");
  ok(!unitIn("favorites", 880) || !$(".session-item-title", unitIn("favorites", 880)).classList.contains("sidebar-creation-shimmer"), "Favorites representation is never targeted");
  ok(!$(".session-vendor-icon.sidebar-creation-shimmer, .session-item.sidebar-creation-shimmer, .sidebar-creation-particle"), "avatar, row and particles remain untouched");

  clearSidebarCreationEffects();
  var desktop = document.getElementById("sidebar");
  var host = document.createElement("div");
  host.style.cssText = "position:fixed;right:0;top:0;width:280px;height:100vh;overflow:auto;background:var(--sidebar-bg);z-index:5";
  document.body.appendChild(host);
  desktop.style.display = "none";
  try {
    var mobileRequest = "effect-mobile-ack-before-list";
    store.set({ sessionCreate: { folderId: "unfiled", vendor: "claude", phase: "pending", requestId: mobileRequest, timer: null }, sessionCreateLocks: {} });
    handleNewSessionResult({ type: "new_session_result", requestId: mobileRequest, ok: true, sessionId: 881, folderId: null });
    SESSIONS.push({ id: 881, title: "A deliberately long newly created mobile session title", lastActivity: 2881, createdAt: 10, vendor: "claude", sessionRole: "driver" });
    await renderAll();
    renderMobileSessionsInto(host);
    await until(function () { return $(".mobile-session-title.sidebar-creation-shimmer", unitIn("unfiled", 881, host)); }, "acknowledged mobile session title shimmer");
    var mobileTitle = $(".mobile-session-title", unitIn("unfiled", 881, host));
    ok(mobileTitle.classList.contains("sidebar-creation-shimmer") && mobileTitle.scrollWidth >= mobileTitle.clientWidth, "the real long/truncated mobile title receives the shimmer");
    ok(!$(".mobile-session-vendor-icon.sidebar-creation-shimmer, .mobile-session-item.sidebar-creation-shimmer", host), "mobile avatar and row remain untouched");
  } finally {
    clearSidebarCreationEffects();
    desktop.style.display = "";
    host.remove();
  }

  var rapidIds = [1, 2, 3, 880, 881];
  for (var rapid = 0; rapid < rapidIds.length; rapid++) queueSidebarCreationEffect("session", "rapid-" + rapid, rapidIds[rapid], "unfiled");
  await wait(40);
  ok($$(".sidebar-creation-shimmer").length === 4 && !$(".sidebar-creation-particle, .sidebar-creation-particle-layer, .sidebar-creation-settle"), "rapid successful creates retain at most four independent title shimmers and no obsolete DOM");
});

test("creation shimmer: reduced motion and failed session acknowledgements produce no movement", async function () {
  await freshWorld();
  var originalMatchMedia = window.matchMedia;
  try {
    window.matchMedia = function (query) { return { matches: query === "(prefers-reduced-motion: reduce)" }; };
    ok(queueSidebarCreationEffect("session", "reduced", 1, "unfiled") === false, "reduced motion declines the effect at its source");
    store.set({ sessionCreate: { folderId: "unfiled", vendor: "claude", phase: "pending", requestId: "failed", timer: null }, sessionCreateLocks: {} });
    handleNewSessionResult({ type: "new_session_result", requestId: "failed", ok: false, error: "Nope" });
    await wait(40);
    ok(!(store.get("sidebarCreationEffects") || []).length && !$(".sidebar-creation-shimmer") && !$(".sidebar-creation-particle, .sidebar-creation-particle-layer, .sidebar-creation-settle"), "reduced motion and failure leave no animation class, obsolete DOM or queued work");
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test("new session: no global or Favorites control; each real folder has a quiet compact pill", async function () {
  await freshWorld();
  await newFolderViaDialog("One");
  var one = folderIdByLabel("One");
  ok(!$("#session-top-actions-host") && !$(".session-top-actions") && !$("[class*='session-create-cta']") && !$(".session-top-action"), "no global Create new session control");
  ok(!newBtn("favorites"), "Favorites has no creation pill");
  var pillIds = [one, "unfiled"];
  for (var pi = 0; pi < pillIds.length; pi++) {
    var id = pillIds[pi];
    var header = $(".session-folder-header", section(id));
    var btn = newBtn(id), label = $(".session-folder-label", header), count = $(".session-folder-count", header);
    var hr = header.getBoundingClientRect(), br = btn.getBoundingClientRect(), cr = count.getBoundingClientRect(), lr = label.getBoundingClientRect();
    ok($(".session-folder-new-label-text", btn).textContent === "New session" && btn.getAttribute("aria-label") === "New session in " + label.textContent, id + ": labelled pill");
    ok(hr.right - br.right < 12 && br.left > cr.right, id + ": right side of the header");
    ok(br.height >= 18 && br.height <= 24 && br.width <= 26, id + ": compact at rest " + br.width + "x" + br.height);
    var icon = $("svg", btn).getBoundingClientRect();
    ok(Math.abs((icon.left + icon.right) / 2 - (br.left + br.right) / 2) < 0.6, id + ": collapsed plus is centered without a trailing label gap");
    var right = br.right;
    var restingWidth = br.width;
    btn.focus();
    await wait(70);
    var intermediateWidth = btn.getBoundingClientRect().width;
    await wait(150);
    br = btn.getBoundingClientRect();
    var expandedLabel = $(".session-folder-new-label", btn);
    ok(intermediateWidth > restingWidth && intermediateWidth < br.width, id + ": focus reveal has a real intermediate width: " + restingWidth + " < " + intermediateWidth + " < " + br.width);
    ok(br.width >= 70 && Math.abs(br.right - right) < 1, id + ": focus expands left while preserving the pointer edge");
    ok(expandedLabel.scrollWidth <= expandedLabel.clientWidth && expandedLabel.getBoundingClientRect().width > 0, id + ": full New session label fits: " + expandedLabel.scrollWidth + " <= " + expandedLabel.clientWidth);
    btn.blur();
    var bg = getComputedStyle(btn).backgroundColor;
    ok(!/rgb\(1[0-9][0-9], 1[0-9][0-9], 2[0-9][0-9]\)/.test(bg) && getComputedStyle(btn).color !== "rgb(255, 255, 255)", id + ": quiet, not an accent-filled button: " + bg);
    ok(cr.left - lr.right >= 0 && cr.left - lr.right < 14, id + ": count right beside the name: " + (cr.left - lr.right));
  }
  var reversing = newBtn(one);
  await wait(220);
  reversing.focus(); await wait(60);
  var growingWidth = reversing.getBoundingClientRect().width;
  reversing.blur(); await wait(45);
  var reversingWidth = reversing.getBoundingClientRect().width;
  reversing.focus(); await wait(45);
  var regrowingWidth = reversing.getBoundingClientRect().width;
  ok(reversingWidth < growingWidth && regrowingWidth > reversingWidth, "rapid focus reversal continues smoothly from the live width: " + [growingWidth, reversingWidth, regrowingWidth]);
  reversing.blur(); await wait(220);
  var css = await (await fetch("/css/session-folders.css")).text();
  ok(/grid-template-columns\s+180ms/.test(css) && /prefers-reduced-motion:[^}]+session-folder-new-btn,\s*\.session-folder-new-label\s*\{\s*transition:\s*none/s.test(css), "intrinsic reveal is bounded at 180ms and reduced motion disables it");
  var originalMatchMedia = window.matchMedia;
  try {
    window.matchMedia = function (query) { return { matches: query === "(prefers-reduced-motion: reduce)" }; };
    click(newBtn(one));
    ok(!newBtn(one).classList.contains("is-label-changing"), "reduced motion skips the label crossfade");
    click(formSelect("cancel", createRow(one)));
  } finally {
    window.matchMedia = originalMatchMedia;
  }
});

test("new session: compact picker and icon Cancel sit under the header while the header becomes Create", async function () {
  await freshWorld();
  await setProjectDefault({ vendor: "codex" });
  await sendCollapsed("unfiled", true); await sync();
  ok(section("unfiled").querySelector(".session-folder-body").hidden === true, "Unfiled is collapsed");
  var before = wsLog.length;
  await openCreate("unfiled");
  var rowEl = createRow("unfiled");
  ok(visibleBox(rowEl) && section("unfiled").querySelector(".session-folder-body").hidden === true, "row visible while the folder stays collapsed");
  ok(rowEl.previousElementSibling === $(".session-folder-header", section("unfiled")), "directly beneath the header");
  ok(newBtn("unfiled").getAttribute("aria-expanded") === "true" && newBtn("unfiled").getAttribute("aria-controls") === rowEl.id, "pill exposes the open row");
  var guidance = $(".session-create-status", rowEl);
  ok(guidance.textContent.trim() === "" && !visibleBox(guidance) && !newBtn("unfiled").hasAttribute("aria-describedby"), "ready state has no detached helper text or stale description");
  ok(!$$("label", rowEl).length && !/Provider|Model|Effort|Pair|Skip|explain/i.test(rowEl.textContent.replace(/Claude Code|Codex|Use as project default|project default/g, "")), "no labels, model, effort or extras in the row: " + rowEl.textContent);
  ok(!$$("select", rowEl).length && $$("button", rowEl).length === 2 && !$$('.session-create-actions, .session-create-form', rowEl).length, "exactly one picker and one icon Cancel button");
  var vendorSelect = formSelect("vendor", rowEl);
  ok(!formSelect("create", rowEl) && formSelect("cancel", rowEl).getAttribute("aria-label") === "Cancel new session" && !formSelect("cancel", rowEl).textContent.trim(), "no in-row Create and icon Cancel remains accessible");
  ok($(".session-folder-new-label-text", newBtn("unfiled")).textContent === "Click to create" && newBtn("unfiled").getAttribute("aria-label") === "Click to create session in Unfiled", "the same header button carries the visible confirmation CTA");
  ok(!/Click again to create/.test(document.body.textContent), "the old helper wording is absent from the page");
  ok(!menuEl() && vendorSelect.getAttribute("aria-haspopup") === "menu" && vendorSelect.getAttribute("aria-expanded") === "false", "dropdown closed at rest");
  ok(currentVendor() === "codex" && /Codex/.test(vendorSelect.textContent), "the project default is preselected: " + vendorSelect.textContent);
  ok(document.activeElement !== vendorSelect, "opening never auto-focuses the picker or relocates the action target");
  ok(!newSessionMessages(before).length && (await (await fetch("/rpc/default")).json()).value.vendor === "codex", "opening creates and persists nothing");
  var line = $(".session-create-line", rowEl).getBoundingClientRect();
  var pickerStyle = getComputedStyle(vendorSelect);
  ok(line.height >= 26 && line.height <= 28 && $(".session-create-icon", rowEl).getBoundingClientRect().width === 12, "short compact line and smaller icon: " + line.height);
  ok(parseFloat(pickerStyle.fontSize) === 12 && pickerStyle.fontWeight === "400", "provider label uses quiet 12px normal typography: " + pickerStyle.fontSize + "/" + pickerStyle.fontWeight);
  ok(Math.abs(line.left - (section("unfiled").getBoundingClientRect().left + 12)) < 1, "left edge sits at session indentation (folder body margin, rule and padding): " + line.left);
  ok(getComputedStyle($(".session-create-line", rowEl)).borderTopWidth === "0px", "no boxed panel");
  await chooseVendorItem("Claude Code", rowEl);
  ok($(".session-create-icon", createRow("unfiled")).src.length && currentVendor() === "claude" && !menuEl(), "picking changes the provider only and closes the dropdown");
  ok((await (await fetch("/rpc/default")).json()).value.vendor === "codex", "changing the selection did not touch the saved default");
  keydown(document.activeElement, "Escape"); await sync();
  ok(!createRow("unfiled") && document.activeElement === newBtn("unfiled") && !newBtn("unfiled").hasAttribute("aria-describedby"), "Escape cancels, removes the guidance association and returns focus to the pill");
  await openCreate("unfiled");
  click(formSelect("cancel", createRow("unfiled"))); await sync();
  ok(!createRow("unfiled") && !newSessionMessages(before).length, "Cancel closes without creating");
});

test("new session: the stable header action creates once and sends only the provider", async function () {
  var ids = await folderWith(["One"], [[1, 0]]);
  await sendCollapsed(ids[0], true); await sync();
  var first = newBtn(ids[0]);
  var firstRect = first.getBoundingClientRect();
  var createX = firstRect.right - 10;
  var createY = firstRect.top + firstRect.height / 2;
  clickAt(first, createX, createY);
  var openingButton = newBtn(ids[0]);
  ok(openingButton.classList.contains("is-label-changing") && $(".session-folder-new-label-previous", openingButton).textContent === "New session", "opening crossfades from New session without rebuilding the button contents in place");
  await until(function () { var r = createRow(ids[0]); return r && formSelect("vendor", r) && !formSelect("vendor", r).disabled && currentVendor(); }, "same-pointer row ready");
  await chooseVendorItem("Claude Code", createRow(ids[0]));
  wsDelayMs = 400;
  var before = wsLog.length;
  var select = formSelect("vendor", createRow(ids[0]));
  select.focus();
  ok(!keydown(select, "Enter").defaultPrevented, "Enter is left to the picker button's own activation");
  keydown(select, "Enter", { isComposing: true });
  await wait(30);
  ok(!newSessionMessages(before).length && store.get("sessionCreate").phase === "ready", "Enter on the picker created nothing");
  var create = newBtn(ids[0]);
  var createRect = create.getBoundingClientRect();
  ok(Math.abs(createRect.right - firstRect.right) < 0.6 && createX >= createRect.left && createX <= createRect.right, "first-click pointer remains inside the ready CTA at the same right anchor");
  create.focus(); clickAt(create, createX, createY); await wait(30);
  clickAt(newBtn(ids[0]), createX, createY);
  var sent = newSessionMessages(before);
  ok(sent.length === 1, "one request despite a second click: " + sent.length);
  ok(Object.keys(sent[0]).sort().join() === "folderId,folderSlug,forceNew,requestId,slug,type,vendor".split(",").sort().join() || Object.keys(sent[0]).sort().join() === "folderId,folderSlug,forceNew,requestId,type,vendor", "provider-only payload, no model or effort: " + JSON.stringify(sent[0]));
  ok(sent[0].vendor === "claude" && sent[0].folderId === ids[0] && sent[0].folderSlug === "proj" && sent[0].forceNew === true && /^scn-/.test(sent[0].requestId), "payload values");
  ok(createRow(ids[0]).getAttribute("aria-busy") === "true" && newBtn(ids[0]).disabled && $(".session-folder-new-label-text", newBtn(ids[0])).textContent === "Creating…" && formSelect("vendor", createRow(ids[0])).disabled && $(".session-create-status", createRow(ids[0])).textContent.trim() === "Creating session…", "pending locks the row and gives accurate Creating guidance on the button and status");
  ok($$(".session-folder-new-btn").every(function (b) { return b.disabled; }), "every pill is disabled while pending");
  click(newBtn(ids[0])); click(newBtn("unfiled")); click(formSelect("cancel", createRow(ids[0])));
  keydown(document.activeElement, "Escape"); await wait(20);
  ok(createRow(ids[0]) && store.get("sessionCreate").folderId === ids[0], "nothing closes or replaces a pending row");
  await until(function () { return !createRow(ids[0]); }, "acknowledged");
  await sync();
  var made = SESSIONS[SESSIONS.length - 1].id;
  ok(titlesIn(ids[0]).includes(String(made)), "filed in the chosen folder: " + titlesIn(ids[0]));
  ok(section(ids[0]).querySelector(".session-folder-body").hidden === false && (await stored()).collapsed[ids[0]] === undefined, "the folder was expanded");
  ok(store.get("activeSessionId") === made && visibleBox(row(made)), "the new session is selected and visible");
  ok(!store.get("sessionCreate") && !Object.keys(store.get("sessionCreateLocks") || {}).length && !$$(".session-folder-new-btn").some(function (b) { return b.disabled; }), "row closed, no lock leaked, pills usable again");
});

test("new session: Favorites is refused, filing failures reveal the real destination, keyboard creation reveals Unfiled", async function () {
  await freshWorld();
  var sessionsBefore = await serverSessions();
  var refused = await rpc("/rpc", { socket: "u1", msg: { type: "new_session", slug: "proj", requestId: "favorite-create", vendor: "claude", forceNew: true, folderId: "favorites", folderSlug: "proj" } });
  var refusedResult = refused.map(function (e) { return e.msg; }).filter(function (m) { return m.type === "new_session_result"; })[0];
  ok(refusedResult && refusedResult.ok === false && /Favorites is a tag/.test(refusedResult.error) && (await serverSessions()) === sessionsBefore, "crafted Favorites creation is refused without creating");
  await sendCollapsed("unfiled", true); await sync();
  var b2 = wsLog.length;
  await openCreate("unfiled");
  click(newBtn("unfiled"));
  await until(function () { return !createRow("unfiled"); }, "unfiled created"); await sync();
  var made = SESSIONS[SESSIONS.length - 1].id;
  ok(newSessionMessages(b2)[0].folderId === null && section("unfiled").querySelector(".session-folder-body").hidden === false && visibleBox(row(made)), "Unfiled expanded and the session revealed");
  var ids = await folderWith(["Target"], []);
  await sendCollapsed(ids[0], true); await sendCollapsed("unfiled", true); await sync();
  await openCreate(ids[0]);
  await rpc("/rpc/flags", { saveFail: true });
  var b3 = wsLog.length;
  click(newBtn(ids[0]));
  await until(function () { return !createRow(ids[0]); }, "filing failure acknowledged"); await sync();
  await rpc("/rpc/flags", { saveFail: false });
  var expanded = wsLog.slice(b3).filter(function (m) { return m.op && m.op.op === "set_collapsed"; }).map(function (m) { return m.op.containerKey; });
  ok(expanded.join() === "unfiled" && !titlesIn(ids[0]).includes(String(SESSIONS[SESSIONS.length - 1].id)), "only Unfiled was expanded when filing failed: " + expanded);
  await sendCollapsed("unfiled", true); await sync();
  expectCreatedSession("unfiled");
  SESSIONS.push({ id: 777, title: "Keyboard", lastActivity: 5000, createdAt: 9, vendor: "claude", sessionRole: "driver" });
  store.set({ activeSessionId: 777 }); await renderAll(); await sync();
  ok(section("unfiled").querySelector(".session-folder-body").hidden === false && visibleBox(row(777)), "keyboard-created session reveals Unfiled");
});

test("new session: stale folders, lost connections and dropped or late provider replies stay inline and recoverable", async function () {
  var ids = await folderWith(["Gone"], []);
  await openCreate(ids[0]);
  await rpc("/rpc", { socket: "u1b", msg: { type: "session_folders_op", slug: "proj", op: { op: "delete_folder", folderId: ids[0] } } });
  var sessionsBefore = await serverSessions();
  click(newBtn(ids[0]));
  await until(function () { return /no longer exists/.test(createRow(ids[0]) ? createRow(ids[0]).textContent : "") || !createRow(ids[0]); }, "stale folder outcome");
  ok((await serverSessions()) === sessionsBefore, "stale folder: the production handler created nothing");
  if (createRow(ids[0])) click(formSelect("cancel", createRow(ids[0])));
  await freshWorld();
  await openCreate("unfiled");
  store.set({ activeSessionId: 5, currentVendor: "prior", vendorSelectionLocked: false });
  wsDelayMs = 200;
  click(newBtn("unfiled")); await wait(40);
  ok(Object.keys(store.get("sessionCreateLocks") || {}).length === 1, "one lock while pending");
  store.set({ connected: false }); await wait(30);
  ok(/may already have been created/.test(createRow("unfiled").textContent) && store.get("sessionCreate").phase === "ready" && !Object.keys(store.get("sessionCreateLocks") || {}).length, "disconnect ends pending honestly and drops the lock");
  store.set({ connected: true }); wsDelayMs = 0; await wait(700);
  keydown(document.activeElement, "Escape");
  await freshWorld();
  await rpc("/rpc/flags", { dropOptions: true });
  click(newBtn("unfiled")); await wait(250);
  ok(store.get("sessionCreateOptions").requestId && formSelect("vendor", createRow("unfiled")).disabled && $(".session-create-status", createRow("unfiled")).textContent.trim() === "Loading providers…", "a dropped options request leaves the row loading, disabled and accurately described");
  var oldId = store.get("sessionCreateOptions").requestId;
  store.set({ connected: false }); await wait(30);
  ok(!store.get("sessionCreateOptions").requestId && /Connection lost/.test(createRow("unfiled").textContent) && !/Click again to create/.test(createRow("unfiled").textContent) && formSelect("retry", createRow("unfiled")), "disconnect error remains inline and offers Retry without restoring old helper copy");
  await rpc("/rpc/flags", { dropOptions: false });
  store.set({ connected: true });
  await until(function () { var v = formSelect("vendor", createRow("unfiled")); return v && !v.disabled && currentVendor(); }, "recovered after reconnect");
  var optionsNow = store.get("sessionCreateOptions");
  handleSessionCreateMessage({ type: "new_session_options", requestId: oldId, vendors: [], projectDefault: "evil", canSetProjectDefault: true });
  handleSessionCreateMessage({ type: "new_session_options", requestId: null, vendors: [], projectDefault: null, canSetProjectDefault: true });
  ok(store.get("sessionCreateOptions") === optionsNow, "late or unsolicited provider replies are ignored");
  keydown(document.activeElement, "Escape");
});

test("new session: the provider dropdown lists every registered provider, marks unavailable ones, and only installed ones can be chosen", async function () {
  await freshWorld();
  await openCreate("unfiled");
  await openMenu(createRow("unfiled"));
  var names = menuTexts();
  ok(providerItems().length >= 10 && names.length >= 10, "all registered providers are discoverable, not just two: " + providerItems().length);
  ok(names[0] === "Claude Code" || /Claude Code/.test(names[0]), "established order, installed first provider: " + names[0]);
  var installedItems = providerItems().filter(function (i) { return !i.classList.contains("unavailable"); });
  var unavailable = providerItems().filter(function (i) { return i.classList.contains("unavailable"); });
  ok(installedItems.length === 3 && unavailable.length === providerItems().length - 3, "the server's per-user installed flags decide: " + installedItems.length + " installed, " + unavailable.length + " unavailable");
  ok(unavailable.every(function (i) {
    return i.disabled && !/^Learn about /.test(i.textContent.trim()) && /Not installed/.test(i.textContent) && !i.querySelector("svg") && !i.querySelector(".vendor-experimental-badge");
  }), "unavailable entries show only their vendor name, icon and subtle Not installed status");
  ok(installedItems.some(function (i) { return /Kimi/.test(i.textContent); }), "a vendor beyond Claude and Codex is installed and selectable");
  var menuRect = menuEl().getBoundingClientRect();
  var providerGeometry = providerItems().map(function (item) {
    var name = $(".session-create-menu-name", item), note = $(".session-create-menu-note", item);
    return {
      height: item.getBoundingClientRect().height,
      nameFits: name.scrollWidth <= name.clientWidth,
      noteFits: !note || note.scrollWidth <= note.clientWidth,
      separated: !note || name.getBoundingClientRect().right <= note.getBoundingClientRect().left,
    };
  });
  var defaultGeometry = $$(".session-create-default-btn", menuEl()).map(function (item) {
    return { height: item.getBoundingClientRect().height, fits: item.scrollWidth <= item.clientWidth };
  });
  ok(menuRect.height < 300 && menuRect.width >= 260 && menuRect.width <= 280, "compact desktop menu: " + JSON.stringify(menuRect));
  ok(providerGeometry.every(function (g) { return g.height >= 24 && g.height <= 25 && g.nameFits && g.noteFits && g.separated; }), "all provider names and statuses fit nonoverlapping 24px rows: " + JSON.stringify(providerGeometry));
  ok(defaultGeometry.every(function (g) { return g.height >= 24 && g.height <= 25 && g.fits; }), "Set default actions fit the compact rows: " + JSON.stringify(defaultGeometry));
  var opened = [];
  var realOpen = window.open;
  window.open = function (url) { opened.push(url); return null; };
  var before = currentVendor();
  var beforeUnavailable = wsLog.length;
  click(unavailable[0]); await sync();
  window.open = realOpen;
  ok(opened.length === 0 && currentVendor() === before && menuEl() && !newSessionMessages(beforeUnavailable).length, "an unavailable entry cannot navigate, select or create");
  installedItems[installedItems.length - 1].focus();
  for (var k = 0; k < menuItems().length + 2; k++) {
    keydown(document.activeElement, "ArrowDown");
    ok(document.activeElement && !document.activeElement.disabled && !document.activeElement.classList.contains("unavailable"), "keyboard navigation skips disabled unavailable entries");
  }
  keydown(document.activeElement, "End");
  var enabledMenuItems = menuItems().filter(function (item) { return !item.disabled; });
  ok(document.activeElement === enabledMenuItems[enabledMenuItems.length - 1], "End lands on the final enabled menu action");
  var b2 = wsLog.length;
  store.set({ sessionCreate: Object.assign({}, store.get("sessionCreate"), { vendor: "opencode", menuOpen: false }) });
  await sync();
  ok(newBtn("unfiled").disabled, "header Create stays disabled for an unavailable provider");
  click(newBtn("unfiled")); await sync();
  ok(!newSessionMessages(b2).length, "a disabled Create sends nothing");
  keydown(document.activeElement, "Escape");
});

test("new session: the server refuses a provider that is not installed or authorized, creating nothing", async function () {
  await freshWorld();
  var before = await serverSessions();
  var out = await rpc("/rpc", { socket: "u1", msg: { type: "new_session", slug: "proj", requestId: "forced-1", vendor: "opencode", forceNew: true, folderId: null, folderSlug: "proj" } });
  var result = out.map(function (e) { return e.msg; }).filter(function (m) { return m.type === "new_session_result"; })[0];
  ok(result && result.ok === false && /not installed or authorized/.test(result.error) && (await serverSessions()) === before, "refused by the production handler: " + JSON.stringify(result));
});

test("new session: dropdown keyboard, outside pointerdown, Escape layering and focus", async function () {
  await freshWorld();
  await openCreate("unfiled");
  var picker = formSelect("vendor", createRow("unfiled"));
  picker.focus();
  keydown(picker, "ArrowDown"); await sync();
  ok(menuEl() && formSelect("vendor", createRow("unfiled")).getAttribute("aria-expanded") === "true" && document.activeElement === menuItems()[0], "ArrowDown opens the menu and focuses the selected item");
  keydown(document.activeElement, "ArrowDown"); await sync();
  ok(document.activeElement === menuItems()[1], "ArrowDown moves down");
  keydown(document.activeElement, "End"); await sync();
  var enabledItems = menuItems().filter(function (item) { return !item.disabled; });
  ok(document.activeElement === enabledItems[enabledItems.length - 1], "End skips unavailable rows and goes to the last enabled item");
  keydown(document.activeElement, "Home"); await sync();
  ok(document.activeElement === menuItems()[0], "Home goes to the first");
  keydown(document.activeElement, "Escape"); await sync();
  ok(!menuEl() && createRow("unfiled") && document.activeElement === formSelect("vendor", createRow("unfiled")), "the first Escape closes only the menu and returns focus to the picker");
  keydown(document.activeElement, "Escape"); await sync();
  ok(!createRow("unfiled"), "the second Escape cancels the row");
  await openCreate("unfiled");
  await openMenu(createRow("unfiled"));
  var guard = document.getElementById("pointer-guard");
  var outside = document.createElement("input");
  outside.style.cssText = "position:fixed;left:320px;bottom:4px;z-index:5";
  document.body.appendChild(outside);
  var press = pointerAt(guard, "pointerdown");
  ok(press.defaultPrevented && !menuEl() && createRow("unfiled"), "a pointerdown-only outside press closes the menu and keeps the row");
  await openMenu(createRow("unfiled"));
  pointerAt(outside, "pointerdown"); outside.focus(); await sync();
  ok(!menuEl() && document.activeElement === outside, "an outside press closes the menu without stealing focus");
  await openMenu(createRow("unfiled"));
  pointerAt(menuEl(), "pointerdown"); menuEl().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  ok(menuEl(), "presses inside the menu keep it open");
  window.dispatchEvent(new Event("blur"));
  ok(!menuEl(), "window blur closes it");
  outside.remove();
  await openMenu(createRow("unfiled"));
  store.set({ currentSlug: "elsewhere" });
  ok(!menuEl() && !store.get("sessionCreate"), "project change removes the menu and the row");
  store.set({ currentSlug: "proj" });
});

test("new session: compact row and stable header action fit 280/320 widths and mobile", async function () {
  await freshWorld();
  var sidebar = document.getElementById("sidebar");
  var original = sidebar.style.cssText;
  try {
    for (var w of [280, 320]) {
      sidebar.style.cssText = original + ";width:" + w + "px;min-width:" + w + "px;flex:none";
      var newAction = newBtn("unfiled");
      newAction.focus();
      await wait(220);
      var newActionRect = newAction.getBoundingClientRect();
      var newActionLabel = $(".session-folder-new-label", newAction);
      ok(newActionLabel.scrollWidth <= newActionLabel.clientWidth, w + ": full expanded New session label fits: " + newActionLabel.scrollWidth + " <= " + newActionLabel.clientWidth);
      newAction.blur();
      await openCreate("unfiled");
      await wait(220);
      var rowEl = createRow("unfiled"), line = $(".session-create-line", rowEl).getBoundingClientRect(), picker = formSelect("vendor", rowEl).getBoundingClientRect();
      var cancel = formSelect("cancel", rowEl), create = newBtn("unfiled");
      ok(line.height >= 26 && line.height <= 28 && line.right <= sidebar.getBoundingClientRect().right + 0.5, w + ": compact line inside the sidebar");
      ok(!formSelect("create", rowEl) && cancel.getBoundingClientRect().right <= line.right + 0.5 && $(".session-folder-new-label-text", create).textContent === "Click to create", w + ": only header confirmation CTA plus icon Cancel, no overflow");
      var createLabel = $(".session-folder-new-label", create), createStyle = getComputedStyle(create);
      ok(createLabel.scrollWidth <= createLabel.clientWidth && createLabel.getBoundingClientRect().width > 0, w + ": full Create label fits: " + createLabel.scrollWidth + " <= " + createLabel.clientWidth);
      var createRect = create.getBoundingClientRect();
      var createSizer = $(".session-folder-new-label-sizer", create);
      ok(Math.abs(createRect.right - newActionRect.right) < 0.6 && Math.abs(createRect.width - newActionRect.width) < 0.6, w + ": expanded New session and confirmation CTA keep the same target geometry: new " + newActionRect.width + "/" + newActionRect.right + ", create " + createRect.width + "/" + createRect.right + ", label " + createLabel.getBoundingClientRect().width + "/" + createLabel.clientWidth + "/" + createLabel.scrollWidth + ", sizer " + (createSizer && createSizer.getBoundingClientRect().width));
      var accentProbe = document.createElement("span");
      accentProbe.style.color = "var(--accent)";
      document.body.appendChild(accentProbe);
      var accentColor = getComputedStyle(accentProbe).color;
      accentProbe.remove();
      ok(createStyle.color === accentColor && createStyle.borderTopColor !== "rgba(0, 0, 0, 0)", w + ": active Create has an intentional accent state: " + createStyle.color);
      ok(picker.width >= 95, w + ": the picker keeps room for a full provider name: " + picker.width);
      await openMenu(rowEl);
      var m = menuEl().getBoundingClientRect();
      var menuNames = $$(".session-create-menu-name", menuEl()), menuNotes = $$(".session-create-menu-note", menuEl());
      ok(m.left >= 0 && m.right <= window.innerWidth && m.bottom <= window.innerHeight && m.width >= 260 && m.width <= 280, w + ": compact dropdown inside the viewport: " + JSON.stringify(m));
      ok(menuNames.every(function (name) { return name.scrollWidth <= name.clientWidth; }) && menuNotes.every(function (note) { return note.scrollWidth <= note.clientWidth; }), w + ": full provider names and statuses remain unclipped");
      keydown(document.activeElement, "Escape"); keydown(document.activeElement, "Escape"); await sync();
    }
  } finally { sidebar.style.cssText = original; }
});

test("new session: each available vendor has a direct permission-gated project-default action", async function () {
  await freshWorld();
  await openCreate("unfiled");
  await openMenu(createRow("unfiled"));
  var defaults = $$(".session-create-default-btn", menuEl());
  var installedRows = providerItems().filter(function (item) { return !item.classList.contains("unavailable"); });
  var markedDefault = installedRows.filter(function (item) { return item.getAttribute("aria-current") === "true"; }).length;
  ok(defaults.length === installedRows.length - markedDefault && defaults.every(function (button) { return button.textContent.trim() === "Set default"; }), "every non-default available vendor has a sibling Set default action");
  ok(!$(".session-create-menu-sep", menuEl()) && !defaults.some(function (button) { return button.closest("button button"); }), "no divider item or nested button");
  var selectedBefore = currentVendor();
  var codexDefault = defaults.filter(function (button) { return /Codex/.test(button.title); })[0];
  var before = wsLog.length;
  click(codexDefault);
  ok(menuEl() && store.get("sessionCreate").defaultSaving && currentVendor() === selectedBefore && !newSessionMessages(before).length, "one click stays open, saves directly, and does not select or create");
  await until(function () { return /Saved as this project/.test(createRow("unfiled").textContent); }, "saved");
  var info = await (await fetch("/rpc/default")).json();
  ok(info.value.vendor === "codex" && Object.keys(info.value).join() === "vendor", "stored on the project, provider only: " + JSON.stringify(info.value));
  ok(info.keepMe && info.keepMe.nested === true && info.worktree && info.worktree.vendor === "codex", "unrelated project fields kept; the worktree reads its parent's default");
  var msg = wsLog.slice(before).find(function (m) { return m.type === "new_session_default_set"; });
  ok(msg && msg.vendor === "codex" && !("model" in msg) && !newSessionMessages(before).length, "request is provider-only and creates nothing");
  ok(menuEl() && currentVendor() === selectedBefore && !$$(".session-create-default-btn", menuEl()).some(function (button) { return /Codex/.test(button.title); }) && $$('.session-create-menu-item[aria-current="true"]', menuEl()).some(function (item) { return /Codex/.test(item.textContent); }), "selected provider stays separate while Codex is marked Default");
  await rpc("/rpc/flags", { defaultFail: true });
  var kimiDefault = $$(".session-create-default-btn", menuEl()).filter(function (button) { return /Kimi/.test(button.title); })[0];
  click(kimiDefault);
  await until(function () { return /Could not save/.test(createRow("unfiled").textContent); }, "default error");
  ok(menuEl() && currentVendor() === selectedBefore && !$$(".session-create-default-btn", menuEl()).some(function (button) { return button.disabled; }), "error stays inline, menu remains open and actions recover");
  await rpc("/rpc/flags", { defaultFail: false });
  keydown(document.activeElement, "Escape"); keydown(document.activeElement, "Escape"); await sync();
  await rpc("/rpc/flags", { canSetDefault: false });
  await openCreate("unfiled");
  await openMenu(createRow("unfiled"));
  ok(!$$('.session-create-default-btn', menuEl()).length, "Set default actions hidden without project settings permission");
  keydown(document.activeElement, "Escape"); keydown(document.activeElement, "Escape");
});

test("new session: the row survives list rerenders and server updates; project and DM switches clear it", async function () {
  var ids = await folderWith(["One"], [[1, 0]]);
  await openCreate(ids[0]);
  await chooseVendorItem("Codex", createRow(ids[0]));
  formSelect("vendor", createRow(ids[0])).focus();
  var out = await rpc("/rpc", { socket: "u1b", msg: { type: "session_folders_op", slug: "proj", op: { op: "set_view", sort: "title" } } });
  deliver(out, "u1-a"); await renderAll(); await sync();
  var rowEl = createRow(ids[0]);
  ok(rowEl && currentVendor() === "codex" && $$(".session-create-row").length === 1, "provider kept, one row");
  ok(document.activeElement === formSelect("vendor", rowEl), "focus kept on the picker: " + (document.activeElement && document.activeElement.dataset.focusKey));
  click($(".session-folder-toggle", section(ids[0]))); await sync();
  ok(createRow(ids[0]) && currentVendor() === "codex", "folder toggle leaves the row alone");
  store.set({ currentSlug: "elsewhere" });
  ok(!store.get("sessionCreate") && !$(".session-create-row") && !store.get("sessionCreateOptions"), "project switch clears the row and its cached options");
  store.set({ currentSlug: "proj" }); await sync();
  await openCreate("unfiled");
  store.set({ dmMode: true });
  ok(!store.get("sessionCreate"), "DM switch clears it");
  store.set({ dmMode: false });
});

test("new session on mobile: touch-sized pills and row, no global control, state survives a repaint", async function () {
  await freshWorld();
  var host = document.createElement("div");
  host.id = "mobile-host";
  host.style.cssText = "position:fixed;right:0;top:0;width:360px;height:100vh;overflow:auto;background:#222;z-index:5";
  document.body.appendChild(host);
  var desktop = document.getElementById("sidebar");
  desktop.style.display = "none";
  try {
    function repaintMobile() { captureFolderInputs(); host.innerHTML = ""; renderMobileSessionsInto(host); }
    repaintMobile();
    ok(!$(".mobile-session-new", host) && !$(".mobile-vendor-list", host) && !$("[class*='session-create-cta']", host), "no global creation control on mobile");
    var btn = newBtn("unfiled", host);
    ok(btn.getBoundingClientRect().height >= 34 && btn.getBoundingClientRect().width >= 44, "touch-sized pill");
    click(btn); await sync(); repaintMobile();
    await until(function () { var r = host.querySelector(".session-create-row"); return r && formSelect("vendor", r) && !formSelect("vendor", r).disabled; }, "mobile row");
    var rowEl = host.querySelector(".session-create-row");
    ok(rowEl.classList.contains("is-mobile") && $$("button", rowEl).every(function (c) { return c.getBoundingClientRect().height >= 40; }), "controls at least 40px tall");
    ok($(".session-create-line", rowEl).getBoundingClientRect().height === 44 && rowEl.getBoundingClientRect().right <= host.getBoundingClientRect().right, "one compact 44px touch line inside the sheet");
    await openMenu(rowEl);
    var hostMenu = $(".session-create-menu", host), hostItems = $$('[role="menuitem"]', hostMenu);
    var mm = hostMenu.getBoundingClientRect();
    ok(mm.left >= 0 && mm.right <= window.innerWidth && hostItems.every(function (i) { return i.getBoundingClientRect().height >= 44 && i.scrollWidth <= i.clientWidth; }), "mobile dropdown inside the viewport with unclipped 44px items: " + JSON.stringify(mm) + " " + hostItems.map(function (i) { return Math.round(i.getBoundingClientRect().height); }));
    var mobileNames = $$(".session-create-menu-name", hostMenu), mobileNotes = $$(".session-create-menu-note", hostMenu);
    ok(mobileNames.every(function (name) { return name.scrollWidth <= name.clientWidth; }) && mobileNotes.every(function (note) {
      var name = $(".session-create-menu-name", note.closest(".session-create-menu-item"));
      return note.scrollWidth <= note.clientWidth && (!name || name.getBoundingClientRect().right <= note.getBoundingClientRect().left);
    }), "mobile provider names and statuses remain fully visible and nonoverlapping");
    ok(hostItems.length >= 11 && $$(".unavailable", hostMenu).length >= 7, "mobile lists all providers including unavailable ones");
    await chooseVendorItem("Codex", rowEl);
    formSelect("vendor", host).focus();
    repaintMobile(); await sync();
    var again = host.querySelector(".session-create-row");
    ok(again && currentVendor() === "codex" && document.activeElement === formSelect("vendor", again), "provider and focus survive a repaint");
    click(newBtn("unfiled", host));
    await until(function () { return !store.get("sessionCreate"); }, "mobile creation acknowledged");
    repaintMobile();
    ok(!host.querySelector(".session-create-row"), "closed after the acknowledgement");
  } finally {
    desktop.style.display = "";
    host.remove();
  }
});

test("legacy dates/none snapshots render the folder layout with assignments, order and collapse kept", async function () {
  await freshWorld();
  for (var legacyGroup of ["dates", "none"]) {
    handleSessionFoldersState({ type: "session_folders_state", slug: "proj", state: {
      folders: [{ id: "f_aaaaaa", name: "Kept" }], assignments: { 1: "f_aaaaaa" }, favorites: [2], orders: { f_aaaaaa: [1] }, collapsed: { f_aaaaaa: true },
      view: { group: legacyGroup, sort: "title", direction: "desc" },
    } });
    await sync();
    ok(!$(".session-folder-flat") && section("favorites") && section("f_aaaaaa") && section("unfiled"), legacyGroup + " snapshot shows Favorites, the folder and Unfiled");
    ok(section("f_aaaaaa").querySelector(".session-folder-body").hidden === true, legacyGroup + " keeps the collapsed folder collapsed");
    ok(titlesIn("favorites").includes("2") && !titlesIn("unfiled").includes("1"), legacyGroup + " keeps assignments");
    ok(store.get("sessionFolders").view.sort === "title" && store.get("sessionFolders").view.direction === "desc", legacyGroup + " keeps sort and direction");
  }
});

test("open dialogs and menus close on project switch", async function () {
  await freshWorld();
  openSessionMove(1);
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
  ok(toSecond.length === 1 && toSecond[0].msg.state.favorites.join() === "1" && toSecond[0].msg.state.assignments[1] === undefined, "second u1 socket got both the tag and unchanged Unfiled placement");
  ok(toOther.length === 0, "u2 got nothing");
});

(async function run() {
  createStore({ connected: true, currentSlug: "proj", splitGroups: [], splitPanes: null, installedVendors: ["claude"], defaultVendorState: null, permissions: null, isMultiUserMode: true, myUserId: "u1", dmMode: false, sessionFolders: null, sessionFoldersSlug: null, sessionFolderCreate: null, sidebarCreationEffects: [], sessionFolderViewMenu: null, sessionFolderMenu: null, sessionFolderContext: null, sessionSearch: null, sessionPresence: {}, sessionFolderLayouts: {}, sessionFolderDrag: null, sessionFolderMenu: null, sessionFolderModal: null });
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
  await fetch("/rpc/result", { method: "POST", body: JSON.stringify({ summary: summary, total: tests.length, failures: failures, results: results }) });
  if (new URLSearchParams(location.search).get("preview") === "mobile") {
    var preview = document.createElement("div");
    preview.id = "mobile-preview";
    preview.style.cssText = "position:fixed;inset:0;overflow:auto;background:var(--sidebar-bg,#171717);z-index:20;padding:8px";
    document.body.appendChild(preview);
    renderMobileSessionsInto(preview);
    refreshIcons();
  }
  if (new URLSearchParams(location.search).get("preview") === "row-layout") {
    SESSIONS[0].title = "Cloud browser review with a deliberately long title";
    SESSIONS[0].lastActivity = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    SESSIONS[0].githubLinks = [{ url: "https://github.com/clay/clay/pull/570", repository: "clay/clay", kind: "pr", number: 570, title: "Compact row layout", state: "open" }];
    SESSIONS[2].title = "Driver integration with a deliberately long title";
    SESSIONS[2].lastActivity = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    SESSIONS[2].githubLinks = [{ url: "https://github.com/clay/clay/pull/567", repository: "clay/clay", kind: "pr", number: 567, title: "Driver metadata", state: "open" }];
    document.getElementById("sidebar").style.width = "320px";
    document.getElementById("sidebar").style.minWidth = "320px";
    await renderAll();
    refreshIcons();
  }
  var previewMode = new URLSearchParams(location.search).get("preview");
  if (previewMode === "ux" || previewMode === "ux-mobile") {
    var alphaPreviewRow = row(1);
    if (!unitIn("favorites", 1) && alphaPreviewRow) { drag(alphaPreviewRow, section("favorites")); await sync(); }
    SESSIONS[0].title = "Cloud review with linked work and active viewers";
    SESSIONS[0].lastActivity = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    SESSIONS[0].githubLinks = [{ url: "https://github.com/clay/clay/pull/570", repository: "clay/clay", kind: "pr", number: 570, title: "Compact sidebar UX", state: "open" }];
    var reviewWidth = new URLSearchParams(location.search).get("width") || "320";
    document.getElementById("sidebar").style.width = reviewWidth + "px";
    document.getElementById("sidebar").style.minWidth = reviewWidth + "px";
    await renderAll();
    updateSessionPresence({ 1: [
      { id: "a", displayName: "Ada", avatarStyle: "imprint", avatarSeed: "a" },
      { id: "b", displayName: "Ben", avatarStyle: "bottts", avatarSeed: "b" },
      { id: "c", displayName: "Cia", avatarStyle: "thumbs", avatarSeed: "c" },
      { id: "d", displayName: "Dee", avatarStyle: "shapes", avatarSeed: "d" },
    ] });
    refreshIcons();
    if (previewMode === "ux-mobile") {
      var mobilePreview = document.createElement("div");
      mobilePreview.id = "mobile-ux-preview";
      mobilePreview.style.cssText = "position:fixed;inset:0;overflow:auto;background:var(--sidebar-bg,#171717);z-index:20;padding:8px";
      document.body.appendChild(mobilePreview);
      renderMobileSessionsInto(mobilePreview);
      refreshIcons();
      if (new URLSearchParams(location.search).get("draft") === "1") {
        openSessionCreate("unfiled");
        await until(function () { var options = store.get("sessionCreateOptions"); return options && options.loaded && currentVendor(); }, "mobile preview providers");
        mobilePreview.innerHTML = "";
        renderMobileSessionsInto(mobilePreview);
        refreshIcons();
      }
    }
  }
  if (previewMode === "shimmer-compare") {
    var comparison = document.createElement("div");
    comparison.id = "shimmer-comparison";
    comparison.style.cssText = "position:fixed;inset:0;z-index:30;padding:28px;background:var(--sidebar-bg);color:var(--text);font:12px/1.4 var(--font-ui);box-sizing:border-box";
    comparison.innerHTML = '<div style="width:280px;padding:18px;border:1px solid var(--border);border-radius:12px;background:rgba(var(--overlay-rgb),.03)">' +
      '<div style="margin-bottom:14px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:.08em">Production Thinking reference</div>' +
      '<div class="shimmer-reference" style="margin-bottom:22px"><span class="thinking-label" style="font-size:12px">Thinking through project dependencies</span></div>' +
      '<div style="margin-bottom:14px;color:var(--text-dimmer);font-size:10px;text-transform:uppercase;letter-spacing:.08em">Creation titles · exactly two passes</div>' +
      '<div class="session-folder-label shimmer-preview-title" style="font-size:12px;margin-bottom:10px">Research</div>' +
      '<div class="session-item-text" style="font-size:12px;width:230px"><span class="session-item-title shimmer-preview-title">Cloud browser review with a deliberately long title</span></div>' +
      '</div>';
    document.body.appendChild(comparison);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $(".shimmer-reference", comparison).classList.add("thinking-live");
        var previewTitles = $$(".shimmer-preview-title", comparison);
        for (var si = 0; si < previewTitles.length; si++) previewTitles[si].classList.add("sidebar-creation-shimmer");
        setTimeout(function () {
          for (var ci = 0; ci < previewTitles.length; ci++) previewTitles[ci].classList.remove("sidebar-creation-shimmer");
        }, 5700);
      });
    });
  }
  if (previewMode === "sticky-spacing") {
    document.getElementById("sidebar").style.overflow = "clip";
    var scrollPreview = document.getElementById("sidebar-panel-sessions");
    scrollPreview.style.height = "240px";
    scrollPreview.style.flex = "0 0 240px";
    scrollPreview.style.overflowY = "auto";
    scrollPreview.scrollTop = 0;
  }
  if (previewMode === "long-motion") {
    var tallPreviewId = folderIdByLabel("Tall");
    var motionPanel = document.getElementById("sidebar-panel-sessions");
    motionPanel.style.height = "430px";
    motionPanel.style.flex = "0 0 430px";
    motionPanel.style.overflowY = "auto";
    if (tallPreviewId && toggleOf(tallPreviewId).getAttribute("aria-expanded") !== "true") {
      click(toggleOf(tallPreviewId));
      await until(function () {
        return !$(".session-folder-body", section(tallPreviewId)).classList.contains("folder-collapse-animating");
      }, "long motion preview opening");
    }
    if (tallPreviewId) motionPanel.scrollTop = $(".session-folder-header", section(tallPreviewId)).offsetTop - 90;
    refreshIcons();
  }
  if (previewMode === "long-motion-mobile") {
    var mobileMotionFixture = await mobileFixtureFrame("mobile-long-motion-preview", 320, Math.min(700, window.innerHeight));
    var mobileMotionPreview = mobileMotionFixture.host;
    mobileMotionFixture.frame.style.left = "0";
    mobileMotionFixture.frame.style.right = "auto";
    renderMobileSessionsInto(mobileMotionPreview);
    var mobileTallPreviewId = folderIdByLabel("Tall");
    var mobileTallPreview = mobileTallPreviewId && $('.session-folder[data-folder-id="' + mobileTallPreviewId + '"]', mobileMotionPreview);
    if (mobileTallPreview && $(".session-folder-toggle", mobileTallPreview).getAttribute("aria-expanded") !== "true") {
      click($(".session-folder-toggle", mobileTallPreview));
      await until(function () {
        return !$(".session-folder-body", mobileTallPreview).classList.contains("folder-collapse-animating");
      }, "mobile long motion preview opening");
    }
    if (mobileTallPreview) {
      $(".session-folder-header", mobileTallPreview).scrollIntoView({ block: "start" });
      mobileMotionPreview.scrollTop = Math.max(0, mobileMotionPreview.scrollTop - 110);
    }
    refreshIcons();
  }
})();
